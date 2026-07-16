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


class BalanceSettlementItem(BaseModel):
    source_transaction_id: int
    amount: Decimal
    # reference to the specific customer_ledger entry so we know exactly
    # which balance entry this settles
    ledger_entry_id: int


class DraftPaymentSaveRequest(BaseModel):
    entries: list[DraftPaymentEntry]
    # balance/credit checkbox state — sent once per save (not per entry row),
    # stored on the first draft row; see save_draft_payments
    draft_balances_to_settle: list[BalanceSettlementItem] = []
    # explicit credit_added ledger_entry_ids Payment checked — same pattern as
    # draft_balances_to_settle above. credit_applied is derived server-side from
    # these, not sent as a precomputed amount (see save_draft_payments).
    credit_entries_checked: list[int] = []


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
    actual_unit_count: int | None
    actual_quantity_kg: Decimal | None
    unit_price: Decimal | None
    reference_transaction_id: int | None
    subtotal: Decimal
    actual_subtotal: Decimal


class TransactionParentItemResponse(BaseModel):
    """A parent transaction's product-type items, as surfaced on an adjustment/refund
    child's response — used to render the child's article table (the child itself
    carries no items of its own, see resolve_substandard)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int | None
    product_name: str | None = None
    brand_name: str | None = None
    unit_count: int | None
    quantity_kg: Decimal | None
    unit_price: Decimal | None
    subtotal: Decimal
    actual_unit_count: int | None
    actual_quantity_kg: Decimal | None
    actual_subtotal: Decimal
    actual_weight_kg: Decimal | None


class TransactionParentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_number: str
    items: list[TransactionParentItemResponse]


class PaymentDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    payment_method_id: int
    ref_number: str | None
    tendered_amount: Decimal | None
    amount: Decimal
    is_draft: bool
    # raw JSON string of the balances_to_settle list at time of parking —
    # NULL on confirmed rows and non-first draft rows; parsed by the frontend
    draft_balances_json: str | None
    draft_credit_applied: Decimal
    # raw JSON string of the credit source breakdown at time of parking —
    # NULL on confirmed rows and non-first draft rows; parsed by the frontend
    draft_credit_sources_json: str | None
    created_at: datetime


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_number: str

    parent_transaction_id: int | None
    # order_number of the parent, when this is an adjustment/refund child — no
    # matching ORM attribute (would require a join), so this always needs the
    # default here and is filled in by _build_transaction_response afterward.
    parent_order_number: str | None = None
    # Full parent transaction (with its product items) for adjustment/refund
    # children — the child itself carries no items of its own, so the article
    # table has to source from here. No matching ORM attribute in this shape,
    # filled in by _build_transaction_response afterward. None for everything
    # else (originals have no parent).
    parent: TransactionParentResponse | None = None
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
    change_claimed: bool

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
    # Balance/credit checkbox state carried by the draft rows above (read off the first
    # one) — surfaced at the transaction level so the frontend doesn't need to know which
    # draft row it lives on. None/0 when there are no drafts, or none was checked when parked.
    draft_balances_json: str | None = None
    draft_credit_applied: Decimal = Decimal("0")
    draft_credit_sources_json: str | None = None
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
    actual_weight_kg: Decimal | None = None
    actual_unit_count: int | None = None
    # required — drives actual_subtotal (see confirm_weight)
    actual_quantity_kg: Decimal


class WeightConfirmRequest(BaseModel):
    items: list[WeightConfirmItem]


class TransactionItemsEditRequest(BaseModel):
    items: list[TransactionItemCreate]


class SubstandardOutcomeRequest(BaseModel):
    # Releasing makes no financial decision anymore — the only action is to
    # hand the variance to Payment, which then decides how to collect/refund it.
    outcome: Literal["send_to_payment"] = "send_to_payment"


class PaymentProcessItem(BaseModel):
    payment_method_id: int
    amount: Decimal
    tendered_amount: Decimal | None = None
    ref_number: str | None = None


class HandoverOutcomeResponse(BaseModel):
    """What Payment did with a settled transaction's adjustment/refund child —
    rendered by Releasing's outcome panel before it confirms the handover."""

    child_transaction_id: int
    child_transaction_type: TransactionTypeEnum
    child_total_due: Decimal
    # sum of the child's confirmed payment_detail rows (cash/online + any credit
    # row) — 0.00 for a refund child, since that path never touches payment_detail
    amount_paid: Decimal
    # > 0 only when the adjustment was partially paid — the underpaid remainder
    # logged as a new balance_added entry against the child
    remaining_balance_added: Decimal
    # > 0 only for a refund child resolved via resolve-as-credit
    credit_added: Decimal


class PaymentProcessRequest(BaseModel):
    payments: list[PaymentProcessItem]
    # explicit credit_added ledger_entry_ids Payment checked — credit_applied is
    # derived server-side from these (see process_payment), not sent as a
    # precomputed amount.
    credit_entries_checked: list[int] = []
    balances_to_settle: list[BalanceSettlementItem] = []
    is_partial: bool = False
    # total actually collected from customer (sum of payment entries) — the
    # backend cross-checks this against the payment entries themselves rather
    # than trusting it blindly, since it drives whether utang gets recorded
    amount_paid: Decimal
    # only relevant when the computed change_given > 0 — whether the customer
    # took the change as cash (True, default) or declined it in favor of
    # store credit (False). Ignored otherwise.
    change_claimed: bool = True
