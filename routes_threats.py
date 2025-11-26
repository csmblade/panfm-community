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
        settings = load_settings()
        device_id = settings.get('selected_device_id', '')

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
