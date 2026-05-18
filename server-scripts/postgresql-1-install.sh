#!/bin/bash
#
# postgresql-1-install.sh
# -----------------------
# PostgreSQL installation and basic setup
# Tested on: Ubuntu 22.04 / 24.04 / 24.10 / 25.04
#
# This script:
#   - installs PostgreSQL server
#   - configures basic settings
#   - creates a database and user for the app
#   - optionally loads schema.sql
#
# Usage:
#   chmod +x postgresql-1-install.sh
#   ./postgresql-1-install.sh
#

set -e

echo ""
echo "===================================================="
echo "        PostgreSQL Installation"
echo "===================================================="
echo ""

# -------------------------------------------------------------
# Check if running as root
# -------------------------------------------------------------
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo)!"
    exit 1
fi

# -------------------------------------------------------------
# Detect OS
# -------------------------------------------------------------
echo "Detecting OS..."
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="$NAME"
    OS_VERSION="$VERSION_ID"
else
    echo "ERROR: Cannot detect OS version."
    exit 1
fi
echo "Detected: $OS_NAME $OS_VERSION"

# -------------------------------------------------------------
# Check if PostgreSQL is already installed
# -------------------------------------------------------------
if command -v psql >/dev/null 2>&1; then
    PG_VERSION=$(psql --version)
    echo "PostgreSQL is already installed: $PG_VERSION"
    echo ""
    echo "Reinstall PostgreSQL? (y/n)"
    echo "  y = remove and reinstall (fresh install)"
    echo "  n = keep current installation"
    read -r REINSTALL

    if [ "$REINSTALL" != "y" ]; then
        echo "Keeping current PostgreSQL installation."
    else
        echo "Removing existing PostgreSQL..."
        systemctl stop postgresql 2>/dev/null || true
        apt remove -y postgresql postgresql-16 || true
        apt autoremove -y
    fi
fi

# -------------------------------------------------------------
# Install PostgreSQL
# -------------------------------------------------------------
echo ""
echo "=== Installing PostgreSQL ==="

apt update

# Install PostgreSQL (default version on Ubuntu 24.04 is 16)
apt install -y postgresql postgresql-contrib

# -------------------------------------------------------------
# Enable and start PostgreSQL
# -------------------------------------------------------------
echo ""
echo "=== Enabling and starting PostgreSQL ==="

systemctl enable postgresql
systemctl start postgresql
systemctl status postgresql --no-pager

# -------------------------------------------------------------
# PostgreSQL configuration
# -------------------------------------------------------------
echo ""
echo "=== PostgreSQL Configuration ==="

# Get PostgreSQL version
PG_VERSION=$(psql --version | grep -oP '\d+' | head -1)
echo "PostgreSQL version: $PG_VERSION"

# -------------------------------------------------------------
# Create database and user for the app
# -------------------------------------------------------------
echo ""
echo "=== Creating App Database and User ==="
echo ""

# Default values
DEFAULT_DB="letscook"
DEFAULT_USER="letscook"
DEFAULT_PASS="changeme"

echo "Database name (default: $DEFAULT_DB):"
read -r DB_NAME
if [ -z "$DB_NAME" ]; then
    DB_NAME="$DEFAULT_DB"
fi

echo "Database user (default: $DEFAULT_USER):"
read -r DB_USER
if [ -z "$DB_USER" ]; then
    DB_USER="$DEFAULT_USER"
fi

echo "Database password (default: $DEFAULT_PASS):"
read -r DB_PASS
if [ -z "$DB_PASS" ]; then
    DB_PASS="$DEFAULT_PASS"
fi

echo ""
echo "Creating user '$DB_USER' and database '$DB_NAME'..."

# Switch to postgres user and run commands
su - postgres -c "psql -c \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER';\"" | grep -q 1 || \
    su - postgres -c "psql -c \"CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';\""

su - postgres -c "psql -c \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME';\"" | grep -q 1 || \
    su - postgres -c "psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""

echo "User and database created successfully."

# -------------------------------------------------------------
# Configure PostgreSQL to accept connections
# -------------------------------------------------------------
echo ""
echo "=== Configuring PostgreSQL for network access ==="

PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
PG_CONF="/etc/postgresql/$PG_VERSION/main/postgresql.conf"

# Backup pg_hba.conf
PG_HBA_BACKUP="$PG_HBA.backup.$(date +%F-%H%M)"
cp "$PG_HBA" "$PG_HBA_BACKUP"
echo "Backup created: $PG_HBA_BACKUP"

# Add IPv4 local connection for the app user
if ! grep -q "host.*$DB_USER.*127.0.0.1/32.*md5" "$PG_HBA"; then
    echo "host    $DB_NAME      $DB_USER      127.0.0.1/32      md5" >> "$PG_HBA"
fi

# Optionally allow connections from other hosts (for development)
echo ""
echo "Allow connections from other hosts? (y/n)"
echo "  y = allow from 0.0.0.0/0 (not secure for production)"
echo "  n = only allow from localhost"
read -r ALLOW_ALL

if [ "$ALLOW_ALL" = "y" ]; then
    if ! grep -q "host.*$DB_USER.*0.0.0.0/0.*md5" "$PG_HBA"; then
        echo "host    $DB_NAME      $DB_USER      0.0.0.0/0        md5" >> "$PG_HBA"
    fi
fi

# Listen on all interfaces
if grep -q "^listen_addresses" "$PG_CONF"; then
    sed -i "s/^listen_addresses.*/listen_addresses = '*'/" "$PG_CONF"
else
    echo "listen_addresses = '*'" >> "$PG_CONF"
fi

# -------------------------------------------------------------
# Restart PostgreSQL
# -------------------------------------------------------------
echo ""
echo "=== Restarting PostgreSQL ==="

systemctl restart postgresql
systemctl status postgresql --no-pager

# -------------------------------------------------------------
# Test connection
# -------------------------------------------------------------
echo ""
echo "=== Testing connection ==="

export PGPASSWORD="$DB_PASS"
if psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" >/dev/null 2>&1; then
    echo "Connection successful!"
else
    echo "WARNING: Connection test failed."
    echo "Check pg_hba.conf and postgresql.conf"
fi
unset PGPASSWORD

# -------------------------------------------------------------
# Optionally load schema
# -------------------------------------------------------------
echo ""
echo "=== Loading Database Schema ==="
echo ""
echo "Do you want to load schema.sql? (y/n)"
echo "  y = load schema from /home/avukelic/letscook/db/schema.sql"
echo "  n = skip (you can load it manually later)"
read -r LOAD_SCHEMA

if [ "$LOAD_SCHEMA" = "y" ]; then
    SCHEMA_FILE="/home/avukelic/letscook/db/schema.sql"

    if [ -f "$SCHEMA_FILE" ]; then
        echo "Loading schema from $SCHEMA_FILE..."
        su - postgres -c "psql -d $DB_NAME -f $SCHEMA_FILE"
        echo "Schema loaded successfully."
    else
        echo "Schema file not found: $SCHEMA_FILE"
    fi
fi

# -------------------------------------------------------------
# Connection info for .env
# -------------------------------------------------------------
echo ""
echo "===================================================="
echo "   PostgreSQL installation complete!"
echo "===================================================="
echo ""
echo "Connection details:"
echo "  Host:     127.0.0.1"
echo "  Port:     5432"
echo "  Database: $DB_NAME"
echo "  User:     $DB_USER"
echo "  Password: $DB_PASS"
echo ""
echo "For .env file:"
echo "  DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME"
echo ""
echo "Next step: Run nodejs-1-install.sh"
echo "===================================================="