from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.customer import Customer
from app.models.ledger import AuditChangeTypeEnum, CustomerLedger, LedgerEntryTypeEnum, TransactionAuditLog
from app.models.product import Product
from app.models.transaction import (
    CustomerTypeEnum,
    ItemTypeEnum,
    PaymentDetail,
    PaymentMethod,
    QueueStatusEnum,
    SalesTransaction,
    TransactionItem,
    TransactionStatusEnum,
    TransactionTypeEnum,
)
from app.schemas.transaction import (
    DraftPaymentEntry,
    PaymentDetailResponse,
    PaymentProcessRequest,
    SubstandardOutcomeRequest,
    TransactionCreate,
    TransactionItemCreate,
    TransactionListResponse,
    TransactionResponse,
    WeightConfirmRequest,
)
from app.websocket.events import queue_status_changed, transaction_status_changed
from app.websocket.manager import manager


# TODO: End-of-day job — void all transactions where:
#   transaction_status IN ('pending_payment', 'pending_edit',
#                          'pending_settlement', 'parked')
#   AND DATE(created_at) < CURRENT_DATE
#   This should run as a scheduled task at midnight.
#   Delete is_draft payment_detail rows for voided transactions.
#   Insert transaction_audit_log entry for each voided transaction.
#   Will be implemented in Batch 5 (production readiness).

# self-referential relationships aren't loaded by their mapper-level lazy="selectin"
# default — they need to be requested explicitly at query time, recursion_depth=-1
# follows the parent/child chain to whatever depth actually exists
_WITH_CHILDREN = selectinload(SalesTransaction.children, recursion_depth=-1)


def _build_transaction_response(transaction: SalesTransaction) -> TransactionResponse:
    # payment_details (the relationship) loads every payment_detail row regardless
    # of is_draft — split it here so confirmed and draft entries are always kept
    # separate in the API response, recursing into adjustment/refund children too.
    response = TransactionResponse.model_validate(transaction)
    response.payment_details = [
        PaymentDetailResponse.model_validate(pd) for pd in transaction.payment_details if not pd.is_draft
    ]
    response.payment_drafts = [
        PaymentDetailResponse.model_validate(pd) for pd in transaction.payment_details if pd.is_draft
    ]
    response.children = [_build_transaction_response(child) for child in transaction.children]
    return response

# transaction_status a role's queue is filtered to — payment and releasing each
# own exactly one phase; receiver and admin aren't queue-scoped this way
ROLE_QUEUE_STATUS: dict[str, TransactionStatusEnum] = {
    "payment": TransactionStatusEnum.pending_payment,
    "releasing": TransactionStatusEnum.pending_settlement,
    "receiver": TransactionStatusEnum.pending_edit,
}


class QueueConflictError(Exception):
    """The transaction's current transaction_status/queue_status doesn't allow this action."""


class QueuePermissionError(Exception):
    """The acting user/role isn't allowed to perform this queue action."""


class PaymentValidationError(Exception):
    """The submitted payment breakdown doesn't satisfy the transaction's requirements."""


class SubstandardValidationError(Exception):
    """The submitted outcome doesn't apply to this transaction's balance_due."""


class TransactionEditFlowError(Exception):
    """The transaction isn't in a state that allows this return-to-receiver/edit/resubmit action."""


def _initial_status(customer_type: CustomerTypeEnum, transaction_type: TransactionTypeEnum) -> TransactionStatusEnum:
    # balance-settlement-only orders always go straight to Payment — there's no
    # order to release, regardless of customer_type (see PROJECT_CONTEXT.md section 5)
    if transaction_type == TransactionTypeEnum.balance_settlement:
        return TransactionStatusEnum.pending_payment
    if customer_type == CustomerTypeEnum.walk_in:
        return TransactionStatusEnum.pending_payment
    return TransactionStatusEnum.pending_settlement


async def _next_order_number(db: AsyncSession) -> str:
    today = datetime.now(timezone.utc)
    prefix = f"TXN-{today:%Y%m%d}-"

    # Deriving the next sequence number from row count breaks the moment any
    # row for today is deleted (e.g. test-data cleanup): COUNT(*) drops below
    # the highest suffix already used, so count+1 collides with an existing
    # order_number. The suffix must come from the max number actually used,
    # not how many rows currently exist.
    #
    # Computing max+1 and inserting is also a check-then-insert race on its
    # own: two submits landing close together can both read the same max and
    # both try to claim max+1. An advisory lock keyed on the day serializes
    # that read+generate step across concurrent transactions; it auto-releases
    # at commit/rollback so no explicit unlock is needed.
    await db.execute(select(func.pg_advisory_xact_lock(int(today.strftime("%Y%m%d")))))

    result = await db.execute(
        select(SalesTransaction.order_number).where(SalesTransaction.order_number.like(f"{prefix}%"))
    )
    existing_suffixes = [int(order_number.rsplit("-", 1)[-1]) for order_number in result.scalars().all()]
    sequence = max(existing_suffixes, default=0) + 1
    return f"{prefix}{sequence:04d}"


