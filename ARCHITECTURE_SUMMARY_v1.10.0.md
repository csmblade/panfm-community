# PANfm v1.10.0 Architecture Summary

## Quick Reference - What Changed

### Before v1.10.0
```
┌────────────────────────────────┐
│     Single Process (panfm)     │
│                                │
│  Flask Web Server              │
│  +                             │
│  APScheduler BackgroundScheduler│
│  (Jobs not executing)          │
└────────────────────────────────┘
```

###After v1.10.0
```
┌──────────────────────┐  ┌────────────────────────┐
│ panfm (web)          │  │ panfm-clock (worker)   │
│                      │  │                        │
│ Flask Web Server     │  │ APScheduler            │
│ (port 3000)          │  │ BlockingScheduler      │
│                      │  │                        │
│ Read-only DB access  │  │ Scheduled collection   │
└──────────┬───────────┘  └────────┬───────────────┘
           │                       │
           └───────┬───────────────┘
                   ▼
         ┌──────────────────┐
         │ Shared Databases │
         │                  │
         │ throughput_history.db
         │ alerts.db        │
         │ settings.json    │
         │ devices.json     │
         └──────────────────┘
```

## Files Summary

### NEW
- `clock.py` (240 lines) - Standalone clock process

### MODIFIED
- `app.py` - Removed scheduler (lines 66-287), added read-only collector (lines 66-79)
- `docker-compose.yml` - Added panfm-clock service
- `version.py` - Updated to v1.10.0

### UNCHANGED
- All routes, frontend, APIs remain identical
- User experience unchanged
- No data migration needed

## Docker Commands

```bash
# Stop old architecture
docker-compose down

# Build new architecture
docker-compose build --no-cache

# Start both processes
docker-compose up -d

# Verify both running
docker ps --filter "name=panfm"

# View web server logs
docker logs -f panfm

# View clock process logs
docker logs -f panfm-clock
```

## Verification

```bash
# Web server should show:
"Starting Flask app (web server only)..."
"Scheduled tasks are handled by separate clock.py process"

# Clock logs should show:
"[CLOCK INIT]" messages
"DEBUG: inbound=XX.XX Mbps" (throughput calculations)
"=== THREAT API Response ===" (API calls)

# Database should update:
ls -lh throughput_history.db
# Timestamp should be recent and updating every 30-60 seconds
```

## Key Benefits

1. **Reliability**: Jobs execute on schedule (no threading conflicts)
2. **Scalability**: Independent process scaling
3. **Maintainability**: Separate log streams, easier debugging
4. **Production-Ready**: Follows industry best practices

## What This Fixes

### Problem
- APScheduler BackgroundScheduler jobs never executed in Flask
- Daemon threads blocked by Flask's threading model
- Multiple failed attempts (daemon=True, threaded=True, Flask-APScheduler)

### Solution
- BlockingScheduler in dedicated process
- Web and background tasks completely separated
- Each process has clear, single responsibility

## Migration Checklist

- [x] Created clock.py with BlockingScheduler
- [x] Removed scheduler from app.py
- [x] Added read-only collector to app.py
- [x] Updated docker-compose.yml
- [x] Tested both processes
- [x] Verified data collection working
- [x] Verified web server working
- [x] Created release notes
- [x] Updated version.py
- [x] Documented architecture changes

## Important Notes

### For Docker Users
- **Required**: Both containers must run for full functionality
- Web server alone works but won't collect new data
- Clock process runs silently in background

### For CLI Users
- **Required**: Must run `python clock.py` separately for scheduled tasks
- Or accept that automated collection won't happen
- Dashboard will still work reading existing database data

### Database Sharing
- Both processes access same SQLite files via volumes
- Clock process WRITES data
- Web process READS data
- SQLite handles concurrent access automatically

## Future Enhancements

1. Add health check endpoint to clock process
2. Expose scheduler_stats via HTTP
3. Support multiple clock workers
4. Add Prometheus metrics
5. Implement graceful shutdown with job completion wait

---

**Version**: 1.10.0 "Production Architecture"
**Date**: 2025-11-11
**Type**: MINOR (architecture change, backward compatible)
