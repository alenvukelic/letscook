# Moderation Skill

## Scope

Use this skill for moderation actions, hide/delete behavior, role boundaries, bans, and spam cleanup controls.

## Guardrails

- Prefer soft delete or moderation actions once a recipe has user interactions
- Moderators should be able to hide recipes and comments, but not permanently delete them
- Administrators should be able to view hidden content, permanently remove recipes/comments, ban users, and promote users to moderator
- `SuperAdmin` should retain full access, including promoting moderators to administrator
- Preserve auditability for moderation-sensitive changes
- Reporting and appeals are post-MVP; do not add tables or APIs for them until requested

## Deliverables

- Moderation action model
- Role boundaries for moderator, administrator, and `SuperAdmin`
- Hidden/deleted status behavior and action-log links
