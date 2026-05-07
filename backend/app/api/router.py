from fastapi import APIRouter

from app.api.routes import health, meta

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(meta.router, prefix="/meta", tags=["meta"])
