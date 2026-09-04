#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "========================================="
echo " Building BotRunner Hub for Render       "
echo "========================================="

# 1. Install Node dependencies and compile the production bundle
echo "==> Installing Node.js packages (including build tools)..."
npm install --include=dev

echo "==> Building frontend assets and bundled server..."
npm run build

# 2. Check and ensure Python environment
echo "==> Verifying Python3 runtime for uploaded bots..."
if command -v python3 &>/dev/null; then
    echo "Python version: $(python3 --version)"
    if command -v pip3 &>/dev/null; then
        echo "Pip version: $(pip3 --version)"
    else
        echo "Note: pip3 not found directly in path. Will use python3 -m pip if available."
    fi
else
    echo "Warning: python3 is not available in current container environment."
fi

# 3. Create persistent directories
mkdir -p deployments

echo "========================================="
echo " Build Completed Successfully!           "
echo " Ready for Render Web Service execution  "
echo "========================================="
