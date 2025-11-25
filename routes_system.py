"""
Flask route handlers for system health and services
Handles health checks, version info, services status, and database management
"""
from flask import jsonify, session
from datetime import datetime
import sqlite3
from auth import login_required
from config import load_settings
from firewall_api import get_firewall_config, check_firewall_health
from logger import debug, error, exception, info
from version import get_version_info


def register_system_routes(app, csrf, limiter):
    """Register system health and services routes"""
    debug("Registering system health and services routes")

    @app.route('/api/health')
    @limiter.limit("600 per hour")  # Support frequent health checks
    @login_required
    def health():
        """Health check endpoint"""
        return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

    @app.route('/api/system/health')
    @limiter.limit("300 per hour")  # Allow polling during startup initialization
    @login_required
    def system_health():
        """
        Enterprise system health endpoint for startup readiness checks
        Returns collector status, last collection time, and data availability
        Used by Analytics page to determine if system is ready
        """
        from throughput_collector import get_collector
        from throughput_storage_timescale import TimescaleStorage
        from config import TIMESCALE_DSN, load_settings
        from datetime import datetime, timedelta

        debug("=== System Health Check API endpoint called ===")

        try:
            collector = get_collector()
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')
            refresh_interval = settings.get('refresh_interval', 60)

            # Determine collector status
            if collector is None:
                # Collector not initialized - try to get data from storage directly
                try:
                    storage = TimescaleStorage(TIMESCALE_DSN)
                    collector_status = 'not_initialized_with_fallback'
                except Exception as storage_error:
                    # Storage initialization failed - database not ready yet
                    debug(f"Storage initialization failed during health check: {str(storage_error)}")
                    collector_status = 'database_initializing'
                    storage = None
            else:
                collector_status = 'ready'
                storage = collector.storage

            # Get last collection time and sample count
            last_collection = None
            sample_count = 0
            oldest_sample = None

            if storage:
                try:
                    # Check for recent samples (within 5 minutes)
                    latest_sample = storage.get_latest_sample(device_id, max_age_seconds=300)
                    if latest_sample:
                        last_collection = latest_sample['timestamp']

                    # Get sample count for last hour
                    now = datetime.now()
                    one_hour_ago = now - timedelta(hours=1)
                    samples = storage.query_samples(device_id, one_hour_ago, now, 'raw')
                    sample_count = len(samples)

                    # Get oldest sample in entire database
                    all_samples = storage.query_samples(device_id, datetime(2020, 1, 1), now, 'raw')
                    if all_samples:
                        oldest_sample = all_samples[0]['timestamp']

                except Exception as e:
                    debug(f"Error querying storage for health check: {str(e)}")

            # Determine overall readiness
            # System is ready if:
            # 1. Database is initialized and accessible (not 'database_initializing'), AND
            # 2. Either:
            #    a) We have samples in the database, OR
            #    b) Storage is accessible and clock process will collect data (enterprise immediate startup)
            # This allows immediate dashboard access - charts will populate within seconds
            database_ready = collector_status in ['ready', 'not_initialized_with_fallback']
            has_data = sample_count > 0

            # Enterprise startup: Consider ready if database initialized, even if no samples yet
            # Clock process runs immediate collection, so data appears within 5-10 seconds
            ready = database_ready

            # Calculate time since last collection
            seconds_since_collection = None
            if last_collection:
                try:
                    last_dt = datetime.fromisoformat(last_collection.replace('Z', '+00:00'))
                    seconds_since_collection = int((datetime.now() - last_dt).total_seconds())
                except Exception:
                    pass

            result = {
                'status': collector_status,
                'ready': ready,
                'last_collection': last_collection,
                'seconds_since_collection': seconds_since_collection,
                'sample_count_last_hour': sample_count,
                'oldest_sample': oldest_sample,
                'refresh_interval': refresh_interval,
                'device_id': device_id,
                'timestamp': datetime.now().isoformat()
            }

            # Add helpful message for UI
            if not ready:
                if collector_status == 'database_initializing':
                    result['message'] = 'Database initializing. This may take a few moments on first startup...'
                    result['retry_after'] = 15  # Database schema creation can take time
                elif collector_status == 'not_initialized':
                    result['message'] = 'Collector initializing. Please wait...'
                    result['retry_after'] = 5
                else:
                    result['message'] = 'System initializing...'
                    result['retry_after'] = 10
            else:
                # System is ready - provide helpful context about data availability
                if has_data:
                    result['message'] = f'System ready ({sample_count} samples available)'
                else:
                    result['message'] = 'System ready - initial data collection in progress (charts will populate within seconds)'

            debug(f"Health check: status={collector_status}, ready={ready}, samples={sample_count}, last_collection={last_collection}")

            return jsonify(result)

        except Exception as e:
            exception(f"System health check failed: {str(e)}")
            # Return 503 Service Unavailable (not 500) for initialization issues
            # This is a temporary state, not a server error
            return jsonify({
                'status': 'error',
                'ready': False,
                'message': f'Service temporarily unavailable: {str(e)}',
                'retry_after': 30,
                'error_details': str(e)  # Include detailed error for enterprise debugging
            }), 503

    @app.route('/api/firewall-health')
    @limiter.limit("300 per hour")  # 5/min for 15s polling during reboot monitoring
    @login_required
    def firewall_health_check():
        """Lightweight firewall health check - does NOT trigger update server connections"""
        debug("=== Firewall Health Check API endpoint called ===")
        try:
            firewall_ip, api_key, _ = get_firewall_config()
            if not firewall_ip or not api_key:
                return jsonify({'status': 'error', 'message': 'No device configured'}), 400

            result = check_firewall_health(firewall_ip, api_key)
            return jsonify(result)

        except Exception as e:
            error(f"Error in firewall health check: {str(e)}")
            return jsonify({'status': 'offline', 'message': str(e)}), 500

    @app.route('/api/version')
    def version():
        """Version information endpoint (public - no auth required)"""
        return jsonify(get_version_info())

    @app.route('/api/services/status')
    @limiter.limit("600 per hour")
    @login_required
    def services_status():
        """API endpoint for system services status (APScheduler + Database)"""
        from throughput_collector import get_collector
        import os

        debug("=== Services Status API endpoint called ===")

        try:
            result = {
                'status': 'success',
                'scheduler': {},
                'database': {},
                'jobs': [],
                'device_stats': []
            }

            # Get APScheduler status (now runs in separate clock.py process)
            # First try direct stats from database (Priority 2)
            collector = get_collector()
            settings = load_settings()
            refresh_interval = settings.get('refresh_interval', 60)

            if collector is not None:
                storage = collector.storage

                # Try to get direct scheduler stats from database
                scheduler_stats = storage.get_latest_scheduler_stats()

                if scheduler_stats:
                    # Direct stats available from clock process!
                    result['scheduler']['state'] = scheduler_stats['state'].title()
                    result['scheduler']['total_executions'] = scheduler_stats['total_executions']
                    result['scheduler']['total_errors'] = scheduler_stats['total_errors']
                    result['scheduler']['last_execution'] = scheduler_stats['last_execution']
                    result['scheduler']['last_error'] = scheduler_stats['last_error']
                    result['scheduler']['last_error_time'] = scheduler_stats['last_error_time']
                    result['scheduler']['uptime_seconds'] = scheduler_stats['uptime_seconds']
                    result['scheduler']['execution_history'] = scheduler_stats['execution_history']
                    result['scheduler']['next_collection'] = f"Every {refresh_interval}s"
                    result['scheduler']['data_source'] = 'direct'  # Indicate we have direct stats

                    # Format uptime as human-readable
                    uptime_seconds = scheduler_stats['uptime_seconds']
                    hours = uptime_seconds // 3600
                    minutes = (uptime_seconds % 3600) // 60
                    result['scheduler']['uptime_formatted'] = f"{hours}h {minutes}m"
                else:
                    # Fall back to inference from database activity
                    device_id = settings.get('selected_device_id', '')
                    max_age = refresh_interval * 2  # Allow some buffer

                    if device_id:
                        latest_sample = storage.get_latest_sample(device_id, max_age_seconds=max_age)
                        if latest_sample:
                            result['scheduler']['state'] = 'Running (Inferred)'
                            result['scheduler']['last_collection'] = latest_sample['timestamp']
                            result['scheduler']['next_collection'] = f"Every {refresh_interval}s"
                        else:
                            result['scheduler']['state'] = 'No Recent Data'
                            result['scheduler']['last_collection'] = 'None in last 2 minutes'
                            result['scheduler']['next_collection'] = f"Expected every {refresh_interval}s"
                    else:
                        result['scheduler']['state'] = 'No Device Selected'
                        result['scheduler']['last_collection'] = 'N/A'
                        result['scheduler']['next_collection'] = f"Expected every {refresh_interval}s"

                    result['scheduler']['data_source'] = 'inferred'  # Indicate we're inferring

                # Add known job information from clock.py
                # Include per-job stats if available
                job_stats = scheduler_stats.get('jobs', {}) if scheduler_stats else {}

                result['jobs'] = [
                    {
                        'id': 'throughput_collection',
                        'name': 'Throughput Data Collection',
                        'description': 'Collects firewall metrics (throughput, CPU, memory, sessions, logs, interfaces, applications)',
                        'trigger': f'Every {refresh_interval} seconds',
                        'status': 'Active in clock process',
                        'data_collected': 'Throughput, system resources, sessions, threat stats, traffic logs, applications, licenses',
                        'success_count': job_stats.get('throughput_collection', {}).get('success_count', 0),
                        'error_count': job_stats.get('throughput_collection', {}).get('error_count', 0),
                        'last_run': job_stats.get('throughput_collection', {}).get('last_run'),
                        'last_error': job_stats.get('throughput_collection', {}).get('last_error')
                    },
                    {
                        'id': 'connected_devices_collection',
                        'name': 'Connected Devices Collection',
                        'description': 'Collects ARP entries from firewall and stores in database with hostname/metadata enrichment',
                        'trigger': f'Every {refresh_interval} seconds',
                        'status': 'Active in clock process',
                        'data_collected': 'IP addresses, MAC addresses, hostnames, VLANs, interfaces, zones, vendor info',
                        'success_count': job_stats.get('connected_devices_collection', {}).get('success_count', 0),
                        'error_count': job_stats.get('connected_devices_collection', {}).get('error_count', 0),
                        'last_run': job_stats.get('connected_devices_collection', {}).get('last_run'),
                        'last_error': job_stats.get('connected_devices_collection', {}).get('last_error')
                    },
                    {
                        'id': 'database_cleanup',
                        'name': 'Database Cleanup',
                        'description': f'Removes data older than {settings.get("throughput_retention_days", 90)} days: throughput samples, traffic logs, system logs, resolved alerts, and expired alert cooldowns',
                        'trigger': 'Daily at 02:00 UTC',
                        'status': 'Active in clock process',
                        'data_collected': 'N/A (maintenance job)',
                        'success_count': job_stats.get('database_cleanup', {}).get('success_count', 0),
                        'error_count': job_stats.get('database_cleanup', {}).get('error_count', 0),
                        'last_run': job_stats.get('database_cleanup', {}).get('last_run'),
                        'last_error': job_stats.get('database_cleanup', {}).get('last_error')
                    },
                    {
                        'id': 'persist_scheduler_stats',
                        'name': 'Scheduler Stats Persistence',
                        'description': 'Writes scheduler statistics to database every 60 seconds for monitoring',
                        'trigger': 'Every 60 seconds',
                        'status': 'Active in clock process',
                        'data_collected': 'Scheduler execution stats, job counts, errors'
                    }
                ]
            else:
                result['scheduler']['state'] = 'Collector Not Initialized'
                result['scheduler']['last_collection'] = 'N/A'
                result['scheduler']['next_collection'] = 'N/A'

            # Get Database status (v2.1.2 - TimescaleDB)
            from throughput_storage_timescale import TimescaleStorage
            from config import TIMESCALE_DSN

            try:
                storage = TimescaleStorage(TIMESCALE_DSN)

                # Get database statistics
                db_stats = storage.get_storage_stats()
                result['database']['state'] = 'Connected'
                result['database']['size'] = db_stats.get('database_size_human', 'N/A')
                result['database']['path'] = 'PostgreSQL/TimescaleDB'

                # Get total sample count
                total_samples = storage.get_sample_count()
                result['database']['total_samples'] = total_samples

                # Get oldest sample timestamp
                oldest = storage.get_oldest_sample_time()
                result['database']['oldest_sample'] = oldest.isoformat() if oldest else 'N/A'

                # Get per-device statistics
                device_counts = storage.get_device_sample_counts()

                from device_manager import device_manager
                devices = device_manager.load_devices()
                device_map = {d['id']: d['name'] for d in devices}

                for device_id, sample_count in device_counts.items():
                    device_name = device_map.get(device_id, device_id)
                    result['device_stats'].append({
                        'device_id': device_id,
                        'device_name': device_name,
                        'sample_count': sample_count,
                        'oldest': 'N/A',  # Can be added if needed
                        'newest': 'N/A'   # Can be added if needed
                    })

            except Exception as db_error:
                exception(f"Failed to get database stats: {str(db_error)}")
                result['database']['state'] = 'Error'
                result['database']['size'] = 'N/A'
                result['database']['path'] = str(db_error)

            return jsonify(result)

        except Exception as e:
            exception(f"Failed to get services status: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/database/clear', methods=['POST'])
    @limiter.limit("5 per hour")  # Very strict limit for destructive operation
    @login_required
    def clear_database():
        """
        API endpoint to clear data from TimescaleDB.

        Supports:
        - Clear all data (no device_id in request body)
        - Clear data for specific device (device_id in request body)
        """
        from throughput_storage_timescale import TimescaleStorage
        from config import TIMESCALE_DSN

        debug("=== Clear Database API endpoint called ===")

        try:
            # Get optional device_id from request body
            device_id = None
            if request.is_json:
                device_id = request.json.get('device_id')

            storage = TimescaleStorage(TIMESCALE_DSN)

            if device_id:
                # Clear data for specific device only
                debug(f"Clearing data for device: {device_id}")
                success = storage.clear_device_data(device_id)

                if success:
                    info(f"Device data cleared for {device_id} by user {session.get('username', 'unknown')}")
                    return jsonify({
                        'status': 'success',
                        'message': f'All data cleared for device {device_id}',
                        'device_id': device_id
                    })
                else:
                    return jsonify({
                        'status': 'error',
                        'message': f'Failed to clear data for device {device_id}'
                    }), 500

            else:
                # Clear ALL data (complete database wipe)
                debug("Clearing ALL database data")
                success = storage.clear_all_data()

                if success:
                    info(f"Database completely cleared by user {session.get('username', 'unknown')}")
                    return jsonify({
                        'status': 'success',
                        'message': 'All database data cleared successfully'
                    })
                else:
                    return jsonify({
                        'status': 'error',
                        'message': 'Failed to clear database'
                    }), 500

        except Exception as e:
            exception(f"Failed to clear database: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/system/collect-now', methods=['POST'])
    @limiter.limit("20 per hour")  # Allow manual triggers for testing
    @login_required
    def manual_collection_trigger():
        """API endpoint to manually trigger throughput collection (for testing/debugging)"""
        from throughput_collector import get_collector
        from datetime import datetime

        debug("=== Manual Collection Trigger API endpoint called ===")

        try:
            collector = get_collector()
            if collector is None:
                return jsonify({
                    'status': 'error',
                    'message': 'Throughput collector not initialized'
                }), 503

            # Trigger collection
            start_time = datetime.utcnow()
            info(f"Manual collection triggered by user {session.get('username', 'unknown')}")

            try:
                collector.collect_all_devices()
                end_time = datetime.utcnow()
                duration = (end_time - start_time).total_seconds()

                info(f"Manual collection completed in {duration:.2f}s")

                return jsonify({
                    'status': 'success',
                    'message': 'Collection completed successfully',
                    'duration_seconds': round(duration, 2),
                    'timestamp': end_time.isoformat()
                })

            except Exception as e:
                end_time = datetime.utcnow()
                duration = (end_time - start_time).total_seconds()

                exception(f"Manual collection failed after {duration:.2f}s: {str(e)}")

                return jsonify({
                    'status': 'error',
                    'message': f'Collection failed: {str(e)}',
                    'duration_seconds': round(duration, 2)
                }), 500

        except Exception as e:
            exception(f"Failed to trigger manual collection: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/settings/tag-filter', methods=['GET'])
    @limiter.limit("600 per hour")
    @login_required
    def get_tag_filter_settings():
        """Get saved tag filter selections (persistent across restarts)"""
        try:
            from config import load_settings
            settings = load_settings()
            selected_tags = settings.get('chord_tag_filter', [])

            return jsonify({
                'status': 'success',
                'selected_tags': selected_tags
            })
        except Exception as e:
            exception(f"Error loading tag filter settings: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'selected_tags': []
            }), 500

    @app.route('/api/settings/tag-filter', methods=['POST'])
    @limiter.limit("100 per hour")
    @login_required
    def save_tag_filter_settings():
        """Save tag filter selections to settings (persistent across restarts)"""
        try:
            from config import load_settings, save_settings
            from flask import request

            data = request.get_json()
            selected_tags = data.get('selected_tags', [])

            # Validate input
            if not isinstance(selected_tags, list):
                return jsonify({
                    'status': 'error',
                    'message': 'selected_tags must be an array'
                }), 400

            # Load current settings
            settings = load_settings()

            # Update tag filter
            settings['chord_tag_filter'] = selected_tags

            # Save settings
            save_settings(settings)

            debug(f"Saved tag filter selection: {selected_tags}")

            return jsonify({
                'status': 'success',
                'message': 'Tag filter saved successfully',
                'selected_tags': selected_tags
            })
        except Exception as e:
            exception(f"Error saving tag filter settings: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    debug("System health and services routes registered successfully")
