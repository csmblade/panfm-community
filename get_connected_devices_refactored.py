"""
Refactored get_connected_devices() method for throughput_storage_timescale.py
Replace lines 663-713 with this implementation
"""

def get_connected_devices(self, device_id: str, max_age_seconds: int = 90) -> list:
    """
    Get connected devices from TimescaleDB connected_devices hypertable.

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

        # Query connected devices from TimescaleDB hypertable
        cursor.execute('''
            SELECT
                id,
                time,
                device_id,
                ip,
                mac,
                hostname,
                interface,
                vlan_id,
                vendor,
                timestamp,
                created_at
            FROM connected_devices
            WHERE device_id = %s AND time >= %s
            ORDER BY time DESC
        ''', (device_id, cutoff_time))

        rows = cursor.fetchall()

        # Convert rows to list of dicts
        devices = [dict(row) for row in rows]
        debug(f"Retrieved {len(devices)} connected devices from TimescaleDB (max_age={max_age_seconds}s)")
        return devices

    except Exception as e:
        exception(f"Error fetching connected devices from TimescaleDB: {str(e)}")
        return []

    finally:
        if conn:
            self._return_connection(conn)
