# AGENTS.md - server-scripts folder

## Purpose

This folder contains reusable server setup scripts and operator notes that can be run manually on Ubuntu servers.

## Scope

- Keep scripts generic enough to reuse on future servers, but document Letscook defaults clearly.
- Do not put these workflow notes in the root `AGENTS.md`.
- Keep private project/server notes in `server-scripts/Private.md` or root `PRIVATE.md`, not in public instructions.
- Scripts must avoid overwriting unrelated services, nginx sites, SSL certificates, SSH keys, or database state.

## Script Rules

- Prefer interactive confirmation before replacing an existing file.
- Back up files before editing server-owned configuration.
- Check prerequisites before making changes.
- Make scripts safe to rerun when possible.
- For nginx work, change only the site file named by the script variables and never delete unrelated files from `sites-available` or `sites-enabled`.
- For Let's Encrypt work, preserve existing certificates and use Certbot's normal renewal timer.

## Documentation Rules

- Keep `README.md` aligned with the actual scripts in this folder.
- Keep user-facing instructions practical and step-by-step.
