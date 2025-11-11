# Release Notes - PANfm v1.10.0 "Production Architecture"

**Release Date**: 2025-11-11
**Version**: 1.10.0
**Type**: MAJOR - Architecture Change
**Codename**: Production Architecture

---

## Overview

This release implements a **major architectural change** by separating web server and background task concerns into independent processes, following Heroku's production best practices for clock processes. This resolves long-standing APScheduler execution issues and establishes a scalable, production-ready architecture.

## Critical Architecture Change

### Separate Clock Process Pattern

PANfm now runs as **two independent processes**:

1. **Web Process** (`panfm` container)
   - Pure Flask web server
   - Serves HTTP requests on port 3000
   - Read-only access to throughput database
   - No scheduled task execution

2. **Clock Process** (`panfm-clock` container)
   - Dedicated background worker
   - Runs all scheduled tasks (throughput collection, cleanup, alerts)
   - Uses APScheduler 3.11.1 BlockingScheduler
   - Independent from web server lifecycle

### Why This Change Was Necessary

**Previous Architecture Problems**:
- APScheduler jobs not executing reliably in Flask
- BackgroundScheduler daemon threads blocked by Flask's threading model
- Multiple failed attempts to fix (daemon=True, threaded=True, Flask-APScheduler)
- Mixing web and background concerns in single process violated production best practices

**Solution - Separate Processes**:
- **Clock process** uses BlockingScheduler (keeps main thread alive)
- **Web process** is pure Flask (no scheduler code)
- Both processes share data via common SQLite databases
- Follows Heroku's recommended clock process pattern

---

## New Files Created

### clock.py (240 lines)
**Purpose**: Standalone clock process for all scheduled tasks

**Key Features**:
- Uses APScheduler 3.11.1 with BlockingScheduler
- Comprehensive event listeners (job executed, error, missed, scheduler start/shutdown)
- Two scheduled jobs:
  1. **Throughput Collection** - Runs every `refresh_interval` seconds (30-60s typical)
  2. **Database Cleanup** - Runs daily at 02:00 UTC
- Graceful shutdown handling (SIGINT, SIGTERM)
- Detailed console logging with `[CLOCK INIT]`, `[CLOCK JOB]`, `[CLOCK EVENT]` prefixes

**Scheduled Jobs**:
```python
# Job 1: Throughput Collection
run_collection()
  - Calls collector.collect_all_devices()
  - Includes throughput calculation, session counts, CPU/memory
  - Checks alert thresholds
  - Runs on interval trigger (configurable refresh_interval)

# Job 2: Database Cleanup
cleanup_old_data()
  - Deletes old throughput samples (retention_days)
  - Clears expired alert cooldowns
  - Runs on cron trigger (daily at 02:00 UTC)
```

**APScheduler Configuration**:
```python
BlockingScheduler(
    timezone='UTC',
    jobstores={'default': {'type': 'memory'}},
    executors={'default': {'type': 'threadpool', 'max_workers': 3}},
    job_defaults={
        'coalesce': True,           # Combine missed runs
        'max_instances': 1,         # Prevent overlapping executions
        'misfire_grace_time': 60    # 60s grace for missed jobs
    }
)
```

**Execution Tracking**:
```python
scheduler_stats = {
    'total_executions': 0,
    'total_errors': 0,
    'last_execution': None,
    'last_error': None,
    'last_error_time': None,
    'execution_history': []  # Last 10 executions
}
```

---

## Modified Files

### app.py
**Changes**: Removed all scheduler code, added read-only collector initialization

**What Was Removed** (lines 66-287 deleted):
- APScheduler BackgroundScheduler initialization
- Scheduler event listeners
- Job registration (throughput collection, cleanup, alerts)
- Scheduler startup/shutdown handlers
- All scheduled task execution code

**What Was Added** (lines 66-79):
```python
# Read-only throughput collector for database access
from config import THROUGHPUT_DB_FILE, load_settings
from throughput_collector import init_collector
settings = load_settings()
retention_days = settings.get('throughput_retention_days', 90)
if settings.get('throughput_collection_enabled', True):
    debug(f"Initializing throughput collector (read-only access for web server)")
    init_collector(THROUGHPUT_DB_FILE, retention_days)
    debug("Throughput collector initialized (database access only, no scheduled collection)")
```

**Why This Is Needed**:
- Web server routes (`/api/throughput`, `/api/throughput/history`) call `get_collector()`
- Routes need read-only access to query throughput database
- Collector is initialized in BOTH processes:
  - **Web process**: Read-only database access (no scheduled collection)
  - **Clock process**: Full access with scheduled collection

**Updated Startup Messages**:
```python
print("Starting Flask app (web server only)...")
print("Scheduled tasks are handled by separate clock.py process")
```

### docker-compose.yml
**Changes**: Added second service for clock process