async def _product_item_subtotal(
    db: AsyncSession, item: TransactionItemCreate
) -> tuple[Decimal, Decimal | None, Decimal | None]:
    """Returns (subtotal, estimated_weight_kg, quantity_kg) for a product-type item."""
    if item.product_id is None or item.unit_price is None:
        raise ValueError("product items require product_id and unit_price")
    if item.unit_count is None or item.unit_count < 1:
        raise ValueError("product items require unit_count >= 1")
    if item.quantity_kg is None or item.quantity_kg <= 0:
        raise ValueError("product items require quantity_kg > 0")

    product = await db.get(Product, item.product_id)
    if product is None:
        raise ValueError(f"Product {item.product_id} not found")

    subtotal = (item.quantity_kg * item.unit_price).quantize(Decimal("0.01"))
    return subtotal, item.estimated_weight_kg, item.quantity_kg


async def _item_subtotal(
    db: AsyncSession, item: TransactionItemCreate, data: TransactionCreate
) -> tuple[Decimal, Decimal | None, Decimal | None]:
    """Returns (subtotal, estimated_weight_kg, quantity_kg). The weight fields are only set for product items."""
    if item.item_type == ItemTypeEnum.product:
        return await _product_item_subtotal(db, item)

    if item.reference_transaction_id is None:
        raise ValueError(f"{item.item_type.value} items require reference_transaction_id")

    if item.item_type == ItemTypeEnum.balance_settlement:
        return data.balance_settled, None, None
    return -data.credit_applied, None, None  # credit_usage


async def create_transaction(db: AsyncSession, data: TransactionCreate, walkin_user_id: int) -> TransactionResponse:
    customer = await db.get(Customer, data.customer_id)
    if customer is None:
        raise ValueError(f"Customer {data.customer_id} not found")
    if data.credit_applied > 0 and customer.net_balance < data.credit_applied:
        raise ValueError("Customer does not have enough credit for the amount applied")

    transaction_type = TransactionTypeEnum(data.transaction_type)

    if transaction_type == TransactionTypeEnum.balance_settlement:
        if data.items:
            raise ValueError("balance settlement transactions cannot include items")
        if data.balance_settled <= 0:
            raise ValueError("balance_settled must be greater than 0 for a balance settlement transaction")
        if customer.net_balance >= 0:
            raise ValueError("Customer does not have an outstanding balance to settle")
        if data.balance_settled > abs(customer.net_balance):
            raise ValueError("balance_settled exceeds the customer's outstanding balance")

    try:
        transaction = SalesTransaction(
            order_number=await _next_order_number(db),
            transaction_type=transaction_type,
            transaction_status=_initial_status(data.customer_type, transaction_type),
            customer_type=data.customer_type,
            walkin_user_id=walkin_user_id,
            customer_id=data.customer_id,
            credit_applied=data.credit_applied,
            balance_settled=data.balance_settled,
            queue_status=QueueStatusEnum.waiting,
            walkin_at=datetime.now(timezone.utc),
        )
        db.add(transaction)
        await db.flush()  # assigns transaction.id for the rows below

        estimated_amount = Decimal("0.00")
        for item in data.items:
            subtotal, estimated_weight_kg, quantity_kg = await _item_subtotal(db, item, data)
            if item.item_type == ItemTypeEnum.product:
                estimated_amount += subtotal

            db.add(
                TransactionItem(
                    transaction_id=transaction.id,
                    item_type=item.item_type,
                    product_id=item.product_id,
                    unit_count=item.unit_count,
                    estimated_weight_kg=estimated_weight_kg,
                    quantity_kg=quantity_kg,
                    unit_price=item.unit_price,
                    reference_transaction_id=item.reference_transaction_id,
                    subtotal=subtotal,
                )
            )

        transaction.estimated_amount = estimated_amount
        transaction.total_due = estimated_amount + data.balance_settled - data.credit_applied

        if data.credit_applied > 0:
            customer.net_balance -= data.credit_applied
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.credit_used,
                    amount=data.credit_applied,
                    running_balance=customer.net_balance,
                )
            )

        # A balance-settlement-only order hasn't been paid for yet at this point —
        # crediting the customer's ledger now would clear their utang before Payment
        # actually collects it. That mutation is deferred to process_payment instead,
        # using transaction.balance_settled recorded here (see PART 4 in this flow).
        if data.balance_settled > 0 and transaction_type != TransactionTypeEnum.balance_settlement:
            customer.net_balance += data.balance_settled
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.balance_settled,
                    amount=data.balance_settled,
                    running_balance=customer.net_balance,
                )
            )

        db.add(
            TransactionAuditLog(
                transaction_id=transaction.id,
                changed_by_user_id=walkin_user_id,
                change_type=AuditChangeTypeEnum.transaction_status,
                old_value=None,
                new_value=transaction.transaction_status.value,
            )
        )

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return await get_transaction(db, transaction.id)


async def get_transaction(db: AsyncSession, transaction_id: int) -> TransactionResponse:
    # a plain db.get() would return an already-identity-mapped instance as-is
    # without loading relationships/generated columns that aren't populated yet
    # (e.g. right after creating it in the same session) — a real SELECT avoids that.
    # populate_existing is needed on top of that: callers that mutate child rows
    # (payment_details, items) after already having loaded the transaction once in
    # this session (e.g. via db.get() in process_payment) would otherwise get back
    # the stale, already-cached collection instead of the freshly committed one.
    result = await db.execute(
        select(SalesTransaction)
        .where(SalesTransaction.id == transaction_id)
        .options(_WITH_CHILDREN)
        .execution_options(populate_existing=True)
    )
    transaction = result.scalar_one_or_none()
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")
    return _build_transaction_response(transaction)


