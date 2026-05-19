# AGENTS.md - deploy folder

## Purpose

This folder contains deployment entrypoints, internal helpers, and deploy-specific documentation for Letscook.

## Public vs internal files

Treat only these as user-facing entrypoints:

- `install.sh`
- `update.sh`
- `diagnose.sh`

Files prefixed with `_` are internal helpers. Do not tell users to start from them unless the task is specifically about deploy internals.

## Config rules

- The real `install.config` is local-only and must not be committed.
- The tracked template is `install.config.example`.
- If a new deploy variable is needed, add it to `install.config.example`, document it in `deploy/README.md`, and keep installer behavior clear when the real config is missing.
- Keep server-specific secrets in `install.config` on the server, not in tracked shell scripts.
- Keep `PRIVATE.md` for local notes only; do not copy its contents into deploy docs.

## Documentation rules

- User-facing deployment instructions belong in `deploy/README.md`.
- Keep all user-facing text in deploy scripts and docs in English.
- AI-specific deploy maintenance notes belong here, not in the user README.
- When changing deploy behavior, update both `deploy/README.md` and this `deploy/AGENTS.md` in the same change if either one becomes stale.

## Script design rules

- `install.sh` is the full install and repair entrypoint.
- `install.sh` is also the bootstrap entrypoint and must keep the repository checkout step first.
- `update.sh` is the manual fallback for refresh and redeploy after install.
- `diagnose.sh` must stay read-only.
- Shared shell logic belongs in `_lib.sh`.
- Internal helpers should keep the `_` prefix.
- Prefer idempotent checks so rerunning the installer repairs missing pieces instead of forcing a full reset.
- Keep the repository checkout directory clearly separate from the live app directory in both defaults and prompts.
- Backend virtualenv repair should prefer a one-time automatic rebuild when `pip` or editable install metadata is broken, instead of requiring a manual operator cleanup step.
- Runtime media under `var/media` must be preserved across rsync-based updates and must not be deleted just because the deploy checkout does not contain those generated files.

## Safety rules

- Fail early when a required path or dependency is missing.
- Preserve existing `.env`, database values, SSL files, and SSH keys when possible.
- Never print secrets unless the script is explicitly showing a public key or a user-requested summary.
- Prefer clear operator prompts and explanations over silent fallback behavior.
- Broken unrelated APT repositories should produce a clear warning, but should not abort deploy bootstrap if required packages are already installed or still resolvable.
