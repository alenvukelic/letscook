# AGENTS.md

## Current State
- The repository is still being bootstrapped. Right now it contains `AGENTS.md` and editable legal docs under `legal/`; there is no application code, build config, or test config yet.
- Treat this file and the existing legal markdown files as the current repo-specific source of truth until real code and config are added.

## Workflow Rules
- Make local git commits for completed changes unless the user says otherwise.
- `commit` or `komit` means push work to GitHub. Do not push to GitHub unless the user explicitly says `commit` or `komit`.
- Keep `AGENTS.md` updated when workflow rules, repository structure, or important constraints change.
- Ask before doing anything that conflicts with existing user instructions, current worktree changes, or the guidance in this file.
- Do not rewrite, revert, or delete unrelated user changes without permission.

## Git Remote
- GitHub repository: `https://github.com/alenvukelic/letscook`
- Local work should stay local until the user explicitly authorizes a GitHub push with `commit` or `komit`.

## Product Constraints Kept From Existing Repo Notes
- Project intent: a multilingual cookbook web app for adding, sharing, and searching recipes.
- Legal documents live in `legal/privacy.md`, `legal/terms.md`, `legal/image-rights.md`, and `legal/moderation.md`.
- Do not allow external image embedding; images should be uploaded instead.
- Sanitize recipe HTML on the server side.
- Any future media upload flow should validate MIME type and size, normalize filenames, store files outside webroot, generate thumbnails or optimized variants, and run antivirus scanning.
