from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.transaction import PaymentMethod
from app.schemas.payment_method import PaymentMethodResponse

router = APIRouter(prefix="/api/payment-methods", tags=["payment-methods"], dependencies=[Depends(get_current_user)])


@router.get("")
async def list_payment_methods(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PaymentMethod).order_by(PaymentMethod.id))
    methods = result.scalars().all()
    return {"data": [PaymentMethodResponse.model_validate(m) for m in methods], "error": None}
