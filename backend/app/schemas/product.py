from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.product import ProductStatusEnum


class ProductCreate(BaseModel):
    product_name: str
    brand_name: str | None = None
    unit_weight_kg: Decimal | None = None
    unit_price_php: Decimal
    stock_quantity: Decimal


class ProductUpdate(BaseModel):
    product_name: str | None = None
    brand_name: str | None = None
    unit_weight_kg: Decimal | None = None
    unit_price_php: Decimal | None = None
    stock_quantity: Decimal | None = None


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_name: str
    brand_name: str | None
    unit_weight_kg: Decimal | None
    unit_price_php: Decimal
    stock_quantity: Decimal
    product_status: ProductStatusEnum
    created_at: datetime
    updated_at: datetime
