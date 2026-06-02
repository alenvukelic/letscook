from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models import UserRole


class ManagedUser(BaseModel):
    id: int
    email: str
    display_name: str
    avatar_url: str | None
    role: UserRole
    banned: bool
    last_login_at: datetime | None
    created_at: datetime


class UserRoleUpdate(BaseModel):
    role: UserRole


class UserBanUpdate(BaseModel):
    banned: bool
    reason: str | None = None


class UserPasswordReset(BaseModel):
    password: str
