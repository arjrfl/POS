import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Computed, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.ledger import CustomerLedger, TransactionAuditLog, TransactionVoidLog
    from app.models.product import Product
    from app.models.user import User


class CustomerTypeEnum(str, enum.Enum):
    walk_in = "walk_in"
    online = "online"


class TransactionStatusEnum(str, enum.Enum):
    pending_payment = "pending_payment"
    pending_settlement = "pending_settlement"
    pending_adjustment = "pending_adjustment"
    settled = "settled"
    pending_handover = "pending_handover"
    completed = "completed"
    voided = "voided"


class TransactionTypeEnum(str, enum.Enum):
    original = "original"
    adjustment = "adjustment"
    refund = "refund"
    balance_settlement = "balance_settlement"


class QueueStatusEnum(str, enum.Enum):
    waiting = "waiting"
    processing = "processing"
    parked = "parked"
    done = "done"


class ItemTypeEnum(str, enum.Enum):
    product = "product"
    balance_settlement = "balance_settlement"
    credit_usage = "credit_usage"


class PaymentMethod(Base):
    __tablename__ = "payment_method"

    id: Mapped[int] = mapped_column(primary_key=True)
    payment_method_name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)

    payment_details: Mapped[list["PaymentDetail"]] = relationship(back_populates="payment_method", lazy="selectin")


class TransactionItem(Base):
    __tablename__ = "transaction_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("sales_transaction.id", ondelete="CASCADE"), nullable=False
    )

    item_type: Mapped[ItemTypeEnum] = mapped_column(
        Enum(ItemTypeEnum, name="item_type_enum", create_type=False),
        nullable=False,
        server_default=text("'product'"),
    )

    # for product items
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("product.id", ondelete="RESTRICT"))
    unit_count: Mapped[Optional[int]] = mapped_column(Integer)
    estimated_weight_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 3))
    tabulation_breakdown: Mapped[Optional[str]] = mapped_column(Text)
    tabulation_edited_by_payment: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    quantity_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 3))
    actual_weight_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 3))
    actual_unit_count: Mapped[Optional[int]] = mapped_column(Integer)
    actual_quantity_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 3))
    unit_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))

    # for balance_settlement and credit_usage items
    reference_transaction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sales_transaction.id", ondelete="RESTRICT")
    )

    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))
    actual_subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))

    transaction: Mapped["SalesTransaction"] = relationship(
        back_populates="items", foreign_keys=[transaction_id], lazy="selectin"
    )
    reference_transaction: Mapped[Optional["SalesTransaction"]] = relationship(
        foreign_keys=[reference_transaction_id], lazy="selectin"
    )
    product: Mapped[Optional["Product"]] = relationship(back_populates="transaction_items", lazy="selectin")


