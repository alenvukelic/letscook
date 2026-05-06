# Database Skill

## Scope

Use this skill for PostgreSQL schema planning, migrations, seeds, indexes, and search support.

## Guardrails

- Start from the baseline tables listed in `AGENTS.md`
- Model canonical ingredients separately from localized ingredient names
- Keep per-user ratings and complexity votes instead of aggregate-only storage
- Preserve auditability for recipe edits and moderation-related changes

## Deliverables

- Schema proposals and migration order
- Seed data approach for ingredients and translations
- Index and search strategy notes
