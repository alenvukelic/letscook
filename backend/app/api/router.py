from fastapi import APIRouter

from app.api.routes import audit, auth, health, meta, recipes, uploads, users

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(meta.router, prefix="/meta", tags=["meta"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(audit.router, tags=["audit"])
api_router.include_router(recipes.router, tags=["recipes"])
api_router.include_router(uploads.router, tags=["uploads"])
api_router.include_router(users.router, tags=["users"])
