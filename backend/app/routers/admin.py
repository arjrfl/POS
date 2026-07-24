from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.models.ledger import CustomerLedger, LedgerEntryTypeEnum
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

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _resolve_date_range(from_date: date | None, to_date: date | None):
    """Validates and resolves an optional from_date/to_date pair.

    Returns None when both are absent (caller keeps its current "today"/live
    behavior). Returns (range_start, range_end, range_applied) when both are
    present — range_end is exclusive (midnight the day after to_date), so a
    half-open >= start / < end comparison covers the whole of to_date.
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

    range_start = datetime.combine(from_date, time.min, tzinfo=timezone.utc)
    range_end = datetime.combine(to_date, time.min, tzinfo=timezone.utc) + timedelta(days=1)
    range_applied = {"from": from_date.isoformat(), "to": to_date.isoformat()}
    return range_start, range_end, range_applied


async def _compute_all_time_range(db: AsyncSession):
    """Resolves all_time=true to (earliest known activity date) through today.

    Earliest activity is the lesser of MIN(sales_transaction.created_at) and
    MIN(customer_ledger.created_at) — whichever table has rows. Falls back to
    today/today when both tables are empty, so a fresh database still returns
    a valid (non-null) range instead of erroring.
    """
    min_txn = (await db.execute(select(func.min(SalesTransaction.created_at)))).scalar_one()
    min_ledger = (await db.execute(select(func.min(CustomerLedger.created_at)))).scalar_one()

    candidates = [value for value in (min_txn, min_ledger) if value is not None]
    earliest = min(candidates) if candidates else datetime.now(timezone.utc)

    from_date = earliest.date()
    to_date = datetime.now(timezone.utc).date()

    range_start = datetime.combine(from_date, time.min, tzinfo=timezone.utc)
    range_end = datetime.combine(to_date, time.min, tzinfo=timezone.utc) + timedelta(days=1)
    range_applied = {"from": from_date.isoformat(), "to": to_date.isoformat()}
    return range_start, range_end, range_applied


@router.get("/dashboard/summary", dependencies=[Depends(require_role("admin"))])
async def get_dashboard_summary(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    all_time: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    resolved_range = await _compute_all_time_range(db) if all_time else _resolve_date_range(from_date, to_date)

    if resolved_range is not None:
        range_start, range_end, range_applied = resolved_range

        transactions_count_stmt = select(func.count()).select_from(SalesTransaction).where(
            SalesTransaction.transaction_status == TransactionStatusEnum.completed,
            SalesTransaction.created_at >= range_start,
            SalesTransaction.created_at < range_end,
        )
        transactions_today = (await db.execute(transactions_count_stmt)).scalar_one()

        # total_due already nets credit_applied; refund-type excluded per CLAUDE.md
        # locked rule — resolve-as-credit produces no payment_detail row.
        sales_stmt = select(func.coalesce(func.sum(SalesTransaction.total_due), 0)).where(
            SalesTransaction.transaction_status == TransactionStatusEnum.completed,
            SalesTransaction.payment_at >= range_start,
            SalesTransaction.payment_at < range_end,
            SalesTransaction.transaction_type != TransactionTypeEnum.refund,
        )
        total_sales_today = (await db.execute(sales_stmt)).scalar_one()

        actual_sales_stmt = (
            select(func.coalesce(func.sum(PaymentDetail.amount), 0))
            .join(PaymentMethod, PaymentMethod.id == PaymentDetail.payment_method_id)
            .where(
                PaymentDetail.is_draft.is_(False),
                PaymentMethod.payment_method_name != "credit",
                PaymentDetail.created_at >= range_start,
                PaymentDetail.created_at < range_end,
            )
        )
        actual_sales_today = (await db.execute(actual_sales_stmt)).scalar_one()

        effective_start, effective_end = range_start, range_end
    else:
        range_applied = None

        transactions_count_stmt = select(func.count()).select_from(SalesTransaction).where(
            SalesTransaction.transaction_status == TransactionStatusEnum.completed,
            func.date(SalesTransaction.created_at) == func.current_date(),
        )
        transactions_today = (await db.execute(transactions_count_stmt)).scalar_one()

        # total_due already nets credit_applied; refund-type excluded per CLAUDE.md
        # locked rule — resolve-as-credit produces no payment_detail row.
        sales_stmt = select(func.coalesce(func.sum(SalesTransaction.total_due), 0)).where(
            SalesTransaction.transaction_status == TransactionStatusEnum.completed,
            func.date(SalesTransaction.payment_at) == func.current_date(),
            SalesTransaction.transaction_type != TransactionTypeEnum.refund,
        )
        total_sales_today = (await db.execute(sales_stmt)).scalar_one()

        # Sums actual confirmed payment amounts recorded today, excluding credit-method
        # rows (credit application is not fresh cash — it's a redemption of previously-
        # issued store credit, already netted into total_due). Naturally reflects partial
        # payments correctly — only the amount actually collected counts, not the full
        # total_due.
        actual_sales_stmt = (
            select(func.coalesce(func.sum(PaymentDetail.amount), 0))
            .join(PaymentMethod, PaymentMethod.id == PaymentDetail.payment_method_id)
            .where(
                PaymentDetail.is_draft.is_(False),
                PaymentMethod.payment_method_name != "credit",
                func.date(PaymentDetail.created_at) == func.current_date(),
            )
        )
        actual_sales_today = (await db.execute(actual_sales_stmt)).scalar_one()

        # effective_from/effective_to default to today — no from_date/to_date was
        # passed by the client, so range_applied above stays None (that field only
        # reflects an explicit client-supplied range), but the ledger sums below
        # still need concrete bounds to query against.
        today = datetime.now(timezone.utc).date()
        effective_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
        effective_end = effective_start + timedelta(days=1)

    # Single ledger-sum code path for both cards regardless of whether a range was
    # explicitly applied — no live customer.net_balance snapshot fallback.
    unpaid_stmt = select(func.coalesce(func.sum(CustomerLedger.amount), 0)).where(
        CustomerLedger.entry_type == LedgerEntryTypeEnum.balance_added,
        CustomerLedger.created_at >= effective_start,
        CustomerLedger.created_at < effective_end,
    )
    total_unpaid_balance = (await db.execute(unpaid_stmt)).scalar_one()

    unused_credit_stmt = select(func.coalesce(func.sum(CustomerLedger.amount), 0)).where(
        CustomerLedger.entry_type == LedgerEntryTypeEnum.credit_added,
        CustomerLedger.created_at >= effective_start,
        CustomerLedger.created_at < effective_end,
    )
    total_unused_credit = (await db.execute(unused_credit_stmt)).scalar_one()

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

        def _payment_at_filters():
            return [SalesTransaction.payment_at >= range_start, SalesTransaction.payment_at < range_end]
    else:
        # Same "today" boundary as Total Sales Today (see get_dashboard_summary above).
        def _payment_at_filters():
            return [func.date(SalesTransaction.payment_at) == func.current_date()]

    # Four separate per-user subqueries (rather than one multi-condition LEFT JOIN)
    # so each metric's own filter conditions don't fan out / double-count against
    # the others when joined together.

    # total_sales — same rule as Total Sales Today: completed only, refund excluded,
    # total_due already nets credit_applied.
    sales_subq = (
        select(
            SalesTransaction.payment_user_id.label("payment_user_id"),
            func.coalesce(func.sum(SalesTransaction.total_due), 0).label("total_sales"),
        )
        .where(
            SalesTransaction.transaction_status == TransactionStatusEnum.completed,
            SalesTransaction.transaction_type != TransactionTypeEnum.refund,
            *_payment_at_filters(),
        )
        .group_by(SalesTransaction.payment_user_id)
        .subquery()
    )

    # transactions_processed — any transaction_type counts (including refund and
    # balance_settlement), only voided is excluded.
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

    # actual_total_sales — refund excluded per the same locked rule as every other
    # sales aggregate on this dashboard (resolve-as-credit produces no cash).
    actual_subq = (
        select(
            SalesTransaction.payment_user_id.label("payment_user_id"),
            func.coalesce(func.sum(SalesTransaction.actual_amount), 0).label("actual_total_sales"),
        )
        .where(
            SalesTransaction.transaction_type != TransactionTypeEnum.refund,
            *_payment_at_filters(),
        )
        .group_by(SalesTransaction.payment_user_id)
        .subquery()
    )

    # unpaid_transactions_count — transactions that left a balance_added ledger
    # entry behind (partial payment or unsettled balance).
    unpaid_subq = (
        select(
            SalesTransaction.payment_user_id.label("payment_user_id"),
            func.count(func.distinct(SalesTransaction.id)).label("unpaid_transactions_count"),
        )
        .where(
            SalesTransaction.id.in_(
                select(CustomerLedger.transaction_id).where(
                    CustomerLedger.entry_type == LedgerEntryTypeEnum.balance_added
                )
            ),
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
            func.coalesce(unpaid_subq.c.unpaid_transactions_count, 0).label("unpaid_transactions_count"),
        )
        .join(Role, Role.id == User.role_id)
        .outerjoin(sales_subq, sales_subq.c.payment_user_id == User.id)
        .outerjoin(processed_subq, processed_subq.c.payment_user_id == User.id)
        .outerjoin(actual_subq, actual_subq.c.payment_user_id == User.id)
        .outerjoin(unpaid_subq, unpaid_subq.c.payment_user_id == User.id)
        .where(Role.role_name == "payment", User.is_active.is_(True))
        .order_by(total_sales_col.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    return {
        "data": [
            PaymentUserSales(
                user_id=row.user_id,
                full_name=row.full_name,
                username=row.username,
                total_sales=row.total_sales,
                transactions_processed=row.transactions_processed,
                actual_total_sales=row.actual_total_sales,
                unpaid_transactions_count=row.unpaid_transactions_count,
            )
            for row in rows
        ],
        "error": None,
    }
