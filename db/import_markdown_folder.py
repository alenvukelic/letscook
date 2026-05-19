from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
import sys
from typing import Any

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.seed_initial_data import (
    CATEGORIES,
    DEFAULT_ACTION_CODES,
    ENV_FILE,
    INGREDIENT_TRANSLATIONS,
    LANGUAGES,
    canonical_ingredient_key,
    clean_text,
    insert_media,
    insert_action_log,
    normalize_key,
    normalize_fraction,
    recipe_steps_html,
)


@dataclass
class MarkdownRecipe:
    title: str
    category_slug: str
    ingredient_lines: list[str]
    step_lines: list[str]
    source_file: str
    file_path: Path
    photo_paths: list[Path]


def parse_markdown_recipe(path: Path) -> MarkdownRecipe | None:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or not lines[0].startswith("# "):
        return None

    title = lines[0][2:].strip()
    if title.upper().startswith("NAPOMENA"):
        return None
    metadata: dict[str, str] = {}
    ingredient_lines: list[str] = []
    step_lines: list[str] = []
    photo_paths: list[Path] = []
    section: str | None = None

    for raw_line in lines[1:]:
        line = raw_line.rstrip()
        stripped = line.strip()
        if stripped.startswith("- ") and ": " in stripped and section is None:
            key, value = stripped[2:].split(": ", 1)
            metadata[key.strip()] = value.strip()
            continue
        if stripped.startswith("## "):
            heading = stripped[3:].strip().lower()
            if heading.startswith("potrebni sastojci"):
                section = "ingredients"
            elif heading.startswith(("postupak", "priprema", "način pripreme")):
                section = "steps"
            elif heading.startswith("photos"):
                section = "photos"
            else:
                section = None
            continue
        if section == "ingredients":
            if stripped:
                ingredient_lines.append(stripped[2:] if stripped.startswith("- ") else stripped)
            continue
        if section == "steps":
            if stripped:
                step_lines.append(stripped)
            continue
        if section == "photos":
            if stripped.startswith("![") and "](" in stripped and stripped.endswith(")"):
                photo_name = stripped.split("](", 1)[1][:-1]
                photo_path = path.with_name(photo_name)
                if photo_path.exists():
                    photo_paths.append(photo_path)

    if len(ingredient_lines) < 2 or len(step_lines) < 2:
        return None

    return MarkdownRecipe(
        title=title,
        category_slug=metadata.get("category", "desserts"),
        ingredient_lines=ingredient_lines,
        step_lines=step_lines,
        source_file=metadata.get("source_file", path.name),
        file_path=path,
        photo_paths=photo_paths,
    )


def parse_ingredient_line(line: str, current_group: str | None) -> dict[str, Any] | None:
    text = line.strip("•●⦁- ")
    if not text:
        return None
    lowered_text = text.lower()
    if lowered_text.startswith("punjenje:") or "baznog tijesta" in lowered_text:
        return None
    if text.endswith(":"):
        return {"group": text.rstrip(":")}

    amount_part = None
    amount_tokens: list[str] = []
    tokens = text.split()
    name_start = 0
    for index, token in enumerate(tokens):
        normalized = token.strip().rstrip(",")
        fraction = normalize_fraction(normalized)
        if fraction is None:
            break
        amount_tokens.append(normalized)
        name_start = index + 1
    if amount_tokens:
        amount_part = normalize_fraction(amount_tokens[0])
        if len(amount_tokens) > 1:
            for extra in amount_tokens[1:]:
                extra_fraction = normalize_fraction(extra)
                if extra_fraction is not None:
                    amount_part += extra_fraction

    remainder = " ".join(tokens[name_start:]).strip()
    if not remainder:
        return None

    unit = None
    unit_candidate, _, rest = remainder.partition(" ")
    unit_lookup = unit_candidate.lower().rstrip(".")
    unit_aliases = {
        "kg": "kg",
        "g": "g",
        "dag": "g",
        "dkg": "g",
        "ml": "ml",
        "dl": "ml",
        "l": "ml",
        "žlica": "tbsp",
        "žlice": "tbsp",
        "žličica": "tsp",
        "žličice": "tsp",
        "kom": "piece",
        "komada": "piece",
        "male": None,
        "čajna": None,
        "čajne": None,
    }
    if unit_lookup in unit_aliases:
        unit = unit_aliases[unit_lookup]
        remainder = rest.strip() if rest else remainder

    name = remainder.strip(" ,.;")
    if not any(character.isalpha() for character in name):
        return None

    note_parts: list[str] = []
    if current_group:
        note_parts.append(current_group)
    canonical_key = canonical_ingredient_key(name)
    if amount_part is None and canonical_key == normalize_key(name):
        return None
    parenthetical = []
    if "(" in name and ")" in name:
        before_parenthesis, _, parenthetical_text = name.partition("(")
        parenthetical.append(parenthetical_text.rsplit(")", 1)[0].strip())
        name = before_parenthesis.strip(" ,.;")
    note_parts.extend(part for part in parenthetical if part)
    return {
        "amount": amount_part,
        "unit": unit,
        "ingredient_key": canonical_key,
        "name": name,
        "note": " | ".join(part for part in note_parts if part) or None,
    }


def action_id_map(conn: psycopg.Connection[Any]) -> dict[str, int]:
    with conn.cursor() as cursor:
        cursor.execute("select code, id from actions where code = any(%s)", (DEFAULT_ACTION_CODES,))
        return dict(cursor.fetchall())


