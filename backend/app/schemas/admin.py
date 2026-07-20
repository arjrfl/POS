from decimal import Decimal

from pydantic import BaseModel


class TopProductRevenue(BaseModel):
    product_id: int
    product_name: str
    total_revenue: Decimal
