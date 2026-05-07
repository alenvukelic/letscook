# LetsCook

LetsCook is a planned multilingual cookbook web app for adding, sharing, and searching recipes.

## Status

This repository is still in the bootstrap stage.

- Current contents: repo guidance docs, `skills_manifest.yaml`, skill folders under `skills/`, and legal documents under `legal/`
- Current app status: no backend, frontend, database schema, build config, or test config has been added yet

## Planned Product Scope

- Recipe creation with title, category, tags, ingredients, servings, rich-text steps, and author complexity
- Recipe browsing and search across title, ingredients, tags, and steps
- Ingredient-based search for recipes matching all or most selected ingredients
- Ratings, community complexity votes, favorites, comments, and recipe relationships
- Role-based moderation with registered users, moderators, administrators, and a `SuperAdmin`
- Hidden recipes and comments for moderation cleanup, plus administrator-only permanent removal and user bans
- Action tracking for important user and moderation events
- Localization support, with Croatian, English, and German as the initial target languages

## Planned Technology

- PostgreSQL
- FastAPI Python backend with SQLAlchemy, Alembic, and Pydantic
- Vite + Preact + TypeScript frontend
- nginx on Ubuntu

These are the intended starting technologies and may evolve as the implementation takes shape.

## Core Requirements

- Do not allow external image embedding; images should be uploaded instead
- Sanitize recipe HTML on the server side
- Validate media MIME type and size, normalize filenames, store files outside webroot, generate optimized variants, and run antivirus scanning
- Enforce server-side role-based permissions for moderators, administrators, and `SuperAdmin`
- Use JWT access tokens plus secure cookie-based rotated refresh tokens
- Keep unified audit/activity definitions in `actions` and event records in `action_log`, including timestamp, IP, action type, actor, target record, reason, and structured details
- Preserve legal content in `legal/privacy.md`, `legal/terms.md`, `legal/image-rights.md`, and `legal/moderation.md`

## Repository Layout

```text
.
|-- AGENTS.md
|-- README.md
|-- skills_manifest.yaml
|-- skills/
`-- legal/
    |-- image-rights.md
    |-- moderation.md
    |-- privacy.md
    `-- terms.md
```

## Installation

There is no runnable application in the repository yet, so there is nothing to install beyond cloning the repository.

```bash
git clone https://github.com/alenvukelic/letscook.git
cd letscook
```

When application code is added, this section should be expanded with exact setup steps for the backend, frontend, database, and any required services.

## Legal Documents

- Privacy policy: `legal/privacy.md`
- Terms of use: `legal/terms.md`
- Image rights policy: `legal/image-rights.md`
- Moderation policy: `legal/moderation.md`

## Roadmap Notes

The initial system blueprint expects core tables and features around users, categories, tags, recipe tags, recipes, canonical ingredients, ingredient translations, recipe ingredients, ratings, complexity votes, favorites, comments, media, recipe relations, views, action definitions, and unified audit/activity logging.

Planning guidance for major work areas is organized under `skills/` and indexed by `skills_manifest.yaml`.

As implementation begins, this README should stay focused on project overview, setup, and operational requirements, while deeper development guidance remains in `AGENTS.md`.
