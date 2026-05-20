from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from jose import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(
    subject: str,
    extra_claims: dict[str, Any] | None = None,
    *,
    expires_delta: timedelta | None = None,
) -> str:
    expires_at = datetime.now(UTC) + (expires_delta or timedelta(minutes=settings.access_token_minutes))
    payload: dict[str, Any] = {"sub": subject, "exp": expires_at, "type": "access"}
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
