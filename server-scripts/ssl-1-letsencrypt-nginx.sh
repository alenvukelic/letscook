#!/bin/bash
#
# ssl-1-letsencrypt-nginx.sh
# ---------------------------
# Let's Encrypt SSL setup for a single nginx site.
# Tested on: Ubuntu 24.04
#
# This script intentionally edits only one nginx site file and preserves
# unrelated nginx sites and existing certificates.
#
# Usage:
#   sudo bash ssl-1-letsencrypt-nginx.sh
#

set -euo pipefail

DOMAIN_DEFAULT="kuharica.freeddns.org"
EMAIL_DEFAULT="avukelic@gmail.com"
SITE_NAME_DEFAULT="letscook"
WEBROOT_DEFAULT="/opt/letscook-app/frontend/dist"
MEDIA_DIR_DEFAULT="/opt/letscook-app/var/media"
BACKEND_PORT_DEFAULT="8000"

echo ""
echo "===================================================="
echo "        Let's Encrypt + nginx SSL Setup"
echo "===================================================="
echo ""

if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo)."
    exit 1
fi

prompt_value() {
    local label="$1"
    local default_value="$2"
    local value

    read -r -p "$label [$default_value]: " value
    if [ -z "$value" ]; then
        value="$default_value"
    fi
    printf '%s' "$value"
}

require_command() {
    local command_name="$1"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "ERROR: Missing required command: $command_name"
        exit 1
    fi
}

echo "=== Configuration ==="
DOMAIN="$(prompt_value "Domain" "$DOMAIN_DEFAULT")"
EMAIL="$(prompt_value "Let's Encrypt email" "$EMAIL_DEFAULT")"
SITE_NAME="$(prompt_value "nginx site name" "$SITE_NAME_DEFAULT")"
WEBROOT="$(prompt_value "Frontend webroot" "$WEBROOT_DEFAULT")"
MEDIA_DIR="$(prompt_value "Media directory" "$MEDIA_DIR_DEFAULT")"
BACKEND_PORT="$(prompt_value "Backend port" "$BACKEND_PORT_DEFAULT")"

SITE_PATH="/etc/nginx/sites-available/$SITE_NAME"
SITE_LINK_PATH="/etc/nginx/sites-enabled/$SITE_NAME"
CERT_LIVE_DIR="/etc/letsencrypt/live/$DOMAIN"
RENEWAL_HOOK="/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh"

echo ""
echo "=== Preflight Checks ==="
require_command nginx
require_command certbot
require_command getent
require_command curl

if [ ! -d "$WEBROOT" ]; then
    echo "ERROR: Webroot does not exist: $WEBROOT"
    exit 1
fi

if [ ! -f "$SITE_PATH" ]; then
    echo "ERROR: nginx site file does not exist: $SITE_PATH"
    exit 1
fi

if [ -e "$SITE_LINK_PATH" ] && [ ! -L "$SITE_LINK_PATH" ]; then
    echo "ERROR: Enabled site path exists but is not a symlink: $SITE_LINK_PATH"
    echo "Refusing to overwrite it."
    exit 1
fi

if [ -L "$SITE_LINK_PATH" ]; then
    CURRENT_TARGET="$(readlink -f "$SITE_LINK_PATH")"
    EXPECTED_TARGET="$(readlink -f "$SITE_PATH")"
    if [ "$CURRENT_TARGET" != "$EXPECTED_TARGET" ]; then
        echo "ERROR: Enabled site symlink points elsewhere: $SITE_LINK_PATH -> $CURRENT_TARGET"
        echo "Refusing to overwrite it."
        exit 1
    fi
fi

echo "Checking DNS for $DOMAIN..."
getent ahosts "$DOMAIN" | head -n 5 || {
    echo "ERROR: DNS lookup failed for $DOMAIN"
    exit 1
}

echo "Checking nginx syntax before changes..."
nginx -t

echo ""
echo "The script will update only this nginx site: $SITE_PATH"
echo "A timestamped backup will be created first."
read -r -p "Continue? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "=== Certificate ==="
if [ -f "$CERT_LIVE_DIR/fullchain.pem" ] && [ -f "$CERT_LIVE_DIR/privkey.pem" ]; then
    echo "Existing certificate files found for $DOMAIN. Certbot will keep them if still valid."
fi

certbot certonly \
    --webroot \
    -w "$WEBROOT" \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring

if [ ! -f "$CERT_LIVE_DIR/fullchain.pem" ] || [ ! -f "$CERT_LIVE_DIR/privkey.pem" ]; then
    echo "ERROR: Certificate files were not created under $CERT_LIVE_DIR"
    exit 1
fi

echo ""
echo "=== nginx Configuration ==="
BACKUP_PATH="$SITE_PATH.backup-$(date +%Y%m%d-%H%M%S)"
cp "$SITE_PATH" "$BACKUP_PATH"
echo "Backup created: $BACKUP_PATH"

cat > "$SITE_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    root $WEBROOT;
    index index.html;

    location /.well-known/acme-challenge/ {
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }

    location = /version.json {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }

    location = /changelog.md {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
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
        alias $MEDIA_DIR/;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate $CERT_LIVE_DIR/fullchain.pem;
    ssl_certificate_key $CERT_LIVE_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    root $WEBROOT;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }

    location = /version.json {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }

    location = /changelog.md {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
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
        alias $MEDIA_DIR/;
    }
}
EOF

if [ ! -L "$SITE_LINK_PATH" ]; then
    ln -s "$SITE_PATH" "$SITE_LINK_PATH"
    echo "Enabled site symlink created: $SITE_LINK_PATH"
fi

echo "Checking nginx syntax after changes..."
if ! nginx -t; then
    echo "ERROR: nginx test failed. Restoring backup."
    cp "$BACKUP_PATH" "$SITE_PATH"
    nginx -t || true
    exit 1
fi

echo ""
echo "=== Renewal Hook ==="
mkdir -p "$(dirname "$RENEWAL_HOOK")"
if [ -f "$RENEWAL_HOOK" ]; then
    echo "Renewal hook already exists: $RENEWAL_HOOK"
else
    cat > "$RENEWAL_HOOK" <<'EOF'
#!/bin/sh
set -e
systemctl reload nginx
EOF
    chmod 755 "$RENEWAL_HOOK"
    echo "Renewal hook installed: $RENEWAL_HOOK"
fi

if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
fi

echo "Reloading nginx..."
systemctl reload nginx

echo ""
echo "=== Verification ==="
curl -k -I --resolve "$DOMAIN:443:127.0.0.1" --max-time 15 "https://$DOMAIN/" | sed -n '1,15p'
if ! curl -I --max-time 15 "https://$DOMAIN/" | sed -n '1,15p'; then
    echo "WARNING: Public HTTPS check failed. nginx local HTTPS works, but port 443 may need router or firewall forwarding."
fi
certbot certificates -d "$DOMAIN" || true

echo ""
echo "SSL setup completed for https://$DOMAIN"
echo "Rollback backup: $BACKUP_PATH"
