from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CategoryOption(BaseModel):
    id: int
    name: str


class IngredientOption(BaseModel):
    id: int
    canonical_name: str
    name: str


class MeasurementUnitOption(BaseModel):
    code: str
    label: str


class RecipeFormOptions(BaseModel):
    categories: list[CategoryOption]
    ingredients: list[IngredientOption]
    units: list[MeasurementUnitOption]


class RecipeIngredientInput(BaseModel):
    ingredient_id: int | None = None
    ingredient_name: str | None = None
    amount: float | None = None
    unit: str | None = None
    note: str | None = None


class RecipeWrite(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    category_id: int | None = None
    language: str = Field(default="hr", min_length=2, max_length=2)
    content_markdown: str = Field(min_length=1)
    prep_time_minutes: int = Field(gt=0, le=1440)
    servings: float = Field(gt=0)
    author_complexity: int = Field(ge=1, le=5)
    ingredients: list[RecipeIngredientInput] = Field(default_factory=list)


class RecipeIngredientView(BaseModel):
    id: int
    ingredient_id: int
    amount: float | None
    unit: str | None
    note: str | None
    ingredient_name: str
    canonical_name: str
    sort_order: int


class RecipeMediaView(BaseModel):
    id: int
    original_filename: str
    url: str
    width: int | None
    height: int | None


class RecipeListItem(BaseModel):
    id: int
    title: str
    language: str
    servings: float | None
    prep_time_minutes: int | None
    author_complexity: int | None
    likes_count: int
    rating_average: float | None
    ratings_count: int
    user_liked: bool
    user_rating: int | None
    verified: bool
    category_name: str | None
    author_name: str
    author_username: str
    hidden: bool
    deleted: bool
    created_at: datetime
    updated_at: datetime
    main_image_url: str | None
    can_edit: bool
    can_hide: bool
    can_delete: bool
    can_verify: bool


class RecipeDetail(RecipeListItem):
    category_id: int | None
    content_markdown: str
    steps_html: str
    steps: list[str]
    author_id: int
    ingredients: list[RecipeIngredientView]
    media: list[RecipeMediaView]


class RecipeVisibilityUpdate(BaseModel):
    hidden: bool | None = None
    deleted: bool | None = None
    verified: bool | None = None


class RatingWrite(BaseModel):
    rating: int = Field(ge=1, le=5)


class ImageUploadResponse(BaseModel):
    url: str
