"""
Flask route handlers for operational endpoints
Handles logs, applications, interfaces, licenses, settings, and tech support
"""
from flask import jsonify, request, render_template, send_from_directory
from datetime import datetime
import os
from auth import login_required
from config import load_settings, save_settings, load_notification_channels, save_notification_channels, TIMESCALE_DSN, EDITION
from firewall_api import (
    get_software_updates,
    get_license_info,
    get_application_statistics,
    generate_tech_support_file,
    check_tech_support_job_status,
    get_tech_support_file_url,
    get_interface_info,
    get_interface_traffic_counters,
    get_firewall_config
)
from logger import debug, error
from throughput_collector import get_collector
from time import time
from version import get_version


def register_operations_routes(app, csrf, limiter):
    """Register operational endpoints (logs, applications, interfaces, settings, tech support)"""
    debug("Registering operational routes")

    # ============================================================================
    # TTL-Based Response Caching (Performance Optimization)
    # ============================================================================
    # Cache slow firewall API calls to improve dashboard load times
    # Software and license info don't change frequently - safe to cache for 5 minutes
    _software_cache = {}
    _license_cache = {}
    CACHE_TTL = 300  # 5 minutes (300 seconds)

    # Traffic flows cache for Sankey diagrams (60 seconds TTL)
    # Flows are collected every 60 seconds, so caching for 60s ensures fresh data
    _traffic_flows_cache = {}
    FLOWS_CACHE_TTL = 60  # 60 seconds

    # ============================================================================
    # Base Routes
    # ============================================================================

    @app.route('/')
    @login_required
    def index():
        """Serve the main dashboard with edition information"""
        # Get license information for Enterprise Edition
        license_email = None
        license_expires = None

        if EDITION == 'enterprise':
            try:
                from config import get_license_info
                license_info = get_license_info()
                if license_info:
                    license_email = license_info.get('email', 'N/A')
                    # Format expiration date
                    expires_iso = license_info.get('expires')
                    if expires_iso:
                        from datetime import datetime
                        try:
                            expiry_date = datetime.fromisoformat(expires_iso)
                            license_expires = expiry_date.strftime('%Y-%m-%d')
                        except:
                            license_expires = 'N/A'
            except Exception as e:
                debug(f"Failed to load license info: {e}")

        return render_template(
            'index.html',
            version=get_version(),
            edition=EDITION,
            license_email=license_email,
            license_expires=license_expires
        )

    @app.route('/images/<path:filename>')
    @login_required
    def serve_images(filename):
        """Serve image files"""
        images_dir = os.path.join(os.path.dirname(__file__), 'images')
        return send_from_directory(images_dir, filename)

    # ============================================================================
    # Logs Endpoints
    # ============================================================================

    @app.route('/api/system-logs')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def system_logs_api():
        """API endpoint for system logs - reads from database (v2.1.1 Database-First)"""
        debug("=== System Logs API endpoint called (DATABASE-FIRST) ===")
        try:
            from firewall_api_logs import get_system_logs
            from firewall_api import get_firewall_config

            # v1.0.5: Accept device_id from query parameter (frontend passes it)
            # This eliminates race conditions between settings file save and API calls
            device_id = request.args.get('device_id')

            # Fallback to settings for backward compatibility
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id')
                debug(f"No device_id in request, using from settings: {device_id or 'NONE'}")

            if not device_id:
                return jsonify({
                    'status': 'error',
                    'message': 'No device selected',
                    'logs': []
                })

            # Get firewall config for API call
            firewall_config = get_firewall_config(device_id)
            if not firewall_config:
                return jsonify({
                    'status': 'error',
                    'message': 'Device configuration not found',
                    'logs': []
                })

            # Fetch logs directly from firewall API
            limit = request.args.get('limit', 50, type=int)
            result = get_system_logs(firewall_config, max_logs=limit)

            # get_system_logs returns {'status': 'success', 'logs': [...]}
            logs = result.get('logs', []) if isinstance(result, dict) else []

            debug(f"Retrieved {len(logs)} system logs from firewall API")

            return jsonify({
                'status': 'success',
                'logs': logs,
                'total': len(logs),
                'timestamp': datetime.now().isoformat(),
                'source': 'firewall'  # Direct from firewall
            }), 200, {'Cache-Control': 'max-age=60', 'X-Data-Source': 'firewall'}

        except Exception as e:
            error(f"Error retrieving system logs from firewall: {str(e)}")
            # TEMP: Print to stdout for debugging
            print(f"[SYSTEM LOGS ERROR] {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            return jsonify({
                'status': 'error',
                'message': f"Failed to load system logs: {str(e)}",
                'logs': []
            })

    @app.route('/api/traffic-logs')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def traffic_logs_api():
        """API endpoint for traffic logs - reads from firewall (v2.1.1 Database-First)"""
        debug("=== Traffic Logs API endpoint called (DATABASE-FIRST) ===")
        try:
            from firewall_api_logs import get_traffic_logs
            from firewall_api import get_firewall_config

            # v1.0.5: Accept device_id from query parameter (frontend passes it)
            # This eliminates race conditions between settings file save and API calls
            device_id = request.args.get('device_id')

            # Fallback to settings for backward compatibility
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id')
                debug(f"No device_id in request, using from settings: {device_id or 'NONE'}")

            if not device_id:
                return jsonify({
                    'status': 'error',
                    'message': 'No device selected',
                    'logs': []
                })

            # Get firewall config for API call
            firewall_config = get_firewall_config(device_id)
            if not firewall_config:
                return jsonify({
                    'status': 'error',
                    'message': 'Device configuration not found',
                    'logs': []
                })

            # Fetch logs directly from firewall API
            limit = request.args.get('max_logs', 100, type=int)
            result = get_traffic_logs(firewall_config, max_logs=limit)

            # get_traffic_logs returns {'status': 'success', 'logs': [...]}
            logs = result.get('logs', []) if isinstance(result, dict) else []

            debug(f"Retrieved {len(logs)} traffic logs from firewall API")

            return jsonify({
                'status': 'success',
                'logs': logs,
                'total': len(logs),
                'timestamp': datetime.now().isoformat(),
                'source': 'firewall'  # Direct from firewall
            }), 200, {'Cache-Control': 'max-age=60', 'X-Data-Source': 'firewall'}

        except Exception as e:
            error(f"Error retrieving traffic logs from firewall: {str(e)}")
            # TEMP: Print to stdout for debugging
            print(f"[TRAFFIC LOGS ERROR] {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            return jsonify({
                'status': 'error',
                'message': f"Failed to load traffic logs: {str(e)}",
                'logs': []
            })

    # ============================================================================
    # Applications Endpoint
    # ============================================================================

    @app.route('/api/applications')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def applications_api():
        """
        API endpoint for application statistics - FIREWALL API

        Returns application data from firewall API (includes protocols and ports).
        Database doesn't store protocol/port information, so we query firewall directly.
        """
        debug("=== Applications API endpoint called (firewall-based) ===")
        try:
            # v1.0.5: Accept device_id from query parameter (frontend passes it)
            # This eliminates race conditions between settings file save and API calls
            device_id = request.args.get('device_id')

            # Fallback to settings for backward compatibility
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id', '')
                debug(f"No device_id in request, using from settings: {device_id or 'NONE'}")

            if not device_id:
                return jsonify({
                    'status': 'error',
                    'message': 'No device selected',
                    'applications': [],
                    'summary': {
                        'total_applications': 0,
                        'total_sessions': 0,
                        'total_bytes': 0,
                        'vlans_detected': 0,
                        'zones_detected': 0
                    },
                    'total': 0,
                    'source': 'none'
                })

            # Get firewall config for API access
            from firewall_api import get_firewall_config
            from firewall_api_applications import get_application_statistics

            firewall_config = get_firewall_config(device_id)

            # Call firewall API to get application statistics with protocols and ports
            result = get_application_statistics(firewall_config, max_logs=1000)

            applications = result.get('applications', [])
            summary = result.get('summary', {
                'total_applications': 0,
                'total_sessions': 0,
                'total_bytes': 0,
                'vlans_detected': 0,
                'zones_detected': 0
            })

            if applications:
                debug(f"Retrieved {len(applications)} applications from FIREWALL API")
            else:
                debug("No application data from firewall API")

            return jsonify({
                'status': 'success',
                'applications': applications,
                'summary': summary,
                'total': len(applications),
                'timestamp': datetime.now().isoformat(),
                'source': 'firewall'
            })

        except Exception as e:
            error(f"Error in applications API: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'applications': [],
                'summary': {
                    'total_applications': 0,
                    'total_sessions': 0,
                    'total_bytes': 0,
                    'vlans_detected': 0,
                    'zones_detected': 0
                },
                'total': 0,
                'source': 'error'
            })

    @app.route('/api/device-flows/<device_id>/<client_ip>')
    @limiter.limit("600 per hour")  # Same as other monitoring endpoints
    @login_required
    def device_flows_api(device_id, client_ip):
        """
        API endpoint for traffic flow data (Sankey diagram visualization).

        Returns source→destination→application flow breakdown for a specific client IP.
        Queries traffic_flows hypertable with TTL caching for enterprise performance.

        Query params:
            minutes: Time range in minutes (default: 60, max: 1440)

        Returns:
            JSON with flow data suitable for d3-sankey rendering
        """
        debug(f"=== Device Flows API called for device={device_id}, client={client_ip} ===")

        try:
            # Parse query parameters
            minutes = request.args.get('minutes', '60')
            try:
                minutes = int(minutes)
                if minutes < 1 or minutes > 1440:  # Max 24 hours
                    minutes = 60
            except ValueError:
                minutes = 60

            # Check TTL cache (60-second cache to align with collection interval)
            cache_key = f"{device_id}:{client_ip}:{minutes}"
            now = time()

            if cache_key in _traffic_flows_cache:
                cached_data, cache_time = _traffic_flows_cache[cache_key]
                age = now - cache_time
                if age < FLOWS_CACHE_TTL:
                    debug(f"Cache HIT for {cache_key} (age={age:.1f}s)")
                    return jsonify({
                        'status': 'success',
                        'flows': cached_data,
                        'total_flows': len(cached_data),
                        'client_ip': client_ip,
                        'device_id': device_id,
                        'minutes': minutes,
                        'timestamp': datetime.now().isoformat(),
                        'source': 'cache',
                        'cache_age': age
                    })
                else:
                    debug(f"Cache EXPIRED for {cache_key} (age={age:.1f}s)")
            else:
                debug(f"Cache MISS for {cache_key}")

            # Query database for traffic flows
            # PANfm v2.1.1: Database-First Pattern - Web process queries TimescaleDB directly
            # No collector needed, use direct TimescaleDB connection
            from throughput_storage_timescale import TimescaleStorage
            storage = TimescaleStorage(TIMESCALE_DSN)

            # Get flows from TimescaleDB (indexed query, <100ms)
            flows = storage.get_traffic_flows_for_client(device_id, client_ip, minutes)

            debug(f"Retrieved {len(flows)} traffic flows from database for {client_ip} ({minutes}min window)")

            # Update cache
            _traffic_flows_cache[cache_key] = (flows, now)
            debug(f"Cache UPDATED for {cache_key}")

            return jsonify({
                'status': 'success',
                'flows': flows,
                'total_flows': len(flows),
                'client_ip': client_ip,
                'device_id': device_id,
                'minutes': minutes,
                'timestamp': datetime.now().isoformat(),
                'source': 'database'
            })

        except Exception as e:
            error(f"Error in device-flows API: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'flows': [],
                'total_flows': 0,
                'client_ip': client_ip,
                'device_id': device_id,
                'source': 'error'
            }), 500

    @app.route('/api/top-category')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def top_category_api():
        """
        API endpoint for top application category by volume.

        Supports time range parameter for historical aggregation.
        Query params:
            range: Time range (1h, 6h, 24h, 7d, 30d) or omit for latest snapshot

        Returns:
            JSON with status, category name, and bytes volume
        """
        debug("=== Top Category API endpoint called ===")
        try:
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')

            if not device_id:
                return jsonify({
                    'status': 'error',
                    'message': 'No device selected',
                    'category': None,
                    'bytes': 0
                })

            # Get time range parameter
            time_range = request.args.get('range', None)
            debug(f"Time range parameter: {time_range}")

            # Get data from database
            from throughput_collector import get_collector
            collector = get_collector()

            if not collector or not collector.storage:
                return jsonify({
                    'status': 'error',
                    'message': 'Database collector not initialized',
                    'category': None,
                    'bytes': 0
                })

            # Get top category for time range
            result = collector.storage.get_top_category_for_range(device_id, time_range)

            if result and 'category' in result:
                debug(f"Top category: {result['category']} with {result['bytes']} bytes")
                return jsonify({
                    'status': 'success',
                    'category': result['category'],
                    'bytes': result['bytes'],
                    'timestamp': datetime.now().isoformat(),
                    'range': time_range or 'latest'
                })
            else:
                debug("No category data available")
                return jsonify({
                    'status': 'success',
                    'category': None,
                    'bytes': 0,
                    'timestamp': datetime.now().isoformat(),
                    'range': time_range or 'latest'
                })

        except Exception as e:
            error(f"Error in top category API: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'category': None,
                'bytes': 0
            })

    # ============================================================================
    # Software & License Endpoints
    # ============================================================================

    @app.route('/api/software-updates')
    @limiter.limit("120 per minute")  # Higher limit for reboot monitoring (15s intervals = 4/min, +buffer)
    @login_required
    def software_updates():
        """API endpoint for software update information (CACHED: 5 min TTL)"""
        debug("=== Software Updates API endpoint called ===")
        settings = load_settings()
        device_id = settings.get('selected_device_id', '')
        debug(f"Selected device ID: {device_id}")

        # Check cache first
        now = time()
        if device_id and device_id in _software_cache:
            cached_data, cached_time = _software_cache[device_id]
            age = int(now - cached_time)
            if now - cached_time < CACHE_TTL:
                debug(f"Software updates cache HIT (age: {age}s, TTL: {CACHE_TTL}s)")
                return jsonify(cached_data)
            else:
                debug(f"Software updates cache EXPIRED (age: {age}s > TTL: {CACHE_TTL}s)")

        # Cache miss or expired - fetch from firewall
        debug("Software updates cache MISS - fetching from firewall API")
        firewall_config = get_firewall_config()
        data = get_software_updates(firewall_config)

        # Store in cache
        if device_id:
            _software_cache[device_id] = (data, now)
            debug(f"Cached software updates for device {device_id}")

        return jsonify(data)

    @app.route('/api/license')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def license_info():
        """API endpoint for license information (CACHED: 5 min TTL)"""
        settings = load_settings()
        device_id = settings.get('selected_device_id', '')
        debug(f"License info requested for device: {device_id}")

        # Check cache first
        now = time()
        if device_id and device_id in _license_cache:
            cached_data, cached_time = _license_cache[device_id]
            age = int(now - cached_time)
            if now - cached_time < CACHE_TTL:
                debug(f"License info cache HIT (age: {age}s, TTL: {CACHE_TTL}s)")
                return jsonify(cached_data)
            else:
                debug(f"License info cache EXPIRED (age: {age}s > TTL: {CACHE_TTL}s)")

        # Cache miss or expired - fetch from firewall
        debug("License info cache MISS - fetching from firewall API")
        firewall_config = get_firewall_config()
        data = get_license_info(firewall_config)

        # Store in cache
        if device_id:
            _license_cache[device_id] = (data, now)
            debug(f"Cached license info for device {device_id}")

        return jsonify(data)

    # ============================================================================
    # Tech Support Endpoints
    # ============================================================================

    @app.route('/api/tech-support/generate', methods=['POST'])
    @login_required
    def tech_support_generate():
        """API endpoint to generate tech support file"""
        debug("=== Tech Support Generate API endpoint called ===")
        firewall_config = get_firewall_config()
        data = generate_tech_support_file(firewall_config)
        return jsonify(data)

    @app.route('/api/tech-support/status/<job_id>')
    @login_required
    def tech_support_status(job_id):
        """API endpoint to check tech support job status"""
        debug(f"=== Tech Support Status API endpoint called for job: {job_id} ===")
        firewall_config = get_firewall_config()
        data = check_tech_support_job_status(firewall_config, job_id)
        return jsonify(data)

    @app.route('/api/tech-support/download/<job_id>')
    @login_required
    def tech_support_download(job_id):
        """API endpoint to get tech support file download URL"""
        debug(f"=== Tech Support Download API endpoint called for job: {job_id} ===")
        firewall_config = get_firewall_config()
        data = get_tech_support_file_url(firewall_config, job_id)
        return jsonify(data)

    # ============================================================================
    # Collector Status Endpoint (Phase 5)
    # ============================================================================

    @app.route('/api/collector/status')
    @limiter.limit("600 per hour")
    @login_required
    def collector_status():
        """API endpoint for throughput collector status and statistics"""
        debug("=== Collector Status API endpoint called ===")
        try:
            settings = load_settings()

            # Get collector instance
            collector = get_collector()
            if not collector:
                return jsonify({
                    'status': 'error',
                    'message': 'Collector not initialized',
                    'enabled': False
                })

            # Get collector stats
            collector_stats = collector.get_collector_stats()

            # Get database stats
            storage_stats = collector_stats.get('storage', {})

            # Get all devices to count monitored devices
            from device_manager import device_manager
            devices = device_manager.load_devices()
            enabled_devices = [d for d in devices if d.get('enabled', True)]

            # Build response
            response = {
                'status': 'success',
                'enabled': settings.get('throughput_collection_enabled', True),
                'interval_seconds': settings.get('refresh_interval', 60),
                'last_run': None,  # Would need to track this in collector
                'last_run_duration_ms': None,  # Would need to track this
                'total_collections': collector_stats.get('collection_count', 0),
                'failed_collections': 0,  # Would need to track failures
                'success_rate': 100.0,  # Would need failure tracking
                'database_size_mb': storage_stats.get('db_size_mb', 0),
                'sample_count': storage_stats.get('total_samples', 0),
                'retention_days': settings.get('throughput_retention_days', 90),
                'devices_monitored': len(enabled_devices),
                'last_cleanup': collector_stats.get('last_cleanup'),
                'timestamp': datetime.now().isoformat()
            }

            debug(f"Collector status: {response['total_collections']} collections, {response['devices_monitored']} devices")

            return jsonify(response)

        except Exception as e:
            error(f"Error retrieving collector status: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'enabled': False
            })

    # ============================================================================
    # Interfaces Endpoints
    # ============================================================================

    @app.route('/api/interfaces')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def interfaces_info():
        """API endpoint for interface information"""
        debug("=== Interfaces API endpoint called ===")

        # v1.0.5: Accept device_id from query parameter (frontend passes it)
        # This eliminates race conditions between settings file save and API calls
        device_id = request.args.get('device_id')

        # Fallback to settings for backward compatibility
        if not device_id or device_id.strip() == '':
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')
            debug(f"No device_id in request, using from settings: {device_id or 'NONE'}")

        if not device_id:
            return jsonify({
                'status': 'error',
                'message': 'No device selected',
                'interfaces': []
            })

        firewall_config = get_firewall_config(device_id)
        data = get_interface_info(firewall_config)
        debug(f"Interfaces API returning {len(data.get('interfaces', []))} interfaces")
        return jsonify(data)

    @app.route('/api/interface-traffic')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def interface_traffic():
        """API endpoint for per-interface traffic counters"""
        debug("=== Interface Traffic API endpoint called ===")
        counters = get_interface_traffic_counters()
        return jsonify({'status': 'success', 'counters': counters})

    # ============================================================================
    # Settings Endpoint
    # ============================================================================

    @app.route('/api/settings', methods=['GET', 'POST'])
    @limiter.limit("600 per hour")  # Support frequent settings reads
    @login_required
    def settings():
        """API endpoint for settings"""
        if request.method == 'GET':
            # Return current settings
            settings_data = load_settings()
            return jsonify({
                'status': 'success',
                'settings': settings_data
            })
        elif request.method == 'POST':
            # Save new settings
            try:
                new_settings = request.get_json()
                debug(f"=== POST /api/settings called ===")
                debug(f"Received settings: {new_settings}")

                # v1.0.8 FIX: Load existing settings first, then merge
                # This preserves fields not included in the request (e.g., notification channels,
                # chord_tag_filter, internet_traffic_filters, etc.)
                current_settings = load_settings()

                # Update only the provided fields with validation
                if 'refresh_interval' in new_settings:
                    current_settings['refresh_interval'] = max(30, min(300, int(new_settings['refresh_interval'])))
                if 'match_count' in new_settings:
                    current_settings['match_count'] = max(1, min(20, int(new_settings['match_count'])))
                if 'top_apps_count' in new_settings:
                    current_settings['top_apps_count'] = max(1, min(10, int(new_settings['top_apps_count'])))
                if 'debug_logging' in new_settings:
                    current_settings['debug_logging'] = new_settings['debug_logging']
                if 'selected_device_id' in new_settings:
                    current_settings['selected_device_id'] = new_settings['selected_device_id']
                    debug(f"selected_device_id to save: {current_settings['selected_device_id']}")
                if 'monitored_interface' in new_settings:
                    current_settings['monitored_interface'] = new_settings['monitored_interface']
                    debug(f"monitored_interface to save: {current_settings['monitored_interface']}")
                if 'tony_mode' in new_settings:
                    current_settings['tony_mode'] = new_settings['tony_mode']
                    debug(f"tony_mode to save: {current_settings['tony_mode']}")
                if 'timezone' in new_settings:
                    current_settings['timezone'] = new_settings['timezone']
                    debug(f"timezone to save: {current_settings['timezone']}")

                # Reverse DNS settings (v1.0.12)
                if 'reverse_dns_enabled' in new_settings:
                    current_settings['reverse_dns_enabled'] = new_settings['reverse_dns_enabled']
                    debug(f"reverse_dns_enabled to save: {current_settings['reverse_dns_enabled']}")

                # Save merged settings (preserves all other keys like chord_tag_filter, etc.)
                if save_settings(current_settings):
                    return jsonify({
                        'status': 'success',
                        'message': 'Settings saved successfully',
                        'settings': current_settings
                    })
                else:
                    return jsonify({
                        'status': 'error',
                        'message': 'Failed to save settings'
                    }), 500
            except Exception as e:
                debug(f"Error in settings endpoint: {e}")
                return jsonify({
                    'status': 'error',
                    'message': str(e)
                }), 400

    # ============================================================================
    # Notification Channel Settings Endpoints
    # ============================================================================

    @app.route('/api/settings/notifications', methods=['GET'])
    @limiter.limit("600 per hour")
    @login_required
    def get_notification_settings():
        """Get all notification channel configurations"""
        try:
            debug("=== GET /api/settings/notifications called ===")
            channels = load_notification_channels()
            return jsonify({
                'status': 'success',
                'channels': channels
            })
        except Exception as e:
            error(f"Failed to load notification channels: {e}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/settings/notifications/email', methods=['POST'])
    @limiter.limit("100 per hour")
    @login_required
    def save_email_notification_settings():
        """Save email notification configuration"""
        try:
            debug("=== POST /api/settings/notifications/email called ===")
            email_config = request.get_json()

            # Validate required fields
            if not email_config:
                return jsonify({
                    'status': 'error',
                    'message': 'Email configuration is required'
                }), 400

            # Load existing channels
            channels = load_notification_channels()

            # Update email config
            channels['email'] = {
                'enabled': email_config.get('enabled', False),
                'smtp_host': email_config.get('smtp_host', ''),
                'smtp_port': email_config.get('smtp_port', 587),
                'smtp_user': email_config.get('smtp_user', ''),
                'smtp_password': email_config.get('smtp_password', ''),
                'from_email': email_config.get('from_email', ''),
                'to_emails': email_config.get('to_emails', []),
                'use_tls': email_config.get('use_tls', True)
            }

            # Save channels
            if save_notification_channels(channels):
                # Reload notification manager config
                from notification_manager import notification_manager
                notification_manager.reload_config()

                debug("Email notification settings saved successfully")
                return jsonify({
                    'status': 'success',
                    'message': 'Email notification settings saved successfully'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to save email notification settings'
                }), 500
        except Exception as e:
            error(f"Failed to save email notification settings: {e}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/settings/notifications/slack', methods=['POST'])
    @limiter.limit("100 per hour")
    @login_required
    def save_slack_notification_settings():
        """Save Slack notification configuration"""
        try:
            debug("=== POST /api/settings/notifications/slack called ===")
            slack_config = request.get_json()

            # Validate required fields
            if not slack_config:
                return jsonify({
                    'status': 'error',
                    'message': 'Slack configuration is required'
                }), 400

            # Load existing channels
            channels = load_notification_channels()

            # Update Slack config
            channels['slack'] = {
                'enabled': slack_config.get('enabled', False),
                'webhook_url': slack_config.get('webhook_url', ''),
                'channel': slack_config.get('channel', '#alerts'),
                'username': slack_config.get('username', 'PANfm Alerts')
            }

            # Save channels
            if save_notification_channels(channels):
                # Reload notification manager config
                from notification_manager import notification_manager
                notification_manager.reload_config()

                debug("Slack notification settings saved successfully")
                return jsonify({
                    'status': 'success',
                    'message': 'Slack notification settings saved successfully'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to save Slack notification settings'
                }), 500
        except Exception as e:
            error(f"Failed to save Slack notification settings: {e}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/settings/notifications/webhook', methods=['POST'])
    @limiter.limit("100 per hour")
    @login_required
    def save_webhook_notification_settings():
        """Save webhook notification configuration"""
        try:
            debug("=== POST /api/settings/notifications/webhook called ===")
            webhook_config = request.get_json()

            # Validate required fields
            if not webhook_config:
                return jsonify({
                    'status': 'error',
                    'message': 'Webhook configuration is required'
                }), 400

            # Load existing channels
            channels = load_notification_channels()

            # Update webhook config
            channels['webhook'] = {
                'enabled': webhook_config.get('enabled', False),
                'url': webhook_config.get('url', ''),
                'headers': webhook_config.get('headers', {})
            }

            # Save channels
            if save_notification_channels(channels):
                # Reload notification manager config
                from notification_manager import notification_manager
                notification_manager.reload_config()

                debug("Webhook notification settings saved successfully")
                return jsonify({
                    'status': 'success',
                    'message': 'Webhook notification settings saved successfully'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to save webhook notification settings'
                }), 500
        except Exception as e:
            error(f"Failed to save webhook notification settings: {e}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/settings/notifications/test/<channel>', methods=['POST'])
    @limiter.limit("20 per hour")
    @login_required
    def test_notification_channel(channel):
        """Test notification channel by sending a test message"""
        try:
            debug(f"=== POST /api/settings/notifications/test/{channel} called ===")
            from notification_manager import notification_manager

            if channel == 'email':
                result = notification_manager.test_email()
            elif channel == 'slack':
                result = notification_manager.test_slack()
            elif channel == 'webhook':
                result = notification_manager.test_webhook()
            else:
                return jsonify({
                    'status': 'error',
                    'message': f'Invalid notification channel: {channel}'
                }), 400

            return jsonify(result)
        except Exception as e:
            error(f"Failed to test notification channel {channel}: {e}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    debug("Operational routes registered successfully")
