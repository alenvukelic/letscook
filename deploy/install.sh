#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

BOOTSTRAP_GITHUB_HOST="github.com"
BOOTSTRAP_GITHUB_OWNER="alenvukelic"
BOOTSTRAP_GITHUB_REPO="letscook"
BOOTSTRAP_REPO_BRANCH="main"
BOOTSTRAP_DEPLOY_DIR="/opt/letscook-repo"

ts() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] %s\n' "$(ts)" "$*"
}

die() {
  printf '[%s] ERROR: %s\n' "$(ts)" "$*" >&2
  exit 1
}

require_root() {
  [[ ${EUID:-0} -eq 0 ]] || die "Run this script as root with sudo."
}

prompt_value_bootstrap() {
  local prompt="$1"
  local current_value="$2"
  local answer=""
  read -r -p "$prompt [$current_value]: " answer
  if [[ -n "$answer" ]]; then
    printf '%s' "$answer"
  else
    printf '%s' "$current_value"
  fi
}

bootstrap_save_config_value() {
  local config_path="$1"
  local key="$2"
  local value="$3"

  python3 - "$config_path" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
line = f'{key}="{value}"'
text = path.read_text(encoding='utf-8')
lines = text.splitlines()
for index, existing in enumerate(lines):
    if existing.startswith(f"{key}="):
        lines[index] = line
        break
else:
    lines.append(line)
path.write_text("\n".join(lines) + "\n", encoding='utf-8')
PY
}

ensure_bootstrap_packages() {
  apt-get update
  apt-get install -y ca-certificates curl git python3
}

bootstrap_repo_checkout() {
  local github_owner github_repo repo_branch repo_dir repo_url

  echo ""
  echo "=============================================="
  echo "        Letscook Bootstrap Installer"
  echo "=============================================="
  echo ""
  echo "Step 1 downloads or refreshes the repository checkout."
  echo "Use a dedicated repository folder, not an nginx web root such as /var/www/html."
  echo "Recommended pattern: /opt/letscook-repo for Git checkout, /opt/letscook-app for the live app."
  echo ""

  github_owner="$(prompt_value_bootstrap "GitHub owner" "$BOOTSTRAP_GITHUB_OWNER")"
  github_repo="$(prompt_value_bootstrap "GitHub repository" "$BOOTSTRAP_GITHUB_REPO")"
  repo_branch="$(prompt_value_bootstrap "Git branch" "$BOOTSTRAP_REPO_BRANCH")"
  repo_dir="$(prompt_value_bootstrap "Repository checkout directory" "$BOOTSTRAP_DEPLOY_DIR")"
  repo_url="https://${BOOTSTRAP_GITHUB_HOST}/${github_owner}/${github_repo}.git"

  mkdir -p /opt
  if [[ -d "$repo_dir/.git" ]]; then
    log "Refreshing existing repository checkout at $repo_dir"
    git -C "$repo_dir" fetch --all --prune
    git -C "$repo_dir" checkout "$repo_branch"
    git -C "$repo_dir" reset --hard "origin/$repo_branch"
  else
    mkdir -p "$repo_dir"
    if find "$repo_dir" -mindepth 1 -maxdepth 1 | read -r _; then
      die "$repo_dir already exists and is not an empty git checkout directory"
    fi
    log "Cloning repository into $repo_dir"
    git clone --branch "$repo_branch" "$repo_url" "$repo_dir"
  fi

  INSTALL_CONFIG_PATH="$repo_dir/deploy/install.config"
  INSTALL_CONFIG_EXAMPLE_PATH="$repo_dir/deploy/install.config.example"
  [[ -f "$INSTALL_CONFIG_EXAMPLE_PATH" ]] || die "Missing deploy/install.config.example in the downloaded repository"

  if [[ ! -f "$INSTALL_CONFIG_PATH" ]]; then
    cp "$INSTALL_CONFIG_EXAMPLE_PATH" "$INSTALL_CONFIG_PATH"
    echo "Created $INSTALL_CONFIG_PATH from the example template."
  fi

  bootstrap_save_config_value "$INSTALL_CONFIG_PATH" "GITHUB_OWNER" "$github_owner"
  bootstrap_save_config_value "$INSTALL_CONFIG_PATH" "GITHUB_REPO" "$github_repo"
  bootstrap_save_config_value "$INSTALL_CONFIG_PATH" "REPO_BRANCH" "$repo_branch"
  bootstrap_save_config_value "$INSTALL_CONFIG_PATH" "DEPLOY_DIR" "$repo_dir"
  bootstrap_save_config_value "$INSTALL_CONFIG_PATH" "REPO_HTTPS_URL" "$repo_url"
  bootstrap_save_config_value "$INSTALL_CONFIG_PATH" "REPO_SSH_URL" "git@github.com:${github_owner}/${github_repo}.git"

  export INSTALL_CONFIG_PATH INSTALL_CONFIG_EXAMPLE_PATH
  ACTIVE_DEPLOY_DIR="$repo_dir"
}

require_root
ensure_bootstrap_packages
bootstrap_repo_checkout

# shellcheck disable=SC1091
source "$ACTIVE_DEPLOY_DIR/deploy/_lib.sh"

