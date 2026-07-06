import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Enum, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.transaction import TransactionItem


class ProductStatusEnum(str, enum.Enum):
    active = "active"
    inactive = "inactive"


class Product(Base):
    __tablename__ = "product"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_name: Mapped[str] = mapped_column(String(100), nullable=False)
    brand_name: Mapped[Optional[str]] = mapped_column(String(100))
    unit_weight_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 3))
    unit_price_php: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    stock_quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False, server_default=text("0"))
    product_status: Mapped[ProductStatusEnum] = mapped_column(
        Enum(ProductStatusEnum, name="product_status_enum", create_type=False),
        nullable=False,
        server_default=text("'active'"),
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    transaction_items: Mapped[list["TransactionItem"]] = relationship(back_populates="product", lazy="selectin")
