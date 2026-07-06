from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.product import Product, ProductStatusEnum
from app.schemas.product import ProductCreate, ProductResponse, ProductUpdate

router = APIRouter(prefix="/api/products", tags=["products"])


async def _get_product_or_404(product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


@router.get("", dependencies=[Depends(get_current_user)])
async def list_products(search: str | None = Query(default=None), db: AsyncSession = Depends(get_db)):
    stmt = select(Product).where(Product.product_status == ProductStatusEnum.active)
    if search:
        stmt = stmt.where(Product.product_name.ilike(f"%{search}%"))
    stmt = stmt.order_by(Product.product_name)

    result = await db.execute(stmt)
    products = result.scalars().all()
    return {"data": [ProductResponse.model_validate(p) for p in products], "error": None}


@router.get("/{product_id}", dependencies=[Depends(get_current_user)])
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)):
    product = await _get_product_or_404(product_id, db)
    return {"data": ProductResponse.model_validate(product), "error": None}


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_role("admin"))])
async def create_product(payload: ProductCreate, db: AsyncSession = Depends(get_db)):
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return {"data": ProductResponse.model_validate(product), "error": None}


@router.patch("/{product_id}", dependencies=[Depends(require_role("admin"))])
async def update_product(product_id: int, payload: ProductUpdate, db: AsyncSession = Depends(get_db)):
    product = await _get_product_or_404(product_id, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)

    await db.commit()
    await db.refresh(product)
    return {"data": ProductResponse.model_validate(product), "error": None}


@router.delete("/{product_id}", dependencies=[Depends(require_role("admin"))])
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db)):
    product = await _get_product_or_404(product_id, db)

    product.product_status = ProductStatusEnum.inactive
    await db.commit()
    await db.refresh(product)
    return {"data": ProductResponse.model_validate(product), "error": None}
