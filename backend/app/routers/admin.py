from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.models.customer import Customer, CustomerStatusEnum
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


@router.get("/dashboard/summary", dependencies=[Depends(require_role("admin"))])
async def get_dashboard_summary(db: AsyncSession = Depends(get_db)):
    unpaid_stmt = select(func.coalesce(func.sum(func.abs(Customer.net_balance)), 0)).where(
        Customer.net_balance < 0, Customer.customer_status == CustomerStatusEnum.active
    )
    total_unpaid_balance = (await db.execute(unpaid_stmt)).scalar_one()

    unused_credit_stmt = select(func.coalesce(func.sum(Customer.net_balance), 0)).where(
        Customer.net_balance > 0, Customer.customer_status == CustomerStatusEnum.active
    )
    total_unused_credit = (await db.execute(unused_credit_stmt)).scalar_one()

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

    return {
        "data": DashboardSummary(
            total_unpaid_balance=Decimal(total_unpaid_balance),
            total_sales_today=Decimal(total_sales_today),
            actual_sales_today=Decimal(actual_sales_today),
            total_unused_credit=Decimal(total_unused_credit),
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
async def get_payment_user_sales(db: AsyncSession = Depends(get_db)):
    # Join conditions (not WHERE) so active payment users with zero qualifying
    # transactions today still appear, via LEFT JOIN, with total_sales = 0.00.
    # Same "today" boundary + refund-exclusion + total_due rule as Total Sales
    # Today (see get_dashboard_summary above) — total_due already nets credit_applied.
    today_sales_join = and_(
        SalesTransaction.payment_user_id == User.id,
        SalesTransaction.transaction_status == TransactionStatusEnum.completed,
        func.date(SalesTransaction.payment_at) == func.current_date(),
        SalesTransaction.transaction_type != TransactionTypeEnum.refund,
    )

    stmt = (
        select(
            User.id.label("user_id"),
            User.full_name.label("full_name"),
            User.username.label("username"),
            func.coalesce(func.sum(SalesTransaction.total_due), 0).label("total_sales"),
        )
        .join(Role, Role.id == User.role_id)
        .outerjoin(SalesTransaction, today_sales_join)
        .where(Role.role_name == "payment", User.is_active.is_(True))
        .group_by(User.id, User.full_name, User.username)
        .order_by(func.coalesce(func.sum(SalesTransaction.total_due), 0).desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    return {
        "data": [
            PaymentUserSales(
                user_id=row.user_id, full_name=row.full_name, username=row.username, total_sales=row.total_sales
            )
            for row in rows
        ],
        "error": None,
    }
