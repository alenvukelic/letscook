# Database Skill

## Scope

Use this skill for PostgreSQL schema planning, migrations, seeds, indexes, and search support.

## Guardrails

- Start from the baseline tables listed in `AGENTS.md`
- Include role support in `users`, category/tag tables, plus `actions` and `action_log` as the single audit/activity system in the initial schema
- Model canonical ingredients separately from localized ingredient names
- Keep per-user ratings and complexity votes instead of aggregate-only storage
- Preserve auditability for recipe edits and moderation-related changes through `action_log`

## Deliverables

- Schema proposals and migration order
- Role, moderation, categories/tags, and unified action/audit logging table design
- Seed data approach for ingredients and translations
- Index and search strategy notes
