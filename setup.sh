#!/bin/bash
# =========================================
# PANfm Setup Script
# =========================================
# Creates required files before Docker starts.
# Handles both fresh installs and recovery from
# failed previous attempts.
# =========================================

# Version info (update these when version changes)
VERSION="1.0.16"
EDITION="Community"

# Colors for output (if terminal supports it)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if colors are supported
if [ -t 1 ] && command -v tput &> /dev/null && [ "$(tput colors)" -ge 8 ]; then
    USE_COLOR=true
else
    USE_COLOR=false
    RED=''
    GREEN=''
    YELLOW=''
    NC=''
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║      PANfm $EDITION v$VERSION - Setup                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Track errors
ERRORS=0
CREATED=0
EXISTED=0

# =========================================
# Helper Functions
# =========================================

# Remove directory if exists (Docker creates dirs if files don't exist)
ensure_file_not_directory() {
    local filename=$1
    if [ -d "$filename" ]; then
        echo -e "  ${YELLOW}⚠${NC} Removing directory '$filename' (should be a file)"
        rm -rf "$filename"
    fi
}

# Create file with content if doesn't exist
create_file() {
    local filename=$1
    local content=$2
    local description=$3

    ensure_file_not_directory "$filename"

    if [ ! -f "$filename" ]; then
        echo "$content" > "$filename"
        if [ $? -eq 0 ]; then
            echo -e "  ${GREEN}✓${NC} Created $filename"
            CREATED=$((CREATED + 1))
        else
            echo -e "  ${RED}✗${NC} Failed to create $filename"
            ERRORS=$((ERRORS + 1))
        fi
    else
        echo -e "  ${GREEN}✓${NC} $filename (exists)"
        EXISTED=$((EXISTED + 1))
    fi
}

# Create directory if doesn't exist
create_directory() {
    local dirname=$1
    local description=$2

    if [ ! -d "$dirname" ]; then
        mkdir -p "$dirname"
        if [ $? -eq 0 ]; then
            echo -e "  ${GREEN}✓${NC} Created $dirname/"
            CREATED=$((CREATED + 1))
        else
            echo -e "  ${RED}✗${NC} Failed to create $dirname/"
            ERRORS=$((ERRORS + 1))
        fi
    else
        echo -e "  ${GREEN}✓${NC} $dirname/ (exists)"
        EXISTED=$((EXISTED + 1))
    fi
}

# =========================================
# Step 1: Create Configuration Files
# =========================================
echo "[1/3] Creating configuration files..."

# settings.json
ensure_file_not_directory "settings.json"
if [ ! -f "settings.json" ]; then
    cat > settings.json << 'EOF'
{
  "refresh_interval": 30,
  "debug_logging": false,
  "selected_device_id": "",
  "monitored_interface": "ethernet1/12",
  "tony_mode": false,
  "timezone": "UTC"
}
EOF
    echo -e "  ${GREEN}✓${NC} Created settings.json"
    CREATED=$((CREATED + 1))
else
    echo -e "  ${GREEN}✓${NC} settings.json (exists)"
    EXISTED=$((EXISTED + 1))
fi

# devices.json
ensure_file_not_directory "devices.json"
if [ ! -f "devices.json" ]; then
    cat > devices.json << 'EOF'
{
  "devices": [],
  "groups": [
    "Headquarters",
    "Branch Office",
    "Remote",
    "Standalone"
  ]
}
EOF
    echo -e "  ${GREEN}✓${NC} Created devices.json"
    CREATED=$((CREATED + 1))
else
    echo -e "  ${GREEN}✓${NC} devices.json (exists)"
    EXISTED=$((EXISTED + 1))
fi

