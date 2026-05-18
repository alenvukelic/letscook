#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_CONFIG_PATH="${INSTALL_CONFIG_PATH:-$SCRIPT_DIR/install.config}"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/_lib.sh"

check_path() {
  local label="$1"
  local path="$2"
  if [[ -e "$path" ]]; then
    echo "[OK] $label: $path"
  else
    echo "[FAIL] $label: $path"
  fi
}

check_service() {
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "[OK] systemd service active: $SERVICE_NAME"
  else
    echo "[FAIL] systemd service inactive: $SERVICE_NAME"
  fi
}

check_nginx() {
  if [[ "$ENABLE_NGINX" != "yes" ]]; then
    echo "[OK] nginx disabled in config"
    return
  fi

  if [[ -L "$NGINX_SITE_LINK_PATH" || -f "$NGINX_SITE_PATH" ]]; then
    echo "[OK] nginx site present: $NGINX_SITE_PATH"
  else
    echo "[FAIL] nginx site missing: $NGINX_SITE_PATH"
  fi
}

check_database() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "[FAIL] psql command is missing"
    return
  fi

  if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c 'select 1' >/dev/null 2>&1; then
    echo "[OK] PostgreSQL connection works"
  else
    echo "[FAIL] PostgreSQL connection failed"
  fi
}

main() {
  echo "Letscook deployment diagnostics"
  echo ""

  check_path "Deploy config" "$INSTALL_CONFIG_PATH"
  check_path "Live app dir" "$APP_DIR"
  check_path "Deploy checkout" "$DEPLOY_DIR"
  check_path "Backend env" "$BACKEND_ENV_FILE"
  check_path "Backend virtualenv" "$VENV_PATH"
  check_path "Frontend dist" "$APP_FRONTEND_DIST_DIR/index.html"

  if [[ "$USE_GIT_DEPLOY" == "yes" ]]; then
    check_path "Deploy key" "$DEPLOY_KEY_PATH"
    check_path "Deploy public key" "$DEPLOY_KEY_PUB_PATH"
  fi

  check_service
  check_nginx
  check_database
}

main "$@"
