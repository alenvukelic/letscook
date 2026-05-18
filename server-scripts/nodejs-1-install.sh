#!/bin/bash
#
# nodejs-1-install.sh
# -------------------
# Node.js and npm installation
# Tested on: Ubuntu 22.04 / 24.04 / 24.10 / 25.04
#
# This script:
#   - installs Node.js (LTS version via NodeSource)
#   - installs npm
#   - optionally installs build tools for native modules
#   - verifies installation
#
# Usage:
#   chmod +x nodejs-1-install.sh
#   ./nodejs-1-install.sh
#

set -e

echo ""
echo "===================================================="
echo "        Node.js + npm Installation"
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
# Check if Node.js is already installed
# -------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    echo "Node.js is already installed: $NODE_VERSION"
    echo "npm: $NPM_VERSION"
    echo ""
    echo "Reinstall Node.js? (y/n)"
    echo "  y = remove and reinstall (newer version)"
    echo "  n = keep current installation"
    read -r REINSTALL

    if [ "$REINSTALL" != "y" ]; then
        echo "Keeping current Node.js installation."
        echo ""
        echo "===================================================="
        echo "   Node.js is already installed!"
        echo "===================================================="
        echo ""
        echo "Node:  $(node --version)"
        echo "npm:   $(npm --version)"
        exit 0
    fi
fi

# -------------------------------------------------------------
# Choose Node.js version
# -------------------------------------------------------------
echo ""
echo "=== Node.js Version Selection ==="
echo ""
echo "Select Node.js version:"
echo "  1) Node.js 20.x (LTS) - recommended"
echo "  2) Node.js 22.x (latest stable)"
echo "  3) Node.js 18.x (older LTS)"
echo ""
read -r NODE_CHOICE

case "$NODE_CHOICE" in
    1) NODE_MAJOR_VERSION=20 ;;
    2) NODE_MAJOR_VERSION=22 ;;
    3) NODE_MAJOR_VERSION=18 ;;
    *) NODE_MAJOR_VERSION=20 ;;
esac

echo "Selected Node.js $NODE_MAJOR_VERSION.x"

# -------------------------------------------------------------
# Install Node.js via NodeSource
# -------------------------------------------------------------
echo ""
echo "=== Installing Node.js $NODE_MAJOR_VERSION.x ==="

# Check if NodeSource repo already exists
if [ -f /etc/apt/sources.list.d/nodesource.list ]; then
    echo "NodeSource repository already configured."
else
    echo "Setting up NodeSource repository..."

    # Install curl and gnupg if not present
    apt update
    apt install -y curl gnupg

    # Add NodeSource repository
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_VERSION}.x" | bash -
fi

# Install Node.js
apt install -y nodejs

# -------------------------------------------------------------
# Verify installation
# -------------------------------------------------------------
echo ""
echo "=== Verifying Node.js installation ==="

echo "Node.js: $(node --version)"
echo "npm:    $(npm --version)"

# -------------------------------------------------------------
# Install build tools (optional)
# -------------------------------------------------------------
echo ""
echo "=== Build Tools for Native Modules ==="
echo ""
echo "Install build tools for native npm modules? (y/n)"
echo "  y = install build-essential, python3, etc."
echo "  n = skip (some packages may fail to build)"
read -r BUILD_TOOLS

if [ "$BUILD_TOOLS" = "y" ]; then
    echo "Installing build tools..."
    apt install -y build-essential python3
    echo "Build tools installed."
fi

# -------------------------------------------------------------
# Configure npm
# -------------------------------------------------------------
echo ""
echo "=== Configuring npm ==="

# Set npm to use legacy peer deps (some packages need this)
# npm config set legacy-peer-deps true

# Configure npm global directory
echo ""
echo "Configure npm to install global packages without sudo? (y/n)"
echo "  y = create npm global directory in ~/npm-global"
echo "  n = use default (requires sudo for global packages)"
read -r NPM_GLOBAL

if [ "$NPM_GLOBAL" = "y" ]; then
    NPM_GLOBAL_DIR="$HOME/npm-global"
    mkdir -p "$NPM_GLOBAL_DIR"

    npm config set prefix "$NPM_GLOBAL_DIR"

    # Add to PATH in .bashrc
    if ! grep -q "npm-global" "$HOME/.bashrc"; then
        echo "" >> "$HOME/.bashrc"
        echo "# npm global packages" >> "$HOME/.bashrc"
        echo "export PATH=\"$NPM_GLOBAL_DIR/bin:\$PATH\"" >> "$HOME/.bashrc"
    fi

    echo "npm configured for global installs without sudo."
    echo "Run 'source ~/.bashrc' or start a new shell to use it."
fi

# -------------------------------------------------------------
# Test npm
# -------------------------------------------------------------
echo ""
echo "=== Testing npm ==="

echo "Testing npm by checking a package..."
if npm info express >/dev/null 2>&1; then
    echo "npm is working correctly."
else
    echo "WARNING: npm may have issues connecting to registry."
fi

# -------------------------------------------------------------
# Show npm version and list global packages
# -------------------------------------------------------------
echo ""
echo "=== npm Global Packages ==="
npm list -g --depth=0

# -------------------------------------------------------------
# Ask about frontend setup
# -------------------------------------------------------------
echo ""
echo "=== Frontend Setup ==="
echo ""
echo "Do you want to set up the frontend? (y/n)"
echo "  y = install frontend dependencies in /home/avukelic/letscook/frontend"
echo "  n = skip (you can do this manually later)"
read -r SETUP_FRONTEND

if [ "$SETUP_FRONTEND" = "y" ]; then
    FRONTEND_DIR="/home/avukelic/letscook/frontend"

    if [ ! -d "$FRONTEND_DIR" ]; then
        echo "Frontend directory not found: $FRONTEND_DIR"
        echo "Create it and continue? (y/n)"
        read -r CREATE_DIR
        if [ "$CREATE_DIR" = "y" ]; then
            mkdir -p "$FRONTEND_DIR"
        else
            echo "Skipping frontend setup."
            SETUP_FRONTEND="n"
        fi
    fi

    if [ "$SETUP_FRONTEND" = "y" ] && [ -d "$FRONTEND_DIR" ]; then
        echo "Installing frontend dependencies..."
        cd "$FRONTEND_DIR"

        if [ -f "package.json" ]; then
            npm install
            echo "Frontend dependencies installed."
        else
            echo "package.json not found in $FRONTEND_DIR"
        fi
    fi
fi

# -------------------------------------------------------------
# Final info
# -------------------------------------------------------------
echo ""
echo "===================================================="
echo "   Node.js + npm installation complete!"
echo "===================================================="
echo ""
echo "Node.js: $(node --version)"
echo "npm:    $(npm --version)"
echo ""
echo "To verify Node.js is working:"
echo "  node -e \"console.log('Hello from Node.js!')\""
echo ""
echo "Next steps:"
echo "  1. Set up nginx configuration"
echo "  2. Configure .env for the backend"
echo "  3. Build and deploy the frontend"
echo "===================================================="