import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Enum, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.ledger import CustomerLedger
    from app.models.transaction import SalesTransaction


class CustomerStatusEnum(str, enum.Enum):
    active = "active"
    inactive = "inactive"


class Customer(Base):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(String(255))
    contact_number: Mapped[Optional[str]] = mapped_column(String(20))
    customer_status: Mapped[CustomerStatusEnum] = mapped_column(
        Enum(CustomerStatusEnum, name="customer_status_enum", create_type=False),
        nullable=False,
        server_default=text("'active'"),
    )

    # positive = customer has CREDIT (store owes customer)
    # negative = customer has BALANCE/utang (customer owes store)
    net_balance: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    transactions: Mapped[list["SalesTransaction"]] = relationship(back_populates="customer", lazy="selectin")
    ledger_entries: Mapped[list["CustomerLedger"]] = relationship(back_populates="customer", lazy="selectin")
