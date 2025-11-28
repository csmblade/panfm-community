#!/bin/bash
# =========================================
# PANfm Docker Entrypoint
# =========================================
# Validates required files, waits for database,
# initializes schema, then starts the application.
# =========================================

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║           PANfm Docker Container Starting                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# =========================================
# Step 1: Validate Required Files
# =========================================
# These files must exist as FILES (not directories)
# Docker creates directories if files don't exist before mount

REQUIRED_FILES=(
    "settings.json"
    "devices.json"
    "encryption.key"
    "auth.json"
    "device_metadata.json"
    "mac_vendor_db.json"
    "service_port_db.json"
)

VALIDATION_FAILED=0

echo "[1/3] Validating required files..."
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -e "$file" ]; then
        echo "  ✗ ERROR: $file does not exist"
        VALIDATION_FAILED=1
    elif [ -d "$file" ]; then
        echo "  ✗ ERROR: $file is a directory (should be a file)"
        echo "           Run ./setup.sh BEFORE docker compose up"
        VALIDATION_FAILED=1
    elif [ -f "$file" ]; then
        SIZE=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "?")
        echo "  ✓ $file ($SIZE bytes)"
    fi
done

if [ $VALIDATION_FAILED -eq 1 ]; then
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  ERROR: Pre-flight validation failed!"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "To fix:"
    echo "  1. docker compose down"
    echo "  2. ./setup.sh"
    echo "  3. docker compose up -d"
    echo ""
    exit 1
fi
echo "  ✓ All files validated"
echo ""

# =========================================
# Step 2: Wait for Database
# =========================================
# Wait for TimescaleDB to be ready before proceeding

echo "[2/3] Waiting for TimescaleDB..."

# Build DSN from environment variables
TIMESCALE_HOST="${TIMESCALE_HOST:-timescaledb}"
TIMESCALE_PORT="${TIMESCALE_PORT:-5432}"
TIMESCALE_USER="${TIMESCALE_USER:-panfm}"
TIMESCALE_PASSWORD="${TIMESCALE_PASSWORD:-panfm_secure_password}"
TIMESCALE_DB="${TIMESCALE_DB:-panfm_db}"
export TIMESCALE_DSN="postgresql://${TIMESCALE_USER}:${TIMESCALE_PASSWORD}@${TIMESCALE_HOST}:${TIMESCALE_PORT}/${TIMESCALE_DB}"

MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if python -c "import psycopg2; psycopg2.connect('$TIMESCALE_DSN')" 2>/dev/null; then
        echo "  ✓ Database connection successful"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "  Waiting for database... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "  ✗ ERROR: Database not available after ${MAX_RETRIES} attempts"
    exit 1
fi
echo ""

# =========================================
# Step 3: Initialize Schema
# =========================================
# Run Python schema manager to create/verify tables

echo "[3/3] Initializing database schema..."

# Check if schema exists by looking for throughput_samples table
SCHEMA_EXISTS=$(python -c "
import psycopg2
conn = psycopg2.connect('$TIMESCALE_DSN')
cur = conn.cursor()
cur.execute(\"SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = 'throughput_samples')\")
print('yes' if cur.fetchone()[0] else 'no')
conn.close()
" 2>/dev/null || echo "no")

if [ "$SCHEMA_EXISTS" = "yes" ]; then
    echo "  ✓ Schema already exists"
else
    echo "  Creating schema..."
    python -c "
from schema.manager import SchemaManager
import os
manager = SchemaManager(os.environ['TIMESCALE_DSN'])
success = manager.ensure_schema()
exit(0 if success else 1)
"
    if [ $? -eq 0 ]; then
        echo "  ✓ Schema created successfully"
    else
        echo "  ✗ ERROR: Schema creation failed"
        exit 1
    fi
fi
echo ""

# =========================================
# Startup Complete
# =========================================

echo "════════════════════════════════════════════════════════════"
echo "  ✓ PANfm ready - Starting application"
echo "════════════════════════════════════════════════════════════"
echo ""

# Execute the main command (gunicorn or python app.py)
exec "$@"