class SalesTransaction(Base):
    __tablename__ = "sales_transaction"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)

    # NULL for originals; points to the original for adjustments/refunds
    parent_transaction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sales_transaction.id", ondelete="RESTRICT")
    )

    transaction_type: Mapped[TransactionTypeEnum] = mapped_column(
        Enum(TransactionTypeEnum, name="transaction_type_enum", create_type=False), nullable=False
    )
    transaction_status: Mapped[TransactionStatusEnum] = mapped_column(
        Enum(TransactionStatusEnum, name="transaction_status_enum", create_type=False), nullable=False
    )

    # 'walk_in' -> Walk-In -> Payment -> Releasing
    # 'online'  -> Walk-In -> Releasing -> Payment -> Releasing (ship)
    customer_type: Mapped[CustomerTypeEnum] = mapped_column(
        Enum(CustomerTypeEnum, name="customer_type_enum", create_type=False),
        nullable=False,
        server_default=text("'walk_in'"),
    )

    walkin_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"))
    payment_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"))
    releasing_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"))

    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id", ondelete="RESTRICT"), nullable=False)

    estimated_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))
    actual_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))

    # positive = customer owes more (adjustment needed)
    # negative = store owes customer (refund needed)
    # zero     = exact weight, no action needed
    balance_due: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2),
        Computed(
            "CASE WHEN actual_amount IS NOT NULL THEN actual_amount - estimated_amount ELSE NULL END",
            persisted=True,
        ),
    )

    credit_applied: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))
    balance_settled: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))
    total_due: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))

    cash_tendered: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))
    change_given: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))
    # TRUE  = customer took the change as cash (normal case)
    # FALSE = customer declined, change was added to customer.net_balance as credit instead
    # Only meaningful when change_given > 0
    change_claimed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    invoice_pdf: Mapped[Optional[str]] = mapped_column(String(255))

    walkin_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    payment_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    releasing_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # resets to 'waiting' each time transaction moves to next phase
    queue_status: Mapped[QueueStatusEnum] = mapped_column(
        Enum(QueueStatusEnum, name="queue_status_enum", create_type=False),
        nullable=False,
        server_default=text("'waiting'"),
    )
    processing_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"))
    processing_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    parked_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"))
    parked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # JSON-serialized list of this transaction's product-type transaction_item rows,
    # captured ONCE — the very first time Payment's Edit Items feature is confirmed
    # for this transaction. Lets "Revert All" restore all the way back to what
    # Receiver originally listed, even across multiple Confirm Edits calls and modal
    # reopens. Cleared back to NULL once the transaction successfully completes
    # payment (POST /{id}/pay).
    original_items_snapshot: Mapped[Optional[str]] = mapped_column(Text)

    # Set to TRUE the first time a Payment-phase item edit is confirmed (same
    # moment original_items_snapshot is first captured). Unlike that snapshot,
    # this flag is NEVER cleared or reset — a permanent historical marker that
    # survives /pay, used to show the "Order Items Update Logs" button in Admin
    # > Transaction History even after the snapshot itself has been nulled out.
    items_edited_at_payment: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    # Permanent, NEVER-cleared copy of original_items_snapshot's content,
    # captured at the exact same moment (first successful Payment-phase
    # Confirm Edits), using the same JSON shape. Unlike original_items_snapshot
    # (which is cleared to NULL on /pay for its own working purpose — Revert
    # Items — untouched by this column), this exists solely so completed
    # transactions can still show their pre-edit item list in Admin >
    # Transaction History, long after the working snapshot is gone.
    # NULL for: transactions with no Payment-phase item edits, AND
    # transactions edited before this column existed (pre-migration —
    # items_edited_at_payment may be TRUE with this still NULL).
    original_items_snapshot_archive: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    customer: Mapped["Customer"] = relationship(back_populates="transactions", lazy="selectin")

    parent: Mapped[Optional["SalesTransaction"]] = relationship(
        remote_side=[id],
        foreign_keys=[parent_transaction_id],
        back_populates="children",
        lazy="selectin",
    )
    children: Mapped[list["SalesTransaction"]] = relationship(back_populates="parent", lazy="selectin")

    walkin_user: Mapped[Optional["User"]] = relationship(foreign_keys=[walkin_user_id], lazy="selectin")
    payment_user: Mapped[Optional["User"]] = relationship(foreign_keys=[payment_user_id], lazy="selectin")
    releasing_user: Mapped[Optional["User"]] = relationship(foreign_keys=[releasing_user_id], lazy="selectin")
    processing_by_user: Mapped[Optional["User"]] = relationship(foreign_keys=[processing_by_user_id], lazy="selectin")
    parked_by_user: Mapped[Optional["User"]] = relationship(foreign_keys=[parked_by_user_id], lazy="selectin")

    items: Mapped[list["TransactionItem"]] = relationship(
        back_populates="transaction",
        foreign_keys=[TransactionItem.transaction_id],
        lazy="selectin",
    )
    payment_details: Mapped[list["PaymentDetail"]] = relationship(back_populates="transaction", lazy="selectin")
    ledger_entries: Mapped[list["CustomerLedger"]] = relationship(back_populates="transaction", lazy="selectin")
    void_logs: Mapped[list["TransactionVoidLog"]] = relationship(back_populates="transaction", lazy="selectin")
    audit_logs: Mapped[list["TransactionAuditLog"]] = relationship(back_populates="transaction", lazy="selectin")


class PaymentDetail(Base):
    __tablename__ = "payment_detail"

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("sales_transaction.id", ondelete="CASCADE"), nullable=False
    )
    payment_method_id: Mapped[int] = mapped_column(
        ForeignKey("payment_method.id", ondelete="RESTRICT"), nullable=False
    )
    ref_number: Mapped[Optional[str]] = mapped_column(String(100))
    tendered_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # TRUE  = entered during payment process, not yet confirmed (persists through park/unpark)
    # FALSE = confirmed final payment record
    is_draft: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # Balance/credit checkbox state at time of parking — only meaningful on is_draft=TRUE
    # rows, and only set on the first draft row of a save (see save_draft_payments); NULL/0.00
    # everywhere else, including all confirmed (is_draft=FALSE) rows.
    draft_balances_json: Mapped[Optional[str]] = mapped_column(Text)
    draft_credit_applied: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default=text("0.00"))
    # JSON-serialized list of {source_transaction_id, order_number, ledger_entry_id, amount} —
    # which credit_added entries were consumed to cover draft_credit_applied (FIFO, oldest
    # first). Only meaningful on the first draft row of a save, like draft_balances_json above.
    draft_credit_sources_json: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    transaction: Mapped["SalesTransaction"] = relationship(back_populates="payment_details", lazy="selectin")
    payment_method: Mapped["PaymentMethod"] = relationship(back_populates="payment_details", lazy="selectin")