async def get_transaction_chain(db: AsyncSession, transaction_id: int) -> list[TransactionResponse]:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    root_id = transaction.parent_transaction_id or transaction.id

    result = await db.execute(
        select(SalesTransaction)
        .where(or_(SalesTransaction.id == root_id, SalesTransaction.parent_transaction_id == root_id))
        .order_by(SalesTransaction.id)
        .options(_WITH_CHILDREN)
        .execution_options(populate_existing=True)
    )
    chain = result.scalars().all()
    return [_build_transaction_response(t) for t in chain]


async def list_transactions(
    db: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 20,
    transaction_status: TransactionStatusEnum | None = None,
    queue_status: QueueStatusEnum | None = None,
    customer_type: CustomerTypeEnum | None = None,
    customer_id: int | None = None,
    walkin_user_id: int | None = None,
    include_pending_edit: bool = False,
    processing_by_user_id: int | None = None,
    walkin_at_from: datetime | None = None,
    walkin_at_to: datetime | None = None,
) -> TransactionListResponse:
    filters = []
    if transaction_status is not None:
        filters.append(SalesTransaction.transaction_status == transaction_status)
    if queue_status is not None:
        filters.append(SalesTransaction.queue_status == queue_status)
    if processing_by_user_id is not None:
        filters.append(SalesTransaction.processing_by_user_id == processing_by_user_id)
    if customer_type is not None:
        filters.append(SalesTransaction.customer_type == customer_type)
    if customer_id is not None:
        filters.append(SalesTransaction.customer_id == customer_id)
    if walkin_user_id is not None:
        if include_pending_edit:
            # returned transactions are visible to every receiver, not just
            # whoever originally created them
            filters.append(
                or_(
                    SalesTransaction.walkin_user_id == walkin_user_id,
                    SalesTransaction.transaction_status == TransactionStatusEnum.pending_edit,
                )
            )
        else:
            filters.append(SalesTransaction.walkin_user_id == walkin_user_id)
    if walkin_at_from is not None:
        filters.append(SalesTransaction.walkin_at >= walkin_at_from)
    if walkin_at_to is not None:
        filters.append(SalesTransaction.walkin_at < walkin_at_to)

    total = (
        await db.execute(select(func.count()).select_from(SalesTransaction).where(*filters))
    ).scalar_one()

    result = await db.execute(
        select(SalesTransaction)
        .where(*filters)
        .order_by(SalesTransaction.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .options(_WITH_CHILDREN)
        .execution_options(populate_existing=True)
    )
    items = result.scalars().all()
    return TransactionListResponse(total=total, items=[_build_transaction_response(t) for t in items])


async def _finalize_queue_change(
    db: AsyncSession, transaction: SalesTransaction, old_queue_status: str, changed_by_user_id: int
) -> TransactionResponse:
    try:
        db.add(
            TransactionAuditLog(
                transaction_id=transaction.id,
                changed_by_user_id=changed_by_user_id,
                change_type=AuditChangeTypeEnum.queue_status,
                old_value=old_queue_status,
                new_value=transaction.queue_status.value,
            )
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    rooms, event = queue_status_changed(
        transaction_id=transaction.id,
        old_queue_status=old_queue_status,
        new_queue_status=transaction.queue_status.value,
        transaction_status=transaction.transaction_status.value,
    )
    await manager.broadcast_multi(rooms, event)

    return await get_transaction(db, transaction.id)


async def _get_transaction_for_update(db: AsyncSession, transaction_id: int) -> SalesTransaction | None:
    # Queue transitions are read-check-write on queue_status/processing_by_user_id —
    # without a row lock, two concurrent requests can both read 'waiting' before
    # either commits, and both succeed. FOR UPDATE serializes them: the second
    # request blocks until the first commits, then re-reads the now-updated row.
    result = await db.execute(select(SalesTransaction).where(SalesTransaction.id == transaction_id).with_for_update())
    return result.scalar_one_or_none()


async def release_processing_transactions(db: AsyncSession, user_id: int) -> None:
    """Auto-release a user's held transactions back to 'waiting' on WebSocket disconnect.

    Runs on a session separate from the closing WS connection's request scope,
    so it must load, mutate, and commit its own rows rather than reuse
    _get_transaction_for_update (which assumes an already-open caller session).
    """
    result = await db.execute(
        select(SalesTransaction)
        .where(
            SalesTransaction.processing_by_user_id == user_id,
            SalesTransaction.queue_status == QueueStatusEnum.processing,
        )
        .with_for_update()
    )
    transactions = result.scalars().all()
    if not transactions:
        return

    broadcasts = []
    try:
        for transaction in transactions:
            old_queue_status = transaction.queue_status.value
            transaction.queue_status = QueueStatusEnum.waiting
            transaction.processing_by_user_id = None
            transaction.processing_started_at = None

            db.add(
                TransactionAuditLog(
                    transaction_id=transaction.id,
                    changed_by_user_id=user_id,
                    change_type=AuditChangeTypeEnum.queue_status,
                    old_value=old_queue_status,
                    new_value=transaction.queue_status.value,
                    notes="auto-released on disconnect",
                )
            )
            broadcasts.append(
                queue_status_changed(
                    transaction_id=transaction.id,
                    old_queue_status=old_queue_status,
                    new_queue_status=transaction.queue_status.value,
                    transaction_status=transaction.transaction_status.value,
                )
            )

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    for rooms, event in broadcasts:
        await manager.broadcast_multi(rooms, event)


async def grab_transaction(
    db: AsyncSession, transaction_id: int, user_id: int, user_role: str
) -> TransactionResponse:
    required_status = ROLE_QUEUE_STATUS.get(user_role)
    if required_status is None:
        raise QueuePermissionError(f"role '{user_role}' does not have a transaction queue")

    transaction = await _get_transaction_for_update(db, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != required_status:
        raise QueueConflictError(f"transaction {transaction_id} is not in '{required_status.value}' status")
    if transaction.queue_status != QueueStatusEnum.waiting:
        raise QueueConflictError(f"transaction {transaction_id} is already {transaction.queue_status.value}")

    old_queue_status = transaction.queue_status.value
    transaction.queue_status = QueueStatusEnum.processing
    transaction.processing_by_user_id = user_id
    transaction.processing_started_at = datetime.now(timezone.utc)

    return await _finalize_queue_change(db, transaction, old_queue_status, user_id)


async def park_transaction(db: AsyncSession, transaction_id: int, user_id: int) -> TransactionResponse:
    transaction = await _get_transaction_for_update(db, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    # No processing_by_user_id ownership check here: the payment modal's local
    # state can outlive who currently holds the transaction server-side (e.g.
    # another payment member unparked it), so any payment member with the
    # modal open must still be able to park it.
    old_queue_status = transaction.queue_status.value
    transaction.queue_status = QueueStatusEnum.parked
    transaction.processing_by_user_id = None
    transaction.parked_by_user_id = user_id
    transaction.parked_at = datetime.now(timezone.utc)

    return await _finalize_queue_change(db, transaction, old_queue_status, user_id)


async def release_transaction(db: AsyncSession, transaction_id: int, user_id: int) -> TransactionResponse:
    transaction = await _get_transaction_for_update(db, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.processing_by_user_id != user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    old_queue_status = transaction.queue_status.value
    transaction.queue_status = QueueStatusEnum.waiting
    transaction.processing_by_user_id = None
    transaction.processing_started_at = None

    return await _finalize_queue_change(db, transaction, old_queue_status, user_id)


async def unpark_transaction(db: AsyncSession, transaction_id: int, user_id: int) -> TransactionResponse:
    transaction = await _get_transaction_for_update(db, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.queue_status != QueueStatusEnum.parked:
        raise QueueConflictError(f"transaction {transaction_id} is not parked")

    old_queue_status = transaction.queue_status.value
    transaction.queue_status = QueueStatusEnum.processing
    transaction.processing_by_user_id = user_id
    transaction.processing_started_at = datetime.now(timezone.utc)
    transaction.parked_by_user_id = None
    transaction.parked_at = None

    return await _finalize_queue_change(db, transaction, old_queue_status, user_id)


async def save_draft_payments(
    db: AsyncSession, transaction_id: int, entries: list[DraftPaymentEntry], user_id: int
) -> list[PaymentDetailResponse]:
    """Persist in-progress payment entries so they survive park/unpark cycles and reloads."""
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_payment:
        raise QueueConflictError(f"transaction {transaction_id} is not pending payment")
    if transaction.queue_status not in (QueueStatusEnum.processing, QueueStatusEnum.parked):
        raise QueueConflictError(f"transaction {transaction_id} is not being processed or parked")

    try:
        # replace wholesale — the caller always sends the full current entry
        # table, never a partial diff
        await db.execute(
            delete(PaymentDetail).where(
                PaymentDetail.transaction_id == transaction_id, PaymentDetail.is_draft.is_(True)
            )
        )

        drafts = [
            PaymentDetail(
                transaction_id=transaction_id,
                payment_method_id=entry.payment_method_id,
                ref_number=entry.ref_number,
                tendered_amount=entry.tendered_amount,
                amount=entry.amount,
                is_draft=True,
            )
            for entry in entries
        ]
        db.add_all(drafts)

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return [PaymentDetailResponse.model_validate(d) for d in drafts]


def _record_status_change_audit(
    db: AsyncSession,
    transaction: SalesTransaction,
    changed_by_user_id: int,
    old_transaction_status: str,
    old_queue_status: str,
) -> None:
    db.add(
        TransactionAuditLog(
            transaction_id=transaction.id,
            changed_by_user_id=changed_by_user_id,
            change_type=AuditChangeTypeEnum.transaction_status,
            old_value=old_transaction_status,
            new_value=transaction.transaction_status.value,
        )
    )
    db.add(
        TransactionAuditLog(
            transaction_id=transaction.id,
            changed_by_user_id=changed_by_user_id,
            change_type=AuditChangeTypeEnum.queue_status,
            old_value=old_queue_status,
            new_value=transaction.queue_status.value,
        )
    )


async def process_payment(
    db: AsyncSession,
    transaction_id: int,
    data: PaymentProcessRequest,
    payment_user_id: int,
    *,
    skip_releasing: bool = False,
) -> TransactionResponse:
    # TEMPORARY DIAGNOSTIC — remove once the 400 on transaction 110 is confirmed
    # fixed. print(flush=True) instead of logging: this app has no logging
    # config anywhere, so logger.info() defaults to WARNING+ only and would
    # silently produce nothing in `docker compose logs backend`.
    print(
        f"[process_payment] transaction_id={transaction_id} is_partial={data.is_partial} "
        f"amount_paid={data.amount_paid} payments={data.payments}",
        flush=True,
    )

    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_payment:
        raise QueueConflictError(f"transaction {transaction_id} is not pending payment")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise QueueConflictError(f"transaction {transaction_id} has not been grabbed for payment")
    if transaction.processing_by_user_id != payment_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    customer = await db.get(Customer, transaction.customer_id)

    if transaction.transaction_type == TransactionTypeEnum.balance_settlement and data.balance_settled > 0:
        raise PaymentValidationError(
            "balance_settled for a balance-settlement-only transaction was already fixed at creation"
        )

    if data.balance_settled > 0:
        if customer.net_balance >= 0:
            raise PaymentValidationError("customer does not have an outstanding balance")
        if data.balance_settled > abs(customer.net_balance):
            raise PaymentValidationError("balance_settled exceeds the customer's outstanding balance")

    if data.credit_applied > 0:
        if customer.net_balance <= 0:
            raise PaymentValidationError("customer does not have credit available")
        if data.credit_applied > customer.net_balance:
            raise PaymentValidationError("credit_applied exceeds the customer's available credit")

    # balance/credit applied at Payment time shift the amount actually owed —
    # entries must sum to this, not the original total_due
    final_amount = transaction.total_due + data.balance_settled - data.credit_applied

    amount_paid = sum((payment.amount for payment in data.payments), Decimal("0"))
    # A 1-cent tolerance, not an exact match: the frontend sums these as JS
    # floats before this Decimal ever sees them, so a multi-entry split can
    # legitimately land a fraction of a cent off. This is unrelated to cash
    # overpayment/change — the frontend already nets that out before sending
    # amount_paid, so the two are expected to be equal (within cent noise).
    if abs(amount_paid - data.amount_paid) > Decimal("0.01"):
        raise PaymentValidationError(
            f"amount_paid {data.amount_paid} does not match payment entries total {amount_paid}"
        )

    if data.is_partial:
        if transaction.transaction_type not in (TransactionTypeEnum.original, TransactionTypeEnum.adjustment):
            raise PaymentValidationError("Partial payment not allowed for balance settlement transactions")
        if amount_paid <= 0:
            raise PaymentValidationError("Payment amount must be greater than zero")
        if amount_paid >= final_amount:
            raise PaymentValidationError("Amount paid covers the full total — use full payment instead of partial")
    elif amount_paid < final_amount:
        raise PaymentValidationError("Payment amount is less than total due")

    remaining = final_amount - amount_paid

    method_ids = {payment.payment_method_id for payment in data.payments}
    methods_by_id = {}
    if method_ids:
        methods_result = await db.execute(select(PaymentMethod).where(PaymentMethod.id.in_(method_ids)))
        methods_by_id = {method.id: method for method in methods_result.scalars().all()}

    cash_tendered = Decimal("0.00")
    cash_portion = Decimal("0.00")

    try:
        for payment in data.payments:
            method = methods_by_id.get(payment.payment_method_id)
            if method is None:
                raise PaymentValidationError(f"payment_method_id {payment.payment_method_id} not found")

            if method.payment_method_name == "cash":
                if payment.tendered_amount is None:
                    raise PaymentValidationError("cash payments require tendered_amount")
                cash_tendered += payment.tendered_amount
                cash_portion += payment.amount

            db.add(
                PaymentDetail(
                    transaction_id=transaction.id,
                    payment_method_id=payment.payment_method_id,
                    ref_number=payment.ref_number,
                    tendered_amount=payment.tendered_amount,
                    amount=payment.amount,
                )
            )

        # confirmed entries replace any draft entries saved while this
        # transaction was being worked on or parked
        await db.execute(
            delete(PaymentDetail).where(
                PaymentDetail.transaction_id == transaction.id, PaymentDetail.is_draft.is_(True)
            )
        )

        if cash_tendered < cash_portion:
            raise PaymentValidationError("cash tendered is less than the cash portion of the amount due")

        if data.balance_settled > 0:
            customer.net_balance += data.balance_settled
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.balance_settled,
                    amount=data.balance_settled,
                    running_balance=customer.net_balance,
                )
            )
            transaction.balance_settled = data.balance_settled
            transaction.total_due += data.balance_settled

        if data.credit_applied > 0:
            customer.net_balance -= data.credit_applied
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.credit_used,
                    amount=data.credit_applied,
                    running_balance=customer.net_balance,
                )
            )
            transaction.credit_applied = data.credit_applied
            transaction.total_due -= data.credit_applied

        if transaction.transaction_type == TransactionTypeEnum.balance_settlement:
            # amount was fixed at creation (Receiver's "Balance Settlement Only" toggle) —
            # only now, once payment is actually collected, does it hit the ledger
            customer.net_balance += transaction.balance_settled
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.balance_settled,
                    amount=transaction.balance_settled,
                    running_balance=customer.net_balance,
                )
            )

        if data.is_partial and remaining > 0:
            customer.net_balance -= remaining
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.balance_added,
                    amount=remaining,
                    running_balance=customer.net_balance,
                )
            )
            # this remaining is NEW utang from underpayment, not the customer
            # settling an old balance — any balance_settled recorded above for
            # this same payment doesn't apply here
            transaction.balance_settled = Decimal("0.00")
            db.add(
                TransactionAuditLog(
                    transaction_id=transaction.id,
                    changed_by_user_id=payment_user_id,
                    change_type=AuditChangeTypeEnum.transaction_status,
                    old_value=transaction.transaction_status.value,
                    new_value=transaction.transaction_status.value,
                    notes=f"Partial payment: ₱{amount_paid} collected, ₱{remaining} added to customer balance",
                )
            )

        old_transaction_status = transaction.transaction_status.value
        old_queue_status = transaction.queue_status.value

        transaction.cash_tendered = cash_tendered
        transaction.change_given = cash_tendered - cash_portion
        transaction.payment_user_id = payment_user_id
        transaction.payment_at = datetime.now(timezone.utc)

        if transaction.customer_type == CustomerTypeEnum.walk_in and not skip_releasing:
            transaction.transaction_status = TransactionStatusEnum.pending_settlement
            transaction.queue_status = QueueStatusEnum.waiting
        else:
            transaction.transaction_status = TransactionStatusEnum.completed
            transaction.queue_status = QueueStatusEnum.done

        # this phase's hold is over regardless of which team owns the next phase
        transaction.processing_by_user_id = None
        transaction.processing_started_at = None

        _record_status_change_audit(db, transaction, payment_user_id, old_transaction_status, old_queue_status)

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    rooms, event = transaction_status_changed(
        transaction_id=transaction.id,
        old_status=old_transaction_status,
        new_status=transaction.transaction_status.value,
        customer_type=transaction.customer_type.value,
    )
    await manager.broadcast_multi(rooms, event)

    return await get_transaction(db, transaction.id)


