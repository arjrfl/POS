from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.models.ledger import CustomerLedger
from app.models.product import Product
from app.models.transaction import (
    ItemTypeEnum,
    PaymentDetail,
    PaymentMethod,
    SalesTransaction,
    TransactionItem,
    TransactionStatusEnum,
    TransactionTypeEnum,
)
from app.models.user import Role, User
from app.schemas.admin import DashboardSummary, PaymentUserSales, TopProductRevenue
from app.schemas.customer import CustomerBalanceEntryResponse
from app.services import customer_service

router = APIRouter(prefix="/api/admin", tags=["admin"])

# All 27 terminals and the business itself are Philippines-based — every
# "today" boundary on this dashboard is a Manila calendar day, not a UTC one
# (Postgres/Python otherwise default to UTC, which rolls "today" over up to
# 8 hours off actual local midnight).
MANILA_TZ = ZoneInfo("Asia/Manila")


def _resolve_date_range(from_date: date | None, to_date: date | None):
    """Validates and resolves an optional from_date/to_date pair.

    Returns None when both are absent (caller keeps its current "today"/live
    behavior). Returns (range_start, range_end, range_applied) when both are
    present — range_end is exclusive (midnight the day after to_date), so a
    half-open >= start / < end comparison covers the whole of to_date. Bounds
    are anchored to Manila midnight, not UTC midnight — see MANILA_TZ.
    """
    if (from_date is None) != (to_date is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_date and to_date must be provided together",
        )
    if from_date is None:
        return None
    if from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="from_date must be before or equal to to_date",
        )

    range_start = datetime.combine(from_date, time.min, tzinfo=MANILA_TZ)
    range_end = datetime.combine(to_date, time.min, tzinfo=MANILA_TZ) + timedelta(days=1)
    range_applied = {"from": from_date.isoformat(), "to": to_date.isoformat()}
    return range_start, range_end, range_applied


async def _compute_all_time_range(db: AsyncSession):
    """Resolves all_time=true to (earliest known activity date) through today.

    Earliest activity is the lesser of MIN(sales_transaction.created_at) and
    MIN(customer_ledger.created_at) — whichever table has rows. Falls back to
    today/today when both tables are empty, so a fresh database still returns
    a valid (non-null) range instead of erroring. Both ends are resolved as
    Manila calendar dates (see MANILA_TZ) — the earliest timestamp is an
    absolute instant regardless of stored tzinfo, but which calendar date it
    falls on depends on the zone it's viewed in.
    """
    min_txn = (await db.execute(select(func.min(SalesTransaction.created_at)))).scalar_one()
    min_ledger = (await db.execute(select(func.min(CustomerLedger.created_at)))).scalar_one()

    candidates = [value for value in (min_txn, min_ledger) if value is not None]
    earliest = min(candidates) if candidates else datetime.now(timezone.utc)

    from_date = earliest.astimezone(MANILA_TZ).date()
    to_date = datetime.now(MANILA_TZ).date()

    range_start = datetime.combine(from_date, time.min, tzinfo=MANILA_TZ)
    range_end = datetime.combine(to_date, time.min, tzinfo=MANILA_TZ) + timedelta(days=1)
    range_applied = {"from": from_date.isoformat(), "to": to_date.isoformat()}
    return range_start, range_end, range_applied


def _default_today_range():
    """The implicit "today" window when no explicit from_date/to_date/all_time
    was requested — Manila's current calendar day, not UTC's (see MANILA_TZ)."""
    today = datetime.now(MANILA_TZ).date()
    start = datetime.combine(today, time.min, tzinfo=MANILA_TZ)
    return start, start + timedelta(days=1)


async def _sum_outstanding_by_origin_payment_at(
    db: AsyncSession,
    entries: list[CustomerBalanceEntryResponse],
    range_start: datetime,
    range_end: datetime,
) -> Decimal:
    """Nets FIFO-outstanding ledger entries (see customer_service._get_outstanding_
    entries) down to just the ones whose ORIGINATING transaction's payment_at falls
    in range — payment_at is the shared date basis for every "Today" metric on this
    dashboard (see CLAUDE.md), not the ledger row's own created_at, which is what a
    prior version of this endpoint used and made this card disagree with the others.
    """
    if not entries:
        return Decimal("0")
    origin_txn_ids = {entry.transaction_id for entry in entries}
    origin_payment_at_stmt = select(SalesTransaction.id, SalesTransaction.payment_at).where(
        SalesTransaction.id.in_(origin_txn_ids)
    )
    origin_payment_at_by_id = dict((await db.execute(origin_payment_at_stmt)).all())
    return sum(
        (
            entry.amount
            for entry in entries
            if origin_payment_at_by_id.get(entry.transaction_id) is not None
            and range_start <= origin_payment_at_by_id[entry.transaction_id] < range_end
        ),
        Decimal("0"),
    )


