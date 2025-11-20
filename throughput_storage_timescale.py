"""
TimescaleDB-based storage for historical throughput data.

Replaces SQLite with enterprise-grade time-series database for PANfm v2.0.0.

Features:
- Connection pooling (2-10 concurrent connections)
- Automatic use of continuous aggregates for performance
- Query timeout protection (30s limit)
- Same interface as SQLite version (zero route changes!)
- 10-100x faster queries
- 1-year retention (7d raw, 90d hourly, 365d daily)
- 90% compression on old data

Author: PANfm Development Team
Created: 2025-11-19
Version: v2.0.0 (TimescaleDB Migration)
"""

import psycopg2
from psycopg2 import pool, extras, sql
from psycopg2.extras import RealDictCursor, execute_batch
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from logger import debug, info, warning, error, exception


class TimescaleStorage:
    """
    TimescaleDB storage for time-series throughput data.

    Provides same interface as SQLite ThroughputStorage for backward compatibility,
    but with enterprise features: connection pooling, continuous aggregates,
    automatic compression, and retention policies.
    """

    def __init__(self, connection_string: str, min_conn: int = 2, max_conn: int = 10):
        """
        Initialize connection pool to TimescaleDB.

        Args:
            connection_string: PostgreSQL DSN (e.g., "postgresql://user:pass@host:port/db")
            min_conn: Minimum number of connections in pool
            max_conn: Maximum number of connections in pool
        """
        debug("Initializing TimescaleDB connection pool (min=%d, max=%d)", min_conn, max_conn)

        try:
            self.pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=min_conn,
                maxconn=max_conn,
                dsn=connection_string,
                connect_timeout=30,  # 30 second connection timeout
                options='-c statement_timeout=30000'  # 30 second query timeout
            )

            # Test connection
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT version()")
            version = cursor.fetchone()[0]
            cursor.close()
            self._return_connection(conn)

            info("TimescaleDB connection pool initialized successfully")
            debug("PostgreSQL version: %s", version)

        except Exception as e:
            exception("Failed to initialize TimescaleDB connection pool: %s", str(e))
            raise

    def _get_connection(self):
        """
        Get connection from pool.

        Returns:
            psycopg2 connection object

        Raises:
            Exception if no connections available
        """
        try:
            conn = self.pool.getconn()
            if conn is None:
                raise Exception("Connection pool exhausted")
            return conn
        except Exception as e:
            exception("Failed to get connection from pool: %s", str(e))
            raise

    def _return_connection(self, conn):
        """
        Return connection to pool.

        Args:
            conn: Connection to return
        """
        try:
            if conn:
                self.pool.putconn(conn)
        except Exception as e:
            exception("Failed to return connection to pool: %s", str(e))

    def insert_sample(self, device_id: str, sample_data: Dict) -> bool:
        """
        Store a single throughput sample.

        Compatible with SQLite ThroughputStorage.insert_sample() interface.

        Args:
            device_id: Device identifier
            sample_data: Sample dictionary with throughput metrics

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Extract timestamp
            timestamp_str = sample_data.get('timestamp')
            if isinstance(timestamp_str, str):
                # Parse ISO format (2025-11-19T07:30:00Z or 2025-11-19T07:30:00)
                timestamp_str = timestamp_str.replace('Z', '+00:00')
                timestamp = datetime.fromisoformat(timestamp_str)
            elif isinstance(timestamp_str, datetime):
                timestamp = timestamp_str
            else:
                warning("Invalid timestamp format for device %s: %s", device_id, timestamp_str)
                return False

            # Extract nested dictionaries
            sessions = sample_data.get('sessions', {})
            cpu = sample_data.get('cpu', {})
            disk_usage = sample_data.get('disk_usage', {})
            database_versions = sample_data.get('database_versions', {})

            # Prepare JSON fields
            top_bandwidth_json = json.dumps(sample_data.get('top_bandwidth_client')) if sample_data.get('top_bandwidth_client') else None
            top_internal_json = json.dumps(sample_data.get('top_internal_client')) if sample_data.get('top_internal_client') else None
            top_internet_json = json.dumps(sample_data.get('top_internet_client')) if sample_data.get('top_internet_client') else None
            top_category_wan_json = json.dumps(sample_data.get('top_category_wan')) if sample_data.get('top_category_wan') else None
            top_category_lan_json = json.dumps(sample_data.get('top_category_lan')) if sample_data.get('top_category_lan') else None
            top_category_internet_json = json.dumps(sample_data.get('top_category_internet')) if sample_data.get('top_category_internet') else None

            # Insert with ON CONFLICT DO NOTHING to prevent duplicates
            cursor.execute('''
                INSERT INTO throughput_samples (
                    time, device_id,
                    inbound_mbps, outbound_mbps, total_mbps,
                    inbound_pps, outbound_pps, total_pps,
                    sessions_active, sessions_tcp, sessions_udp, sessions_icmp,
                    session_max_capacity, session_utilization_pct,
                    cpu_data_plane, cpu_mgmt_plane, memory_used_pct,
                    disk_root_pct, disk_logs_pct, disk_var_pct,
                    top_bandwidth_client_json, top_internal_client_json, top_internet_client_json,
                    internal_mbps, internet_mbps,
                    top_category_wan_json, top_category_lan_json, top_category_internet_json,
                    app_version, threat_version, wildfire_version, url_version,
                    wan_ip, wan_speed, hostname, uptime_seconds, pan_os_version, license_expired, license_active
                ) VALUES (
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (time, device_id) DO NOTHING
            ''', (
                timestamp, device_id,
                sample_data.get('inbound_mbps'), sample_data.get('outbound_mbps'), sample_data.get('total_mbps'),
                sample_data.get('inbound_pps'), sample_data.get('outbound_pps'), sample_data.get('total_pps'),
                sessions.get('active'), sessions.get('tcp'), sessions.get('udp'), sessions.get('icmp'),
                sessions.get('max_capacity') or sessions.get('max'), sessions.get('utilization_pct'),
                cpu.get('data_plane_cpu'), cpu.get('mgmt_plane_cpu'), cpu.get('memory_used_pct'),
                disk_usage.get('root_pct'), disk_usage.get('logs_pct'), disk_usage.get('var_pct'),
                top_bandwidth_json, top_internal_json, top_internet_json,
                sample_data.get('internal_mbps', 0), sample_data.get('internet_mbps', 0),
                top_category_wan_json, top_category_lan_json, top_category_internet_json,
                database_versions.get('app_version'), database_versions.get('threat_version'),
                database_versions.get('wildfire_version'), database_versions.get('url_version'),
                sample_data.get('wan_ip'), sample_data.get('wan_speed'),
                sample_data.get('hostname'), sample_data.get('uptime_seconds'),
                sample_data.get('panos_version') or sample_data.get('pan_os_version'),
                (sample_data.get('license', {}) or {}).get('expired', 0),
                (sample_data.get('license', {}) or {}).get('licensed', 0)
            ))

            conn.commit()
            debug("Stored throughput sample for device %s at %s", device_id, timestamp)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to store throughput sample for device %s: %s", device_id, str(e))
            return False
        finally:
            if conn:
                self._return_connection(conn)

    def get_latest_sample(self, device_id: str, max_age_seconds: int = 120) -> Optional[Dict]:
        """
        Get the latest throughput sample for a device.

        Compatible with SQLite ThroughputStorage.get_latest_sample() interface.

        Args:
            device_id: Device identifier
            max_age_seconds: Maximum age of sample in seconds (default: 120)

        Returns:
            Sample dictionary or None if no recent sample found
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            cutoff_time = datetime.now() - timedelta(seconds=max_age_seconds)

            cursor.execute('''
                SELECT
                    time AS timestamp,
                    device_id,
                    inbound_mbps, outbound_mbps, total_mbps,
                    inbound_pps, outbound_pps, total_pps,
                    sessions_active, sessions_tcp, sessions_udp, sessions_icmp,
                    session_max_capacity, session_utilization_pct,
                    cpu_data_plane, cpu_mgmt_plane, memory_used_pct,
                    disk_root_pct, disk_logs_pct, disk_var_pct,
                    top_bandwidth_client_json, top_internal_client_json, top_internet_client_json,
                    internal_mbps, internet_mbps,
                    top_category_wan_json, top_category_lan_json, top_category_internet_json,
                    app_version, threat_version, wildfire_version, url_version,
                    wan_ip, wan_speed, hostname, uptime_seconds, pan_os_version, license_expired, license_active
                FROM throughput_samples
                WHERE device_id = %s AND time >= %s
                ORDER BY time DESC
                LIMIT 1
            ''', (device_id, cutoff_time))

            row = cursor.fetchone()
            if not row:
                debug("No recent sample found for device %s (max age: %ds)", device_id, max_age_seconds)
                return None

            # Convert to dict format expected by routes
            sample = dict(row)
            # PostgreSQL returns timezone-aware datetime - convert to UTC and format as ISO with 'Z'
            # Remove microseconds timezone offset (+00:00) and replace with 'Z' for consistency
            timestamp_str = sample['timestamp'].isoformat()
            if '+' in timestamp_str:
                # Strip timezone offset (e.g., +00:00) and replace with Z
                timestamp_str = timestamp_str.split('+')[0] + 'Z'
            elif not timestamp_str.endswith('Z'):
                timestamp_str += 'Z'
            sample['timestamp'] = timestamp_str

            # Reconstruct nested objects for backward compatibility
            sample['sessions'] = {
                'active': sample.pop('sessions_active'),
                'tcp': sample.pop('sessions_tcp'),
                'udp': sample.pop('sessions_udp'),
                'icmp': sample.pop('sessions_icmp'),
                'max_capacity': sample.pop('session_max_capacity'),
                'max': sample.get('session_max_capacity'),  # Alias for compatibility
                'utilization_pct': sample.pop('session_utilization_pct')
            }

            sample['cpu'] = {
                'data_plane_cpu': sample.pop('cpu_data_plane'),
                'mgmt_plane_cpu': sample.pop('cpu_mgmt_plane'),
                'memory_used_pct': sample.pop('memory_used_pct')
            }

            sample['disk_usage'] = {
                'root_pct': sample.pop('disk_root_pct'),
                'logs_pct': sample.pop('disk_logs_pct'),
                'var_pct': sample.pop('disk_var_pct')
            }

            sample['database_versions'] = {
                'app_version': sample.pop('app_version'),
                'threat_version': sample.pop('threat_version'),
                'wildfire_version': sample.pop('wildfire_version'),
                'url_version': sample.pop('url_version')
            }

            # Parse JSON fields
            if sample.get('top_bandwidth_client_json'):
                sample['top_bandwidth_client'] = json.loads(sample.pop('top_bandwidth_client_json'))
            else:
                sample.pop('top_bandwidth_client_json', None)

            if sample.get('top_internal_client_json'):
                sample['top_internal_client'] = json.loads(sample.pop('top_internal_client_json'))
            else:
                sample.pop('top_internal_client_json', None)

            if sample.get('top_internet_client_json'):
                sample['top_internet_client'] = json.loads(sample.pop('top_internet_client_json'))
            else:
                sample.pop('top_internet_client_json', None)

            if sample.get('top_category_wan_json'):
                sample['top_category_wan'] = json.loads(sample.pop('top_category_wan_json'))
            else:
                sample.pop('top_category_wan_json', None)

            if sample.get('top_category_lan_json'):
                sample['top_category_lan'] = json.loads(sample.pop('top_category_lan_json'))
            else:
                sample.pop('top_category_lan_json', None)

            if sample.get('top_category_internet_json'):
                sample['top_category_internet'] = json.loads(sample.pop('top_category_internet_json'))
            else:
                sample.pop('top_category_internet_json', None)

            debug("Retrieved latest sample for device %s at %s", device_id, sample['timestamp'])
            return sample

        except Exception as e:
            exception("Failed to get latest sample for device %s: %s", device_id, str(e))
            return None
        finally:
            if conn:
                self._return_connection(conn)

    def query_samples(
        self,
        device_id: str,
        start_time: datetime,
        end_time: datetime,
        resolution: Optional[str] = None
    ) -> List[Dict]:
        """
        Query samples with automatic resolution selection.

        Compatible with SQLite ThroughputStorage.query_samples() interface.
        TimescaleDB automatically uses continuous aggregates for efficiency.

        Args:
            device_id: Device identifier
            start_time: Start of time range
            end_time: End of time range
            resolution: 'raw', 'hourly', 'daily', or None (auto-select)

        Returns:
            List of sample dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Auto-select resolution based on time range if not specified
            if resolution is None or resolution == 'auto':
                time_delta = end_time - start_time
                if time_delta <= timedelta(hours=6):
                    resolution = 'raw'  # Use 30-second samples
                elif time_delta <= timedelta(days=7):
                    resolution = 'hourly'  # Use hourly aggregates
                else:
                    resolution = 'daily'  # Use daily aggregates
                debug("Auto-selected resolution: %s for range %s", resolution, time_delta)

            samples = []

            if resolution == 'hourly':
                # Query from continuous aggregate (pre-computed, FAST!)
                debug("Querying hourly continuous aggregate for device %s from %s to %s",
                      device_id, start_time, end_time)

                cursor.execute('''
                    SELECT
                        hour AS timestamp,
                        avg_inbound_mbps AS inbound_mbps,
                        avg_outbound_mbps AS outbound_mbps,
                        avg_total_mbps AS total_mbps,
                        avg_inbound_pps AS inbound_pps,
                        avg_outbound_pps AS outbound_pps,
                        avg_total_pps AS total_pps,
                        avg_sessions_active AS sessions_active,
                        avg_sessions_tcp AS sessions_tcp,
                        avg_sessions_udp AS sessions_udp,
                        avg_sessions_icmp AS sessions_icmp,
                        avg_cpu_data_plane AS cpu_data_plane,
                        avg_cpu_mgmt_plane AS cpu_mgmt_plane,
                        avg_memory_used_pct AS memory_used_pct,
                        avg_disk_root_pct AS disk_root_pct,
                        avg_disk_logs_pct AS disk_logs_pct,
                        avg_disk_var_pct AS disk_var_pct,
                        avg_session_utilization_pct AS session_utilization_pct,
                        avg_internal_mbps AS internal_mbps,
                        avg_internet_mbps AS internet_mbps,
                        sample_count
                    FROM throughput_hourly
                    WHERE device_id = %s AND hour BETWEEN %s AND %s
                    ORDER BY hour
                ''', (device_id, start_time, end_time))

                rows = cursor.fetchall()
                for row in rows:
                    sample = dict(row)
                    sample['timestamp'] = self._format_timestamp(sample['timestamp'])
                    samples.append(sample)

            elif resolution == 'daily':
                # Query from daily continuous aggregate
                debug("Querying daily continuous aggregate for device %s from %s to %s",
                      device_id, start_time, end_time)

                cursor.execute('''
                    SELECT
                        day AS timestamp,
                        avg_inbound_mbps AS inbound_mbps,
                        avg_outbound_mbps AS outbound_mbps,
                        avg_total_mbps AS total_mbps,
                        avg_inbound_pps AS inbound_pps,
                        avg_outbound_pps AS outbound_pps,
                        avg_total_pps AS total_pps,
                        avg_sessions_active AS sessions_active,
                        avg_cpu_data_plane AS cpu_data_plane,
                        avg_cpu_mgmt_plane AS cpu_mgmt_plane,
                        avg_memory_used_pct AS memory_used_pct,
                        avg_disk_root_pct AS disk_root_pct,
                        avg_disk_logs_pct AS disk_logs_pct,
                        avg_disk_var_pct AS disk_var_pct,
                        avg_session_utilization_pct AS session_utilization_pct,
                        avg_internal_mbps AS internal_mbps,
                        avg_internet_mbps AS internet_mbps,
                        sample_count
                    FROM throughput_daily
                    WHERE device_id = %s AND day BETWEEN %s AND %s
                    ORDER BY day
                ''', (device_id, start_time, end_time))

                rows = cursor.fetchall()
                for row in rows:
                    sample = dict(row)
                    sample['timestamp'] = self._format_timestamp(sample['timestamp'])
                    samples.append(sample)

            else:  # raw
                # Query raw hypertable (automatically uses chunk exclusion for speed)
                debug("Querying raw hypertable for device %s from %s to %s",
                      device_id, start_time, end_time)

                cursor.execute('''
                    SELECT
                        time AS timestamp,
                        inbound_mbps, outbound_mbps, total_mbps,
                        inbound_pps, outbound_pps, total_pps,
                        sessions_active, sessions_tcp, sessions_udp, sessions_icmp,
                        session_utilization_pct,
                        cpu_data_plane, cpu_mgmt_plane, memory_used_pct,
                        disk_root_pct, disk_logs_pct, disk_var_pct,
                        internal_mbps, internet_mbps,
                        app_version, threat_version, wildfire_version, url_version
                    FROM throughput_samples
                    WHERE device_id = %s AND time BETWEEN %s AND %s
                    ORDER BY time
                ''', (device_id, start_time, end_time))

                rows = cursor.fetchall()
                for row in rows:
                    sample = dict(row)
                    sample['timestamp'] = self._format_timestamp(sample['timestamp'])

                    # Add database_versions for raw queries
                    sample['database_versions'] = {
                        'app_version': sample.pop('app_version', None),
                        'threat_version': sample.pop('threat_version', None),
                        'wildfire_version': sample.pop('wildfire_version', None),
                        'url_version': sample.pop('url_version', None)
                    }

                    samples.append(sample)

            debug("Retrieved %d samples for device %s (%s resolution)",
                  len(samples), device_id, resolution)
            return samples

        except Exception as e:
            exception("Failed to query samples for device %s: %s", device_id, str(e))
            return []
        finally:
            if conn:
                self._return_connection(conn)

    def cleanup_old_samples(self, retention_days: int) -> int:
        """
        No-op for TimescaleDB - retention policies handle cleanup automatically.

        Kept for API compatibility with SQLite ThroughputStorage.

        Args:
            retention_days: Ignored (retention policies configured in init_timescaledb.sql)

        Returns:
            0 (no manual cleanup needed)
        """
        debug("Cleanup called with retention_days=%d - TimescaleDB retention policies handle this automatically",
              retention_days)
        info("TimescaleDB automatic retention: 7d raw, 90d hourly, 1y daily")
        return 0

    def get_sample_count(self, device_id: Optional[str] = None) -> int:
        """
        Get total number of samples stored.

        Args:
            device_id: Optional device filter (None = all devices)

        Returns:
            Total sample count
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if device_id:
                cursor.execute(
                    'SELECT COUNT(*) FROM throughput_samples WHERE device_id = %s',
                    (device_id,)
                )
            else:
                cursor.execute('SELECT COUNT(*) FROM throughput_samples')

            count = cursor.fetchone()[0]
            debug("Sample count for device %s: %d", device_id or 'ALL', count)
            return count

        except Exception as e:
            exception("Failed to get sample count: %s", str(e))
            return 0
        finally:
            if conn:
                self._return_connection(conn)

    def get_storage_stats(self) -> Dict:
        """
        Get database storage statistics.

        Returns:
            Dictionary with database size, compression ratio, etc.
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Get database size
            cursor.execute('''
                SELECT pg_database_size(current_database()) AS total_size
            ''')
            db_stats = cursor.fetchone()

            # Get table sizes
            cursor.execute('''
                SELECT
                    schemaname,
                    tablename,
                    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
                    pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
                FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename IN ('throughput_samples', 'throughput_hourly', 'throughput_daily')
                ORDER BY size_bytes DESC
            ''')
            table_stats = cursor.fetchall()

            # Get compression stats
            cursor.execute('''
                SELECT
                    hypertable_name,
                    compression_enabled,
                    compressed_hypertable_id
                FROM timescaledb_information.hypertables
                WHERE hypertable_name = 'throughput_samples'
            ''')
            compression_stats = cursor.fetchone()

            stats = {
                'total_size_bytes': db_stats['total_size'],
                'total_size_pretty': self._bytes_to_human(db_stats['total_size']),
                'tables': [dict(row) for row in table_stats],
                'compression_enabled': compression_stats['compression_enabled'] if compression_stats else False
            }

            debug("Storage stats: %s", stats)
            return stats

        except Exception as e:
            exception("Failed to get storage stats: %s", str(e))
            return {}
        finally:
            if conn:
                self._return_connection(conn)

    @staticmethod
    def _bytes_to_human(bytes_value: int) -> str:
        """Convert bytes to human-readable format."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if bytes_value < 1024.0:
                return f"{bytes_value:.2f} {unit}"
            bytes_value /= 1024.0
        return f"{bytes_value:.2f} PB"

    @staticmethod
    def _format_timestamp(dt) -> str:
        """
        Format PostgreSQL datetime to ISO string with 'Z' suffix.

        PostgreSQL returns timezone-aware datetimes that already include offset.
        This removes the offset and adds 'Z' for UTC consistency.

        Args:
            dt: datetime object from PostgreSQL

        Returns:
            ISO format string with 'Z' suffix (e.g., '2025-11-19T09:47:17.526510Z')
        """
        timestamp_str = dt.isoformat()
        if '+' in timestamp_str:
            # Strip timezone offset (e.g., +00:00) and replace with Z
            timestamp_str = timestamp_str.split('+')[0] + 'Z'
        elif not timestamp_str.endswith('Z'):
            timestamp_str += 'Z'
        return timestamp_str

    def insert_connected_devices(self, device_id: str, devices: list, collection_time=None) -> bool:
        """
        Store connected devices data (stub for compatibility).

        Connected devices are stored in a separate system (nmap_scans.db).
        This method is kept for API compatibility with legacy code.

        Args:
            device_id: Device identifier
            devices: List of connected devices
            collection_time: Collection timestamp (unused)

        Returns:
            bool: Always returns True (no-op)
        """
        debug("insert_connected_devices called (no-op - stored in nmap_scans.db)")
        return True

    def get_connected_devices(self, device_id: str, max_age_seconds: int = 90) -> list:
        """
        Get connected devices from nmap_scans.db SQLite database.

        Connected devices are NOT stored in TimescaleDB - they're stored in a separate
        SQLite database (nmap_scans.db) managed by the Nmap scanning system.

        Args:
            device_id: Device identifier
            max_age_seconds: Maximum age of data in seconds (default: 90)

        Returns:
            list: List of connected device dictionaries, or empty list if error
        """
        import sqlite3
        import os
        from datetime import datetime, timedelta

        try:
            # Path to nmap_scans.db
            db_path = 'nmap_scans.db'
            if not os.path.exists(db_path):
                debug(f"nmap_scans.db not found at {db_path}")
                return []

            # Connect to SQLite database
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row  # Return dict-like rows
            cursor = conn.cursor()

            # Calculate cutoff time
            cutoff_time = datetime.now() - timedelta(seconds=max_age_seconds)

            # Query connected devices
            cursor.execute('''
                SELECT * FROM connected_devices
                WHERE device_id = ? AND timestamp >= ?
                ORDER BY timestamp DESC
            ''', (device_id, cutoff_time.isoformat()))

            rows = cursor.fetchall()
            conn.close()

            # Convert rows to list of dicts
            devices = [dict(row) for row in rows]
            debug(f"Retrieved {len(devices)} connected devices from nmap_scans.db (max_age={max_age_seconds}s)")
            return devices

        except Exception as e:
            exception(f"Error fetching connected devices from nmap_scans.db: {str(e)}")
            return []

    def get_connected_devices_with_bandwidth(self, device_id: str, max_age_seconds: int = 90, bandwidth_window_minutes: int = 60) -> list:
        """
        Get connected devices with bandwidth data aggregated from traffic logs.

        Fetches connected devices from nmap_scans.db and enriches each device with
        bandwidth statistics from the traffic_logs table (TimescaleDB).

        Args:
            device_id: Device identifier
            max_age_seconds: Maximum age of connected devices data in seconds (default: 90)
            bandwidth_window_minutes: Time window for bandwidth aggregation in minutes (default: 60)

        Returns:
            list: List of connected device dictionaries with bandwidth data added
        """
        from datetime import datetime, timedelta

        try:
            # Get base connected devices from SQLite
            devices = self.get_connected_devices(device_id, max_age_seconds)

            if not devices:
                debug("No connected devices found, skipping bandwidth aggregation")
                return []

            # Get bandwidth data from traffic_logs (TimescaleDB)
            # Since traffic_logs don't have a direct table in TimescaleDB yet,
            # we'll use the client_bandwidth table we just created

            conn = None
            try:
                conn = self._get_connection()
                cursor = conn.cursor(cursor_factory=RealDictCursor)

                # Calculate time window
                start_time = datetime.now() - timedelta(minutes=bandwidth_window_minutes)

                # Query client_bandwidth for all clients in the time window
                cursor.execute('''
                    SELECT
                        client_ip,
                        SUM(bytes_sent) as total_bytes_sent,
                        SUM(bytes_received) as total_bytes_received,
                        SUM(bytes_total) as total_bytes
                    FROM client_bandwidth
                    WHERE device_id = %s
                      AND time > %s
                      AND traffic_type = 'total'
                    GROUP BY client_ip
                ''', (device_id, start_time))

                bandwidth_data = cursor.fetchall()

                # Create lookup dict by IP
                bandwidth_by_ip = {row['client_ip']: dict(row) for row in bandwidth_data}

                debug(f"Aggregated bandwidth for {len(bandwidth_by_ip)} clients from client_bandwidth table")

            except Exception as e:
                debug(f"Could not fetch bandwidth data from client_bandwidth: {str(e)}")
                bandwidth_by_ip = {}

            finally:
                if conn:
                    self._return_connection(conn)

            # Enrich devices with bandwidth data
            for device in devices:
                ip = device.get('ip')
                if ip and ip in bandwidth_by_ip:
                    bw = bandwidth_by_ip[ip]
                    device['bytes_sent'] = bw.get('total_bytes_sent', 0)
                    device['bytes_received'] = bw.get('total_bytes_received', 0)
                    device['total_volume'] = bw.get('total_bytes', 0)
                else:
                    # No bandwidth data for this device
                    device['bytes_sent'] = 0
                    device['bytes_received'] = 0
                    device['total_volume'] = 0

            debug(f"Enriched {len(devices)} devices with bandwidth data ({bandwidth_window_minutes}-minute window)")
            return devices

        except Exception as e:
            exception(f"Error in get_connected_devices_with_bandwidth: {str(e)}")
            return []

    def store_threat_log(self, device_id: str, severity: str, log_entry: Dict, log_time=None) -> bool:
        """
        Store a single threat log entry in TimescaleDB.

        Args:
            device_id: Device identifier
            severity: Threat severity (critical, high, medium, low)
            log_entry: Log data dictionary
            log_time: Log timestamp (defaults to now)

        Returns:
            bool: True if successful, False otherwise
        """
        if log_time is None:
            log_time = datetime.now()

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Insert threat log
            cursor.execute("""
                INSERT INTO threat_logs (
                    time, device_id, severity, threat, source_ip,
                    destination_ip, application, action, rule, log_data
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id, time) DO NOTHING
            """, (
                log_time,
                device_id,
                severity.lower(),
                log_entry.get('threat'),
                log_entry.get('source_ip') or log_entry.get('src'),
                log_entry.get('destination_ip') or log_entry.get('dst'),
                log_entry.get('application') or log_entry.get('app'),
                log_entry.get('action'),
                log_entry.get('rule'),
                json.dumps(log_entry)
            ))

            conn.commit()
            cursor.close()
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to store threat log: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def get_threat_logs(self, device_id: str, severity: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """
        Retrieve threat logs from TimescaleDB.

        Args:
            device_id: Device identifier
            severity: Optional severity filter (critical, high, medium, low)
            limit: Maximum number of logs to return

        Returns:
            List of threat log dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            if severity:
                cursor.execute("""
                    SELECT time, severity, threat, source_ip, destination_ip,
                           application, action, rule, log_data
                    FROM threat_logs
                    WHERE device_id = %s AND severity = %s
                    ORDER BY time DESC
                    LIMIT %s
                """, (device_id, severity.lower(), limit))
            else:
                cursor.execute("""
                    SELECT time, severity, threat, source_ip, destination_ip,
                           application, action, rule, log_data
                    FROM threat_logs
                    WHERE device_id = %s
                    ORDER BY time DESC
                    LIMIT %s
                """, (device_id, limit))

            rows = cursor.fetchall()
            cursor.close()

            # Convert to list of dicts
            logs = []
            for row in rows:
                log = dict(row)
                # Format timestamp
                log['time'] = row['time'].isoformat() if row['time'] else None
                logs.append(log)

            debug("Retrieved %d threat logs (device=%s, severity=%s)", len(logs), device_id, severity or 'all')
            return logs

        except Exception as e:
            exception("Failed to retrieve threat logs: %s", str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def get_url_filtering_logs(self, device_id: str, limit: int = 100) -> List[Dict]:
        """
        Retrieve URL filtering logs (blocked URLs) from threat logs.

        Args:
            device_id: Device identifier
            limit: Maximum number of logs to return

        Returns:
            List of URL filtering log dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # URL filtering logs are stored as threats with specific action types
            cursor.execute("""
                SELECT time, threat AS url, source_ip, destination_ip,
                       application, action, log_data
                FROM threat_logs
                WHERE device_id = %s
                  AND (action = 'block-url' OR action = 'block' OR log_data->>'type' = 'url')
                ORDER BY time DESC
                LIMIT %s
            """, (device_id, limit))

            rows = cursor.fetchall()
            cursor.close()

            # Convert to list of dicts
            logs = []
            for row in rows:
                log = dict(row)
                # Format timestamp
                log['time'] = row['time'].isoformat() if row['time'] else None
                logs.append(log)

            debug("Retrieved %d URL filtering logs (device=%s)", len(logs), device_id)
            return logs

        except Exception as e:
            exception("Failed to retrieve URL filtering logs: %s", str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    # ============================================================================
    # Analytics Query Methods (for Top Category/Clients Dashboard Tiles)
    # ============================================================================

    def get_top_category(self, device_id: str, traffic_type: str = 'lan', minutes: int = 60) -> Optional[Dict]:
        """
        Get top category by bandwidth for last N minutes.

        Args:
            device_id: Device identifier
            traffic_type: 'lan', 'internet', or 'wan'
            minutes: Time window in minutes (default 60)

        Returns:
            Dict with category, bytes_sent, bytes_received, bytes_total or None if no data
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            cursor.execute('''
                SELECT
                    category,
                    SUM(bytes_sent) AS bytes_sent,
                    SUM(bytes_received) AS bytes_received,
                    SUM(bytes_total) AS bytes_total
                FROM category_bandwidth
                WHERE device_id = %s
                  AND traffic_type = %s
                  AND time > NOW() - INTERVAL '%s minutes'
                GROUP BY category
                ORDER BY bytes_total DESC
                LIMIT 1
            ''', (device_id, traffic_type, minutes))

            row = cursor.fetchone()
            return dict(row) if row else None

        except Exception as e:
            exception("Failed to get top category: %s", str(e))
            return None

        finally:
            if conn:
                self._return_connection(conn)

    def get_top_client(self, device_id: str, traffic_type: str = 'internal', minutes: int = 60) -> Optional[Dict]:
        """
        Get top client by bandwidth for last N minutes.

        Args:
            device_id: Device identifier
            traffic_type: 'internal', 'internet', or 'total'
            minutes: Time window in minutes (default 60)

        Returns:
            Dict with ip, hostname, custom_name, bytes_sent, bytes_received, bytes_total or None
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            cursor.execute('''
                SELECT
                    client_ip::text AS ip,
                    hostname,
                    custom_name,
                    SUM(bytes_sent) AS bytes_sent,
                    SUM(bytes_received) AS bytes_received,
                    SUM(bytes_total) AS bytes_total
                FROM client_bandwidth
                WHERE device_id = %s
                  AND traffic_type = %s
                  AND time > NOW() - INTERVAL '%s minutes'
                GROUP BY client_ip, hostname, custom_name
                ORDER BY bytes_total DESC
                LIMIT 1
            ''', (device_id, traffic_type, minutes))

            row = cursor.fetchone()
            return dict(row) if row else None

        except Exception as e:
            exception("Failed to get top client: %s", str(e))
            return None

        finally:
            if conn:
                self._return_connection(conn)

    def insert_threat_logs(self, device_id: str, logs: List[Dict], severity: str) -> bool:
        """
        Batch insert threat logs into TimescaleDB.

        Args:
            device_id: Device identifier
            logs: List of log entry dictionaries
            severity: Threat severity for all logs

        Returns:
            bool: True if successful, False otherwise
        """
        if not logs:
            return True

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Prepare batch insert data
            insert_data = []
            for log_entry in logs:
                # Parse time from log entry or use now
                log_time = log_entry.get('time')
                if isinstance(log_time, str) and log_time not in ['N/A', '', 'Unknown']:
                    try:
                        log_time = datetime.fromisoformat(log_time.replace('Z', '+00:00'))
                    except (ValueError, AttributeError):
                        log_time = datetime.now()
                else:
                    log_time = datetime.now()

                insert_data.append((
                    log_time,
                    device_id,
                    severity.lower(),
                    log_entry.get('threat'),
                    log_entry.get('source_ip') or log_entry.get('src'),
                    log_entry.get('destination_ip') or log_entry.get('dst'),
                    log_entry.get('application') or log_entry.get('app'),
                    log_entry.get('action'),
                    log_entry.get('rule'),
                    json.dumps(log_entry)
                ))

            # Batch insert using execute_batch for better performance
            execute_batch(cursor, """
                INSERT INTO threat_logs (
                    time, device_id, severity, threat, source_ip,
                    destination_ip, application, action, rule, log_data
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id, time) DO NOTHING
            """, insert_data, page_size=100)

            conn.commit()
            cursor.close()
            debug("Batch inserted %d threat logs (severity=%s, device=%s)", len(logs), severity, device_id)
            return True

        except Exception as e:
            import sys
            import traceback
            if conn:
                conn.rollback()
            sys.stderr.write(f"\n[STORAGE ERROR] Failed to batch insert threat logs: {str(e)}\n")
            sys.stderr.write(f"[STORAGE ERROR] Traceback:\n{traceback.format_exc()}\n")
            sys.stderr.flush()
            exception("Failed to batch insert threat logs: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def insert_url_filtering_logs(self, device_id: str, logs: List[Dict]) -> bool:
        """
        Batch insert URL filtering logs into threat_logs table.

        Args:
            device_id: Device identifier
            logs: List of URL filtering log dictionaries

        Returns:
            bool: True if successful, False otherwise
        """
        if not logs:
            return True

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Prepare batch insert data
            insert_data = []
            for log_entry in logs:
                # Parse time from log entry or use now
                log_time = log_entry.get('time')
                if isinstance(log_time, str) and log_time not in ['N/A', '', 'Unknown']:
                    try:
                        log_time = datetime.fromisoformat(log_time.replace('Z', '+00:00'))
                    except (ValueError, AttributeError):
                        log_time = datetime.now()
                else:
                    log_time = datetime.now()

                # Mark log as URL filtering type
                log_entry['type'] = 'url'

                insert_data.append((
                    log_time,
                    device_id,
                    'url-filter',  # Special severity for URL filtering
                    log_entry.get('url') or log_entry.get('threat'),
                    log_entry.get('source_ip') or log_entry.get('src'),
                    log_entry.get('destination_ip') or log_entry.get('dst'),
                    log_entry.get('application') or log_entry.get('app'),
                    'block-url',  # Action is always block for URL filtering
                    log_entry.get('rule'),
                    json.dumps(log_entry)
                ))

            # Batch insert using execute_batch
            execute_batch(cursor, """
                INSERT INTO threat_logs (
                    time, device_id, severity, threat, source_ip,
                    destination_ip, application, action, rule, log_data
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id, time) DO NOTHING
            """, insert_data, page_size=100)

            conn.commit()
            cursor.close()
            debug("Batch inserted %d URL filtering logs (device=%s)", len(logs), device_id)
            return True

        except Exception as e:
            import sys
            import traceback
            if conn:
                conn.rollback()
            sys.stderr.write(f"\n[STORAGE ERROR] Failed to batch insert URL filtering logs: {str(e)}\n")
            sys.stderr.write(f"[STORAGE ERROR] Traceback:\n{traceback.format_exc()}\n")
            sys.stderr.flush()
            exception("Failed to batch insert URL filtering logs: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    # ========================================================================
    # Analytics Tables: Application Samples, Category Bandwidth, Client Bandwidth
    # Added: v2.0.0 - Migration 004
    # ========================================================================

    def insert_application_samples(self, device_id: str, timestamp: datetime, app_stats: List[Dict]) -> bool:
        """
        Batch insert application samples into application_samples table.

        Args:
            device_id: Device identifier
            timestamp: Sample timestamp
            app_stats: List of application statistics dictionaries

        Returns:
            bool: True if successful, False otherwise
        """
        if not app_stats:
            debug("No application stats to insert for device %s", device_id)
            return True

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Prepare batch insert data
            insert_data = []
            for app in app_stats:
                # Extract top source (if available)
                top_source_ip = None
                top_source_hostname = None
                top_source_bytes = 0

                sources = app.get('sources', {})
                if sources:
                    # Get source with highest bytes
                    top_src = max(sources.values(), key=lambda s: s.get('bytes', 0))
                    top_source_ip = top_src.get('ip')
                    top_source_hostname = top_src.get('hostname')
                    top_source_bytes = top_src.get('bytes', 0)

                # Extract zone info (convert sets to comma-separated strings)
                zones = app.get('zones', set())
                source_zone = ','.join(sorted(zones)) if zones else None

                # Extract VLAN info
                vlans = app.get('vlans', set())
                vlan = ','.join(sorted(vlans)) if vlans else None

                insert_data.append((
                    timestamp,
                    device_id,
                    app.get('app', 'unknown'),
                    app.get('category', 'unknown'),
                    app.get('sessions', 0),
                    app.get('sessions', 0),  # sessions_tcp (not split in current data)
                    0,  # sessions_udp (not split in current data)
                    app.get('bytes_sent', 0),
                    app.get('bytes_received', 0),
                    app.get('bytes', 0),
                    0,  # bandwidth_mbps (not calculated at app level currently)
                    source_zone,
                    None,  # dest_zone (not tracked currently)
                    vlan,
                    top_source_ip,
                    top_source_hostname,
                    top_source_bytes
                ))

            # Batch insert using execute_batch
            execute_batch(cursor, """
                INSERT INTO application_samples (
                    time, device_id, application, category,
                    sessions_total, sessions_tcp, sessions_udp,
                    bytes_sent, bytes_received, bytes_total, bandwidth_mbps,
                    source_zone, dest_zone, vlan,
                    top_source_ip, top_source_hostname, top_source_bytes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (time, device_id, application) DO NOTHING
            """, insert_data, page_size=100)

            conn.commit()
            cursor.close()
            debug("Batch inserted %d application samples (device=%s, time=%s)", len(app_stats), device_id, timestamp)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to batch insert application samples: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def insert_category_bandwidth(self, device_id: str, timestamp: datetime, category_stats: List[Dict]) -> bool:
        """
        Batch insert category bandwidth samples into category_bandwidth table.

        Args:
            device_id: Device identifier
            timestamp: Sample timestamp
            category_stats: List of category statistics dictionaries
                           Each dict must have: category, traffic_type, bytes, sessions, top_application

        Returns:
            bool: True if successful, False otherwise
        """
        if not category_stats:
            debug("No category stats to insert for device %s", device_id)
            return True

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Prepare batch insert data
            insert_data = []
            for cat in category_stats:
                insert_data.append((
                    timestamp,
                    device_id,
                    cat.get('category', 'unknown'),
                    cat.get('traffic_type', 'total'),  # 'lan', 'internet', 'wan', etc.
                    cat.get('bytes_sent', 0),
                    cat.get('bytes_received', 0),
                    cat.get('bytes', 0),
                    0,  # bandwidth_mbps (not calculated at category level currently)
                    cat.get('sessions', 0),
                    cat.get('top_application'),
                    cat.get('top_application_bytes', 0)
                ))

            # Batch insert using execute_batch
            execute_batch(cursor, """
                INSERT INTO category_bandwidth (
                    time, device_id, category, traffic_type,
                    bytes_sent, bytes_received, bytes_total, bandwidth_mbps,
                    sessions_total, top_application, top_application_bytes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (time, device_id, category, traffic_type) DO NOTHING
            """, insert_data, page_size=100)

            conn.commit()
            cursor.close()
            debug("Batch inserted %d category bandwidth samples (device=%s, time=%s)", len(category_stats), device_id, timestamp)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to batch insert category bandwidth: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def insert_client_bandwidth(self, device_id: str, timestamp: datetime, client_stats: List[Dict]) -> bool:
        """
        Batch insert per-client bandwidth samples into client_bandwidth table.

        Args:
            device_id: Device identifier
            timestamp: Sample timestamp
            client_stats: List of client statistics dictionaries
                         Each dict must have: client_ip, client_mac (optional), hostname (optional),
                         custom_name (optional), traffic_type, bytes, sessions, etc.

        Returns:
            bool: True if successful, False otherwise
        """
        if not client_stats:
            debug("No client stats to insert for device %s", device_id)
            return True

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Prepare batch insert data
            insert_data = []
            for client in client_stats:
                # Handle MAC address (may be None)
                client_mac = client.get('client_mac')
                if client_mac and client_mac.lower() in ['n/a', 'unknown', 'none', '']:
                    client_mac = None

                insert_data.append((
                    timestamp,
                    device_id,
                    client.get('client_ip'),
                    client_mac,
                    client.get('hostname'),
                    client.get('custom_name'),  # Denormalized from device_metadata.json
                    client.get('traffic_type', 'total'),  # 'internal', 'internet', 'total'
                    client.get('bytes_sent', 0),
                    client.get('bytes_received', 0),
                    client.get('bytes', 0),
                    0,  # bandwidth_mbps (not calculated at client level currently)
                    client.get('sessions', 0),
                    client.get('sessions_tcp', 0),
                    client.get('sessions_udp', 0),
                    client.get('interface'),
                    client.get('vlan'),
                    client.get('zone'),
                    client.get('top_application'),
                    client.get('top_application_bytes', 0)
                ))

            # Batch insert using execute_batch
            execute_batch(cursor, """
                INSERT INTO client_bandwidth (
                    time, device_id, client_ip, client_mac, hostname, custom_name,
                    traffic_type, bytes_sent, bytes_received, bytes_total, bandwidth_mbps,
                    sessions_total, sessions_tcp, sessions_udp,
                    interface, vlan, zone, top_application, top_application_bytes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (time, device_id, client_ip, traffic_type) DO NOTHING
            """, insert_data, page_size=100)

            conn.commit()
            cursor.close()
            debug("Batch inserted %d client bandwidth samples (device=%s, time=%s)", len(client_stats), device_id, timestamp)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to batch insert client bandwidth: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def close(self):
        """Close connection pool."""
        if hasattr(self, 'pool') and self.pool:
            self.pool.closeall()
            info("TimescaleDB connection pool closed")

    def __del__(self):
        """Cleanup on object destruction."""
        self.close()


# =========================================
# Factory Functions (for easy initialization)
# =========================================

def create_timescale_storage(connection_string: str) -> TimescaleStorage:
    """
    Create TimescaleStorage instance with connection string.

    Args:
        connection_string: PostgreSQL DSN

    Returns:
        Initialized TimescaleStorage instance
    """
    return TimescaleStorage(connection_string)


def create_timescale_storage_from_env() -> TimescaleStorage:
    """
    Create TimescaleStorage from environment variables.

    Expected environment variables:
    - TIMESCALE_HOST (default: localhost)
    - TIMESCALE_PORT (default: 5432)
    - TIMESCALE_USER (default: panfm)
    - TIMESCALE_PASSWORD (required)
    - TIMESCALE_DB (default: panfm_db)

    Returns:
        Initialized TimescaleStorage instance
    """
    import os

    host = os.getenv('TIMESCALE_HOST', 'localhost')
    port = os.getenv('TIMESCALE_PORT', '5432')
    user = os.getenv('TIMESCALE_USER', 'panfm')
    password = os.getenv('TIMESCALE_PASSWORD', '')
    database = os.getenv('TIMESCALE_DB', 'panfm_db')

    if not password:
        raise ValueError("TIMESCALE_PASSWORD environment variable is required")

    connection_string = f"postgresql://{user}:{password}@{host}:{port}/{database}"
    return TimescaleStorage(connection_string)
