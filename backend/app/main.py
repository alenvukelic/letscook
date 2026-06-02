import asyncio
import contextlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.services.backup import backup_scheduler_loop
from app.services.guest_logs import record_guest_request


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.9.4",
        description="LetsCook API foundation",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_guest_requests(request, call_next):
        response = None
        try:
            response = await call_next(request)
            return response
        finally:
            record_guest_request(request, response.status_code if response is not None else 500)

    app.include_router(api_router, prefix=settings.api_prefix)
    Path(settings.media_root_path).mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=settings.media_root_path), name="media")

    @app.on_event("startup")
    async def start_backup_scheduler() -> None:
        stop_event = asyncio.Event()
        app.state.backup_scheduler_stop = stop_event
        app.state.backup_scheduler_task = asyncio.create_task(backup_scheduler_loop(stop_event))

    @app.on_event("shutdown")
    async def stop_backup_scheduler() -> None:
        stop_event = getattr(app.state, "backup_scheduler_stop", None)
        task = getattr(app.state, "backup_scheduler_task", None)
        if stop_event is not None:
            stop_event.set()
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    return app


app = create_app()
