from __future__ import annotations

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Action, ActionLog


async def log_action(
    session: AsyncSession,
    *,
    code: str,
    actor_user_id: int | None,
    target_user_id: int | None,
    request: Request,
    extra: dict[str, object] | None = None,
) -> None:
    action_id = await session.scalar(select(Action.id).where(Action.code == code))
    if action_id is None:
        return

    session.add(
        ActionLog(
            action_id=action_id,
            actor_user_id=actor_user_id,
            target_user_id=target_user_id,
            ip_address=request.client.host if request.client else None,
            extra=extra or {},
        )
    )
