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
    created_at: datetime


class UserRoleUpdate(BaseModel):
    role: UserRole


class UserBanUpdate(BaseModel):
    banned: bool
    reason: str | None = None
