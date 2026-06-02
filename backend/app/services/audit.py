from __future__ import annotations

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Action, ActionLog
from app.services.guest_logs import parse_user_agent


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

    user_agent = request.headers.get("user-agent")
    browser, operating_system, device_type = parse_user_agent(user_agent)

    session.add(
        ActionLog(
            action_id=action_id,
            actor_user_id=actor_user_id,
            target_user_id=target_user_id,
            ip_address=request.client.host if request.client else None,
            extra={
                **(extra or {}),
                "method": request.method,
                "path": request.url.path,
                "user_agent": user_agent,
                "browser": browser,
                "operating_system": operating_system,
                "device_type": device_type,
            },
        )
    )