async def confirm_weight(
    db: AsyncSession, transaction_id: int, data: WeightConfirmRequest, releasing_user_id: int
) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_settlement:
        raise QueueConflictError(f"transaction {transaction_id} is not pending settlement")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise QueueConflictError(f"transaction {transaction_id} has not been grabbed for releasing")
    if transaction.processing_by_user_id != releasing_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    items_by_id = {item.id: item for item in transaction.items}

    try:
        for entry in data.items:
            item = items_by_id.get(entry.transaction_item_id)
            if item is None:
                raise ValueError(
                    f"transaction_item {entry.transaction_item_id} does not belong to transaction {transaction_id}"
                )
            item.actual_weight_kg = entry.actual_weight_kg

        actual_amount = Decimal("0.00")
        for item in transaction.items:
            if item.item_type == ItemTypeEnum.product:
                if item.actual_weight_kg is None:
                    raise ValueError(f"transaction_item {item.id} is missing actual_weight_kg")
                actual_amount += (item.actual_weight_kg * item.unit_price).quantize(Decimal("0.01"))

        transaction.actual_amount = actual_amount
        transaction.releasing_user_id = releasing_user_id
        transaction.releasing_at = datetime.now(timezone.utc)

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return await get_transaction(db, transaction.id)


async def confirm_items_ready(db: AsyncSession, transaction_id: int, releasing_user_id: int) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.customer_type != CustomerTypeEnum.online:
        raise QueueConflictError(f"transaction {transaction_id} is not an online order")
    if transaction.transaction_status != TransactionStatusEnum.pending_settlement:
        raise QueueConflictError(f"transaction {transaction_id} is not pending settlement")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise QueueConflictError(f"transaction {transaction_id} has not been grabbed for releasing")
    if transaction.processing_by_user_id != releasing_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    try:
        old_status = transaction.transaction_status.value
        old_queue = transaction.queue_status.value

        # online orders are per unit/box — no weight variance to confirm
        transaction.actual_amount = transaction.estimated_amount
        transaction.releasing_user_id = releasing_user_id
        transaction.releasing_at = datetime.now(timezone.utc)
        transaction.transaction_status = TransactionStatusEnum.pending_payment
        transaction.queue_status = QueueStatusEnum.waiting
        transaction.processing_by_user_id = None
        transaction.processing_started_at = None

        _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    rooms, event = transaction_status_changed(
        transaction_id=transaction.id,
        old_status=old_status,
        new_status=transaction.transaction_status.value,
        customer_type=transaction.customer_type.value,
    )
    await manager.broadcast_multi(rooms, event)

    return await get_transaction(db, transaction.id)


