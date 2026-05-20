from __future__ import annotations

from pydantic import BaseModel

from app.models import UserRole


class LoginRequest(BaseModel):
    email: str
    password: str
    remember_me: bool = False


class ProfileUpdateRequest(BaseModel):
    email: str
    display_name: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class UserSummary(BaseModel):
    id: int
    email: str
    display_name: str
    role: UserRole


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserSummary
