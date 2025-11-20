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

    @app.route('/api/throughput')
    @limiter.limit("600 per hour")  # Support auto-refresh (configurable interval)
    @login_required
    def throughput():
        """API endpoint for throughput data (reads from database, not firewall)

        Query parameters:
            range (optional): Time range for historical data (1m, 5m, 30m, 1h, 6h, 24h, 7d, 30d)
                             If not specified, returns latest real-time sample
        """
        from throughput_collector import get_collector, init_collector
        from config import TIMESCALE_DSN

        # Check if range parameter is provided for historical data
        time_range = request.args.get('range')

        debug(f"=== Throughput API endpoint called (database-first, range={time_range}) ===")
        settings = load_settings()
        device_id = settings.get('selected_device_id', '')
        refresh_interval = settings.get('refresh_interval', 60)

        # If no device selected, auto-select the first enabled device
        if not device_id or device_id.strip() == '':
            from device_manager import device_manager
            devices = device_manager.load_devices()
            enabled_devices = [d for d in devices if d.get('enabled', True)]
            if enabled_devices:
                device_id = enabled_devices[0].get('id')
                debug(f"No device selected, auto-selected first enabled device: {device_id}")
            else:
                debug("No enabled devices found")
                # Return user-friendly error instead of HTTP 500
                return jsonify({
                    'status': 'error',
                    'message': 'No devices configured. Please add a device in Managed Devices.'
                }), 400

        # Final validation - ensure device_id is not blank after auto-selection
        if not device_id or device_id.strip() == '':
            return jsonify({
                'status': 'error',
                'message': 'No device selected. Please select a device from the dropdown.'
            }), 400

        debug(f"Using device ID: {device_id}")
        debug(f"Refresh interval: {refresh_interval}s")

        try:
            # Lazy initialization: Initialize collector in worker process if not already initialized
            # This fixes the Gunicorn forking issue where global variables aren't inherited
            collector = get_collector()
            if collector is None:
                retention_days = settings.get('throughput_retention_days', 90)
                if settings.get('throughput_collection_enabled', True):
                    debug("Lazy-initializing collector in worker process (Gunicorn fork fix)")
                    collector = init_collector(None, retention_days)  # db_path unused in v2.0.0
                else:
                    debug("Throughput collection disabled in settings")

            # Get collector and storage (shared across all threads in gthread worker)
            if collector is None:
                # Graceful degradation: Return waiting status instead of error (v1.14.0)
                warning("Throughput collection not initialized - returning waiting status")
                return jsonify({
                    'status': 'waiting',
                    'message': 'Waiting for first data collection (refresh in 30 seconds)',
                    'timestamp': dt_module.datetime.utcnow().isoformat() + 'Z',
                    'inbound_mbps': 0,
                    'outbound_mbps': 0,
                    'total_mbps': 0,
                    'inbound_pps': 0,
                    'outbound_pps': 0,
                    'total_pps': 0,
                    'sessions': {'active': 0, 'tcp': 0, 'udp': 0, 'icmp': 0},
                    'cpu': {'data_plane_cpu': 0, 'mgmt_plane_cpu': 0, 'memory_used_pct': 0},
                    'retry_after_seconds': 30
                }), 200  # Return HTTP 200, not 503!

            storage = collector.storage

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

                # Try auto-select first enabled device
                if not device_id or device_id.strip() == '':
                    from device_manager import device_manager
                    devices = device_manager.load_devices()
                    enabled_devices = [d for d in devices if d.get('enabled', True)]
                    if enabled_devices:
                        device_id = enabled_devices[0].get('id')
                        debug(f"Auto-selected first enabled device: {device_id}")

                # Final validation
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
                from throughput_storage_timescale import TimescaleStorage
                from config import TIMESCALE_DSN
                storage = TimescaleStorage(TIMESCALE_DSN)
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

            # Data available - return success with samples
            return jsonify({
                'status': 'success',
                'device_id': device_id,
                'start_time': start_time.isoformat(),
                'end_time': now.isoformat(),
                'resolution': resolution,
                'sample_count': len(samples),
                'samples': samples
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

                # Try auto-select first enabled device
                if not device_id or device_id.strip() == '':
                    from device_manager import device_manager
                    devices = device_manager.load_devices()
                    enabled_devices = [d for d in devices if d.get('enabled', True)]
                    if enabled_devices:
                        device_id = enabled_devices[0].get('id')
                        debug(f"Auto-selected first enabled device: {device_id}")

                # Final validation
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
                from throughput_storage_timescale import TimescaleStorage
                from config import TIMESCALE_DSN
                storage = TimescaleStorage(TIMESCALE_DSN)
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

                # Try auto-select first enabled device
                if not device_id or device_id.strip() == '':
                    from device_manager import device_manager
                    devices = device_manager.load_devices()
                    enabled_devices = [d for d in devices if d.get('enabled', True)]
                    if enabled_devices:
                        device_id = enabled_devices[0].get('id')
                        debug(f"Auto-selected first enabled device: {device_id}")

                # Final validation
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
                from throughput_storage_timescale import TimescaleStorage
                from config import TIMESCALE_DSN
                storage = TimescaleStorage(TIMESCALE_DSN)
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

                # Try auto-select first enabled device
                if not device_id or device_id.strip() == '':
                    from device_manager import device_manager
                    devices = device_manager.load_devices()
                    enabled_devices = [d for d in devices if d.get('enabled', True)]
                    if enabled_devices:
                        device_id = enabled_devices[0].get('id')
                        debug(f"Auto-selected first enabled device: {device_id}")

                # Final validation
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

            # Get collector and query data
            collector = get_collector()
            if not collector:
                # Fallback: create storage directly for read-only queries
                debug("Collector not initialized, using direct storage access")
                from throughput_storage_timescale import TimescaleStorage
                from config import TIMESCALE_DSN
                storage = TimescaleStorage(TIMESCALE_DSN)
            else:
                storage = collector.storage

            samples = storage.query_samples(
                device_id=device_id,
                start_time=start_time,
                end_time=now,
                resolution='raw'  # Always use raw for accurate client aggregation
            )

            debug(f"Retrieved {len(samples)} samples for client aggregation")

            # Aggregate clients across all samples
            client_data = {}  # {ip: {'total_mb': X, 'count': Y, 'first_seen': Z, 'last_seen': W, 'hostname': H}}

            for sample in samples:
                # Determine which JSON field to use based on filter
                if filter_type == 'internal':
                    client_json_field = 'top_internal_client_json'
                elif filter_type == 'internet':
                    client_json_field = 'top_internet_client_json'
                else:  # 'all'
                    client_json_field = 'top_bandwidth_client_json'

                client_json = sample.get(client_json_field)
                if not client_json:
                    continue

                try:
                    client_info = json.loads(client_json) if isinstance(client_json, str) else client_json
                    if not client_info:
                        continue

                    ip = client_info.get('ip', 'Unknown')
                    hostname = client_info.get('hostname', ip)
                    mb = client_info.get('total_mb', 0)

                    if ip not in client_data:
                        client_data[ip] = {
                            'ip': ip,
                            'hostname': hostname,
                            'total_mb': 0,
                            'count': 0,
                            'first_seen': sample.get('timestamp'),
                            'last_seen': sample.get('timestamp')
                        }

                    client_data[ip]['total_mb'] += mb
                    client_data[ip]['count'] += 1
                    client_data[ip]['last_seen'] = sample.get('timestamp')

                except (json.JSONDecodeError, TypeError) as e:
                    debug(f"Failed to parse client JSON: {e}")
                    continue

            # Convert to list and calculate averages
            clients_list = []
            for ip, data in client_data.items():
                avg_mbps = (data['total_mb'] / data['count']) if data['count'] > 0 else 0
                clients_list.append({
                    'ip': data['ip'],
                    'hostname': data['hostname'],
                    'total_mb': round(data['total_mb'], 2),
                    'avg_mbps': round(avg_mbps, 2),
                    'sample_count': data['count'],
                    'first_seen': data['first_seen'],
                    'last_seen': data['last_seen']
                })

            # Sort by total_mb descending and take top 10
            clients_list.sort(key=lambda x: x['total_mb'], reverse=True)
            top_clients = clients_list[:10]

            debug(f"Aggregated {len(client_data)} unique clients, returning top {len(top_clients)}")

            return jsonify({
                'status': 'success',
                'device_id': device_id,
                'time_range': time_range,
                'filter_type': filter_type,
                'start_time': start_time.isoformat(),
                'end_time': now.isoformat(),
                'total_clients': len(client_data),
                'top_clients': top_clients
            })

        except Exception as e:
            exception(f"Failed to retrieve top clients: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

    debug("Throughput routes registered successfully")
