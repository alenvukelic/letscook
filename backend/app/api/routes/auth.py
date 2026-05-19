from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.db.session import get_session
from app.models import User
from app.schemas.auth import LoginRequest, TokenResponse, UserSummary
from app.services.audit import log_action

router = APIRouter(prefix="/auth")


def serialize_user(user: User) -> UserSummary:
    return UserSummary(id=user.id, email=user.email, display_name=user.display_name, role=user.role)


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    user = await session.scalar(select(User).where(User.email == payload.email))
    if user is None or user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if user.banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is banned")

    access_token = create_access_token(str(user.id), {"role": user.role.value})
    await log_action(
        session,
        code="auth.logged_in",
        actor_user_id=user.id,
        target_user_id=user.id,
        request=request,
        extra={"email": user.email},
    )
    await session.commit()
    return TokenResponse(access_token=access_token, user=serialize_user(user))


@router.get("/me", response_model=UserSummary)
async def me(user: User = Depends(get_current_user)) -> UserSummary:
    return serialize_user(user)
