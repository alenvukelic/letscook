from fastapi import APIRouter

from app.api.routes import auth, health, meta, recipes, users

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(meta.router, prefix="/meta", tags=["meta"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(recipes.router, tags=["recipes"])
api_router.include_router(users.router, tags=["users"])
