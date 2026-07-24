from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class TopProductRevenue(BaseModel):
    product_id: int
    product_name: str
    total_revenue: Decimal


class DashboardSummary(BaseModel):
    transactions_today: int
    total_unpaid_balance: Decimal
    total_sales_today: Decimal
    actual_sales_today: Decimal
    total_unused_credit: Decimal
    range_applied: Optional[dict[str, str]] = None


class PaymentUserSales(BaseModel):
    user_id: int
    full_name: str
    username: str
    total_sales: Decimal
