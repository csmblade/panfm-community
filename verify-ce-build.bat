@echo off
REM Community Edition Build Verification Script (Windows)
REM Ensures Enterprise Edition files are properly excluded before pushing to public repo

echo ========================================
echo PANfm Community Edition Build Verification
echo ========================================
echo.

setlocal enabledelayedexpansion
set ERRORS=0
set WARNINGS=0

echo Step 1: Checking Enterprise Edition file exclusion...
echo ------------------------------------------------------

REM Check if EE files are gitignored
call :check_gitignored "license_validator.py"
call :check_gitignored "license_generator.py"
call :check_gitignored "generate_rsa_keys.py"
call :check_gitignored "keys\license_private.pem"

echo.
echo Step 2: Checking Community Edition file inclusion...
echo ------------------------------------------------------

REM Check if CE files exist and are not ignored
call :check_exists "README.md"
call :check_exists "CONTRIBUTING.md"
call :check_exists "LICENSE"
call :check_exists "NOTICE"
call :check_exists "config.py"

echo.
echo Step 3: Checking edition detection in config.py...
echo ------------------------------------------------------

findstr /C:"def detect_edition():" config.py >nul 2>&1
if errorlevel 1 (
    echo [X] Edition detection function missing
    set /a ERRORS+=1
) else (
    echo [OK] Edition detection function found
)

findstr /C:"_check_grandfathered_status" config.py >nul 2>&1
if not errorlevel 1 (
    echo [X] Grandfathering code still present
    set /a ERRORS+=1
) else (
    echo [OK] Grandfathering code removed
)

findstr /C:"return 'community'" config.py >nul 2>&1
if errorlevel 1 (
    echo [X] Does not default to Community Edition
    set /a ERRORS+=1
) else (
    echo [OK] Defaults to Community Edition
)

echo.
echo Step 4: Checking device limit enforcement...
echo ------------------------------------------------------

findstr /C:"EDITION == 'community'" routes_device_management.py >nul 2>&1
if errorlevel 1 (
    echo [X] Community Edition limit check missing
    set /a ERRORS+=1
) else (
    echo [OK] Community Edition limit check found
)

findstr /C:"MAX_DEVICES" routes_device_management.py >nul 2>&1
if errorlevel 1 (
    echo [X] MAX_DEVICES not referenced
    set /a ERRORS+=1
) else (
    echo [OK] MAX_DEVICES referenced
)

echo.
echo Step 5: Checking UI edition badges...
echo ------------------------------------------------------

findstr /C:"Community Edition" templates\index.html >nul 2>&1
if errorlevel 1 (
    echo [X] Community Edition badge missing from index.html
    set /a ERRORS+=1
) else (
    echo [OK] Community Edition badge found in index.html
)

echo.
echo Step 6: Checking upgrade modal...
echo ------------------------------------------------------

findstr /C:"showUpgradeModal" static\app.js >nul 2>&1
if errorlevel 1 (
    echo [X] Upgrade modal function missing
    set /a ERRORS+=1
) else (
    echo [OK] Upgrade modal function found
)

echo.
echo Step 7: Checking documentation...
echo ------------------------------------------------------

findstr /C:"Community Edition" README.md >nul 2>&1
if errorlevel 1 (
    echo [X] README.md does not reference Community Edition
    set /a ERRORS+=1
) else (
    echo [OK] README.md references Community Edition
)

findstr /C:"Contributor License Agreement" CONTRIBUTING.md >nul 2>&1
if errorlevel 1 (
    echo [X] CONTRIBUTING.md missing CLA
    set /a ERRORS+=1
) else (
    echo [OK] CONTRIBUTING.md includes CLA
)

if exist NOTICE (
    echo [OK] NOTICE file exists
) else (
    echo [X] NOTICE file missing
    set /a ERRORS+=1
)

if exist LICENSE (
    echo [OK] LICENSE file exists
) else (
    echo [X] LICENSE file missing ^(CRITICAL^)
    set /a ERRORS+=1
)

echo.
echo ========================================
echo Verification Summary
echo ========================================
echo.

if !ERRORS! EQU 0 (
    echo [OK] ALL CHECKS PASSED
    echo.
    echo Community Edition build is ready for deployment!
    echo Next steps:
    echo   1. Create GitHub repository: panfm-community ^(public^)
    echo   2. Push code ^(git push origin main^)
    echo   3. Create release tag ^(git tag -a v1.0.0-ce^)
    exit /b 0
) else (
    echo [X] !ERRORS! CRITICAL ERROR^(S^) FOUND
    echo.
    echo CRITICAL: Fix errors above before pushing to public repository!
    exit /b 1
)

:check_gitignored
git check-ignore -q %1 2>nul
if errorlevel 1 (
    echo [X] %~1 is NOT gitignored ^(CRITICAL^)
    set /a ERRORS+=1
) else (
    echo [OK] %~1 is properly gitignored
)
goto :eof

:check_exists
if exist %1 (
    git check-ignore -q %1 2>nul
    if not errorlevel 1 (
        echo [WARN] %~1 exists but is gitignored
        set /a WARNINGS+=1
    ) else (
        echo [OK] %~1 is included in repo
    )
) else (
    echo [X] %~1 is missing ^(CRITICAL^)
    set /a ERRORS+=1
)
goto :eof
