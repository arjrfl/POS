from decimal import Decimal

from pydantic import BaseModel


class TopProductRevenue(BaseModel):
    product_id: int
    product_name: str
    total_revenue: Decimal


class DashboardSummary(BaseModel):
    total_unpaid_balance: Decimal
    total_sales_today: Decimal
    actual_sales_today: Decimal


class PaymentUserSales(BaseModel):
    user_id: int
    full_name: str
    username: str
    total_sales: Decimal