configure_install_values() {
  local answer=""
  local dedicated_deploy_user_answer=""
  local app_user_choice=""

  echo ""
  echo "=============================================="
  echo "       Letscook Install Configuration"
  echo "=============================================="
  echo ""

  if prompt_yes_no "Do you want this server to pull Letscook from GitHub and prepare auto-deploy" "$USE_GIT_DEPLOY"; then
    save_config_value "USE_GIT_DEPLOY" "yes"
    save_config_value "AUTO_DEPLOY_ENABLE" "yes"

    echo ""
    echo "Repository update method:"
    echo "  1) HTTPS (recommended for public repositories)"
    echo "  2) SSH deploy key (recommended for private repositories)"
    read -r -p "Choice [current: $CLONE_METHOD]: " answer
    case "$answer" in
      2) save_config_value "CLONE_METHOD" "ssh" ;;
      1) save_config_value "CLONE_METHOD" "https" ;;
      *) save_config_value "CLONE_METHOD" "$CLONE_METHOD" ;;
    esac
  else
    save_config_value "USE_GIT_DEPLOY" "no"
    save_config_value "AUTO_DEPLOY_ENABLE" "no"
  fi

  app_user_choice="$(prompt_value "Application runtime user" "$APP_USER")"
  save_config_value "APP_USER" "$app_user_choice"
  if [[ "$USE_GIT_DEPLOY" == "yes" ]]; then
    if prompt_yes_no "Do you want a dedicated auto-deploy user separate from the app runtime user" "yes"; then
      dedicated_deploy_user_answer="$(prompt_value "Dedicated deploy user" "$DEPLOY_USER")"
      save_config_value "DEPLOY_USER" "$dedicated_deploy_user_answer"
    else
      save_config_value "DEPLOY_USER" "$app_user_choice"
    fi
  else
    save_config_value "DEPLOY_USER" "$app_user_choice"
  fi

  save_config_value "APP_DIR" "$(prompt_value "Live application directory" "$APP_DIR")"
  save_config_value "BACKEND_PORT" "$(prompt_value "Backend port" "$BACKEND_PORT")"
  save_config_value "SERVICE_NAME" "$(prompt_value "systemd service name" "$SERVICE_NAME")"

  save_config_value "DB_HOST" "$(prompt_value "Database host" "$DB_HOST")"
  save_config_value "DB_PORT" "$(prompt_value "Database port" "$DB_PORT")"
  save_config_value "DB_NAME" "$(prompt_value "Database name" "$DB_NAME")"
  save_config_value "DB_USER" "$(prompt_value "Database user" "$DB_USER")"
  save_config_value "DB_PASSWORD" "$(prompt_value "Database password" "$DB_PASSWORD")"

  save_config_value "APP_DOMAIN" "$(prompt_value "Public domain or server name (leave empty for wildcard host)" "$APP_DOMAIN")"
  save_config_value "BACKEND_CORS_ORIGINS" "$(prompt_value "Backend CORS origins (comma-separated)" "$BACKEND_CORS_ORIGINS")"

  if prompt_yes_no "Do you want the installer to configure nginx" "$ENABLE_NGINX"; then
    save_config_value "ENABLE_NGINX" "yes"
    echo ""
    echo "Select SSL mode:"
    echo "  1) none"
    echo "  2) self-signed"
    echo "  3) letsencrypt"
    read -r -p "Choice [current: $SSL_MODE]: " answer
    case "$answer" in
      2) save_config_value "SSL_MODE" "self-signed" ;;
      3) save_config_value "SSL_MODE" "letsencrypt" ;;
      1) save_config_value "SSL_MODE" "none" ;;
      *) save_config_value "SSL_MODE" "$SSL_MODE" ;;
    esac

    reload_config
    if [[ "$SSL_MODE" == "letsencrypt" ]]; then
      save_config_value "LETSENCRYPT_EMAIL" "$(prompt_value "Let's Encrypt email" "$LETSENCRYPT_EMAIL")"
    fi
  else
    save_config_value "ENABLE_NGINX" "no"
    save_config_value "SSL_MODE" "none"
  fi

  if prompt_yes_no "Apply db/schema.sql automatically when the database appears empty" "$APPLY_SCHEMA_IF_EMPTY"; then
    save_config_value "APPLY_SCHEMA_IF_EMPTY" "yes"
  else
    save_config_value "APPLY_SCHEMA_IF_EMPTY" "no"
  fi

  reload_config
}

main() {
  require_root
  configure_install_values
  setup_log_capture "$INSTALL_LOG"

  log "Starting Letscook install or repair"

  ensure_base_packages
  ensure_runtime_commands
  ensure_user "$APP_USER"
  ensure_user "$DEPLOY_USER"

  if [[ "$USE_GIT_DEPLOY" == "yes" ]]; then
    bash "$SCRIPT_DIR/_setup-auto-deploy.sh"

    if ! test_github_ssh; then
      if prompt_yes_no "GitHub SSH is not confirmed yet. Continue anyway" "no"; then
        log "Continuing without confirmed GitHub SSH"
      else
        die "Stop here, add the deploy key in GitHub, then rerun install.sh"
      fi
    fi

    ensure_repo_checkout
  else
    log "GitHub deploy mode disabled; using the current checkout as the install source"
  fi

  sync_runtime_tree
  ensure_backend_env
  test_database_connection || warn "Database test failed; continuing so you can repair config and rerun later"
  maybe_apply_schema
  ensure_backend_venv
  build_frontend
  install_service
  maybe_setup_nginx
  print_install_summary
}

main "$@"
