# Docker Desktop Setup Guide for Local Testing

## Overview

This guide explains how to test PANfm locally with Docker Desktop **before committing to GitHub**. This ensures your changes work correctly in the Docker environment.

---

## Prerequisites

### 1. Install Docker Desktop

**Download**: https://www.docker.com/products/docker-desktop

**Installation**:
1. Download Docker Desktop for Windows
2. Run the installer
3. Follow the installation wizard
4. Restart your computer if prompted

**Verify Installation**:
```cmd
docker --version
docker compose version
```

You should see version numbers for both commands.

### 2. Start Docker Desktop

- Look for Docker Desktop icon in system tray (bottom-right corner)
- If not running, click Start menu → Docker Desktop
- Wait for Docker Desktop to fully start (icon turns solid/green)
- You'll see "Docker Desktop is running" when ready

---

## Local Testing Workflow

### Method 1: Automated Testing (Recommended)

**Run the local testing script**:
```cmd
local-test.bat
```

This script will:
1. ✅ Check Docker Desktop is running
2. ✅ Stop existing containers
3. ✅ Rebuild image with your latest code
4. ✅ Start fresh container
5. ✅ Show logs
6. ✅ Open browser to http://localhost:3000

**Test your changes**:
- Login (admin/admin)
- Test all features
- Check browser console for errors (F12)
- Verify Services tab shows APScheduler/Database status

**If everything works**:
```cmd
docker compose down
git add .
git commit -m "Your commit message"
git push origin test
```

**If something is broken**:
1. Fix the code
2. Run `local-test.bat` again
3. Repeat until it works

---

### Method 2: Manual Testing

**Build and start**:
```cmd
docker compose build
docker compose up -d
```

**View logs**:
```cmd
docker compose logs -f
```

**Stop container**:
```cmd
docker compose down
```

**Stop and clear all data**:
```cmd
docker compose down -v
```

---

## Quick Development Scripts

### `local-test.bat`
**Full rebuild and test** (use before committing)
- Stops containers
- Rebuilds image with latest code
- Starts fresh container
- Opens browser
- Shows checklist

### `quick-restart.bat`
**Quick restart** (keeps data)
- Just restarts the container
- No rebuild, no data loss
- Fast (3 seconds)
- Use for quick code changes

### `restart-docker.bat`
**Full restart with clean data**
- Stops containers
- Removes volumes (clears data)
- Rebuilds image
- Starts fresh
- Use when you need clean state

---

## Common Issues & Solutions

### "Docker is not running"

**Problem**: Docker Desktop is not started

**Solution**:
1. Click Start menu → Docker Desktop
2. Wait for "Docker Desktop is running" message
3. Try command again

### "Port 3000 is already in use"

**Problem**: Another service is using port 3000

**Solution**:
```cmd
# Stop PANfm container
docker compose down

# Or kill the process using port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### "Container keeps restarting"

**Problem**: Application is crashing inside container

**Solution**:
```cmd
# View detailed logs
docker compose logs --tail=50

# Common causes:
# - Missing required files (run setup.sh first)
# - Python syntax errors
# - Missing dependencies in requirements.txt
```

### "Changes not showing up"

**Problem**: Docker is using old cached image

**Solution**:
```cmd
# Force rebuild without cache
docker compose build --no-cache
docker compose up -d
```

### "Can't access localhost:3000"

**Problem**: Container started but not accessible

**Solution**:
1. Check container is running: `docker ps`
2. Check logs: `docker compose logs`
3. Verify port mapping: `docker ps` should show `0.0.0.0:3000->3000/tcp`
4. Try `http://127.0.0.1:3000` instead

---

## Development Workflow Best Practices

### Before Making Changes

1. **Make sure Docker Desktop is running**
2. **Pull latest code** from GitHub:
   ```cmd
   git pull origin test
   ```

### While Coding

1. **Make your changes** in code editor
2. **Test locally** with `local-test.bat`
3. **Repeat** until everything works

### Before Committing

1. **Run full test**:
   ```cmd
   local-test.bat
   ```

