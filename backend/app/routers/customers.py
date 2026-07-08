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
    detail.ledger_entries.sort(key=lambda entry: entry.created_at)
    return {"data": detail, "error": None}


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_role("admin", "walk_in"))])
async def create_customer(payload: CustomerCreate, db: AsyncSession = Depends(get_db)):
    customer = Customer(**payload.model_dump())
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return {"data": CustomerResponse.model_validate(customer), "error": None}


@router.patch("/{customer_id}", dependencies=[Depends(require_role("admin", "walk_in"))])
async def update_customer(customer_id: int, payload: CustomerUpdate, db: AsyncSession = Depends(get_db)):
    customer = await _get_customer_or_404(customer_id, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)

    await db.commit()
    await db.refresh(customer)
    return {"data": CustomerResponse.model_validate(customer), "error": None}


@router.delete("/{customer_id}", dependencies=[Depends(require_role("admin", "walk_in"))])
async def delete_customer(customer_id: int, db: AsyncSession = Depends(get_db)):
    customer = await _get_customer_or_404(customer_id, db)

    customer.customer_status = CustomerStatusEnum.inactive
    await db.commit()
    await db.refresh(customer)
    return {"data": CustomerResponse.model_validate(customer), "error": None}
