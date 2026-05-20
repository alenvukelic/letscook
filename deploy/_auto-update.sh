#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_CONFIG_PATH="${INSTALL_CONFIG_PATH:-$SCRIPT_DIR/install.config}"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/_lib.sh"

main() {
  require_root
  setup_log_capture "$AUTO_DEPLOY_LOG"

  log "Starting Letscook auto-update"

  ensure_user "$APP_USER"
  ensure_user "$DEPLOY_USER"

  if [[ "$USE_GIT_DEPLOY" == "yes" ]]; then
    ensure_repo_checkout
  fi

  sync_runtime_tree
  ensure_backend_env
  ensure_backend_venv
  apply_database_migrations
  build_frontend
  install_service
  maybe_setup_nginx

  log "Letscook auto-update completed"
}

main "$@"
