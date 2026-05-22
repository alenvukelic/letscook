from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_optional_user
from app.core.config import settings
from app.core.sanitizer import validate_recipe_markdown
from app.db.session import get_session
from app.models import (
    Category,
    Favorite,
    Ingredient,
    IngredientTranslation,
    MeasurementUnit,
    Media,
    Rating,
    Recipe,
    RecipeIngredient,
    User,
    UserRole,
)
from app.schemas.recipe import (
    CategoryOption,
    ImageUploadResponse,
    IngredientOption,
    MeasurementUnitOption,
    RatingWrite,
    RecipeDetail,
    RecipeFormOptions,
    RecipeIngredientView,
    RecipeListItem,
    RecipeMediaView,
    RecipeVisibilityUpdate,
    RecipeWrite,
)
from app.services.audit import log_action

router = APIRouter(prefix="/recipes")

ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def user_can_edit_recipe(user: User, recipe: Recipe) -> bool:
    return user.id == recipe.author_id or user.role in {
        UserRole.moderator,
        UserRole.administrator,
        UserRole.superadmin,
    }


def user_can_hide_recipe(user: User) -> bool:
    return user.role in {UserRole.moderator, UserRole.administrator, UserRole.superadmin}


def user_can_delete_recipe(user: User) -> bool:
    return user.role in {UserRole.administrator, UserRole.superadmin}


def user_can_verify_recipe(user: User) -> bool:
    return user.role in {UserRole.moderator, UserRole.administrator, UserRole.superadmin}


def user_can_backup_recipes(user: User) -> bool:
    return user.role == UserRole.superadmin


def recipe_visible_to_user(recipe: Recipe, user: User | None) -> bool:
    if recipe.deleted:
        return bool(user and user_can_delete_recipe(user))
    if not recipe.hidden:
        return True
    if user is None:
        return False
    return user_can_hide_recipe(user)


def serialize_recipe_list_item(
    recipe: Recipe,
    *,
    author_name: str,
    author_username: str,
    category_name: str | None,
    main_image_url: str | None,
    likes_count: int,
    rating_average: float | None,
    ratings_count: int,
    user_liked: bool,
    user_rating: int | None,
    user: User | None,
) -> RecipeListItem:
    return RecipeListItem(
        id=recipe.id,
        title=recipe.title,
        language=recipe.language,
        servings=float(recipe.servings),
        prep_time_minutes=recipe.prep_time_minutes,
        author_complexity=recipe.author_complexity,
        likes_count=likes_count,
        rating_average=rating_average,
        ratings_count=ratings_count,
        user_liked=user_liked,
        user_rating=user_rating,
        verified=recipe.verified,
        category_name=category_name,
        author_name=author_name,
        author_username=author_username,
        hidden=recipe.hidden,
        deleted=recipe.deleted,
        created_at=recipe.created_at,
        updated_at=recipe.updated_at,
        main_image_url=main_image_url,
        can_edit=bool(user and user_can_edit_recipe(user, recipe) and not recipe.deleted),
        can_hide=bool(user and user_can_hide_recipe(user) and not recipe.deleted),
        can_delete=bool(user and user_can_delete_recipe(user)),
        can_verify=bool(user and user_can_verify_recipe(user) and not recipe.deleted),
    )


async def ensure_category_exists(session: AsyncSession, category_id: int | None) -> None:
    if category_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category is required")
    category = await session.scalar(select(Category.id).where(Category.id == category_id))
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category does not exist",
        )


async def ensure_ingredients_exist(session: AsyncSession, ingredient_ids: list[int]) -> None:
    if not ingredient_ids:
        return
    rows = await session.scalars(select(Ingredient.id).where(Ingredient.id.in_(ingredient_ids)))
    found_ids = set(rows)
    missing = sorted(set(ingredient_ids) - found_ids)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown ingredient ids: {missing}",
        )


async def resolve_ingredient_id(session: AsyncSession, row: object, language: str) -> int | None:
    ingredient_id = getattr(row, "ingredient_id", None)
    if ingredient_id:
        return ingredient_id

    ingredient_name = (getattr(row, "ingredient_name", None) or "").strip()
    if not ingredient_name:
        return None

    normalized = ingredient_name.lower()
    existing = await session.scalar(
        select(Ingredient).where(func.lower(Ingredient.canonical_name) == normalized)
    )
    if existing is not None:
        return existing.id

    ingredient = Ingredient(canonical_name=ingredient_name)
    session.add(ingredient)
    await session.flush()
    session.add(
        IngredientTranslation(ingredient_id=ingredient.id, language=language, name=ingredient_name)
    )
    return ingredient.id


