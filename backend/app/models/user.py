import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Role(Base):
    __tablename__ = "role"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)

    users: Mapped[list["User"]] = relationship(back_populates="role", lazy="selectin")


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("role.id", ondelete="RESTRICT"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    role: Mapped["Role"] = relationship(back_populates="users", lazy="selectin")


class UserChangeTypeEnum(str, enum.Enum):
    created = "created"
    updated = "updated"
    deactivated = "deactivated"
    reactivated = "reactivated"
    password_reset = "password_reset"


class UserAuditLog(Base):
    __tablename__ = "user_audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    # the user this entry is ABOUT — cascades if that user is ever hard-deleted
    changed_by_user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="RESTRICT"), nullable=False)
    # the admin who performed the action

    change_type: Mapped[UserChangeTypeEnum] = mapped_column(
        Enum(UserChangeTypeEnum, name="user_change_type_enum", create_type=False), nullable=False
    )

    old_value: Mapped[Optional[str]] = mapped_column(Text)  # JSON, only changed fields, NULL for 'created'
    new_value: Mapped[str] = mapped_column(Text, nullable=False)  # JSON, only changed fields
    # CRITICAL: password_hash must never appear in old_value/new_value, in any form.

    notes: Mapped[Optional[str]] = mapped_column(Text)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id], lazy="selectin")
    changed_by_user: Mapped["User"] = relationship(foreign_keys=[changed_by_user_id], lazy="selectin")
