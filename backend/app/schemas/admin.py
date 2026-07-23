from decimal import Decimal

from pydantic import BaseModel


class TopProductRevenue(BaseModel):
    product_id: int
    product_name: str
    total_revenue: Decimal


class DashboardSummary(BaseModel):
    total_unpaid_balance: Decimal
    total_listed_products: int
    total_sales_today: Decimal
