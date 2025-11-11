"""
Standalone Clock Process for PANfm Scheduled Tasks
Runs independently from Flask web server using BlockingScheduler
Based on Heroku production best practices for scheduled tasks
"""
import time
from datetime import datetime
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.events import (
    EVENT_JOB_EXECUTED, EVENT_JOB_ERROR, EVENT_JOB_MISSED,
    EVENT_SCHEDULER_START, EVENT_SCHEDULER_SHUTDOWN
)

# Import application modules
from config import THROUGHPUT_DB_FILE, ALERTS_DB_FILE, load_settings
from throughput_collector import init_collector, get_collector
from alert_manager import AlertManager
from logger import info, exception, warning, error, debug

# Scheduler execution tracking
scheduler_stats = {
    'total_executions': 0,
    'total_errors': 0,
    'last_execution': None,
    'last_error': None,
    'last_error_time': None,
    'execution_history': []  # Last 10 execution timestamps
}

# APScheduler event listeners for comprehensive monitoring
def on_job_executed(event):
    """Called when a job completes successfully."""
    global scheduler_stats
    scheduler_stats['total_executions'] += 1
    scheduler_stats['last_execution'] = datetime.utcnow().isoformat()
    scheduler_stats['execution_history'].append(datetime.utcnow().isoformat())
    # Keep only last 10 executions
    if len(scheduler_stats['execution_history']) > 10:
        scheduler_stats['execution_history'].pop(0)

    print(f"[CLOCK EVENT] ✓ Job '{event.job_id}' executed successfully at {scheduler_stats['last_execution']}")
    info("Clock job '%s' executed successfully (total: %d)", event.job_id, scheduler_stats['total_executions'])

def on_job_error(event):
    """Called when a job raises an exception."""
    global scheduler_stats
    scheduler_stats['total_errors'] += 1
    scheduler_stats['last_error'] = str(event.exception)
    scheduler_stats['last_error_time'] = datetime.utcnow().isoformat()

    print(f"[CLOCK EVENT] ✗ Job '{event.job_id}' ERROR: {event.exception}")
    error("Clock job '%s' failed with error: %s", event.job_id, str(event.exception))
    exception("Full traceback for job '%s':", event.job_id)

def on_job_missed(event):
    """Called when a job's execution is missed (misfire)."""
    print(f"[CLOCK EVENT] ⚠ Job '{event.job_id}' MISSED scheduled execution")
    warning("Clock job '%s' missed its scheduled execution time", event.job_id)

def on_scheduler_start(event):
    """Called when scheduler starts."""
    print(f"[CLOCK EVENT] ► Scheduler STARTED at {datetime.utcnow().isoformat()}")
    info("Clock process scheduler started successfully")

def on_scheduler_shutdown(event):
    """Called when scheduler shuts down."""
    print(f"[CLOCK EVENT] ■ Scheduler SHUTDOWN at {datetime.utcnow().isoformat()}")
    info("Clock process scheduler shutdown (total executions: %d, errors: %d)",
         scheduler_stats['total_executions'], scheduler_stats['total_errors'])

# Scheduled job functions
def run_collection():
    """Scheduled job to collect throughput data from all devices."""
    start_time = datetime.utcnow()
    print(f"[CLOCK JOB] ► run_collection() STARTED at {start_time.isoformat()}")

    try:
        collector = get_collector()
        if not collector:
            error("Collector not initialized, skipping collection")
            return

        print(f"[CLOCK JOB] Calling collector.collect_all_devices()...")
        info("Running scheduled throughput collection...")

        # Call the collector
        collector.collect_all_devices()

        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✓ Collection completed in {duration:.2f} seconds")
        info("Scheduled throughput collection completed (duration: %.2fs)", duration)

    except Exception as e:
        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✗ ERROR after {duration:.2f} seconds: {str(e)}")
        exception("Error in scheduled collection after %.2fs: %s", duration, str(e))
        raise  # Re-raise to trigger EVENT_JOB_ERROR

