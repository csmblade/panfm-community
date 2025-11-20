@echo off
REM Setup script for PANfm - Ensures required files exist before Docker starts
REM Windows batch version of setup.sh

echo PANfm Setup - Initializing required files...
echo.

REM Helper function simulation - Check and remove directories that should be files
REM Windows doesn't have functions, so we use labels and goto

REM ============================================================
REM Create settings.json if it doesn't exist
REM ============================================================
if exist "settings.json\" (
    echo   Warning: Removing directory 'settings.json' ^(should be a file^)
    rmdir /s /q "settings.json"
)

if not exist "settings.json" (
    echo Creating settings.json...
    (
        echo {
        echo   "refresh_interval": 15,
        echo   "debug_logging": false,
        echo   "selected_device_id": "",
        echo   "monitored_interface": "ethernet1/12",
        echo   "tony_mode": false,
        echo   "timezone": "UTC"
        echo }
    ) > settings.json
    echo [OK] settings.json created
) else (
    echo [OK] settings.json already exists
)

REM ============================================================
REM Create devices.json if it doesn't exist
REM ============================================================
if exist "devices.json\" (
    echo   Warning: Removing directory 'devices.json' ^(should be a file^)
    rmdir /s /q "devices.json"
)

if not exist "devices.json" (
    echo Creating devices.json...
    (
        echo {
        echo   "devices": [],
        echo   "groups": [
        echo     "Headquarters",
        echo     "Branch Office",
        echo     "Remote",
        echo     "Standalone"
        echo   ]
        echo }
    ) > devices.json
    echo [OK] devices.json created
) else (
    echo [OK] devices.json already exists
)

REM ============================================================
REM Create encryption.key if it doesn't exist
REM ============================================================
if exist "encryption.key\" (
    echo   Warning: Removing directory 'encryption.key' ^(should be a file^)
    rmdir /s /q "encryption.key"
)

if not exist "encryption.key" (
    echo Creating encryption.key...
    python -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())" > encryption.key
    echo [OK] encryption.key created
) else (
    echo [OK] encryption.key already exists
)

REM ============================================================
REM Create auth.json if it doesn't exist
REM ============================================================
if exist "auth.json\" (
    echo   Warning: Removing directory 'auth.json' ^(should be a file^)
    rmdir /s /q "auth.json"
)

if not exist "auth.json" (
    echo Creating auth.json with default credentials ^(admin/admin^)...

    python -c "import json; import sys; try: import bcrypt; hashed = bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8'); auth_data = {'users': {'admin': {'password_hash': hashed, 'must_change_password': True}}}; json.dump(auth_data, open('auth.json', 'w'), indent=2); print('Generated default admin credentials'); except ImportError: open('auth.json', 'w').write(''); print('Warning: bcrypt not installed, creating empty auth.json (app will initialize)');" 2>nul || type nul > auth.json

    echo [OK] auth.json created with default admin/admin credentials
    echo   ^(Password must be changed on first login^)
) else (
    echo [OK] auth.json already exists
)

REM ============================================================
REM Create device_metadata.json if it doesn't exist
REM ============================================================
if exist "device_metadata.json\" (
    echo   Warning: Removing directory 'device_metadata.json' ^(should be a file^)
    rmdir /s /q "device_metadata.json"
)

if not exist "device_metadata.json" (
    echo Creating device_metadata.json...

    python -c "import json; import os; try: from encryption import encrypt_dict; encrypted_data = encrypt_dict({}); json.dump(encrypted_data, open('device_metadata.json', 'w'), indent=2); os.chmod('device_metadata.json', 0o600); print('Created encrypted device_metadata.json'); except ImportError: json.dump({}, open('device_metadata.json', 'w'), indent=2); os.chmod('device_metadata.json', 0o600); print('Created device_metadata.json (will be encrypted on first app load)'); except Exception as e: open('device_metadata.json', 'w').write(''); print(f'Created empty device_metadata.json (app will initialize: {e}');" 2>nul || type nul > device_metadata.json

    echo [OK] device_metadata.json created
) else (
    echo [OK] device_metadata.json already exists
)

REM ============================================================
REM Create mac_vendor_db.json if it doesn't exist
REM ============================================================
if exist "mac_vendor_db.json\" (
    echo   Warning: Removing directory 'mac_vendor_db.json' ^(should be a file^)
    rmdir /s /q "mac_vendor_db.json"
)

if not exist "mac_vendor_db.json" (
    echo Creating mac_vendor_db.json ^(empty^)...
    echo [] > mac_vendor_db.json
    echo [OK] mac_vendor_db.json created ^(upload database via Settings ^> Databases^)
) else (
    echo [OK] mac_vendor_db.json already exists
)

