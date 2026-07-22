import json
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
    BalanceSettlementItem,
    DraftPaymentEntry,
    HandoverOutcomeResponse,
    PaymentDetailResponse,
    PaymentProcessRequest,
    SubstandardOutcomeRequest,
    TransactionCreate,
    TransactionHistoryItem,
    TransactionItemCreate,
    TransactionListResponse,
    TransactionParentItemResponse,
    TransactionParentResponse,
    TransactionResponse,
    WeightConfirmRequest,
)
from app.services import customer_service
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
# _build_transaction_response reads transaction.parent synchronously (no parent_transaction_id
# means it short-circuits without a query, but adjustment/refund children do have one) —
# without eager-loading it here too, that access fails with MissingGreenlet outside the
# async context whenever a root query result (not reached via someone else's already-loaded
# .children) actually has a parent.
_WITH_PARENT = selectinload(SalesTransaction.parent)


def _build_parent_item(item: TransactionItem) -> TransactionParentItemResponse:
    return TransactionParentItemResponse(
        id=item.id,
        product_id=item.product_id,
        product_name=item.product.product_name if item.product else None,
        brand_name=item.product.brand_name if item.product else None,
        unit_count=item.unit_count,
        quantity_kg=item.quantity_kg,
        unit_price=item.unit_price,
        subtotal=item.subtotal,
        actual_unit_count=item.actual_unit_count,
        actual_quantity_kg=item.actual_quantity_kg,
        actual_subtotal=item.actual_subtotal,
        actual_weight_kg=item.actual_weight_kg,
    )


def _build_parent_summary(parent: SalesTransaction) -> TransactionParentResponse:
    # adjustment/refund children carry no items of their own (see
    # resolve_substandard) — their article table sources from here instead.
    # Only product rows: balance_settlement/credit_usage lines on the parent
    # (e.g. a walk-in order that also paid off an old balance) aren't part of
    # the weight-variance picture.
    return TransactionParentResponse(
        id=parent.id,
        order_number=parent.order_number,
        items=[_build_parent_item(item) for item in parent.items if item.item_type == ItemTypeEnum.product],
    )


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
    if response.payment_drafts:
        response.draft_balances_json = response.payment_drafts[0].draft_balances_json
        response.draft_credit_applied = response.payment_drafts[0].draft_credit_applied
        response.draft_credit_sources_json = response.payment_drafts[0].draft_credit_sources_json
    response.parent_order_number = transaction.parent.order_number if transaction.parent else None
    response.parent = _build_parent_summary(transaction.parent) if transaction.parent else None
    response.children = [_build_transaction_response(child) for child in transaction.children]
    return response

# transaction_status a role's queue is filtered to — payment and releasing each
# own exactly one phase; receiver and admin aren't queue-scoped this way.
# Used for /grab's required-status check, which only ever matches a single,
# genuinely grabbable status (pending_adjustment cards are read-only, so
# releasing's grabbable status here stays singular).
ROLE_QUEUE_STATUS: dict[str, TransactionStatusEnum] = {
    "payment": TransactionStatusEnum.pending_payment,
    "releasing": TransactionStatusEnum.pending_settlement,
    "receiver": TransactionStatusEnum.pending_edit,
}

# statuses a role's queue LIST view includes — separate from ROLE_QUEUE_STATUS
# because releasing's list also surfaces pending_adjustment cards (awaiting
# Payment's resolution), settled cards (awaiting Releasing's handover
# confirmation for a substandard resolution), and pending_handover cards
# (awaiting Releasing's handover confirmation for a plain online payment)
# even though none of the three is grabbable the normal way
ROLE_QUEUE_LIST_STATUSES: dict[str, list[TransactionStatusEnum]] = {
    "payment": [TransactionStatusEnum.pending_payment],
    "releasing": [
        TransactionStatusEnum.pending_settlement,
        TransactionStatusEnum.pending_adjustment,
        TransactionStatusEnum.settled,
        TransactionStatusEnum.pending_handover,
    ],
    "receiver": [TransactionStatusEnum.pending_edit],
}


class QueueConflictError(Exception):
    """The transaction's current transaction_status/queue_status doesn't allow this action."""


class QueuePermissionError(Exception):
    """The acting user/role isn't allowed to perform this queue action."""


class PaymentValidationError(Exception):
    """The submitted payment breakdown doesn't satisfy the transaction's requirements."""


class SubstandardValidationError(Exception):
    """The submitted outcome doesn't apply to this transaction's balance_due."""


class WeightConfirmValidationError(Exception):
    """A confirm-weight item is missing a required actual quantity field."""


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


