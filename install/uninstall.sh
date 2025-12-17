#!/bin/bash
#
# Twitch Ad Muter - Native Host Uninstallation Script
#
# This script removes the native messaging host registration from Firefox.
# It only removes the manifest file; it does not delete the project files.
#
# Usage: ./uninstall.sh
#

set -e

# =============================================================================
# Configuration
# =============================================================================

NATIVE_HOST_NAME="com.twitchadmuter.host"
NATIVE_MESSAGING_HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
MANIFEST_PATH="$NATIVE_MESSAGING_HOSTS_DIR/$NATIVE_HOST_NAME.json"

# =============================================================================
# Helper Functions
# =============================================================================

print_error() {
    echo "[ERROR] $1" >&2
}

print_info() {
    echo "[INFO] $1"
}

print_success() {
    echo "[SUCCESS] $1"
}

# =============================================================================
# Uninstallation
# =============================================================================

print_info "Checking for native host manifest..."

if [ ! -f "$MANIFEST_PATH" ]; then
    print_info "Native host manifest not found. Nothing to uninstall."
    exit 0
fi

print_info "Removing native host manifest..."
rm "$MANIFEST_PATH"

# Verify removal
if [ -f "$MANIFEST_PATH" ]; then
    print_error "Failed to remove manifest file."
    exit 1
fi

# =============================================================================
# Success Output
# =============================================================================

echo ""
print_success "Native host uninstallation completed successfully."
echo ""
echo "The native host manifest has been removed from:"
echo "  $MANIFEST_PATH"
echo ""
echo "Note: The extension and project files have not been removed."
echo "To completely remove the extension:"
echo "  1. Open Firefox"
echo "  2. Navigate to about:addons"
echo "  3. Find 'Mute' and click Remove"
echo ""