async def _create_adjustment_child(
    db: AsyncSession,
    parent: SalesTransaction,
    transaction_type: TransactionTypeEnum,
    amount: Decimal,
    releasing_user_id: int,
) -> SalesTransaction:
    child = SalesTransaction(
        order_number=await _next_order_number(db),
        parent_transaction_id=parent.id,
        transaction_type=transaction_type,
        transaction_status=TransactionStatusEnum.pending_payment,
        customer_type=parent.customer_type,
        customer_id=parent.customer_id,
        estimated_amount=amount,
        credit_applied=Decimal("0.00"),
        balance_settled=Decimal("0.00"),
        total_due=amount,
        cash_tendered=Decimal("0.00"),
        change_given=Decimal("0.00"),
        queue_status=QueueStatusEnum.waiting,
        walkin_at=datetime.now(timezone.utc),
    )
    db.add(child)
    await db.flush()  # assigns child.id

    db.add(
        TransactionAuditLog(
            transaction_id=child.id,
            changed_by_user_id=releasing_user_id,
            change_type=AuditChangeTypeEnum.transaction_status,
            old_value=None,
            new_value=child.transaction_status.value,
        )
    )
    return child


async def resolve_substandard(
    db: AsyncSession, transaction_id: int, data: SubstandardOutcomeRequest, releasing_user_id: int
) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if (
        transaction.customer_type == CustomerTypeEnum.online
        and transaction.transaction_status == TransactionStatusEnum.pending_settlement
    ):
        raise SubstandardValidationError("Use /confirm-ready for online orders at this stage")

    if transaction.transaction_status != TransactionStatusEnum.pending_settlement:
        raise QueueConflictError(f"transaction {transaction_id} is not pending settlement")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise QueueConflictError(f"transaction {transaction_id} has not been grabbed for releasing")
    if transaction.processing_by_user_id != releasing_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")
    if transaction.actual_amount is None:
        raise QueueConflictError(f"transaction {transaction_id} has no confirmed weight yet")

    balance_due = transaction.balance_due
    customer = await db.get(Customer, transaction.customer_id)

    child: SalesTransaction | None = None

    try:
        if balance_due == 0:
            old_status, old_queue = transaction.transaction_status.value, transaction.queue_status.value
            transaction.transaction_status = TransactionStatusEnum.completed
            transaction.queue_status = QueueStatusEnum.done
            transaction.processing_by_user_id = None
            transaction.processing_started_at = None
            _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

        elif balance_due > 0:
            if customer.net_balance >= balance_due:
                old_status, old_queue = transaction.transaction_status.value, transaction.queue_status.value
                customer.net_balance -= balance_due
                db.add(
                    CustomerLedger(
                        customer_id=customer.id,
                        transaction_id=transaction.id,
                        entry_type=LedgerEntryTypeEnum.credit_auto_used,
                        amount=balance_due,
                        running_balance=customer.net_balance,
                    )
                )
                transaction.transaction_status = TransactionStatusEnum.completed
                transaction.queue_status = QueueStatusEnum.done
                transaction.processing_by_user_id = None
                transaction.processing_started_at = None
                _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

            elif data.outcome == "pay_now":
                child = await _create_adjustment_child(
                    db, transaction, TransactionTypeEnum.adjustment, balance_due, releasing_user_id
                )
                old_status, old_queue = transaction.transaction_status.value, transaction.queue_status.value
                transaction.transaction_status = TransactionStatusEnum.settled
                transaction.queue_status = QueueStatusEnum.done
                transaction.processing_by_user_id = None
                transaction.processing_started_at = None
                _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

            elif data.outcome == "utang":
                old_status, old_queue = transaction.transaction_status.value, transaction.queue_status.value
                customer.net_balance -= balance_due
                db.add(
                    CustomerLedger(
                        customer_id=customer.id,
                        transaction_id=transaction.id,
                        entry_type=LedgerEntryTypeEnum.balance_added,
                        amount=balance_due,
                        running_balance=customer.net_balance,
                    )
                )
                transaction.transaction_status = TransactionStatusEnum.settled
                transaction.queue_status = QueueStatusEnum.done
                transaction.processing_by_user_id = None
                transaction.processing_started_at = None
                _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

            else:
                raise SubstandardValidationError(f"outcome '{data.outcome}' does not apply when balance_due is positive")

        else:  # balance_due < 0 — store owes the customer
            refund_amount = -balance_due

            if customer.net_balance < 0:
                old_status, old_queue = transaction.transaction_status.value, transaction.queue_status.value
                customer.net_balance += refund_amount
                db.add(
                    CustomerLedger(
                        customer_id=customer.id,
                        transaction_id=transaction.id,
                        entry_type=LedgerEntryTypeEnum.credit_added,
                        amount=refund_amount,
                        running_balance=customer.net_balance,
                    )
                )
                transaction.transaction_status = TransactionStatusEnum.completed
                transaction.queue_status = QueueStatusEnum.done
                transaction.processing_by_user_id = None
                transaction.processing_started_at = None
                _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

            elif data.outcome == "refund_now":
                child = await _create_adjustment_child(
                    db, transaction, TransactionTypeEnum.refund, refund_amount, releasing_user_id
                )
                old_status, old_queue = transaction.transaction_status.value, transaction.queue_status.value
                transaction.transaction_status = TransactionStatusEnum.settled
                transaction.queue_status = QueueStatusEnum.done
                transaction.processing_by_user_id = None
                transaction.processing_started_at = None
                _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

            elif data.outcome == "save_credit":
                old_status, old_queue = transaction.transaction_status.value, transaction.queue_status.value
                customer.net_balance += refund_amount
                db.add(
                    CustomerLedger(
                        customer_id=customer.id,
                        transaction_id=transaction.id,
                        entry_type=LedgerEntryTypeEnum.credit_added,
                        amount=refund_amount,
                        running_balance=customer.net_balance,
                    )
                )
                transaction.transaction_status = TransactionStatusEnum.settled
                transaction.queue_status = QueueStatusEnum.done
                transaction.processing_by_user_id = None
                transaction.processing_started_at = None
                _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

            else:
                raise SubstandardValidationError(f"outcome '{data.outcome}' does not apply when balance_due is negative")

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    if child is not None:
        rooms, event = transaction_status_changed(
            transaction_id=child.id,
            old_status=None,
            new_status=child.transaction_status.value,
            customer_type=child.customer_type.value,
        )
    else:
        rooms, event = transaction_status_changed(
            transaction_id=transaction.id,
            old_status=old_status,
            new_status=transaction.transaction_status.value,
            customer_type=transaction.customer_type.value,
        )
    await manager.broadcast_multi(rooms, event)

    return await get_transaction(db, transaction.id)


