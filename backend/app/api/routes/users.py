from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import hash_password
from app.db.session import get_session
from app.models import User, UserRole
from app.schemas.users import ManagedUser, UserBanUpdate, UserPasswordReset, UserRoleUpdate
from app.services.audit import log_action

router = APIRouter(prefix="/users")

ROLE_RANK = {
    UserRole.user: 1,
    UserRole.moderator: 2,
    UserRole.administrator: 3,
    UserRole.superadmin: 4,
}


def serialize_user(user: User) -> ManagedUser:
    return ManagedUser(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        role=user.role,
        banned=user.banned,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


def require_user_management(actor: User) -> None:
    if actor.role not in {UserRole.moderator, UserRole.administrator, UserRole.superadmin}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User management is not allowed",
        )


def require_admin_management(actor: User) -> None:
    if actor.role not in {UserRole.administrator, UserRole.superadmin}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required",
        )


def ensure_target_is_lower_role(actor: User, target: User) -> None:
    if target.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot manage your own account",
        )
    if ROLE_RANK[target.role] >= ROLE_RANK[actor.role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot manage this user",
        )


async def get_target_user(session: AsyncSession, user_id: int) -> User:
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User was not found")
    return target


@router.get("", response_model=list[ManagedUser])
async def list_users(
    q: str | None = Query(default=None, max_length=100),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ManagedUser]:
    require_user_management(actor)

    query = select(User).order_by(User.created_at.desc(), User.id.desc()).limit(100)
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.where(or_(User.email.ilike(term), User.display_name.ilike(term)))

    users = (await session.scalars(query)).all()
    return [serialize_user(user) for user in users]


@router.patch("/{user_id}/role", response_model=ManagedUser)
async def update_user_role(
    user_id: int,
    payload: UserRoleUpdate,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ManagedUser:
    require_admin_management(actor)
    target = await get_target_user(session, user_id)
    ensure_target_is_lower_role(actor, target)

    if target.id == 1 and target.role == UserRole.superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Initial superadmin is protected",
        )
    if payload.role == UserRole.superadmin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Superadmin role cannot be assigned here",
        )
    if ROLE_RANK[payload.role] >= ROLE_RANK[actor.role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot assign this role",
        )

    before = target.role
    if before != payload.role:
        target.role = payload.role
        await log_action(
            session,
            code="user.role_changed",
            actor_user_id=actor.id,
            target_user_id=target.id,
            request=request,
            extra={
                "table": "users",
                "record_id": target.id,
                "target_user_id": target.id,
                "before": before.value,
                "after": payload.role.value,
            },
        )
        await session.commit()
        await session.refresh(target)

    return serialize_user(target)


@router.patch("/{user_id}/password", response_model=ManagedUser)
async def reset_user_password(
    user_id: int,
    payload: UserPasswordReset,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ManagedUser:
    require_admin_management(actor)
    target = await get_target_user(session, user_id)
    ensure_target_is_lower_role(actor, target)

    if len(payload.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long",
        )
    if target.id == 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Initial superadmin is protected",
        )

    target.password_hash = hash_password(payload.password)
    await log_action(
        session,
        code="user.password_reset",
        actor_user_id=actor.id,
        target_user_id=target.id,
        request=request,
        extra={"table": "users", "record_id": target.id, "target_user_id": target.id},
    )
    await session.commit()
    await session.refresh(target)
    return serialize_user(target)


@router.patch("/{user_id}/ban", response_model=ManagedUser)
async def update_user_ban(
    user_id: int,
    payload: UserBanUpdate,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ManagedUser:
    require_admin_management(actor)
    target = await get_target_user(session, user_id)
    ensure_target_is_lower_role(actor, target)

    if target.id == 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Initial superadmin is protected",
        )

    before = target.banned
    if before != payload.banned:
        target.banned = payload.banned
        await log_action(
            session,
            code="user.banned",
            actor_user_id=actor.id,
            target_user_id=target.id,
            request=request,
            extra={
                "table": "users",
                "record_id": target.id,
                "target_user_id": target.id,
                "before": before,
                "after": payload.banned,
                "reason": payload.reason,
            },
        )
        await session.commit()
        await session.refresh(target)

    return serialize_user(target)