def cleanup_old_data():
    """Daily cleanup of old throughput samples and expired alert cooldowns."""
    start_time = datetime.utcnow()
    print(f"[CLOCK JOB] ► cleanup_old_data() STARTED at {start_time.isoformat()}")

    try:
        # Load settings for retention period
        settings = load_settings()
        retention_days = settings.get('throughput_retention_days', 90)

        # Cleanup throughput database
        print(f"[CLOCK JOB] Cleaning up throughput samples older than {retention_days} days...")
        collector = get_collector()
        if collector and collector.storage:
            deleted_count = collector.storage.cleanup_old_samples(retention_days)
            print(f"[CLOCK JOB] ✓ Deleted {deleted_count} old throughput samples")
            info("Deleted %d old throughput samples (retention: %d days)", deleted_count, retention_days)

        # Cleanup expired alert cooldowns
        print(f"[CLOCK JOB] Cleaning up expired alert cooldowns...")
        alert_mgr = AlertManager(ALERTS_DB_FILE)
        cooldown_count = alert_mgr.clear_expired_cooldowns()
        print(f"[CLOCK JOB] ✓ Deleted {cooldown_count} expired cooldowns")
        info("Deleted %d expired alert cooldowns", cooldown_count)

        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()
        print(f"[CLOCK JOB] ✓ Cleanup completed in {duration:.2f} seconds")
        info("Daily cleanup completed (duration: %.2fs)", duration)

    except Exception as e:
        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()
        print(f"[CLOCK JOB] ✗ Cleanup ERROR after {duration:.2f} seconds: {str(e)}")
        exception("Error in daily cleanup after %.2fs: %s", duration, str(e))
        raise  # Re-raise to trigger EVENT_JOB_ERROR

def main():
    """Main clock process entry point."""
    print("=" * 60)
    print("PANfm Clock Process Starting...")
    print("=" * 60)

    # Load settings
    settings = load_settings()
    retention_days = settings.get('throughput_retention_days', 90)
    collection_enabled = settings.get('throughput_collection_enabled', True)
    refresh_interval = settings.get('refresh_interval', 60)

    print(f"[CLOCK INIT] collection_enabled={collection_enabled}, retention_days={retention_days}, refresh_interval={refresh_interval}s")

    if not collection_enabled:
        print(f"[CLOCK INIT] ✗ Throughput collection DISABLED in settings")
        info("Clock process exiting - collection disabled in settings")
        return

    # Initialize collector
    print(f"[CLOCK INIT] Initializing throughput collector...")
    info("Initializing throughput collector with %d-day retention", retention_days)

    try:
        collector_instance = init_collector(THROUGHPUT_DB_FILE, retention_days)
        if not collector_instance:
            print(f"[CLOCK INIT] ✗ Collector initialization returned None")
            error("Clock process exiting - collector initialization failed")
            return

        print(f"[CLOCK INIT] ✓ Collector initialized successfully")
        info("Throughput collector initialized successfully")

    except Exception as e:
        print(f"[CLOCK INIT] ✗ ERROR during initialization: {str(e)}")
        exception("Clock process exiting - failed to initialize throughput collector: %s", str(e))
        return

    # Initialize BlockingScheduler (NOT BackgroundScheduler!)
    # BlockingScheduler keeps the main thread alive
    print(f"[CLOCK INIT] Initializing BlockingScheduler...")
    scheduler = BlockingScheduler(
        timezone='UTC',
        jobstores={'default': {'type': 'memory'}},
        executors={'default': {'type': 'threadpool', 'max_workers': 3}},
        job_defaults={
            'coalesce': True,           # Combine multiple missed runs into one
            'max_instances': 1,         # Prevent overlapping job executions
            'misfire_grace_time': 60    # Allow 60 seconds grace for missed jobs
        }
    )

    # Register event listeners
    scheduler.add_listener(on_job_executed, EVENT_JOB_EXECUTED)
    scheduler.add_listener(on_job_error, EVENT_JOB_ERROR)
    scheduler.add_listener(on_job_missed, EVENT_JOB_MISSED)
    scheduler.add_listener(on_scheduler_start, EVENT_SCHEDULER_START)
    scheduler.add_listener(on_scheduler_shutdown, EVENT_SCHEDULER_SHUTDOWN)

    # Register Job 1: Throughput Collection + Alert Checking
    scheduler.add_job(
        func=run_collection,
        trigger='interval',
        seconds=refresh_interval,
        id='collect_throughput',
        name='Throughput Data Collection',
        replace_existing=True
    )
    print(f"[CLOCK INIT] ✓ Job 'collect_throughput' registered with {refresh_interval}-second interval")

    # Register Job 2: Database Cleanup (daily at 02:00 UTC)
    scheduler.add_job(
        func=cleanup_old_data,
        trigger='cron',
        hour=2,
        minute=0,
        id='cleanup_databases',
        name='Database Cleanup',
        replace_existing=True
    )
    print(f"[CLOCK INIT] ✓ Job 'cleanup_databases' registered (daily at 02:00 UTC)")

    print("=" * 60)
    print("Clock process initialized successfully")
    print(f"First collection will occur in {refresh_interval} seconds")
    print("Press Ctrl+C to stop the clock process")
    print("=" * 60)
    info("Clock process starting scheduler (blocking mode)")

    try:
        # Start the blocking scheduler (this will block forever until interrupted)
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        print("\n[CLOCK SHUTDOWN] Received shutdown signal")
        info("Clock process shutting down gracefully")
        scheduler.shutdown()
        print("[CLOCK SHUTDOWN] ✓ Clock process stopped")

if __name__ == '__main__':
    main()
