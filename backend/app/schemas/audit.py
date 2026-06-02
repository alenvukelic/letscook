from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models import UserRole


class ActionActor(BaseModel):
    id: int | None
    display_name: str | None = None
    email: str | None = None
    role: UserRole | None = None


class ActionLogEntry(BaseModel):
    id: int
    created_at: datetime
    ip_address: str | None
    code: str
    description: str
    actor: ActionActor | None
    target: ActionActor | None
    extra: dict[str, object]


class GuestRequestLogEntry(BaseModel):
    id: str
    created_at: datetime
    method: str
    path: str
    status_code: int
    ip_address: str | None
    user_agent: str | None
    browser: str | None
    operating_system: str | None
    device_type: str | None


class BackupSchedule(BaseModel):
    enabled: bool
    cron_expression: str = Field(min_length=1)
    retention_count: int = Field(ge=1)
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None


class BackupFileEntry(BaseModel):
    filename: str
    created_at: datetime
    updated_at: datetime
    byte_size: int
    recipe_count: int
    trigger: str
    reason: str | None = None
    download_url: str
