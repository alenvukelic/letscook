from __future__ import annotations

import asyncio
import json
import re
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import async_session_factory
from app.models import Category, Favorite, Ingredient, IngredientTranslation, Media, Rating, Recipe, RecipeIngredient, User
from app.schemas.audit import BackupFileEntry, BackupSchedule


def backup_root_path() -> Path:
    return Path(settings.backup_root_path) / "recipes"


def backup_settings_path() -> Path:
    return backup_root_path() / "schedule.json"


def ensure_backup_storage() -> Path:
    root = backup_root_path()
    root.mkdir(parents=True, exist_ok=True)
    return root


def media_url(storage_path: str) -> str:
    normalized = storage_path.replace("\\", "/")
    prefix = "var/media/"
    if normalized.startswith(prefix):
        normalized = normalized[len(prefix) :]
    return f"/media/{normalized.lstrip('/')}"


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


def markdown_to_plain_steps(markdown: str) -> list[str]:
    lines: list[str] = []
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


def extract_steps(steps_html: str) -> list[str]:
    ordered_matches = re.findall(r"<li>(.*?)</li>", steps_html, flags=re.IGNORECASE | re.DOTALL)
    if ordered_matches:
        return [re.sub(r"<[^>]+>", "", item).strip() for item in ordered_matches if item.strip()]

    paragraph_matches = re.findall(r"<p>(.*?)</p>", steps_html, flags=re.IGNORECASE | re.DOTALL)
    return [re.sub(r"<[^>]+>", "", item).strip() for item in paragraph_matches if item.strip()]


async def load_recipe_ingredients(
    session: AsyncSession,
    recipe_id: int,
    *,
    language: str,
) -> list[dict[str, object]]:
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
    ingredients: list[dict[str, object]] = []
    for row in rows:
        ingredients.append(
            {
                "id": row.id,
                "ingredient_id": row.ingredient_id,
                "amount": float(row.amount) if isinstance(row.amount, Decimal) else row.amount,
                "unit": row.unit,
                "note": row.note,
                "ingredient_name": row.ingredient_name,
                "canonical_name": row.canonical_name,
                "sort_order": row.sort_order,
            }
        )
    return ingredients


def load_backup_schedule() -> BackupSchedule:
    default = BackupSchedule(enabled=False, cron_expression="0 2 * * *", retention_count=10)
    path = backup_settings_path()
    if not path.exists():
        return default
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return BackupSchedule.model_validate({**default.model_dump(), **payload})


