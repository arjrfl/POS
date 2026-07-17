import json
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.product import Product, ProductAuditLog, ProductChangeTypeEnum, ProductStatusEnum
from app.schemas.product import (
    ProductAuditLogResponse,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    StockAdjustRequest,
)
from app.websocket.events import product_changed
from app.websocket.manager import manager

router = APIRouter(prefix="/api/products", tags=["products"])

# Product create/update, stock adjustments, status toggles and history are
# Releasing's Inventory tab today — Admin also gets access since the Admin
# Products screen already exists and manages the same rows.
PRODUCT_WRITE_ROLES = ("releasing", "admin")


async def _get_product_or_404(product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


async def _log_and_broadcast(
    db: AsyncSession,
    product: Product,
    changed_by_user_id: int,
    change_type: ProductChangeTypeEnum,
    old_value: dict | None,
    new_value: dict,
    stock_delta: Decimal | None = None,
    notes: str | None = None,
) -> None:
    db.add(
        ProductAuditLog(
            product_id=product.id,
            changed_by_user_id=changed_by_user_id,
            change_type=change_type,
            old_value=json.dumps(old_value, default=str) if old_value is not None else None,
            new_value=json.dumps(new_value, default=str),
            stock_delta=stock_delta,
            notes=notes,
        )
    )
    await db.commit()
    await db.refresh(product)

    rooms, event = product_changed(product.id, change_type.value)
    await manager.broadcast_multi(rooms, event)


@router.get("", dependencies=[Depends(get_current_user)])
async def list_products(
    search: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Product)
    # Only Releasing's Inventory tab (and Admin) needs to see inactive products —
    # every other caller (e.g. the Receiver order picker) keeps the active-only view.
    if current_user.get("role_name") not in PRODUCT_WRITE_ROLES:
        stmt = stmt.where(Product.product_status == ProductStatusEnum.active)
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


@router.get("/{product_id}/history", dependencies=[Depends(require_role(*PRODUCT_WRITE_ROLES))])
async def get_product_history(product_id: int, db: AsyncSession = Depends(get_db)):
    await _get_product_or_404(product_id, db)

    result = await db.execute(
        select(ProductAuditLog)
        .where(ProductAuditLog.product_id == product_id)
        .order_by(ProductAuditLog.changed_at.desc())
    )
    logs = result.scalars().all()
    return {
        "data": [
            ProductAuditLogResponse(
                id=log.id,
                product_id=log.product_id,
                changed_by_user_id=log.changed_by_user_id,
                changed_by_full_name=log.changed_by_user.full_name,
                change_type=log.change_type,
                old_value=log.old_value,
                new_value=log.new_value,
                stock_delta=log.stock_delta,
                notes=log.notes,
                changed_at=log.changed_at,
            )
            for log in logs
        ],
        "error": None,
    }


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_role(*PRODUCT_WRITE_ROLES))])
async def create_product(
    payload: ProductCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    product = Product(**payload.model_dump())
    db.add(product)
    await db.flush()

    await _log_and_broadcast(
        db,
        product,
        current_user["user_id"],
        ProductChangeTypeEnum.created,
        old_value=None,
        new_value=payload.model_dump(),
    )
    return {"data": ProductResponse.model_validate(product), "error": None}


@router.patch("/{product_id}", dependencies=[Depends(require_role(*PRODUCT_WRITE_ROLES))])
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    product = await _get_product_or_404(product_id, db)

    old_value = {}
    new_value = {}
    for field, value in payload.model_dump(exclude_unset=True).items():
        current_value = getattr(product, field)
        if current_value != value:
            old_value[field] = current_value
            new_value[field] = value
            setattr(product, field, value)

    if not new_value:
        return {"data": ProductResponse.model_validate(product), "error": None}

    await _log_and_broadcast(
        db, product, current_user["user_id"], ProductChangeTypeEnum.updated, old_value, new_value
    )
    return {"data": ProductResponse.model_validate(product), "error": None}


@router.post("/{product_id}/adjust-stock", dependencies=[Depends(require_role(*PRODUCT_WRITE_ROLES))])
async def adjust_stock(
    product_id: int,
    payload: StockAdjustRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    product = await _get_product_or_404(product_id, db)

    before = product.stock_quantity
    after = before + payload.delta
    if after < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Adjustment would result in negative stock",
        )

    product.stock_quantity = after
    await _log_and_broadcast(
        db,
        product,
        current_user["user_id"],
        ProductChangeTypeEnum.stock_adjusted,
        old_value={"stock_quantity": before},
        new_value={"stock_quantity": after},
        stock_delta=payload.delta,
        notes=payload.notes,
    )
    return {"data": ProductResponse.model_validate(product), "error": None}


@router.post("/{product_id}/toggle-status", dependencies=[Depends(require_role(*PRODUCT_WRITE_ROLES))])
async def toggle_status(
    product_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    product = await _get_product_or_404(product_id, db)

    before = product.product_status
    after = ProductStatusEnum.inactive if before == ProductStatusEnum.active else ProductStatusEnum.active
    product.product_status = after

    change_type = (
        ProductChangeTypeEnum.deactivated if after == ProductStatusEnum.inactive else ProductChangeTypeEnum.reactivated
    )
    await _log_and_broadcast(
        db,
        product,
        current_user["user_id"],
        change_type,
        old_value={"product_status": before.value},
        new_value={"product_status": after.value},
    )
    return {"data": ProductResponse.model_validate(product), "error": None}


# Predates the releasing-facing toggle-status endpoint above; Admin's existing
# "Deactivate" button still calls this one-directional admin-only route.
@router.delete("/{product_id}", dependencies=[Depends(require_role("admin"))])
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db)):
    product = await _get_product_or_404(product_id, db)

    product.product_status = ProductStatusEnum.inactive
    await db.commit()
    await db.refresh(product)
    return {"data": ProductResponse.model_validate(product), "error": None}