# encryption.key
ensure_file_not_directory "encryption.key"
if [ ! -f "encryption.key" ]; then
    python3 -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())" > encryption.key 2>/dev/null
    if [ $? -eq 0 ]; then
        chmod 600 encryption.key 2>/dev/null || true
        echo -e "  ${GREEN}✓${NC} Created encryption.key"
        CREATED=$((CREATED + 1))
    else
        echo -e "  ${RED}✗${NC} Failed to create encryption.key (Python required)"
        ERRORS=$((ERRORS + 1))
    fi
else
    chmod 600 encryption.key 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} encryption.key (exists)"
    EXISTED=$((EXISTED + 1))
fi

# auth.json
ensure_file_not_directory "auth.json"
if [ ! -f "auth.json" ]; then
    python3 -c "
import json
try:
    import bcrypt
    hashed = bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    auth_data = {'users': {'admin': {'password_hash': hashed, 'must_change_password': True}}}
    json.dump(auth_data, open('auth.json', 'w'), indent=2)
except ImportError:
    # bcrypt not available, create empty file (app will initialize)
    open('auth.json', 'w').write('')
" 2>/dev/null || touch auth.json
    echo -e "  ${GREEN}✓${NC} Created auth.json (admin/admin)"
    CREATED=$((CREATED + 1))
else
    echo -e "  ${GREEN}✓${NC} auth.json (exists)"
    EXISTED=$((EXISTED + 1))
fi

# device_metadata.json
ensure_file_not_directory "device_metadata.json"
if [ ! -f "device_metadata.json" ]; then
    echo "{}" > device_metadata.json
    chmod 600 device_metadata.json 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Created device_metadata.json"
    CREATED=$((CREATED + 1))
else
    echo -e "  ${GREEN}✓${NC} device_metadata.json (exists)"
    EXISTED=$((EXISTED + 1))
fi

# mac_vendor_db.json
create_file "mac_vendor_db.json" "[]" "MAC vendor database"

# service_port_db.json
create_file "service_port_db.json" "{}" "Service port database"

echo ""

# =========================================
# Step 2: Create Data Directories
# =========================================
echo "[2/3] Creating data directories..."

create_directory "data" "Application data"
create_directory "redis_data" "Redis AOF persistence"
create_directory "timescaledb_data" "PostgreSQL data files"

echo ""

# =========================================
# Step 3: Validate Installation
# =========================================
echo "[3/3] Validating installation..."

VALIDATION_ERRORS=0
REQUIRED_FILES=("settings.json" "devices.json" "encryption.key" "auth.json" "device_metadata.json" "mac_vendor_db.json" "service_port_db.json")

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "  ${RED}✗${NC} Missing: $file"
        VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
    elif [ -d "$file" ]; then
        echo -e "  ${RED}✗${NC} Is directory: $file"
        VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
    fi
done

REQUIRED_DIRS=("data" "redis_data" "timescaledb_data")
for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        echo -e "  ${RED}✗${NC} Missing directory: $dir"
        VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
    fi
done

if [ $VALIDATION_ERRORS -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} All files and directories validated"
fi

echo ""

# =========================================
# Results
# =========================================

if [ $ERRORS -gt 0 ] || [ $VALIDATION_ERRORS -gt 0 ]; then
    echo "════════════════════════════════════════════════════════════"
    echo -e "  ${RED}ERROR: Setup failed with $((ERRORS + VALIDATION_ERRORS)) error(s)${NC}"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "Please check:"
    echo "  - Python 3 is installed"
    echo "  - You have write permissions in this directory"
    echo "  - No conflicting directories exist"
    echo ""
    exit 1
fi

echo "════════════════════════════════════════════════════════════"
echo "  ✓ PANfm $EDITION v$VERSION is ready!"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  Files created: $CREATED"
echo "  Files existed: $EXISTED"
echo ""
echo "Next steps:"
echo "  1. docker compose up -d"
echo "  2. Open http://localhost:3000"
echo "  3. Login with admin / admin (change password on first login)"
echo ""
echo "First startup takes ~60 seconds for database initialization."
echo ""