async def _get_payment_method_id(db: AsyncSession, payment_method_name: str) -> int:
    result = await db.execute(
        select(PaymentMethod.id).where(PaymentMethod.payment_method_name == payment_method_name)
    )
    method_id = result.scalar_one_or_none()
    if method_id is None:
        raise ValueError(f"payment_method '{payment_method_name}' not found")
    return method_id


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
        .options(_WITH_CHILDREN, _WITH_PARENT)
        .execution_options(populate_existing=True)
    )
    transaction = result.scalar_one_or_none()
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")
    return _build_transaction_response(transaction)


def _enrich_items_with_product_info(response: TransactionResponse, transaction: SalesTransaction) -> None:
    # TransactionItemResponse.product_name/brand_name default to None (see the
    # schema) — filled in here from the already-eager-loaded item.product
    # relationship (TransactionItem.product is lazy="selectin"), so /chain nodes'
    # own items carry the same product info the parent-items path already exposes,
    # letting the admin Transaction History modal feed them into ArticleRows.
    items_by_id = {item.id: item for item in transaction.items}
    for item_response in response.items:
        item = items_by_id.get(item_response.id)
        if item is not None and item.product is not None:
            item_response.product_name = item.product.product_name
            item_response.brand_name = item.product.brand_name
    for child_response, child_transaction in zip(response.children, transaction.children):
        _enrich_items_with_product_info(child_response, child_transaction)


async def get_transaction_chain(db: AsyncSession, transaction_id: int) -> list[TransactionResponse]:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    root_id = transaction.parent_transaction_id or transaction.id

    result = await db.execute(
        select(SalesTransaction)
        .where(or_(SalesTransaction.id == root_id, SalesTransaction.parent_transaction_id == root_id))
        .order_by(SalesTransaction.id)
        .options(_WITH_CHILDREN, _WITH_PARENT)
        .execution_options(populate_existing=True)
    )
    chain = result.scalars().all()
    responses = [_build_transaction_response(t) for t in chain]
    for response, t in zip(responses, chain):
        _enrich_items_with_product_info(response, t)
    return responses


def _compute_payment_status(
    transaction_status: TransactionStatusEnum,
    customer_type_value: CustomerTypeEnum,
    transaction_id: int,
    transactions_with_outstanding_balance: set[int],
) -> str:
    # Pre-payment states — no payment has been collected yet, so falling
    # through to "full" below (as anything not "voided"/"partial" used to)
    # was wrong for a brand new transaction. walk_in's pending_settlement
    # means Payment already ran (Payment precedes Releasing for walk_in),
    # so only online's own pending_settlement — which skips Payment first —
    # counts here.
    is_pre_payment = transaction_status in (
        TransactionStatusEnum.pending_payment,
        TransactionStatusEnum.pending_edit,
    ) or (transaction_status == TransactionStatusEnum.pending_settlement and customer_type_value == CustomerTypeEnum.online)
    if transaction_status == TransactionStatusEnum.voided:
        return "voided"
    if is_pre_payment:
        return "pending"
    if transaction_id in transactions_with_outstanding_balance:
        return "partial"
    return "full"


