#!/bin/bash
#
# python-1-install.sh
# -------------------
# Python 3 + venv + dependencies installation
# Tested on: Ubuntu 22.04 / 24.04 / 24.10 / 25.04
#
# This script:
#   - installs Python 3 and pip (if not present)
#   - creates a .venv virtual environment
#   - installs backend dependencies from pyproject.toml
#   - verifies installation
#
# Usage:
#   chmod +x python-1-install.sh
#   ./python-1-install.sh
#

set -e

echo ""
echo "===================================================="
echo "        Python 3 + venv Installation"
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
# Install Python 3 and pip
# -------------------------------------------------------------
echo ""
echo "=== Installing Python 3 and pip ==="

apt update

if command -v python3 >/dev/null 2>&1; then
    PYTHON_VERSION=$(python3 --version)
    echo "Python 3 is already installed: $PYTHON_VERSION"
else
    echo "Installing Python 3..."
    apt install -y python3 python3-venv
fi

# Always ensure pip3 is installed
if ! command -v pip3 >/dev/null 2>&1; then
    echo "pip3 not found, installing python3-pip..."
    apt install -y python3-pip
fi

echo "Python: $(python3 --version)"
echo "pip:    $(pip3 --version)"

# -------------------------------------------------------------
# Ask for project directory
# -------------------------------------------------------------
echo ""
echo "=== Project Directory Setup ==="
echo ""
echo "Enter the project directory path (where pyproject.toml is):"
echo "  - Default: /home/avukelic/letscook/backend"
echo ""
read -r PROJECT_DIR

# Use default if empty
if [ -z "$PROJECT_DIR" ]; then
    PROJECT_DIR="/home/avukelic/letscook/backend"
fi

# Check if directory exists
if [ ! -d "$PROJECT_DIR" ]; then
    echo "Directory does not exist: $PROJECT_DIR"
    echo "Create it? (y/n)"
    read -r CREATE_DIR

    if [ "$CREATE_DIR" = "y" ]; then
        mkdir -p "$PROJECT_DIR"
        echo "Created directory: $PROJECT_DIR"
    else
        echo "Exiting."
        exit 1
    fi
fi

# Check if pyproject.toml exists
if [ ! -f "$PROJECT_DIR/pyproject.toml" ]; then
    echo "WARNING: pyproject.toml not found in $PROJECT_DIR"
    echo "Continue anyway? (y/n)"
    read -r CONTINUE
    if [ "$CONTINUE" != "y" ]; then
        exit 1
    fi
fi

# -------------------------------------------------------------
# Create .venv virtual environment
# -------------------------------------------------------------
echo ""
echo "=== Creating .venv virtual environment ==="

cd "$PROJECT_DIR"

if [ -d ".venv" ]; then
    echo "WARNING: .venv already exists in $PROJECT_DIR"
    echo "Remove existing .venv and create new one? (y/n)"
    read -r REMOVE_VENV

    if [ "$REMOVE_VENV" = "y" ]; then
        rm -rf .venv
        echo "Removed existing .venv"
    else
        echo "Using existing .venv"
    fi
fi

echo "Creating .venv..."
python3 -m venv .venv

# -------------------------------------------------------------
# Activate venv and install dependencies
# -------------------------------------------------------------
echo ""
echo "=== Installing dependencies from pyproject.toml ==="

if [ -f "$PROJECT_DIR/pyproject.toml" ]; then
    echo "Activating venv..."
    source .venv/bin/activate

    echo "Upgrading pip..."
    pip install --upgrade pip

    echo "Installing project in editable mode with dev dependencies..."
    pip install -e ".[dev]"

    echo "Deactivating venv..."
    deactivate
else
    echo "WARNING: pyproject.toml not found. Skipping dependency installation."
    echo ""
    echo "To install dependencies manually:"
    echo "  cd $PROJECT_DIR"
    echo "  source .venv/bin/activate"
    echo "  pip install -r requirements.txt  # if exists"
    echo "  deactivate"
fi

# -------------------------------------------------------------
# Verify installation
# -------------------------------------------------------------
echo ""
echo "=== Verifying Python installation ==="

echo "Testing .venv Python..."
.venv/bin/python --version

echo "Testing pip in .venv..."
.venv/bin/pip --version

# List installed packages
echo ""
echo "Installed packages in .venv:"
.venv/bin/pip list

# -------------------------------------------------------------
# Final info
# -------------------------------------------------------------
echo ""
echo "===================================================="
echo "   Python + venv installation complete!"
echo "===================================================="
echo ""
echo "Project directory: $PROJECT_DIR"
echo "venv location:    $PROJECT_DIR/.venv"
echo ""
echo "To activate the virtual environment:"
echo "  source $PROJECT_DIR/.venv/bin/activate"
echo ""
echo "To run the backend:"
echo "  cd $PROJECT_DIR"
echo "  source .venv/bin/activate"
echo "  fastapi dev app/main.py"
echo ""
echo "Next step: Run postgresql-1-install.sh"
echo "===================================================="