async def replace_recipe_ingredients(
    session: AsyncSession,
    recipe_id: int,
    payload: RecipeWrite,
) -> None:
    await session.execute(delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id))
    for sort_order, row in enumerate(payload.ingredients, start=1):
        ingredient_id = await resolve_ingredient_id(session, row, payload.language.lower())
        if ingredient_id is None:
            continue
        session.add(
            RecipeIngredient(
                recipe_id=recipe_id,
                ingredient_id=ingredient_id,
                amount=row.amount,
                unit=row.unit,
                note=row.note,
                sort_order=sort_order,
            )
        )


async def load_recipe_ingredients(
    session: AsyncSession,
    recipe_id: int,
    *,
    language: str,
) -> list[RecipeIngredientView]:
    translation_name = func.max(
        case((IngredientTranslation.language == language, IngredientTranslation.name), else_=None)
    )
    rows = await session.execute(
        select(
            RecipeIngredient.id,
            RecipeIngredient.ingredient_id,
            RecipeIngredient.amount,
            RecipeIngredient.unit,
            RecipeIngredient.note,
            RecipeIngredient.sort_order,
            Ingredient.canonical_name,
            func.coalesce(translation_name, Ingredient.canonical_name).label("ingredient_name"),
        )
        .join(Ingredient, Ingredient.id == RecipeIngredient.ingredient_id)
        .outerjoin(IngredientTranslation, IngredientTranslation.ingredient_id == Ingredient.id)
        .where(RecipeIngredient.recipe_id == recipe_id)
        .group_by(
            RecipeIngredient.id,
            RecipeIngredient.ingredient_id,
            RecipeIngredient.amount,
            RecipeIngredient.unit,
            RecipeIngredient.note,
            RecipeIngredient.sort_order,
            Ingredient.canonical_name,
        )
        .order_by(RecipeIngredient.sort_order.asc(), RecipeIngredient.id.asc())
    )
    ingredients: list[RecipeIngredientView] = []
    for row in rows:
        ingredients.append(
            RecipeIngredientView(
                id=row.id,
                ingredient_id=row.ingredient_id,
                amount=float(row.amount) if isinstance(row.amount, Decimal) else row.amount,
                unit=row.unit,
                note=row.note,
                ingredient_name=row.ingredient_name,
                canonical_name=row.canonical_name,
                sort_order=row.sort_order,
            )
        )
    return ingredients


def media_url(storage_path: str) -> str:
    normalized = storage_path.replace("\\", "/")
    prefix = "var/media/"
    if normalized.startswith(prefix):
        normalized = normalized[len(prefix) :]
    return f"/media/{normalized.lstrip('/')}"


def storage_path_from_media_url(url: str) -> str | None:
    if not url.startswith("/media/"):
        return None
    return f"var/media/{url.removeprefix('/media/').lstrip('/')}"


def media_file_path(storage_path: str) -> Path:
    normalized = storage_path.replace("\\", "/")
    relative_path = normalized.removeprefix("var/media/").lstrip("/")
    return Path(settings.media_root_path) / relative_path


def slugify_filename(value: str, fallback: str = "recept") -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or fallback


