from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import Request

from app.core.config import settings
from app.schemas.audit import GuestRequestLogEntry


def guest_log_path() -> Path:
    return Path(settings.guest_log_root_path) / "guest-requests.jsonl"


def ensure_guest_log_storage() -> Path:
    path = guest_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def parse_user_agent(user_agent: str | None) -> tuple[str | None, str | None, str | None]:
    if not user_agent:
        return None, None, None

    browser = None
    operating_system = None
    device_type = "desktop"

    browser_patterns = [
        (r"Edg/", "Edge"),
        (r"Chrome/", "Chrome"),
        (r"Firefox/", "Firefox"),
        (r"Safari/", "Safari"),
    ]
    for pattern, label in browser_patterns:
        if re.search(pattern, user_agent):
            browser = label
            break

    if "Windows" in user_agent:
        operating_system = "Windows"
    elif "Android" in user_agent:
        operating_system = "Android"
    elif "iPhone" in user_agent or "iPad" in user_agent:
        operating_system = "iOS"
    elif "Mac OS X" in user_agent or "Macintosh" in user_agent:
        operating_system = "macOS"
    elif "Linux" in user_agent:
        operating_system = "Linux"

    if re.search(r"Mobile|Android|iPhone|iPad", user_agent, re.IGNORECASE):
        device_type = "mobile"
    elif re.search(r"Tablet", user_agent, re.IGNORECASE):
        device_type = "tablet"

    return browser, operating_system, device_type


def record_guest_request(request: Request, status_code: int) -> None:
    if request.method == "OPTIONS":
        return
    if request.url.path.startswith("/media/") or request.url.path.startswith("/favicon"):
        return
    if request.headers.get("authorization"):
        return
    if not request.url.path.startswith("/api/"):
        return

    user_agent = request.headers.get("user-agent")
    browser, operating_system, device_type = parse_user_agent(user_agent)
    entry = {
        "id": uuid4().hex,
        "created_at": datetime.now(UTC).isoformat(),
        "method": request.method,
        "path": request.url.path,
        "status_code": status_code,
        "ip_address": request.client.host if request.client else None,
        "user_agent": user_agent,
        "browser": browser,
        "operating_system": operating_system,
        "device_type": device_type,
    }
    log_file = ensure_guest_log_storage()
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def list_guest_requests(limit: int = 100) -> list[GuestRequestLogEntry]:
    path = guest_log_path()
    if not path.exists():
        return []

    entries: list[GuestRequestLogEntry] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    for line in reversed(lines[-limit:]):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        entries.append(
            GuestRequestLogEntry.model_validate(
                {
                    **payload,
                    "created_at": payload.get("created_at") or datetime.now(UTC).isoformat(),
                }
            )
        )
    return entries
