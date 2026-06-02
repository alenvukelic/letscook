from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_session
from app.models import User, UserRole
from app.schemas.auth import (
    LoginRequest,
    PasswordChangeRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    TokenResponse,
    UserSummary,
)
from app.services.audit import log_action

router = APIRouter(prefix="/auth")


def serialize_user(user: User) -> UserSummary:
    return UserSummary(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        role=user.role,
        last_login_at=user.last_login_at,
    )


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

    expires_delta = timedelta(days=30) if payload.remember_me else None
    access_token = create_access_token(
        str(user.id), {"role": user.role.value}, expires_delta=expires_delta
    )
    user.last_login_at = datetime.now(UTC)
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


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is not valid")
    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Display name is required",
        )
    if len(payload.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters",
        )

    existing = await session.scalar(select(User.id).where(User.email == email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already in use")

    user = User(
        email=email,
        display_name=display_name,
        password_hash=hash_password(payload.password),
        role=UserRole.user,
        banned=False,
    )
    session.add(user)
    await session.flush()
    access_token = create_access_token(str(user.id), {"role": user.role.value})
    await log_action(
        session,
        code="auth.registered",
        actor_user_id=user.id,
        target_user_id=user.id,
        request=request,
        extra={"email": user.email},
    )
    await session.commit()
    await session.refresh(user)
    return TokenResponse(access_token=access_token, user=serialize_user(user))


@router.get("/me", response_model=UserSummary)
async def me(user: User = Depends(get_current_user)) -> UserSummary:
    return serialize_user(user)


@router.put("/me", response_model=UserSummary)
async def update_me(
    payload: ProfileUpdateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserSummary:
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is not valid")
    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Display name is required",
        )
    avatar_url = (payload.avatar_url or "").strip() or None
    if avatar_url is not None and not avatar_url.startswith("/media/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar image must be a local /media/ image",
        )

    existing = await session.scalar(select(User).where(User.email == email, User.id != user.id))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already in use")

    before = {"email": user.email, "display_name": user.display_name, "avatar_url": user.avatar_url}
    user.email = email
    user.display_name = display_name
    user.avatar_url = avatar_url
    await log_action(
        session,
        code="user.profile_updated",
        actor_user_id=user.id,
        target_user_id=user.id,
        request=request,
        extra={
            "before": before,
            "after": {"email": email, "display_name": display_name, "avatar_url": avatar_url},
        },
    )
    await session.commit()
    await session.refresh(user)
    return serialize_user(user)


@router.put("/me/password", response_model=UserSummary)
async def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserSummary:
    if user.password_hash is None or not verify_password(
        payload.current_password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is not valid",
        )
    if len(payload.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 8 characters",
        )

    user.password_hash = hash_password(payload.new_password)
    await log_action(
        session,
        code="user.password_changed",
        actor_user_id=user.id,
        target_user_id=user.id,
        request=request,
        extra={},
    )
    await session.commit()
    return serialize_user(user)