@router.get("/dashboard/summary", dependencies=[Depends(require_role("admin"))])
async def get_dashboard_summary(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    all_time: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    # PART 1 DIAGNOSIS (kept here for traceability — do not reintroduce):
    #   - Transactions Today filtered SalesTransaction.created_at (Receiver's
    #     creation time) and gated on transaction_status == 'completed'.
    #   - Total Sales Today already filtered payment_at (the right column) but
    #     also gated on transaction_status == 'completed'.
    #   - Actual Sales Today filtered PaymentDetail.created_at, not the parent
    #     transaction's payment_at, and had no status gate.
    #   - Total Unpaid Transaction Today (from a prior fix) netted correctly
    #     but filtered on the ORIGINATING transaction's created_at, not
    #     payment_at.
    #   - Total Unused Credit Today filtered CustomerLedger.created_at with NO
    #     netting against credit_used/credit_auto_used consumption at all —
    #     the same un-netted-sum bug Total Unpaid Transaction Today had.
    #   - The 'completed' gate on the first two meant a transaction Payment
    #     fully (or partially) processed today but that hasn't finished
    #     Releasing yet (walk_in always lands on pending_settlement/
    #     pending_handover after /pay, never 'completed' — see CLAUDE.md)
    #     was invisible to those two cards while still counted by the
    #     ungated Actual Sales / Unpaid cards — the four numbers described
    #     four different populations of "today's transactions".
    #   - Every boundary above was computed in UTC (Python timezone.utc /
    #     Postgres func.current_date(), which defaults to the DB session's
    #     timezone — UTC, per docker-compose.yml having no TimeZone override)
    #     instead of Asia/Manila, so "today" could flip up to 8 hours off
    #     actual Philippine wall-clock midnight.
    #
    # Fix: every metric below shares one (effective_start, effective_end)
    # Manila-anchored window and filters on payment_at (or, for the two
    # ledger-derived cards, the ORIGINATING transaction's payment_at) — see
    # MANILA_TZ / _default_today_range. None of them gate on
    # transaction_status == 'completed' anymore; a partially-paid transaction
    # still awaiting Releasing has already been processed by Payment today
    # and must count.
    resolved_range = await _compute_all_time_range(db) if all_time else _resolve_date_range(from_date, to_date)

    if resolved_range is not None:
        effective_start, effective_end, range_applied = resolved_range
    else:
        range_applied = None
        effective_start, effective_end = _default_today_range()

    transactions_count_stmt = select(func.count()).select_from(SalesTransaction).where(
        SalesTransaction.payment_at >= effective_start,
        SalesTransaction.payment_at < effective_end,
        SalesTransaction.transaction_type != TransactionTypeEnum.refund,
    )
    transactions_today = (await db.execute(transactions_count_stmt)).scalar_one()

    # total_due already nets credit_applied. Restricted to original/adjustment
    # only: balance_settlement's total_due re-collects value already counted in
    # the original transaction's total_due, so including both would double-count
    # the same sale (refund is excluded too, structurally, by not being in this
    # allowlist).
    sales_stmt = select(func.coalesce(func.sum(SalesTransaction.total_due), 0)).where(
        SalesTransaction.payment_at >= effective_start,
        SalesTransaction.payment_at < effective_end,
        SalesTransaction.transaction_type.in_([TransactionTypeEnum.original, TransactionTypeEnum.adjustment]),
        # A voided transaction keeps its payment_at (voiding never clears it —
        # see void_transaction/_auto_void_transaction), so without this it would
        # still count toward a sale that no longer exists.
        SalesTransaction.transaction_status != TransactionStatusEnum.voided,
    )
    total_sales_today = (await db.execute(sales_stmt)).scalar_one()

    # Sums actual confirmed payment amounts recorded today, excluding credit-method
    # rows (credit application is not fresh cash — it's a redemption of previously-
    # issued store credit, already netted into total_due). Naturally reflects partial
    # payments correctly — only the amount actually collected counts, not the full
    # total_due. Joined to the parent transaction for payment_at (not
    # PaymentDetail.created_at) so this shares the exact same "today" as every
    # other card; refund excluded explicitly even though refund transactions
    # never produce a payment_detail row (already excluded structurally).
    actual_sales_stmt = (
        select(func.coalesce(func.sum(PaymentDetail.amount), 0))
        .join(SalesTransaction, SalesTransaction.id == PaymentDetail.transaction_id)
        .join(PaymentMethod, PaymentMethod.id == PaymentDetail.payment_method_id)
        .where(
            PaymentDetail.is_draft.is_(False),
            PaymentMethod.payment_method_name != "credit",
            SalesTransaction.payment_at >= effective_start,
            SalesTransaction.payment_at < effective_end,
            SalesTransaction.transaction_type != TransactionTypeEnum.refund,
        )
    )
    actual_sales_today = (await db.execute(actual_sales_stmt)).scalar_one()

    # Total Unpaid Transaction Today: net FIFO-outstanding balance_added entries
    # (see customer_service._get_outstanding_entries) down to just the ones whose
    # ORIGINATING transaction's payment_at falls in this window — recomputed fresh
    # on every request, never cached/frozen at creation-time, so a settlement made
    # today against an entry from yesterday (or any prior day) is reflected
    # immediately, and a same-day settlement removes it from today's figure too.
    outstanding_balance_entries = await customer_service.get_all_outstanding_balance_entries(db)
    total_unpaid_balance = await _sum_outstanding_by_origin_payment_at(
        db, outstanding_balance_entries, effective_start, effective_end
    )

    # Total Unused Credit Today: same FIFO-netting treatment (against
    # credit_used/credit_auto_used) as balance above — a credit_added entry that
    # has since been spent must not still count as "unused".
    outstanding_credit_entries = await customer_service.get_all_outstanding_credit_entries(db)
    total_unused_credit = await _sum_outstanding_by_origin_payment_at(
        db, outstanding_credit_entries, effective_start, effective_end
    )

    return {
        "data": DashboardSummary(
            transactions_today=transactions_today,
            total_unpaid_balance=Decimal(total_unpaid_balance),
            total_sales_today=Decimal(total_sales_today),
            actual_sales_today=Decimal(actual_sales_today),
            total_unused_credit=Decimal(total_unused_credit),
            range_applied=range_applied,
        ),
        "error": None,
    }


@router.get("/dashboard/top-products", dependencies=[Depends(require_role("admin"))])
async def get_top_products(db: AsyncSession = Depends(get_db)):
    total_revenue = func.sum(TransactionItem.subtotal)

    stmt = (
        select(
            Product.id.label("product_id"),
            Product.product_name.label("product_name"),
            total_revenue.label("total_revenue"),
        )
        .join(SalesTransaction, TransactionItem.transaction_id == SalesTransaction.id)
        .join(Product, TransactionItem.product_id == Product.id)
        .where(TransactionItem.item_type == ItemTypeEnum.product)
        .where(SalesTransaction.transaction_status == TransactionStatusEnum.completed)
        .where(SalesTransaction.transaction_status != TransactionStatusEnum.voided)
        .where(func.date_trunc("month", SalesTransaction.created_at) == func.date_trunc("month", func.now()))
        .group_by(Product.id, Product.product_name)
        .order_by(total_revenue.desc())
        .limit(10)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return {
        "data": [
            TopProductRevenue(product_id=row.product_id, product_name=row.product_name, total_revenue=row.total_revenue)
            for row in rows
        ],
        "error": None,
    }


@router.get("/dashboard/payment-user-sales", dependencies=[Depends(require_role("admin"))])
async def get_payment_user_sales(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    all_time: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    resolved_range = await _compute_all_time_range(db) if all_time else _resolve_date_range(from_date, to_date)

    if resolved_range is not None:
        range_start, range_end, _range_applied = resolved_range
    else:
        # Same Manila-anchored "today" boundary as Total Sales Today (see
        # get_dashboard_summary above / MANILA_TZ) — this table must describe the
        # exact same population of transactions as the top cards.
        range_start, range_end = _default_today_range()

    def _payment_at_filters():
        return [SalesTransaction.payment_at >= range_start, SalesTransaction.payment_at < range_end]

    # Three separate per-user subqueries (rather than one multi-condition LEFT JOIN)
    # so each metric's own filter conditions don't fan out / double-count against
    # the others when joined together. unpaid_amount is computed separately below
    # (it needs FIFO netting, not a plain SUM — see _sum_outstanding_by_origin_
    # payment_at) rather than as a fourth subquery here.

    # total_sales — same rule as Total Sales Today: original/adjustment only, no
    # status gate (a partially-paid transaction still awaiting Releasing has
    # already been processed by Payment today and must count), total_due already
    # nets credit_applied. balance_settlement is excluded here specifically: its
    # total_due re-collects value already counted in the original transaction's
    # total_due, so including both would double-count the same sale.
    sales_subq = (
        select(
            SalesTransaction.payment_user_id.label("payment_user_id"),
            func.coalesce(func.sum(SalesTransaction.total_due), 0).label("total_sales"),
        )
        .where(
            SalesTransaction.transaction_type.in_([TransactionTypeEnum.original, TransactionTypeEnum.adjustment]),
            *_payment_at_filters(),
        )
        .group_by(SalesTransaction.payment_user_id)
        .subquery()
    )

    # transactions_processed — any transaction_type counts (including refund and
    # balance_settlement), only voided is excluded. Deliberately a different
    # population than Transactions Today (which excludes refund) — this column
    # measures a payment user's total workload, not "sales" specifically.
    processed_subq = (
        select(
            SalesTransaction.payment_user_id.label("payment_user_id"),
            func.count().label("transactions_processed"),
        )
        .where(
            SalesTransaction.transaction_status != TransactionStatusEnum.voided,
            *_payment_at_filters(),
        )
        .group_by(SalesTransaction.payment_user_id)
        .subquery()
    )

    # actual_total_sales — same source as the Actual Sales Today card: confirmed
    # (is_draft=False), non-credit payment_detail rows. NOT SalesTransaction.
    # actual_amount (Releasing's weight-confirmed figure, a different number
    # entirely) — that mismatch is why this table used to disagree with the top
    # card's total.
    actual_subq = (
        select(
            SalesTransaction.payment_user_id.label("payment_user_id"),
            func.coalesce(func.sum(PaymentDetail.amount), 0).label("actual_total_sales"),
        )
        .join(SalesTransaction, SalesTransaction.id == PaymentDetail.transaction_id)
        .join(PaymentMethod, PaymentMethod.id == PaymentDetail.payment_method_id)
        .where(
            PaymentDetail.is_draft.is_(False),
            PaymentMethod.payment_method_name != "credit",
            SalesTransaction.transaction_type != TransactionTypeEnum.refund,
            *_payment_at_filters(),
        )
        .group_by(SalesTransaction.payment_user_id)
        .subquery()
    )

    total_sales_col = func.coalesce(sales_subq.c.total_sales, 0)

    stmt = (
        select(
            User.id.label("user_id"),
            User.full_name.label("full_name"),
            User.username.label("username"),
            total_sales_col.label("total_sales"),
            func.coalesce(processed_subq.c.transactions_processed, 0).label("transactions_processed"),
            func.coalesce(actual_subq.c.actual_total_sales, 0).label("actual_total_sales"),
        )
        .join(Role, Role.id == User.role_id)
        .outerjoin(sales_subq, sales_subq.c.payment_user_id == User.id)
        .outerjoin(processed_subq, processed_subq.c.payment_user_id == User.id)
        .outerjoin(actual_subq, actual_subq.c.payment_user_id == User.id)
        .where(Role.role_name == "payment", User.is_active.is_(True))
        .order_by(total_sales_col.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    # unpaid_amount — same netted FIFO-outstanding balance as Total Unpaid
    # Transaction Today (see get_dashboard_summary), grouped by which payment user
    # processed each ORIGINATING transaction and filtered on that transaction's
    # payment_at — so summing this column across every row reproduces the top
    # card's total exactly, instead of the raw un-netted SUM(balance_added) this
    # used to be.
    outstanding_balance_entries = await customer_service.get_all_outstanding_balance_entries(db)
    unpaid_by_user: dict[int, Decimal] = {}
    if outstanding_balance_entries:
        origin_txn_ids = {entry.transaction_id for entry in outstanding_balance_entries}
        origin_stmt = select(
            SalesTransaction.id, SalesTransaction.payment_user_id, SalesTransaction.payment_at
        ).where(SalesTransaction.id.in_(origin_txn_ids))
        origin_by_id = {row.id: row for row in (await db.execute(origin_stmt)).all()}
        for entry in outstanding_balance_entries:
            origin = origin_by_id.get(entry.transaction_id)
            if origin is None or origin.payment_user_id is None or origin.payment_at is None:
                continue
            if not (range_start <= origin.payment_at < range_end):
                continue
            unpaid_by_user[origin.payment_user_id] = (
                unpaid_by_user.get(origin.payment_user_id, Decimal("0")) + entry.amount
            )

    return {
        "data": [
            PaymentUserSales(
                user_id=row.user_id,
                full_name=row.full_name,
                username=row.username,
                total_sales=row.total_sales,
                transactions_processed=row.transactions_processed,
                actual_total_sales=row.actual_total_sales,
                unpaid_amount=unpaid_by_user.get(row.user_id, Decimal("0")),
            )
            for row in rows
        ],
        "error": None,
    }
