#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_CONFIG_PATH="${INSTALL_CONFIG_PATH:-$SCRIPT_DIR/install.config}"
INSTALL_CONFIG_EXAMPLE_PATH="${INSTALL_CONFIG_EXAMPLE_PATH:-$SCRIPT_DIR/install.config.example}"

load_config() {
  if [[ ! -f "$INSTALL_CONFIG_PATH" ]]; then
    echo "Missing install config: $INSTALL_CONFIG_PATH" >&2
    exit 1
  fi

  # shellcheck disable=SC1090
  source "$INSTALL_CONFIG_PATH"

  APP_BACKEND_DIR="$APP_DIR/backend"
  APP_FRONTEND_DIR="$APP_DIR/frontend"
  APP_MEDIA_DIR="$APP_DIR/var/media"
  APP_FRONTEND_DIST_DIR="$APP_FRONTEND_DIR/dist"
  VENV_PATH="$APP_BACKEND_DIR/$VENV_NAME"
  BACKEND_ENV_FILE="$APP_BACKEND_DIR/.env"
  DEPLOY_HOME="/home/$DEPLOY_USER"
  DEPLOY_SSH_DIR="$DEPLOY_HOME/.ssh"
  DEPLOY_KEY_PATH="$DEPLOY_SSH_DIR/$DEPLOY_KEY_NAME"
  DEPLOY_KEY_PUB_PATH="$DEPLOY_KEY_PATH.pub"
  SUDOERS_FILE="/etc/sudoers.d/$DEPLOY_USER-letscook"
  AUTO_DEPLOY_SCRIPT="$DEPLOY_DIR/deploy/_auto-update.sh"
  UPDATE_SCRIPT="$DEPLOY_DIR/deploy/update.sh"
  SYSTEMD_TEMPLATE_PATH="$APP_DIR/deploy/letscook.service"
  SYSTEMD_UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  NGINX_SITE_PATH="/etc/nginx/sites-available/$SERVICE_NAME"
  NGINX_SITE_LINK_PATH="/etc/nginx/sites-enabled/$SERVICE_NAME"
  SSL_DIR="/etc/ssl/$SERVICE_NAME"
  SELF_SIGNED_KEY_PATH="$SSL_DIR/selfsigned.key"
  SELF_SIGNED_CERT_PATH="$SSL_DIR/selfsigned.crt"
  CLONE_METHOD="${CLONE_METHOD:-https}"
  if [[ "$CLONE_METHOD" == "ssh" ]]; then
    REPO_FETCH_URL="$REPO_SSH_URL"
    GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY_PATH -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
  else
    REPO_FETCH_URL="$REPO_HTTPS_URL"
    GIT_SSH_COMMAND=""
  fi
}

load_config

ts() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] %s\n' "$(ts)" "$*"
}

warn() {
  printf '[%s] WARNING: %s\n' "$(ts)" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$(ts)" "$*" >&2
  exit 1
}

