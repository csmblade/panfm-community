"""
Analytics Routes - Category and Application Bandwidth APIs
Provides historical analytics data for Insights page
"""

from flask import Blueprint, request, jsonify
from auth import login_required
from logger import debug, exception
from config import load_settings
from datetime import datetime as dt_module, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor


def register_routes(app, limiter):
    """Register analytics routes with Flask app"""

    @app.route('/api/analytics/categories')
    @limiter.limit("600 per hour")
    @login_required
    def analytics_categories():
        """
        Get top categories by bandwidth over time range.

        Query Parameters:
            device_id (str): Device identifier
            range (str): Time range (1h, 6h, 24h, 7d, 30d, 90d)
            type (str): Traffic type filter ('lan', 'internet', 'all')
            limit (int): Number of top categories to return (default: 10)

        Returns:
            JSON with top categories sorted by total bandwidth
        """
        from throughput_collector import get_collector

        debug("=== Analytics Categories API endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            time_range = request.args.get('range', '24h')
            traffic_type = request.args.get('type', 'all')  # lan, internet, all
            limit = int(request.args.get('limit', 10))

            # Validate device_id
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

            debug(f"Query params: device_id={device_id}, range={time_range}, type={traffic_type}, limit={limit}")

            # Parse time range
            now = dt_module.utcnow()
            range_map = {
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

            # Get storage
            collector = get_collector()
            if not collector:
                debug("Collector not initialized, using direct storage access")
                from throughput_storage_timescale import TimescaleStorage
                from config import TIMESCALE_DSN
                storage = TimescaleStorage(TIMESCALE_DSN)
            else:
                storage = collector.storage

            # Get TimescaleDB connection
            conn = storage._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            try:
                # Determine traffic_type filter
                if traffic_type == 'lan':
                    traffic_filter = "AND traffic_type = 'lan'"
                elif traffic_type == 'internet':
                    traffic_filter = "AND traffic_type = 'internet'"
                else:  # 'all'
                    traffic_filter = ""  # Aggregate across all types

                # Query category_bandwidth hypertable
                query = '''
                    SELECT
                        category,
                        traffic_type,
                        SUM(bytes_total) AS total_bytes,
                        AVG(bandwidth_mbps) AS avg_mbps,
                        SUM(sessions) AS total_sessions,
                        COUNT(*) AS sample_count
                    FROM category_bandwidth
                    WHERE device_id = %s
                      AND time >= %s
                      AND time <= %s
                      ''' + traffic_filter + '''
                    GROUP BY category, traffic_type
                    ORDER BY total_bytes DESC
                    LIMIT %s
                '''

                debug(f"Executing categories query: device_id={device_id}, start={start_time}, end={now}, type={traffic_type}")
                cursor.execute(query, (device_id, start_time, now, limit))
                rows = cursor.fetchall()

                debug(f"Retrieved {len(rows)} top categories from category_bandwidth table")

                # Convert to list format
                categories_list = []
                for row in rows:
                    categories_list.append({
                        'category': row['category'],
                        'traffic_type': row['traffic_type'],
                        'total_mb': round(row['total_bytes'] / 1_000_000, 2),
                        'total_gb': round(row['total_bytes'] / 1_000_000_000, 3),
                        'avg_mbps': round(row['avg_mbps'] or 0, 2),
                        'total_sessions': row['total_sessions'],
                        'sample_count': row['sample_count']
                    })

                return jsonify({
                    'status': 'success',
                    'device_id': device_id,
                    'time_range': time_range,
                    'traffic_type': traffic_type,
                    'start_time': start_time.isoformat() + 'Z',
                    'end_time': now.isoformat() + 'Z',
                    'total_categories': len(categories_list),
                    'top_categories': categories_list
                })

            finally:
                cursor.close()
                storage._return_connection(conn)

        except Exception as e:
            exception(f"Failed to retrieve top categories: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500


    @app.route('/api/analytics/applications')
    @limiter.limit("600 per hour")
    @login_required
    def analytics_applications():
        """
        Get top applications by bandwidth/sessions over time range.

        Query Parameters:
            device_id (str): Device identifier
            range (str): Time range (1h, 6h, 24h, 7d, 30d, 90d)
            limit (int): Number of top applications to return (default: 10)

        Returns:
            JSON with top applications sorted by total bandwidth
        """
        from throughput_collector import get_collector

        debug("=== Analytics Applications API endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            time_range = request.args.get('range', '24h')
            limit = int(request.args.get('limit', 10))

            # Validate device_id
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

            debug(f"Query params: device_id={device_id}, range={time_range}, limit={limit}")

            # Parse time range
            now = dt_module.utcnow()
            range_map = {
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

            # Get storage
            collector = get_collector()
            if not collector:
                debug("Collector not initialized, using direct storage access")
                from throughput_storage_timescale import TimescaleStorage
                from config import TIMESCALE_DSN
                storage = TimescaleStorage(TIMESCALE_DSN)
            else:
                storage = collector.storage

            # Get TimescaleDB connection
            conn = storage._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            try:
                # Query application_samples hypertable
                query = '''
                    SELECT
                        application,
                        category,
                        subcategory,
                        SUM(bytes_total) AS total_bytes,
                        AVG(bandwidth_mbps) AS avg_mbps,
                        SUM(sessions_total) AS total_sessions,
                        SUM(sessions_tcp) AS total_tcp,
                        SUM(sessions_udp) AS total_udp,
                        COUNT(*) AS sample_count,
                        MAX(top_source_hostname) AS top_source
                    FROM application_samples
                    WHERE device_id = %s
                      AND time >= %s
                      AND time <= %s
                    GROUP BY application, category, subcategory
                    ORDER BY total_bytes DESC
                    LIMIT %s
                '''

                debug(f"Executing applications query: device_id={device_id}, start={start_time}, end={now}")
                cursor.execute(query, (device_id, start_time, now, limit))
                rows = cursor.fetchall()

                debug(f"Retrieved {len(rows)} top applications from application_samples table")

                # Convert to list format
                applications_list = []
                for row in rows:
                    applications_list.append({
                        'application': row['application'],
                        'category': row['category'],
                        'subcategory': row['subcategory'],
                        'total_mb': round(row['total_bytes'] / 1_000_000, 2),
                        'total_gb': round(row['total_bytes'] / 1_000_000_000, 3),
                        'avg_mbps': round(row['avg_mbps'] or 0, 2),
                        'total_sessions': row['total_sessions'],
                        'total_tcp': row['total_tcp'],
                        'total_udp': row['total_udp'],
                        'sample_count': row['sample_count'],
                        'top_source': row['top_source']
                    })

                return jsonify({
                    'status': 'success',
                    'device_id': device_id,
                    'time_range': time_range,
                    'start_time': start_time.isoformat() + 'Z',
                    'end_time': now.isoformat() + 'Z',
                    'total_applications': len(applications_list),
                    'top_applications': applications_list
                })

            finally:
                cursor.close()
                storage._return_connection(conn)

        except Exception as e:
            exception(f"Failed to retrieve top applications: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500


    @app.route('/api/analytics/category-trend')
    @limiter.limit("600 per hour")
    @login_required
    def analytics_category_trend():
        """
        Get historical trend data for a specific category.

        Query Parameters:
            device_id (str): Device identifier
            category (str): Category name
            range (str): Time range (1h, 6h, 24h, 7d, 30d, 90d)
            type (str): Traffic type ('lan', 'internet', 'all')

        Returns:
            JSON with time-series data for charting
        """
        from throughput_collector import get_collector

        debug("=== Analytics Category Trend API endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            category = request.args.get('category')
            time_range = request.args.get('range', '24h')
            traffic_type = request.args.get('type', 'all')

            # Validate required parameters
            if not category:
                return jsonify({'status': 'error', 'message': 'Category parameter is required'}), 400

            # Validate device_id
            if not device_id or device_id.strip() == '':
                settings = load_settings()
                device_id = settings.get('selected_device_id', '')

                if not device_id or device_id.strip() == '':
                    from device_manager import device_manager
                    devices = device_manager.load_devices()
                    enabled_devices = [d for d in devices if d.get('enabled', True)]
                    if enabled_devices:
                        device_id = enabled_devices[0].get('id')

                if not device_id or device_id.strip() == '':
                    return jsonify({
                        'status': 'error',
                        'message': 'No device selected'
                    }), 400

            debug(f"Query params: device_id={device_id}, category={category}, range={time_range}, type={traffic_type}")

            # Parse time range
            now = dt_module.utcnow()
            range_map = {
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

            # Get storage
            collector = get_collector()
            if not collector:
                from throughput_storage_timescale import TimescaleStorage
                from config import TIMESCALE_DSN
                storage = TimescaleStorage(TIMESCALE_DSN)
            else:
                storage = collector.storage

            # Get TimescaleDB connection
            conn = storage._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            try:
                # Determine traffic_type filter
                if traffic_type == 'lan':
                    traffic_filter = "AND traffic_type = 'lan'"
                elif traffic_type == 'internet':
                    traffic_filter = "AND traffic_type = 'internet'"
                else:
                    traffic_filter = ""

                # Use hourly aggregates for 7d+ ranges
                if time_range in ['7d', '30d', '90d']:
                    # Query category_bandwidth_hourly continuous aggregate
                    query = '''
                        SELECT
                            bucket AS timestamp,
                            SUM(total_bytes) AS total_bytes,
                            AVG(avg_mbps) AS avg_mbps,
                            SUM(total_sessions) AS total_sessions
                        FROM category_bandwidth_hourly
                        WHERE device_id = %s
                          AND category = %s
                          AND bucket >= %s
                          AND bucket <= %s
                          ''' + traffic_filter + '''
                        GROUP BY bucket
                        ORDER BY bucket ASC
                    '''
                else:
                    # Query raw category_bandwidth for shorter ranges
                    query = '''
                        SELECT
                            time_bucket('5 minutes', time) AS timestamp,
                            SUM(bytes_total) AS total_bytes,
                            AVG(bandwidth_mbps) AS avg_mbps,
                            SUM(sessions) AS total_sessions
                        FROM category_bandwidth
                        WHERE device_id = %s
                          AND category = %s
                          AND time >= %s
                          AND time <= %s
                          ''' + traffic_filter + '''
                        GROUP BY timestamp
                        ORDER BY timestamp ASC
                    '''

                cursor.execute(query, (device_id, category, start_time, now))
                rows = cursor.fetchall()

                debug(f"Retrieved {len(rows)} data points for category '{category}' trend")

                # Convert to time-series format
                trend_data = []
                for row in rows:
                    trend_data.append({
                        'timestamp': row['timestamp'].isoformat() + 'Z',
                        'total_mb': round(row['total_bytes'] / 1_000_000, 2),
                        'avg_mbps': round(row['avg_mbps'] or 0, 2),
                        'total_sessions': row['total_sessions']
                    })

                return jsonify({
                    'status': 'success',
                    'device_id': device_id,
                    'category': category,
                    'traffic_type': traffic_type,
                    'time_range': time_range,
                    'start_time': start_time.isoformat() + 'Z',
                    'end_time': now.isoformat() + 'Z',
                    'data_points': len(trend_data),
                    'trend_data': trend_data
                })

            finally:
                cursor.close()
                storage._return_connection(conn)

        except Exception as e:
            exception(f"Failed to retrieve category trend: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500


    debug("Analytics routes registered successfully")
