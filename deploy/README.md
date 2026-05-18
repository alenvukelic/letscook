# Deploy README

This folder contains everything related to Letscook server deployment.

## Public Scripts

Only these three scripts are meant for normal use:

- `install.sh`
  Full install from zero or repair of an existing server.
- `update.sh`
  Manual fetch and redeploy after the app is already installed.
- `diagnose.sh`
  Read-only verification of the current deployment state.

All other files prefixed with `_` are internal helpers.

## Before You Start

The base system should already have the main runtimes installed by your reusable server scripts:

- Python
- PostgreSQL
- Node.js and npm
- nginx

This Letscook deploy installer still verifies and repairs missing pieces when possible, but it is designed to build on top of that prepared base.

## Required Config Before Install

The real `install.config` is intentionally not committed.

Create it from the example:

```bash
cp deploy/install.config.example deploy/install.config
```

Then run:

```bash
sudo bash deploy/install.sh
```

If `install.config` is missing, `install.sh` creates it from the example and then walks you through the important values interactively.

You can also run the installer as a bootstrap entrypoint from a single downloaded `install.sh` file because its first job is to download or refresh the repository checkout.

## What `install.sh` Does

The installer is interactive and repair-friendly.

It can:

1. ask whether the app should be pulled from GitHub
2. ask where the repository checkout should live and keep it clearly separate from the live web app directory
2. guide SSH deploy key generation for GitHub clone and auto-deploy
3. create or refresh the deploy checkout
4. sync the runtime tree into the live app directory
5. prepare backend `.env`
6. install backend dependencies into `backend/.venv`
7. install frontend packages and build the frontend
8. validate database connectivity and optionally apply `db/schema.sql`
9. install or repair the systemd service
10. install or repair nginx
11. optionally configure self-signed OpenSSL certificates or Let's Encrypt

Every major step first checks whether it is already configured so the script can be rerun safely for repair work.

## Install Flow

Run on the server from the project checkout:

```bash
sudo bash deploy/install.sh
```

Recommended first-run flow:

1. choose GitHub deploy mode if the server should pull the repo itself
2. choose the repository checkout folder, for example `/opt/letscook-repo`
3. choose whether to use HTTPS or SSH for repository updates
4. add the shown SSH public key as a GitHub deploy key if you chose SSH mode
5. confirm database values
6. confirm backend `.env` values
7. choose HTTP only, self-signed SSL, or Let's Encrypt
8. let the installer verify and restart the service

## GitHub Auto-Deploy

If you enable GitHub deploy mode, the installer can prepare:

- a dedicated deploy user
- deploy SSH key for cloning the repository
- `known_hosts` entry for GitHub
- passwordless sudo rule for the deploy user to run the internal auto-update helper

For a public repository, you can keep the clone method on HTTPS and skip the GitHub deploy key step.

The installer prints the public key you must add in GitHub.

Typical GitHub setup:

1. add the printed public key as a repository deploy key with read access
2. use the same server and deploy user in your GitHub Actions workflow
3. run the server-side helper through SSH:

```bash
sudo bash /opt/letscook-deploy/deploy/update.sh
```

## Update

After the app is installed:

```bash
sudo bash /opt/letscook-deploy/deploy/update.sh
```

This script:

1. refreshes the deploy checkout
2. resyncs the live runtime tree
3. repairs `.env` if needed
4. reinstalls backend and frontend dependencies if required
5. rebuilds the frontend
6. restarts the service
7. reloads nginx if nginx is enabled

## Diagnose

Read-only diagnostics:

```bash
sudo bash /opt/letscook-deploy/deploy/diagnose.sh
```

It checks:

- users and paths
- deploy checkout
- SSH deploy key presence
- backend `.env`
- virtualenv
- frontend build output
- systemd service state
- nginx site state
- PostgreSQL reachability if `psql` is available

## Internal Files

- `install.config.example`
  tracked template for the local-only `install.config`
- `_lib.sh`
  shared shell functions and config handling
- `_setup-auto-deploy.sh`
  deploy SSH key and sudoers bootstrap helper
- `_auto-update.sh`
  internal refresh helper used by `update.sh`
- `letscook.service`
  systemd template rendered by the installer

## Notes

- Keep user-facing messages in English.
- Do not commit the real `deploy/install.config`.
- Use `diagnose.sh` before making manual changes if you are unsure what is already configured.
