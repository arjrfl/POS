from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.product import ProductChangeTypeEnum, ProductStatusEnum


class ProductCreate(BaseModel):
    product_name: str
    brand_name: str | None = None
    unit_weight_kg: Decimal | None = None
    unit_price_php: Decimal
    stock_quantity: Decimal = Decimal("0")


class ProductUpdate(BaseModel):
    # Deliberately excludes stock_quantity and product_status — those go
    # through /adjust-stock and /toggle-status so they get their own audit trail.
    product_name: str | None = None
    brand_name: str | None = None
    unit_weight_kg: Decimal | None = None
    unit_price_php: Decimal | None = None


class StockAdjustRequest(BaseModel):
    delta: Decimal
    notes: str | None = None


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


class ProductAuditLogResponse(BaseModel):
    id: int
    product_id: int
    changed_by_user_id: int
    changed_by_full_name: str
    change_type: ProductChangeTypeEnum
    old_value: str | None
    new_value: str
    stock_delta: Decimal | None
    notes: str | None
    changed_at: datetime