**New Service**:
```yaml
panfm-clock:
  build: .
  container_name: panfm-clock
  volumes:
    # Shares same data files as web service
    - ./settings.json:/app/settings.json
    - ./devices.json:/app/devices.json
    - ./encryption.key:/app/encryption.key
    - ./device_metadata.json:/app/device_metadata.json
    - ./mac_vendor_db.json:/app/mac_vendor_db.json
    - ./service_port_db.json:/app/service_port_db.json
    - ./throughput_history.db:/app/throughput_history.db
    - ./alerts.db:/app/alerts.db
  environment:
    - FLASK_ENV=production
    - FLASK_DEBUG=False
  restart: unless-stopped
  command: python clock.py
```

**Volume Sharing**:
- Both processes mount the same database files
- Clock process WRITES to databases
- Web process READS from databases
- SQLite handles concurrent read/write via file locking

### requirements.txt
**Changes**: None (APScheduler==3.11.1 already present from previous upgrade)

### Dockerfile
**Changes**: None (clock.py automatically included in `COPY . .`)

### docker-entrypoint.sh
**Changes**: None (validates files before starting either process)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose                          │
├─────────────────────────────────┬───────────────────────────┤
│       panfm (web)               │    panfm-clock (worker)   │
│                                 │                           │
│  ┌─────────────────────────┐   │  ┌────────────────────┐  │
│  │ Flask Web Server        │   │  │ APScheduler        │  │
│  │ - HTTP on port 3000     │   │  │ - BlockingScheduler│  │
│  │ - Serves API endpoints  │   │  │ - Runs scheduled   │  │
│  │ - Read-only DB access   │   │  │   tasks            │  │
│  └─────────────────────────┘   │  └────────────────────┘  │
│             │                   │           │              │
│             │                   │           │              │
│             ▼                   │           ▼              │
│  ┌─────────────────────────┐   │  ┌────────────────────┐  │
│  │ ThroughputCollector     │   │  │ ThroughputCollector│  │
│  │ (read-only)             │   │  │ (read/write)       │  │
│  └─────────────────────────┘   │  └────────────────────┘  │
└─────────────────┬───────────────┴──────────┬───────────────┘
                  │                          │
                  ▼                          ▼
         ┌────────────────────────────────────────┐
         │    Shared Database Files (volumes)     │
         ├────────────────────────────────────────┤
         │  - throughput_history.db (24MB)        │
         │  - alerts.db (56KB)                    │
         │  - settings.json                       │
         │  - devices.json                        │
         │  - encryption.key                      │
         └────────────────────────────────────────┘
```

---

## Benefits of New Architecture

### 1. Reliability
- ✅ **Scheduled jobs execute reliably** - No more threading conflicts
- ✅ **Separate process lifecycle** - Clock process failures don't affect web server
- ✅ **Proper APScheduler usage** - BlockingScheduler is designed for dedicated processes

### 2. Scalability
- ✅ **Independent scaling** - Scale web and clock processes separately
- ✅ **Resource isolation** - Web and background tasks don't compete for resources
- ✅ **Future-ready** - Can add more clock workers if needed

### 3. Maintainability
- ✅ **Clear separation of concerns** - Web and background logic completely separate
- ✅ **Easier debugging** - Each process has its own log stream
- ✅ **Production best practices** - Follows Heroku's clock process pattern

### 4. Monitoring
- ✅ **Independent health checks** - Monitor each process separately
- ✅ **Detailed execution tracking** - scheduler_stats tracks job success/failures
- ✅ **Event listeners** - Comprehensive APScheduler event monitoring

---

## Deployment Changes

### Docker Deployment

**Starting Services**:
```bash
docker-compose up -d
# Creates two containers:
# - panfm (web server on port 3000)
# - panfm-clock (background worker)
```

**Checking Status**:
```bash
docker ps --filter "name=panfm"
# Should show both panfm and panfm-clock as "Up"
```

**Viewing Logs**:
```bash
# Web server logs
docker logs -f panfm

# Clock process logs
docker logs -f panfm-clock
```

**Restarting After Code Changes**:
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### CLI Deployment

**No changes required for CLI deployment** - The architecture change is Docker-specific. When running via CLI (python app.py), the application still works as before, but scheduled tasks won't execute unless you manually run clock.py in a separate terminal.

**To run both processes in CLI mode**:
```bash
# Terminal 1 - Web Server
python app.py

# Terminal 2 - Clock Process
python clock.py
```

---

## Testing & Verification

### Verify Clock Process Execution

**Check clock process logs**:
```bash
docker logs panfm-clock --tail 100

# Look for:
# [CLOCK INIT] messages - Initialization
# [CLOCK JOB] messages - Job execution
# [CLOCK EVENT] messages - Scheduler events
# DEBUG: inbound=XX.XX Mbps - Throughput calculations
# === THREAT API Response === - API calls
```

### Verify Web Server

**Test web server**:
```bash
curl http://localhost:3000/
# Should redirect to /login

