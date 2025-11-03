@echo off
REM Quick Docker Restart for PANfm (Windows)
REM This restarts containers WITHOUT removing volumes (faster)
REM Use this for quick code changes when you don't need to clear data

echo ======================================
echo PANfm Quick Restart (keeping data)
echo ======================================
echo.

cd /d "%~dp0"

echo Restarting containers...
docker compose restart
if errorlevel 1 (
    echo Error restarting containers
    pause
    exit /b 1
)

echo.
echo Waiting for application to start...
timeout /t 3 /nobreak >nul

echo.
echo ======================================
echo Success: Quick restart complete!
echo ======================================
echo.
echo Application available at: http://localhost:3000
echo.

REM Don't pause - faster for repeated use