async def list_transactions(
    db: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 20,
    transaction_status: TransactionStatusEnum | list[TransactionStatusEnum] | None = None,
    queue_status: QueueStatusEnum | None = None,
    customer_type: CustomerTypeEnum | None = None,
    customer_id: int | None = None,
    walkin_user_id: int | None = None,
    include_pending_edit: bool = False,
    processing_by_user_id: int | None = None,
    walkin_at_from: datetime | None = None,
    walkin_at_to: datetime | None = None,
    include_payment_status: bool = False,
    payment_status_filter: str | None = None,
) -> TransactionListResponse:
    filters = []
    if transaction_status is not None:
        if isinstance(transaction_status, list):
            filters.append(SalesTransaction.transaction_status.in_(transaction_status))
        else:
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

    needs_payment_status = include_payment_status or payment_status_filter is not None

    if not needs_payment_status:
        total = (
            await db.execute(select(func.count()).select_from(SalesTransaction).where(*filters))
        ).scalar_one()

        result = await db.execute(
            select(SalesTransaction)
            .where(*filters)
            .order_by(SalesTransaction.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .options(_WITH_CHILDREN, _WITH_PARENT)
            .execution_options(populate_existing=True)
        )
        items = result.scalars().all()
        responses = [_build_transaction_response(t) for t in items]
        return TransactionListResponse(total=total, items=responses)

    # payment_status is derived (not a column), so filtering/paginating by it
    # can't happen in the same LIMIT/OFFSET query above — every matching row
    # has to be evaluated first. Fine at this shop's scale (27 terminals, a
    # PostgreSQL row-count in the thousands, not millions); pulls only the
    # columns needed to compute the bucket, not full transaction + children.
    lightweight_rows = (
        await db.execute(
            select(
                SalesTransaction.id,
                SalesTransaction.transaction_status,
                SalesTransaction.customer_type,
                SalesTransaction.customer_id,
            )
            .where(*filters)
            .order_by(SalesTransaction.created_at.desc())
        )
    ).all()

    # Reuses the exact same outstanding-amount logic as the Balance tab
    # (get_outstanding_balance_entries) — not new remaining-amount math. One
    # call per unique customer across every matching row (not just the
    # current page — the bucket has to be known before pagination can slice
    # it). Each outstanding entry already carries the transaction_id it came
    # from, so per-transaction status falls out directly.
    unique_customer_ids = {row.customer_id for row in lightweight_rows}
    transactions_with_outstanding_balance: set[int] = set()
    for cid in unique_customer_ids:
        outstanding_entries = await customer_service.get_outstanding_balance_entries(db, cid)
        transactions_with_outstanding_balance.update(entry.transaction_id for entry in outstanding_entries)

    status_by_id = {
        row.id: _compute_payment_status(
            row.transaction_status, row.customer_type, row.id, transactions_with_outstanding_balance
        )
        for row in lightweight_rows
    }

    matching_ids_ordered = [row.id for row in lightweight_rows]
    if payment_status_filter is not None:
        matching_ids_ordered = [tid for tid in matching_ids_ordered if status_by_id[tid] == payment_status_filter]

    total = len(matching_ids_ordered)
    page_ids = matching_ids_ordered[(page - 1) * page_size : (page - 1) * page_size + page_size]

    if not page_ids:
        return TransactionListResponse(total=total, items=[])

    result = await db.execute(
        select(SalesTransaction)
        .where(SalesTransaction.id.in_(page_ids))
        .options(_WITH_CHILDREN, _WITH_PARENT)
        .execution_options(populate_existing=True)
    )
    items_by_id = {t.id: t for t in result.scalars().all()}
    responses = [_build_transaction_response(items_by_id[tid]) for tid in page_ids]

    if include_payment_status:
        for response in responses:
            response.payment_status = status_by_id[response.id]

    return TransactionListResponse(total=total, items=responses)


def _build_history_item(transaction: SalesTransaction) -> TransactionHistoryItem:
    payment_methods: list[str] = []
    for pd in transaction.payment_details:
        if pd.is_draft:
            continue
        name = pd.payment_method.payment_method_name
        if name not in payment_methods:
            payment_methods.append(name)

    return TransactionHistoryItem(
        id=transaction.id,
        order_number=transaction.order_number,
        transaction_type=transaction.transaction_type,
        transaction_status=transaction.transaction_status,
        customer_name=transaction.customer.full_name,
        customer_type=transaction.customer_type,
        cashier_name=transaction.payment_user.full_name if transaction.payment_user else None,
        total_due=transaction.total_due,
        payment_methods=payment_methods,
        parent_order_number=transaction.parent.order_number if transaction.parent else None,
        finished_at=transaction.updated_at,
        created_at=transaction.walkin_at or transaction.created_at,
    )


async def get_transaction_history(db: AsyncSession) -> list[TransactionHistoryItem]:
    result = await db.execute(
        select(SalesTransaction)
        .where(
            SalesTransaction.transaction_status.in_(
                [TransactionStatusEnum.completed, TransactionStatusEnum.voided]
            )
        )
        .order_by(SalesTransaction.updated_at.desc())
        .limit(100)
        .options(_WITH_PARENT)
    )
    transactions = result.scalars().all()
    return [_build_history_item(t) for t in transactions]


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
    db: AsyncSession,
    transaction_id: int,
    entries: list[DraftPaymentEntry],
    user_id: int,
    *,
    balances_to_settle: list[BalanceSettlementItem] | None = None,
    credit_entries_checked: list[int] | None = None,
) -> list[PaymentDetailResponse]:
    """Persist in-progress payment entries so they survive park/unpark cycles and reloads."""
    balances_to_settle = balances_to_settle or []
    credit_entries_checked = credit_entries_checked or []

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

        # balance/credit checkbox state is transaction-level, but drafts are
        # per-row — carried on the first row only (NULL/0 on the rest) rather than
        # adding a separate table for it. If there are no entries yet
        # (balance checked but nothing added), there's no row to carry it on
        # and this state isn't persisted — same limitation as the entries
        # themselves, which also can't survive a park with nothing typed in.
        balances_json = (
            json.dumps(
                [
                    {
                        "source_transaction_id": item.source_transaction_id,
                        "ledger_entry_id": item.ledger_entry_id,
                        "amount": str(item.amount),
                    }
                    for item in balances_to_settle
                ]
            )
            if balances_to_settle
            else None
        )
        # Checked entries can sum to more than what's owed — same cap process_payment
        # applies at actual payment time, so the draft stays consistent with what /pay
        # would do. The breakdown itself still records each checked entry's full
        # remaining amount (no partial slicing) even when the aggregate below is capped;
        # the unused remainder simply stays available as credit for a later transaction.
        total_balance_settled = sum((item.amount for item in balances_to_settle), Decimal("0"))
        total_due_before_credit = transaction.total_due + total_balance_settled
        credit_breakdown = await customer_service.get_credit_breakdown_for_entries(
            db, transaction.customer_id, credit_entries_checked
        )
        raw_credit_total = sum((item["amount"] for item in credit_breakdown), Decimal("0.00"))
        credit_applied = min(raw_credit_total, total_due_before_credit)
        credit_sources_json = (
            json.dumps([{**item, "amount": str(item["amount"])} for item in credit_breakdown])
            if credit_breakdown
            else None
        )
        # Cash/online rows the payment user typed in, plus a system-generated
        # row mirroring the applied credit — kept in the same draft table so it
        # round-trips through park/unpark exactly like the others (the frontend
        # filters this row back out by payment_method_id before restoring the
        # manual entries table, since checkbox state is already restored
        # separately from draft_credit_applied).
        rows = [
            {
                "payment_method_id": entry.payment_method_id,
                "ref_number": entry.ref_number,
                "tendered_amount": entry.tendered_amount,
                "amount": entry.amount,
            }
            for entry in entries
        ]
        if credit_applied > 0:
            rows.append(
                {
                    "payment_method_id": await _get_payment_method_id(db, "credit"),
                    "ref_number": transaction.order_number,
                    "tendered_amount": None,
                    "amount": credit_applied,
                }
            )

        drafts = [
            PaymentDetail(
                transaction_id=transaction_id,
                is_draft=True,
                draft_balances_json=balances_json if index == 0 else None,
                draft_credit_applied=credit_applied if index == 0 else Decimal("0.00"),
                draft_credit_sources_json=credit_sources_json if index == 0 else None,
                **row,
            )
            for index, row in enumerate(rows)
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

    if transaction.transaction_type == TransactionTypeEnum.balance_settlement and data.balances_to_settle:
        raise PaymentValidationError(
            "balance_settled for a balance-settlement-only transaction was already fixed at creation"
        )

    total_balance_settled = sum((item.amount for item in data.balances_to_settle), Decimal("0"))

    # Bounded against actual outstanding *_added ledger entries, not against
    # customer.net_balance's sign — net_balance is a single netted column, so
    # a customer can have outstanding balance_added AND outstanding
    # credit_added entries at the same time even though they net to one sign
    # (e.g. an old ₱100 balance offset by a ₱150 refund-credit nets to +₱50,
    # but the ₱100 balance is still individually unsettled).
    if total_balance_settled > 0:
        outstanding_balance_total = await customer_service.get_outstanding_balance_total(db, customer.id)
        if total_balance_settled > outstanding_balance_total:
            raise PaymentValidationError("balances_to_settle exceeds the customer's outstanding balance")

    # Each checked id is validated against the customer's currently outstanding
    # credit_added entries here (raises if stale/already consumed), so there's no
    # separate "exceeds available credit" check needed — an entry that's still in
    # this breakdown is by definition still outstanding.
    credit_breakdown = await customer_service.get_credit_breakdown_for_entries(
        db, customer.id, data.credit_entries_checked
    )
    raw_credit_total = sum((item["amount"] for item in credit_breakdown), Decimal("0.00"))
    total_due_before_credit = transaction.total_due + total_balance_settled
    # Checked entries can sum to more than what's owed — cap what's applied to the
    # transaction at the amount due instead of rejecting the payment; the unused
    # remainder stays as credit on the customer's account for a later transaction.
    credit_applied = min(raw_credit_total, total_due_before_credit)

    # balance/credit applied at Payment time shift the amount actually owed —
    # entries must sum to this, not the original total_due
    final_amount = total_due_before_credit - credit_applied

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
        if data.balances_to_settle:
            raise PaymentValidationError("Partial payment is not allowed when collecting a customer balance")
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

        if data.balances_to_settle:
            source_ids = {item.source_transaction_id for item in data.balances_to_settle}
            order_numbers_result = await db.execute(
                select(SalesTransaction.id, SalesTransaction.order_number).where(SalesTransaction.id.in_(source_ids))
            )
            order_numbers = dict(order_numbers_result.all())

            for item in data.balances_to_settle:
                customer.net_balance += item.amount
                source_order_number = order_numbers.get(item.source_transaction_id, item.source_transaction_id)
                db.add(
                    CustomerLedger(
                        customer_id=customer.id,
                        transaction_id=transaction.id,
                        entry_type=LedgerEntryTypeEnum.balance_settled,
                        amount=item.amount,
                        running_balance=customer.net_balance,
                        notes=f"Settled from transaction {source_order_number}",
                    )
                )
            transaction.balance_settled = total_balance_settled
            transaction.total_due += total_balance_settled

        if credit_applied > 0:
            # credit_breakdown (computed above from the explicitly checked entries)
            # always lists each entry's full remaining amount, even when credit_applied
            # itself got capped below what was checked — the note is a record of which
            # entries were selected, not a claim that every peso of them was consumed.
            credit_notes = (
                "Applied from " + ", ".join(f"{item['order_number']} (₱{item['amount']:,.2f})" for item in credit_breakdown)
                if credit_breakdown
                else f"Credit applied to {transaction.order_number}"
            )

            customer.net_balance -= credit_applied
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.credit_used,
                    amount=credit_applied,
                    running_balance=customer.net_balance,
                    notes=credit_notes,
                )
            )
            transaction.credit_applied = credit_applied
            transaction.total_due -= credit_applied

            # Record the applied credit as its own confirmed payment_detail row
            # (alongside the cash/online rows above) so the payment breakdown for
            # this transaction is complete without relying on credit_applied alone.
            db.add(
                PaymentDetail(
                    transaction_id=transaction.id,
                    payment_method_id=await _get_payment_method_id(db, "credit"),
                    ref_number=transaction.order_number,
                    amount=credit_applied,
                    is_draft=False,
                )
            )

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

        if transaction.change_given > 0 and not data.change_claimed:
            transaction.change_claimed = False
            customer.net_balance += transaction.change_given
            db.add(
                CustomerLedger(
                    customer_id=customer.id,
                    transaction_id=transaction.id,
                    entry_type=LedgerEntryTypeEnum.credit_added,
                    amount=transaction.change_given,
                    running_balance=customer.net_balance,
                    notes="Unclaimed change added as credit",
                )
            )
        else:
            transaction.change_claimed = True

        if transaction.customer_type == CustomerTypeEnum.walk_in and not skip_releasing:
            transaction.transaction_status = TransactionStatusEnum.pending_settlement
            transaction.queue_status = QueueStatusEnum.waiting
        elif transaction.customer_type == CustomerTypeEnum.online and not skip_releasing:
            # Payment succeeded for a plain online order — Releasing still owes
            # one more explicit confirmation before this is truly done (stock
            # already left the shelf at confirm_items_ready, so this is a pure
            # status handoff, not another stock decrement). Applies whether the
            # payment was full or partial — see complete_online.
            transaction.transaction_status = TransactionStatusEnum.pending_handover
            transaction.queue_status = QueueStatusEnum.waiting
        else:
            transaction.transaction_status = TransactionStatusEnum.completed
            transaction.queue_status = QueueStatusEnum.done

        # this phase's hold is over regardless of which team owns the next phase
        transaction.processing_by_user_id = None
        transaction.processing_started_at = None

        _record_status_change_audit(db, transaction, payment_user_id, old_transaction_status, old_queue_status)

        # An adjustment child reaching a terminal state here means Payment has
        # finished collecting the weight variance — the parent moves to 'settled'
        # and re-enters Releasing's active queue (as an actionable "Payment
        # Resolved" card) instead of completing outright; Releasing still has to
        # hand the item over and confirm that before stock actually leaves and
        # the transaction is truly done (see confirm_handover).
        parent: SalesTransaction | None = None
        if transaction.parent_transaction_id is not None:
            candidate = await db.get(SalesTransaction, transaction.parent_transaction_id)
            if candidate is not None and candidate.transaction_status == TransactionStatusEnum.pending_adjustment:
                parent = candidate
                parent_old_status = parent.transaction_status.value
                parent_old_queue = parent.queue_status.value
                parent.transaction_status = TransactionStatusEnum.settled
                parent.queue_status = QueueStatusEnum.waiting
                _record_status_change_audit(db, parent, payment_user_id, parent_old_status, parent_old_queue)

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

    if parent is not None:
        parent_rooms, parent_event = transaction_status_changed(
            transaction_id=parent.id,
            old_status=TransactionStatusEnum.pending_adjustment.value,
            new_status=parent.transaction_status.value,
            customer_type=parent.customer_type.value,
        )
        await manager.broadcast_multi(parent_rooms, parent_event)

    return await get_transaction(db, transaction.id)


