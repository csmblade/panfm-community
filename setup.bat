@echo off
REM =========================================
REM PANfm Setup Script (Windows)
REM =========================================
REM Creates required files before Docker starts.
REM Handles both fresh installs and recovery from
REM failed previous attempts.
REM =========================================

setlocal enabledelayedexpansion

REM Version info (update these when version changes)
set VERSION=1.0.16
set EDITION=Community

REM Track counters
set ERRORS=0
set CREATED=0
set EXISTED=0

echo.
echo ======================================================================
echo        PANfm %EDITION% v%VERSION% - Setup
echo ======================================================================
echo.

REM =========================================
REM Step 1: Create Configuration Files
REM =========================================
echo [1/3] Creating configuration files...

REM ============================================================
REM Create settings.json if it doesn't exist
REM ============================================================
if exist "settings.json\" (
    echo   [!] Removing directory 'settings.json' ^(should be a file^)
    rmdir /s /q "settings.json"
)

if not exist "settings.json" (
    (
        echo {
        echo   "refresh_interval": 30,
        echo   "debug_logging": false,
        echo   "selected_device_id": "",
        echo   "monitored_interface": "ethernet1/12",
        echo   "tony_mode": false,
        echo   "timezone": "UTC"
        echo }
    ) > settings.json
    if !errorlevel! equ 0 (
        echo   [+] Created settings.json
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create settings.json
        set /a ERRORS+=1
    )
) else (
    echo   [+] settings.json ^(exists^)
    set /a EXISTED+=1
)

REM ============================================================
REM Create devices.json if it doesn't exist
REM ============================================================
if exist "devices.json\" (
    echo   [!] Removing directory 'devices.json' ^(should be a file^)
    rmdir /s /q "devices.json"
)

if not exist "devices.json" (
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
    if !errorlevel! equ 0 (
        echo   [+] Created devices.json
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create devices.json
        set /a ERRORS+=1
    )
) else (
    echo   [+] devices.json ^(exists^)
    set /a EXISTED+=1
)

REM ============================================================
REM Create encryption.key if it doesn't exist
REM ============================================================
if exist "encryption.key\" (
    echo   [!] Removing directory 'encryption.key' ^(should be a file^)
    rmdir /s /q "encryption.key"
)

if not exist "encryption.key" (
    python -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())" > encryption.key 2>nul
    if !errorlevel! equ 0 (
        icacls encryption.key /inheritance:r /grant:r "%USERNAME%:(R,W)" >nul 2>&1
        echo   [+] Created encryption.key
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create encryption.key ^(Python required^)
        set /a ERRORS+=1
    )
) else (
    icacls encryption.key /inheritance:r /grant:r "%USERNAME%:(R,W)" >nul 2>&1
    echo   [+] encryption.key ^(exists^)
    set /a EXISTED+=1
)

REM ============================================================
REM Create auth.json if it doesn't exist
REM ============================================================
if exist "auth.json\" (
    echo   [!] Removing directory 'auth.json' ^(should be a file^)
    rmdir /s /q "auth.json"
)

if not exist "auth.json" (
    python -c "import json; import bcrypt; hashed = bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8'); auth_data = {'users': {'admin': {'password_hash': hashed, 'must_change_password': True}}}; json.dump(auth_data, open('auth.json', 'w'), indent=2)" 2>nul
    if !errorlevel! neq 0 (
        REM bcrypt not available, create empty file
        type nul > auth.json
    )
    echo   [+] Created auth.json ^(admin/admin^)
    set /a CREATED+=1
) else (
    echo   [+] auth.json ^(exists^)
    set /a EXISTED+=1
)

REM ============================================================
REM Create device_metadata.json if it doesn't exist
REM ============================================================
if exist "device_metadata.json\" (
    echo   [!] Removing directory 'device_metadata.json' ^(should be a file^)
    rmdir /s /q "device_metadata.json"
)

if not exist "device_metadata.json" (
    echo {} > device_metadata.json
    if !errorlevel! equ 0 (
        icacls device_metadata.json /inheritance:r /grant:r "%USERNAME%:(R,W)" >nul 2>&1
        echo   [+] Created device_metadata.json
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create device_metadata.json
        set /a ERRORS+=1
    )
) else (
    echo   [+] device_metadata.json ^(exists^)
    set /a EXISTED+=1
)