require_root() {
  [[ ${EUID:-0} -eq 0 ]] || die "Run this script as root with sudo."
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

setup_log_capture() {
  local log_file="$1"
  mkdir -p "$(dirname "$log_file")"
  touch "$log_file"
  exec > >(tee -a "$log_file") 2>&1
}

safe_apt_update() {
  if apt-get update; then
    return 0
  fi

  warn "apt-get update reported errors. This is often caused by an unrelated third-party repository."
  warn "The installer will continue and try to use the currently available package indexes."
  return 0
}

install_package_list() {
  local package_string="$1"
  local old_ifs="$IFS"
  local -a packages=()

  IFS=' '
  # shellcheck disable=SC2206
  packages=($package_string)
  IFS="$old_ifs"

  [[ ${#packages[@]} -gt 0 ]] || die "Package list is empty"
  apt-get install -y "${packages[@]}"
}

prompt_yes_no() {
  local prompt="$1"
  local default_value="$2"
  local answer=""
  local hint="[y/N]"

  if [[ "$default_value" == "yes" ]]; then
    hint="[Y/n]"
  fi

  read -r -p "$prompt $hint: " answer
  answer="${answer:-}"

  if [[ -z "$answer" ]]; then
    [[ "$default_value" == "yes" ]] && return 0 || return 1
  fi

  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

prompt_value() {
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

save_config_value() {
  local key="$1"
  local value="$2"

  python3 - "$INSTALL_CONFIG_PATH" "$key" "$value" <<'PY'
from pathlib import Path
import sys

config_path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
line = f'{key}="{value}"'

text = config_path.read_text(encoding='utf-8')
lines = text.splitlines()

for index, existing in enumerate(lines):
    if existing.startswith(f"{key}="):
        lines[index] = line
        break
else:
    lines.append(line)

config_path.write_text("\n".join(lines) + "\n", encoding='utf-8')
PY
}

reload_config() {
  load_config
}

ensure_dir() {
  local path="$1"
  local owner="$2"
  local mode="$3"
  mkdir -p "$path"
  chown "$owner:$owner" "$path"
  chmod "$mode" "$path"
}

ensure_tree_owner() {
  local path="$1"
  local owner="$2"
  [[ -e "$path" ]] || return 0
  chown -R "$owner:$owner" "$path"
}

ensure_user() {
  local user="$1"
  if id "$user" >/dev/null 2>&1; then
    usermod -s /bin/bash "$user"
    log "User $user already exists"
  else
    useradd -m -s /bin/bash "$user"
    log "Created user $user"
  fi
}

ensure_base_packages() {
  log "Installing base packages"
  safe_apt_update
  install_package_list "$BASE_PACKAGES"
}

ensure_runtime_commands() {
  command_exists "$PYTHON_BIN" || die "Required runtime is missing: $PYTHON_BIN. Run your Python base install script first."
  command_exists npm || die "Required runtime is missing: npm. Run your Node.js base install script first."
}

git_as_deploy() {
  if [[ "$CLONE_METHOD" == "ssh" ]]; then
    sudo -u "$DEPLOY_USER" env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git "$@"
  else
    sudo -u "$DEPLOY_USER" git "$@"
  fi
}

ensure_git_known_host() {
  [[ "$CLONE_METHOD" == "ssh" ]] || return 0

  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_SSH_DIR"
  local known_hosts="$DEPLOY_SSH_DIR/known_hosts"
  touch "$known_hosts"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$known_hosts"
  chmod 600 "$known_hosts"

  if ! grep -q "github.com" "$known_hosts" 2>/dev/null; then
    ssh-keyscan -H github.com >> "$known_hosts" 2>/dev/null || die "Failed to add github.com to known_hosts"
  fi
}

ensure_deploy_key() {
  [[ "$CLONE_METHOD" == "ssh" ]] || return 0

  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_SSH_DIR"

  if [[ ! -f "$DEPLOY_KEY_PATH" ]]; then
    log "Generating SSH deploy key for $DEPLOY_USER"
    sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N '' -f "$DEPLOY_KEY_PATH" -C "${SERVICE_NAME}-deploy"
  else
    log "SSH deploy key already exists at $DEPLOY_KEY_PATH"
  fi

  ensure_git_known_host
}

print_public_key_instructions() {
  [[ "$CLONE_METHOD" == "ssh" ]] || return 0

  cat <<EOF

Add this SSH public key in GitHub as a deploy key for ${GITHUB_OWNER}/${GITHUB_REPO}:

$(cat "$DEPLOY_KEY_PUB_PATH")

GitHub steps:
1. Repository -> Settings -> Deploy keys
2. Add deploy key
3. Paste the public key above
4. Keep read access unless you explicitly need write access

EOF
}

test_github_ssh() {
  if [[ "$CLONE_METHOD" != "ssh" ]]; then
    log "GitHub SSH test skipped because clone method is HTTPS"
    return 0
  fi

  sudo -u "$DEPLOY_USER" env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" ssh -T git@github.com >/tmp/${SERVICE_NAME}-github-ssh-test.log 2>&1 || true
  if grep -Eq 'successfully authenticated|Hi ' /tmp/${SERVICE_NAME}-github-ssh-test.log; then
    log "GitHub SSH authentication is working"
    return 0
  fi

  warn "GitHub SSH test did not confirm authentication yet"
  cat /tmp/${SERVICE_NAME}-github-ssh-test.log || true
  return 1
}

ensure_repo_checkout() {
  ensure_dir "/opt" root 755
  ensure_dir "$DEPLOY_DIR" "$DEPLOY_USER" 755

  if [[ ! -d "$DEPLOY_DIR/.git" ]]; then
    if find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 | read -r _; then
      die "$DEPLOY_DIR exists but is not an empty git repository directory"
    fi

    log "Cloning repository into $DEPLOY_DIR"
    git_as_deploy clone --branch "$REPO_BRANCH" "$REPO_FETCH_URL" "$DEPLOY_DIR"
  else
    log "Deploy checkout already exists at $DEPLOY_DIR"
  fi

  git_as_deploy -C "$DEPLOY_DIR" remote set-url origin "$REPO_FETCH_URL"
  git_as_deploy -C "$DEPLOY_DIR" fetch --all --prune
  git_as_deploy -C "$DEPLOY_DIR" checkout "$REPO_BRANCH"
  git_as_deploy -C "$DEPLOY_DIR" reset --hard "origin/$REPO_BRANCH"
  ensure_tree_owner "$DEPLOY_DIR" "$DEPLOY_USER"
}

resolve_source_dir() {
  if [[ "$USE_GIT_DEPLOY" == "yes" ]]; then
    printf '%s' "$DEPLOY_DIR"
  else
    printf '%s' "$REPO_ROOT"
  fi
}

sync_runtime_tree() {
  local source_dir
  source_dir="$(resolve_source_dir)"
  log "Syncing runtime tree from $source_dir to $APP_DIR"

  ensure_dir "$APP_DIR" "$APP_USER" 755
  ensure_dir "$APP_DIR/var" "$APP_USER" 755
  ensure_dir "$APP_MEDIA_DIR" "$APP_USER" 755

  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'frontend/dist' \
    --exclude 'backend/.venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'deploy/install.config' \
    --exclude 'PRIVATE.md' \
    "$source_dir/" "$APP_DIR/"

  ensure_tree_owner "$APP_DIR" "$APP_USER"
}

ensure_backend_env() {
  local database_url
  local jwt_secret

  if [[ -z "$JWT_SECRET_KEY" ]]; then
    jwt_secret="$(openssl rand -hex 32)"
    save_config_value "JWT_SECRET_KEY" "$jwt_secret"
    reload_config
    log "Generated JWT secret and saved it to install.config"
  fi

  database_url="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  [[ -f "$BACKEND_ENV_FILE" ]] || cp "$APP_BACKEND_DIR/.env.example" "$BACKEND_ENV_FILE"

  upsert_env_value "$BACKEND_ENV_FILE" "DATABASE_URL" "$database_url"
  upsert_env_value "$BACKEND_ENV_FILE" "BACKEND_CORS_ORIGINS" "$BACKEND_CORS_ORIGINS"
  upsert_env_value "$BACKEND_ENV_FILE" "JWT_SECRET_KEY" "$JWT_SECRET_KEY"
  upsert_env_value "$BACKEND_ENV_FILE" "MEDIA_ROOT" "$MEDIA_ROOT"

  chown "$APP_USER:$APP_USER" "$BACKEND_ENV_FILE"
  chmod 600 "$BACKEND_ENV_FILE"
  ensure_dir "$APP_MEDIA_DIR" "$APP_USER" 755
  log "Backend .env is ready at $BACKEND_ENV_FILE"
}

upsert_env_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"

  python3 - "$env_file" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
line = f"{key}={value}"

text = path.read_text(encoding='utf-8') if path.exists() else ""
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

ensure_backend_venv() {
  ensure_runtime_commands

  if [[ ! -x "$VENV_PATH/bin/python" ]]; then
    log "Creating backend virtualenv at $VENV_PATH"
    sudo -u "$APP_USER" "$PYTHON_BIN" -m venv "$VENV_PATH"
  else
    log "Backend virtualenv already exists at $VENV_PATH"
  fi

  sudo -u "$APP_USER" "$VENV_PATH/bin/pip" install --upgrade pip
  sudo -u "$APP_USER" bash -lc "cd '$APP_BACKEND_DIR' && '$VENV_PATH/bin/pip' install -e '.[dev]'"
  ensure_tree_owner "$VENV_PATH" "$APP_USER"
}

build_frontend() {
  [[ -f "$APP_FRONTEND_DIR/package.json" ]] || die "Missing frontend/package.json in $APP_FRONTEND_DIR"
  log "Installing frontend packages"
  sudo -u "$APP_USER" npm --prefix "$APP_FRONTEND_DIR" install
  log "Building frontend"
  sudo -u "$APP_USER" npm --prefix "$APP_FRONTEND_DIR" run build
  [[ -f "$APP_FRONTEND_DIST_DIR/index.html" ]] || die "Frontend build output is missing"
  ensure_tree_owner "$APP_FRONTEND_DIST_DIR" "$APP_USER"
}

test_database_connection() {
  if ! command_exists psql; then
    warn "psql is not installed; skipping database connection test"
    return 0
  fi

  if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c 'select 1' >/dev/null 2>&1; then
    log "Database connection test succeeded"
    return 0
  fi

  warn "Database connection test failed for ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  return 1
}

maybe_apply_schema() {
  local schema_file="$APP_DIR/db/schema.sql"

  command_exists psql || return 0
  [[ -f "$schema_file" ]] || return 0
  [[ "$APPLY_SCHEMA_IF_EMPTY" == "yes" ]] || return 0

  local has_users_table=""
  has_users_table="$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "select to_regclass('public.users') is not null")" || true

  if [[ "$has_users_table" == "t" ]]; then
    log "Database schema already appears to exist; skipping schema apply"
    return 0
  fi

  log "Applying schema from $schema_file"
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$schema_file"
}

install_service() {
  [[ -f "$SYSTEMD_TEMPLATE_PATH" ]] || die "Missing systemd template: $SYSTEMD_TEMPLATE_PATH"

  sed \
    -e "s|__APP_USER__|$APP_USER|g" \
    -e "s|__APP_BACKEND_DIR__|$APP_BACKEND_DIR|g" \
    -e "s|__VENV_PATH__|$VENV_PATH|g" \
    -e "s|__BACKEND_PORT__|$BACKEND_PORT|g" \
    "$SYSTEMD_TEMPLATE_PATH" > "$SYSTEMD_UNIT_PATH"

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  systemctl is-active --quiet "$SERVICE_NAME" || die "Service $SERVICE_NAME failed to start"
  log "Service $SERVICE_NAME is active"
}

ensure_self_signed_ssl() {
  ensure_dir "$SSL_DIR" root 700

  if [[ -f "$SELF_SIGNED_KEY_PATH" && -f "$SELF_SIGNED_CERT_PATH" ]]; then
    log "Self-signed certificate already exists"
    return 0
  fi

  local cn
  cn="${APP_DOMAIN:-$(hostname -f 2>/dev/null || hostname)}"
  openssl req -x509 -nodes -days "$SELF_SIGNED_DAYS" -newkey rsa:2048 \
    -keyout "$SELF_SIGNED_KEY_PATH" \
    -out "$SELF_SIGNED_CERT_PATH" \
    -subj "/C=${SELF_SIGNED_COUNTRY}/ST=${SELF_SIGNED_STATE}/L=${SELF_SIGNED_CITY}/O=${SELF_SIGNED_ORG}/OU=${SELF_SIGNED_OU}/CN=${cn}" >/dev/null 2>&1

  chmod 600 "$SELF_SIGNED_KEY_PATH"
  chmod 644 "$SELF_SIGNED_CERT_PATH"
  log "Generated self-signed certificate for $cn"
}

write_nginx_config() {
  local server_name="${APP_DOMAIN:-_}"

  if [[ "$SSL_MODE" == "self-signed" ]]; then
    ensure_self_signed_ssl
    cat > "$NGINX_SITE_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $server_name;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $server_name;

    ssl_certificate $SELF_SIGNED_CERT_PATH;
    ssl_certificate_key $SELF_SIGNED_KEY_PATH;

    root $APP_FRONTEND_DIST_DIR;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /docs {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
    }

    location = /redoc {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
    }

    location = /openapi.json {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
    }

    location /media/ {
        alias $APP_MEDIA_DIR/;
    }
}
EOF
  else
    cat > "$NGINX_SITE_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $server_name;

    root $APP_FRONTEND_DIST_DIR;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /docs {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
    }

    location = /redoc {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
    }

    location = /openapi.json {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
    }

    location /media/ {
        alias $APP_MEDIA_DIR/;
    }
}
EOF
  fi

  rm -f /etc/nginx/sites-enabled/default
  ln -sfn "$NGINX_SITE_PATH" "$NGINX_SITE_LINK_PATH"
  nginx -t
  systemctl reload nginx
  log "nginx configuration is active"

  if [[ "$SSL_MODE" == "letsencrypt" ]]; then
    [[ -n "$APP_DOMAIN" ]] || die "APP_DOMAIN is required for Let's Encrypt"
    [[ -n "$LETSENCRYPT_EMAIL" ]] || die "LETSENCRYPT_EMAIL is required for Let's Encrypt"
    certbot --nginx -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive --redirect
    systemctl reload nginx
    log "Let's Encrypt certificate installed"
  fi
}

maybe_setup_nginx() {
  [[ "$ENABLE_NGINX" == "yes" ]] || {
    log "Skipping nginx configuration"
    return 0
  }

  write_nginx_config
}

setup_auto_deploy_sudoers() {
  if [[ "$AUTO_DEPLOY_ENABLE" != "yes" ]]; then
    log "Auto-deploy sudoers setup skipped"
    return 0
  fi

  cat > "$SUDOERS_FILE" <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/bash $AUTO_DEPLOY_SCRIPT
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/bash $UPDATE_SCRIPT
EOF
  chmod 440 "$SUDOERS_FILE"
  log "Auto-deploy sudoers rule written to $SUDOERS_FILE"
}

print_install_summary() {
  cat <<EOF

Install or repair completed.

Live app directory:
  $APP_DIR

Backend env:
  $BACKEND_ENV_FILE

Service:
  systemctl status $SERVICE_NAME

nginx site:
  $NGINX_SITE_PATH

Install log:
  $INSTALL_LOG

Manual update:
  sudo bash $UPDATE_SCRIPT

Diagnostics:
  sudo bash $DEPLOY_DIR/deploy/diagnose.sh

EOF
}
