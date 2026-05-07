# Backend Skill

## Scope

Use this skill for API design, auth flows, recipe business logic, sanitization, and media handling.

## Guardrails

- Follow the API and recipe workflow baseline in `AGENTS.md`
- Enforce server-side role checks for registered users, moderators, administrators, and `SuperAdmin`
- Sanitize recipe HTML on the server side
- Do not allow external image embedding
- Treat upload validation, storage outside webroot, optimized variants, and antivirus scanning as required
- Include action logging for authentication, recipe changes, comments, favorites, moderation actions, bans, and role promotions

## Deliverables

- Endpoint contracts and payload shapes
- Validation and authorization rules
- Action logging behavior and payload details
- Media upload and processing workflow notes
