from functools import cached_property
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "LetsCook"
    api_prefix: str = "/api"
    database_url: str = "postgresql+asyncpg://letscook:letscook@localhost:5432/letscook"
    backend_cors_origins: str = Field(default="http://localhost:5173")
    jwt_secret_key: str = "change-me-before-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 30
    media_root: str = "../var/media"

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]

    @cached_property
    def media_root_path(self) -> str:
        return str((Path(__file__).resolve().parents[2] / self.media_root).resolve())


settings = Settings()