async def _decrement_stock_online(db: AsyncSession, items: list[TransactionItem]) -> None:
    """Deducts each product item's quantity_kg from product.stock_quantity — online
    orders only. Releasing never confirms a per-item actual for online orders (see
    confirm_items_ready), so there's no actual_unit_count/actual_weight_kg to base a
    unit-based decrement on here — quantity_kg is the only weight field this flow
    ever populates.
    """
    for item in items:
        if item.item_type != ItemTypeEnum.product:
            continue
        if item.quantity_kg is None:
            continue
        product = await db.get(Product, item.product_id)
        if product is not None:
            product.stock_quantity -= item.quantity_kg


async def _decrement_stock_for_walkin_handover(db: AsyncSession, items: list[TransactionItem]) -> None:
    """Deducts each product item's handed-over quantity from product.stock_quantity —
    walk-in only (see _decrement_stock_online for the online counterpart).

    Stock moves by how many physical units Releasing counted (actual_unit_count)
    times the product's catalog per-unit weight (product.unit_weight_kg) — NOT by
    actual_quantity_kg, which drives the customer's bill (actual_subtotal/balance_due)
    and legitimately differs from the physical unit count on a substandard-kilo
    variance. Falls back to the measured actual_weight_kg only for a bulk/loose
    product with no unit_weight_kg on record, where a per-unit count has no meaning.

    Not logged to product_audit_log — that log is reserved for manual product-
    management actions (Adjust Stock modal, edits, activate/deactivate); a
    transaction fulfilling normally isn't a product-management event.
    """
    for item in items:
        if item.item_type != ItemTypeEnum.product:
            continue
        if item.actual_quantity_kg is None:
            continue
        product = await db.get(Product, item.product_id)
        if product is None:
            continue

        if product.unit_weight_kg is not None and item.actual_unit_count is not None:
            stock_decrement = item.actual_unit_count * product.unit_weight_kg
        elif item.actual_weight_kg is not None:
            stock_decrement = item.actual_weight_kg
        else:
            # Nothing to base a decrement on (no unit_weight_kg on record and no
            # actual_weight_kg entered) — same defensive skip as the None-quantity
            # guards above, rather than crashing the whole handover on one item.
            continue

        product.stock_quantity -= stock_decrement


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
            if not entry.actual_unit_count:
                raise WeightConfirmValidationError("Actual unit count is required")
            if not entry.actual_quantity_kg:
                raise WeightConfirmValidationError("Actual QTY is required")

            item.actual_weight_kg = entry.actual_weight_kg  # reference only — null is allowed
            item.actual_unit_count = entry.actual_unit_count
            item.actual_quantity_kg = entry.actual_quantity_kg
            item.actual_subtotal = (entry.actual_quantity_kg * item.unit_price).quantize(Decimal("0.01"))

        actual_amount = Decimal("0.00")
        for item in transaction.items:
            if item.item_type == ItemTypeEnum.product:
                if item.actual_quantity_kg is None:
                    raise WeightConfirmValidationError(f"transaction_item {item.id} is missing actual_quantity_kg")
                actual_amount += item.actual_subtotal

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

        # Items are handed over to the customer right now (online has no
        # separate handover step) — decrement using quantity_kg, the only
        # weight field Releasing ever populates for this flow.
        await _decrement_stock_online(db, transaction.items)

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
    if balance_due == 0:
        # Exact weight has no variance to send to Payment — that case is
        # handled entirely by /complete-exact instead, so items stay editable
        # and nothing auto-completes just because they happen to match.
        raise SubstandardValidationError(
            f"transaction {transaction_id} has no weight variance — use /complete-exact instead"
        )

    old_status = transaction.transaction_status.value
    old_queue = transaction.queue_status.value
    child: SalesTransaction | None = None

    try:
        if balance_due > 0:
            child = await _create_adjustment_child(
                db, transaction, TransactionTypeEnum.adjustment, balance_due, releasing_user_id
            )
            transaction.transaction_status = TransactionStatusEnum.pending_adjustment
            transaction.queue_status = QueueStatusEnum.done
        else:  # balance_due < 0 — store owes the customer
            child = await _create_adjustment_child(
                db, transaction, TransactionTypeEnum.refund, -balance_due, releasing_user_id
            )
            transaction.transaction_status = TransactionStatusEnum.pending_adjustment
            transaction.queue_status = QueueStatusEnum.done

        transaction.processing_by_user_id = None
        transaction.processing_started_at = None
        _record_status_change_audit(db, transaction, releasing_user_id, old_status, old_queue)

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    # The parent's own status change (releasing-queue loses it, or keeps a
    # read-only pending_adjustment card) and the new child's arrival (payment-queue)
    # land in different rooms — both need their own broadcast.
    rooms, event = transaction_status_changed(
        transaction_id=transaction.id,
        old_status=old_status,
        new_status=transaction.transaction_status.value,
        customer_type=transaction.customer_type.value,
    )
    await manager.broadcast_multi(rooms, event)

    if child is not None:
        child_rooms, child_event = transaction_status_changed(
            transaction_id=child.id,
            old_status=None,
            new_status=child.transaction_status.value,
            customer_type=child.customer_type.value,
        )
        await manager.broadcast_multi(child_rooms, child_event)

    return await get_transaction(db, transaction.id)