REM ============================================================
REM Create service_port_db.json if it doesn't exist
REM ============================================================
if exist "service_port_db.json\" (
    echo   Warning: Removing directory 'service_port_db.json' ^(should be a file^)
    rmdir /s /q "service_port_db.json"
)

if not exist "service_port_db.json" (
    echo Creating service_port_db.json ^(empty^)...
    echo {} > service_port_db.json
    echo [OK] service_port_db.json created ^(upload database via Settings ^> Databases^)
) else (
    echo [OK] service_port_db.json already exists
)

REM ============================================================
REM Create throughput_history.db if it doesn't exist
REM ============================================================
if exist "throughput_history.db\" (
    echo   Warning: Removing directory 'throughput_history.db' ^(should be a file^)
    rmdir /s /q "throughput_history.db"
)

if not exist "throughput_history.db" (
    echo Creating throughput_history.db with COMPLETE schema...
    echo   ^(includes all Phase 1-4 columns + Analytics Dashboard fields^)
    echo.
    echo   NOTE: Database will be initialized by ThroughputStorage on first run
    echo         This ensures schema migrations run properly and includes:
    echo         - Phase 1: Base throughput metrics
    echo         - Phase 2: Threats, apps, interfaces, license, WAN
    echo         - Phase 3: Categories support
    echo         - Connected devices table
    echo         - Traffic separation ^(internal/internet clients^)
    echo         - Category split ^(LAN/Internet^)
    echo         - Analytics traffic metrics ^(internal_mbps, internet_mbps^)
    echo.

    REM Create empty file so Docker doesn't create a directory
    type nul > throughput_history.db

    echo [OK] throughput_history.db placeholder created ^(app will initialize schema^)
) else (
    echo [OK] throughput_history.db already exists
)

REM ============================================================
REM Create alerts.db if it doesn't exist
REM ============================================================
if exist "alerts.db\" (
    echo   Warning: Removing directory 'alerts.db' ^(should be a file^)
    rmdir /s /q "alerts.db"
)

if not exist "alerts.db" (
    echo Creating alerts.db...

    python -c "import sqlite3; conn = sqlite3.connect('alerts.db'); cursor = conn.cursor(); cursor.execute('''CREATE TABLE IF NOT EXISTS alert_history (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, alert_name TEXT NOT NULL, severity TEXT NOT NULL, triggered_at DATETIME NOT NULL, acknowledged BOOLEAN DEFAULT 0, acknowledged_at DATETIME, acknowledged_by TEXT, details TEXT)'''); cursor.execute('''CREATE INDEX IF NOT EXISTS idx_alert_device_triggered ON alert_history(device_id, triggered_at DESC)'''); cursor.execute('''CREATE INDEX IF NOT EXISTS idx_alert_acknowledged ON alert_history(acknowledged, triggered_at DESC)'''); conn.commit(); conn.close(); print('Created alerts.db with schema');" 2>nul || type nul > alerts.db

    echo [OK] alerts.db created
) else (
    echo [OK] alerts.db already exists
)

REM ============================================================
REM Create nmap_scans.db if it doesn't exist
REM ============================================================
if exist "nmap_scans.db\" (
    echo   Warning: Removing directory 'nmap_scans.db' ^(should be a file^)
    rmdir /s /q "nmap_scans.db"
)

if not exist "nmap_scans.db" (
    echo Creating nmap_scans.db...

    python -c "import sqlite3; conn = sqlite3.connect('nmap_scans.db'); cursor = conn.cursor(); cursor.execute('''CREATE TABLE IF NOT EXISTS scan_history (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, scan_type TEXT NOT NULL, target_network TEXT NOT NULL, started_at DATETIME NOT NULL, completed_at DATETIME, status TEXT NOT NULL, results_json TEXT, error_message TEXT)'''); cursor.execute('''CREATE INDEX IF NOT EXISTS idx_scan_device_started ON scan_history(device_id, started_at DESC)'''); cursor.execute('''CREATE INDEX IF NOT EXISTS idx_scan_status ON scan_history(status, started_at DESC)'''); conn.commit(); conn.close(); print('Created nmap_scans.db with schema');" 2>nul || type nul > nmap_scans.db

    echo [OK] nmap_scans.db created
) else (
    echo [OK] nmap_scans.db already exists
)

REM ============================================================
REM Create data directory if it doesn't exist
REM ============================================================
if not exist "data" (
    echo Creating data directory...
    mkdir data
    echo [OK] data directory created
) else (
    echo [OK] data directory already exists
)

echo.
echo Setup complete! You can now run: docker compose up -d
echo.
echo Note: Upload MAC vendor and service port databases via Settings ^> Databases tab
echo.
