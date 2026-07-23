from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.schemas.user import (
    ResetPasswordRequest,
    UserAuditLogResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.services import user_service
from app.websocket.events import user_changed
from app.websocket.manager import manager

router = APIRouter(
    prefix="/api/users",
    tags=["users"],
    dependencies=[Depends(require_role("admin"))],
)


def _to_response(user) -> UserResponse:
    response = UserResponse.model_validate(user)
    response.role_name = user.role.role_name
    return response


@router.get("")
async def list_users(
    search: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    users = await user_service.list_users(db, search=search, role=role, status_filter=status)
    return {"data": [_to_response(u) for u in users], "error": None}


@router.get("/{user_id}")
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await user_service.get_user(db, user_id)
    return {"data": _to_response(user), "error": None}


@router.get("/{user_id}/history")
async def get_user_history(user_id: int, db: AsyncSession = Depends(get_db)):
    logs = await user_service.get_user_history(db, user_id)
    return {
        "data": [
            UserAuditLogResponse(
                id=log.id,
                user_id=log.user_id,
                changed_by_user_id=log.changed_by_user_id,
                changed_by_full_name=log.changed_by_user.full_name,
                change_type=log.change_type,
                old_value=log.old_value,
                new_value=log.new_value,
                notes=log.notes,
                changed_at=log.changed_at,
            )
            for log in logs
        ],
        "error": None,
    }


@router.post("", status_code=201)
async def create_user(
    payload: UserCreate,
    current_user: dict = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    user = await user_service.create_user(db, payload, current_user["user_id"])
    rooms, event = user_changed(user.id, "created")
    await manager.broadcast_multi(rooms, event)
    return {"data": _to_response(user), "error": None}


@router.patch("/{user_id}")
async def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: dict = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    user = await user_service.update_user(db, user_id, payload, current_user["user_id"])
    rooms, event = user_changed(user.id, "updated")
    await manager.broadcast_multi(rooms, event)
    return {"data": _to_response(user), "error": None}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    current_user: dict = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    user = await user_service.reset_password(db, user_id, payload, current_user["user_id"])
    rooms, event = user_changed(user.id, "password_reset")
    await manager.broadcast_multi(rooms, event)
    return {"data": _to_response(user), "error": None}


@router.post("/{user_id}/toggle-status")
async def toggle_status(
    user_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    user = await user_service.toggle_status(db, user_id, current_user["user_id"])
    rooms, event = user_changed(user.id, "reactivated" if user.is_active else "deactivated")
    await manager.broadcast_multi(rooms, event)
    return {"data": _to_response(user), "error": None}


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    await user_service.delete_user(db, user_id, current_user["user_id"])
    rooms, event = user_changed(user_id, "deleted")
    await manager.broadcast_multi(rooms, event)
    return {"data": {"id": user_id, "deleted": True}, "error": None}
