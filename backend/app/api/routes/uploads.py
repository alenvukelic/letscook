from __future__ import annotations

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.routes.recipes import upload_recipe_image
from app.db.session import get_session
from app.models import User
from app.schemas.recipe import ImageUploadResponse

router = APIRouter()


@router.post("/upload", response_model=ImageUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_image(
    request: Request,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ImageUploadResponse:
    return await upload_recipe_image(request, image, current_user, session)
