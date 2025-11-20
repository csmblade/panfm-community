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
    echo "✓ encryption.key created"
else
    echo "✓ encryption.key already exists"
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

# Create throughput_history.db if it doesn't exist
ensure_file_not_directory "throughput_history.db"
if [ ! -f "throughput_history.db" ]; then
    echo "Creating throughput_history.db with COMPLETE schema..."
    echo "  (includes all Phase 1-4 columns + Analytics Dashboard fields)"

    # Let the app create it with proper schema via ThroughputStorage
    # This ensures all migrations run and schema is complete
    echo "  NOTE: Database will be initialized by ThroughputStorage on first run"
    echo "        This ensures schema migrations run properly and includes:"
    echo "        - Phase 1: Base throughput metrics"
    echo "        - Phase 2: Threats, apps, interfaces, license, WAN"
    echo "        - Phase 3: Categories support"
    echo "        - Connected devices table"
    echo "        - Traffic separation (internal/internet clients)"
    echo "        - Category split (LAN/Internet)"
    echo "        - Analytics traffic metrics (internal_mbps, internet_mbps)"

    # Create empty file so Docker doesn't create a directory
    touch throughput_history.db

    echo "✓ throughput_history.db placeholder created (app will initialize schema)"
else
    echo "✓ throughput_history.db already exists"
fi

# Create alerts.db if it doesn't exist
ensure_file_not_directory "alerts.db"
if [ ! -f "alerts.db" ]; then
    echo "Creating alerts.db..."

    # Create SQLite database with schema using Python
    python3 -c "
import sqlite3
import os

# Create database file
db_path = 'alerts.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Create alert_history table (matches alert_manager.py schema)
cursor.execute('''
    CREATE TABLE IF NOT EXISTS alert_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        alert_name TEXT NOT NULL,
        severity TEXT NOT NULL,
        triggered_at DATETIME NOT NULL,
        acknowledged BOOLEAN DEFAULT 0,
        acknowledged_at DATETIME,
        acknowledged_by TEXT,
        details TEXT
    )
''')

# Create indexes
cursor.execute('''
    CREATE INDEX IF NOT EXISTS idx_alert_device_triggered
    ON alert_history(device_id, triggered_at DESC)
''')

cursor.execute('''
    CREATE INDEX IF NOT EXISTS idx_alert_acknowledged
    ON alert_history(acknowledged, triggered_at DESC)
''')

conn.commit()
conn.close()

print('Created alerts.db with schema')
" 2>/dev/null || touch alerts.db

    echo "✓ alerts.db created"
else
    echo "✓ alerts.db already exists"
fi

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo "Creating data directory..."
    mkdir -p data
    echo "✓ data directory created"
else
    echo "✓ data directory already exists"
fi

echo ""
echo "Setup complete! You can now run: docker compose up -d"
echo ""
echo "Note: Upload MAC vendor and service port databases via Settings > Databases tab"