def ensure_category(conn: psycopg.Connection[Any], slug: str) -> int:
    translations = CATEGORIES.get(slug, {"hr": slug.replace("-", " "), "en": slug, "de": slug})
    with conn.cursor() as cursor:
        cursor.execute(
            """
            insert into categories (slug, name, language)
            values (%s, %s, 'hr')
            on conflict (slug) do update set name = excluded.name
            returning id
            """,
            (slug, translations["hr"]),
        )
        category_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            insert into category_translations (category_id, language, name)
            values (%s, %s, %s)
            on conflict (category_id, language) do update set name = excluded.name
            """,
            (category_id, "hr", translations["hr"]),
        )
        return category_id


def ensure_ingredient(
    conn: psycopg.Connection[Any],
    ingredient_key: str,
    raw_name: str,
    created_by: int,
) -> int:
    translations = INGREDIENT_TRANSLATIONS.get(ingredient_key)
    canonical_name = translations["hr"] if translations else raw_name.strip().lower()
    with conn.cursor() as cursor:
        cursor.execute(
            """
            insert into ingredients (canonical_name, created_by)
            values (%s, %s)
            on conflict (canonical_name) do update
            set created_by = coalesce(ingredients.created_by, excluded.created_by)
            returning id
            """,
            (canonical_name, created_by),
        )
        ingredient_id = int(cursor.fetchone()[0])
        if translations:
            for language in LANGUAGES:
                cursor.execute(
                    """
                    insert into ingredient_translations (ingredient_id, language, name)
                    values (%s, %s, %s)
                    on conflict (ingredient_id, language) do update set name = excluded.name
                    """,
                    (ingredient_id, language, translations[language]),
                )
        else:
            cursor.execute(
                """
                insert into ingredient_translations (ingredient_id, language, name)
                values (%s, 'hr', %s)
                on conflict (ingredient_id, language) do update set name = excluded.name
                """,
                (ingredient_id, raw_name.strip()),
            )
        return ingredient_id


def import_recipe(
    conn: psycopg.Connection[Any],
    *,
    recipe: MarkdownRecipe,
    author_id: int,
    actions: dict[str, int],
) -> int | None:
    category_id = ensure_category(conn, recipe.category_slug)
    steps_html = recipe_steps_html(recipe.step_lines)

    with conn.cursor() as cursor:
        cursor.execute("select id from recipes where lower(title) = lower(%s)", (recipe.title,))
        existing = cursor.fetchone()
        if existing:
            return None

        cursor.execute(
            """
            insert into recipes (author_id, category_id, title, language, steps_html, servings, author_complexity)
            values (%s, %s, %s, 'hr', %s, %s, %s)
            returning id
            """,
            (author_id, category_id, recipe.title, steps_html, Decimal("8"), 2),
        )
        recipe_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            insert into recipe_translations (recipe_id, language, title)
            values (%s, 'hr', %s)
            on conflict (recipe_id, language) do update set title = excluded.title
            """,
            (recipe_id, recipe.title),
        )

    media_ids: list[int] = []
    for photo_path in recipe.photo_paths:
        media_id = insert_media(
            conn,
            owner_id=author_id,
            recipe_id=recipe_id,
            source_name=photo_path.name,
            image_bytes=photo_path.read_bytes(),
            actions=actions,
        )
        if media_id is not None:
            media_ids.append(media_id)

    if media_ids:
        with conn.cursor() as cursor:
            cursor.execute("update recipes set main_media_id = %s where id = %s", (media_ids[0], recipe_id))

    current_group = None
    parsed_ingredients: list[dict[str, Any]] = []
    for raw_line in recipe.ingredient_lines:
        parsed = parse_ingredient_line(raw_line, current_group)
        if not parsed:
            continue
        if "group" in parsed:
            current_group = parsed["group"]
            continue
        parsed_ingredients.append(parsed)

    if len(parsed_ingredients) < 2 or len(clean_text(steps_html)) < 30:
        return None

    with conn.cursor() as cursor:
        for sort_order, row in enumerate(parsed_ingredients, start=1):
            ingredient_id = ensure_ingredient(conn, row["ingredient_key"], row["name"], author_id)
            cursor.execute(
                """
                insert into recipe_ingredients (recipe_id, ingredient_id, amount, unit, note, sort_order)
                values (%s, %s, %s, %s, %s, %s)
                """,
                (recipe_id, ingredient_id, row["amount"], row["unit"], row["note"] or row["name"], sort_order),
            )

    insert_action_log(
        conn,
        actions["recipe.created"],
        author_id,
        author_id,
        {
            "table": "recipes",
            "record_id": recipe_id,
            "source_file": recipe.source_file,
            "source_markdown": str(recipe.file_path.relative_to(ROOT)).replace("\\", "/"),
        },
    )
    return recipe_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", help="Relative folder under input-doc with markdown recipes")
    parser.add_argument("--author-email", default="durdica.vukelic@gmail.com")
    args = parser.parse_args()

    folder = ROOT / "input-doc" / args.folder
    if not folder.exists():
        raise RuntimeError(f"Folder does not exist: {folder}")

    env = dotenv_values(ENV_FILE)
    database_url = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(f"DATABASE_URL is missing in {ENV_FILE}")
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")

    recipes = [
        recipe
        for recipe in (parse_markdown_recipe(path) for path in sorted(folder.glob("*.md")))
        if recipe is not None
    ]

    with psycopg.connect(database_url) as conn:
        actions = action_id_map(conn)
        with conn.cursor() as cursor:
            cursor.execute("select id from users where email = %s", (args.author_email,))
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError(f"Author not found: {args.author_email}")
            author_id = int(row[0])

        imported = 0
        for recipe in recipes:
            recipe_id = import_recipe(conn, recipe=recipe, author_id=author_id, actions=actions)
            imported += 1 if recipe_id is not None else 0
        conn.commit()
    print(f"Imported {imported} recipes from {folder.name}; parsed {len(recipes)} markdown files.")


if __name__ == "__main__":
    main()
