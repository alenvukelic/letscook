from fastapi import APIRouter

from app.schemas.meta import SystemMetadata

router = APIRouter()


@router.get("/system", response_model=SystemMetadata)
async def system_metadata() -> SystemMetadata:
    return SystemMetadata(
        name="LetsCook",
        languages=["hr", "en", "de"],
        roles=["user", "moderator", "administrator", "superadmin"],
        features=[
            "recipes",
            "ingredients",
            "ratings",
            "complexity votes",
            "favorites",
            "comments",
            "moderation",
            "unified action log",
        ],
    )