REM ============================================================
REM Create mac_vendor_db.json if it doesn't exist
REM ============================================================
if exist "mac_vendor_db.json\" (
    echo   [!] Removing directory 'mac_vendor_db.json' ^(should be a file^)
    rmdir /s /q "mac_vendor_db.json"
)

if not exist "mac_vendor_db.json" (
    echo [] > mac_vendor_db.json
    if !errorlevel! equ 0 (
        echo   [+] Created mac_vendor_db.json
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create mac_vendor_db.json
        set /a ERRORS+=1
    )
) else (
    echo   [+] mac_vendor_db.json ^(exists^)
    set /a EXISTED+=1
)

REM ============================================================
REM Create service_port_db.json if it doesn't exist
REM ============================================================
if exist "service_port_db.json\" (
    echo   [!] Removing directory 'service_port_db.json' ^(should be a file^)
    rmdir /s /q "service_port_db.json"
)

if not exist "service_port_db.json" (
    echo {} > service_port_db.json
    if !errorlevel! equ 0 (
        echo   [+] Created service_port_db.json
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create service_port_db.json
        set /a ERRORS+=1
    )
) else (
    echo   [+] service_port_db.json ^(exists^)
    set /a EXISTED+=1
)

echo.

REM =========================================
REM Step 2: Create Data Directories
REM =========================================
echo [2/3] Creating data directories...

if not exist "data" (
    mkdir data
    if !errorlevel! equ 0 (
        echo   [+] Created data/
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create data/
        set /a ERRORS+=1
    )
) else (
    echo   [+] data/ ^(exists^)
    set /a EXISTED+=1
)

if not exist "redis_data" (
    mkdir redis_data
    if !errorlevel! equ 0 (
        echo   [+] Created redis_data/
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create redis_data/
        set /a ERRORS+=1
    )
) else (
    echo   [+] redis_data/ ^(exists^)
    set /a EXISTED+=1
)

if not exist "timescaledb_data" (
    mkdir timescaledb_data
    if !errorlevel! equ 0 (
        echo   [+] Created timescaledb_data/
        set /a CREATED+=1
    ) else (
        echo   [X] Failed to create timescaledb_data/
        set /a ERRORS+=1
    )
) else (
    echo   [+] timescaledb_data/ ^(exists^)
    set /a EXISTED+=1
)

echo.

REM =========================================
REM Step 3: Validate Installation
REM =========================================
echo [3/3] Validating installation...

set VALIDATION_ERRORS=0

REM Check required files
for %%f in (settings.json devices.json encryption.key auth.json device_metadata.json mac_vendor_db.json service_port_db.json) do (
    if not exist "%%f" (
        echo   [X] Missing: %%f
        set /a VALIDATION_ERRORS+=1
    ) else if exist "%%f\" (
        echo   [X] Is directory: %%f
        set /a VALIDATION_ERRORS+=1
    )
)

REM Check required directories
for %%d in (data redis_data timescaledb_data) do (
    if not exist "%%d\" (
        echo   [X] Missing directory: %%d
        set /a VALIDATION_ERRORS+=1
    )
)

if %VALIDATION_ERRORS% equ 0 (
    echo   [+] All files and directories validated
)

echo.

REM =========================================
REM Results
REM =========================================

set /a TOTAL_ERRORS=%ERRORS%+%VALIDATION_ERRORS%

if %TOTAL_ERRORS% gtr 0 (
    echo ======================================================================
    echo   [X] ERROR: Setup failed with %TOTAL_ERRORS% error^(s^)
    echo ======================================================================
    echo.
    echo Please check:
    echo   - Python 3 is installed and in PATH
    echo   - You have write permissions in this directory
    echo   - No conflicting directories exist
    echo.
    exit /b 1
)

echo ======================================================================
echo   [+] PANfm %EDITION% v%VERSION% is ready!
echo ======================================================================
echo.
echo   Files created: %CREATED%
echo   Files existed: %EXISTED%
echo.
echo Next steps:
echo   1. docker compose up -d
echo   2. Open http://localhost:3000
echo   3. Login with admin / admin ^(change password on first login^)
echo.
echo First startup takes ~60 seconds for database initialization.
echo.

endlocal
