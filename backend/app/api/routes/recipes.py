from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import Select, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_optional_user
from app.core.sanitizer import sanitize_recipe_html
from app.db.session import get_session
from app.models import (
    Category,
    Ingredient,
    IngredientTranslation,
    Media,
    Recipe,
    RecipeIngredient,
    User,
    UserRole,
)
from app.schemas.recipe import (
    CategoryOption,
    IngredientOption,
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


def user_can_edit_recipe(user: User, recipe: Recipe) -> bool:
    return user.id == recipe.author_id or user.role == UserRole.superadmin


def user_can_hide_recipe(user: User) -> bool:
    return user.role in {UserRole.moderator, UserRole.administrator, UserRole.superadmin}


def user_can_delete_recipe(user: User) -> bool:
    return user.role in {UserRole.administrator, UserRole.superadmin}


def recipe_visible_to_user(recipe: Recipe, user: User | None) -> bool:
    if recipe.deleted:
        return bool(user and user_can_delete_recipe(user))
    if not recipe.hidden:
        return True
    if user is None:
        return False
    return recipe.author_id == user.id or user_can_hide_recipe(user)


def serialize_recipe_list_item(
    recipe: Recipe,
    *,
    author_name: str,
    author_username: str,
    category_name: str | None,
    main_image_url: str | None,
    user: User | None,
) -> RecipeListItem:
    return RecipeListItem(
        id=recipe.id,
        title=recipe.title,
        language=recipe.language,
        servings=float(recipe.servings),
        author_complexity=recipe.author_complexity,
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
    )


async def ensure_category_exists(session: AsyncSession, category_id: int | None) -> None:
    if category_id is None:
        return
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


async def replace_recipe_ingredients(
    session: AsyncSession,
    recipe_id: int,
    payload: RecipeWrite,
) -> None:
    await session.execute(delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id))
    for sort_order, row in enumerate(payload.ingredients, start=1):
        session.add(
            RecipeIngredient(
                recipe_id=recipe_id,
                ingredient_id=row.ingredient_id,
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


@router.get("", response_model=list[RecipeListItem])
async def list_recipes(
    q: str | None = Query(default=None),
    mine: bool = Query(default=False),
    include_hidden: bool = Query(default=False),
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
                    Recipe.steps_html.ilike(pattern),
                    RecipeIngredient.note.ilike(pattern),
                    Ingredient.canonical_name.ilike(pattern),
                    IngredientTranslation.name.ilike(pattern),
                )
            )
        )

    if mine:
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
            )
        statement = statement.where(Recipe.author_id == current_user.id, Recipe.deleted.is_(False))
    else:
        if current_user is None:
            statement = statement.where(Recipe.hidden.is_(False), Recipe.deleted.is_(False))
        elif include_hidden and user_can_hide_recipe(current_user):
            statement = statement.where(Recipe.deleted.is_(False))
        else:
            statement = statement.where(Recipe.hidden.is_(False), Recipe.deleted.is_(False))

    rows = await session.execute(statement.order_by(Recipe.created_at.desc()).distinct())
    return [
        serialize_recipe_list_item(
            recipe,
            author_name=author_name,
            author_username=author_email.split("@", 1)[0],
            category_name=category_name,
            main_image_url=media_url(storage_path) if storage_path else None,
            user=current_user,
        )
        for recipe, author_name, author_email, category_name, storage_path in rows.all()
    ]


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
    return RecipeFormOptions(
        categories=[CategoryOption(id=row.id, name=row.name) for row in category_rows],
        ingredients=[
            IngredientOption(id=row.id, canonical_name=row.canonical_name, name=row.name)
            for row in ingredient_rows
        ],
    )


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
    list_item = serialize_recipe_list_item(
        recipe,
        author_name=author_name,
        author_username=author_email.split("@", 1)[0],
        category_name=category_name,
        main_image_url=media_url(storage_path) if storage_path else None,
        user=current_user,
    )
    return RecipeDetail(
        **list_item.model_dump(),
        category_id=recipe.category_id,
        steps_html=recipe.steps_html,
        steps=extract_steps(recipe.steps_html),
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
    await ensure_ingredients_exist(session, [row.ingredient_id for row in payload.ingredients])

    recipe = Recipe(
        author_id=current_user.id,
        category_id=payload.category_id,
        title=payload.title.strip(),
        language=payload.language.lower(),
        steps_html=sanitize_recipe_html(payload.steps_html),
        servings=payload.servings,
        author_complexity=payload.author_complexity,
        hidden=False,
        deleted=False,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(recipe)
    await session.flush()
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
    await ensure_ingredients_exist(session, [row.ingredient_id for row in payload.ingredients])

    recipe.title = payload.title.strip()
    recipe.category_id = payload.category_id
    recipe.language = payload.language.lower()
    recipe.steps_html = sanitize_recipe_html(payload.steps_html)
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

    await session.commit()
    return await recipe_detail(
        recipe.id,
        language=recipe.language,
        current_user=current_user,
        session=session,
    )
