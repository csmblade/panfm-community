#!/bin/bash
# Docker entrypoint script for PANfm
# Validates that all required files exist and are files (not directories)
# before starting the Flask application

set -e

echo "PANfm Docker Container Starting..."
echo "=================================="

# List of required files that must exist and be files (not directories)
REQUIRED_FILES=(
    "settings.json"
    "devices.json"
    "encryption.key"
    "auth.json"
    "device_metadata.json"
    "mac_vendor_db.json"
    "service_port_db.json"
)

# Validation flag
VALIDATION_FAILED=0

echo "Validating required files..."
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -e "$file" ]; then
        echo "  ✗ ERROR: $file does not exist"
        VALIDATION_FAILED=1
    elif [ -d "$file" ]; then
        echo "  ✗ ERROR: $file is a directory (should be a file)"
        echo "           This happens when docker-compose is started before running setup.sh"
        VALIDATION_FAILED=1
    elif [ -f "$file" ]; then
        SIZE=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
        echo "  ✓ $file exists ($SIZE bytes)"
    fi
done

if [ $VALIDATION_FAILED -eq 1 ]; then
    echo ""
    echo "=================================="
    echo "ERROR: Pre-flight validation failed!"
    echo "=================================="
    echo ""
    echo "Please ensure you run './setup.sh' BEFORE 'docker-compose up'"
    echo ""
    echo "If you have directory mounts instead of file mounts:"
    echo "  1. Run: docker-compose down -v"
    echo "  2. Run: ./setup.sh"
    echo "  3. Delete any directories with the names above"
    echo "  4. Run: docker-compose up -d"
    echo ""
    exit 1
fi

echo "=================================="
echo "✓ All required files validated"
echo "Starting Flask application..."
echo "=================================="
echo ""

# Execute the main command (passed as arguments to this script)
exec "$@"