def extract_markdown_image_urls(markdown: str) -> list[str]:
    urls = re.findall(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", markdown)
    urls.extend(re.findall(r"<img\s+[^>]*src=[\"']([^\"']+)[\"']", markdown, re.IGNORECASE))
    return urls


async def sync_recipe_markdown_media(
    session: AsyncSession,
    recipe: Recipe,
    markdown: str,
    current_user: User,
) -> None:
    storage_paths = [
        storage_path
        for url in extract_markdown_image_urls(markdown)
        if (storage_path := storage_path_from_media_url(url)) is not None
    ]
    if not storage_paths:
        recipe.main_media_id = None
        return

    media_rows = await session.scalars(select(Media).where(Media.storage_path.in_(storage_paths)))
    media_by_path = {media.storage_path: media for media in media_rows}
    first_media = media_by_path.get(storage_paths[0])
    if first_media is not None:
        recipe.main_media_id = first_media.id

    for media in media_by_path.values():
        if media.owner_id in {None, current_user.id} or media.recipe_id == recipe.id:
            media.recipe_id = recipe.id


def markdown_to_plain_steps(markdown: str) -> list[str]:
    lines = []
    for line in markdown.splitlines():
        text = line.strip()
        text = re.sub(r"^#{1,6}\s+", "", text)
        text = re.sub(r"^(?:[-*+] |\d+\.\s+)", "", text)
        text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        text = re.sub(r"[*_`~]", "", text).strip()
        if text:
            lines.append(text)
    return lines


async def load_recipe_media(session: AsyncSession, recipe_id: int) -> list[RecipeMediaView]:
    rows = await session.execute(
        select(Media.id, Media.original_filename, Media.storage_path, Media.width, Media.height)
        .where(Media.recipe_id == recipe_id)
        .order_by(Media.id.asc())
    )
    return [
        RecipeMediaView(
            id=row.id,
            original_filename=row.original_filename,
            url=media_url(row.storage_path),
            width=row.width,
            height=row.height,
        )
        for row in rows
    ]


def extract_steps(steps_html: str) -> list[str]:
    ordered_matches = re.findall(r"<li>(.*?)</li>", steps_html, flags=re.IGNORECASE | re.DOTALL)
    if ordered_matches:
        return [re.sub(r"<[^>]+>", "", item).strip() for item in ordered_matches if item.strip()]

    paragraph_matches = re.findall(r"<p>(.*?)</p>", steps_html, flags=re.IGNORECASE | re.DOTALL)
    return [re.sub(r"<[^>]+>", "", item).strip() for item in paragraph_matches if item.strip()]


async def load_recipe_interactions(
    session: AsyncSession, recipe_ids: list[int], user: User | None
) -> dict[int, dict[str, int | float | bool | None]]:
    if not recipe_ids:
        return {}

    data = {
        recipe_id: {
            "likes_count": 0,
            "rating_average": None,
            "ratings_count": 0,
            "user_liked": False,
            "user_rating": None,
        }
        for recipe_id in recipe_ids
    }

    like_rows = await session.execute(
        select(Favorite.recipe_id, func.count(Favorite.user_id))
        .where(Favorite.recipe_id.in_(recipe_ids))
        .group_by(Favorite.recipe_id)
    )
    for recipe_id, count in like_rows:
        data[recipe_id]["likes_count"] = int(count)

    rating_rows = await session.execute(
        select(Rating.recipe_id, func.avg(Rating.rating), func.count(Rating.user_id))
        .where(Rating.recipe_id.in_(recipe_ids))
        .group_by(Rating.recipe_id)
    )
    for recipe_id, average, count in rating_rows:
        data[recipe_id]["rating_average"] = (
            round(float(average), 1) if average is not None else None
        )
        data[recipe_id]["ratings_count"] = int(count)

    if user is not None:
        user_like_rows = await session.scalars(
            select(Favorite.recipe_id).where(
                Favorite.recipe_id.in_(recipe_ids), Favorite.user_id == user.id
            )
        )
        for recipe_id in user_like_rows:
            data[recipe_id]["user_liked"] = True

        user_rating_rows = await session.execute(
            select(Rating.recipe_id, Rating.rating).where(
                Rating.recipe_id.in_(recipe_ids), Rating.user_id == user.id
            )
        )
        for recipe_id, rating in user_rating_rows:
            data[recipe_id]["user_rating"] = rating

    return data


@router.get("", response_model=list[RecipeListItem])
async def list_recipes(
    q: str | None = Query(default=None),
    mine: bool = Query(default=False),
    favorites: bool = Query(default=False),
    author_id: int | None = Query(default=None),
    include_hidden: bool = Query(default=False),
    unverified: bool = Query(default=False),
    current_user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> list[RecipeListItem]:
    statement: Select[tuple[Recipe, str, str, str | None, str | None]] = (
        select(Recipe, User.display_name, User.email, Category.name, Media.storage_path)
        .join(User, User.id == Recipe.author_id)
        .outerjoin(Category, Category.id == Recipe.category_id)
        .outerjoin(Media, Media.id == Recipe.main_media_id)
    )

    if q:
        pattern = f"%{q.strip()}%"
        statement = (
            statement.outerjoin(RecipeIngredient, RecipeIngredient.recipe_id == Recipe.id)
            .outerjoin(Ingredient, Ingredient.id == RecipeIngredient.ingredient_id)
            .outerjoin(IngredientTranslation, IngredientTranslation.ingredient_id == Ingredient.id)
            .where(
                or_(
                    Recipe.title.ilike(pattern),
                    Recipe.content_markdown.ilike(pattern),
                    Recipe.steps_html.ilike(pattern),
                    RecipeIngredient.note.ilike(pattern),
                    Ingredient.canonical_name.ilike(pattern),
                    IngredientTranslation.name.ilike(pattern),
                )
            )
        )

    if unverified:
        if current_user is None or not user_can_verify_recipe(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot view unverified recipes queue",
            )
        statement = statement.where(Recipe.verified.is_(False))

    if include_hidden and (current_user is None or not user_can_hide_recipe(current_user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot include hidden recipes",
        )

    if author_id is not None:
        if current_user is None or not user_can_delete_recipe(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot inspect another user's recipes",
            )
        statement = statement.where(Recipe.author_id == author_id)

    if favorites:
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
            )
        statement = statement.join(Favorite, Favorite.recipe_id == Recipe.id).where(
            Favorite.user_id == current_user.id,
            Recipe.deleted.is_(False),
        )
        if not include_hidden:
            statement = statement.where(Recipe.hidden.is_(False))
    elif mine:
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
            )
        statement = statement.where(
            Recipe.author_id == current_user.id,
            Recipe.deleted.is_(False),
        )
        if not include_hidden:
            statement = statement.where(Recipe.hidden.is_(False))
    else:
        if current_user is None:
            statement = statement.where(Recipe.hidden.is_(False), Recipe.deleted.is_(False))
        elif include_hidden:
            statement = statement.where(Recipe.deleted.is_(False))
        else:
            statement = statement.where(Recipe.hidden.is_(False), Recipe.deleted.is_(False))

    rows = await session.execute(statement.order_by(Recipe.created_at.desc()).distinct())
    results = rows.all()
    interactions = await load_recipe_interactions(
        session, [recipe.id for recipe, *_ in results], current_user
    )
    return [
        serialize_recipe_list_item(
            recipe,
            author_name=author_name,
            author_username=author_email.split("@", 1)[0],
            category_name=category_name,
            main_image_url=media_url(storage_path) if storage_path else None,
            likes_count=int(interactions[recipe.id]["likes_count"] or 0),
            rating_average=interactions[recipe.id]["rating_average"],
            ratings_count=int(interactions[recipe.id]["ratings_count"] or 0),
            user_liked=bool(interactions[recipe.id]["user_liked"]),
            user_rating=interactions[recipe.id]["user_rating"],
            user=current_user,
        )
        for recipe, author_name, author_email, category_name, storage_path in results
    ]


@router.get("/backup")
async def backup_recipes(
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    if not user_can_backup_recipes(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin can create full recipe backups",
        )

    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    root_folder = f"backup_{timestamp}"
    archive = io.BytesIO()
    rows = await session.execute(
        select(Recipe, User.email, User.display_name, Category.slug, Category.name)
        .join(User, User.id == Recipe.author_id)
        .outerjoin(Category, Category.id == Recipe.category_id)
        .order_by(Category.name.asc().nulls_last(), Recipe.title.asc(), Recipe.id.asc())
    )
    recipes = rows.all()

    restore_notes = f"""# LetsCook backup restore

Backup folder: {root_folder}

Each recipe markdown file starts with a `<!-- letscook-backup ... -->` JSON block. Use that metadata to restore the author, category, recipe fields, ingredients, ratings, favorites and media links.

Restore procedure:
1. Extract the ZIP.
2. For each category folder, parse every `.md` file.
3. Read the JSON block between `<!-- letscook-backup` and `-->`.
4. Recreate or map the author by `author.email` and the category by `category.slug` or `category.name`.
5. Copy image files from the same folder into local media storage, create `media` rows, and replace Markdown image paths with the restored `/media/...` URLs.
6. Insert/update `recipes`, then restore `recipe_ingredients`, ratings and favorites where the referenced users exist.
7. Set `main_media` from the first media item marked as `is_main` or from the first Markdown image.

Image filenames in Markdown are local filenames from the same folder, so the importer can reliably reconnect them.
"""

    with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr(f"{root_folder}/RESTORE.md", restore_notes)
        used_paths: set[str] = set()
        for recipe, author_email, author_name, category_slug, category_name in recipes:
            category_folder = slugify_filename(category_slug or category_name or "bez-kategorije", "bez-kategorije")
            recipe_slug = slugify_filename(recipe.title, f"recept-{recipe.id}")
            base_path = f"{root_folder}/{category_folder}/{recipe_slug}"
            markdown_path = f"{base_path}.md"
            if markdown_path in used_paths:
                base_path = f"{base_path}-{recipe.id}"
                markdown_path = f"{base_path}.md"
            used_paths.add(markdown_path)

            ingredients = await load_recipe_ingredients(session, recipe.id, language=recipe.language)
            media_rows = (await session.scalars(select(Media).where(Media.recipe_id == recipe.id))).all()
            ratings = await session.execute(
                select(User.email, Rating.rating, Rating.created_at, Rating.updated_at)
                .join(User, User.id == Rating.user_id)
                .where(Rating.recipe_id == recipe.id)
            )
            favorites = await session.execute(
                select(User.email, Favorite.created_at)
                .join(User, User.id == Favorite.user_id)
                .where(Favorite.recipe_id == recipe.id)
            )

            markdown = recipe.content_markdown or recipe.steps_html or ""
            media_exports = []
            for index, media in enumerate(media_rows, start=1):
                extension = Path(media.stored_filename).suffix or Path(media.original_filename).suffix or ".bin"
                image_filename = f"{recipe_slug}-{index:02d}{extension.lower()}"
                source_path = media_file_path(media.storage_path)
                if source_path.exists():
                    zip_file.write(source_path, f"{root_folder}/{category_folder}/{image_filename}")
                old_url = media_url(media.storage_path)
                markdown = markdown.replace(old_url, image_filename)
                media_exports.append(
                    {
                        "id": media.id,
                        "filename": image_filename,
                        "original_filename": media.original_filename,
                        "stored_filename": media.stored_filename,
                        "mime_type": media.mime_type,
                        "byte_size": media.byte_size,
                        "width": media.width,
                        "height": media.height,
                        "is_main": media.id == recipe.main_media_id,
                    }
                )

            metadata = {
                "backup_version": 1,
                "recipe": {
                    "id": recipe.id,
                    "title": recipe.title,
                    "language": recipe.language,
                    "prep_time_minutes": recipe.prep_time_minutes,
                    "servings": float(recipe.servings),
                    "author_complexity": recipe.author_complexity,
                    "verified": recipe.verified,
                    "hidden": recipe.hidden,
                    "deleted": recipe.deleted,
                    "created_at": recipe.created_at.isoformat() if recipe.created_at else None,
                    "updated_at": recipe.updated_at.isoformat() if recipe.updated_at else None,
                },
                "author": {"id": recipe.author_id, "email": author_email, "display_name": author_name},
                "category": {"id": recipe.category_id, "slug": category_slug, "name": category_name},
                "ingredients": [ingredient.model_dump() for ingredient in ingredients],
                "media": media_exports,
                "ratings": [
                    {
                        "user_email": row.email,
                        "rating": row.rating,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                    }
                    for row in ratings
                ],
                "favorites": [
                    {
                        "user_email": row.email,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                    for row in favorites
                ],
            }
            file_content = (
                "<!-- letscook-backup\n"
                f"{json.dumps(metadata, ensure_ascii=False, indent=2)}\n"
                "-->\n\n"
                f"{markdown}\n"
            )
            zip_file.writestr(markdown_path, file_content)

    await log_action(
        session,
        code="recipes.backup_created",
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        request=request,
        extra={"recipe_count": len(recipes), "backup_folder": root_folder},
    )
    await session.commit()
    archive.seek(0)
    filename = f"{root_folder}.zip"
    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/options", response_model=RecipeFormOptions)
async def recipe_options(
    language: str = Query(default="hr", min_length=2, max_length=2),
    session: AsyncSession = Depends(get_session),
) -> RecipeFormOptions:
    category_rows = await session.execute(
        select(Category.id, Category.name).order_by(Category.name.asc())
    )
    ingredient_rows = await session.execute(
        select(
            Ingredient.id,
            Ingredient.canonical_name,
            func.coalesce(
                func.max(
                    case(
                        (IngredientTranslation.language == language, IngredientTranslation.name),
                        else_=None,
                    )
                ),
                Ingredient.canonical_name,
            ).label("name"),
        )
        .outerjoin(IngredientTranslation, IngredientTranslation.ingredient_id == Ingredient.id)
        .group_by(Ingredient.id, Ingredient.canonical_name)
        .order_by(
            func.coalesce(
                func.max(
                    case(
                        (IngredientTranslation.language == language, IngredientTranslation.name),
                        else_=None,
                    )
                ),
                Ingredient.canonical_name,
            )
        )
    )
    unit_rows = await session.execute(
        select(MeasurementUnit.code, MeasurementUnit.label).order_by(
            MeasurementUnit.sort_order.asc(), MeasurementUnit.label.asc()
        )
    )
    return RecipeFormOptions(
        categories=[CategoryOption(id=row.id, name=row.name) for row in category_rows],
        ingredients=[
            IngredientOption(id=row.id, canonical_name=row.canonical_name, name=row.name)
            for row in ingredient_rows
        ],
        units=[MeasurementUnitOption(code=row.code, label=row.label) for row in unit_rows],
    )


@router.post("/media", response_model=ImageUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_recipe_image(
    request: Request,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ImageUploadResponse:
    extension = ALLOWED_IMAGE_MIME_TYPES.get(image.content_type or "")
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only JPEG, PNG, and WebP images are supported",
        )

    content = await image.read()
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image must be between 1 byte and 5 MB",
        )

    uploads_dir = Path(settings.media_root_path) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    stored_filename = f"{uuid4().hex}{extension}"
    storage_path = f"var/media/uploads/{stored_filename}"
    (uploads_dir / stored_filename).write_bytes(content)

    media = Media(
        owner_id=current_user.id,
        recipe_id=None,
        original_filename=image.filename or stored_filename,
        stored_filename=stored_filename,
        mime_type=image.content_type or "application/octet-stream",
        byte_size=len(content),
        width=None,
        height=None,
        storage_path=storage_path,
    )
    session.add(media)
    await session.flush()
    await log_action(
        session,
        code="media.uploaded",
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        request=request,
        extra={"table": "media", "record_id": media.id, "filename": stored_filename},
    )
    await session.commit()
    return ImageUploadResponse(url=media_url(storage_path))


@router.get("/{recipe_id}", response_model=RecipeDetail)
async def recipe_detail(
    recipe_id: int,
    language: str = Query(default="hr", min_length=2, max_length=2),
    current_user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> RecipeDetail:
    row = await session.execute(
        select(Recipe, User.display_name, User.email, Category.name, Media.storage_path)
        .join(User, User.id == Recipe.author_id)
        .outerjoin(Category, Category.id == Recipe.category_id)
        .outerjoin(Media, Media.id == Recipe.main_media_id)
        .where(Recipe.id == recipe_id)
    )
    result = row.first()
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    recipe, author_name, author_email, category_name, storage_path = result
    if not recipe_visible_to_user(recipe, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    ingredients = await load_recipe_ingredients(session, recipe.id, language=language)
    media = await load_recipe_media(session, recipe.id)
    interactions = await load_recipe_interactions(session, [recipe.id], current_user)
    list_item = serialize_recipe_list_item(
        recipe,
        author_name=author_name,
        author_username=author_email.split("@", 1)[0],
        category_name=category_name,
        main_image_url=media_url(storage_path) if storage_path else None,
        likes_count=int(interactions[recipe.id]["likes_count"] or 0),
        rating_average=interactions[recipe.id]["rating_average"],
        ratings_count=int(interactions[recipe.id]["ratings_count"] or 0),
        user_liked=bool(interactions[recipe.id]["user_liked"]),
        user_rating=interactions[recipe.id]["user_rating"],
        user=current_user,
    )
    return RecipeDetail(
        **list_item.model_dump(),
        category_id=recipe.category_id,
        content_markdown=recipe.content_markdown or recipe.steps_html,
        steps_html=recipe.steps_html,
        steps=markdown_to_plain_steps(recipe.content_markdown) or extract_steps(recipe.steps_html),
        author_id=recipe.author_id,
        ingredients=ingredients,
        media=media,
    )


@router.post("", response_model=RecipeDetail, status_code=status.HTTP_201_CREATED)
async def create_recipe(
    payload: RecipeWrite,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecipeDetail:
    await ensure_category_exists(session, payload.category_id)
    await ensure_ingredients_exist(
        session, [row.ingredient_id for row in payload.ingredients if row.ingredient_id]
    )

    try:
        content_markdown = validate_recipe_markdown(payload.content_markdown)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    recipe = Recipe(
        author_id=current_user.id,
        category_id=payload.category_id,
        title=payload.title.strip(),
        language=payload.language.lower(),
        steps_html="",
        content_markdown=content_markdown,
        prep_time_minutes=payload.prep_time_minutes,
        servings=payload.servings,
        author_complexity=payload.author_complexity,
        verified=False,
        hidden=False,
        deleted=False,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(recipe)
    await session.flush()
    await sync_recipe_markdown_media(session, recipe, content_markdown, current_user)
    await replace_recipe_ingredients(session, recipe.id, payload)
    await log_action(
        session,
        code="recipe.created",
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        request=request,
        extra={"table": "recipes", "record_id": recipe.id},
    )
    await session.commit()
    return await recipe_detail(
        recipe.id,
        language=payload.language.lower(),
        current_user=current_user,
        session=session,
    )


@router.put("/{recipe_id}", response_model=RecipeDetail)
async def update_recipe(
    recipe_id: int,
    payload: RecipeWrite,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecipeDetail:
    recipe = await session.get(Recipe, recipe_id)
    if recipe is None or recipe.deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")
    if not user_can_edit_recipe(current_user, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot edit this recipe",
        )

    await ensure_category_exists(session, payload.category_id)
    await ensure_ingredients_exist(
        session, [row.ingredient_id for row in payload.ingredients if row.ingredient_id]
    )

    recipe.title = payload.title.strip()
    recipe.category_id = payload.category_id
    recipe.language = payload.language.lower()
    try:
        recipe.content_markdown = validate_recipe_markdown(payload.content_markdown)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    recipe.steps_html = ""
    await sync_recipe_markdown_media(session, recipe, recipe.content_markdown, current_user)
    recipe.prep_time_minutes = payload.prep_time_minutes
    recipe.servings = payload.servings
    recipe.author_complexity = payload.author_complexity
    recipe.updated_at = datetime.now(UTC)

    await replace_recipe_ingredients(session, recipe.id, payload)
    await log_action(
        session,
        code="recipe.updated",
        actor_user_id=current_user.id,
        target_user_id=recipe.author_id,
        request=request,
        extra={"table": "recipes", "record_id": recipe.id},
    )
    await session.commit()
    return await recipe_detail(
        recipe.id,
        language=payload.language.lower(),
        current_user=current_user,
        session=session,
    )


@router.patch("/{recipe_id}/visibility", response_model=RecipeDetail)
async def update_recipe_visibility(
    recipe_id: int,
    payload: RecipeVisibilityUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecipeDetail:
    recipe = await session.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    if payload.hidden is not None:
        if not user_can_hide_recipe(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot hide recipes",
            )
        recipe.hidden = payload.hidden
        recipe.updated_at = datetime.now(UTC)
        await log_action(
            session,
            code="recipe.hidden",
            actor_user_id=current_user.id,
            target_user_id=recipe.author_id,
            request=request,
            extra={"table": "recipes", "record_id": recipe.id, "hidden": payload.hidden},
        )

    if payload.deleted is not None:
        if not user_can_delete_recipe(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot delete recipes",
            )
        recipe.deleted = payload.deleted
        recipe.updated_at = datetime.now(UTC)
        await log_action(
            session,
            code="recipe.deleted",
            actor_user_id=current_user.id,
            target_user_id=recipe.author_id,
            request=request,
            extra={"table": "recipes", "record_id": recipe.id, "deleted": payload.deleted},
        )

    if payload.verified is not None:
        if not user_can_verify_recipe(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot verify recipes",
            )
        recipe.verified = payload.verified
        recipe.updated_at = datetime.now(UTC)
        await log_action(
            session,
            code="recipe.verified",
            actor_user_id=current_user.id,
            target_user_id=recipe.author_id,
            request=request,
            extra={"table": "recipes", "record_id": recipe.id, "verified": payload.verified},
        )

    await session.commit()
    return await recipe_detail(
        recipe.id,
        language=recipe.language,
        current_user=current_user,
        session=session,
    )


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def hard_delete_recipe(
    recipe_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    if not user_can_delete_recipe(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot permanently delete recipes",
        )

    recipe = await session.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    media_rows = (await session.scalars(select(Media).where(Media.recipe_id == recipe_id))).all()
    files_to_delete = [media_file_path(media.storage_path) for media in media_rows]
    recipe.main_media_id = None
    await session.flush()
    await session.execute(delete(Favorite).where(Favorite.recipe_id == recipe_id))
    await session.execute(delete(Rating).where(Rating.recipe_id == recipe_id))
    await session.execute(delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id))
    await session.execute(delete(Media).where(Media.recipe_id == recipe_id))
    await log_action(
        session,
        code="recipe.hard_deleted",
        actor_user_id=current_user.id,
        target_user_id=recipe.author_id,
        request=request,
        extra={"table": "recipes", "record_id": recipe.id, "title": recipe.title},
    )
    await session.delete(recipe)
    await session.commit()

    for file_path in files_to_delete:
        try:
            if file_path.exists():
                file_path.unlink()
        except OSError:
            continue


@router.put("/{recipe_id}/like", response_model=RecipeDetail)
async def like_recipe(
    recipe_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecipeDetail:
    recipe = await session.get(Recipe, recipe_id)
    if recipe is None or not recipe_visible_to_user(recipe, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    existing = await session.get(Favorite, {"recipe_id": recipe_id, "user_id": current_user.id})
    if existing is None:
        session.add(Favorite(recipe_id=recipe_id, user_id=current_user.id))
        await log_action(
            session,
            code="favorite.saved",
            actor_user_id=current_user.id,
            target_user_id=recipe.author_id,
            request=request,
            extra={"table": "favorites", "record_id": recipe_id},
        )
    await session.commit()
    return await recipe_detail(
        recipe_id,
        language=recipe.language,
        current_user=current_user,
        session=session,
    )


@router.delete("/{recipe_id}/like", response_model=RecipeDetail)
async def unlike_recipe(
    recipe_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecipeDetail:
    recipe = await session.get(Recipe, recipe_id)
    if recipe is None or not recipe_visible_to_user(recipe, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    existing = await session.get(Favorite, {"recipe_id": recipe_id, "user_id": current_user.id})
    if existing is not None:
        await session.delete(existing)
        await log_action(
            session,
            code="favorite.removed",
            actor_user_id=current_user.id,
            target_user_id=recipe.author_id,
            request=request,
            extra={"table": "favorites", "record_id": recipe_id},
        )
    await session.commit()
    return await recipe_detail(
        recipe_id,
        language=recipe.language,
        current_user=current_user,
        session=session,
    )


@router.put("/{recipe_id}/rating", response_model=RecipeDetail)
async def rate_recipe(
    recipe_id: int,
    payload: RatingWrite,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecipeDetail:
    recipe = await session.get(Recipe, recipe_id)
    if recipe is None or not recipe_visible_to_user(recipe, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    rating = await session.get(Rating, {"recipe_id": recipe_id, "user_id": current_user.id})
    if rating is None:
        rating = Rating(recipe_id=recipe_id, user_id=current_user.id, rating=payload.rating)
        session.add(rating)
    else:
        rating.rating = payload.rating
        rating.updated_at = datetime.now(UTC)
    await log_action(
        session,
        code="rating.saved",
        actor_user_id=current_user.id,
        target_user_id=recipe.author_id,
        request=request,
        extra={"table": "ratings", "record_id": recipe_id, "rating": payload.rating},
    )
    await session.commit()
    return await recipe_detail(
        recipe_id,
        language=recipe.language,
        current_user=current_user,
        session=session,
    )
