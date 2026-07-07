from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.customer import Customer
from app.models.ledger import AuditChangeTypeEnum, CustomerLedger, LedgerEntryTypeEnum, TransactionAuditLog
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


# self-referential relationships aren't loaded by their mapper-level lazy="selectin"
# default — they need to be requested explicitly at query time, recursion_depth=-1
# follows the parent/child chain to whatever depth actually exists
_WITH_CHILDREN = selectinload(SalesTransaction.children, recursion_depth=-1)

# transaction_status a role's queue is filtered to — payment and releasing each
# own exactly one phase; walk_in and admin aren't queue-scoped this way
ROLE_QUEUE_STATUS: dict[str, TransactionStatusEnum] = {
    "payment": TransactionStatusEnum.pending_payment,
    "releasing": TransactionStatusEnum.pending_settlement,
}


class QueueConflictError(Exception):
    """The transaction's current transaction_status/queue_status doesn't allow this action."""


class QueuePermissionError(Exception):
    """The acting user/role isn't allowed to perform this queue action."""


class PaymentValidationError(Exception):
    """The submitted payment breakdown doesn't satisfy the transaction's requirements."""


class SubstandardValidationError(Exception):
    """The submitted outcome doesn't apply to this transaction's balance_due."""


def _initial_status(customer_type: CustomerTypeEnum) -> TransactionStatusEnum:
    if customer_type == CustomerTypeEnum.walk_in:
        return TransactionStatusEnum.pending_payment
    return TransactionStatusEnum.pending_settlement


async def _next_order_number(db: AsyncSession) -> str:
    prefix = f"TXN-{datetime.now(timezone.utc):%Y%m%d}-"
    result = await db.execute(
        select(func.count()).select_from(SalesTransaction).where(SalesTransaction.order_number.like(f"{prefix}%"))
    )
    sequence = result.scalar_one() + 1
    return f"{prefix}{sequence:04d}"


def _item_subtotal(item: TransactionItemCreate, data: TransactionCreate) -> Decimal:
    if item.item_type == ItemTypeEnum.product:
        if item.product_id is None or item.estimated_weight_kg is None or item.unit_price is None:
            raise ValueError("product items require product_id, estimated_weight_kg, and unit_price")
        return (item.estimated_weight_kg * item.unit_price).quantize(Decimal("0.01"))

    if item.reference_transaction_id is None:
        raise ValueError(f"{item.item_type.value} items require reference_transaction_id")

    if item.item_type == ItemTypeEnum.balance_settlement:
        return data.balance_settled
    return -data.credit_applied  # credit_usage


async def create_transaction(db: AsyncSession, data: TransactionCreate, walkin_user_id: int) -> TransactionResponse:
    customer = await db.get(Customer, data.customer_id)
    if customer is None:
        raise ValueError(f"Customer {data.customer_id} not found")
    if data.credit_applied > 0 and customer.net_balance < data.credit_applied:
        raise ValueError("Customer does not have enough credit for the amount applied")

    try:
        transaction = SalesTransaction(
            order_number=await _next_order_number(db),
            transaction_type=TransactionTypeEnum.original,
            transaction_status=_initial_status(data.customer_type),
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
            subtotal = _item_subtotal(item, data)
            if item.item_type == ItemTypeEnum.product:
                estimated_amount += subtotal

            db.add(
                TransactionItem(
                    transaction_id=transaction.id,
                    item_type=item.item_type,
                    product_id=item.product_id,
                    estimated_weight_kg=item.estimated_weight_kg,
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
    return TransactionResponse.model_validate(transaction)


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
    return [TransactionResponse.model_validate(t) for t in chain]


async def list_transactions(
    db: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 20,
    transaction_status: TransactionStatusEnum | None = None,
    customer_type: CustomerTypeEnum | None = None,
    customer_id: int | None = None,
    walkin_user_id: int | None = None,
    walkin_at_from: datetime | None = None,
    walkin_at_to: datetime | None = None,
) -> TransactionListResponse:
    filters = []
    if transaction_status is not None:
        filters.append(SalesTransaction.transaction_status == transaction_status)
    if customer_type is not None:
        filters.append(SalesTransaction.customer_type == customer_type)
    if customer_id is not None:
        filters.append(SalesTransaction.customer_id == customer_id)
    if walkin_user_id is not None:
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
    return TransactionListResponse(total=total, items=[TransactionResponse.model_validate(t) for t in items])


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


async def grab_transaction(
    db: AsyncSession, transaction_id: int, user_id: int, user_role: str
) -> TransactionResponse:
    required_status = ROLE_QUEUE_STATUS.get(user_role)
    if required_status is None:
        raise QueuePermissionError(f"role '{user_role}' does not have a transaction queue")

    transaction = await db.get(SalesTransaction, transaction_id)
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
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.processing_by_user_id != user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    old_queue_status = transaction.queue_status.value
    transaction.queue_status = QueueStatusEnum.parked
    transaction.processing_by_user_id = None
    transaction.parked_by_user_id = user_id
    transaction.parked_at = datetime.now(timezone.utc)

    return await _finalize_queue_change(db, transaction, old_queue_status, user_id)


async def unpark_transaction(db: AsyncSession, transaction_id: int, user_id: int) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
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
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_payment:
        raise QueueConflictError(f"transaction {transaction_id} is not pending payment")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise QueueConflictError(f"transaction {transaction_id} has not been grabbed for payment")
    if transaction.processing_by_user_id != payment_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    total_paid = sum((payment.amount for payment in data.payments), Decimal("0"))
    if total_paid != transaction.total_due:
        raise PaymentValidationError(
            f"payment total {total_paid} does not match amount due {transaction.total_due}"
        )

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

        if cash_tendered < cash_portion:
            raise PaymentValidationError("cash tendered is less than the cash portion of the amount due")

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
