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
                    wan_ip, wan_speed, hostname, uptime_seconds, pan_os_version, license_expired, license_active,
                    threats_count, interface_errors,
                    cpu_temp, cpu_temp_max, cpu_temp_alarm
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
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s
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
                (sample_data.get('license', {}) or {}).get('licensed', 0),
                sample_data.get('threats_count', 0), sample_data.get('interface_errors', 0),
                sample_data.get('cpu_temp'), sample_data.get('cpu_temp_max'), sample_data.get('cpu_temp_alarm', False)
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
                    wan_ip, wan_speed, hostname, uptime_seconds, pan_os_version, license_expired, license_active,
                    cpu_temp, cpu_temp_max, cpu_temp_alarm
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

            # Reconstruct nested objects for backward compatibility (with safe defaults)
            sample['sessions'] = {
                'active': sample.pop('sessions_active', 0),
                'tcp': sample.pop('sessions_tcp', 0),
                'udp': sample.pop('sessions_udp', 0),
                'icmp': sample.pop('sessions_icmp', 0),
                'max_capacity': sample.pop('session_max_capacity', 0),
                'max': sample.get('session_max_capacity', 0),  # Alias for compatibility
                'utilization_pct': sample.pop('session_utilization_pct', 0)
            }

            sample['cpu'] = {
                'data_plane_cpu': sample.pop('cpu_data_plane', 0),
                'mgmt_plane_cpu': sample.pop('cpu_mgmt_plane', 0),
                'memory_used_pct': sample.pop('memory_used_pct', 0)
            }

            sample['disk_usage'] = {
                'root_pct': sample.pop('disk_root_pct', 0),
                'logs_pct': sample.pop('disk_logs_pct', 0),
                'var_pct': sample.pop('disk_var_pct', 0)
            }

            sample['database_versions'] = {
                'app_version': sample.pop('app_version', None),
                'threat_version': sample.pop('threat_version', None),
                'wildfire_version': sample.pop('wildfire_version', None),
                'url_version': sample.pop('url_version', None)
            }

            # Parse JSON fields (PostgreSQL JSONB already deserialized by psycopg2)
            # Only json.loads() if it's a string, otherwise use as-is (already a dict)
            if sample.get('top_bandwidth_client_json'):
                json_value = sample.pop('top_bandwidth_client_json')
                sample['top_bandwidth_client'] = json.loads(json_value) if isinstance(json_value, str) else json_value
            else:
                sample.pop('top_bandwidth_client_json', None)

            if sample.get('top_internal_client_json'):
                json_value = sample.pop('top_internal_client_json')
                sample['top_internal_client'] = json.loads(json_value) if isinstance(json_value, str) else json_value
            else:
                sample.pop('top_internal_client_json', None)

            if sample.get('top_internet_client_json'):
                json_value = sample.pop('top_internet_client_json')
                sample['top_internet_client'] = json.loads(json_value) if isinstance(json_value, str) else json_value
            else:
                sample.pop('top_internet_client_json', None)

            if sample.get('top_category_wan_json'):
                json_value = sample.pop('top_category_wan_json')
                sample['top_category_wan'] = json.loads(json_value) if isinstance(json_value, str) else json_value
            else:
                sample.pop('top_category_wan_json', None)

            if sample.get('top_category_lan_json'):
                json_value = sample.pop('top_category_lan_json')
                sample['top_category_lan'] = json.loads(json_value) if isinstance(json_value, str) else json_value
            else:
                sample.pop('top_category_lan_json', None)

            if sample.get('top_category_internet_json'):
                json_value = sample.pop('top_category_internet_json')
                sample['top_category_internet'] = json.loads(json_value) if isinstance(json_value, str) else json_value
            else:
                sample.pop('top_category_internet_json', None)

            # Reconstruct license object for frontend compatibility
            # Database stores as 'license_expired' and 'license_active', but frontend expects nested object
            license_active = sample.pop('license_active', True)
            sample['license'] = {
                'expired': sample.pop('license_expired', False),
                'licensed': license_active,
                'active': license_active
            }

            # Add panos_version alias (database stores as 'pan_os_version', frontend expects 'panos_version')
            sample['panos_version'] = sample.get('pan_os_version')

            # Ensure top-level numeric fields have defaults (prevent null from causing frontend crashes)
            numeric_defaults = {
                'inbound_mbps': 0, 'outbound_mbps': 0, 'total_mbps': 0,
                'inbound_pps': 0, 'outbound_pps': 0, 'total_pps': 0,
                'internal_mbps': 0, 'internet_mbps': 0,
                'wan_speed': 0, 'uptime_seconds': 0
            }
            for key, default in numeric_defaults.items():
                if sample.get(key) is None:
                    sample[key] = default

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
                        threats_count, interface_errors,
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
        Batch insert connected devices into connected_devices hypertable.

        Uses TimescaleDB hypertable with automatic time-based partitioning (7-day chunks).
        Performs batch INSERT with ON CONFLICT to update existing entries.

        Args:
            device_id: Device identifier
            devices: List of connected device dictionaries from firewall API
            collection_time: Collection timestamp (defaults to now())

        Returns:
            bool: True if successful, False otherwise
        """
        if not devices:
            debug("No connected devices to insert for device %s", device_id)
            return True

        conn = None
        try:
            from datetime import datetime
            conn = self._get_connection()
            cursor = conn.cursor()

            # Use provided timestamp or current time
            timestamp = collection_time if collection_time else datetime.now()

            # Prepare batch insert data
            insert_data = []
            for device in devices:
                # Extract fields from device dict
                ip = device.get('ip')
                if not ip:
                    continue  # Skip devices without IP

                mac = device.get('mac')
                # Validate MAC address format - PostgreSQL macaddr type requires valid format
                # Firewall may return "(incomplete)" for ARP entries without resolved MAC
                if mac:
                    import re
                    # Valid MAC formats: xx:xx:xx:xx:xx:xx or xx-xx-xx-xx-xx-xx
                    mac_pattern = r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$'
                    if not re.match(mac_pattern, mac):
                        debug(f"Invalid MAC address '{mac}' for IP {ip}, setting to NULL")
                        mac = None  # Set invalid MAC to NULL for database

                hostname = device.get('hostname') or device.get('original_hostname')
                interface = device.get('interface')
                zone = device.get('zone')
                # Convert TTL to integer (firewall API returns string like "29.7")
                ttl_str = device.get('ttl')
                try:
                    ttl = int(float(ttl_str)) if ttl_str and ttl_str != '-' else None
                except (ValueError, TypeError):
                    ttl = None
                vendor = device.get('vendor')
                custom_name = device.get('custom_name')

                insert_data.append((
                    timestamp,
                    device_id,
                    ip,
                    mac,
                    hostname,
                    interface,
                    zone,
                    ttl,
                    vendor,
                    custom_name,
                    timestamp,  # first_seen
                    timestamp   # last_seen
                ))

            if not insert_data:
                debug("No valid devices to insert (all missing IP addresses)")
                return True

            # Batch insert using execute_batch
            execute_batch(cursor, """
                INSERT INTO connected_devices (
                    time, device_id, ip, mac, hostname, interface, zone, ttl,
                    vendor, custom_name, first_seen, last_seen
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (time, device_id, ip) DO UPDATE SET
                    mac = EXCLUDED.mac,
                    hostname = EXCLUDED.hostname,
                    interface = EXCLUDED.interface,
                    zone = EXCLUDED.zone,
                    ttl = EXCLUDED.ttl,
                    vendor = EXCLUDED.vendor,
                    custom_name = EXCLUDED.custom_name,
                    last_seen = EXCLUDED.last_seen
            """, insert_data, page_size=100)

            conn.commit()
            cursor.close()
            debug("Batch inserted %d connected devices (device=%s, time=%s)", len(insert_data), device_id, timestamp)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            # Print to console for visibility in Docker logs
            print(f"[STORAGE ERROR] Failed to batch insert connected devices: {str(e)}")
            exception("Failed to batch insert connected devices: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def get_connected_devices(self, device_id: str, max_age_seconds: int = 90) -> list:
        """
        Get connected devices from TimescaleDB connected_devices hypertable.

        Returns the most recent entry for each unique IP address within the time window.
        Uses DISTINCT ON to get latest record per IP for efficient querying.

        Args:
            device_id: Device identifier
            max_age_seconds: Maximum age of data in seconds (default: 90)

        Returns:
            list: List of connected device dictionaries, or empty list if error
        """
        from datetime import datetime, timedelta

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Calculate cutoff time
            cutoff_time = datetime.now() - timedelta(seconds=max_age_seconds)

            # Query connected devices - get latest entry per IP
            cursor.execute('''
                SELECT DISTINCT ON (ip)
                    time,
                    device_id,
                    ip,
                    mac,
                    hostname,
                    interface,
                    zone,
                    ttl,
                    vendor,
                    custom_name,
                    first_seen,
                    last_seen
                FROM connected_devices
                WHERE device_id = %s AND time >= %s
                ORDER BY ip, time DESC
            ''', (device_id, cutoff_time))

            rows = cursor.fetchall()
            cursor.close()

            # Convert rows to list of dicts with formatted timestamps
            devices = []
            for row in rows:
                device_dict = dict(row)
                # Format timestamps to ISO strings with Z suffix
                if device_dict.get('time'):
                    device_dict['time'] = self._format_timestamp(device_dict['time'])
                if device_dict.get('first_seen'):
                    device_dict['first_seen'] = self._format_timestamp(device_dict['first_seen'])
                if device_dict.get('last_seen'):
                    device_dict['last_seen'] = self._format_timestamp(device_dict['last_seen'])
                # Convert IP and MAC to strings
                if device_dict.get('ip'):
                    device_dict['ip'] = str(device_dict['ip'])
                if device_dict.get('mac'):
                    device_dict['mac'] = str(device_dict['mac'])

                # Extract VLAN from interface field (e.g., "ethernet1/21.90" -> "90")
                interface = device_dict.get('interface', '')
                if interface and '.' in interface:
                    # Interface has VLAN suffix (e.g., ethernet1/21.90)
                    vlan = interface.split('.')[-1]
                    device_dict['vlan'] = vlan
                else:
                    # No VLAN suffix (trunk interface or untagged)
                    device_dict['vlan'] = '-'

                devices.append(device_dict)

            debug(f"Retrieved {len(devices)} connected devices from TimescaleDB (max_age={max_age_seconds}s)")
            return devices

        except Exception as e:
            exception(f"Error fetching connected devices from TimescaleDB: {str(e)}")
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def get_connected_devices_with_bandwidth(self, device_id: str, max_age_seconds: int = 90, bandwidth_window_minutes: int = 60) -> list:
        """
        Get connected devices with bandwidth data aggregated from client_bandwidth table.

        Fetches connected devices from TimescaleDB connected_devices hypertable and enriches
        each device with bandwidth statistics from the client_bandwidth table (TimescaleDB).

        Args:
            device_id: Device identifier
            max_age_seconds: Maximum age of connected devices data in seconds (default: 90)
            bandwidth_window_minutes: Time window for bandwidth aggregation in minutes (default: 60)

        Returns:
            list: List of connected device dictionaries with bandwidth data added
        """
        from datetime import datetime, timedelta

        try:
            # Get base connected devices from TimescaleDB
            devices = self.get_connected_devices(device_id, max_age_seconds)

            if not devices:
                debug("No connected devices found, skipping bandwidth aggregation")
                return []

            # Get bandwidth data from client_bandwidth hypertable

            conn = None
            try:
                conn = self._get_connection()
                cursor = conn.cursor(cursor_factory=RealDictCursor)

                # Calculate time window
                start_time = datetime.now() - timedelta(minutes=bandwidth_window_minutes)

                # Query client_bandwidth for all clients in the time window
                # Sum across ALL traffic types (internal + internet + total)
                cursor.execute('''
                    SELECT
                        client_ip,
                        SUM(bytes_sent) as total_bytes_sent,
                        SUM(bytes_received) as total_bytes_received,
                        SUM(bytes_total) as total_bytes
                    FROM client_bandwidth
                    WHERE device_id = %s
                      AND time > %s
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
                    # Convert to int to ensure numeric type (PostgreSQL may return Decimal)
                    device['bytes_sent'] = int(bw.get('total_bytes_sent', 0) or 0)
                    device['bytes_received'] = int(bw.get('total_bytes_received', 0) or 0)
                    device['total_volume'] = int(bw.get('total_bytes', 0) or 0)
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

    def get_top_internal_client(self, device_id: str, minutes: int = 60) -> Optional[Dict]:
        """
        Get top client by internal-only traffic bandwidth.

        Convenience wrapper around get_top_client() for internal traffic.
        This method is called by throughput_collector.py for Top Clients display.

        Args:
            device_id: Device identifier
            minutes: Time window in minutes (default 60)

        Returns:
            Dict with ip, hostname, custom_name, bytes_sent, bytes_received, bytes_total or None
        """
        return self.get_top_client(device_id, traffic_type='internal', minutes=minutes)

    def get_top_internet_client(self, device_id: str, minutes: int = 60) -> Optional[Dict]:
        """
        Get top client by internet-bound traffic bandwidth.

        Convenience wrapper around get_top_client() for internet traffic.
        This method is called by throughput_collector.py for Top Clients display.

        Args:
            device_id: Device identifier
            minutes: Time window in minutes (default 60)

        Returns:
            Dict with ip, hostname, custom_name, bytes_sent, bytes_received, bytes_total or None
        """
        return self.get_top_client(device_id, traffic_type='internet', minutes=minutes)

    def get_application_statistics(self, device_id: str, limit: int = 500, minutes: int = 60) -> List[Dict]:
        """
        Get application traffic statistics from database (ENTERPRISE DATABASE-FIRST PATTERN).

        Queries application_samples hypertable for recent application traffic data.
        This is the database-optimized version used by /api/applications endpoint.

        Args:
            device_id: Device identifier
            limit: Maximum number of applications to return (default 500)
            minutes: Time window in minutes (default 60 for last hour)

        Returns:
            List of application statistics dictionaries with keys:
                - name: Application name
                - category: Application category
                - bytes_sent: Bytes sent
                - bytes_received: Bytes received
                - bytes: Total bytes (sent + received)
                - sessions: Total session count
                - sources: List of source IPs/hostnames
                - destinations: List of destination IPs/hostnames
                - vlans: List of VLANs
                - zones: List of security zones
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Query recent application samples (aggregated)
            query = '''
                SELECT
                    application,
                    category,
                    SUM(bytes_sent) AS bytes_sent,
                    SUM(bytes_received) AS bytes_received,
                    SUM(bytes_total) AS bytes_total,
                    SUM(sessions_total) AS sessions_total,
                    array_agg(DISTINCT top_source_ip) FILTER (WHERE top_source_ip IS NOT NULL) AS source_ips,
                    array_agg(DISTINCT top_source_hostname) FILTER (WHERE top_source_hostname IS NOT NULL) AS source_hostnames,
                    array_agg(DISTINCT vlan) FILTER (WHERE vlan IS NOT NULL) AS vlans,
                    array_agg(DISTINCT source_zone) FILTER (WHERE source_zone IS NOT NULL) AS zones
                FROM application_samples
                WHERE device_id = %s
                  AND time >= NOW() - INTERVAL '%s minutes'
                GROUP BY application, category
                ORDER BY bytes_total DESC
                LIMIT %s
            '''

            cursor.execute(query, (device_id, minutes, limit))
            rows = cursor.fetchall()

            cursor.close()

            # Convert to expected format (match firewall API structure)
            applications = []
            for row in rows:
                # Calculate counts for frontend table display
                source_ips = row['source_ips'] or []
                source_count = len([ip for ip in source_ips if ip])  # Count non-null IPs

                app_data = {
                    'name': row['application'],
                    'category': row['category'],
                    'bytes_sent': int(row['bytes_sent'] or 0),
                    'bytes_received': int(row['bytes_received'] or 0),
                    'bytes': int(row['bytes_total'] or 0),
                    'sessions': int(row['sessions_total'] or 0),
                    'sources': source_ips,
                    'source_hostnames': row['source_hostnames'] or [],
                    'vlans': row['vlans'] or [],
                    'zones': row['zones'] or [],
                    # Calculated counts for table display (frontend expects these)
                    'source_count': source_count,
                    'dest_count': 0,  # Destination tracking not yet implemented in TimescaleDB
                    # Fields not stored in TimescaleDB (use empty arrays for frontend compatibility)
                    'protocols': [],  # Protocol info not stored in hypertable
                    'ports': [],      # Port info not stored in hypertable
                    'source_ips': source_ips,  # For backward compatibility
                    'dest_ips': [],   # Destination IPs not stored
                    'destinations': []  # Destination details not stored
                }
                applications.append(app_data)

            debug(f"Retrieved {len(applications)} applications from database (device={device_id}, window={minutes}min)")
            return applications

        except Exception as e:
            exception(f"Failed to get application statistics: {str(e)}")
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def get_application_summary(self, device_id: str, minutes: int = 60) -> Dict:
        """
        Get summary statistics for all applications (ENTERPRISE DATABASE-FIRST PATTERN).

        Aggregates application traffic for summary tiles on dashboard.

        Args:
            device_id: Device identifier
            minutes: Time window in minutes (default 60 for last hour)

        Returns:
            Dictionary with summary statistics:
                - total_applications: Total number of unique applications
                - total_sessions: Total session count across all apps
                - total_bytes: Total bytes across all apps
                - vlans_detected: Number of unique VLANs
                - zones_detected: Number of unique zones
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Query summary stats
            query = '''
                SELECT
                    COUNT(DISTINCT application) AS total_applications,
                    SUM(sessions_total) AS total_sessions,
                    SUM(bytes_total) AS total_bytes,
                    COUNT(DISTINCT vlan) FILTER (WHERE vlan IS NOT NULL) AS vlans_detected,
                    COUNT(DISTINCT source_zone) FILTER (WHERE source_zone IS NOT NULL) AS zones_detected
                FROM application_samples
                WHERE device_id = %s
                  AND time >= NOW() - INTERVAL '%s minutes'
            '''

            cursor.execute(query, (device_id, minutes))
            row = cursor.fetchone()

            cursor.close()

            summary = {
                'total_applications': int(row['total_applications'] or 0),
                'total_sessions': int(row['total_sessions'] or 0),
                'total_bytes': int(row['total_bytes'] or 0),
                'vlans_detected': int(row['vlans_detected'] or 0),
                'zones_detected': int(row['zones_detected'] or 0)
            }

            debug(f"Application summary: {summary['total_applications']} apps, {summary['total_sessions']} sessions, {summary['total_bytes']} bytes")
            return summary

        except Exception as e:
            exception(f"Failed to get application summary: {str(e)}")
            return {
                'total_applications': 0,
                'total_sessions': 0,
                'total_bytes': 0,
                'vlans_detected': 0,
                'zones_detected': 0
            }

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

                sources = app.get('sources', [])  # sources is a list of dicts, not a dict
                if sources:
                    # Get source with highest bytes
                    top_src = max(sources, key=lambda s: s.get('bytes', 0))
                    top_source_ip = top_src.get('ip')
                    top_source_hostname = top_src.get('hostname')
                    top_source_bytes = top_src.get('bytes', 0)

                # Extract zone info (convert lists to comma-separated strings)
                zones = app.get('zones', [])  # zones is a list, not a set
                source_zone = ','.join(sorted(zones)) if zones else None

                # Extract VLAN info
                vlans = app.get('vlans', [])  # vlans is a list, not a set
                vlan = ','.join(sorted(vlans)) if vlans else None

                insert_data.append((
                    timestamp,
                    device_id,
                    app.get('name', 'unknown'),  # Changed from 'app' to 'name' to match firewall API
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

                # Calculate bandwidth_mbps from bytes
                # Collector runs every 60 seconds, so: Mbps = (bytes * 8) / 60 / 1,000,000
                bytes_total = client.get('bytes', 0)
                bandwidth_mbps = (bytes_total * 8) / 60 / 1_000_000

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
                    bytes_total,
                    bandwidth_mbps,  # Calculated: (bytes * 8) / 60s / 1Mbps
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

    # =========================================
    # Device Metadata Methods (PostgreSQL) - Per-Device Separation v2.1.2
    # =========================================
    # Schema: PRIMARY KEY (device_id, mac) - ensures metadata is separated per managed firewall

    def get_device_metadata(self, device_id: str, mac: str) -> dict:
        """
        Get metadata for a single device by device_id + MAC address.

        Args:
            device_id: Managed firewall ID (required)
            mac: MAC address (will be normalized to lowercase)

        Returns:
            dict with keys: custom_name, location, comment, tags
            Returns empty dict if not found
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT custom_name, location, comment, tags
                FROM device_metadata
                WHERE device_id = %s AND mac = %s
            """, (device_id, mac.lower()))

            row = cursor.fetchone()
            cursor.close()

            if row:
                return {
                    'custom_name': row[0],
                    'location': row[1],
                    'comment': row[2],
                    'tags': row[3] or []
                }
            return {}

        except Exception as e:
            exception("Failed to get metadata for device %s, MAC %s: %s", device_id, mac, str(e))
            return {}

        finally:
            if conn:
                self._return_connection(conn)

    def get_all_device_metadata(self, device_id: str) -> dict:
        """
        Get all metadata for a specific managed device (firewall).

        Args:
            device_id: Managed firewall ID (required)

        Returns:
            dict mapping MAC addresses to metadata: {mac: {custom_name, location, comment, tags}}
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT mac, custom_name, location, comment, tags
                FROM device_metadata
                WHERE device_id = %s
            """, (device_id,))

            rows = cursor.fetchall()
            cursor.close()

            # Build dict mapping MAC -> metadata
            result = {}
            for row in rows:
                mac = str(row[0])  # Convert MACADDR to string
                result[mac] = {
                    'custom_name': row[1],
                    'location': row[2],
                    'comment': row[3],
                    'tags': row[4] or []
                }

            debug(f"Retrieved metadata for {len(result)} devices (device_id: {device_id})")
            return result

        except Exception as e:
            exception("Failed to get all device metadata for device %s: %s", device_id, str(e))
            return {}

        finally:
            if conn:
                self._return_connection(conn)

    def upsert_device_metadata(self, device_id: str, mac: str, custom_name: str = None,
                                location: str = None, comment: str = None, tags: list = None) -> bool:
        """
        Insert or update device metadata for a specific managed device.

        Args:
            device_id: Managed firewall ID (required)
            mac: MAC address (will be normalized to lowercase)
            custom_name: Custom device name
            location: Physical location
            comment: User notes
            tags: List of tags

        Returns:
            True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Normalize MAC
            mac = mac.lower()

            # Ensure tags is a list
            if tags is None:
                tags = []

            # Upsert (INSERT ... ON CONFLICT UPDATE) - composite key (device_id, mac)
            cursor.execute("""
                INSERT INTO device_metadata (device_id, mac, custom_name, location, comment, tags)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id, mac) DO UPDATE SET
                    custom_name = COALESCE(EXCLUDED.custom_name, device_metadata.custom_name),
                    location = COALESCE(EXCLUDED.location, device_metadata.location),
                    comment = COALESCE(EXCLUDED.comment, device_metadata.comment),
                    tags = EXCLUDED.tags,
                    updated_at = NOW()
            """, (device_id, mac, custom_name, location, comment, tags))

            conn.commit()
            cursor.close()

            debug(f"Upserted metadata for device {device_id}, MAC {mac}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to upsert metadata for device %s, MAC %s: %s", device_id, mac, str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def delete_device_metadata(self, device_id: str, mac: str) -> bool:
        """
        Delete metadata for a device on a specific managed firewall.

        Args:
            device_id: Managed firewall ID (required)
            mac: MAC address

        Returns:
            True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                "DELETE FROM device_metadata WHERE device_id = %s AND mac = %s",
                (device_id, mac.lower())
            )
            conn.commit()
            cursor.close()

            debug(f"Deleted metadata for device {device_id}, MAC {mac}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to delete metadata for device %s, MAC %s: %s", device_id, mac, str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def get_device_tags(self, device_id: str) -> list:
        """
        Get list of all unique tags for a specific managed device.

        Args:
            device_id: Managed firewall ID (required)

        Returns:
            List of tag strings, sorted alphabetically
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT DISTINCT unnest(tags) AS tag
                FROM device_metadata
                WHERE device_id = %s
                ORDER BY tag
            """, (device_id,))

            rows = cursor.fetchall()
            cursor.close()

            tags = [row[0] for row in rows if row[0]]
            debug(f"Retrieved {len(tags)} unique tags for device {device_id}")
            return tags

        except Exception as e:
            exception("Failed to get tags for device %s: %s", device_id, str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def get_all_tags_global(self) -> list:
        """
        Get list of all unique tags across ALL managed devices (global).

        Returns:
            List of tag strings, sorted alphabetically
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT DISTINCT unnest(tags) AS tag
                FROM device_metadata
                ORDER BY tag
            """)

            rows = cursor.fetchall()
            cursor.close()

            tags = [row[0] for row in rows if row[0]]
            debug(f"Retrieved {len(tags)} unique tags globally")
            return tags

        except Exception as e:
            exception("Failed to get all tags globally: %s", str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def get_tags_with_usage(self, device_id: str = None) -> list:
        """
        Get list of tags with usage counts for Settings Tag Management UI.

        Args:
            device_id: Optional - filter by specific device, None for global

        Returns:
            List of dicts: [{tag: str, usage_count: int, device_ids: [str]}]
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if device_id:
                # Tags for specific device
                cursor.execute("""
                    SELECT unnest(tags) AS tag, COUNT(*) AS usage_count
                    FROM device_metadata
                    WHERE device_id = %s
                    GROUP BY tag
                    ORDER BY tag
                """, (device_id,))
            else:
                # Tags globally with device breakdown
                cursor.execute("""
                    SELECT unnest(tags) AS tag, COUNT(*) AS usage_count,
                           array_agg(DISTINCT device_id) AS device_ids
                    FROM device_metadata
                    GROUP BY tag
                    ORDER BY tag
                """)

            rows = cursor.fetchall()
            cursor.close()

            if device_id:
                result = [{'tag': row[0], 'usage_count': row[1]} for row in rows if row[0]]
            else:
                result = [{'tag': row[0], 'usage_count': row[1], 'device_ids': row[2] or []}
                          for row in rows if row[0]]

            debug(f"Retrieved {len(result)} tags with usage counts")
            return result

        except Exception as e:
            exception("Failed to get tags with usage: %s", str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def get_device_locations(self, device_id: str) -> list:
        """
        Get list of all unique locations for a specific managed device.

        Args:
            device_id: Managed firewall ID (required)

        Returns:
            List of location strings, sorted alphabetically
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT DISTINCT location
                FROM device_metadata
                WHERE device_id = %s AND location IS NOT NULL AND location != ''
                ORDER BY location
            """, (device_id,))

            rows = cursor.fetchall()
            cursor.close()

            locations = [row[0] for row in rows]
            debug(f"Retrieved {len(locations)} unique locations for device {device_id}")
            return locations

        except Exception as e:
            exception("Failed to get locations for device %s: %s", device_id, str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def get_all_locations_global(self) -> list:
        """
        Get list of all unique locations across ALL managed devices (global).

        Returns:
            List of location strings, sorted alphabetically
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT DISTINCT location
                FROM device_metadata
                WHERE location IS NOT NULL AND location != ''
                ORDER BY location
            """)

            rows = cursor.fetchall()
            cursor.close()

            locations = [row[0] for row in rows]
            debug(f"Retrieved {len(locations)} unique locations globally")
            return locations

        except Exception as e:
            exception("Failed to get all locations globally: %s", str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def rename_tag(self, old_tag: str, new_tag: str, device_id: str = None) -> int:
        """
        Rename a tag across all metadata entries.

        Args:
            old_tag: Current tag name
            new_tag: New tag name
            device_id: Optional - only rename within specific device

        Returns:
            Number of rows affected
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if device_id:
                # Rename within specific device
                cursor.execute("""
                    UPDATE device_metadata
                    SET tags = array_replace(tags, %s, %s),
                        updated_at = NOW()
                    WHERE device_id = %s AND %s = ANY(tags)
                """, (old_tag, new_tag, device_id, old_tag))
            else:
                # Rename globally
                cursor.execute("""
                    UPDATE device_metadata
                    SET tags = array_replace(tags, %s, %s),
                        updated_at = NOW()
                    WHERE %s = ANY(tags)
                """, (old_tag, new_tag, old_tag))

            affected = cursor.rowcount
            conn.commit()
            cursor.close()

            debug(f"Renamed tag '{old_tag}' to '{new_tag}' - {affected} rows affected")
            return affected

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to rename tag '%s' to '%s': %s", old_tag, new_tag, str(e))
            return 0

        finally:
            if conn:
                self._return_connection(conn)

    def delete_tag(self, tag: str, device_id: str = None) -> int:
        """
        Remove a tag from all metadata entries.

        Args:
            tag: Tag to remove
            device_id: Optional - only remove within specific device

        Returns:
            Number of rows affected
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if device_id:
                # Remove within specific device
                cursor.execute("""
                    UPDATE device_metadata
                    SET tags = array_remove(tags, %s),
                        updated_at = NOW()
                    WHERE device_id = %s AND %s = ANY(tags)
                """, (tag, device_id, tag))
            else:
                # Remove globally
                cursor.execute("""
                    UPDATE device_metadata
                    SET tags = array_remove(tags, %s),
                        updated_at = NOW()
                    WHERE %s = ANY(tags)
                """, (tag, tag))

            affected = cursor.rowcount
            conn.commit()
            cursor.close()

            debug(f"Deleted tag '{tag}' - {affected} rows affected")
            return affected

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to delete tag '%s': %s", tag, str(e))
            return 0

        finally:
            if conn:
                self._return_connection(conn)

    def get_connected_devices_with_metadata(self, device_id: str, max_age_seconds: int = 300,
                                             tags: list = None, tag_operator: str = 'OR') -> list:
        """
        Get connected devices with metadata joined, optionally filtered by tags.

        Args:
            device_id: Device ID to query (required - used for both connected_devices and metadata)
            max_age_seconds: Maximum age of last_seen timestamp (default 5 minutes)
            tags: Optional list of tags to filter by
            tag_operator: 'OR' (any tag matches) or 'AND' (all tags must match)

        Returns:
            List of dicts with connected device info + metadata:
            [{ip, mac, hostname, interface, zone, vendor, custom_name, location, comment, tags, ...}]
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Base query with JOIN - include device_id in join for per-device metadata
            query = """
                SELECT
                    cd.ip,
                    cd.mac,
                    cd.hostname,
                    cd.interface,
                    cd.zone,
                    cd.ttl,
                    cd.vendor,
                    cd.first_seen,
                    cd.last_seen,
                    dm.custom_name,
                    dm.location,
                    dm.comment,
                    dm.tags
                FROM connected_devices cd
                LEFT JOIN device_metadata dm ON cd.device_id = dm.device_id AND cd.mac = dm.mac
                WHERE cd.device_id = %s
                  AND cd.last_seen > NOW() - INTERVAL '%s seconds'
            """

            params = [device_id, max_age_seconds]

            # Add tag filtering if specified
            if tags and len(tags) > 0:
                if tag_operator.upper() == 'AND':
                    # Device must have ALL tags
                    query += " AND dm.tags @> %s"
                    params.append(tags)
                else:
                    # Device must have ANY tag (overlap operator)
                    query += " AND dm.tags && %s"
                    params.append(tags)

            query += " ORDER BY cd.ip"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            cursor.close()

            # Convert to list of dicts
            devices = []
            for row in rows:
                devices.append({
                    'ip': row[0],
                    'mac': str(row[1]),  # Convert MACADDR to string
                    'hostname': row[2],
                    'interface': row[3],
                    'zone': row[4],
                    'ttl': row[5],
                    'vendor': row[6],
                    'first_seen': row[7],
                    'last_seen': row[8],
                    'custom_name': row[9],
                    'location': row[10],
                    'comment': row[11],
                    'tags': row[12] or []
                })

            debug(f"Retrieved {len(devices)} connected devices with metadata (tags: {tags}, operator: {tag_operator})")
            return devices

        except Exception as e:
            exception("Failed to get connected devices with metadata: %s", str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)


    # ============================================================================
    # Traffic Flows Methods (v2.2.0 - Sankey Diagram Support)
    # ============================================================================

    def insert_traffic_flows(self, device_id: str, flows: List[Dict]) -> bool:
        """
        Insert traffic flow records for Sankey diagram visualization.

        Batch inserts source→destination→application flow data collected from firewall.
        Uses execute_batch for high-performance bulk inserts.

        Args:
            device_id: Device ID
            flows: List of flow dictionaries with keys:
                - source_ip (str): Source IP address
                - dest_ip (str): Destination IP address
                - dest_port (int, optional): Destination port
                - application (str): Application name
                - category (str, optional): Application category
                - protocol (str, optional): Protocol ('tcp', 'udp', 'icmp', 'other')
                - bytes_sent (int, optional): Bytes sent
                - bytes_received (int, optional): Bytes received
                - bytes_total (int): Total bytes for this flow
                - sessions (int, optional): Session count (default: 1)
                - source_zone (str, optional): Source security zone
                - dest_zone (str, optional): Destination security zone
                - source_vlan (str, optional): Source VLAN
                - dest_vlan (str, optional): Destination VLAN
                - source_hostname (str, optional): Source hostname
                - dest_hostname (str, optional): Destination hostname

        Returns:
            True if successful, False otherwise

        Example:
            flows = [
                {
                    'source_ip': '192.168.1.100',
                    'dest_ip': '172.217.14.196',
                    'dest_port': 443,
                    'application': 'web-browsing',
                    'category': 'general-internet',
                    'protocol': 'tcp',
                    'bytes_total': 1234567,
                    'sessions': 5
                },
                ...
            ]
            storage.insert_traffic_flows(device_id, flows)
        """
        if not flows:
            debug("No traffic flows to insert")
            return True

        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Prepare batch insert
            query = '''
                INSERT INTO traffic_flows (
                    time, device_id, source_ip, dest_ip, dest_port,
                    application, category, protocol,
                    bytes_sent, bytes_received, bytes_total, sessions,
                    source_zone, dest_zone, source_vlan, dest_vlan,
                    source_hostname, dest_hostname
                ) VALUES (
                    NOW(), %s, %s::inet, %s::inet, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s
                )
                ON CONFLICT (time, device_id, source_ip, dest_ip, dest_port, application)
                DO UPDATE SET
                    bytes_sent = traffic_flows.bytes_sent + EXCLUDED.bytes_sent,
                    bytes_received = traffic_flows.bytes_received + EXCLUDED.bytes_received,
                    bytes_total = traffic_flows.bytes_total + EXCLUDED.bytes_total,
                    sessions = traffic_flows.sessions + EXCLUDED.sessions
            '''

            # Prepare batch data
            batch_data = []
            for flow in flows:
                batch_data.append((
                    device_id,
                    flow['source_ip'],
                    flow['dest_ip'],
                    flow.get('dest_port'),
                    flow['application'],
                    flow.get('category'),
                    flow.get('protocol'),
                    flow.get('bytes_sent', 0),
                    flow.get('bytes_received', 0),
                    flow['bytes_total'],
                    flow.get('sessions', 1),
                    flow.get('source_zone'),
                    flow.get('dest_zone'),
                    flow.get('source_vlan'),
                    flow.get('dest_vlan'),
                    flow.get('source_hostname'),
                    flow.get('dest_hostname')
                ))

            # Batch insert (page size 100)
            execute_batch(cursor, query, batch_data, page_size=100)
            conn.commit()
            cursor.close()

            debug(f"Inserted {len(flows)} traffic flows for device {device_id}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to insert traffic flows: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def get_traffic_flows_for_client(self, device_id: str, client_ip: str, minutes: int = 60) -> List[Dict]:
        """
        Get traffic flows for a specific client IP (Sankey diagram data).

        Queries traffic_flows hypertable with indexed lookup for fast response (<100ms).
        Returns aggregated flows grouped by application, destination IP, and port.

        Args:
            device_id: Device ID
            client_ip: Client/source IP address
            minutes: Time window in minutes (default: 60 = last 1 hour)

        Returns:
            List of flow dictionaries with keys:
                - application (str): Application name
                - destination_ip (str): Destination IP
                - destination_port (int): Destination port
                - bytes (int): Total bytes for this flow
                - sessions (int): Session count

        Example:
            flows = storage.get_traffic_flows_for_client(
                device_id='device-123',
                client_ip='192.168.1.100',
                minutes=60
            )
            # Returns: [
            #     {'application': 'web-browsing', 'destination_ip': '172.217.14.196',
            #      'destination_port': 443, 'bytes': 1234567, 'sessions': 5},
            #     ...
            # ]
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            query = '''
                SELECT
                    source_ip::text AS source_ip,
                    dest_ip::text AS dest_ip,
                    dest_port,
                    application,
                    SUM(bytes_total)::bigint AS bytes,
                    SUM(sessions)::integer AS sessions,
                    MAX(category) AS category,
                    MAX(protocol) AS protocol,
                    MAX(dest_zone) AS destination_zone,
                    MAX(dest_hostname) AS destination_hostname
                FROM traffic_flows
                WHERE device_id = %s
                  AND source_ip = %s::inet
                  AND time >= NOW() - INTERVAL '%s minutes'
                GROUP BY source_ip, dest_ip, dest_port, application
                ORDER BY bytes DESC
                LIMIT 50
            '''

            cursor.execute(query, (device_id, client_ip, minutes))
            rows = cursor.fetchall()
            cursor.close()

            flows = [dict(row) for row in rows]
            debug(f"Retrieved {len(flows)} traffic flows for client {client_ip} ({minutes}min window)")
            return flows

        except Exception as e:
            exception(f"Failed to get traffic flows for client {client_ip}: {str(e)}")
            return []

        finally:
            if conn:
                self._return_connection(conn)

    # =====================================================
    # Scheduler Stats Methods (v2.1.2 - Service Status Fix)
    # =====================================================

    def insert_scheduler_stats(self, uptime_seconds: int, total_executions: int,
                               total_errors: int, last_execution: datetime) -> bool:
        """
        Insert scheduler statistics into scheduler_stats_history hypertable.

        Args:
            uptime_seconds: Scheduler uptime in seconds
            total_executions: Total number of job executions
            total_errors: Total number of errors
            last_execution: Timestamp of last job execution

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO scheduler_stats_history (
                    timestamp, uptime_seconds, total_executions,
                    total_errors, last_execution
                ) VALUES (NOW(), %s, %s, %s, %s)
            """, (uptime_seconds, total_executions, total_errors, last_execution))

            conn.commit()
            cursor.close()
            debug("Inserted scheduler stats: uptime=%ds, executions=%d, errors=%d",
                  uptime_seconds, total_executions, total_errors)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to insert scheduler stats: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def get_latest_scheduler_stats(self) -> Optional[Dict]:
        """
        Get the most recent scheduler statistics.

        Returns:
            dict: Latest scheduler stats or None if no data
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT timestamp, uptime_seconds, total_executions,
                       total_errors, last_execution
                FROM scheduler_stats_history
                ORDER BY timestamp DESC
                LIMIT 1
            """)

            row = cursor.fetchone()
            cursor.close()

            if not row:
                return None

            return {
                'timestamp': row[0],
                'uptime_seconds': row[1],
                'total_executions': row[2],
                'total_errors': row[3],
                'last_execution': row[4]
            }

        except Exception as e:
            exception("Failed to get latest scheduler stats: %s", str(e))
            return None

        finally:
            if conn:
                self._return_connection(conn)

    def cleanup_old_scheduler_stats(self, days: int = 30) -> int:
        """
        Manually cleanup old scheduler stats (normally handled by retention policy).

        Args:
            days: Remove stats older than this many days

        Returns:
            int: Number of rows deleted
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                DELETE FROM scheduler_stats_history
                WHERE timestamp < NOW() - INTERVAL '%s days'
            """, (days,))

            deleted = cursor.rowcount
            conn.commit()
            cursor.close()

            info("Cleaned up %d old scheduler stats records", deleted)
            return deleted

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to cleanup old scheduler stats: %s", str(e))
            return 0

        finally:
            if conn:
                self._return_connection(conn)

    # =====================================================
    # Database Management Methods (v2.1.2 - Service Status Fix)
    # =====================================================

    def get_oldest_sample_time(self, device_id: Optional[str] = None) -> Optional[datetime]:
        """
        Get timestamp of oldest sample in throughput_history.

        Args:
            device_id: Optional device filter

        Returns:
            datetime: Oldest sample timestamp or None if no data
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if device_id:
                cursor.execute("""
                    SELECT MIN(time) FROM throughput_history
                    WHERE device_id = %s
                """, (device_id,))
            else:
                cursor.execute("SELECT MIN(time) FROM throughput_history")

            row = cursor.fetchone()
            cursor.close()

            return row[0] if row else None

        except Exception as e:
            exception("Failed to get oldest sample time: %s", str(e))
            return None

        finally:
            if conn:
                self._return_connection(conn)

    def get_device_sample_counts(self) -> Dict[str, int]:
        """
        Get sample count per device.

        Returns:
            dict: {device_id: sample_count}
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                SELECT device_id, COUNT(*) as count
                FROM throughput_history
                GROUP BY device_id
                ORDER BY count DESC
            """)

            rows = cursor.fetchall()
            cursor.close()

            return {row[0]: row[1] for row in rows}

        except Exception as e:
            exception("Failed to get device sample counts: %s", str(e))
            return {}

        finally:
            if conn:
                self._return_connection(conn)

    def clear_device_data(self, device_id: str) -> bool:
        """
        Clear all data for a specific device from all hypertables.

        Args:
            device_id: Device identifier

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Delete from all hypertables (correct table names per schema)
            tables = [
                'throughput_samples',      # Main throughput data (30-sec samples)
                'application_samples',     # Per-app traffic data
                'category_bandwidth',      # Per-category traffic
                'client_bandwidth',        # Per-client traffic
                'traffic_flows',           # Sankey diagram flows
                'connected_devices',       # ARP entries
                'alert_history',           # Alert events for this device
                'nmap_scan_history',       # Nmap scan results
                'nmap_change_events',      # Network change events
            ]

            total_deleted = 0
            for table in tables:
                try:
                    cursor.execute(f"DELETE FROM {table} WHERE device_id = %s", (device_id,))
                    deleted = cursor.rowcount
                    total_deleted += deleted
                    debug("Deleted %d rows from %s for device %s", deleted, table, device_id)
                except Exception as table_error:
                    # Table may not exist in older schemas - log warning and continue
                    warning("Could not delete from %s: %s", table, str(table_error))

            conn.commit()
            cursor.close()

            info("Cleared %d total rows for device %s", total_deleted, device_id)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to clear device data: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def clear_all_data(self) -> bool:
        """
        Clear ALL data from all hypertables (complete database wipe).

        WARNING: This cannot be undone!

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Truncate all hypertables (faster than DELETE)
            # Uses correct table names per schema
            tables = [
                'throughput_samples',      # Main throughput data (30-sec samples)
                'application_samples',     # Per-app traffic data
                'category_bandwidth',      # Per-category traffic
                'client_bandwidth',        # Per-client traffic
                'traffic_flows',           # Sankey diagram flows
                'connected_devices',       # ARP entries
                'alert_history',           # Alert events
                'nmap_scan_history',       # Nmap scan results
                'nmap_change_events',      # Network change events
                'scheduler_stats_history', # Scheduler health stats
            ]

            for table in tables:
                try:
                    cursor.execute(f"TRUNCATE TABLE {table} CASCADE")
                    debug("Truncated table: %s", table)
                except Exception as table_error:
                    # Table may not exist in older schemas - log warning and continue
                    warning("Could not truncate %s: %s", table, str(table_error))

            # Also clear device_status (regular table, not hypertable) - if it exists
            try:
                cursor.execute("TRUNCATE TABLE device_status CASCADE")
                debug("Truncated table: device_status")
            except Exception as table_error:
                warning("Could not truncate device_status: %s", str(table_error))

            conn.commit()
            cursor.close()

            info("Cleared ALL data from all hypertables")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to clear all data: %s", str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    # ========================================================================
    # On-Demand Collection Queue Methods (v1.0.3)
    # Purpose: Inter-process communication for device switch collection
    # ========================================================================

    def create_collection_request(self, device_id: str) -> Optional[int]:
        """
        Create an on-demand collection request for a device.

        Called by web process when user switches devices.
        Clock process polls for queued requests every 5 seconds.

        Args:
            device_id: Device UUID to collect data for

        Returns:
            Request ID if successful, None if failed
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Check if there's already a pending/running request for this device
            cursor.execute("""
                SELECT id FROM collection_requests
                WHERE device_id = %s AND status IN ('queued', 'running')
                ORDER BY requested_at DESC
                LIMIT 1
            """, (device_id,))
            existing = cursor.fetchone()

            if existing:
                # Return existing request ID (dedupe)
                cursor.close()
                debug("Existing collection request found for device %s: %d", device_id, existing[0])
                return existing[0]

            # Create new request
            cursor.execute("""
                INSERT INTO collection_requests (device_id, status, requested_at)
                VALUES (%s, 'queued', NOW())
                RETURNING id
            """, (device_id,))

            request_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()

            debug("Created collection request %d for device %s", request_id, device_id)
            return request_id

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to create collection request for device %s: %s", device_id, str(e))
            return None

        finally:
            if conn:
                self._return_connection(conn)

    def get_collection_request(self, request_id: int) -> Optional[Dict]:
        """
        Get status of a collection request.

        Called by web process to poll request status.

        Args:
            request_id: Request ID

        Returns:
            Dict with id, device_id, status, requested_at, started_at, completed_at, error_message
            or None if not found
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            cursor.execute("""
                SELECT id, device_id, status, requested_at, started_at, completed_at, error_message
                FROM collection_requests
                WHERE id = %s
            """, (request_id,))

            row = cursor.fetchone()
            cursor.close()

            if row:
                result = dict(row)
                # Format timestamps as ISO strings
                for field in ['requested_at', 'started_at', 'completed_at']:
                    if result.get(field):
                        result[field] = result[field].isoformat()
                return result
            return None

        except Exception as e:
            exception("Failed to get collection request %d: %s", request_id, str(e))
            return None

        finally:
            if conn:
                self._return_connection(conn)

    def get_pending_collection_requests(self) -> List[Dict]:
        """
        Get all queued collection requests (for clock process).

        Called by clock process every 5 seconds to find pending requests.

        Returns:
            List of dicts with id, device_id, requested_at
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            cursor.execute("""
                SELECT id, device_id, requested_at
                FROM collection_requests
                WHERE status = 'queued'
                ORDER BY requested_at ASC
            """)

            rows = cursor.fetchall()
            cursor.close()

            return [dict(row) for row in rows]

        except Exception as e:
            exception("Failed to get pending collection requests: %s", str(e))
            return []

        finally:
            if conn:
                self._return_connection(conn)

    def update_collection_request(self, request_id: int, status: str, error_message: str = None) -> bool:
        """
        Update status of a collection request.

        Called by clock process to mark requests as running/completed/failed.

        Args:
            request_id: Request ID
            status: New status ('running', 'completed', 'failed')
            error_message: Error message if status is 'failed'

        Returns:
            True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if status == 'running':
                cursor.execute("""
                    UPDATE collection_requests
                    SET status = %s, started_at = NOW()
                    WHERE id = %s
                """, (status, request_id))
            elif status in ('completed', 'failed'):
                cursor.execute("""
                    UPDATE collection_requests
                    SET status = %s, completed_at = NOW(), error_message = %s
                    WHERE id = %s
                """, (status, error_message, request_id))
            else:
                cursor.execute("""
                    UPDATE collection_requests
                    SET status = %s
                    WHERE id = %s
                """, (status, request_id))

            conn.commit()
            cursor.close()

            debug("Updated collection request %d to status '%s'", request_id, status)
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to update collection request %d: %s", request_id, str(e))
            return False

        finally:
            if conn:
                self._return_connection(conn)

    def cleanup_old_collection_requests(self, hours: int = 1) -> int:
        """
        Remove completed/failed collection requests older than specified hours.

        Called periodically to keep the table small and fast.

        Args:
            hours: Delete requests completed more than this many hours ago

        Returns:
            Number of deleted rows
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                DELETE FROM collection_requests
                WHERE status IN ('completed', 'failed')
                  AND completed_at < NOW() - INTERVAL '%s hours'
            """, (hours,))

            deleted = cursor.rowcount
            conn.commit()
            cursor.close()

            if deleted > 0:
                debug("Cleaned up %d old collection requests", deleted)
            return deleted

        except Exception as e:
            if conn:
                conn.rollback()
            exception("Failed to cleanup old collection requests: %s", str(e))
            return 0

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


# =====================================================
# Helper Functions for Traffic Classification
# =====================================================

def is_private_ip(ip: str) -> bool:
    """
    Check if an IP address is in a private/RFC1918 range.

    Private IP ranges:
    - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
    - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)

    Args:
        ip: IP address string (e.g., "192.168.1.1")

    Returns:
        True if IP is in a private range, False otherwise
    """
    if not ip:
        return False

    try:
        # Split into octets
        parts = ip.split('.')
        if len(parts) != 4:
            return False

        # Convert to integers
        octets = [int(p) for p in parts]

        # Check 10.0.0.0/8
        if octets[0] == 10:
            return True

        # Check 172.16.0.0/12
        if octets[0] == 172 and 16 <= octets[1] <= 31:
            return True

        # Check 192.168.0.0/16
        if octets[0] == 192 and octets[1] == 168:
            return True

        return False

    except (ValueError, IndexError):
        # Invalid IP format
        return False


def is_internet_traffic(src_ip: str, dst_ip: str) -> bool:
    """
    Check if traffic is internet-bound (one private IP, one public IP).

    Internet traffic is defined as:
    - Source is private, destination is public (outbound)
    - Source is public, destination is private (inbound)

    Args:
        src_ip: Source IP address
        dst_ip: Destination IP address

    Returns:
        True if one IP is private and one is public, False otherwise
    """
    src_private = is_private_ip(src_ip)
    dst_private = is_private_ip(dst_ip)

    # XOR: True if exactly one is private (one private + one public = internet traffic)
    return src_private != dst_private
