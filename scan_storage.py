"""
Nmap Scan Storage and Change Detection Module - PostgreSQL/TimescaleDB Version

Provides PostgreSQL/TimescaleDB storage for nmap scan results with change detection.
Migrated from SQLite to TimescaleDB for v2.0.0.

Database Tables (TimescaleDB Hypertables):
- nmap_scan_history: Complete scan results (hypertable, partitioned by scan_timestamp)
- nmap_port_history: Per-port details with foreign key to scans
- nmap_change_events: Detected changes with severity (hypertable, partitioned by change_timestamp)
- scheduled_scans: Scan scheduling configuration
- scan_queue: Scan execution tracking

Version: 2.0.0 (TimescaleDB Migration)
Author: PANfm
"""

import psycopg2
import psycopg2.extras
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from logger import debug, info, warning, error, exception

# PostgreSQL connection string
PG_CONN = "dbname=panfm_db user=panfm password=panfm_secure_password host=localhost port=5432"

# High-risk ports that trigger critical severity alerts
HIGH_RISK_PORTS = {
    21: 'FTP (unencrypted)',
    23: 'Telnet (unencrypted)',
    135: 'RPC (Windows)',
    139: 'NetBIOS (SMB)',
    445: 'SMB/CIFS (Windows)',
    1433: 'MSSQL',
    3306: 'MySQL',
    3389: 'RDP (Remote Desktop)',
    5432: 'PostgreSQL',
    5900: 'VNC',
    6379: 'Redis',
    8080: 'HTTP Proxy (often unsecured)',
    27017: 'MongoDB'
}


