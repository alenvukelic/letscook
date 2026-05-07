# Database Skill

## Scope

Use this skill for PostgreSQL schema planning, migrations, seeds, indexes, and search support.

## Guardrails

- Start from the baseline tables listed in `AGENTS.md`
- Include role support in `users`, plus `actions` and `action_log` as first-class tables in the initial schema
- Model canonical ingredients separately from localized ingredient names
- Keep per-user ratings and complexity votes instead of aggregate-only storage
- Preserve auditability for recipe edits and moderation-related changes

## Deliverables

- Schema proposals and migration order
- Role, moderation, and action logging table design
- Seed data approach for ingredients and translations
- Index and search strategy notes
