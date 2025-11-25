@echo off
REM Automated Docker Restart Script for PANfm (Windows)
REM This script stops, removes volumes, and restarts the Docker containers
REM Use this after making code changes to ensure clean restart

echo ======================================
echo PANfm Docker Restart
echo ======================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo Error: Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Navigate to script directory
cd /d "%~dp0"
echo Working directory: %CD%
echo.

REM Stop and remove containers with volumes
echo 1. Stopping and removing Docker containers (with volumes)...
docker compose down -v
if errorlevel 1 (
    echo    Error stopping containers
    pause
    exit /b 1
)
echo    Success: Containers stopped and volumes removed
echo.

REM Rebuild and start containers
echo 2. Building and starting Docker containers...
docker compose build --no-cache
docker compose up -d 
if errorlevel 1 (
    echo    Error starting containers
    pause
    exit /b 1
)
echo    Success: Containers started
echo.

REM Wait for application to start
echo 3. Waiting for application to start...
timeout /t 5 /nobreak >nul
echo.

REM Check if container is running
echo 4. Checking container status...
docker ps | findstr "panfm" >nul
if errorlevel 1 (
    echo    Error: Container is not running
    echo.
    echo Container logs:
    docker compose logs --tail=20
    pause
    exit /b 1
)
echo    Success: Container is running
echo.

REM Show logs
echo 5. Container logs (last 10 lines):
docker compose logs --tail=10
echo.

echo ======================================
echo Success: Docker restart complete!
echo ======================================
echo.
echo Application should be available at: http://localhost:3000
echo.
echo To view live logs, run:
echo   docker compose logs -f
echo.

pause
