@echo off
echo Testing Docker commands...
echo.

echo 1. Testing: docker --version
docker --version
echo Return code: %errorlevel%
echo.

echo 2. Testing: docker version
docker version
echo Return code: %errorlevel%
echo.

echo 3. Testing: docker info (first 10 lines)
docker info 2>&1 | findstr /I "Version Context"
echo Return code: %errorlevel%
echo.

echo 4. Testing: docker compose version
docker compose version
echo Return code: %errorlevel%
echo.

echo 5. Testing: docker ps
docker ps
echo Return code: %errorlevel%
echo.

echo All tests complete!
pause