2. **Verify checklist**:
   - [ ] Login works
   - [ ] Dashboard loads data
   - [ ] Settings page opens
   - [ ] Services tab shows status
   - [ ] No errors in browser console
   - [ ] No errors in container logs

3. **Stop container**:
   ```cmd
   docker compose down
   ```

4. **Commit and push**:
   ```cmd
   git add .
   git commit -m "Your descriptive commit message"
   git push origin test
   ```

### After Pushing

- Your changes are now on GitHub
- CI/CD will test them (if configured)
- Other team members can pull your changes

---

## Docker Commands Reference

### Container Management

```cmd
# Start containers
docker compose up -d

# Stop containers
docker compose down

# Restart containers
docker compose restart

# Stop and remove volumes (clear data)
docker compose down -v

# Rebuild image
docker compose build

# Rebuild without cache
docker compose build --no-cache
```

### Monitoring

```cmd
# View running containers
docker ps

# View all containers (including stopped)
docker ps -a

# View logs (follow mode)
docker compose logs -f

# View last 50 log lines
docker compose logs --tail=50

# View logs for specific service
docker compose logs panfm
```

### Debugging

```cmd
# Open shell inside container
docker exec -it panfm bash

# View container resource usage
docker stats

# Inspect container configuration
docker inspect panfm

# View container IP address
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' panfm
```

### Cleanup

```cmd
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove unused volumes
docker volume prune

# Remove everything unused (be careful!)
docker system prune -a
```

---

## Troubleshooting Tips

### Enable Debug Logging

1. Login to http://localhost:3000
2. Go to Settings → Debug tab
3. Enable "Debug Logging"
4. Save settings
5. View logs: `docker compose logs -f`

### Check Container Health

```cmd
# Is container running?
docker ps | findstr panfm

# What's the container status?
docker ps -a | findstr panfm

# View container logs
docker compose logs --tail=100
```

### Verify Mounted Volumes

```cmd
# Check if files exist on host
dir settings.json devices.json encryption.key

# If missing, run setup script first
bash setup.sh
```

### Network Issues

```cmd
# Check port is accessible
curl http://localhost:3000

# Or use browser directly
start http://localhost:3000
```

---

## File Structure

```
panfm/
├── Dockerfile                  # Docker image definition
├── docker-compose.yml          # Docker Compose configuration
├── docker-entrypoint.sh        # Container startup script
├── local-test.bat             # 🆕 Pre-commit testing script
├── quick-restart.bat          # Quick restart (keeps data)
├── restart-docker.bat         # Full restart (clears data)
├── docker-test.sh             # Automated Docker test (CI)
├── setup.sh                   # Initialize required files
└── requirements.txt           # Python dependencies
```

---

## Advanced: VSCode Integration

**Install Docker Extension**:
1. Open VSCode
2. Extensions → Search "Docker"
3. Install official Docker extension by Microsoft

**Features**:
- View containers in sidebar
- Right-click container → View Logs
- Right-click container → Attach Shell
- One-click start/stop containers

---

## Getting Help

### View Documentation

```cmd
# View this file
type DOCKER_SETUP.md

# View main README
type README.md
```

### Check Docker Desktop Status

- Click Docker Desktop icon in system tray
- Go to Troubleshoot → Run diagnostics
- View dashboard for container status

### Common Log Locations

- Docker Desktop logs: `C:\Users\<username>\AppData\Local\Docker\log.txt`
- Container logs: `docker compose logs`
- Application debug log: Inside container at `/app/debug.log`

---

## Summary

**Quick Start**:
1. Install Docker Desktop
2. Start Docker Desktop (system tray icon)
3. Run `local-test.bat`
4. Test at http://localhost:3000
5. Commit if everything works

**Daily Workflow**:
```cmd
# Make code changes in editor

# Test locally
local-test.bat

# If working:
docker compose down
git add .
git commit -m "..."
git push origin test

# If broken:
# Fix code and repeat
```

**Key Scripts**:
- `local-test.bat` → Full test before commit
- `quick-restart.bat` → Quick code changes
- `restart-docker.bat` → Clean state

That's it! You can now test locally before pushing to GitHub. 🎉
