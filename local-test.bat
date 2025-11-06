@echo off
REM Local Pre-Commit Testing Script for PANfm (Windows + Docker Desktop)
REM This script helps you test changes locally before committing to GitHub
REM
REM Usage:
REM   1. Make code changes
REM   2. Run this script: local-test.bat
REM   3. Test in browser at http://localhost:3000
REM   4. If all works, commit and push to GitHub
REM
REM What this does:
REM   - Checks Docker Desktop is running
REM   - Stops existing containers
REM   - Rebuilds Docker image with your changes
REM   - Starts fresh container
REM   - Shows logs
REM   - Opens browser automatically

@echo off
echo ========================================================
echo PANfm Local Testing - Building and Starting Container
echo ========================================================
echo.

REM Navigate to script directory
cd /d "%~dp0"

REM Stop and remove existing containers
echo [1/5] Stopping existing containers...
docker compose down >nul 2>&1
echo    Success: Containers stopped
echo.

REM Rebuild Docker image with latest code
echo [2/5] Building Docker image with your changes...
echo    (This may take 1-2 minutes on first run)
echo.
docker compose build --progress=plain
if errorlevel 1 (
    echo.
    echo    ERROR: Docker build failed!
    echo.
    echo    Check the error messages above.
    echo.
    exit /b 1
)
echo.
echo    Success: Image built
echo.

REM Start container
echo [3/5] Starting container...
echo.
docker compose up -d
if errorlevel 1 (
    echo.
    echo    ERROR: Container failed to start!
    echo.
    echo    Showing recent logs:
    echo    --------------------------------------------------------
    docker compose logs --tail=30
    echo    --------------------------------------------------------
    echo.
    exit /b 1
)
echo.
echo    Success: Container started
echo.

REM Wait for application to initialize
echo [4/5] Waiting for application to initialize...
timeout /t 5 /nobreak >nul

REM Check if container is actually running
docker ps | findstr "panfm" >nul
if errorlevel 1 (
    echo    ERROR: Container stopped unexpectedly!
    echo.
    echo    Showing recent logs:
    echo    --------------------------------------------------------
    docker compose logs --tail=30
    echo    --------------------------------------------------------
    echo.
    exit /b 1
)
echo    Success: Container is running
echo.

REM Show recent logs
echo [5/5] Recent logs from container:
echo --------------------------------------------------------
docker compose logs --tail=15
echo --------------------------------------------------------
echo.

echo ========================================================
echo SUCCESS: Local testing environment is ready!
echo ========================================================
echo.
echo Your application is running at:
echo   http://localhost:3000
echo.
echo Default credentials:
echo   Username: admin
echo   Password: admin
echo.
echo To view live logs:
echo   docker compose logs -f
echo.
echo To stop the container:
echo   docker compose down
echo.
echo To restart quickly (after code changes):
echo   quick-restart.bat      (keeps data)
echo   restart-docker.bat     (clears data)
echo.

REM Open browser automatically
echo Opening browser in 3 seconds...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo =======================================================
echo Testing Checklist:
echo =======================================================
echo.
echo [ ] Login works
echo [ ] Dashboard loads data
echo [ ] Settings page opens
echo [ ] Services tab shows APScheduler/Database status
echo [ ] All features work as expected
echo [ ] No errors in browser console (F12)
echo.
echo If everything works:
echo   1. Stop container: docker compose down
echo   2. Commit your changes: git add . ^&^& git commit -m "..."
echo   3. Push to GitHub: git push origin test
echo.
echo If something is broken:
echo   1. Fix the code
echo   2. Run this script again: local-test.bat
echo   3. Repeat until it works
echo.
