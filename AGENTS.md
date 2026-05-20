# AGENTS.md

## Current State
- The repository now contains an initial scaffold plus a curated PostgreSQL seed/import workflow: schema script and seed helpers under `db/`, FastAPI backend under `backend/`, Vite + Preact + TypeScript frontend under `frontend/`, repo guidance docs, skill folders, and editable legal docs under `legal/`.
- Treat this file, `README.md`, `skills_manifest.yaml`, the files under `skills/`, `db/schema.sql`, the seed/import helpers under `db/`, and the existing legal markdown files as the current repo-specific source of truth while code is still early.

## Planned System Direction
- Product intent: a multilingual cookbook web app for adding, sharing, and searching recipes.
- Stack: PostgreSQL; FastAPI Python backend with SQLAlchemy, Alembic, and Pydantic; Vite + Preact + TypeScript frontend; nginx on Ubuntu.
- Initial languages called out in the original notes: Croatian, English, German.
- Treat these as target architecture and product constraints, not as already-implemented code.
- Use the initial product, API, and database notes below as the default starting blueprint unless later code or user instructions override them.

## Workflow Rules
- Until product version `1.0.0`, completed code changes should be committed locally, pushed to GitHub, and deployed to `ubuntu-dev` without waiting for an extra confirmation, unless the user explicitly says not to.
- `commit` or `komit` still explicitly means push work to GitHub, but the current standing instruction is to push and update `ubuntu-dev` after each completed change batch until `1.0.0`.
- Use semantic three-part versioning as `major.minor.patch`, for example `0.2.0`, and keep user-visible version/changelog information current in the application footer.
- Changelog entries shown to regular users should be in Croatian and describe practical product changes in simple language.
- Keep `AGENTS.md` updated when workflow rules, repository structure, or important constraints change.
- Keep `README.md` updated with user-facing project description, requirements, setup, and usage notes. Do not put agent workflow instructions in `README.md`.
- Keep `skills_manifest.yaml` and the files under `skills/` aligned with the planned architecture when responsibilities or boundaries change.
- Ask before doing anything that conflicts with existing user instructions, current worktree changes, or the guidance in this file.
- Do not rewrite, revert, or delete unrelated user changes without permission.

## Developer Commands
- Backend setup: `cd backend; python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -e .[dev]`
- Backend dev server: `cd backend; fastapi dev app/main.py`
- Backend tests: `cd backend; pytest`
- Backend lint: `cd backend; ruff check .`
- Frontend setup: `cd frontend; npm install`
- Frontend dev server: `cd frontend; npm run dev`
- Frontend build: `cd frontend; npm run build`
- Database schema apply, after local DB access exists: `psql "$DATABASE_URL" -f db/schema.sql`
- Database seed/import from private Word sources: `python db/seed_initial_data.py`
- Database seed/import through SSH tunnel: set `SSH_PASSWORD` then run `python db/run_seed_over_ssh.py`

## Git Remote
- GitHub repository: `https://github.com/alenvukelic/letscook`
- Primary branch is `main`.
- Local work should stay local until the user explicitly authorizes a GitHub push with `commit` or `komit`.

## Product Constraints
- Legal documents live in `legal/privacy.md`, `legal/terms.md`, `legal/image-rights.md`, and `legal/moderation.md`.
- Do not allow external image embedding; images should be uploaded instead.
- Sanitize recipe HTML on the server side.
- Any future media upload flow should validate MIME type and size, normalize filenames, store files outside webroot, generate thumbnails or optimized variants, and run antivirus scanning.

## Domain Notes
- Core product areas from the original notes: recipes, ingredients, ratings, complexity votes, favorites, comments, media, recipe relations, moderation, and localization.
- User roles are `user`, `moderator`, `administrator`, and `superadmin`.
- The initial `superadmin` account is `users.id = 1` and should be protected from deletion, banning, or demotion.
- Recipe creation is expected to support structured ingredients, servings, tags, category, rich-text steps, optional main image, and mixed ingredient rows where a canonical ingredient can also carry free text or a row can be plain explanatory text.
- The original notes expect both author complexity and community complexity to be stored and displayed.
- Search is expected to cover title, ingredients, tags, and steps, with ingredient-based matching as an important use case.
- Recipes may have parent/child relationships to represent variations or clones.

## Role Permissions
- `user`: can register, log in, manage only their own recipes and comments, save favorites, rate recipes, vote complexity, and manage other user-owned actions.
- `moderator`: has all `user` rights and can hide other users' recipes and comments from unregistered users and regular users for cleanup, duplication, spam, or policy reasons. Moderators cannot permanently delete content, ban users, or promote roles.
- `administrator`: has all `moderator` rights, can view hidden recipes and comments, permanently mark recipes/comments deleted, ban users, and promote `user` accounts to `moderator`. Administrators cannot promote administrators, demote/promote `superadmin`, or alter the protected initial `superadmin` account.
- `superadmin`: has all permissions, including promoting users to moderators, promoting moderators to administrators, managing administrators, and overriding moderation/admin actions.

