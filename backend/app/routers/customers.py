from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.customer import Customer, CustomerStatusEnum
from app.schemas.customer import (
    CustomerCreate,
    CustomerDetailResponse,
    CustomerResponse,
    CustomerUpdate,
)
from app.services import customer_service

# Reads are open to any authenticated role — payment/releasing screens need
# customer names too. Writes stay restricted to the roles that manage customers.
router = APIRouter(
    prefix="/api/customers",
    tags=["customers"],
    dependencies=[Depends(get_current_user)],
)


async def _get_customer_or_404(customer_id: int, db: AsyncSession) -> Customer:
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return customer


@router.get("")
async def list_customers(search: str | None = Query(default=None), db: AsyncSession = Depends(get_db)):
    stmt = select(Customer).where(Customer.customer_status == CustomerStatusEnum.active)
    if search:
        stmt = stmt.where(Customer.full_name.ilike(f"%{search}%"))
    stmt = stmt.order_by(Customer.full_name)

    result = await db.execute(stmt)
    customers = result.scalars().all()
    return {"data": [CustomerResponse.model_validate(c) for c in customers], "error": None}


@router.get("/{customer_id}")
async def get_customer(customer_id: int, db: AsyncSession = Depends(get_db)):
    customer = await _get_customer_or_404(customer_id, db)

    detail = CustomerDetailResponse.model_validate(customer)
    for entry, ledger_row in zip(detail.ledger_entries, customer.ledger_entries):
        entry.order_number = ledger_row.transaction.order_number
    detail.ledger_entries.sort(key=lambda entry: entry.created_at)
    detail.listed_by_name = customer.created_by.full_name if customer.created_by else None
    detail.total_balance, detail.total_credit = customer_service.compute_ledger_totals(customer.ledger_entries)
    return {"data": detail, "error": None}


@router.get("/{customer_id}/ledger")
async def get_customer_ledger(
    customer_id: int,
    category: Literal["balance", "credit"] = Query(...),
    db: AsyncSession = Depends(get_db),
):
    # Same outstanding-remaining-amount logic Payment's own balance/credit
    # checkboxes use (get_outstanding_balance_entries / get_outstanding_credit_entries)
    # — fully settled/used entries are already excluded, and amounts are already
    # net of whatever's been settled/used against them.
    await _get_customer_or_404(customer_id, db)
    if category == "balance":
        entries = await customer_service.get_outstanding_balance_entries(db, customer_id)
    else:
        entries = await customer_service.get_outstanding_credit_entries(db, customer_id)
    entries.sort(key=lambda entry: entry.created_at, reverse=True)
    return {"data": entries, "error": None}


@router.get("/{customer_id}/balance-entries", dependencies=[Depends(require_role("payment"))])
async def get_balance_entries(customer_id: int, db: AsyncSession = Depends(get_db)):
    await _get_customer_or_404(customer_id, db)
    entries = await customer_service.get_outstanding_balance_entries(db, customer_id)
    return {"data": entries, "error": None}


@router.get("/{customer_id}/credit-entries", dependencies=[Depends(require_role("payment"))])
async def get_credit_entries(customer_id: int, db: AsyncSession = Depends(get_db)):
    await _get_customer_or_404(customer_id, db)
    entries = await customer_service.get_outstanding_credit_entries(db, customer_id)
    return {"data": entries, "error": None}


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_role("admin", "receiver"))])
async def create_customer(
    payload: CustomerCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    customer = Customer(**payload.model_dump(), created_by_user_id=current_user["user_id"])
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return {"data": CustomerResponse.model_validate(customer), "error": None}


@router.patch("/{customer_id}", dependencies=[Depends(require_role("admin", "receiver"))])
async def update_customer(customer_id: int, payload: CustomerUpdate, db: AsyncSession = Depends(get_db)):
    customer = await _get_customer_or_404(customer_id, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)

    await db.commit()
    await db.refresh(customer)
    return {"data": CustomerResponse.model_validate(customer), "error": None}


@router.delete("/{customer_id}", dependencies=[Depends(require_role("admin", "receiver"))])
async def delete_customer(customer_id: int, db: AsyncSession = Depends(get_db)):
    customer = await _get_customer_or_404(customer_id, db)

    customer.customer_status = CustomerStatusEnum.inactive
    await db.commit()
    await db.refresh(customer)
    return {"data": CustomerResponse.model_validate(customer), "error": None}
