"""
Standalone Clock Process for PANfm Scheduled Tasks
Runs independently from Flask web server using BlockingScheduler
Based on Heroku production best practices for scheduled tasks
"""
import time
import signal
import sys
from datetime import datetime
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.events import (
    EVENT_JOB_EXECUTED, EVENT_JOB_ERROR, EVENT_JOB_MISSED,
    EVENT_SCHEDULER_START, EVENT_SCHEDULER_SHUTDOWN
)

# Import application modules
from config import load_settings
from throughput_collector import init_collector, get_collector
from logger import info, exception, warning, error, debug

# Track current running job for graceful shutdown
current_job = None
shutdown_requested = False
clock_start_time = None
current_refresh_interval = None  # Track current interval to detect changes
scheduler_instance = None  # Global reference to scheduler for dynamic rescheduling

# Scheduler execution tracking
scheduler_stats = {
    'total_executions': 0,
    'total_errors': 0,
    'last_execution': None,
    'last_error': None,
    'last_error_time': None,
    'execution_history': [],  # Last 10 execution timestamps
    'state': 'stopped',
    'uptime_seconds': 0,
    'jobs': {}  # Per-job statistics
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

# Signal handler for graceful shutdown
def shutdown_handler(signum, frame):
    """
    Handle SIGTERM/SIGINT for graceful shutdown.

    Args:
        signum: Signal number
        frame: Current stack frame
    """
    global shutdown_requested, current_job

    signal_name = 'SIGTERM' if signum == signal.SIGTERM else 'SIGINT'
    print(f"\n[CLOCK SHUTDOWN] Received {signal_name} signal")
    info(f"Graceful shutdown initiated by {signal_name}")

    if current_job:
        print(f"[CLOCK SHUTDOWN] ⏳ Job '{current_job}' currently running, waiting for completion...")
        info(f"Waiting for job '{current_job}' to complete before shutdown")

    shutdown_requested = True
    scheduler_stats['state'] = 'stopping'

    try:
        # Close collector database connections
        collector = get_collector()
        if collector and collector.storage:
            print("[CLOCK SHUTDOWN] Closing database connections...")
            debug("Closing collector storage database connections")
            # Storage connections close automatically via context managers

        print("[CLOCK SHUTDOWN] Flushing pending writes...")
        debug("Flushing any pending database writes")

        # Shutdown scheduler with 30-second timeout for job completion
        print("[CLOCK SHUTDOWN] Shutting down scheduler (30s timeout)...")
        info("Shutting down scheduler with 30-second timeout")

        # This will be caught by the main try/except block
        sys.exit(0)

    except Exception as e:
        print(f"[CLOCK SHUTDOWN] ✗ Error during shutdown: {str(e)}")
        exception(f"Error during graceful shutdown: {str(e)}")
        sys.exit(1)

# Scheduled job functions
def run_collection():
    """Scheduled job to collect throughput data from all devices."""
    global current_job
    job_name = 'throughput_collection'
    current_job = job_name
    start_time = datetime.utcnow()
    print(f"[CLOCK JOB] ► run_collection() STARTED at {start_time.isoformat()}")

    # Initialize job stats if not exists
    if job_name not in scheduler_stats['jobs']:
        scheduler_stats['jobs'][job_name] = {
            'success_count': 0,
            'error_count': 0,
            'last_run': None,
            'last_error': None
        }

    try:
        collector = get_collector()
        if not collector:
            error("Collector not initialized, skipping collection")
            current_job = None
            return

        print(f"[CLOCK JOB] Calling collector.collect_all_devices()...")
        info("Running scheduled throughput collection...")

        # Call the collector
        collector.collect_all_devices()

        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✓ Collection completed in {duration:.2f} seconds")
        info("Scheduled throughput collection completed (duration: %.2fs)", duration)

        # Update job stats
        scheduler_stats['jobs'][job_name]['success_count'] += 1
        scheduler_stats['jobs'][job_name]['last_run'] = end_time.isoformat()

    except Exception as e:
        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✗ ERROR after {duration:.2f} seconds: {str(e)}")
        exception("Error in scheduled collection after %.2fs: %s", duration, str(e))

        # Update job error stats
        scheduler_stats['jobs'][job_name]['error_count'] += 1
        scheduler_stats['jobs'][job_name]['last_error'] = str(e)

        raise  # Re-raise to trigger EVENT_JOB_ERROR
    finally:
        current_job = None

def collect_connected_devices():
    """Scheduled job to collect connected devices from all firewalls."""
    global current_job
    job_name = 'connected_devices_collection'
    current_job = job_name
    start_time = datetime.utcnow()
    print(f"[CLOCK JOB] ► collect_connected_devices() STARTED at {start_time.isoformat()}")

    # Initialize job stats if not exists
    if job_name not in scheduler_stats['jobs']:
        scheduler_stats['jobs'][job_name] = {
            'success_count': 0,
            'error_count': 0,
            'last_run': None,
            'last_error': None
        }

    try:
        # Import required modules
        from device_manager import device_manager
        from firewall_api_devices import get_connected_devices
        from firewall_api import get_firewall_config

        collector = get_collector()
        if not collector or not collector.storage:
            error("Collector not initialized, skipping connected devices collection")
            current_job = None
            return

        # Get all enabled devices
        devices = device_manager.load_devices(decrypt_api_keys=False)
        enabled_devices = [d for d in devices if d.get('enabled', True)]

        if not enabled_devices:
            debug("No enabled devices found, skipping connected devices collection")
            return

        print(f"[CLOCK JOB] Collecting connected devices from {len(enabled_devices)} enabled firewall(s)...")
        info("Collecting connected devices from %d enabled firewall(s)", len(enabled_devices))

        success_count = 0
        error_count = 0

        for device in enabled_devices:
            device_id = device.get('id')
            device_name = device.get('name', device_id)

            try:
                print(f"[CLOCK JOB] Collecting from device '{device_name}' ({device_id})...")

                # Get firewall config for this device
                firewall_config = get_firewall_config(device_id)

                # Collect connected devices from firewall
                connected = get_connected_devices(firewall_config)

                if connected:
                    # Store in database
                    success = collector.storage.insert_connected_devices(
                        device_id=device_id,
                        devices=connected,
                        collection_time=start_time
                    )

                    if success:
                        print(f"[CLOCK JOB] ✓ Stored {len(connected)} devices from '{device_name}'")
                        debug(f"Stored {len(connected)} connected devices from device {device_id}")
                        success_count += 1
                    else:
                        print(f"[CLOCK JOB] ✗ Failed to store devices from '{device_name}'")
                        error(f"Failed to store connected devices from device {device_id}")
                        error_count += 1
                else:
                    print(f"[CLOCK JOB] No devices found on '{device_name}'")
                    debug(f"No connected devices found on device {device_id}")
                    success_count += 1  # Not an error, just no devices

            except Exception as device_error:
                print(f"[CLOCK JOB] ✗ ERROR collecting from '{device_name}': {str(device_error)}")
                exception(f"Error collecting connected devices from device {device_id}: {str(device_error)}")
                error_count += 1

        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✓ Connected devices collection completed: {success_count} success, {error_count} errors (duration: {duration:.2f}s)")
        info("Connected devices collection completed: %d success, %d errors (duration: %.2fs)",
             success_count, error_count, duration)

        # Update job stats
        scheduler_stats['jobs'][job_name]['success_count'] += 1
        scheduler_stats['jobs'][job_name]['last_run'] = end_time.isoformat()

    except Exception as e:
        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✗ ERROR after {duration:.2f} seconds: {str(e)}")
        exception("Error in connected devices collection after %.2fs: %s", duration, str(e))

        # Update job error stats
        scheduler_stats['jobs'][job_name]['error_count'] += 1
        scheduler_stats['jobs'][job_name]['last_error'] = str(e)

        raise  # Re-raise to trigger EVENT_JOB_ERROR
    finally:
        current_job = None

def collect_traffic_flows():
    """Scheduled job to collect traffic flows for Sankey diagrams from all firewalls."""
    global current_job
    job_name = 'traffic_flows_collection'
    current_job = job_name
    start_time = datetime.utcnow()
    print(f"[CLOCK JOB] ► collect_traffic_flows() STARTED at {start_time.isoformat()}")

    # Initialize job stats if not exists
    if job_name not in scheduler_stats['jobs']:
        scheduler_stats['jobs'][job_name] = {
            'success_count': 0,
            'error_count': 0,
            'last_run': None,
            'last_error': None
        }

    try:
        # Import required modules
        from device_manager import device_manager

        collector = get_collector()
        if not collector:
            error("Collector not initialized, skipping traffic flows collection")
            current_job = None
            return

        # Get all enabled devices
        devices = device_manager.load_devices(decrypt_api_keys=False)
        enabled_devices = [d for d in devices if d.get('enabled', True)]

        if not enabled_devices:
            debug("No enabled devices found, skipping traffic flows collection")
            return

        print(f"[CLOCK JOB] Collecting traffic flows from {len(enabled_devices)} enabled firewall(s)...")
        info("Collecting traffic flows from %d enabled firewall(s)", len(enabled_devices))

        success_count = 0
        error_count = 0

        for device in enabled_devices:
            device_id = device.get('id')
            device_name = device.get('name', device_id)

            try:
                print(f"[CLOCK JOB] Collecting traffic flows from device '{device_name}' ({device_id})...")

                # Collect traffic flows for this device
                collector.collect_traffic_flows_for_device(device_id)
                success_count += 1

                print(f"[CLOCK JOB] ✓ Traffic flows collected from device '{device_name}'")

            except Exception as e:
                error_count += 1
                print(f"[CLOCK JOB] ✗ Failed to collect traffic flows from device '{device_name}': {str(e)}")
                exception(f"Error collecting traffic flows from device {device_name}: {str(e)}")

        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✓ collect_traffic_flows() COMPLETED in {duration:.2f} seconds")
        print(f"[CLOCK JOB] Results: {success_count} success, {error_count} errors")
        info(f"Traffic flows collection completed: {success_count} success, {error_count} errors, duration={duration:.2f}s")

        # Update job stats
        scheduler_stats['jobs'][job_name]['success_count'] += 1
        scheduler_stats['jobs'][job_name]['last_run'] = end_time.isoformat()

    except Exception as e:
        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()

        print(f"[CLOCK JOB] ✗ ERROR after {duration:.2f} seconds: {str(e)}")
        exception("Error in traffic flows collection after %.2fs: %s", duration, str(e))

        # Update job error stats
        scheduler_stats['jobs'][job_name]['error_count'] += 1
        scheduler_stats['jobs'][job_name]['last_error'] = str(e)

        raise  # Re-raise to trigger EVENT_JOB_ERROR
    finally:
        current_job = None

def check_settings_changes(scheduler):
    """
    Check if settings have changed and reschedule jobs if needed.
    Called periodically to detect refresh_interval changes.
    """
    global current_refresh_interval

    try:
        settings = load_settings()
        new_interval = settings.get('refresh_interval', 60)

        # Check if interval has changed
        if current_refresh_interval is not None and new_interval != current_refresh_interval:
            print(f"[CLOCK SETTINGS] Refresh interval changed: {current_refresh_interval}s → {new_interval}s")
            info(f"Refresh interval changed from {current_refresh_interval}s to {new_interval}s, rescheduling jobs")

            # Reschedule Job 1: Throughput Collection
            scheduler.reschedule_job(
                'collect_throughput',
                trigger='interval',
                seconds=new_interval
            )
            print(f"[CLOCK SETTINGS] ✓ Job 'collect_throughput' rescheduled to {new_interval}s")

            # Reschedule Job 2: Connected Devices Collection
            scheduler.reschedule_job(
                'collect_connected_devices',
                trigger='interval',
                seconds=new_interval
            )
            print(f"[CLOCK SETTINGS] ✓ Job 'collect_connected_devices' rescheduled to {new_interval}s")

            # Update tracked interval
            current_refresh_interval = new_interval

            debug(f"Rescheduled jobs to new interval: {new_interval}s")
        elif current_refresh_interval is None:
            # First time initialization
            current_refresh_interval = new_interval
            debug(f"Initial refresh interval set to {new_interval}s")

    except Exception as e:
        exception(f"Error checking settings changes: {str(e)}")

def persist_scheduler_stats():
    """Persist scheduler stats to database every 60 seconds and check for settings changes."""
    global scheduler_stats, clock_start_time, scheduler_instance
    import sys

    print("[PERSIST STATS] Function called", flush=True)
    sys.stdout.flush()

    try:
        # Check for settings changes and reschedule jobs if needed
        if scheduler_instance:
            check_settings_changes(scheduler_instance)

        # Calculate uptime
        if clock_start_time:
            uptime = (datetime.utcnow() - clock_start_time).total_seconds()
            scheduler_stats['uptime_seconds'] = int(uptime)

        # Add timestamp
        stats_to_save = scheduler_stats.copy()
        stats_to_save['timestamp'] = datetime.utcnow().isoformat()

        # Get collector to access storage
        collector = get_collector()
        print(f"[PERSIST DEBUG] collector={collector}, has storage={hasattr(collector, 'storage') if collector else False}")
        if collector and collector.storage:
            # Extract individual parameters from stats dictionary
            # Convert last_execution from ISO string to datetime object if present
            last_exec = scheduler_stats.get('last_execution')
            print(f"[PERSIST DEBUG] last_exec (before conversion)={last_exec}, type={type(last_exec)}")
            if last_exec and isinstance(last_exec, str):
                try:
                    from datetime import datetime as dt
                    last_exec = dt.fromisoformat(last_exec.replace('Z', '+00:00'))
                    print(f"[PERSIST DEBUG] last_exec (after conversion)={last_exec}, type={type(last_exec)}")
                except Exception as conv_error:
                    print(f"[PERSIST DEBUG] Datetime conversion failed: {conv_error}")
                    last_exec = None

            print(f"[PERSIST DEBUG] Calling insert_scheduler_stats with:")
            print(f"  uptime_seconds={scheduler_stats.get('uptime_seconds', 0)}")
            print(f"  total_executions={scheduler_stats.get('total_executions', 0)}")
            print(f"  total_errors={scheduler_stats.get('total_errors', 0)}")
            print(f"  last_execution={last_exec}")

            success = collector.storage.insert_scheduler_stats(
                uptime_seconds=scheduler_stats.get('uptime_seconds', 0),
                total_executions=scheduler_stats.get('total_executions', 0),
                total_errors=scheduler_stats.get('total_errors', 0),
                last_execution=last_exec
            )
            print(f"[PERSIST DEBUG] insert_scheduler_stats returned: {success}")
            if success:
                debug("Scheduler stats persisted to database")
            else:
                warning("Failed to persist scheduler stats to database")
        else:
            print(f"[PERSIST DEBUG] Skipping insert - no collector or storage available")

            # Cleanup old stats (keep last 30 days as per migration)
            deleted = collector.storage.cleanup_old_scheduler_stats(days=30)
            if deleted > 0:
                debug(f"Cleaned up {deleted} old scheduler stats records")

    except Exception as e:
        exception(f"Error persisting scheduler stats: {str(e)}")

def process_scheduled_scans():
    """
    Placeholder for scheduled scan monitoring.

    NOTE: ScanScheduler manages its own APScheduler internally and does not
    need to be called from this clock process. This function exists for
    future monitoring/statistics but does not execute scans.
    """
    global current_job
    current_job = 'scheduled_scans'

    try:
        # ScanScheduler runs independently via its own APScheduler
        # This is just a heartbeat/monitoring placeholder
        debug("Scheduled scans running via ScanScheduler (independent APScheduler)")

    finally:
        current_job = None

def cleanup_old_data():
    """Daily cleanup of old throughput samples."""
    global current_job
    job_name = 'database_cleanup'
    current_job = job_name
    start_time = datetime.utcnow()
    print(f"[CLOCK JOB] ► cleanup_old_data() STARTED at {start_time.isoformat()}")

    # Initialize job stats if not exists
    if job_name not in scheduler_stats['jobs']:
        scheduler_stats['jobs'][job_name] = {
            'success_count': 0,
            'error_count': 0,
            'last_run': None,
            'last_error': None
        }

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

            # Cleanup traffic logs
            print(f"[CLOCK JOB] Cleaning up traffic logs older than {retention_days} days...")
            traffic_count = collector.storage.cleanup_old_traffic_logs(retention_days)
            print(f"[CLOCK JOB] ✓ Deleted {traffic_count} old traffic logs")
            info("Deleted %d old traffic logs (retention: %d days)", traffic_count, retention_days)

            # Cleanup system logs
            print(f"[CLOCK JOB] Cleaning up system logs older than {retention_days} days...")
            system_count = collector.storage.cleanup_old_system_logs(retention_days)
            print(f"[CLOCK JOB] ✓ Deleted {system_count} old system logs")
            info("Deleted %d old system logs (retention: %d days)", system_count, retention_days)

        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()
        print(f"[CLOCK JOB] ✓ Cleanup completed in {duration:.2f} seconds")
        info("Daily cleanup completed (duration: %.2fs)", duration)

        # Update job stats
        scheduler_stats['jobs'][job_name]['success_count'] += 1
        scheduler_stats['jobs'][job_name]['last_run'] = end_time.isoformat()

    except Exception as e:
        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()
        print(f"[CLOCK JOB] ✗ Cleanup ERROR after {duration:.2f} seconds: {str(e)}")
        exception("Error in daily cleanup after %.2fs: %s", duration, str(e))

        # Update job error stats
        scheduler_stats['jobs'][job_name]['error_count'] += 1
        scheduler_stats['jobs'][job_name]['last_error'] = str(e)

        raise  # Re-raise to trigger EVENT_JOB_ERROR
    finally:
        current_job = None

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
    timezone = settings.get('timezone', 'UTC')

    print(f"[CLOCK INIT] collection_enabled={collection_enabled}, retention_days={retention_days}, refresh_interval={refresh_interval}s, timezone={timezone}")

    if not collection_enabled:
        print(f"[CLOCK INIT] ✗ Throughput collection DISABLED in settings")
        info("Clock process exiting - collection disabled in settings")
        return

    # Initialize collector
    print(f"[CLOCK INIT] Initializing throughput collector...")
    info("Initializing throughput collector with %d-day retention", retention_days)

    try:
        collector_instance = init_collector(None, retention_days)  # db_path unused in v2.0.0
        if not collector_instance:
            print(f"[CLOCK INIT] ✗ Collector initialization returned None")
            error("Clock process exiting - collector initialization failed")
            return

        print(f"[CLOCK INIT] ✓ Collector initialized successfully")
        info("Throughput collector initialized successfully")

        # Run immediate pre-collection for enterprise startup (no delay before data available)
        print(f"[CLOCK INIT] Running initial data collection (pre-collection)...")
        info("Running initial data collection for immediate data availability")
        try:
            start_time = datetime.utcnow()
            collector_instance.collect_all_devices()
            duration = (datetime.utcnow() - start_time).total_seconds()
            print(f"[CLOCK INIT] ✓ Initial collection completed in {duration:.2f}s")
            info(f"Initial collection completed in {duration:.2f}s - data immediately available")
        except Exception as e:
            print(f"[CLOCK INIT] ⚠ Initial collection failed (will retry on schedule): {str(e)}")
            warning(f"Initial collection failed, will retry on schedule: {str(e)}")
            # Don't exit - continue with scheduler, it will retry

    except Exception as e:
        print(f"[CLOCK INIT] ✗ ERROR during initialization: {str(e)}")
        exception("Clock process exiting - failed to initialize throughput collector: %s", str(e))
        return

    # Initialize BlockingScheduler (NOT BackgroundScheduler!)
    # BlockingScheduler keeps the main thread alive
    global scheduler_instance
    print(f"[CLOCK INIT] Initializing BlockingScheduler with timezone={timezone}...")
    scheduler = BlockingScheduler(
        timezone=timezone,
        jobstores={'default': {'type': 'memory'}},
        executors={'default': {'type': 'threadpool', 'max_workers': 3}},
        job_defaults={
            'coalesce': True,           # Combine multiple missed runs into one
            'max_instances': 1,         # Prevent overlapping job executions
            'misfire_grace_time': 60    # Allow 60 seconds grace for missed jobs
        }
    )
    scheduler_instance = scheduler  # Store for dynamic rescheduling

    # Register event listeners
    scheduler.add_listener(on_job_executed, EVENT_JOB_EXECUTED)
    scheduler.add_listener(on_job_error, EVENT_JOB_ERROR)
    scheduler.add_listener(on_job_missed, EVENT_JOB_MISSED)
    scheduler.add_listener(on_scheduler_start, EVENT_SCHEDULER_START)
    scheduler.add_listener(on_scheduler_shutdown, EVENT_SCHEDULER_SHUTDOWN)

    # Register Job 1: Throughput Collection
    scheduler.add_job(
        func=run_collection,
        trigger='interval',
        seconds=refresh_interval,
        id='collect_throughput',
        name='Throughput Data Collection',
        replace_existing=True
    )
    print(f"[CLOCK INIT] ✓ Job 'collect_throughput' registered with {refresh_interval}-second interval")

    # Register Job 2: Connected Devices Collection
    scheduler.add_job(
        func=collect_connected_devices,
        trigger='interval',
        seconds=refresh_interval,
        id='collect_connected_devices',
        name='Connected Devices Collection',
        replace_existing=True
    )
    print(f"[CLOCK INIT] ✓ Job 'collect_connected_devices' registered with {refresh_interval}-second interval")

    # Register Job 3: Traffic Flows Collection (for Sankey diagrams)
    scheduler.add_job(
        func=collect_traffic_flows,
        trigger='interval',
        seconds=60,  # Collect every 60 seconds
        id='collect_traffic_flows',
        name='Traffic Flows Collection',
        replace_existing=True
    )
    print(f"[CLOCK INIT] ✓ Job 'collect_traffic_flows' registered (every 60 seconds)")

    # Register Job 4: Database Cleanup (daily at 02:00 UTC)
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

    # Register Job 5: Scheduler Stats Persistence (every 60 seconds)
    scheduler.add_job(
        func=persist_scheduler_stats,
        trigger='interval',
        seconds=60,
        id='persist_scheduler_stats',
        name='Scheduler Stats Persistence',
        replace_existing=True
    )
    print(f"[CLOCK INIT] ✓ Job 'persist_scheduler_stats' registered (every 60 seconds)")

    # Register signal handlers for graceful shutdown
    print(f"[CLOCK INIT] Registering signal handlers (SIGTERM, SIGINT)...")
    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)
    print(f"[CLOCK INIT] ✓ Signal handlers registered")

    # Set scheduler start time and initial state
    global clock_start_time
    clock_start_time = datetime.utcnow()
    scheduler_stats['state'] = 'running'

    print("=" * 60)
    print("Clock process initialized successfully")
    print("=" * 60)

    # Run initial collections immediately before starting scheduler
    print("[CLOCK INIT] Running initial data collection...")
    try:
        run_collection()  # Run throughput collection immediately
        print("[CLOCK INIT] ✓ Initial throughput collection completed")
    except Exception as e:
        print(f"[CLOCK INIT] ⚠ Initial throughput collection failed: {str(e)}")
        # Continue anyway - scheduler will retry in {refresh_interval} seconds

    try:
        collect_connected_devices()  # Run connected devices collection immediately
        print("[CLOCK INIT] ✓ Initial connected devices collection completed")
    except Exception as e:
        print(f"[CLOCK INIT] ⚠ Initial connected devices collection failed: {str(e)}")
        # Continue anyway - scheduler will retry

    try:
        collect_traffic_flows()  # Run traffic flows collection immediately
        print("[CLOCK INIT] ✓ Initial traffic flows collection completed")
    except Exception as e:
        print(f"[CLOCK INIT] ⚠ Initial traffic flows collection failed: {str(e)}")
        # Continue anyway - scheduler will retry

    print("=" * 60)
    print(f"Initial collections complete - dashboard data available immediately")
    print(f"Recurring collections will run every {refresh_interval} seconds (traffic flows: 60s)")
    print("=" * 60)

    # Wait brief period before starting scheduler to avoid race condition
    # This ensures initial collections complete and database locks release
    # before scheduler's first trigger, preventing duplicate timestamps
    import time
    print("[CLOCK INIT] Waiting 2 seconds before starting scheduler...")
    time.sleep(2)
    print("[CLOCK INIT] ✓ Safe to start scheduler")

    print("=" * 60)
    print("Press Ctrl+C or send SIGTERM to stop the clock process")
    print("=" * 60)
    info("Clock process starting scheduler (blocking mode)")

    try:
        # Start the blocking scheduler (this will block forever until interrupted)
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        print("\n[CLOCK SHUTDOWN] Received shutdown signal")
        info("Clock process shutting down gracefully")
        scheduler_stats['state'] = 'stopped'
        scheduler.shutdown(wait=True)  # Wait for jobs with default 30s timeout
        print("[CLOCK SHUTDOWN] ✓ Clock process stopped")
        info("Clock process shutdown complete (executions: %d, errors: %d)",
             scheduler_stats['total_executions'], scheduler_stats['total_errors'])

if __name__ == '__main__':
    main()