async def return_to_receiver(db: AsyncSession, transaction_id: int, payment_user_id: int) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.customer_type != CustomerTypeEnum.walk_in:
        raise TransactionEditFlowError("Online orders cannot be returned to Receiver")
    if transaction.transaction_status != TransactionStatusEnum.pending_payment:
        raise TransactionEditFlowError(f"transaction {transaction_id} is not pending payment")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise TransactionEditFlowError(f"transaction {transaction_id} has not been grabbed for payment")
    if transaction.processing_by_user_id != payment_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    try:
        old_status = transaction.transaction_status.value

        transaction.transaction_status = TransactionStatusEnum.pending_edit
        transaction.queue_status = QueueStatusEnum.waiting
        transaction.processing_by_user_id = None
        transaction.processing_started_at = None

        # drafts are irrelevant if the order goes back to Receiver for editing
        await db.execute(
            delete(PaymentDetail).where(
                PaymentDetail.transaction_id == transaction.id, PaymentDetail.is_draft.is_(True)
            )
        )

        db.add(
            TransactionAuditLog(
                transaction_id=transaction.id,
                changed_by_user_id=payment_user_id,
                change_type=AuditChangeTypeEnum.transaction_status,
                old_value=old_status,
                new_value=transaction.transaction_status.value,
            )
        )

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    rooms, event = transaction_status_changed(
        transaction_id=transaction.id,
        old_status=old_status,
        new_status=transaction.transaction_status.value,
        customer_type=transaction.customer_type.value,
    )
    await manager.broadcast_multi(rooms, event)

    return await get_transaction(db, transaction.id)


