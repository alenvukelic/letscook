#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_CONFIG_PATH="$SCRIPT_DIR/install.config"
INSTALL_CONFIG_EXAMPLE_PATH="$SCRIPT_DIR/install.config.example"

if [[ ! -f "$INSTALL_CONFIG_PATH" ]]; then
  cp "$INSTALL_CONFIG_EXAMPLE_PATH" "$INSTALL_CONFIG_PATH"
  echo "Created $INSTALL_CONFIG_PATH from the example template."
fi

# shellcheck disable=SC1091
source "$SCRIPT_DIR/_lib.sh"

configure_install_values() {
  local answer=""

  echo ""
  echo "=============================================="
  echo "       Letscook Install Configuration"
  echo "=============================================="
  echo ""

  if prompt_yes_no "Do you want this server to pull Letscook from GitHub and prepare auto-deploy" "$USE_GIT_DEPLOY"; then
    save_config_value "USE_GIT_DEPLOY" "yes"
    save_config_value "AUTO_DEPLOY_ENABLE" "yes"

    save_config_value "GITHUB_OWNER" "$(prompt_value "GitHub owner" "$GITHUB_OWNER")"
    save_config_value "GITHUB_REPO" "$(prompt_value "GitHub repository" "$GITHUB_REPO")"
    save_config_value "REPO_BRANCH" "$(prompt_value "Git branch" "$REPO_BRANCH")"

    reload_config
    save_config_value "REPO_SSH_URL" "git@github.com:${GITHUB_OWNER}/${GITHUB_REPO}.git"
    save_config_value "REPO_HTTPS_URL" "https://${GITHUB_HOST}/${GITHUB_OWNER}/${GITHUB_REPO}.git"
  else
    save_config_value "USE_GIT_DEPLOY" "no"
    save_config_value "AUTO_DEPLOY_ENABLE" "no"
  fi

  save_config_value "APP_USER" "$(prompt_value "Application runtime user" "$APP_USER")"
  save_config_value "DEPLOY_USER" "$(prompt_value "Deploy user" "$DEPLOY_USER")"
  save_config_value "APP_DIR" "$(prompt_value "Live application directory" "$APP_DIR")"
  save_config_value "DEPLOY_DIR" "$(prompt_value "Deploy checkout directory" "$DEPLOY_DIR")"
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
