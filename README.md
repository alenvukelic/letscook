# LetsCook

LetsCook is a planned multilingual cookbook web app for adding, sharing, and searching recipes.

## Status

This repository is in the first implementation stage.

- Current contents: PostgreSQL schema script, FastAPI backend scaffold, Vite + Preact + TypeScript frontend scaffold, repo guidance docs, skill folders, and legal documents
- Current app status: runnable frontend shell and backend health/meta API foundation; full product features are not implemented yet

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

These are the selected starting technologies.

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
|-- backend/
|-- db/
|   `-- schema.sql
|-- frontend/
|-- skills_manifest.yaml
|-- skills/
`-- legal/
    |-- image-rights.md
    |-- moderation.md
    |-- privacy.md
    `-- terms.md
```

## Installation

Clone the repository first.

```bash
git clone https://github.com/alenvukelic/letscook.git
cd letscook
```

Backend setup:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
fastapi dev app/main.py
```

Frontend setup:

```powershell
cd frontend
npm install
npm run dev
```

Database schema, once local PostgreSQL access is available:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

The frontend dev server defaults to `http://localhost:5173`; the backend API defaults to `http://localhost:8000/api`.

## Verification

Backend:

```powershell
cd backend
pytest
ruff check .
```

Frontend:

```powershell
cd frontend
npm run build
```

## Legal Documents

- Privacy policy: `legal/privacy.md`
- Terms of use: `legal/terms.md`
- Image rights policy: `legal/image-rights.md`
- Moderation policy: `legal/moderation.md`

## Roadmap Notes

The initial system blueprint expects core tables and features around users, categories, tags, recipe tags, recipes, canonical ingredients, ingredient translations, recipe ingredients, ratings, complexity votes, favorites, comments, media, recipe relations, views, action definitions, and unified audit/activity logging.

Planning guidance for major work areas is organized under `skills/` and indexed by `skills_manifest.yaml`.

As implementation begins, this README should stay focused on project overview, setup, and operational requirements, while deeper development guidance remains in `AGENTS.md`.
