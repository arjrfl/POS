from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.transaction import (
    CustomerTypeEnum,
    ItemTypeEnum,
    QueueStatusEnum,
    TransactionStatusEnum,
    TransactionTypeEnum,
)

# =============================================================
# REQUEST SCHEMAS
# =============================================================


class TransactionItemCreate(BaseModel):
    item_type: ItemTypeEnum = ItemTypeEnum.product

    # for product items
    product_id: int | None = None
    unit_count: int | None = None
    estimated_weight_kg: Decimal | None = None
    # QTY — required for product items, drives subtotal (quantity_kg * unit_price)
    quantity_kg: Decimal | None = None
    unit_price: Decimal | None = None

    # for balance_settlement and credit_usage items
    reference_transaction_id: int | None = None


class TransactionCreate(BaseModel):
    customer_id: int
    customer_type: CustomerTypeEnum
    # 'balance_settlement' is the only other type creatable from this endpoint —
    # 'adjustment'/'refund' only ever come from resolve_substandard's child transactions
    transaction_type: Literal["original", "balance_settlement"] = "original"
    items: list[TransactionItemCreate]
    credit_applied: Decimal = Decimal("0")
    balance_settled: Decimal = Decimal("0")


class DraftPaymentEntry(BaseModel):
    payment_method_id: int
    amount: Decimal
    tendered_amount: Decimal | None = None
    ref_number: str | None = None


class DraftPaymentSaveRequest(BaseModel):
    entries: list[DraftPaymentEntry]


# =============================================================
# RESPONSE SCHEMAS
# =============================================================


class TransactionItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    item_type: ItemTypeEnum
    product_id: int | None
    unit_count: int | None
    estimated_weight_kg: Decimal | None
    quantity_kg: Decimal | None
    actual_weight_kg: Decimal | None
    unit_price: Decimal | None
    reference_transaction_id: int | None
    subtotal: Decimal


class PaymentDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    payment_method_id: int
    ref_number: str | None
    tendered_amount: Decimal | None
    amount: Decimal
    is_draft: bool
    created_at: datetime


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_number: str

    parent_transaction_id: int | None
    transaction_type: TransactionTypeEnum
    transaction_status: TransactionStatusEnum
    customer_type: CustomerTypeEnum

    walkin_user_id: int | None
    payment_user_id: int | None
    releasing_user_id: int | None

    customer_id: int

    estimated_amount: Decimal
    actual_amount: Decimal | None
    balance_due: Decimal | None

    credit_applied: Decimal
    balance_settled: Decimal
    total_due: Decimal

    cash_tendered: Decimal
    change_given: Decimal

    invoice_pdf: str | None

    walkin_at: datetime | None
    payment_at: datetime | None
    releasing_at: datetime | None

    queue_status: QueueStatusEnum
    processing_by_user_id: int | None
    processing_started_at: datetime | None
    parked_by_user_id: int | None
    parked_at: datetime | None

    created_at: datetime
    updated_at: datetime

    items: list[TransactionItemResponse]
    payment_details: list[PaymentDetailResponse]
    # is_draft=TRUE entries — separate from payment_details (confirmed, is_draft=FALSE only).
    # No matching ORM attribute exists (payment_details covers both under the hood), so this
    # always needs a default here and is filled in by _build_transaction_response afterward.
    payment_drafts: list[PaymentDetailResponse] = []
    children: list["TransactionResponse"]


TransactionResponse.model_rebuild()


class TransactionListResponse(BaseModel):
    total: int
    items: list[TransactionResponse]


# =============================================================
# ACTION SCHEMAS (used by later routes)
# =============================================================


class QueueGrabRequest(BaseModel):
    pass


class QueueParkRequest(BaseModel):
    pass


class WeightConfirmItem(BaseModel):
    transaction_item_id: int
    actual_weight_kg: Decimal


class WeightConfirmRequest(BaseModel):
    items: list[WeightConfirmItem]


class TransactionItemsEditRequest(BaseModel):
    items: list[TransactionItemCreate]


class SubstandardOutcomeRequest(BaseModel):
    # only relevant when balance_due != 0
    outcome: Literal["pay_now", "utang", "refund_now", "save_credit"]


class PaymentProcessItem(BaseModel):
    payment_method_id: int
    amount: Decimal
    tendered_amount: Decimal | None = None
    ref_number: str | None = None


class PaymentProcessRequest(BaseModel):
    payments: list[PaymentProcessItem]
    credit_applied: Decimal = Decimal("0")
    balance_settled: Decimal = Decimal("0")
