# Moderation Skill

## Scope

Use this skill for reporting flows, moderation actions, soft-delete behavior, appeals, and spam controls.

## Guardrails

- Prefer soft delete or moderation actions once a recipe has user interactions
- Moderators should be able to hide recipes and comments, but not permanently delete them
- Administrators should be able to view hidden content, permanently remove recipes/comments, ban users, and promote users to moderator
- `SuperAdmin` should retain full access, including promoting moderators to administrator
- Preserve auditability for moderation-sensitive changes
- Keep reporting and escalation flows clear enough to implement later

## Deliverables

- Report triage workflow
- Moderation action model
- Role boundaries for moderator, administrator, and `SuperAdmin`
- Appeals and escalation notes
