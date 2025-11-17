"""
Nmap Scan Storage and Change Detection Module

Provides SQLite storage for nmap scan results with change detection capabilities.
Follows the throughput_storage.py pattern for consistency with PANfm architecture.

Database Tables:
- nmap_scan_history: Complete scan results with JSON storage
- nmap_port_history: Per-port details with foreign key to scans
- nmap_change_events: Detected changes with severity and acknowledgment

Version: 1.11.0 (Scan History)
Author: PANfm
"""

import sqlite3
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from logger import debug, info, warning, error, exception

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
    Manages nmap scan result storage and change detection.

    Provides methods for storing scan results, retrieving scan history,
    detecting changes between scans, and managing change events.
    """

    def __init__(self, db_path: str = 'data/nmap_scans.db'):
        """
        Initialize scan storage with database path.

        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = db_path
        debug("Initializing ScanStorage with database: %s", db_path)
        self._init_database()

    def _init_database(self):
        """
        Create database tables if they don't exist.

        Tables:
        - nmap_scan_history: Stores complete scan results
        - nmap_port_history: Stores per-port details
        - nmap_change_events: Stores detected changes
        """
        debug("Initializing nmap scan database schema")

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Table 1: Scan History (complete scan results)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS nmap_scan_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    target_ip TEXT NOT NULL,
                    scan_type TEXT NOT NULL,
                    scan_timestamp DATETIME NOT NULL,
                    scan_duration_seconds REAL,
                    hostname TEXT,
                    host_status TEXT,
                    os_name TEXT,
                    os_accuracy INTEGER,
                    os_matches_json TEXT,
                    total_ports INTEGER DEFAULT 0,
                    open_ports_count INTEGER DEFAULT 0,
                    scan_results_json TEXT,
                    raw_xml TEXT
                )
            ''')

            # Index for fast lookups by device and IP
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_scan_history_device_ip
                ON nmap_scan_history(device_id, target_ip, scan_timestamp DESC)
            ''')

            # Table 2: Port History (per-port details)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS nmap_port_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scan_id INTEGER NOT NULL,
                    port_number INTEGER NOT NULL,
                    protocol TEXT NOT NULL,
                    state TEXT NOT NULL,
                    service_name TEXT,
                    service_product TEXT,
                    service_version TEXT,
                    FOREIGN KEY (scan_id) REFERENCES nmap_scan_history(id) ON DELETE CASCADE
                )
            ''')

            # Index for fast port lookups
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_port_history_scan
                ON nmap_port_history(scan_id, port_number)
            ''')

            # Table 3: Change Events (detected changes)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS nmap_change_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    target_ip TEXT NOT NULL,
                    change_timestamp DATETIME NOT NULL,
                    change_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    old_value TEXT,
                    new_value TEXT,
                    details_json TEXT,
                    acknowledged BOOLEAN DEFAULT 0,
                    acknowledged_at DATETIME,
                    acknowledged_by TEXT
                )
            ''')

            # Index for fast change event queries
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_change_events_device_ip
                ON nmap_change_events(device_id, target_ip, change_timestamp DESC)
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_change_events_acknowledged
                ON nmap_change_events(acknowledged, severity)
            ''')

            # Table 4: Scheduled Scans (v1.12.0 - Security Monitoring)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS scheduled_scans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    target_type TEXT NOT NULL,
                    target_value TEXT,
                    scan_type TEXT NOT NULL DEFAULT 'balanced',
                    schedule_type TEXT NOT NULL,
                    schedule_value TEXT NOT NULL,
                    enabled BOOLEAN DEFAULT 1,
                    last_run_timestamp DATETIME,
                    last_run_status TEXT,
                    last_run_error TEXT,
                    next_run_timestamp DATETIME,
                    created_at DATETIME NOT NULL,
                    created_by TEXT,
                    updated_at DATETIME,
                    updated_by TEXT
                )
            ''')

            # Index for active schedules per device
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_scheduled_scans_device_enabled
                ON scheduled_scans(device_id, enabled)
            ''')

            # Table 5: Scan Queue (v1.12.0 - Execution tracking)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS scan_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    schedule_id INTEGER,
                    device_id TEXT NOT NULL,
                    target_ip TEXT NOT NULL,
                    scan_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    queued_at DATETIME NOT NULL,
                    started_at DATETIME,
                    completed_at DATETIME,
                    scan_id INTEGER,
                    error_message TEXT,
                    FOREIGN KEY (schedule_id) REFERENCES scheduled_scans(id) ON DELETE SET NULL,
                    FOREIGN KEY (scan_id) REFERENCES nmap_scan_history(id) ON DELETE SET NULL
                )
            ''')

            # Index for queue processing
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_scan_queue_status
                ON scan_queue(status, queued_at)
            ''')

            conn.commit()
            conn.close()

            info("Nmap scan database schema initialized successfully (with scheduled scans)")

        except Exception as e:
            exception("Failed to initialize nmap scan database: %s", str(e))
            raise

    def store_scan_result(self, device_id: str, target_ip: str, scan_data: Dict) -> Optional[int]:
        """
        Store nmap scan result and detect changes from previous scan.

        Args:
            device_id: Device ID that performed the scan
            target_ip: Target IP address that was scanned
            scan_data: Parsed scan results from firewall_api_nmap.parse_nmap_xml()

        Returns:
            Scan ID if successful, None if failed
        """
        debug("Storing scan result for device %s, target %s", device_id, target_ip)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Extract scan metadata
            scan_timestamp = datetime.now().isoformat()
            hostname = scan_data.get('hostname')
            host_status = scan_data.get('status')
            scan_duration = scan_data.get('scan_duration')

            # Extract OS information
            os_matches = scan_data.get('os_matches', [])
            os_name = os_matches[0].get('name') if os_matches else None
            os_accuracy = int(os_matches[0].get('accuracy', 0)) if os_matches else None
            os_matches_json = json.dumps(os_matches) if os_matches else None

            # Count ports
            ports = scan_data.get('ports', [])
            open_ports = [p for p in ports if p.get('state') == 'open']
            total_ports = len(ports)
            open_ports_count = len(open_ports)

            # Store full scan results as JSON
            scan_results_json = json.dumps(scan_data)
            raw_xml = scan_data.get('raw_xml')

            # Insert scan record
            cursor.execute('''
                INSERT INTO nmap_scan_history (
                    device_id, target_ip, scan_type, scan_timestamp,
                    scan_duration_seconds, hostname, host_status,
                    os_name, os_accuracy, os_matches_json,
                    total_ports, open_ports_count,
                    scan_results_json, raw_xml
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                device_id, target_ip, 'manual',  # scan_type will be added later
                scan_timestamp, scan_duration, hostname, host_status,
                os_name, os_accuracy, os_matches_json,
                total_ports, open_ports_count,
                scan_results_json, raw_xml
            ))

            scan_id = cursor.lastrowid
            debug("Created scan record with ID: %d", scan_id)

            # Store port details
            for port in ports:
                cursor.execute('''
                    INSERT INTO nmap_port_history (
                        scan_id, port_number, protocol, state,
                        service_name, service_product, service_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    scan_id,
                    int(port.get('port')),
                    port.get('protocol', 'tcp'),
                    port.get('state', 'unknown'),
                    port.get('service'),
                    port.get('product'),
                    port.get('version')
                ))

            debug("Stored %d port records for scan %d", len(ports), scan_id)

            conn.commit()

            # Detect changes from previous scan
            self._detect_and_store_changes(cursor, conn, device_id, target_ip, scan_data, scan_id)

            conn.commit()
            conn.close()

            info("Successfully stored scan %d for %s (%d ports)", scan_id, target_ip, total_ports)
            return scan_id

        except Exception as e:
            exception("Failed to store scan result: %s", str(e))
            return None

    def _detect_and_store_changes(self, cursor, conn, device_id: str, target_ip: str,
                                   current_scan: Dict, current_scan_id: int):
        """
        Detect changes by comparing current scan with previous scan.

        Args:
            cursor: Database cursor
            conn: Database connection
            device_id: Device ID
            target_ip: Target IP
            current_scan: Current scan data
            current_scan_id: ID of current scan
        """
        debug("Detecting changes for %s", target_ip)

        # Get previous scan
        previous_scan = self._get_last_scan_before(cursor, device_id, target_ip, current_scan_id)

        if not previous_scan:
            debug("No previous scan found for %s, skipping change detection", target_ip)
            return

        debug("Comparing with previous scan ID: %d", previous_scan['id'])

        # Parse previous scan data
        try:
            previous_data = json.loads(previous_scan['scan_results_json'])
        except:
            warning("Failed to parse previous scan data, skipping change detection")
            return

        # Detect port changes
        self._detect_port_changes(cursor, device_id, target_ip, previous_data, current_scan)

        # Detect OS changes
        self._detect_os_changes(cursor, device_id, target_ip, previous_data, current_scan)

        # Detect service version changes
        self._detect_service_changes(cursor, device_id, target_ip, previous_data, current_scan)

    def _get_last_scan_before(self, cursor, device_id: str, target_ip: str,
                               current_scan_id: int) -> Optional[Dict]:
        """
        Get the most recent scan before the current one.

        Args:
            cursor: Database cursor
            device_id: Device ID
            target_ip: Target IP
            current_scan_id: Current scan ID to exclude

        Returns:
            Previous scan record as dict, or None if no previous scan
        """
        cursor.execute('''
            SELECT * FROM nmap_scan_history
            WHERE device_id = ? AND target_ip = ? AND id < ?
            ORDER BY scan_timestamp DESC
            LIMIT 1
        ''', (device_id, target_ip, current_scan_id))

        row = cursor.fetchone()
        if not row:
            return None

        columns = [desc[0] for desc in cursor.description]
        return dict(zip(columns, row))

    def _detect_port_changes(self, cursor, device_id: str, target_ip: str,
                             previous_scan: Dict, current_scan: Dict):
        """
        Detect port state changes (opened, closed).

        Args:
            cursor: Database cursor
            device_id: Device ID
            target_ip: Target IP
            previous_scan: Previous scan data
            current_scan: Current scan data
        """
        # Get open ports from both scans
        prev_ports = {int(p['port']): p for p in previous_scan.get('ports', [])
                     if p.get('state') == 'open'}
        curr_ports = {int(p['port']): p for p in current_scan.get('ports', [])
                     if p.get('state') == 'open'}

        prev_port_nums = set(prev_ports.keys())
        curr_port_nums = set(curr_ports.keys())

        # Newly opened ports
        new_ports = curr_port_nums - prev_port_nums
        for port_num in new_ports:
            port_data = curr_ports[port_num]
            severity = 'critical' if port_num in HIGH_RISK_PORTS else 'medium'

            details = {
                'port': port_num,
                'protocol': port_data.get('protocol', 'tcp'),
                'service': port_data.get('service', 'unknown'),
                'product': port_data.get('product'),
                'version': port_data.get('version'),
                'risk_reason': HIGH_RISK_PORTS.get(port_num)
            }

            self._store_change_event(
                cursor, device_id, target_ip,
                change_type='port_opened',
                severity=severity,
                old_value=None,
                new_value=f"{port_num}/{port_data.get('protocol', 'tcp')}",
                details=details
            )

            debug("Detected new open port: %d (%s)", port_num, severity)

        # Closed ports
        closed_ports = prev_port_nums - curr_port_nums
        for port_num in closed_ports:
            port_data = prev_ports[port_num]

            details = {
                'port': port_num,
                'protocol': port_data.get('protocol', 'tcp'),
                'service': port_data.get('service', 'unknown')
            }

            self._store_change_event(
                cursor, device_id, target_ip,
                change_type='port_closed',
                severity='low',
                old_value=f"{port_num}/{port_data.get('protocol', 'tcp')}",
                new_value=None,
                details=details
            )

            debug("Detected closed port: %d", port_num)

    def _detect_os_changes(self, cursor, device_id: str, target_ip: str,
                          previous_scan: Dict, current_scan: Dict):
        """
        Detect operating system changes.

        Args:
            cursor: Database cursor
            device_id: Device ID
            target_ip: Target IP
            previous_scan: Previous scan data
            current_scan: Current scan data
        """
        prev_os = previous_scan.get('os_matches', [])
        curr_os = current_scan.get('os_matches', [])

        # Get best match from each scan
        prev_os_name = prev_os[0].get('name') if prev_os else None
        curr_os_name = curr_os[0].get('name') if curr_os else None

        if prev_os_name and curr_os_name and prev_os_name != curr_os_name:
            details = {
                'previous_os': prev_os_name,
                'previous_accuracy': prev_os[0].get('accuracy'),
                'current_os': curr_os_name,
                'current_accuracy': curr_os[0].get('accuracy')
            }

            self._store_change_event(
                cursor, device_id, target_ip,
                change_type='os_changed',
                severity='medium',
                old_value=prev_os_name,
                new_value=curr_os_name,
                details=details
            )

            debug("Detected OS change: %s -> %s", prev_os_name, curr_os_name)

    def _detect_service_changes(self, cursor, device_id: str, target_ip: str,
                                previous_scan: Dict, current_scan: Dict):
        """
        Detect service version changes on same ports.

        Args:
            cursor: Database cursor
            device_id: Device ID
            target_ip: Target IP
            previous_scan: Previous scan data
            current_scan: Current scan data
        """
        # Build port->service mapping for both scans
        prev_services = {int(p['port']): p for p in previous_scan.get('ports', [])
                        if p.get('state') == 'open'}
        curr_services = {int(p['port']): p for p in current_scan.get('ports', [])
                        if p.get('state') == 'open'}

        # Check for version changes on same ports
        common_ports = set(prev_services.keys()) & set(curr_services.keys())

        for port_num in common_ports:
            prev = prev_services[port_num]
            curr = curr_services[port_num]

            prev_version = f"{prev.get('product', '')} {prev.get('version', '')}".strip()
            curr_version = f"{curr.get('product', '')} {curr.get('version', '')}".strip()

            if prev_version and curr_version and prev_version != curr_version:
                details = {
                    'port': port_num,
                    'protocol': curr.get('protocol', 'tcp'),
                    'service': curr.get('service', 'unknown'),
                    'previous_version': prev_version,
                    'current_version': curr_version
                }

                self._store_change_event(
                    cursor, device_id, target_ip,
                    change_type='service_version_changed',
                    severity='low',
                    old_value=prev_version,
                    new_value=curr_version,
                    details=details
                )

                debug("Detected service version change on port %d: %s -> %s",
                     port_num, prev_version, curr_version)

    def _store_change_event(self, cursor, device_id: str, target_ip: str,
                           change_type: str, severity: str,
                           old_value: Optional[str], new_value: Optional[str],
                           details: Dict):
        """
        Store a detected change event.

        Args:
            cursor: Database cursor
            device_id: Device ID
            target_ip: Target IP
            change_type: Type of change (port_opened, port_closed, etc.)
            severity: Severity level (low, medium, high, critical)
            old_value: Previous value
            new_value: New value
            details: Additional details as dict
        """
        change_timestamp = datetime.now().isoformat()
        details_json = json.dumps(details)

        cursor.execute('''
            INSERT INTO nmap_change_events (
                device_id, target_ip, change_timestamp,
                change_type, severity, old_value, new_value, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            device_id, target_ip, change_timestamp,
            change_type, severity, old_value, new_value, details_json
        ))

        debug("Stored change event: %s (%s)", change_type, severity)

    def get_scan_history(self, device_id: str, target_ip: str,
                        limit: int = 10) -> List[Dict]:
        """
        Retrieve scan history for a target IP.

        Args:
            device_id: Device ID
            target_ip: Target IP address
            limit: Maximum number of scans to return

        Returns:
            List of scan records (most recent first)
        """
        debug("Retrieving scan history for %s (limit: %d)", target_ip, limit)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute('''
                SELECT * FROM nmap_scan_history
                WHERE device_id = ? AND target_ip = ?
                ORDER BY scan_timestamp DESC
                LIMIT ?
            ''', (device_id, target_ip, limit))

            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            scans = []
            for row in rows:
                scan = dict(zip(columns, row))

                # Parse JSON fields
                if scan.get('os_matches_json'):
                    try:
                        scan['os_matches'] = json.loads(scan['os_matches_json'])
                    except:
                        scan['os_matches'] = []

                if scan.get('scan_results_json'):
                    try:
                        scan['scan_results'] = json.loads(scan['scan_results_json'])
                    except:
                        scan['scan_results'] = {}

                scans.append(scan)

            conn.close()

            debug("Retrieved %d scan records for %s", len(scans), target_ip)
            return scans

        except Exception as e:
            exception("Failed to retrieve scan history: %s", str(e))
            return []

    def get_change_events(self, device_id: str, target_ip: Optional[str] = None,
                         severity: Optional[str] = None, acknowledged: Optional[bool] = None,
                         limit: int = 50) -> List[Dict]:
        """
        Retrieve change events with optional filtering.

        Args:
            device_id: Device ID
            target_ip: Optional filter by target IP
            severity: Optional filter by severity (low, medium, high, critical)
            acknowledged: Optional filter by acknowledgment status
            limit: Maximum number of events to return

        Returns:
            List of change event records (most recent first)
        """
        debug("Retrieving change events for device %s (filters: ip=%s, severity=%s, ack=%s)",
             device_id, target_ip, severity, acknowledged)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Build query with filters
            query = 'SELECT * FROM nmap_change_events WHERE device_id = ?'
            params = [device_id]

            if target_ip:
                query += ' AND target_ip = ?'
                params.append(target_ip)

            if severity:
                query += ' AND severity = ?'
                params.append(severity)

            if acknowledged is not None:
                query += ' AND acknowledged = ?'
                params.append(1 if acknowledged else 0)

            query += ' ORDER BY change_timestamp DESC LIMIT ?'
            params.append(limit)

            cursor.execute(query, params)

            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            events = []
            for row in rows:
                event = dict(zip(columns, row))

                # Parse details JSON
                if event.get('details_json'):
                    try:
                        event['details'] = json.loads(event['details_json'])
                    except:
                        event['details'] = {}

                events.append(event)

            conn.close()

            debug("Retrieved %d change events", len(events))
            return events

        except Exception as e:
            exception("Failed to retrieve change events: %s", str(e))
            return []

    def acknowledge_change(self, change_id: int, acknowledged_by: str) -> bool:
        """
        Mark a change event as acknowledged.

        Args:
            change_id: Change event ID
            acknowledged_by: Username of person acknowledging

        Returns:
            True if successful, False otherwise
        """
        debug("Acknowledging change event %d by %s", change_id, acknowledged_by)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            acknowledged_at = datetime.now().isoformat()

            cursor.execute('''
                UPDATE nmap_change_events
                SET acknowledged = 1, acknowledged_at = ?, acknowledged_by = ?
                WHERE id = ?
            ''', (acknowledged_at, acknowledged_by, change_id))

            conn.commit()
            conn.close()

            info("Change event %d acknowledged by %s", change_id, acknowledged_by)
            return True

        except Exception as e:
            exception("Failed to acknowledge change event: %s", str(e))
            return False


    # ========================================================================
    # Scheduled Scans Management (v1.12.0)
    # ========================================================================

    def create_scheduled_scan(self, device_id: str, name: str, target_type: str,
                             target_value: Optional[str], scan_type: str,
                             schedule_type: str, schedule_value: str,
                             description: Optional[str] = None,
                             created_by: str = 'admin') -> Optional[int]:
        """
        Create a new scheduled scan.

        Args:
            device_id: Device ID (firewall) that will perform the scan
            name: Friendly name for the schedule
            target_type: Type of target ('tag', 'location', 'ip', 'all')
            target_value: Value for target (tag name, location name, IP, or null for 'all')
            scan_type: Scan type ('quick', 'balanced', 'thorough')
            schedule_type: Schedule type ('interval', 'daily', 'weekly', 'cron')
            schedule_value: Schedule value (e.g., '3600' for interval, '14:00' for daily, cron expression)
            description: Optional description
            created_by: Username who created the schedule

        Returns:
            Schedule ID if successful, None if failed
        """
        debug("Creating scheduled scan: %s for device %s", name, device_id)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            created_at = datetime.now().isoformat()

            cursor.execute('''
                INSERT INTO scheduled_scans (
                    device_id, name, description, target_type, target_value,
                    scan_type, schedule_type, schedule_value,
                    enabled, created_at, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ''', (
                device_id, name, description, target_type, target_value,
                scan_type, schedule_type, schedule_value,
                created_at, created_by
            ))

            schedule_id = cursor.lastrowid
            conn.commit()
            conn.close()

            info("Created scheduled scan %d: %s", schedule_id, name)
            return schedule_id

        except Exception as e:
            exception("Failed to create scheduled scan: %s", str(e))
            return None

    def get_scheduled_scans(self, device_id: Optional[str] = None,
                           enabled_only: bool = False) -> List[Dict]:
        """
        Retrieve scheduled scans with optional filtering.

        Args:
            device_id: Optional filter by device ID
            enabled_only: Only return enabled schedules

        Returns:
            List of scheduled scan records
        """
        debug("Retrieving scheduled scans (device=%s, enabled_only=%s)", device_id, enabled_only)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            query = 'SELECT * FROM scheduled_scans WHERE 1=1'
            params = []

            if device_id:
                query += ' AND device_id = ?'
                params.append(device_id)

            if enabled_only:
                query += ' AND enabled = 1'

            query += ' ORDER BY created_at DESC'

            cursor.execute(query, params)

            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            schedules = [dict(zip(columns, row)) for row in rows]

            conn.close()

            debug("Retrieved %d scheduled scans", len(schedules))
            return schedules

        except Exception as e:
            exception("Failed to retrieve scheduled scans: %s", str(e))
            return []

    def update_scheduled_scan(self, schedule_id: int, **kwargs) -> bool:
        """
        Update a scheduled scan.

        Args:
            schedule_id: Schedule ID to update
            **kwargs: Fields to update (name, description, target_type, target_value,
                     scan_type, schedule_type, schedule_value, enabled)

        Returns:
            True if successful, False otherwise
        """
        debug("Updating scheduled scan %d", schedule_id)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Build UPDATE query dynamically
            allowed_fields = ['name', 'description', 'target_type', 'target_value',
                            'scan_type', 'schedule_type', 'schedule_value', 'enabled']

            update_fields = []
            update_values = []

            for field in allowed_fields:
                if field in kwargs:
                    update_fields.append(f"{field} = ?")
                    update_values.append(kwargs[field])

            if not update_fields:
                warning("No fields to update for schedule %d", schedule_id)
                return False

            # Add updated_at and updated_by
            update_fields.append("updated_at = ?")
            update_values.append(datetime.now().isoformat())

            if 'updated_by' in kwargs:
                update_fields.append("updated_by = ?")
                update_values.append(kwargs['updated_by'])

            update_values.append(schedule_id)

            query = f"UPDATE scheduled_scans SET {', '.join(update_fields)} WHERE id = ?"

            cursor.execute(query, update_values)
            conn.commit()
            conn.close()

            info("Updated scheduled scan %d", schedule_id)
            return True

        except Exception as e:
            exception("Failed to update scheduled scan: %s", str(e))
            return False

    def delete_scheduled_scan(self, schedule_id: int) -> bool:
        """
        Delete a scheduled scan.

        Args:
            schedule_id: Schedule ID to delete

        Returns:
            True if successful, False otherwise
        """
        debug("Deleting scheduled scan %d", schedule_id)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute('DELETE FROM scheduled_scans WHERE id = ?', (schedule_id,))

            conn.commit()
            conn.close()

            info("Deleted scheduled scan %d", schedule_id)
            return True

        except Exception as e:
            exception("Failed to delete scheduled scan: %s", str(e))
            return False

    def update_schedule_execution(self, schedule_id: int, status: str,
                                  error: Optional[str] = None) -> bool:
        """
        Update schedule execution tracking.

        Args:
            schedule_id: Schedule ID
            status: Execution status ('success', 'failed', 'skipped')
            error: Optional error message

        Returns:
            True if successful, False otherwise
        """
        debug("Updating schedule %d execution: %s", schedule_id, status)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            timestamp = datetime.now().isoformat()

            cursor.execute('''
                UPDATE scheduled_scans
                SET last_run_timestamp = ?,
                    last_run_status = ?,
                    last_run_error = ?
                WHERE id = ?
            ''', (timestamp, status, error, schedule_id))

            conn.commit()
            conn.close()

            return True

        except Exception as e:
            exception("Failed to update schedule execution: %s", str(e))
            return False

    def create_scan_queue_entry(self, schedule_id: int, device_id: str,
                                target_ip: str, scan_type: str, status: str,
                                queued_at: str) -> Optional[int]:
        """
        Create a scan queue entry.

        Args:
            schedule_id: ID of schedule that triggered this scan
            device_id: Device ID (firewall)
            target_ip: Target IP address
            scan_type: Scan type ('quick', 'balanced', 'thorough')
            status: Queue status ('queued', 'running', 'completed', 'failed')
            queued_at: ISO timestamp when queued

        Returns:
            Queue ID if successful, None if failed
        """
        debug("Creating scan queue entry: device=%s, ip=%s", device_id, target_ip)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute('''
                INSERT INTO scan_queue (
                    schedule_id, device_id, target_ip, scan_type,
                    status, queued_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                schedule_id, device_id, target_ip, scan_type,
                status, queued_at
            ))

            queue_id = cursor.lastrowid
            conn.commit()
            conn.close()

            info("Created scan queue entry %d", queue_id)
            return queue_id

        except Exception as e:
            exception("Failed to create scan queue entry: %s", str(e))
            return None

    def get_queued_scans(self, device_id: Optional[str] = None) -> List[Dict]:
        """
        Get queued scans, optionally filtered by device.
        Includes schedule name when available.

        Args:
            device_id: Optional device ID filter

        Returns:
            List of queue entry dicts with schedule_name field
        """
        debug("Getting queued scans (device=%s)", device_id)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Join with scheduled_scans to get schedule name
            query = """
                SELECT
                    sq.*,
                    ss.name as schedule_name
                FROM scan_queue sq
                LEFT JOIN scheduled_scans ss ON sq.schedule_id = ss.id
                WHERE sq.status IN ('queued', 'running')
            """
            params = []

            if device_id:
                query += " AND sq.device_id = ?"
                params.append(device_id)

            query += " ORDER BY sq.queued_at ASC"

            cursor.execute(query, params)

            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            queued = [dict(zip(columns, row)) for row in rows]

            conn.close()

            debug("Retrieved %d queued scans", len(queued))
            return queued

        except Exception as e:
            exception("Failed to get queued scans: %s", str(e))
            return []

    def update_scan_queue_entry(self, queue_id: int, **kwargs) -> bool:
        """
        Update a scan queue entry.

        Args:
            queue_id: Queue ID to update
            **kwargs: Fields to update (status, started_at, completed_at, scan_id, error_message)

        Returns:
            True if successful, False otherwise
        """
        debug("Updating scan queue entry %d", queue_id)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Build UPDATE query dynamically
            allowed_fields = ['status', 'started_at', 'completed_at', 'scan_id', 'error_message']

            update_fields = []
            update_values = []

            for field in allowed_fields:
                if field in kwargs:
                    update_fields.append(f"{field} = ?")
                    update_values.append(kwargs[field])

            if not update_fields:
                warning("No fields to update for queue entry %d", queue_id)
                return False

            update_values.append(queue_id)

            query = f"UPDATE scan_queue SET {', '.join(update_fields)} WHERE id = ?"

            cursor.execute(query, update_values)
            conn.commit()
            conn.close()

            debug("Updated scan queue entry %d", queue_id)
            return True

        except Exception as e:
            exception("Failed to update scan queue entry: %s", str(e))
            return False


# Module initialization
debug("scan_storage module loaded (v1.12.0 - with scheduled scans)")
