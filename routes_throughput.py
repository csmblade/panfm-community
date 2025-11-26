"""
Flask route handlers for throughput data and history
Handles throughput metrics, historical data queries, exports, and statistics
"""
from flask import jsonify, request, Response
import datetime as dt_module
from datetime import timedelta
import io
import csv
from auth import login_required
from config import load_settings
from logger import debug, exception, warning


def register_throughput_routes(app, csrf, limiter):
    """Register throughput data and history routes"""
    debug("Registering throughput routes")

    # ============================================================================
    # PHASE 3: Singleton TimescaleStorage Instance Caching
    # ============================================================================
    # Reuse single TimescaleStorage instance across all requests instead of
    # creating new connections every time. Reduces connection overhead significantly.
    _storage_instance = None

    def get_storage():
        """Get or create singleton TimescaleStorage instance"""
        nonlocal _storage_instance
        if _storage_instance is None:
            from throughput_storage_timescale import TimescaleStorage
            from config import TIMESCALE_DSN
            _storage_instance = TimescaleStorage(TIMESCALE_DSN)
            debug("Created singleton TimescaleStorage instance")
        return _storage_instance

    @app.route('/api/throughput')
    @limiter.limit("600 per hour")  # Support auto-refresh (configurable interval)
    @login_required
    def throughput():
        """API endpoint for throughput data (reads from database, not firewall)

        Query parameters:
            range (optional): Time range for historical data (1m, 5m, 30m, 1h, 6h, 24h, 7d, 30d)
                             If not specified, returns latest real-time sample
        """
        # v2.0.0: Direct TimescaleDB query - NO collector needed in web process
        # Phase 3: Using singleton storage instance (see get_storage() above)

        # Check if range parameter is provided for historical data
        time_range = request.args.get('range')

        debug(f"=== Throughput API endpoint called (database-first, range={time_range}) ===")
        settings = load_settings()
        device_id = settings.get('selected_device_id', '')
        refresh_interval = settings.get('refresh_interval', 60)

        # v1.0.5: DO NOT auto-select device here - that causes race conditions!
        # Device selection is ONLY handled by frontend initializeCurrentDevice() in app.js
        # If no device is selected, return a clear error for the frontend to handle
        if not device_id or device_id.strip() == '':
            debug("No device selected in settings")
            return jsonify({
                'status': 'error',
                'message': 'No device selected. Please select a device from the dropdown.'
            }), 400

        debug(f"Using device ID: {device_id}")
        debug(f"Refresh interval: {refresh_interval}s")

        try:
            # v2.0.0 Architecture: Web process queries TimescaleDB directly (read-only)
            # Clock process (clock.py) handles all data collection and writes
            # NO collector initialization needed here - just query the database
            storage = get_storage()  # Phase 3: Use singleton instance

            # NOTE: Threat data removed - now handled by separate /api/threats endpoint
            # Throughput endpoint is ONLY for network throughput metrics
            # This keeps concerns separated and prevents time range confusion

            # Get latest sample from database (use 2x refresh_interval as max age)
            max_age_seconds = refresh_interval * 2
            latest_sample = storage.get_latest_sample(device_id, max_age_seconds=max_age_seconds)

            if latest_sample is None:
                debug("No recent throughput data in database, returning no_data status")
                # Return no_data status instead of zeros (collector may be starting up or collection failed)
                return jsonify({
                    'status': 'no_data',
                    'message': 'No recent data available from collector',
                    'timestamp': None,
                    'inbound_mbps': None,
                    'outbound_mbps': None,
                    'total_mbps': None,
                    'inbound_pps': None,
                    'outbound_pps': None,
                    'total_pps': None,
                    'sessions': None,
                    'cpu': None,
                    'note': 'Waiting for collector data or collection failed'
                })

            debug(f"Returning latest sample from database: {latest_sample['timestamp']}")
            # Add status field for frontend compatibility
            latest_sample['status'] = 'success'

            # Ensure all numeric fields have valid values (convert None to 0)
            numeric_fields = [
                'inbound_mbps', 'outbound_mbps', 'total_mbps',
                'inbound_pps', 'outbound_pps', 'total_pps'
            ]
            for field in numeric_fields:
                if latest_sample.get(field) is None:
                    latest_sample[field] = 0
                # Also convert to float to ensure it's a number
                latest_sample[field] = float(latest_sample[field]) if latest_sample[field] is not None else 0.0

            # DEBUG: Log what we're sending to frontend
            import sys
            sys.stderr.write(f"\n[THROUGHPUT API] Returning to frontend:\n")
            sys.stderr.write(f"  inbound_mbps: {latest_sample.get('inbound_mbps')} (type: {type(latest_sample.get('inbound_mbps')).__name__})\n")
            sys.stderr.write(f"  outbound_mbps: {latest_sample.get('outbound_mbps')} (type: {type(latest_sample.get('outbound_mbps')).__name__})\n")
            sys.stderr.write(f"  total_mbps: {latest_sample.get('total_mbps')} (type: {type(latest_sample.get('total_mbps')).__name__})\n")
            sys.stderr.flush()

            # Ensure nested objects exist with defaults and sanitize their values
            if not latest_sample.get('sessions'):
                latest_sample['sessions'] = {}
            sessions = latest_sample['sessions']
            sessions['active'] = int(sessions.get('active') or 0)
            sessions['tcp'] = int(sessions.get('tcp') or 0)
            sessions['udp'] = int(sessions.get('udp') or 0)
            sessions['icmp'] = int(sessions.get('icmp') or 0)

            if not latest_sample.get('cpu'):
                latest_sample['cpu'] = {}
            cpu = latest_sample['cpu']
            cpu['data_plane_cpu'] = float(cpu.get('data_plane_cpu') or 0)
            cpu['mgmt_plane_cpu'] = float(cpu.get('mgmt_plane_cpu') or 0)
            cpu['memory_used_pct'] = float(cpu.get('memory_used_pct') or 0)

            # Ensure threats object exists with defaults and sanitize values
            # (Skip sanitization if we're in historical mode - already populated above)
            if not time_range:
                if not latest_sample.get('threats'):
                    latest_sample['threats'] = {}
                threats = latest_sample['threats']
                threats['critical_threats'] = int(threats.get('critical_threats') or threats.get('critical') or 0)
                threats['medium_threats'] = int(threats.get('medium_threats') or threats.get('medium') or 0)
                threats['blocked_urls'] = int(threats.get('blocked_urls') or 0)
                threats['critical_logs'] = threats.get('critical_logs') or []
                threats['medium_logs'] = threats.get('medium_logs') or []
                threats['blocked_url_logs'] = threats.get('blocked_url_logs') or []

            # ============================================================================
            # ANALYTICS: Top Category & Top Clients (Dashboard Tiles)
            # Query aggregated data from analytics tables (last 60 minutes)
            # ============================================================================

            # Top Category for LAN traffic (excludes private-ip-addresses)
            top_category_lan = storage.get_top_category(device_id, traffic_type='lan', minutes=60)
            if top_category_lan:
                latest_sample['top_category_lan'] = top_category_lan
                debug(f"Top LAN category: {top_category_lan['category']} ({top_category_lan['bytes_total']/1_000_000:.2f} MB)")

            # Top Category for Internet traffic
            top_category_internet = storage.get_top_category(device_id, traffic_type='internet', minutes=60)
            if top_category_internet:
                latest_sample['top_category_internet'] = top_category_internet
                debug(f"Top Internet category: {top_category_internet['category']} ({top_category_internet['bytes_total']/1_000_000:.2f} MB)")

            # Top Internal Client (internal-only traffic)
            top_internal_client = storage.get_top_client(device_id, traffic_type='internal', minutes=60)
            if top_internal_client:
                latest_sample['top_internal_client'] = top_internal_client
                debug(f"Top internal client: {top_internal_client['ip']} ({top_internal_client.get('hostname', 'Unknown')}) - {top_internal_client['bytes_total']/1_000_000:.2f} MB")

            # Top Internet Client (internet-bound traffic)
            top_internet_client = storage.get_top_client(device_id, traffic_type='internet', minutes=60)
            if top_internet_client:
                latest_sample['top_internet_client'] = top_internet_client
                debug(f"Top internet client: {top_internet_client['ip']} ({top_internet_client.get('hostname', 'Unknown')}) - {top_internet_client['bytes_total']/1_000_000:.2f} MB")

            # ============================================================================
            # CPU TEMPERATURE: From database (collected by throughput_collector)
            # Phase 2: Read from database instead of direct firewall API call
            # ============================================================================
            # CPU temp is already in latest_sample from database query above
            if latest_sample.get('cpu_temp') is not None:
                debug(f"CPU Temperature (from database): {latest_sample.get('cpu_temp')}°C / {latest_sample.get('cpu_temp_max')}°C (alarm: {latest_sample.get('cpu_temp_alarm', False)})")
            else:
                # Fallback if not yet collected: add null values
                latest_sample['cpu_temp'] = None
                latest_sample['cpu_temp_max'] = None
                latest_sample['cpu_temp_alarm'] = False
                debug("CPU temperature not yet collected by throughput_collector")

            return jsonify(latest_sample)

        except Exception as e:
            exception(f"Failed to retrieve throughput from database: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Failed to retrieve throughput data: {str(e)}',
                'timestamp': dt_module.datetime.utcnow().isoformat() + 'Z',  # Add current timestamp
                'inbound_mbps': 0,
                'outbound_mbps': 0,
                'total_mbps': 0,
                'inbound_pps': 0,
                'outbound_pps': 0,
                'total_pps': 0,
                'sessions': {'active': 0, 'tcp': 0, 'udp': 0, 'icmp': 0},
                'cpu': {'data_plane_cpu': 0, 'mgmt_plane_cpu': 0, 'memory_used_pct': 0}
            }), 500

    @app.route('/api/throughput/history')
    @limiter.limit("600 per hour")  # Support frequent queries for historical data
    @login_required
    def throughput_history():
        """API endpoint for historical throughput data"""
        from throughput_collector import get_collector

        debug("=== Throughput History API endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            time_range = request.args.get('range', '24h')  # Default: 24 hours
            resolution = request.args.get('resolution', 'auto')  # auto, raw, hourly, daily

            # Validate device_id (check for None, empty string, or whitespace)
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id', '')

                # v1.0.5: DO NOT auto-select device here - that causes race conditions!
                # Device selection is ONLY handled by frontend initializeCurrentDevice() in app.js
                if not device_id or device_id.strip() == '':
                    return jsonify({
                        'status': 'error',
                        'message': 'No device selected. Please select a device from the dropdown.'
                    }), 400

            debug(f"Query params: device_id={device_id}, range={time_range}, resolution={resolution}")

            # Parse time range
            now = dt_module.datetime.utcnow()
            range_map = {
                '1m': timedelta(minutes=1),
                '5m': timedelta(minutes=5),
                '15m': timedelta(minutes=15),
                '30m': timedelta(minutes=30),
                '60m': timedelta(minutes=60),
                '1h': timedelta(hours=1),
                '6h': timedelta(hours=6),
                '24h': timedelta(hours=24),
                '7d': timedelta(days=7),
                '30d': timedelta(days=30),
                '90d': timedelta(days=90)
            }

            if time_range in range_map:
                start_time = now - range_map[time_range]
            else:
                # Try to parse as custom range (ISO format)
                try:
                    start_time = dt_module.datetime.fromisoformat(request.args.get('start'))
                    end_time = dt_module.datetime.fromisoformat(request.args.get('end'))
                    now = end_time
                except (ValueError, TypeError):
                    return jsonify({'status': 'error', 'message': 'Invalid time range'}), 400

            # Auto-determine resolution based on time range
            if resolution == 'auto':
                time_delta = now - start_time
                if time_delta <= timedelta(hours=6):
                    resolution = 'raw'  # Raw data for short ranges
                elif time_delta <= timedelta(days=7):
                    resolution = 'hourly'  # Hourly for week
                else:
                    resolution = 'daily'  # Daily for longer periods
                debug(f"Auto-selected resolution: {resolution} for range {time_delta}")

            # Get collector and query data
            collector = get_collector()
            if not collector:
                # Fallback: create storage directly for read-only queries
                # This is needed because web process doesn't have collector initialized
                debug("Collector not initialized, using direct storage access")
                # Phase 3: Using singleton storage instance
                storage = get_storage()  # Phase 3: Use singleton instance
            else:
                storage = collector.storage

            samples = storage.query_samples(
                device_id=device_id,
                start_time=start_time,
                end_time=now,
                resolution=resolution
            )

            debug(f"Retrieved {len(samples)} samples for device {device_id}")

            # Fixed v1.14.1: Return success with empty samples instead of 'no_data'
            # This prevents frontend from entering infinite retry loop when time range
            # is longer than collection period (e.g., requesting 7 days when only 1 day collected)
            if len(samples) == 0:
                debug(f"No samples found for time range {time_range} - returning empty success response")

                return jsonify({
                    'status': 'success',  # Changed from 'no_data' to 'success'
                    'device_id': device_id,
                    'start_time': start_time.isoformat(),
                    'end_time': now.isoformat(),
                    'resolution': resolution,
                    'sample_count': 0,
                    'samples': [],
                    'message': f'No data available for the selected time range ({time_range}). Try a shorter time range or wait for more data collection.'
                })

            # Data available - transform samples to match frontend expectations
            # Frontend expects nested objects: sessions{}, cpu{}, and fields: threats, interface_errors
            transformed_samples = []
            for sample in samples:
                # Create nested sessions object
                sessions_obj = {
                    'active': sample.get('sessions_active', 0),
                    'tcp': sample.get('sessions_tcp', 0),
                    'udp': sample.get('sessions_udp', 0),
                    'icmp': sample.get('sessions_icmp', 0)
                }

                # Create nested cpu object
                cpu_obj = {
                    'data_plane_cpu': sample.get('cpu_data_plane', 0),
                    'mgmt_plane_cpu': sample.get('cpu_mgmt_plane', 0),
                    'memory_used_pct': sample.get('memory_used_pct', 0)
                }

                # Build transformed sample
                transformed = {
                    'timestamp': sample.get('timestamp'),
                    'total_mbps': sample.get('total_mbps', 0),
                    'inbound_mbps': sample.get('inbound_mbps', 0),
                    'outbound_mbps': sample.get('outbound_mbps', 0),
                    'internal_mbps': sample.get('internal_mbps', 0),
                    'internet_mbps': sample.get('internet_mbps', 0),
                    'sessions': sessions_obj,
                    'cpu': cpu_obj,
                    'threats': sample.get('threats_count', 0),  # Real data from threat_logs
                    'interface_errors': sample.get('interface_errors', 0)  # Real data from firewall API
                }

                transformed_samples.append(transformed)

            debug(f"Transformed {len(transformed_samples)} samples with nested objects for frontend")

            return jsonify({
                'status': 'success',
                'device_id': device_id,
                'start_time': start_time.isoformat(),
                'end_time': now.isoformat(),
                'resolution': resolution,
                'sample_count': len(transformed_samples),
                'samples': transformed_samples
            })

        except Exception as e:
            exception(f"Failed to retrieve throughput history: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/throughput/history/export')
    @limiter.limit("100 per hour")  # Lower limit for export operations
    @login_required
    def throughput_history_export():
        """Export historical throughput data to CSV"""
        from throughput_collector import get_collector

        debug("=== Throughput History Export API endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            time_range = request.args.get('range', '24h')

            # Validate device_id (check for None, empty string, or whitespace)
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id', '')

                # v1.0.5: DO NOT auto-select device here - that causes race conditions!
                # Device selection is ONLY handled by frontend initializeCurrentDevice() in app.js
                if not device_id or device_id.strip() == '':
                    return jsonify({
                        'status': 'error',
                        'message': 'No device selected. Please select a device from the dropdown.'
                    }), 400

            # Parse time range
            now = dt_module.datetime.utcnow()
            range_map = {
                '1m': timedelta(minutes=1),
                '5m': timedelta(minutes=5),
                '15m': timedelta(minutes=15),
                '30m': timedelta(minutes=30),
                '60m': timedelta(minutes=60),
                '1h': timedelta(hours=1),
                '6h': timedelta(hours=6),
                '24h': timedelta(hours=24),
                '7d': timedelta(days=7),
                '30d': timedelta(days=30),
                '90d': timedelta(days=90)
            }

            if time_range in range_map:
                start_time = now - range_map[time_range]
            else:
                return jsonify({'status': 'error', 'message': 'Invalid time range'}), 400

            # Get collector and query data
            collector = get_collector()
            if not collector:
                # Fallback: create storage directly for read-only queries
                debug("Collector not initialized, using direct storage access for export")
                # Phase 3: Using singleton storage instance
                storage = get_storage()  # Phase 3: Use singleton instance
            else:
                storage = collector.storage

            samples = storage.query_samples(
                device_id=device_id,
                start_time=start_time,
                end_time=now,
                resolution='raw'  # Always export raw data
            )

            # Create CSV in memory
            output = io.StringIO()
            writer = csv.writer(output)

            # Write header
            writer.writerow([
                'Timestamp', 'Inbound (Mbps)', 'Outbound (Mbps)', 'Total (Mbps)',
                'Inbound (PPS)', 'Outbound (PPS)', 'Total (PPS)',
                'Active Sessions', 'TCP Sessions', 'UDP Sessions', 'ICMP Sessions',
                'Data Plane CPU (%)', 'Mgmt Plane CPU (%)', 'Memory Used (%)'
            ])

            # Write data rows
            for sample in samples:
                writer.writerow([
                    sample['timestamp'],
                    sample.get('inbound_mbps', ''),
                    sample.get('outbound_mbps', ''),
                    sample.get('total_mbps', ''),
                    sample.get('inbound_pps', ''),
                    sample.get('outbound_pps', ''),
                    sample.get('total_pps', ''),
                    sample.get('sessions', {}).get('active', ''),
                    sample.get('sessions', {}).get('tcp', ''),
                    sample.get('sessions', {}).get('udp', ''),
                    sample.get('sessions', {}).get('icmp', ''),
                    sample.get('cpu', {}).get('data_plane_cpu', ''),
                    sample.get('cpu', {}).get('mgmt_plane_cpu', ''),
                    sample.get('cpu', {}).get('memory_used_pct', '')
                ])

            # Create response
            output.seek(0)
            filename = f"throughput_export_{device_id}_{time_range}_{dt_module.datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

            return Response(
                output.getvalue(),
                mimetype='text/csv',
                headers={'Content-Disposition': f'attachment; filename={filename}'}
            )

        except Exception as e:
            exception(f"Failed to export throughput history: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/throughput/history/stats')
    @limiter.limit("600 per hour")  # Same as history endpoint
    @login_required
    def throughput_history_stats():
        """Get statistics (min/max/avg) for historical throughput data"""
        from throughput_collector import get_collector

        debug("=== Throughput History Stats API endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            time_range = request.args.get('range', '24h')

            # Validate device_id (check for None, empty string, or whitespace)
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id', '')

                # v1.0.5: DO NOT auto-select device here - that causes race conditions!
                # Device selection is ONLY handled by frontend initializeCurrentDevice() in app.js
                if not device_id or device_id.strip() == '':
                    return jsonify({
                        'status': 'error',
                        'message': 'No device selected. Please select a device from the dropdown.'
                    }), 400

            # Parse time range
            now = dt_module.datetime.utcnow()
            range_map = {
                '1m': timedelta(minutes=1),
                '5m': timedelta(minutes=5),
                '15m': timedelta(minutes=15),
                '30m': timedelta(minutes=30),
                '60m': timedelta(minutes=60),
                '1h': timedelta(hours=1),
                '6h': timedelta(hours=6),
                '24h': timedelta(hours=24),
                '7d': timedelta(days=7),
                '30d': timedelta(days=30),
                '90d': timedelta(days=90)
            }

            if time_range in range_map:
                start_time = now - range_map[time_range]
            else:
                return jsonify({'status': 'error', 'message': 'Invalid time range'}), 400

            # Get collector and query data
            collector = get_collector()
            if not collector:
                # Fallback: create storage directly for read-only queries
                debug("Collector not initialized, using direct storage access for stats")
                # Phase 3: Using singleton storage instance
                storage = get_storage()  # Phase 3: Use singleton instance
            else:
                storage = collector.storage

            samples = storage.query_samples(
                device_id=device_id,
                start_time=start_time,
                end_time=now,
                resolution='raw'
            )

            if not samples:
                return jsonify({
                    'status': 'success',
                    'device_id': device_id,
                    'time_range': time_range,
                    'sample_count': 0,
                    'stats': None
                })

            # Calculate statistics
            inbound_values = [s.get('inbound_mbps', 0) for s in samples if s.get('inbound_mbps') is not None]
            outbound_values = [s.get('outbound_mbps', 0) for s in samples if s.get('outbound_mbps') is not None]
            total_values = [s.get('total_mbps', 0) for s in samples if s.get('total_mbps') is not None]

            stats = {
                'inbound_mbps': {
                    'min': round(min(inbound_values), 2) if inbound_values else 0,
                    'max': round(max(inbound_values), 2) if inbound_values else 0,
                    'avg': round(sum(inbound_values) / len(inbound_values), 2) if inbound_values else 0
                },
                'outbound_mbps': {
                    'min': round(min(outbound_values), 2) if outbound_values else 0,
                    'max': round(max(outbound_values), 2) if outbound_values else 0,
                    'avg': round(sum(outbound_values) / len(outbound_values), 2) if outbound_values else 0
                },
                'total_mbps': {
                    'min': round(min(total_values), 2) if total_values else 0,
                    'max': round(max(total_values), 2) if total_values else 0,
                    'avg': round(sum(total_values) / len(total_values), 2) if total_values else 0
                }
            }

            return jsonify({
                'status': 'success',
                'device_id': device_id,
                'time_range': time_range,
                'sample_count': len(samples),
                'stats': stats
            })

        except Exception as e:
            exception(f"Failed to retrieve throughput statistics: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/analytics/top-clients')
    @limiter.limit("600 per hour")  # Same as history endpoint
    @login_required
    def analytics_top_clients():
        """Get top bandwidth clients aggregated over time range"""
        from throughput_collector import get_collector
        import json

        debug("=== Analytics Top Clients API endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            time_range = request.args.get('range', '24h')
            filter_type = request.args.get('filter', 'all')  # all, internal, internet

            # Validate device_id (check for None, empty string, or whitespace)
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id', '')

                # v1.0.5: DO NOT auto-select device here - that causes race conditions!
                # Device selection is ONLY handled by frontend initializeCurrentDevice() in app.js
                if not device_id or device_id.strip() == '':
                    return jsonify({
                        'status': 'error',
                        'message': 'No device selected. Please select a device from the dropdown.'
                    }), 400

            debug(f"Query params: device_id={device_id}, range={time_range}, filter={filter_type}")

            # Parse time range
            now = dt_module.datetime.utcnow()
            range_map = {
                '1m': timedelta(minutes=1),
                '5m': timedelta(minutes=5),
                '15m': timedelta(minutes=15),
                '30m': timedelta(minutes=30),
                '60m': timedelta(minutes=60),
                '1h': timedelta(hours=1),
                '6h': timedelta(hours=6),
                '24h': timedelta(hours=24),
                '7d': timedelta(days=7),
                '30d': timedelta(days=30),
                '90d': timedelta(days=90)
            }

            if time_range in range_map:
                start_time = now - range_map[time_range]
            else:
                return jsonify({'status': 'error', 'message': 'Invalid time range'}), 400

            # Query client_bandwidth table directly (TimescaleDB enterprise approach)
            # This leverages TimescaleDB aggregates and is 10-100x faster than parsing JSON
            collector = get_collector()
            if not collector:
                # Fallback: create storage directly for read-only queries
                debug("Collector not initialized, using direct storage access")
                # Phase 3: Using singleton storage instance
                storage = get_storage()  # Phase 3: Use singleton instance
            else:
                storage = collector.storage

            # Get TimescaleDB connection
            import psycopg2
            from psycopg2.extras import RealDictCursor
            conn = storage._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            try:
                # Determine traffic_type filter based on filter parameter
                if filter_type == 'internal':
                    traffic_filter = "AND traffic_type = 'internal'"
                elif filter_type == 'internet':
                    traffic_filter = "AND traffic_type = 'internet'"
                else:  # 'all' - sum across all traffic types
                    traffic_filter = ""  # No filter - aggregate across all types

                # Query client_bandwidth hypertable with TimescaleDB aggregation
                # Build query with traffic_filter properly interpolated
                query = '''
                    SELECT
                        client_ip::text AS ip,
                        hostname,
                        custom_name,
                        SUM(bytes_total) AS total_bytes,
                        AVG(bandwidth_mbps) AS avg_mbps,
                        COUNT(*) AS sample_count,
                        MIN(time) AS first_seen,
                        MAX(time) AS last_seen
                    FROM client_bandwidth
                    WHERE device_id = %s
                      AND time >= %s
                      AND time <= %s
                      ''' + traffic_filter + '''
                    GROUP BY client_ip, hostname, custom_name
                    ORDER BY total_bytes DESC
                    LIMIT 10
                '''

                debug(f"Executing top clients query: device_id={device_id}, start={start_time}, end={now}, filter={filter_type}")
                cursor.execute(query, (device_id, start_time, now))
                rows = cursor.fetchall()

                debug(f"Retrieved {len(rows)} top clients from client_bandwidth table")

                # Convert to list format expected by frontend
                clients_list = []
                for row in rows:
                    # Prefer custom_name, fallback to hostname, then IP
                    display_name = row['custom_name'] or row['hostname'] or row['ip']

                    clients_list.append({
                        'ip': row['ip'],
                        'hostname': display_name,  # Use enriched name (custom_name or hostname)
                        'total_mb': round(row['total_bytes'] / 1_000_000, 2),  # Convert bytes to MB
                        'avg_mbps': round(row['avg_mbps'] or 0, 2),
                        'sample_count': row['sample_count'],
                        'first_seen': row['first_seen'].isoformat() + 'Z' if row['first_seen'] else None,
                        'last_seen': row['last_seen'].isoformat() + 'Z' if row['last_seen'] else None
                    })

                top_clients = clients_list
                total_clients = len(rows)

                debug(f"Returning {len(top_clients)} top clients (filter={filter_type})")

            finally:
                cursor.close()
                storage._return_connection(conn)

            return jsonify({
                'status': 'success',
                'device_id': device_id,
                'time_range': time_range,
                'filter_type': filter_type,
                'start_time': start_time.isoformat(),
                'end_time': now.isoformat(),
                'total_clients': total_clients,
                'top_clients': top_clients
            })

        except Exception as e:
            import traceback
            print(f"\n{'='*80}")
            print(f"ERROR IN TOP CLIENTS API")
            print(f"{'='*80}")
            print(f"Exception: {type(e).__name__}: {str(e)}")
            print(f"Traceback:")
            traceback.print_exc()
            print(f"{'='*80}\n")
            exception(f"Failed to retrieve top clients: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/client-destination-flow')
    @limiter.limit("600 per hour")  # Dashboard auto-refresh support
    @login_required
    def client_destination_flow():
        """
        API endpoint for client-to-destination IP flow data for chord diagrams.

        Returns traffic flows showing which clients connect to which destination IPs,
        split into two categories:
        - Internal traffic: Local-to-local flows (both IPs private)
        - Internet traffic: Flows to public destination IPs

        Response format:
        {
            'status': 'success',
            'internal': {
                'nodes': ['client_ip1', 'client_ip2', 'dest_ip1', ...],
                'flows': [
                    {'source': 'client_ip1', 'target': 'dest_ip1', 'value': bytes},
                    ...
                ]
            },
            'internet': {
                'nodes': ['client_ip1', 'client_ip2', 'dest_ip1', ...],
                'flows': [
                    {'source': 'client_ip1', 'target': 'dest_ip1', 'value': bytes},
                    ...
                ]
            }
        }
        """
        debug("=== Client-Destination Flow API endpoint called ===")

        try:
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')

            # v1.0.5: DO NOT auto-select device here - that causes race conditions!
            # Device selection is ONLY handled by frontend initializeCurrentDevice() in app.js
            if not device_id or device_id.strip() == '':
                return jsonify({
                    'status': 'error',
                    'message': 'No device selected. Please select a device from the dropdown.'
                }), 400

            # Get firewall configuration
            from firewall_api import get_firewall_config
            firewall_config = get_firewall_config(device_id)

            if not firewall_config:
                return jsonify({
                    'status': 'error',
                    'message': 'Device configuration not found'
                }), 404

            # Get traffic logs from firewall (last 100 sessions for better sampling)
            from firewall_api_logs import get_traffic_logs
            traffic_data = get_traffic_logs(firewall_config, max_logs=100)

            if traffic_data.get('status') != 'success':
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to retrieve traffic logs'
                }), 500

            traffic_logs = traffic_data.get('logs', [])
            debug(f"Processing {len(traffic_logs)} traffic logs for chord diagram")

            # Helper function to check if IP is private (RFC 1918)
            def is_private_ip(ip):
                if not ip or ip == 'N/A':
                    return False
                try:
                    parts = ip.split('.')
                    if len(parts) != 4:
                        return False
                    first = int(parts[0])
                    second = int(parts[1])
                    return (first == 10 or
                            (first == 172 and 16 <= second <= 31) or
                            (first == 192 and second == 168) or
                            first == 127 or
                            (first == 169 and second == 254))
                except (ValueError, IndexError):
                    return False

            # Aggregate flows by source-destination pairs
            # Internal traffic categories
            rfc1918_flows = {}   # {(src, dst): bytes} - Both private (RFC1918)
            all_flows = {}       # {(src, dst): bytes} - All traffic regardless of IP type
            # Internet traffic categories
            outbound_flows = {}  # {(src, dst): bytes} - Private → Public
            inbound_flows = {}   # {(src, dst): bytes} - Public → Private
            transit_flows = {}   # {(src, dst): bytes} - Public → Public

            for log in traffic_logs:
                src_ip = log.get('src', '')
                dst_ip = log.get('dst', '')
                bytes_total = int(log.get('bytes_sent', 0)) + int(log.get('bytes_received', 0))

                # Skip invalid IPs
                if not src_ip or not dst_ip or src_ip == 'N/A' or dst_ip == 'N/A':
                    continue

                flow_key = (src_ip, dst_ip)

                # Always add to all_flows (for "All Traffic" filter option)
                all_flows[flow_key] = all_flows.get(flow_key, 0) + bytes_total

                # Determine flow category for RFC1918 and internet traffic
                src_private = is_private_ip(src_ip)
                dst_private = is_private_ip(dst_ip)

                if src_private and dst_private:
                    # RFC1918 internal traffic (both IPs private)
                    rfc1918_flows[flow_key] = rfc1918_flows.get(flow_key, 0) + bytes_total
                elif src_private and not dst_private:
                    # Outbound traffic (private source to public destination)
                    outbound_flows[flow_key] = outbound_flows.get(flow_key, 0) + bytes_total
                elif not src_private and dst_private:
                    # Inbound traffic (public source to private destination)
                    inbound_flows[flow_key] = inbound_flows.get(flow_key, 0) + bytes_total
                else:
                    # Transit traffic (both IPs public)
                    transit_flows[flow_key] = transit_flows.get(flow_key, 0) + bytes_total

            # Convert to chord diagram format (nodes + flows) - LIMITED TO TOP 5 SOURCE IPS
            def build_chord_data(flows_dict, direction=None):
                # Aggregate total bytes per source IP
                source_totals = {}
                for (src, dst), bytes_val in flows_dict.items():
                    source_totals[src] = source_totals.get(src, 0) + bytes_val

                # Get top 5 source IPs by total bytes
                top_sources = sorted(source_totals.items(), key=lambda x: x[1], reverse=True)[:5]
                top_source_ips = set([ip for ip, _ in top_sources])

                debug(f"Top 5 source IPs ({direction or 'all'}): {[f'{ip} ({bytes_val:,} bytes)' for ip, bytes_val in top_sources]}")

                # Filter flows to only include top 5 sources
                filtered_flows = {k: v for k, v in flows_dict.items() if k[0] in top_source_ips}

                # Get unique nodes from filtered flows
                nodes = set()
                for (src, dst) in filtered_flows.keys():
                    nodes.add(src)
                    nodes.add(dst)

                # Sort nodes for consistent ordering
                nodes_list = sorted(list(nodes))

                # Build flow list from filtered flows with direction metadata
                flows_list = [
                    {
                        'source': src,
                        'target': dst,
                        'value': value,
                        'direction': direction
                    }
                    for (src, dst), value in filtered_flows.items()
                ]

                # Sort flows by value (descending)
                flows_list.sort(key=lambda x: x['value'], reverse=True)

                return {
                    'nodes': nodes_list,
                    'flows': flows_list
                }

            # Build chord data for internal traffic (RFC1918 and All)
            rfc1918_data = build_chord_data(rfc1918_flows, 'rfc1918')
            all_data = build_chord_data(all_flows, 'all')

            # Build chord data for internet traffic
            outbound_data = build_chord_data(outbound_flows, 'outbound')
            inbound_data = build_chord_data(inbound_flows, 'inbound')
            transit_data = build_chord_data(transit_flows, 'transit')

            debug(f"RFC1918 flows: {len(rfc1918_flows)} pairs, {len(rfc1918_data['nodes'])} nodes")
            debug(f"All flows: {len(all_flows)} pairs, {len(all_data['nodes'])} nodes")
            debug(f"Outbound flows: {len(outbound_flows)} pairs, {len(outbound_data['nodes'])} nodes")
            debug(f"Inbound flows: {len(inbound_flows)} pairs, {len(inbound_data['nodes'])} nodes")
            debug(f"Transit flows: {len(transit_flows)} pairs, {len(transit_data['nodes'])} nodes")

            return jsonify({
                'status': 'success',
                'internal': {
                    'rfc1918': rfc1918_data,
                    'all': all_data
                },
                'internet': {
                    'outbound': outbound_data,
                    'inbound': inbound_data,
                    'transit': transit_data
                }
            })

        except Exception as e:
            import traceback
            exception(f"Failed to retrieve client-destination flow data: {str(e)}")
            traceback.print_exc()
            return jsonify({'status': 'error', 'message': str(e)}), 500

    @app.route('/api/client-destination-flow-by-tag')
    @limiter.limit("600 per hour")
    @login_required
    def client_destination_flow_by_tag():
        """
        Filter traffic flows by device tags (e.g., "IoT", "finance", "employee").

        Query Parameters:
            tags (required): Comma-separated list of tags (e.g., "IoT,camera")
            operator (optional): "AND" or "OR" (default: "OR")
                - OR: Device matches if it has ANY selected tag
                - AND: Device matches only if it has ALL selected tags
            max_logs (optional): Number of traffic logs to fetch (default: 100)

        Returns:
            JSON with filtered flow data for chord diagram:
            {
                'status': 'success',
                'tag_filter': {
                    'nodes': ['192.168.1.10', '8.8.8.8', ...],
                    'flows': [
                        {'source': '192.168.1.10', 'target': '8.8.8.8', 'value': 1234567},
                        ...
                    ]
                },
                'tags': ['IoT', 'camera'],
                'operator': 'OR',
                'matching_devices': 5
            }
        """
        try:
            # 1. Parse query parameters
            tags_param = request.args.get('tags', '')
            operator = request.args.get('operator', 'OR').upper()
            max_logs = int(request.args.get('max_logs', 500))  # Increased from 100 to 500 for better IoT representation

            debug(f"[TAG-FLOW] Request received: tags={tags_param}, operator={operator}, max_logs={max_logs}")

            if not tags_param:
                debug("[TAG-FLOW] No tags specified in request")
                return jsonify({'status': 'error', 'message': 'No tags specified'}), 400

            # Parse comma-separated tags
            tag_filters = [t.strip() for t in tags_param.split(',') if t.strip()]

            if not tag_filters:
                debug("[TAG-FLOW] Empty tag list after parsing")
                return jsonify({'status': 'error', 'message': 'No valid tags specified'}), 400

            debug(f"[TAG-FLOW] Parsed {len(tag_filters)} tags: {tag_filters}")

            # 2. Get selected device ID from settings
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')

            if not device_id:
                debug("[TAG-FLOW] No device selected in settings")
                return jsonify({'status': 'error', 'message': 'No device selected'}), 400

            debug(f"[TAG-FLOW] Using device_id: {device_id}")

            # 3. Get connected devices with metadata using PostgreSQL JOIN (single query!)
            from throughput_storage_timescale import TimescaleStorage
            from config import TIMESCALE_DSN
            from firewall_api import get_firewall_config
            from firewall_api_logs import get_traffic_logs

            storage = get_storage()  # Phase 3: Use singleton instance

            # Single query with JOIN - filters by tags in PostgreSQL
            connected_devices = storage.get_connected_devices_with_metadata(
                device_id=device_id,
                max_age_seconds=300,
                tags=tag_filters,
                tag_operator=operator
            )

            debug(f"[TAG-FLOW] Retrieved {len(connected_devices)} devices with tags {tag_filters} (operator: {operator})")

            # Build set of matching IPs
            matching_ips = set()
            for device in connected_devices:
                matching_ips.add(device['ip'])
                debug(f"[TAG-FLOW] Matched IP {device['ip']} (MAC: {device['mac']}, tags: {device['tags']})")

            if len(matching_ips) == 0:
                debug(f"[TAG-FLOW] No devices found with tags: {tag_filters}")
                return jsonify({
                    'status': 'success',
                    'tag_filter': {'nodes': [], 'flows': []},
                    'tags': tag_filters,
                    'operator': operator,
                    'matching_devices': 0,
                    'message': f'No devices found with tags: {", ".join(tag_filters)}'
                })


            # 5. Get firewall configuration and fetch traffic logs
            firewall_ip, api_key, base_url = get_firewall_config(device_id)

            if not firewall_ip or not api_key:
                debug(f"[TAG-FLOW] Could not retrieve firewall config for device {device_id}")
                return jsonify({'status': 'error', 'message': 'Could not retrieve firewall configuration'}), 500

            debug(f"[TAG-FLOW] Fetching traffic logs (max {max_logs}) from firewall {firewall_ip}")

            # get_traffic_logs expects tuple (firewall_ip, api_key, base_url) and returns list of dicts
            # get_traffic_logs returns dict with {"status": "success", "logs": [...]}
            traffic_data = get_traffic_logs((firewall_ip, api_key, base_url), max_logs=max_logs)
            traffic_logs = traffic_data.get("logs", [])

            # 6. Filter flows where source IP has matching tags
            filtered_flows = {}

            for log in traffic_logs:
                src_ip = log.get('src', '')
                dst_ip = log.get('dst', '')
                bytes_sent = int(log.get('bytes_sent', 0))
                bytes_received = int(log.get('bytes_received', 0))
                bytes_total = bytes_sent + bytes_received

                # Only include flows where source IP matches tag filter
                if src_ip in matching_ips and dst_ip:
                    flow_key = (src_ip, dst_ip)
                    filtered_flows[flow_key] = filtered_flows.get(flow_key, 0) + bytes_total

            debug(f"[TAG-FLOW] Filtered to {len(filtered_flows)} unique flows from tagged devices")

            # 7. Build chord diagram data structure - LIMITED TO TOP 5 SOURCE IPS
            # Aggregate total bytes per source IP
            source_totals = {}
            for (src, dst), bytes_val in filtered_flows.items():
                source_totals[src] = source_totals.get(src, 0) + bytes_val

            # Get top 5 source IPs by total bytes
            top_sources = sorted(source_totals.items(), key=lambda x: x[1], reverse=True)[:5]
            top_source_ips = set([ip for ip, _ in top_sources])

            debug(f"[TAG-FLOW] Top 5 source IPs: {[f'{ip} ({bytes_val:,} bytes)' for ip, bytes_val in top_sources]}")

            # Filter flows to only include top 5 sources
            filtered_flows_top5 = {k: v for k, v in filtered_flows.items() if k[0] in top_source_ips}

            # Get unique nodes from filtered flows
            nodes = set()
            for (src, dst) in filtered_flows_top5.keys():
                nodes.add(src)
                nodes.add(dst)

            nodes_list = sorted(list(nodes))

            # Build flow list from filtered flows
            flows_list = [
                {'source': src, 'target': dst, 'value': value}
                for (src, dst), value in filtered_flows_top5.items()
            ]

            # Sort flows by value (descending)
            flows_list.sort(key=lambda x: x['value'], reverse=True)

            debug(f"[TAG-FLOW] Built chord data: {len(nodes_list)} nodes, {len(flows_list)} flows (top 5 sources)")

            # 8. Return chord diagram data
            return jsonify({
                'status': 'success',
                'tag_filter': {
                    'nodes': nodes_list,
                    'flows': flows_list
                },
                'tags': tag_filters,
                'operator': operator,
                'matching_devices': len(matching_ips)
            })

        except Exception as e:
            import traceback
            exception(f"[TAG-FLOW] Failed to retrieve tag-filtered flow data: {str(e)}")
            traceback.print_exc()
            return jsonify({'status': 'error', 'message': str(e)}), 500

    # ============================================================================
    # ON-DEMAND COLLECTION ENDPOINTS (v1.0.3)
    # Purpose: Trigger immediate data collection when user switches devices
    # Pattern: Web queues request → Clock processes → Web polls status
    # ============================================================================

    @app.route('/api/throughput/collect-now', methods=['POST'])
    @limiter.limit("10 per hour")  # Rate limit: Prevent firewall API abuse
    @csrf.exempt  # CSRF handled by apiClient
    @login_required
    def collect_now():
        """
        Queue immediate throughput collection for a device.

        Called by frontend when user switches devices to reduce wait time
        from 60 seconds (next scheduled collection) to ~5-8 seconds.

        Request body:
            device_id (required): Device UUID to collect data for

        Returns:
            JSON with request_id for status polling:
            {
                'status': 'queued',
                'request_id': 123,
                'message': 'Collection queued, will execute within 5 seconds'
            }
        """
        debug("=== On-Demand Collection Request ===")

        try:
            # Get device_id from request body
            data = request.get_json() or {}
            device_id = data.get('device_id')

            if not device_id or device_id.strip() == '':
                debug("collect-now: Missing device_id in request body")
                return jsonify({
                    'status': 'error',
                    'message': 'device_id is required'
                }), 400

            debug(f"collect-now: Queuing collection for device {device_id}")

            # Create collection request in database queue
            storage = get_storage()
            request_id = storage.create_collection_request(device_id)

            if request_id is None:
                debug(f"collect-now: Failed to create collection request for device {device_id}")
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to queue collection request'
                }), 500

            debug(f"collect-now: Created request {request_id} for device {device_id}")

            return jsonify({
                'status': 'queued',
                'request_id': request_id,
                'message': 'Collection queued, will execute within 5 seconds'
            })

        except Exception as e:
            exception(f"collect-now: Failed to queue collection: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Failed to queue collection: {str(e)}'
            }), 500

    @app.route('/api/throughput/collect-status/<int:request_id>')
    @limiter.limit("120 per minute")  # High rate limit for polling (every 500ms for 10 seconds)
    @login_required
    def collect_status(request_id):
        """
        Check status of an on-demand collection request.

        Called by frontend to poll for collection completion.
        Frontend polls every 500ms for up to 10 seconds.

        Args:
            request_id: Request ID from /api/throughput/collect-now

        Returns:
            JSON with request status:
            {
                'id': 123,
                'device_id': 'device-uuid',
                'status': 'queued|running|completed|failed',
                'requested_at': '2025-01-01T00:00:00+00:00',
                'started_at': '2025-01-01T00:00:01+00:00',  # null if not started
                'completed_at': '2025-01-01T00:00:05+00:00',  # null if not completed
                'error_message': null  # error message if status is 'failed'
            }
        """
        try:
            storage = get_storage()
            result = storage.get_collection_request(request_id)

            if result is None:
                debug(f"collect-status: Request {request_id} not found")
                return jsonify({
                    'status': 'error',
                    'message': f'Request {request_id} not found'
                }), 404

            return jsonify(result)

        except Exception as e:
            exception(f"collect-status: Failed to get status for request {request_id}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Failed to get request status: {str(e)}'
            }), 500

    debug("Throughput routes registered successfully")
