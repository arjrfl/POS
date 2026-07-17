import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.transaction import TransactionItem
    from app.models.user import User


class ProductStatusEnum(str, enum.Enum):
    active = "active"
    inactive = "inactive"


class ProductChangeTypeEnum(str, enum.Enum):
    created = "created"
    updated = "updated"
    stock_adjusted = "stock_adjusted"
    deactivated = "deactivated"
    reactivated = "reactivated"


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


class ProductAuditLog(Base):
    __tablename__ = "product_audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("product.id", ondelete="CASCADE"), nullable=False)
    changed_by_user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"), nullable=False)

    change_type: Mapped[ProductChangeTypeEnum] = mapped_column(
        Enum(ProductChangeTypeEnum, name="product_change_type_enum", create_type=False), nullable=False
    )

    old_value: Mapped[Optional[str]] = mapped_column(Text)  # JSON, only changed fields, NULL for 'created'
    new_value: Mapped[str] = mapped_column(Text, nullable=False)  # JSON, only changed fields
    stock_delta: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 3))  # only for 'stock_adjusted', signed

    notes: Mapped[Optional[str]] = mapped_column(Text)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    changed_by_user: Mapped["User"] = relationship(foreign_keys=[changed_by_user_id], lazy="selectin")