class ScanStorage:
    """
    Manages nmap scan result storage and change detection in PostgreSQL/TimescaleDB.

    Provides methods for storing scan results, retrieving scan history,
    detecting changes between scans, and managing change events.
    """

    def __init__(self, pg_conn: str = PG_CONN):
        """
        Initialize scan storage with PostgreSQL connection.

        Args:
            pg_conn: PostgreSQL connection string
        """
        self.pg_conn = pg_conn
        debug("Initializing ScanStorage with PostgreSQL connection")
        # Note: Schema is managed via migrations, no need to create tables here

    def _get_connection(self):
        """Get PostgreSQL database connection"""
        return psycopg2.connect(self.pg_conn)

    # ============================================================================
    # SCAN RESULT STORAGE
    # ============================================================================

    def store_scan_result(self, device_id: str, target_ip: str, scan_data: Dict) -> Optional[int]:
        """
        Store a complete nmap scan result in the database.

        Args:
            device_id: Device identifier
            target_ip: Target IP address that was scanned
            scan_data: Complete scan data dictionary with structure:
                {
                    'scan_type': str,
                    'scan_timestamp': str (ISO format),
                    'scan_duration_seconds': float,
                    'hostname': str (optional),
                    'host_status': str,
                    'os_name': str (optional),
                    'os_accuracy': int (optional),
                    'os_matches': List[Dict] (optional),
                    'ports': List[Dict] with port details,
                    'raw_xml': str (optional)
                }

        Returns:
            int: Scan ID if successful, None if failed
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Parse scan timestamp
            scan_timestamp = datetime.fromisoformat(scan_data.get('scan_timestamp', datetime.now().isoformat()))

            # Extract OS matches
            os_matches = scan_data.get('os_matches', [])
            os_matches_json = json.dumps(os_matches) if os_matches else None

            # Extract port data
            ports = scan_data.get('ports', [])
            scan_results_json = json.dumps(scan_data)

            # Calculate port statistics
            total_ports = len(ports)
            open_ports = [p for p in ports if p.get('state') == 'open']
            open_ports_count = len(open_ports)

            # Insert scan record into hypertable
            cursor.execute('''
                INSERT INTO nmap_scan_history
                (time, device_id, target_ip, scan_type, scan_timestamp, scan_duration_seconds,
                 hostname, host_status, os_name, os_accuracy, os_matches, total_ports,
                 open_ports_count, scan_results, raw_xml)
                VALUES (%s, %s, %s::inet, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s)
                RETURNING id
            ''', (
                scan_timestamp,  # time column for hypertable
                device_id,
                target_ip,
                scan_data.get('scan_type', 'balanced'),
                scan_timestamp,
                scan_data.get('scan_duration_seconds'),
                scan_data.get('hostname'),
                scan_data.get('host_status', 'unknown'),
                scan_data.get('os_name'),
                scan_data.get('os_accuracy'),
                os_matches_json,
                total_ports,
                open_ports_count,
                scan_results_json,
                scan_data.get('raw_xml')
            ))

            scan_id = cursor.fetchone()[0]
            debug(f"Stored scan result for {target_ip} with ID {scan_id}")

            # Store port details
            for port in ports:
                cursor.execute('''
                    INSERT INTO nmap_port_history
                    (scan_id, port_number, protocol, state, service_name, service_product, service_version)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''', (
                    scan_id,
                    port.get('port'),
                    port.get('protocol', 'tcp'),
                    port.get('state', 'unknown'),
                    port.get('service'),
                    port.get('product'),
                    port.get('version')
                ))

            debug(f"Stored {len(ports)} port details for scan {scan_id}")

            # Detect and store changes
            self._detect_and_store_changes(cursor, conn, device_id, target_ip, scan_id, scan_data)

            conn.commit()
            return scan_id

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to store scan result: {str(e)}")
            return None

        finally:
            if conn:
                conn.close()

    def _detect_and_store_changes(self, cursor, conn, device_id: str, target_ip: str,
                                  current_scan_id: int, current_scan: Dict):
        """
        Detect changes between current scan and last scan, store change events.

        Args:
            cursor: Database cursor
            conn: Database connection
            device_id: Device identifier
            target_ip: Target IP address
            current_scan_id: ID of current scan
            current_scan: Current scan data dictionary
        """
        debug(f"Detecting changes for {target_ip}")

        # Get last scan before this one
        last_scan = self._get_last_scan_before(cursor, device_id, target_ip, current_scan_id)

        if not last_scan:
            debug(f"No previous scan found for {target_ip}, skipping change detection")
            return

        # Detect port changes (new ports, closed ports, changed services)
        self._detect_port_changes(cursor, device_id, target_ip, last_scan, current_scan)

        # Detect OS changes
        self._detect_os_changes(cursor, device_id, target_ip, last_scan, current_scan)

        # Detect service version changes
        self._detect_service_changes(cursor, device_id, target_ip, last_scan, current_scan)

    def _get_last_scan_before(self, cursor, device_id: str, target_ip: str,
                              current_scan_id: int) -> Optional[Dict]:
        """
        Get the last scan for a target before the current scan.

        Args:
            cursor: Database cursor
            device_id: Device identifier
            target_ip: Target IP address
            current_scan_id: Current scan ID to exclude

        Returns:
            Dict: Last scan data, or None if no previous scan exists
        """
        cursor.execute('''
            SELECT id, scan_timestamp, hostname, os_name, scan_results
            FROM nmap_scan_history
            WHERE device_id = %s AND target_ip = %s::inet AND id < %s
            ORDER BY scan_timestamp DESC
            LIMIT 1
        ''', (device_id, target_ip, current_scan_id))

        row = cursor.fetchone()
        if not row:
            return None

        # Parse scan_results JSONB
        scan_results = row[4] if isinstance(row[4], dict) else json.loads(row[4]) if row[4] else {}

        return {
            'id': row[0],
            'scan_timestamp': row[1],
            'hostname': row[2],
            'os_name': row[3],
            'scan_results': scan_results
        }

    def _detect_port_changes(self, cursor, device_id: str, target_ip: str,
                             last_scan: Dict, current_scan: Dict):
        """
        Detect and store port changes (new open ports, closed ports, service changes).

        Args:
            cursor: Database cursor
            device_id: Device identifier
            target_ip: Target IP address
            last_scan: Previous scan data
            current_scan: Current scan data
        """
        last_ports = {p['port']: p for p in last_scan.get('scan_results', {}).get('ports', [])}
        current_ports = {p['port']: p for p in current_scan.get('ports', [])}

        # Detect new open ports
        new_ports = set(current_ports.keys()) - set(last_ports.keys())
        for port_num in new_ports:
            port_info = current_ports[port_num]
            if port_info.get('state') == 'open':
                severity = 'critical' if port_num in HIGH_RISK_PORTS else 'warning'
                service_desc = port_info.get('service', 'unknown')
                details = {
                    'port': port_num,
                    'protocol': port_info.get('protocol', 'tcp'),
                    'service': service_desc,
                    'product': port_info.get('product'),
                    'version': port_info.get('version')
                }

                if port_num in HIGH_RISK_PORTS:
                    details['risk_description'] = HIGH_RISK_PORTS[port_num]

                self._store_change_event(
                    cursor, device_id, target_ip,
                    'new_port',
                    severity,
                    None,
                    f"Port {port_num}/{port_info.get('protocol', 'tcp')} ({service_desc})",
                    details
                )

        # Detect closed ports (were open, now closed or not in scan)
        closed_ports = set(last_ports.keys()) - set(current_ports.keys())
        for port_num in closed_ports:
            port_info = last_ports[port_num]
            if port_info.get('state') == 'open':
                self._store_change_event(
                    cursor, device_id, target_ip,
                    'port_closed',
                    'info',
                    f"Port {port_num}/{port_info.get('protocol', 'tcp')}",
                    "Closed",
                    {'port': port_num, 'protocol': port_info.get('protocol', 'tcp')}
                )

    def _detect_os_changes(self, cursor, device_id: str, target_ip: str,
                          last_scan: Dict, current_scan: Dict):
        """
        Detect operating system changes.

        Args:
            cursor: Database cursor
            device_id: Device identifier
            target_ip: Target IP address
            last_scan: Previous scan data
            current_scan: Current scan data
        """
        last_os = last_scan.get('os_name')
        current_os = current_scan.get('os_name')

        if last_os and current_os and last_os != current_os:
            self._store_change_event(
                cursor, device_id, target_ip,
                'os_change',
                'warning',
                last_os,
                current_os,
                {
                    'old_os': last_os,
                    'new_os': current_os,
                    'accuracy': current_scan.get('os_accuracy')
                }
            )

    def _detect_service_changes(self, cursor, device_id: str, target_ip: str,
                                last_scan: Dict, current_scan: Dict):
        """
        Detect service version changes on ports.

        Args:
            cursor: Database cursor
            device_id: Device identifier
            target_ip: Target IP address
            last_scan: Previous scan data
            current_scan: Current scan data
        """
        last_ports = {p['port']: p for p in last_scan.get('scan_results', {}).get('ports', [])}
        current_ports = {p['port']: p for p in current_scan.get('ports', [])}

        # Check common ports for service version changes
        common_ports = set(last_ports.keys()) & set(current_ports.keys())
        for port_num in common_ports:
            last_port = last_ports[port_num]
            current_port = current_ports[port_num]

            # Check version changes
            last_version = f"{last_port.get('product', '')} {last_port.get('version', '')}".strip()
            current_version = f"{current_port.get('product', '')} {current_port.get('version', '')}".strip()

            if last_version and current_version and last_version != current_version:
                self._store_change_event(
                    cursor, device_id, target_ip,
                    'service_version_change',
                    'info',
                    last_version,
                    current_version,
                    {
                        'port': port_num,
                        'protocol': current_port.get('protocol', 'tcp'),
                        'service': current_port.get('service'),
                        'old_version': last_version,
                        'new_version': current_version
                    }
                )

    def _store_change_event(self, cursor, device_id: str, target_ip: str,
                           change_type: str, severity: str, old_value: Optional[str],
                           new_value: Optional[str], details: Optional[Dict]):
        """
        Store a change event in the nmap_change_events hypertable.

        Args:
            cursor: Database cursor
            device_id: Device identifier
            target_ip: Target IP address
            change_type: Type of change (new_port, port_closed, os_change, etc.)
            severity: Severity level (critical, warning, info)
            old_value: Previous value (optional)
            new_value: New value
            details: Additional details dictionary
        """
        change_timestamp = datetime.now()
        details_json = json.dumps(details) if details else None

        cursor.execute('''
            INSERT INTO nmap_change_events
            (time, device_id, target_ip, change_timestamp, change_type, severity,
             old_value, new_value, details, acknowledged)
            VALUES (%s, %s, %s::inet, %s, %s, %s, %s, %s, %s::jsonb, %s)
        ''', (
            change_timestamp,  # time column for hypertable
            device_id,
            target_ip,
            change_timestamp,
            change_type,
            severity,
            old_value,
            new_value,
            details_json,
            False
        ))

        debug(f"Stored change event: {change_type} for {target_ip} (severity: {severity})")

    # ============================================================================
    # SCAN HISTORY RETRIEVAL
    # ============================================================================

    def get_scan_history(self, device_id: str, target_ip: str,
                        limit: int = 10) -> List[Dict]:
        """
        Get scan history for a specific target.

        Args:
            device_id: Device identifier
            target_ip: Target IP address
            limit: Maximum number of scans to retrieve (default: 10)

        Returns:
            List[Dict]: List of scan result dictionaries, ordered by timestamp (newest first)
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cursor.execute('''
                SELECT
                    id,
                    device_id,
                    target_ip,
                    scan_type,
                    scan_timestamp,
                    scan_duration_seconds,
                    hostname,
                    host_status,
                    os_name,
                    os_accuracy,
                    os_matches,
                    total_ports,
                    open_ports_count,
                    scan_results
                FROM nmap_scan_history
                WHERE device_id = %s AND target_ip = %s::inet
                ORDER BY scan_timestamp DESC
                LIMIT %s
            ''', (device_id, target_ip, limit))

            rows = cursor.fetchall()
            scans = [dict(row) for row in rows]

            debug(f"Retrieved {len(scans)} scan history records for {target_ip}")
            return scans

        except Exception as e:
            exception(f"Failed to get scan history: {str(e)}")
            return []

        finally:
            if conn:
                conn.close()

    # ============================================================================
    # CHANGE EVENT MANAGEMENT
    # ============================================================================

    def get_change_events(self, device_id: str, target_ip: Optional[str] = None,
                         severity: Optional[str] = None, unacknowledged_only: bool = False,
                         limit: int = 100, days: int = 30) -> List[Dict]:
        """
        Get change events with optional filters.

        Args:
            device_id: Device identifier
            target_ip: Filter by target IP (None = all targets)
            severity: Filter by severity (critical, warning, info)
            unacknowledged_only: Only return unacknowledged events
            limit: Maximum number of events to retrieve
            days: Number of days to look back

        Returns:
            List[Dict]: List of change event dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            query = '''
                SELECT
                    id,
                    device_id,
                    target_ip,
                    change_timestamp,
                    change_type,
                    severity,
                    old_value,
                    new_value,
                    details,
                    acknowledged,
                    acknowledged_at,
                    acknowledged_by
                FROM nmap_change_events
                WHERE device_id = %s
                  AND time > NOW() - INTERVAL '%s days'
            '''
            params = [device_id, days]

            if target_ip:
                query += ' AND target_ip = %s::inet'
                params.append(target_ip)

            if severity:
                query += ' AND severity = %s'
                params.append(severity)

            if unacknowledged_only:
                query += ' AND acknowledged = false'

            query += ' ORDER BY change_timestamp DESC LIMIT %s'
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            events = [dict(row) for row in rows]
            debug(f"Retrieved {len(events)} change events")
            return events

        except Exception as e:
            exception(f"Failed to get change events: {str(e)}")
            return []

        finally:
            if conn:
                conn.close()

    def acknowledge_change(self, change_id: int, acknowledged_by: str) -> bool:
        """
        Mark a change event as acknowledged.

        Args:
            change_id: Change event ID
            acknowledged_by: Username of person acknowledging

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE nmap_change_events
                SET acknowledged = true,
                    acknowledged_at = NOW(),
                    acknowledged_by = %s
                WHERE id = %s
            ''', (acknowledged_by, change_id))

            conn.commit()
            debug(f"Acknowledged change event {change_id} by {acknowledged_by}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to acknowledge change: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    # ============================================================================
    # SCHEDULED SCANS
    # ============================================================================

    def create_scheduled_scan(self, device_id: str, name: str, target_type: str,
                             schedule_type: str, schedule_value: Dict, scan_type: str = 'balanced',
                             target_value: Optional[str] = None, description: Optional[str] = None,
                             created_by: Optional[str] = None) -> Optional[int]:
        """
        Create a new scheduled scan.

        Args:
            device_id: Device identifier
            name: Scan name
            target_type: Target type ('tag', 'ip', 'subnet')
            schedule_type: Schedule type ('hourly', 'daily', 'weekly')
            schedule_value: Schedule configuration dict (e.g., {"time": "18:15"})
            scan_type: Scan type ('quick', 'balanced', 'thorough')
            target_value: Target value (tag name, IP, subnet)
            description: Scan description
            created_by: Username who created the scan

        Returns:
            int: Schedule ID if successful, None if failed
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            schedule_json = json.dumps(schedule_value)

            cursor.execute('''
                INSERT INTO scheduled_scans
                (device_id, name, description, target_type, target_value, scan_type,
                 schedule_type, schedule_value, enabled, created_at, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, NOW(), %s)
                RETURNING id
            ''', (
                device_id, name, description, target_type, target_value, scan_type,
                schedule_type, schedule_json, True, created_by
            ))

            schedule_id = cursor.fetchone()[0]
            conn.commit()

            debug(f"Created scheduled scan '{name}' with ID {schedule_id}")
            return schedule_id

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to create scheduled scan: {str(e)}")
            return None

        finally:
            if conn:
                conn.close()

    def get_scheduled_scans(self, device_id: Optional[str] = None,
                           enabled_only: bool = False) -> List[Dict]:
        """
        Get all scheduled scans, optionally filtered.

        Args:
            device_id: Filter by device ID (None = all devices)
            enabled_only: Only return enabled scans

        Returns:
            List[Dict]: List of scheduled scan dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            query = '''
                SELECT * FROM scheduled_scans
                WHERE 1=1
            '''
            params = []

            if device_id:
                query += ' AND device_id = %s'
                params.append(device_id)

            if enabled_only:
                query += ' AND enabled = true'

            query += ' ORDER BY created_at DESC'

            cursor.execute(query, params)
            rows = cursor.fetchall()

            scans = [dict(row) for row in rows]
            debug(f"Retrieved {len(scans)} scheduled scans")
            return scans

        except Exception as e:
            exception(f"Failed to get scheduled scans: {str(e)}")
            return []

        finally:
            if conn:
                conn.close()

    def update_scheduled_scan(self, schedule_id: int, **kwargs) -> bool:
        """
        Update a scheduled scan.

        Args:
            schedule_id: Schedule ID
            **kwargs: Fields to update (name, description, enabled, schedule_value, etc.)

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Build dynamic UPDATE query
            update_fields = []
            params = []

            allowed_fields = ['name', 'description', 'target_type', 'target_value',
                            'scan_type', 'schedule_type', 'schedule_value', 'enabled']

            for field in allowed_fields:
                if field in kwargs:
                    if field == 'schedule_value':
                        update_fields.append(f"{field} = %s::jsonb")
                        params.append(json.dumps(kwargs[field]))
                    else:
                        update_fields.append(f"{field} = %s")
                        params.append(kwargs[field])

            if not update_fields:
                warning(f"No valid fields to update for schedule {schedule_id}")
                return False

            update_fields.append("updated_at = NOW()")
            if 'updated_by' in kwargs:
                update_fields.append("updated_by = %s")
                params.append(kwargs['updated_by'])

            params.append(schedule_id)

            query = f'''
                UPDATE scheduled_scans
                SET {', '.join(update_fields)}
                WHERE id = %s
            '''

            cursor.execute(query, params)
            conn.commit()

            debug(f"Updated scheduled scan {schedule_id}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to update scheduled scan: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    def delete_scheduled_scan(self, schedule_id: int) -> bool:
        """
        Delete a scheduled scan.

        Args:
            schedule_id: Schedule ID

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('DELETE FROM scheduled_scans WHERE id = %s', (schedule_id,))
            conn.commit()

            debug(f"Deleted scheduled scan {schedule_id}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to delete scheduled scan: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    def update_schedule_execution(self, schedule_id: int, status: str,
                                 error: Optional[str] = None,
                                 next_run: Optional[datetime] = None) -> bool:
        """
        Update scheduled scan execution status.

        Args:
            schedule_id: Schedule ID
            status: Execution status ('success', 'failed', 'skipped')
            error: Error message if failed
            next_run: Next scheduled run time

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE scheduled_scans
                SET last_run_timestamp = NOW(),
                    last_run_status = %s,
                    last_run_error = %s,
                    next_run_timestamp = %s
                WHERE id = %s
            ''', (status, error, next_run, schedule_id))

            conn.commit()
            debug(f"Updated schedule {schedule_id} execution: {status}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to update schedule execution: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    # ============================================================================
    # SCAN QUEUE
    # ============================================================================

    def create_scan_queue_entry(self, schedule_id: int, device_id: str,
                                target_ip: str, scan_type: str) -> Optional[int]:
        """
        Create a scan queue entry.

        Args:
            schedule_id: Schedule ID that triggered this scan
            device_id: Device identifier
            target_ip: Target IP to scan
            scan_type: Scan type

        Returns:
            int: Queue entry ID if successful, None if failed
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                INSERT INTO scan_queue
                (schedule_id, device_id, target_ip, scan_type, status, queued_at)
                VALUES (%s, %s, %s::inet, %s, 'queued', NOW())
                RETURNING id
            ''', (schedule_id, device_id, target_ip, scan_type))

            queue_id = cursor.fetchone()[0]
            conn.commit()

            debug(f"Created scan queue entry {queue_id} for {target_ip}")
            return queue_id

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to create scan queue entry: {str(e)}")
            return None

        finally:
            if conn:
                conn.close()

    def get_queued_scans(self, device_id: Optional[str] = None) -> List[Dict]:
        """
        Get queued scans.

        Args:
            device_id: Filter by device ID (None = all devices)

        Returns:
            List[Dict]: List of queued scan dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            query = '''
                SELECT * FROM scan_queue
                WHERE status = 'queued'
            '''
            params = []

            if device_id:
                query += ' AND device_id = %s'
                params.append(device_id)

            query += ' ORDER BY queued_at ASC'

            cursor.execute(query, params)
            rows = cursor.fetchall()

            scans = [dict(row) for row in rows]
            debug(f"Retrieved {len(scans)} queued scans")
            return scans

        except Exception as e:
            exception(f"Failed to get queued scans: {str(e)}")
            return []

        finally:
            if conn:
                conn.close()

    def update_scan_queue_entry(self, queue_id: int, **kwargs) -> bool:
        """
        Update a scan queue entry.

        Args:
            queue_id: Queue entry ID
            **kwargs: Fields to update (status, started_at, completed_at, scan_id, error_message)

        Returns:
            bool: True if successful, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Build dynamic UPDATE query
            update_fields = []
            params = []

            allowed_fields = ['status', 'started_at', 'completed_at', 'scan_id', 'error_message']

            for field in allowed_fields:
                if field in kwargs:
                    update_fields.append(f"{field} = %s")
                    params.append(kwargs[field])

            if not update_fields:
                warning(f"No valid fields to update for queue entry {queue_id}")
                return False

            params.append(queue_id)

            query = f'''
                UPDATE scan_queue
                SET {', '.join(update_fields)}
                WHERE id = %s
            '''

            cursor.execute(query, params)
            conn.commit()

            debug(f"Updated scan queue entry {queue_id}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to update scan queue entry: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()


# Singleton instance
_scan_storage_instance = None

def get_scan_storage() -> ScanStorage:
    """Get singleton ScanStorage instance"""
    global _scan_storage_instance
    if _scan_storage_instance is None:
        _scan_storage_instance = ScanStorage()
    return _scan_storage_instance
