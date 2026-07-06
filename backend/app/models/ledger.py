import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.transaction import SalesTransaction
    from app.models.user import User


class LedgerEntryTypeEnum(str, enum.Enum):
    balance_added = "balance_added"
    balance_settled = "balance_settled"
    credit_added = "credit_added"
    credit_used = "credit_used"
    credit_auto_used = "credit_auto_used"


class AuditChangeTypeEnum(str, enum.Enum):
    transaction_status = "transaction_status"
    queue_status = "queue_status"


class CustomerLedger(Base):
    __tablename__ = "customer_ledger"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id", ondelete="RESTRICT"), nullable=False)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("sales_transaction.id", ondelete="CASCADE"), nullable=False
    )

    entry_type: Mapped[LedgerEntryTypeEnum] = mapped_column(
        Enum(LedgerEntryTypeEnum, name="ledger_entry_type_enum", create_type=False), nullable=False
    )

    # always positive; entry_type tells you the direction
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # snapshot of customer net_balance after this entry was applied
    running_balance: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    notes: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    customer: Mapped["Customer"] = relationship(back_populates="ledger_entries", lazy="selectin")
    transaction: Mapped["SalesTransaction"] = relationship(back_populates="ledger_entries", lazy="selectin")


class TransactionVoidLog(Base):
    __tablename__ = "transaction_void_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("sales_transaction.id", ondelete="CASCADE"), nullable=False
    )
    void_reason: Mapped[str] = mapped_column(Text, nullable=False)
    voided_by_user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"), nullable=False)
    voided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    transaction: Mapped["SalesTransaction"] = relationship(back_populates="void_logs", lazy="selectin")
    voided_by_user: Mapped["User"] = relationship(foreign_keys=[voided_by_user_id], lazy="selectin")


class TransactionAuditLog(Base):
    __tablename__ = "transaction_audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("sales_transaction.id", ondelete="CASCADE"), nullable=False
    )
    changed_by_user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"), nullable=False)

    change_type: Mapped[AuditChangeTypeEnum] = mapped_column(
        Enum(AuditChangeTypeEnum, name="audit_change_type_enum", create_type=False), nullable=False
    )

    old_value: Mapped[Optional[str]] = mapped_column(String(50))
    new_value: Mapped[str] = mapped_column(String(50), nullable=False)

    notes: Mapped[Optional[str]] = mapped_column(Text)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    transaction: Mapped["SalesTransaction"] = relationship(back_populates="audit_logs", lazy="selectin")
    changed_by_user: Mapped["User"] = relationship(foreign_keys=[changed_by_user_id], lazy="selectin")
