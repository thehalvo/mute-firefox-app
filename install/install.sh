#!/bin/bash
#
# Twitch Ad Muter - Native Host Installation Script
#
# This script installs the native messaging host for Firefox on macOS.
# It creates the manifest file with the correct path and registers it
# with Firefox's NativeMessagingHosts directory.
#
# Usage: ./install.sh
#

set -e

# =============================================================================
# Configuration
# =============================================================================

NATIVE_HOST_NAME="com.twitchadmuter.host"
EXTENSION_ID="mute@twitchadmuter.com"
NATIVE_MESSAGING_HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

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
# Directory Resolution
# =============================================================================

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_HOST_DIR="$PROJECT_ROOT/native-host"
NATIVE_HOST_SCRIPT="$NATIVE_HOST_DIR/twitch_ad_muter_host.py"

# =============================================================================
# Validation
# =============================================================================

print_info "Validating installation environment..."

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is not installed or not in PATH."
    print_error "Please install Python 3 before running this script."
    print_error "On macOS, Python 3 should be available since Catalina."
    print_error "You can install it via: xcode-select --install"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
print_info "Found $PYTHON_VERSION"

# Check if the native host script exists
if [ ! -f "$NATIVE_HOST_SCRIPT" ]; then
    print_error "Native host script not found at: $NATIVE_HOST_SCRIPT"
    print_error "Please ensure the project structure is intact."
    exit 1
fi

print_info "Found native host script at: $NATIVE_HOST_SCRIPT"

# =============================================================================
# Installation
# =============================================================================

# Create NativeMessagingHosts directory if it doesn't exist
if [ ! -d "$NATIVE_MESSAGING_HOSTS_DIR" ]; then
    print_info "Creating NativeMessagingHosts directory..."
    mkdir -p "$NATIVE_MESSAGING_HOSTS_DIR"
    print_info "Created: $NATIVE_MESSAGING_HOSTS_DIR"
else
    print_info "NativeMessagingHosts directory exists: $NATIVE_MESSAGING_HOSTS_DIR"
fi

# Set executable permission on the Python script
print_info "Setting executable permission on native host script..."
chmod +x "$NATIVE_HOST_SCRIPT"

# Generate the manifest JSON with the correct absolute path
MANIFEST_PATH="$NATIVE_MESSAGING_HOSTS_DIR/$NATIVE_HOST_NAME.json"
print_info "Generating native host manifest..."

cat > "$MANIFEST_PATH" << EOF
{
  "name": "$NATIVE_HOST_NAME",
  "description": "Native messaging host for Twitch Ad Muter - controls macOS system audio mute",
  "path": "$NATIVE_HOST_SCRIPT",
  "type": "stdio",
  "allowed_extensions": ["$EXTENSION_ID"]
}
EOF

print_info "Manifest created at: $MANIFEST_PATH"

# =============================================================================
# Verification
# =============================================================================

print_info "Verifying installation..."

# Verify the manifest file exists and is readable
if [ ! -f "$MANIFEST_PATH" ]; then
    print_error "Failed to create manifest file."
    exit 1
fi

# Verify the path in the manifest points to an executable
if [ ! -x "$NATIVE_HOST_SCRIPT" ]; then
    print_error "Native host script is not executable."
    exit 1
fi

# Test that Python can parse the host script
if ! python3 -m py_compile "$NATIVE_HOST_SCRIPT" 2>/dev/null; then
    print_error "Native host script has Python syntax errors."
    exit 1
fi

print_info "Syntax check passed for native host script."

# =============================================================================
# Success Output
# =============================================================================

echo ""
print_success "Native host installation completed successfully."
echo ""
echo "Installation Details:"
echo "  - Native Host Name: $NATIVE_HOST_NAME"
echo "  - Manifest Location: $MANIFEST_PATH"
echo "  - Host Script: $NATIVE_HOST_SCRIPT"
echo "  - Allowed Extension: $EXTENSION_ID"
echo ""
echo "Next Steps:"
echo "  1. Install the Firefox extension from: $PROJECT_ROOT/extension/"
echo "  2. Load the extension via about:debugging -> Load Temporary Add-on"
echo "  3. Select the manifest.json file from the extension directory"
echo "  4. Restart Firefox if it was running during installation"
echo "  5. Navigate to twitch.tv to test ad detection"
echo ""
echo "Troubleshooting:"
echo "  - If connection fails, verify Firefox was restarted after installation"
echo "  - Check macOS Privacy settings if volume control doesn't work"
echo "  - Enable DEBUG mode in the host script for detailed logging"
echo ""