## Behavior Rules From Existing Notes
- A recipe should only be hard-deletable before it has user interactions; after that, prefer soft delete or moderation flows.
- Keep edit history or auditability in mind for recipe changes.
- Similarity or clone detection during recipe creation is a planned product requirement from the original notes.
- Hidden recipes and comments should not be visible to unregistered users, regular registered users, or their normal listings/search results.
- Moderator actions should default to reversible hiding, while administrator actions can escalate to permanent removal and user bans.
- Role changes, moderation actions, bans, auth events, favorites, comments, and recipe changes must be included in the unified action/audit log.
- Reporting and appeals are post-MVP and should not get schema or API work until the user explicitly asks for them.

## Implementation Areas
- Backend work should plan for APIs covering users, recipes, ingredients, ratings, complexity votes, favorites, comments, media, recipe relations, moderation, role management, and action logging.
- Frontend work should plan for recipe browsing, recipe editor flows, search and filters, user profile, authentication, and localization.
- Database work should plan for categories, tags, canonical ingredients, ingredient translations, recipe ingredients, ratings, complexity votes, favorites, comments, media, recipe relations, views, and unified action/audit logging.
- DevOps work should assume Ubuntu and nginx deployment, plus CI for linting, tests, and security checks.

## Recipe Workflow Expectations
- Recipe creation should include title, category, tags, ingredients, amounts and units, rich-text steps, servings, and author complexity.
- Ingredient entry should support both canonical ingredient selection and free text additions on the same row, for example selecting `eggs` and appending `domaca`, plus standalone text rows for variation-specific notes inside the ingredient section.
- Main image is optional.
- Ingredients should support canonical ingredient records plus new entry creation when needed.
- Backend should run similarity checks during recipe creation and suggest cloning or linking when a close match exists.
- Both server-side sanitization and media validation are mandatory before persistence.

## Search Expectations
- Search should cover title, ingredients, tags, and steps.
- Ingredient-based search is an important use case and should support matching all or most provided ingredients.
- Filtering is expected to grow around language, category, complexity, user-owned recipes, favorites, preparation time, ratings, and servings.

## Data Model Baseline
- Core tables expected from the initial notes: `users`, `categories`, `category_translations`, `tags`, `tag_translations`, `recipe_tags`, `ingredients`, `ingredient_translations`, `recipes`, `recipe_translations`, `recipe_ingredients`, `ratings`, `complexity_votes`, `favorites`, `comments`, `recipe_relations`, `media`, `views`, `actions`, and `action_log`.
- `users` should support role-aware access for registered users, moderators, administrators, and `SuperAdmin`, plus user ban state.
- `categories` should define recipe categories used by `recipes`.
- `category_translations` should carry localized category names by language.
- `tags` should define reusable recipe tags.
- `tag_translations` should carry localized tag names by language.
- `recipe_tags` should link recipes and tags many-to-many.
- `ingredients` should represent canonical ingredients.
- `ingredient_translations` should carry localized ingredient names by language.
- `recipes` should include author, title, category, language, steps HTML, main media reference, servings, `hidden`, `deleted`, `hidden_id`, and `deleted_id`.
- `recipe_translations` should carry localized recipe titles by language for seeded multilingual content.
- `recipe_ingredients` should store ingredient quantities and units per recipe.
- Ratings and complexity votes should be stored per user per recipe rather than only as aggregates.
- `recipe_relations` should support parent/child or clone-style links between recipes.
- `comments` should include `hidden`, `deleted`, `hidden_id`, and `deleted_id` for moderation/admin handling.
- `actions` should define action types such as login, registration, recipe creation, recipe edit, comment creation, favorite save, moderation hide, ban, and role promotion.
- `action_log` is the single audit and user-activity log. It should store timestamp, IP address, `action_id`, acting user, target user when relevant, and structured `extra` details including changed table, `record_id`, reason, before/after data where useful, and any moderation/admin context.
- `hidden_id` and `deleted_id` on recipes/comments should reference the `action_log.id` row that explains who performed the action, when, from which IP, and why.

## API Baseline
- Planned auth endpoints include registration, OAuth login, and JWT access + refresh token handling with secure cookie-based rotated refresh tokens.
- Planned recipe endpoints include listing, creation, rating, and complexity voting.
- Planned media endpoints include upload with metadata returned after validation and storage.
- Planned moderation and admin endpoints should cover hiding and deleting recipes/comments, banning users, and role promotion flows.
- When implementation begins, prefer aligning new endpoints and payload shapes with the original recipe fields already documented here unless the user decides otherwise.

## Security Requirements
- Server-side HTML sanitization for WYSIWYG content is mandatory.
- External image hotlinking or embedding should not be supported.
- Media upload handling should include MIME validation, size limits, filename normalization, storage outside webroot, thumbnail or optimized derivative generation, and antivirus scanning.
- Plan for CSRF protection, rate limiting, secure password hashing, email verification, and secure OAuth handling.
- Role-based authorization must be enforced server-side for moderator, administrator, and `SuperAdmin` actions.
- Refresh tokens should be cookie-based, secure, rotated, and invalidated on reuse or logout.

## Legal References
- Privacy policy source: `legal/privacy.md`
- Terms of use source: `legal/terms.md`
- Image rights policy source: `legal/image-rights.md`
- Moderation policy source: `legal/moderation.md`

## Agent Guidance
- Do not treat the lack of code as permission to invent a different product shape; start from the planned cookbook system in this file.
- If future implementation needs to deviate from this blueprint, prefer updating `AGENTS.md` in the same change so the new direction is explicit.
