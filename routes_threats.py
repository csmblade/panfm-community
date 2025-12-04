"""
Flask route handlers for threat data
Completely independent from throughput - fetches latest threat logs regardless of time range

v2.1.1 Database-First Pattern: Queries TimescaleDB directly (no collector dependency)
"""
from flask import jsonify, request
from auth import login_required
from config import load_settings
from logger import debug, exception


def register_threat_routes(app, csrf, limiter):
    """Register threat data routes"""
    debug("Registering threat routes")

    @app.route('/api/threats')
    @limiter.limit("600 per hour")  # Same as throughput - frequently polled
    @login_required
    def threats():
        """API endpoint for threat data (independent of throughput time ranges)

        Returns latest threat logs from database storage
        Completely decoupled from throughput graph time range selection

        v2.1.1: Uses database-first pattern - queries TimescaleDB directly
        """

        debug("=== Threats API endpoint called (independent) ===")

        # v1.0.5: Accept device_id from query parameter (frontend passes it)
        # This eliminates race conditions between settings file save and API calls
        device_id = request.args.get('device_id')

        # Fallback to settings for backward compatibility
        if not device_id or device_id.strip() == '':
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')
            debug(f"No device_id in request, using from settings: {device_id}")

        # v1.0.5: DO NOT auto-select device here - that causes race conditions!
        # Device selection is ONLY handled by frontend initializeCurrentDevice() in app.js
        if not device_id or device_id.strip() == '':
            return jsonify({
                'status': 'error',
                'message': 'No device selected. Please select a device from the dropdown.'
            }), 400

        debug(f"Fetching threats for device ID: {device_id}")

        try:
            # Database-First Pattern (v2.1.1): Query TimescaleDB directly
            # Web process has READ-ONLY access - no collector initialization needed
            # Clock process (clock.py) handles all data writes via initialized collector
            from throughput_storage_timescale import TimescaleStorage
            from config import TIMESCALE_DSN

            storage = TimescaleStorage(TIMESCALE_DSN)

            # Fetch latest threat logs from database (limit to last 100 for performance)
            # These are stored by the collector from firewall API responses
            try:
                critical_logs = storage.get_threat_logs(device_id, severity='critical', limit=100)
                high_logs = storage.get_threat_logs(device_id, severity='high', limit=100)
                medium_logs = storage.get_threat_logs(device_id, severity='medium', limit=100)
                url_logs = storage.get_url_filtering_logs(device_id, limit=100)
            except Exception as e:
                debug(f"Could not fetch threat logs from storage: {str(e)}")
                critical_logs = []
                high_logs = []
                medium_logs = []
                url_logs = []

            import sys
            sys.stderr.write(f"\n[THREAT API] Fetched threat logs:\n")
            sys.stderr.write(f"  Critical: {len(critical_logs)}\n")
            sys.stderr.write(f"  High: {len(high_logs)}\n")
            sys.stderr.write(f"  Medium: {len(medium_logs)}\n")
            sys.stderr.write(f"  URL: {len(url_logs)}\n")
            sys.stderr.flush()

            debug(f"Fetched threat logs: {len(critical_logs)} critical, {len(high_logs)} high, {len(medium_logs)} medium, {len(url_logs)} URL")

            # Build response with threat data only
            response = {
                'status': 'success',
                'threats': {
                    'critical_count': len(critical_logs),
                    'high_count': len(high_logs),
                    'medium_count': len(medium_logs),
                    'url_blocked': len(url_logs),
                    'critical_logs': critical_logs[:50],  # Limit to 50 for modal display
                    'high_logs': high_logs[:50],
                    'medium_logs': medium_logs[:50],
                    'blocked_url_logs': url_logs[:50],
                    'critical_last_seen': critical_logs[0]['time'] if critical_logs else None,
                    'high_last_seen': high_logs[0]['time'] if high_logs else None,
                    'medium_last_seen': medium_logs[0]['time'] if medium_logs else None,
                    'blocked_url_last_seen': url_logs[0]['time'] if url_logs else None
                }
            }

            sys.stderr.write(f"\n[THREAT API] Returning counts:\n")
            sys.stderr.write(f"  Critical: {response['threats']['critical_count']}\n")
            sys.stderr.write(f"  High: {response['threats']['high_count']}\n")
            sys.stderr.write(f"  Medium: {response['threats']['medium_count']}\n")
            sys.stderr.write(f"  URL: {response['threats']['url_blocked']}\n")
            sys.stderr.flush()

            debug(f"Returning threat data: {response['threats']['critical_count']} critical, {response['threats']['high_count']} high, {response['threats']['medium_count']} medium, {response['threats']['url_blocked']} blocked")

            return jsonify(response)

        except Exception as e:
            exception("Failed to fetch threat data: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Failed to fetch threat data: {str(e)}'
            }), 500

    @app.route('/api/threats/timeline')
    @limiter.limit("600 per hour")
    @login_required
    def threats_timeline():
        """API endpoint for threat timeline data (Analytics page chart)

        v1.0.13: Fixed bug where overlapping 5-min sliding windows caused
        inflated counts (17,000+ shown instead of actual ~50). Now queries
        threat_logs directly with TimescaleDB time_bucket() for accurate counts.

        Query params:
            device_id: Device identifier
            range: Time range (1h, 6h, 24h, 7d, 30d) - default 6h

        Returns:
            JSON with timeline array of {bucket, count} objects
        """
        debug("=== Threats Timeline API endpoint called ===")

        # Get device ID from request or settings
        device_id = request.args.get('device_id')
        if not device_id or device_id.strip() == '':
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')

        if not device_id or device_id.strip() == '':
            return jsonify({
                'status': 'error',
                'message': 'No device selected'
            }), 400

        # Parse time range
        time_range = request.args.get('range', '6h')

        # Map range to hours and bucket size
        range_config = {
            '1h':  {'hours': 1,   'bucket_minutes': 5},    # 12 data points
            '6h':  {'hours': 6,   'bucket_minutes': 10},   # 36 data points
            '24h': {'hours': 24,  'bucket_minutes': 30},   # 48 data points
            '7d':  {'hours': 168, 'bucket_minutes': 180},  # 56 data points (3 hours)
            '30d': {'hours': 720, 'bucket_minutes': 720}   # 60 data points (12 hours)
        }

        config = range_config.get(time_range, range_config['6h'])
        hours = config['hours']
        bucket_minutes = config['bucket_minutes']

        debug(f"Fetching threat timeline: device={device_id}, range={time_range}, hours={hours}, bucket={bucket_minutes}min")

        try:
            from throughput_storage_timescale import TimescaleStorage
            from config import TIMESCALE_DSN

            storage = TimescaleStorage(TIMESCALE_DSN)
            timeline = storage.get_threat_timeline(device_id, hours, bucket_minutes)

            total_threats = sum(t['count'] for t in timeline)
            debug(f"Threat timeline: {len(timeline)} buckets, {total_threats} total threats")

            return jsonify({
                'status': 'success',
                'range': time_range,
                'total_threats': total_threats,
                'timeline': timeline
            })

        except Exception as e:
            exception("Failed to fetch threat timeline: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Failed to fetch threat timeline: {str(e)}'
            }), 500

    @app.route('/api/threats/dashboard')
    @limiter.limit("600 per hour")
    @login_required
    def threats_dashboard():
        """API endpoint for comprehensive threat dashboard data (Insights page)

        v1.0.17: New multi-panel threat dashboard with:
        - Rate-based timeline (threats per time bucket)
        - Severity breakdown (critical/high/medium counts per bucket)
        - Top threat sources (source IPs)
        - Action effectiveness (blocked vs allowed)
        - Threat categories

        Query params:
            device_id: Device identifier
            range: Time range (1h, 6h, 24h, 7d, 30d) - default 6h

        Returns:
            JSON with comprehensive threat analytics data
        """
        debug("=== Threats Dashboard API endpoint called ===")

        # Get device ID from request or settings
        device_id = request.args.get('device_id')
        if not device_id or device_id.strip() == '':
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')

        if not device_id or device_id.strip() == '':
            return jsonify({
                'status': 'error',
                'message': 'No device selected'
            }), 400

        # Parse time range
        time_range = request.args.get('range', '6h')

        # Map range to hours and bucket size
        range_config = {
            '1h':  {'hours': 1,   'bucket_minutes': 5},
            '6h':  {'hours': 6,   'bucket_minutes': 10},
            '24h': {'hours': 24,  'bucket_minutes': 30},
            '7d':  {'hours': 168, 'bucket_minutes': 180},
            '30d': {'hours': 720, 'bucket_minutes': 720}
        }

        config = range_config.get(time_range, range_config['6h'])
        hours = config['hours']
        bucket_minutes = config['bucket_minutes']

        debug(f"Fetching threat dashboard: device={device_id}, range={time_range}, hours={hours}")

        try:
            from throughput_storage_timescale import TimescaleStorage
            from config import TIMESCALE_DSN

            storage = TimescaleStorage(TIMESCALE_DSN)

            # Get comprehensive threat dashboard data
            dashboard_data = storage.get_threat_dashboard(device_id, hours, bucket_minutes)

            debug(f"Threat dashboard loaded: {dashboard_data['total_threats']} total threats")

            return jsonify({
                'status': 'success',
                'range': time_range,
                **dashboard_data
            })

        except Exception as e:
            exception("Failed to fetch threat dashboard: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Failed to fetch threat dashboard: {str(e)}'
            }), 500