def save_backup_schedule(schedule: BackupSchedule) -> None:
    ensure_backup_storage()
    backup_settings_path().write_text(
        json.dumps(schedule.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _backup_metadata_path(filename: str) -> Path:
    return backup_root_path() / f"{Path(filename).stem}.json"


def _read_backup_metadata(path: Path) -> dict[str, object] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def list_backup_files() -> list[BackupFileEntry]:
    root = ensure_backup_storage()
    entries: list[BackupFileEntry] = []
    for zip_path in sorted(root.glob("backup_*.zip"), key=lambda item: item.stat().st_mtime, reverse=True):
        metadata = _read_backup_metadata(_backup_metadata_path(zip_path.name)) or {}
        created_at = datetime.fromtimestamp(zip_path.stat().st_mtime, tz=UTC)
        entries.append(
            BackupFileEntry(
                filename=zip_path.name,
                created_at=datetime.fromisoformat(str(metadata.get("created_at")))
                if metadata.get("created_at")
                else created_at,
                updated_at=datetime.fromisoformat(str(metadata.get("updated_at")))
                if metadata.get("updated_at")
                else created_at,
                byte_size=int(metadata.get("byte_size") or zip_path.stat().st_size),
                recipe_count=int(metadata.get("recipe_count") or 0),
                trigger=str(metadata.get("trigger") or "manual"),
                reason=metadata.get("reason") if isinstance(metadata.get("reason"), str) else None,
                download_url=f"/api/recipes/backups/{zip_path.name}",
            )
        )
    return entries


def cleanup_backup_retention(retention_count: int) -> None:
    root = ensure_backup_storage()
    if retention_count <= 0:
        retention_count = 1
    backups = sorted(root.glob("backup_*.zip"), key=lambda item: item.stat().st_mtime, reverse=True)
    for stale_path in backups[retention_count:]:
        metadata_path = _backup_metadata_path(stale_path.name)
        try:
            stale_path.unlink(missing_ok=True)
        except OSError:
            pass
        try:
            metadata_path.unlink(missing_ok=True)
        except OSError:
            pass


def _cron_field_matches(field: str, value: int, *, minimum: int, maximum: int) -> bool:
    field = field.strip()
    if field == "*":
        return True
    for chunk in field.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk.startswith("*/"):
            try:
                step = int(chunk[2:])
            except ValueError:
                continue
            if step > 0 and value % step == 0:
                return True
            continue
        if "-" in chunk:
            start_text, end_text = chunk.split("-", 1)
            try:
                start = int(start_text)
                end = int(end_text)
            except ValueError:
                continue
            if minimum <= start <= end <= maximum and start <= value <= end:
                return True
            continue
        try:
            if int(chunk) == value:
                return True
        except ValueError:
            continue
    return False


def cron_matches(expression: str, moment: datetime) -> bool:
    parts = expression.split()
    if len(parts) != 5:
        return False
    minute, hour, day, month, weekday = parts
    return (
        _cron_field_matches(minute, moment.minute, minimum=0, maximum=59)
        and _cron_field_matches(hour, moment.hour, minimum=0, maximum=23)
        and _cron_field_matches(day, moment.day, minimum=1, maximum=31)
        and _cron_field_matches(month, moment.month, minimum=1, maximum=12)
        and _cron_field_matches(weekday, moment.weekday(), minimum=0, maximum=6)
    )


def next_cron_run(expression: str, from_time: datetime | None = None) -> datetime | None:
    cursor = (from_time or datetime.now(UTC)).replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(525600):
        if cron_matches(expression, cursor):
            return cursor
        cursor += timedelta(minutes=1)
    return None


async def build_recipe_backup_archive(session: AsyncSession, destination: Path) -> dict[str, object]:
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    root_folder = f"backup_{timestamp}"
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

    ensure_backup_storage()
    with zipfile.ZipFile(destination, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
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
                    "servings": float(recipe.servings) if recipe.servings is not None else None,
                    "author_complexity": recipe.author_complexity,
                    "verified": recipe.verified,
                    "hidden": recipe.hidden,
                    "deleted": recipe.deleted,
                    "created_at": recipe.created_at.isoformat() if recipe.created_at else None,
                    "updated_at": recipe.updated_at.isoformat() if recipe.updated_at else None,
                },
                "author": {"id": recipe.author_id, "email": author_email, "display_name": author_name},
                "category": {"id": recipe.category_id, "slug": category_slug, "name": category_name},
                "ingredients": ingredients,
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

    size_bytes = destination.stat().st_size
    created_at = datetime.fromtimestamp(destination.stat().st_mtime, tz=UTC)
    metadata = {
        "created_at": created_at.isoformat(),
        "updated_at": created_at.isoformat(),
        "byte_size": size_bytes,
        "recipe_count": len(recipes),
        "trigger": "manual",
        "reason": "full recipe backup",
        "filename": destination.name,
    }
    _backup_metadata_path(destination.name).write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return metadata


async def create_recipe_backup_file(
    session: AsyncSession,
    *,
    trigger: str,
    reason: str | None = None,
) -> tuple[Path, dict[str, object]]:
    root = ensure_backup_storage()
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    destination = root / f"backup_{timestamp}_{uuid4().hex[:8]}.zip"
    metadata = await build_recipe_backup_archive(session, destination)
    metadata["trigger"] = trigger
    if reason is not None:
        metadata["reason"] = reason
    _backup_metadata_path(destination.name).write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return destination, metadata


def ensure_valid_backup_filename(filename: str) -> Path:
    root = ensure_backup_storage().resolve()
    candidate = (root / filename).resolve()
    if candidate.parent != root or candidate.suffix.lower() != ".zip":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup file was not found")
    if not candidate.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup file was not found")
    return candidate


async def run_scheduled_backup_once() -> Path | None:
    schedule = load_backup_schedule()
    if not schedule.enabled:
        return None

    now = datetime.now(UTC).replace(second=0, microsecond=0)
    if not cron_matches(schedule.cron_expression, now):
        return None
    if schedule.last_run_at is not None and schedule.last_run_at.astimezone(UTC).replace(second=0, microsecond=0) == now:
        return None

    async with async_session_factory() as session:
        destination, _metadata = await create_recipe_backup_file(
            session,
            trigger="schedule",
            reason="scheduled backup",
        )
        schedule.last_run_at = datetime.now(UTC)
        schedule.next_run_at = next_cron_run(schedule.cron_expression, schedule.last_run_at)
        save_backup_schedule(schedule)
        cleanup_backup_retention(schedule.retention_count)
        return destination


async def backup_scheduler_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_scheduled_backup_once()
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=60)
        except TimeoutError:
            continue


def refresh_backup_schedule_schedule() -> BackupSchedule:
    schedule = load_backup_schedule()
    schedule.next_run_at = next_cron_run(schedule.cron_expression, datetime.now(UTC)) if schedule.enabled else None
    save_backup_schedule(schedule)
    return schedule
