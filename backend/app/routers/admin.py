from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.models.customer import Customer, CustomerStatusEnum
from app.models.product import Product, ProductStatusEnum
from app.models.transaction import ItemTypeEnum, SalesTransaction, TransactionItem, TransactionStatusEnum
from app.schemas.admin import DashboardSummary, TopProductRevenue

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard/summary", dependencies=[Depends(require_role("admin"))])
async def get_dashboard_summary(db: AsyncSession = Depends(get_db)):
    unpaid_stmt = select(func.coalesce(func.sum(func.abs(Customer.net_balance)), 0)).where(
        Customer.net_balance < 0, Customer.customer_status == CustomerStatusEnum.active
    )
    total_unpaid_balance = (await db.execute(unpaid_stmt)).scalar_one()

    products_stmt = select(func.count()).select_from(Product).where(Product.product_status == ProductStatusEnum.active)
    total_listed_products = (await db.execute(products_stmt)).scalar_one()

    return {
        "data": DashboardSummary(
            total_unpaid_balance=Decimal(total_unpaid_balance),
            total_listed_products=total_listed_products,
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
