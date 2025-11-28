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
    icacls encryption.key /inheritance:r /grant:r "%USERNAME%:(R,W)" 2>nul
    echo [OK] encryption.key created ^(permissions: read/write for current user only^)
) else (
    echo [OK] encryption.key already exists
    REM Ensure correct permissions even if file exists
    icacls encryption.key /inheritance:r /grant:r "%USERNAME%:(R,W)" 2>nul
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
REM v2.0.0: SQLite databases removed - migrated to TimescaleDB
REM ============================================================
REM throughput_history.db → TimescaleDB (throughput_history hypertable)
REM alerts.db → TimescaleDB (alert_history, alert_configs tables)
REM nmap_scans.db → TimescaleDB (nmap_scan_history hypertable)
REM Database schema automatically initialized by init_timescaledb.sql

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

REM ============================================================
REM Create redis_data directory if it doesn't exist (v2.0.0)
REM ============================================================
if not exist "redis_data" (
    echo Creating redis_data directory ^(Redis AOF persistence^)...
    mkdir redis_data
    echo [OK] redis_data directory created
) else (
    echo [OK] redis_data directory already exists
)

REM ============================================================
REM Create timescaledb_data directory if it doesn't exist (v2.0.0)
REM ============================================================
if not exist "timescaledb_data" (
    echo Creating timescaledb_data directory ^(PostgreSQL data files^)...
    mkdir timescaledb_data
    echo [OK] timescaledb_data directory created
) else (
    echo [OK] timescaledb_data directory already exists
)

echo.
echo ============================================================
echo Setup complete! PANfm Community v1.0.16 is ready to start
echo ============================================================
echo.
echo Run: docker compose up -d
echo.
echo First startup notes:
echo   - Redis will initialize session store automatically
echo   - TimescaleDB will create schema from init_timescaledb.sql
echo   - Web UI will be available at http://localhost:3000
echo   - First startup may take 60-90 seconds for database initialization
echo.
echo Post-setup:
echo   - Default login: admin / admin ^(change on first login^)
echo   - Upload MAC vendor and service port databases via Settings ^> Databases
echo.
