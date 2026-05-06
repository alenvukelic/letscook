# AGENTS.md

## Current State
- The repository is still being bootstrapped. Right now it contains `AGENTS.md` and editable legal docs under `legal/`; there is no application code, build config, or test config yet.
- Treat this file and the existing legal markdown files as the current repo-specific source of truth until real code and config are added.

## Planned System Direction
- Product intent: a multilingual cookbook web app for adding, sharing, and searching recipes.
- Planned stack from the original repo notes: PostgreSQL, Python backend, Preact frontend, nginx on Ubuntu.
- Initial languages called out in the original notes: Croatian, English, German.
- Treat these as target architecture and product constraints, not as already-implemented code.
- Use the initial product, API, and database notes below as the default starting blueprint unless later code or user instructions override them.

## Workflow Rules
- Make local git commits for completed changes unless the user says otherwise.
- `commit` or `komit` means push work to GitHub. Do not push to GitHub unless the user explicitly says `commit` or `komit`.
- Keep `AGENTS.md` updated when workflow rules, repository structure, or important constraints change.
- Keep `README.md` updated with user-facing project description, requirements, setup, and usage notes. Do not put agent workflow instructions in `README.md`.
- Ask before doing anything that conflicts with existing user instructions, current worktree changes, or the guidance in this file.
- Do not rewrite, revert, or delete unrelated user changes without permission.

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
- Recipe creation is expected to support structured ingredients, servings, tags, category, rich-text steps, and optional main image.
- The original notes expect both author complexity and community complexity to be stored and displayed.
- Search is expected to cover title, ingredients, tags, and steps, with ingredient-based matching as an important use case.
- Recipes may have parent/child relationships to represent variations or clones.

## Behavior Rules From Existing Notes
- A recipe should only be hard-deletable before it has user interactions; after that, prefer soft delete or moderation flows.
- Keep edit history or auditability in mind for recipe changes.
- Similarity or clone detection during recipe creation is a planned product requirement from the original notes.

## Implementation Areas
- Backend work should plan for APIs covering users, recipes, ingredients, ratings, complexity votes, favorites, comments, media, and recipe relations.
- Frontend work should plan for recipe browsing, recipe editor flows, search and filters, user profile, authentication, and localization.
- Database work should plan for canonical ingredients, ingredient translations, recipe ingredients, ratings, complexity votes, favorites, comments, media, recipe relations, views, and audit history.
- DevOps work should assume Ubuntu and nginx deployment, plus CI for linting, tests, and security checks.

## Recipe Workflow Expectations
- Recipe creation should include title, category, tags, ingredients, amounts and units, rich-text steps, servings, and author complexity.
- Main image is optional.
- Ingredients should support canonical ingredient records plus new entry creation when needed.
- Backend should run similarity checks during recipe creation and suggest cloning or linking when a close match exists.
- Both server-side sanitization and media validation are mandatory before persistence.

## Search Expectations
- Search should cover title, ingredients, tags, and steps.
- Ingredient-based search is an important use case and should support matching all or most provided ingredients.
- Filtering is expected to grow around language, category, complexity, user-owned recipes, favorites, preparation time, ratings, and servings.

## Data Model Baseline
- Core tables expected from the initial notes: `users`, `ingredients`, `ingredient_translations`, `recipes`, `recipe_ingredients`, `ratings`, `complexity_votes`, `favorites`, `comments`, `recipe_relations`, `media`, `views`, and `audit_log`.
- `ingredients` should represent canonical ingredients.
- `ingredient_translations` should carry localized ingredient names by language.
- `recipes` should include author, title, language, steps HTML, main media reference, and servings.
- `recipe_ingredients` should store ingredient quantities and units per recipe.
- Ratings and complexity votes should be stored per user per recipe rather than only as aggregates.
- `recipe_relations` should support parent/child or clone-style links between recipes.
- `comments` should be compatible with soft delete or moderation handling.
- `audit_log` should preserve change history for recipe edits and related actions.

## API Baseline
- Planned auth endpoints include registration and OAuth login.
- Planned recipe endpoints include listing, creation, rating, and complexity voting.
- Planned media endpoints include upload with metadata returned after validation and storage.
- When implementation begins, prefer aligning new endpoints and payload shapes with the original recipe fields already documented here unless the user decides otherwise.

## Security Requirements
- Server-side HTML sanitization for WYSIWYG content is mandatory.
- External image hotlinking or embedding should not be supported.
- Media upload handling should include MIME validation, size limits, filename normalization, storage outside webroot, thumbnail or optimized derivative generation, and antivirus scanning.
- Plan for CSRF protection, rate limiting, secure password hashing, email verification, and secure OAuth handling.

## Legal References
- Privacy policy source: `legal/privacy.md`
- Terms of use source: `legal/terms.md`
- Image rights policy source: `legal/image-rights.md`
- Moderation policy source: `legal/moderation.md`

## Agent Guidance
- Do not treat the lack of code as permission to invent a different product shape; start from the planned cookbook system in this file.
- If future implementation needs to deviate from this blueprint, prefer updating `AGENTS.md` in the same change so the new direction is explicit.
