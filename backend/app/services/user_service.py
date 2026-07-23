import json

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.user import Role, User, UserAuditLog, UserChangeTypeEnum
from app.schemas.user import ResetPasswordRequest, UserCreate, UserUpdate

# Diffable/loggable fields on "user" — deliberately excludes password_hash,
# which must never appear in user_audit_log old_value/new_value.
_DIFF_FIELDS = ("full_name", "username")


async def _get_user_or_404(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


async def _get_role_or_404(db: AsyncSession, role_id: int) -> Role:
    role = await db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role not found")
    return role


async def _username_taken(db: AsyncSession, username: str, exclude_user_id: int | None = None) -> bool:
    stmt = select(func.count()).select_from(User).where(User.username == username)
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    result = await db.execute(stmt)
    return result.scalar_one() > 0


async def _other_active_admins_count(db: AsyncSession, exclude_user_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(User)
        .join(Role, User.role_id == Role.id)
        .where(Role.role_name == "admin", User.is_active.is_(True), User.id != exclude_user_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one()


async def _log(
    db: AsyncSession,
    user: User,
    changed_by_user_id: int,
    change_type: UserChangeTypeEnum,
    old_value: dict | None,
    new_value: dict,
    notes: str | None = None,
) -> None:
    db.add(
        UserAuditLog(
            user_id=user.id,
            changed_by_user_id=changed_by_user_id,
            change_type=change_type,
            old_value=json.dumps(old_value) if old_value is not None else None,
            new_value=json.dumps(new_value),
            notes=notes,
        )
    )
    await db.commit()
    await db.refresh(user)


async def list_users(
    db: AsyncSession,
    search: str | None = None,
    role: str | None = None,
    status_filter: str | None = None,
) -> list[User]:
    stmt = select(User).join(Role, User.role_id == Role.id)
    if search:
        stmt = stmt.where(
            or_(
                User.full_name.ilike(f"%{search}%"),
                User.username.ilike(f"%{search}%"),
            )
        )
    if role:
        stmt = stmt.where(Role.role_name == role)
    if status_filter:
        stmt = stmt.where(User.is_active.is_(status_filter == "active"))
    stmt = stmt.order_by(User.full_name)

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_user(db: AsyncSession, user_id: int) -> User:
    return await _get_user_or_404(db, user_id)


async def get_user_history(db: AsyncSession, user_id: int) -> list[UserAuditLog]:
    await _get_user_or_404(db, user_id)
    result = await db.execute(
        select(UserAuditLog).where(UserAuditLog.user_id == user_id).order_by(UserAuditLog.changed_at.desc())
    )
    return list(result.scalars().all())


async def create_user(db: AsyncSession, payload: UserCreate, current_user_id: int) -> User:
    if await _username_taken(db, payload.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already taken")

    role = await _get_role_or_404(db, payload.role_id)

    user = User(
        full_name=payload.full_name,
        username=payload.username,
        password_hash=hash_password(payload.password),
        role_id=payload.role_id,
    )
    db.add(user)
    await db.flush()

    await _log(
        db,
        user,
        current_user_id,
        UserChangeTypeEnum.created,
        old_value=None,
        new_value={"full_name": user.full_name, "username": user.username, "role_name": role.role_name},
    )
    return user


async def update_user(db: AsyncSession, user_id: int, payload: UserUpdate, current_user_id: int) -> User:
    # role_id is not part of UserUpdate (see schemas/user.py) — role is
    # immutable after creation, so 'updated' entries here can only ever
    # diff full_name/username, never role_name. The last-active-admin
    # guard that used to live here for role changes no longer applies to
    # this path; it still exists on toggle_status below, for deactivation.
    user = await _get_user_or_404(db, user_id)
    updates = payload.model_dump(exclude_unset=True)

    if "username" in updates and updates["username"] != user.username:
        if await _username_taken(db, updates["username"], exclude_user_id=user_id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already taken")

    old_value: dict = {}
    new_value: dict = {}

    for field in _DIFF_FIELDS:
        if field in updates and updates[field] != getattr(user, field):
            old_value[field] = getattr(user, field)
            new_value[field] = updates[field]
            setattr(user, field, updates[field])

    if not new_value:
        return user

    await _log(db, user, current_user_id, UserChangeTypeEnum.updated, old_value, new_value)
    return user


async def reset_password(db: AsyncSession, user_id: int, payload: ResetPasswordRequest, current_user_id: int) -> User:
    user = await _get_user_or_404(db, user_id)

    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match")

    user.password_hash = hash_password(payload.new_password)

    await _log(
        db,
        user,
        current_user_id,
        UserChangeTypeEnum.password_reset,
        old_value=None,
        new_value={"password_reset": True},
    )
    return user


async def toggle_status(db: AsyncSession, user_id: int, current_user_id: int) -> User:
    user = await _get_user_or_404(db, user_id)

    if user_id == current_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")

    before = user.is_active
    after = not before

    if not after and user.role.role_name == "admin":
        if await _other_active_admins_count(db, exclude_user_id=user_id) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate the last active admin"
            )

    user.is_active = after
    change_type = UserChangeTypeEnum.reactivated if after else UserChangeTypeEnum.deactivated

    await _log(
        db,
        user,
        current_user_id,
        change_type,
        old_value={"is_active": before},
        new_value={"is_active": after},
    )
    return user


async def delete_user(db: AsyncSession, user_id: int, current_user_id: int) -> None:
    user = await _get_user_or_404(db, user_id)

    if user_id == current_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")

    await db.delete(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete: user has activity on record. Deactivate instead.",
        )
