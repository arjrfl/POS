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
    entry_type: LedgerEntryTypeEnum
    amount: Decimal
    running_balance: Decimal
    notes: str | None
    created_at: datetime


class CustomerDetailResponse(CustomerResponse):
    ledger_entries: list[CustomerLedgerEntryResponse]
