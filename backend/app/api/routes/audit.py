from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models import Action, ActionLog, User, UserRole
from app.schemas.audit import ActionActor, ActionLogEntry, GuestRequestLogEntry
from app.services.guest_logs import list_guest_requests

router = APIRouter(prefix="/audit")


def format_action_detail(code: str, extra: dict[str, object]) -> str:
    parts = [code]
    for key in ("record_id", "recipe_id", "user_id", "target_user_id", "media_id"):
        value = extra.get(key)
        if value is not None:
            parts.append(f"{key}={value}")
    if extra.get("table"):
        parts.append(f"table={extra['table']}")
    if extra.get("backup_file"):
        parts.append(f"file={extra['backup_file']}")
    return " | ".join(parts)


def require_audit_access(actor: User) -> None:
    if actor.role not in {UserRole.administrator, UserRole.superadmin}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Audit access is restricted")


@router.get("/actions", response_model=list[ActionLogEntry])
async def list_actions(
    limit: int = Query(default=100, ge=1, le=200),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ActionLogEntry]:
    require_audit_access(actor)

    actor_user = aliased(User)
    target_user = aliased(User)
    rows = await session.execute(
        select(ActionLog, Action.code, Action.description, actor_user, target_user)
        .join(Action, Action.id == ActionLog.action_id)
        .outerjoin(actor_user, actor_user.id == ActionLog.actor_user_id)
        .outerjoin(target_user, target_user.id == ActionLog.target_user_id)
        .order_by(ActionLog.created_at.desc(), ActionLog.id.desc())
        .limit(limit)
    )

    entries: list[ActionLogEntry] = []
    for action_log, code, description, actor_row, target_row in rows:
        entries.append(
            ActionLogEntry(
                id=action_log.id,
                created_at=action_log.created_at,
                ip_address=str(action_log.ip_address) if action_log.ip_address is not None else None,
                code=code,
                description=description,
                detail=format_action_detail(code, action_log.extra or {}),
                actor=(
                    ActionActor(
                        id=actor_row.id,
                        display_name=actor_row.display_name,
                        email=actor_row.email,
                        role=actor_row.role,
                    )
                    if actor_row is not None
                    else None
                ),
                target=(
                    ActionActor(
                        id=target_row.id,
                        display_name=target_row.display_name,
                        email=target_row.email,
                        role=target_row.role,
                    )
                    if target_row is not None
                    else None
                ),
                extra=action_log.extra or {},
            )
        )
    return entries


@router.get("/guests", response_model=list[GuestRequestLogEntry])
async def list_guest_actions(
    limit: int = Query(default=100, ge=1, le=200),
    actor: User = Depends(get_current_user),
) -> list[GuestRequestLogEntry]:
    require_audit_access(actor)
    return list_guest_requests(limit=limit)
