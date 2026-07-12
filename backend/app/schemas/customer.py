from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.customer import CustomerStatusEnum
from app.models.ledger import LedgerEntryTypeEnum


class CustomerCreate(BaseModel):
    full_name: str
    address: str | None = None
    contact_number: str | None = None


class CustomerUpdate(BaseModel):
    full_name: str | None = None
    address: str | None = None
    contact_number: str | None = None


class CustomerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    address: str | None
    contact_number: str | None
    customer_status: CustomerStatusEnum
    net_balance: Decimal
    created_at: datetime
    updated_at: datetime


class CustomerLedgerEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    # not on the CustomerLedger row itself — no matching ORM attribute for
    # from_attributes to pick up, so this always needs the default here and
    # is filled in by the router from the (already eager-loaded) transaction
    order_number: str = ""
    entry_type: LedgerEntryTypeEnum
    amount: Decimal
    running_balance: Decimal
    notes: str | None
    created_at: datetime


class CustomerDetailResponse(CustomerResponse):
    ledger_entries: list[CustomerLedgerEntryResponse]


class CustomerBalanceEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ledger_entry_id: int
    transaction_id: int
    order_number: str
    amount: Decimal
    created_at: datetime