curl http://localhost:3000/api/version
# Should return version info
```

**Test throughput endpoint** (after logging in):
```bash
curl -H "Cookie: session=..." http://localhost:3000/api/throughput
# Should return latest throughput data
```

### Verify Database Updates

**Check database timestamps**:
```bash
ls -lh throughput_history.db alerts.db
# throughput_history.db should have recent timestamp
# Updates every refresh_interval seconds (30-60s typical)
```

### Verify Dual Deployment

**Test CLI deployment**:
```bash
./cli-test.sh
# Should pass all tests
```

**Test Docker deployment**:
```bash
./docker-test.sh
# Should pass all tests
```

---

## Troubleshooting

### Clock Process Not Starting

**Symptoms**:
- No throughput data in dashboard
- `docker logs panfm-clock` shows initialization error

**Check**:
```bash
docker logs panfm-clock 2>&1 | grep -i error
# Look for initialization errors
```

**Common Causes**:
- Throughput collection disabled in settings
- Database files have incorrect permissions
- Missing required data files

### Web Server 503 Errors

**Symptoms**:
- Dashboard shows "Error: Failed to fetch data"
- `/api/throughput` returns 503

**Check**:
```bash
docker logs panfm 2>&1 | grep "Collector not initialized"
```

**Solution**:
- Verify clock process is running: `docker ps --filter "name=panfm-clock"`
- Check database files exist: `ls -lh throughput_history.db`
- Restart both containers: `docker-compose restart`

### Database Lock Errors

**Symptoms**:
- "Database is locked" errors in logs
- Intermittent data loading failures

**Solution**:
- SQLite handles concurrent access automatically
- If persistent, increase SQLite timeout in throughput_storage.py
- Verify only one clock process is running: `docker ps --filter "name=panfm-clock"`

---

## Migration Guide

### From v1.9.x to v1.10.0

**No data migration required** - This is a pure architectural change.

**Steps**:
1. **Stop old containers**:
   ```bash
   docker-compose down
   ```

2. **Pull/update code**:
   ```bash
   git pull origin main
   ```

3. **Rebuild containers**:
   ```bash
   docker-compose build --no-cache
   ```

4. **Start new architecture**:
   ```bash
   docker-compose up -d
   ```

5. **Verify both processes running**:
   ```bash
   docker ps --filter "name=panfm"
   # Should show panfm and panfm-clock
   ```

6. **Monitor logs for first collection**:
   ```bash
   docker logs -f panfm-clock
   # Wait for first collection cycle (30-60 seconds)
   ```

7. **Test dashboard**:
   - Open http://localhost:3000
   - Login
   - Verify dashboard displays throughput data

---

## Breaking Changes

### None for End Users

The architecture change is **transparent to users**:
- ✅ Same UI/UX
- ✅ Same API endpoints
- ✅ Same features
- ✅ Same configuration

### Deployment Changes

**Docker users**:
- Now runs two containers instead of one
- Both must be running for full functionality
- Web server alone will work but won't collect new data

**CLI users**:
- Must run clock.py separately for scheduled tasks
- Or accept that scheduled tasks won't execute

---

## Known Issues

### Clock Process Log Volume

**Issue**: Clock process generates verbose logs due to throughput collector debug output

**Impact**: Log files can grow large over time

**Workaround**:
- Logs are only stored in Docker container (not persisted to host)
- Restart clock container to clear logs: `docker restart panfm-clock`

**Future Fix**: Add log rotation to clock.py

---

## Future Enhancements

### Planned Improvements

1. **Clock Process Monitoring**
   - Add health check endpoint to clock process
   - Expose scheduler_stats via HTTP endpoint
   - Add Prometheus metrics

2. **Multiple Clock Workers**
   - Support horizontal scaling of clock processes
   - Distributed job coordination
   - Leader election for single-instance jobs

3. **Graceful Shutdown**
   - Wait for in-progress jobs before shutdown
   - Persist scheduler state across restarts

4. **Log Management**
   - Add log rotation to clock.py
   - Configurable log levels
   - Structured logging (JSON)

---

## References

### Documentation
- Heroku Clock Processes: https://devcenter.heroku.com/articles/clock-processes-python
- APScheduler Documentation: https://apscheduler.readthedocs.io/
- Project Architecture: `.claude/reference/module-details.md`

### Related Issues
- Original Issue: APScheduler jobs not executing in Flask
- Previous Attempts: Upgraded to APScheduler 3.11.1, tried Flask-APScheduler, daemon=True, threaded=True
- Resolution: Separate clock process architecture

---

## Acknowledgments

This architecture change was inspired by Heroku's production best practices and resolves long-standing issues with background task execution in Flask applications.

---

**Version**: 1.10.0
**Released**: 2025-11-11
**Next Version**: TBD
