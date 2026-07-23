from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.user import UserChangeTypeEnum


class UserCreate(BaseModel):
    full_name: str
    username: str
    password: str
    role_id: int


class UserUpdate(BaseModel):
    # role_id is deliberately NOT accepted here — role is set once at
    # creation (POST /) and is immutable afterward (see CLAUDE.md Team
    # Roles). BaseModel's default extra="ignore" means a role_id in the
    # request body is silently dropped rather than raising a validation
    # error — chosen over a 400 since this schema has no other reason to
    # inspect the raw request body, and silent-drop needed zero extra code.
    full_name: str | None = None
    username: str | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str
    confirm_password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    username: str
    role_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    # not a column on "user" — no matching ORM attribute for from_attributes
    # to pick up, so this always needs the default here and is filled in by
    # the router from the (already eager-loaded) role relationship
    role_name: str = ""


class UserAuditLogResponse(BaseModel):
    id: int
    user_id: int
    changed_by_user_id: int
    changed_by_full_name: str
    change_type: UserChangeTypeEnum
    old_value: str | None
    new_value: str
    notes: str | None
    changed_at: datetime
