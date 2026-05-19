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


class RecipeFormOptions(BaseModel):
    categories: list[CategoryOption]
    ingredients: list[IngredientOption]


class RecipeIngredientInput(BaseModel):
    ingredient_id: int
    amount: float | None = None
    unit: str | None = None
    note: str | None = None


class RecipeWrite(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    category_id: int | None = None
    language: str = Field(default="hr", min_length=2, max_length=2)
    steps_html: str = Field(min_length=1)
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
    servings: float
    author_complexity: int
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


class RecipeDetail(RecipeListItem):
    category_id: int | None
    steps_html: str
    steps: list[str]
    author_id: int
    ingredients: list[RecipeIngredientView]
    media: list[RecipeMediaView]


class RecipeVisibilityUpdate(BaseModel):
    hidden: bool | None = None
    deleted: bool | None = None