async def edit_transaction_items(
    db: AsyncSession,
    transaction_id: int,
    items: list[TransactionItemCreate],
    receiver_user_id: int,
) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_edit:
        raise TransactionEditFlowError(f"transaction {transaction_id} is not pending edit")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise TransactionEditFlowError(f"transaction {transaction_id} has not been grabbed for editing")
    if transaction.processing_by_user_id != receiver_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")
    if any(item.item_type != ItemTypeEnum.product for item in items):
        raise TransactionEditFlowError("only product items can be edited at Receiver")

    try:
        for existing_item in list(transaction.items):
            await db.delete(existing_item)
        await db.flush()

        estimated_amount = Decimal("0.00")
        for item in items:
            try:
                subtotal, estimated_weight_kg, quantity_kg = await _product_item_subtotal(db, item)
            except ValueError as exc:
                raise TransactionEditFlowError(str(exc)) from exc
            estimated_amount += subtotal

            db.add(
                TransactionItem(
                    transaction_id=transaction.id,
                    item_type=item.item_type,
                    product_id=item.product_id,
                    unit_count=item.unit_count,
                    estimated_weight_kg=estimated_weight_kg,
                    quantity_kg=quantity_kg,
                    unit_price=item.unit_price,
                    reference_transaction_id=item.reference_transaction_id,
                    subtotal=subtotal,
                )
            )

        transaction.estimated_amount = estimated_amount
        # no credit/balance applied at Receiver — total_due is just the new estimate
        transaction.total_due = estimated_amount

        db.add(
            TransactionAuditLog(
                transaction_id=transaction.id,
                changed_by_user_id=receiver_user_id,
                change_type=AuditChangeTypeEnum.transaction_status,
                old_value=TransactionStatusEnum.pending_edit.value,
                new_value=TransactionStatusEnum.pending_edit.value,
                notes="items edited by receiver",
            )
        )

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return await get_transaction(db, transaction.id)


async def resubmit_to_payment(db: AsyncSession, transaction_id: int, receiver_user_id: int) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_edit:
        raise TransactionEditFlowError(f"transaction {transaction_id} is not pending edit")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise TransactionEditFlowError(f"transaction {transaction_id} has not been grabbed for editing")
    if transaction.processing_by_user_id != receiver_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    try:
        old_status = transaction.transaction_status.value

        transaction.transaction_status = TransactionStatusEnum.pending_payment
        transaction.queue_status = QueueStatusEnum.waiting
        transaction.processing_by_user_id = None
        transaction.processing_started_at = None

        db.add(
            TransactionAuditLog(
                transaction_id=transaction.id,
                changed_by_user_id=receiver_user_id,
                change_type=AuditChangeTypeEnum.transaction_status,
                old_value=old_status,
                new_value=transaction.transaction_status.value,
            )
        )

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    rooms, event = transaction_status_changed(
        transaction_id=transaction.id,
        old_status=old_status,
        new_status=transaction.transaction_status.value,
        customer_type=transaction.customer_type.value,
    )
    await manager.broadcast_multi(rooms, event)

    return await get_transaction(db, transaction.id)
