#!/bin/bash
# Setup script for PANfm - Ensures required files exist before Docker starts

echo "PANfm Setup - Initializing required files..."
echo ""

# Helper function: Remove directory if exists, then create file
# This handles the case where Docker created a directory instead of mounting a file
ensure_file_not_directory() {
    local filename=$1
    if [ -d "$filename" ]; then
        echo "  ⚠ Removing directory '$filename' (should be a file)"
        rm -rf "$filename"
    fi
}

# Create settings.json if it doesn't exist
ensure_file_not_directory "settings.json"
if [ ! -f "settings.json" ]; then
    echo "Creating settings.json..."
    cat > settings.json << 'EOF'
{
  "refresh_interval": 15,
  "debug_logging": false,
  "selected_device_id": "",
  "monitored_interface": "ethernet1/12",
  "tony_mode": false,
  "timezone": "UTC"
}
EOF
    echo "✓ settings.json created"
else
    echo "✓ settings.json already exists"
fi

# Create devices.json if it doesn't exist
ensure_file_not_directory "devices.json"
if [ ! -f "devices.json" ]; then
    echo "Creating devices.json..."
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
    echo "✓ devices.json created"
else
    echo "✓ devices.json already exists"
fi

# Create encryption.key if it doesn't exist
ensure_file_not_directory "encryption.key"
if [ ! -f "encryption.key" ]; then
    echo "Creating encryption.key..."
    # Generate a random 32-byte key encoded in base64
    python3 -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())" > encryption.key
    chmod 600 encryption.key 2>/dev/null || true
    echo "✓ encryption.key created (permissions: 600)"
else
    echo "✓ encryption.key already exists"
    # Ensure correct permissions even if file exists
    chmod 600 encryption.key 2>/dev/null || true
fi

# Create auth.json if it doesn't exist with default admin/admin credentials
ensure_file_not_directory "auth.json"
if [ ! -f "auth.json" ]; then
    echo "Creating auth.json with default credentials (admin/admin)..."

    # Generate bcrypt hash for 'admin' password and create auth.json
    # The Python script will generate the same structure as auth.py's init_auth_file()
    python3 -c "
import json
import bcrypt
import os
import sys

# Check if bcrypt is available
try:
    import bcrypt
except ImportError:
    print('Warning: bcrypt not installed, creating empty auth.json (app will initialize)')
    with open('auth.json', 'w') as f:
        f.write('')
    sys.exit(0)

# Generate bcrypt hash for 'admin'
hashed_password = bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

# Create auth data structure (unencrypted - app will encrypt on first load)
auth_data = {
    'users': {
        'admin': {
            'password_hash': hashed_password,
            'must_change_password': True
        }
    }
}

# Save to file (unencrypted - encryption happens when app loads it)
with open('auth.json', 'w') as f:
    json.dump(auth_data, f, indent=2)

print('Generated default admin credentials')
" 2>/dev/null || touch auth.json

    echo "✓ auth.json created with default admin/admin credentials"
    echo "  (Password must be changed on first login)"
else
    echo "✓ auth.json already exists"
fi

# Create device_metadata.json if it doesn't exist
ensure_file_not_directory "device_metadata.json"
if [ ! -f "device_metadata.json" ]; then
    echo "Creating device_metadata.json..."
    
    # Create encrypted empty metadata file using Python
    python3 -c "
import json
import os
import sys

# Try to import encryption module
try:
    from encryption import encrypt_dict
    
    # Create empty metadata structure
    empty_data = {}
    
    # Encrypt it
    encrypted_data = encrypt_dict(empty_data)
    
    # Save to file
    with open('device_metadata.json', 'w') as f:
        json.dump(encrypted_data, f, indent=2)
    
    # Set permissions to 600
    os.chmod('device_metadata.json', 0o600)
    
    print('Created encrypted device_metadata.json')
except ImportError:
    # If encryption module not available, create empty encrypted structure manually
    # This mimics what encrypt_dict would produce with an empty dict
    empty_encrypted = {}
    with open('device_metadata.json', 'w') as f:
        json.dump(empty_encrypted, f, indent=2)
    os.chmod('device_metadata.json', 0o600)
    print('Created device_metadata.json (will be encrypted on first app load)')
except Exception as e:
    # Fallback: create empty file, app will initialize it
    with open('device_metadata.json', 'w') as f:
        f.write('')
    print(f'Created empty device_metadata.json (app will initialize: {e})')
" 2>/dev/null || touch device_metadata.json
    
    # Ensure file permissions are correct
    chmod 600 device_metadata.json 2>/dev/null || true
    
    echo "✓ device_metadata.json created"
else
    echo "✓ device_metadata.json already exists"
fi

# Create mac_vendor_db.json if it doesn't exist (empty array)
ensure_file_not_directory "mac_vendor_db.json"
if [ ! -f "mac_vendor_db.json" ]; then
    echo "Creating mac_vendor_db.json (empty)..."
    echo "[]" > mac_vendor_db.json
    echo "✓ mac_vendor_db.json created (upload database via Settings > Databases)"
else
    echo "✓ mac_vendor_db.json already exists"
fi

# Create service_port_db.json if it doesn't exist (empty object)
ensure_file_not_directory "service_port_db.json"
if [ ! -f "service_port_db.json" ]; then
    echo "Creating service_port_db.json (empty)..."
    echo "{}" > service_port_db.json
    echo "✓ service_port_db.json created (upload database via Settings > Databases)"
else
    echo "✓ service_port_db.json already exists"
fi

# ============================================================
# v2.0.0: SQLite databases removed - migrated to TimescaleDB
# ============================================================
# throughput_history.db → TimescaleDB (throughput_history hypertable)
# alerts.db → TimescaleDB (alert_history, alert_configs tables)
# nmap_scans.db → TimescaleDB (nmap_scan_history hypertable)
# Database schema automatically initialized by init_timescaledb.sql

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo "Creating data directory..."
    mkdir -p data
    echo "✓ data directory created"
else
    echo "✓ data directory already exists"
fi

# Create redis_data directory if it doesn't exist (v2.0.0)
if [ ! -d "redis_data" ]; then
    echo "Creating redis_data directory (Redis AOF persistence)..."
    mkdir -p redis_data
    echo "✓ redis_data directory created"
else
    echo "✓ redis_data directory already exists"
fi

# Create timescaledb_data directory if it doesn't exist (v2.0.0)
if [ ! -d "timescaledb_data" ]; then
    echo "Creating timescaledb_data directory (PostgreSQL data files)..."
    mkdir -p timescaledb_data
    echo "✓ timescaledb_data directory created"
else
    echo "✓ timescaledb_data directory already exists"
fi

echo ""
echo "============================================================"
echo "Setup complete! PANfm Community v1.0.16 is ready to start"
echo "============================================================"
echo ""
echo "Run: docker compose up -d"
echo ""
echo "First startup notes:"
echo "  - Redis will initialize session store automatically"
echo "  - TimescaleDB will create schema from init_timescaledb.sql"
echo "  - Web UI will be available at http://localhost:3000"
echo "  - First startup may take 60-90 seconds for database initialization"
echo ""
echo "Post-setup:"
echo "  - Default login: admin / admin (change on first login)"
echo "  - Upload MAC vendor and service port databases via Settings > Databases"
echo ""