async def complete_exact(db: AsyncSession, transaction_id: int, releasing_user_id: int) -> TransactionResponse:
    """Walk-in exact-weight completion — the standard-flow counterpart to the
    substandard flow's confirm_handover. Distinct precondition (pending_settlement,
    not settled) and distinct trigger (Releasing's own button, not Payment's
    resolution), so it's kept as its own endpoint rather than merged with it."""
    transaction = await _get_transaction_for_update(db, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_settlement:
        raise QueueConflictError(f"transaction {transaction_id} is not pending settlement")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise QueueConflictError(f"transaction {transaction_id} has not been grabbed for releasing")
    if transaction.processing_by_user_id != releasing_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    product_items = [item for item in transaction.items if item.item_type == ItemTypeEnum.product]
    # actual_quantity_kg (not actual_weight_kg, which is optional/reference-only —
    # see schema.sql) is what confirm_weight requires and what actual_subtotal is
    # derived from, so it's the authoritative "has this item been confirmed" signal.
    if not product_items or any(item.actual_quantity_kg is None for item in product_items):
        raise WeightConfirmValidationError("All items must have a confirmed actual QTY before completing")

    # Recomputed from the item rows rather than trusting transaction.actual_amount/
    # balance_due — never trust a cached value for a completion gate.
    actual_amount = sum((item.actual_subtotal for item in product_items), Decimal("0.00"))
    if actual_amount - transaction.estimated_amount != 0:
        raise SubstandardValidationError(
            f"transaction {transaction_id} has a weight variance — use /resolve to send it to Payment instead"
        )

    old_status = transaction.transaction_status.value
    old_queue = transaction.queue_status.value

    try:
        # Item is handed to the customer right now — this is where stock
        # actually leaves for the standard exact-weight flow.
        await _decrement_stock_for_walkin_handover(db, transaction.items)

        transaction.actual_amount = actual_amount
        transaction.transaction_status = TransactionStatusEnum.completed
        transaction.queue_status = QueueStatusEnum.done
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


async def resolve_refund_as_credit(
    db: AsyncSession, transaction_id: int, resolved_by_user_id: int
) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None or transaction.transaction_type != TransactionTypeEnum.refund:
        raise ValueError(f"Transaction {transaction_id} is not a refund")
    if transaction.transaction_status != TransactionStatusEnum.pending_payment:
        raise QueueConflictError(f"transaction {transaction_id} is not pending payment")
    if transaction.queue_status != QueueStatusEnum.processing:
        raise QueueConflictError(f"transaction {transaction_id} has not been grabbed for payment")
    if transaction.processing_by_user_id != resolved_by_user_id:
        raise QueuePermissionError(f"transaction {transaction_id} is not being processed by this user")

    customer = await db.get(Customer, transaction.customer_id)
    amount = transaction.total_due  # already positive — the store-owes amount

    parent: SalesTransaction | None = None
    if transaction.parent_transaction_id is not None:
        parent = await db.get(SalesTransaction, transaction.parent_transaction_id)

    old_status = transaction.transaction_status.value
    old_queue = transaction.queue_status.value
    parent_settled = False

    try:
        customer.net_balance += amount
        db.add(
            CustomerLedger(
                customer_id=customer.id,
                transaction_id=transaction.id,
                entry_type=LedgerEntryTypeEnum.credit_added,
                amount=amount,
                running_balance=customer.net_balance,
                notes=f"Credit from weight variance — {parent.order_number if parent else transaction.order_number}",
            )
        )

        transaction.transaction_status = TransactionStatusEnum.completed
        transaction.queue_status = QueueStatusEnum.done
        transaction.processing_by_user_id = None
        transaction.processing_started_at = None

        _record_status_change_audit(db, transaction, resolved_by_user_id, old_status, old_queue)

        # Releasing still holds a read-only pending_adjustment card for the parent
        # until Payment resolves this child — same handoff process_payment already
        # does for the adjustment side. It moves to 'settled' (not 'completed')
        # so Releasing gets one more actionable step to confirm the handover
        # before stock actually leaves (see confirm_handover).
        if parent is not None and parent.transaction_status == TransactionStatusEnum.pending_adjustment:
            parent_old_status = parent.transaction_status.value
            parent_old_queue = parent.queue_status.value
            parent.transaction_status = TransactionStatusEnum.settled
            parent.queue_status = QueueStatusEnum.waiting
            _record_status_change_audit(db, parent, resolved_by_user_id, parent_old_status, parent_old_queue)
            parent_settled = True

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

    if parent_settled:
        parent_rooms, parent_event = transaction_status_changed(
            transaction_id=parent.id,
            old_status=TransactionStatusEnum.pending_adjustment.value,
            new_status=parent.transaction_status.value,
            customer_type=parent.customer_type.value,
        )
        await manager.broadcast_multi(parent_rooms, parent_event)

    return await get_transaction(db, transaction.id)


async def return_to_receiver(db: AsyncSession, transaction_id: int, payment_user_id: int) -> TransactionResponse:
    transaction = await db.get(SalesTransaction, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.customer_type != CustomerTypeEnum.walk_in:
        raise TransactionEditFlowError("Online orders cannot be returned to Receiver")
    if transaction.transaction_type != TransactionTypeEnum.original or transaction.parent_transaction_id is not None:
        raise TransactionEditFlowError("Only original transactions can be returned to Receiver")
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


async def _get_adjustment_child(db: AsyncSession, parent_id: int) -> SalesTransaction:
    # resolve_substandard creates at most one adjustment/refund child per parent
    # (see _create_adjustment_child) — order_by/limit here is defensive, not a
    # real disambiguation need.
    result = await db.execute(
        select(SalesTransaction)
        .where(
            SalesTransaction.parent_transaction_id == parent_id,
            SalesTransaction.transaction_type.in_([TransactionTypeEnum.adjustment, TransactionTypeEnum.refund]),
        )
        .order_by(SalesTransaction.id.desc())
    )
    child = result.scalars().first()
    if child is None:
        raise ValueError(f"transaction {parent_id} has no adjustment/refund child")
    return child


async def get_handover_outcome(db: AsyncSession, transaction_id: int) -> HandoverOutcomeResponse:
    parent = await db.get(SalesTransaction, transaction_id)
    if parent is None:
        raise ValueError(f"Transaction {transaction_id} not found")
    if parent.transaction_status != TransactionStatusEnum.settled:
        raise QueueConflictError(f"transaction {transaction_id} is not settled")

    child = await _get_adjustment_child(db, parent.id)

    amount_paid = (
        await db.execute(
            select(func.coalesce(func.sum(PaymentDetail.amount), Decimal("0.00"))).where(
                PaymentDetail.transaction_id == child.id, PaymentDetail.is_draft.is_(False)
            )
        )
    ).scalar_one()
    remaining_balance_added = (
        await db.execute(
            select(func.coalesce(func.sum(CustomerLedger.amount), Decimal("0.00"))).where(
                CustomerLedger.transaction_id == child.id,
                CustomerLedger.entry_type == LedgerEntryTypeEnum.balance_added,
            )
        )
    ).scalar_one()
    credit_added = (
        await db.execute(
            select(func.coalesce(func.sum(CustomerLedger.amount), Decimal("0.00"))).where(
                CustomerLedger.transaction_id == child.id,
                CustomerLedger.entry_type == LedgerEntryTypeEnum.credit_added,
            )
        )
    ).scalar_one()

    return HandoverOutcomeResponse(
        child_transaction_id=child.id,
        child_transaction_type=child.transaction_type,
        child_total_due=child.total_due,
        amount_paid=amount_paid,
        remaining_balance_added=remaining_balance_added,
        credit_added=credit_added,
    )


async def confirm_handover(db: AsyncSession, transaction_id: int, releasing_user_id: int) -> TransactionResponse:
    transaction = await _get_transaction_for_update(db, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.settled:
        raise QueueConflictError(f"transaction {transaction_id} is not settled")

    old_status = transaction.transaction_status.value
    old_queue = transaction.queue_status.value

    try:
        # Item is handed to the customer right now — this is where stock
        # actually leaves for the substandard-kilo flow (see PROJECT_CONTEXT.md).
        # Parent's own items carry the confirmed weights; the adjustment/refund
        # child has none of its own (see resolve_substandard).
        await _decrement_stock_for_walkin_handover(db, transaction.items)

        transaction.transaction_status = TransactionStatusEnum.completed
        transaction.queue_status = QueueStatusEnum.done
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


async def complete_online(db: AsyncSession, transaction_id: int, releasing_user_id: int) -> TransactionResponse:
    """Releasing's final confirmation for a plain online order once Payment has
    collected payment — the online counterpart to confirm_handover, but for the
    ordinary 'original' flow rather than a substandard adjustment/refund
    resolution. Stock already left at confirm_items_ready, so this is a pure
    status transition — no second stock_quantity decrement here."""
    transaction = await _get_transaction_for_update(db, transaction_id)
    if transaction is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    if transaction.transaction_status != TransactionStatusEnum.pending_handover:
        raise QueueConflictError(f"transaction {transaction_id} is not pending handover")

    old_status = transaction.transaction_status.value
    old_queue = transaction.queue_status.value

    try:
        transaction.transaction_status = TransactionStatusEnum.completed
        transaction.queue_status = QueueStatusEnum.done
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
