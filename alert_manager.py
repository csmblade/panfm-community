"""
Alert Management System for PANfm - PostgreSQL/TimescaleDB Version
Refactored from SQLite to PostgreSQL for v2.0.0 TimescaleDB migration
"""
import sys
import os
import json
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from logger import debug, info, warning, error, exception

# PostgreSQL connection string
PG_CONN = "dbname=panfm_db user=panfm password=panfm_secure_password host=localhost port=5432"


class AlertManager:
    """
    Manages alert configurations, threshold checking, and alert history.
    Uses PostgreSQL/TimescaleDB for storage.

    Responsibilities:
    - CRUD operations for alert configurations
    - Threshold evaluation against current metrics
    - Alert history management (hypertable)
    - Maintenance window handling
    - Notification channel management
    """

    def __init__(self, pg_conn: str = PG_CONN):
        """
        Initialize alert manager with PostgreSQL connection.

        Args:
            pg_conn: PostgreSQL connection string
        """
        self.pg_conn = pg_conn
        debug(f"AlertManager initialized with PostgreSQL connection")
        # Note: Schema is managed via migrations, no need to create tables here

    def _get_connection(self):
        """Get PostgreSQL database connection"""
        return psycopg2.connect(self.pg_conn)

    # ============================================================================
    # ALERT CONFIGURATIONS - CRUD Operations
    # ============================================================================

    def create_alert_config(self, device_id: str, metric_type: str, threshold_value: float,
                           threshold_operator: str, severity: str,
                           notification_channels: List[int] = None) -> Optional[int]:
        """
        Create a new alert configuration.

        Args:
            device_id: Device identifier
            metric_type: Type of metric to monitor (cpu, memory, sessions, etc.)
            threshold_value: Threshold value to trigger alert
            threshold_operator: Comparison operator (>, <, >=, <=, ==, !=)
            severity: Alert severity (info, warning, critical)
            notification_channels: List of notification channel IDs

        Returns:
            int: Created alert config ID, or None if failed
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Convert notification channels list to JSONB
            channels_json = json.dumps(notification_channels or [])

            cursor.execute('''
                INSERT INTO alert_configs
                (device_id, metric_type, threshold_value, threshold_operator, severity,
                 enabled, notification_channels, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, NOW(), NOW())
                RETURNING id
            ''', (device_id, metric_type, threshold_value, threshold_operator, severity,
                  True, channels_json))

            alert_id = cursor.fetchone()[0]
            conn.commit()

            debug(f"Created alert config ID {alert_id}: {metric_type} {threshold_operator} {threshold_value} for device {device_id}")
            return alert_id

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to create alert config: {str(e)}")
            return None

        finally:
            if conn:
                conn.close()

    def get_alert_config(self, alert_id: int) -> Optional[Dict]:
        """Get a single alert configuration by ID"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cursor.execute('''
                SELECT id, device_id, metric_type, threshold_value, threshold_operator,
                       severity, enabled, notification_channels, created_at, updated_at
                FROM alert_configs
                WHERE id = %s
            ''', (alert_id,))

            row = cursor.fetchone()
            if row:
                config = dict(row)
                # Parse JSONB notification_channels
                if isinstance(config['notification_channels'], str):
                    config['notification_channels'] = json.loads(config['notification_channels'])
                return config
            return None

        except Exception as e:
            exception(f"Failed to get alert config {alert_id}: {str(e)}")
            return None

        finally:
            if conn:
                conn.close()

    def get_all_alert_configs(self, device_id: str = None, enabled_only: bool = False) -> List[Dict]:
        """
        Get all alert configurations, optionally filtered by device and/or enabled status.

        Args:
            device_id: Filter by device ID (None = all devices)
            enabled_only: Only return enabled alerts

        Returns:
            List of alert configuration dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            query = '''
                SELECT id, device_id, metric_type, threshold_value, threshold_operator,
                       severity, enabled, notification_channels, created_at, updated_at
                FROM alert_configs
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

            configs = []
            for row in rows:
                config = dict(row)
                # Parse JSONB notification_channels
                if isinstance(config['notification_channels'], str):
                    config['notification_channels'] = json.loads(config['notification_channels'])
                configs.append(config)

            debug(f"Retrieved {len(configs)} alert configs (device_id={device_id}, enabled_only={enabled_only})")
            return configs

        except Exception as e:
            exception(f"Failed to get alert configs: {str(e)}")
            return []

        finally:
            if conn:
                conn.close()

    def update_alert_config(self, alert_id: int, **kwargs) -> bool:
        """
        Update an alert configuration.

        Args:
            alert_id: Alert configuration ID
            **kwargs: Fields to update (device_id, metric_type, threshold_value, etc.)

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

            allowed_fields = ['device_id', 'metric_type', 'threshold_value', 'threshold_operator',
                            'severity', 'enabled', 'notification_channels']

            for field in allowed_fields:
                if field in kwargs:
                    if field == 'notification_channels':
                        update_fields.append(f"{field} = %s::jsonb")
                        params.append(json.dumps(kwargs[field]))
                    else:
                        update_fields.append(f"{field} = %s")
                        params.append(kwargs[field])

            if not update_fields:
                warning(f"No valid fields to update for alert {alert_id}")
                return False

            update_fields.append("updated_at = NOW()")
            params.append(alert_id)

            query = f'''
                UPDATE alert_configs
                SET {', '.join(update_fields)}
                WHERE id = %s
            '''

            cursor.execute(query, params)
            conn.commit()

            debug(f"Updated alert config {alert_id}: {kwargs}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to update alert config {alert_id}: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    def delete_alert_config(self, alert_id: int) -> bool:
        """Delete an alert configuration (cascade deletes alert history)"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('DELETE FROM alert_configs WHERE id = %s', (alert_id,))
            conn.commit()

            debug(f"Deleted alert config {alert_id}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to delete alert config {alert_id}: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    # ============================================================================
    # ALERT HISTORY - Time-series data in hypertable
    # ============================================================================

    def trigger_alert(self, alert_config_id: int, device_id: str, metric_type: str,
                     threshold_value: float, actual_value: float, severity: str,
                     message: str) -> Optional[int]:
        """
        Record a triggered alert in the alert_history hypertable.

        Args:
            alert_config_id: ID of the alert configuration
            device_id: Device identifier
            metric_type: Type of metric
            threshold_value: Configured threshold
            actual_value: Actual value that triggered the alert
            severity: Alert severity
            message: Alert message

        Returns:
            int: Alert history ID, or None if failed
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Insert into hypertable (time column auto-populated with NOW())
            cursor.execute('''
                INSERT INTO alert_history
                (time, alert_config_id, device_id, metric_type, threshold_value,
                 actual_value, severity, message, triggered_at)
                VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, NOW())
                RETURNING id
            ''', (alert_config_id, device_id, metric_type, threshold_value,
                  actual_value, severity, message))

            alert_history_id = cursor.fetchone()[0]
            conn.commit()

            info(f"Alert triggered: {message} (ID: {alert_history_id})")
            return alert_history_id

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to trigger alert: {str(e)}")
            return None

        finally:
            if conn:
                conn.close()

    def get_alert_history(self, device_id: str = None, metric_type: str = None,
                         severity: str = None, unacknowledged_only: bool = False,
                         limit: int = 100, days: int = 7) -> List[Dict]:
        """
        Get alert history from hypertable with optional filters.

        Args:
            device_id: Filter by device ID
            metric_type: Filter by metric type
            severity: Filter by severity
            unacknowledged_only: Only return unacknowledged alerts
            limit: Maximum number of results
            days: Number of days to look back

        Returns:
            List of alert history dictionaries
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            query = '''
                SELECT id, time, alert_config_id, device_id, metric_type,
                       threshold_value, actual_value, severity, message,
                       triggered_at, acknowledged_at, acknowledged_by,
                       resolved_at, resolved_reason
                FROM alert_history
                WHERE time > NOW() - INTERVAL '%s days'
            '''
            params = [days]

            if device_id:
                query += ' AND device_id = %s'
                params.append(device_id)

            if metric_type:
                query += ' AND metric_type = %s'
                params.append(metric_type)

            if severity:
                query += ' AND severity = %s'
                params.append(severity)

            if unacknowledged_only:
                query += ' AND acknowledged_at IS NULL'

            query += ' ORDER BY time DESC LIMIT %s'
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            alerts = [dict(row) for row in rows]
            debug(f"Retrieved {len(alerts)} alert history records")
            return alerts

        except Exception as e:
            exception(f"Failed to get alert history: {str(e)}")
            return []

        finally:
            if conn:
                conn.close()

    def acknowledge_alert(self, alert_history_id: int, acknowledged_by: str) -> bool:
        """Mark an alert as acknowledged"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE alert_history
                SET acknowledged_at = NOW(),
                    acknowledged_by = %s
                WHERE id = %s
            ''', (acknowledged_by, alert_history_id))

            conn.commit()
            debug(f"Alert {alert_history_id} acknowledged by {acknowledged_by}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to acknowledge alert {alert_history_id}: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    def resolve_alert(self, alert_history_id: int, resolved_reason: str = None) -> bool:
        """Mark an alert as resolved"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE alert_history
                SET resolved_at = NOW(),
                    resolved_reason = %s
                WHERE id = %s
            ''', (resolved_reason, alert_history_id))

            conn.commit()
            debug(f"Alert {alert_history_id} resolved: {resolved_reason}")
            return True

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Failed to resolve alert {alert_history_id}: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    # ============================================================================
    # THRESHOLD EVALUATION
    # ============================================================================

    def check_thresholds(self, device_id: str, metrics: Dict[str, float]) -> List[Dict]:
        """
        Check if any thresholds are exceeded for the given metrics.

        Args:
            device_id: Device identifier
            metrics: Dictionary of metric_type -> value

        Returns:
            List of dictionaries with triggered alerts:
            [{'config': alert_config_dict, 'actual_value': float}, ...]
        """
        debug(f"Checking thresholds for device {device_id} with {len(metrics)} metrics")

        # Check if device is in maintenance window
        if self.is_in_maintenance_window(device_id):
            debug(f"Device {device_id} is in maintenance window, skipping threshold checks")
            return []

        triggered_alerts = []
        configs = self.get_all_alert_configs(device_id=device_id, enabled_only=True)

        debug(f"Found {len(configs)} enabled alert configs for device {device_id}")

        for config in configs:
            metric_type = config['metric_type']
            if metric_type not in metrics:
                debug(f"Metric {metric_type} not in provided metrics, skipping")
                continue

            actual_value = metrics[metric_type]
            threshold_value = config['threshold_value']
            operator = config['threshold_operator']

            # Evaluate threshold
            if self._evaluate_threshold(actual_value, threshold_value, operator):
                # Check cooldown to avoid alert spam
                cooldown_seconds = 900  # 15 minutes default
                if self.check_cooldown(device_id, config['id'], cooldown_seconds):
                    debug(f"Alert {config['id']} is in cooldown, skipping")
                    continue

                debug(f"Threshold exceeded: {metric_type} {operator} {threshold_value} (actual: {actual_value})")
                triggered_alerts.append({
                    'config': config,
                    'actual_value': actual_value
                })

        debug(f"Found {len(triggered_alerts)} triggered alerts for device {device_id}")
        return triggered_alerts

    def _evaluate_threshold(self, actual: float, threshold: float, operator: str) -> bool:
        """
        Evaluate if actual value exceeds threshold based on operator.

        Args:
            actual: Actual metric value
            threshold: Threshold value
            operator: Comparison operator (>, <, >=, <=, ==, !=)

        Returns:
            bool: True if threshold exceeded, False otherwise
        """
        try:
            if operator == '>':
                return actual > threshold
            elif operator == '<':
                return actual < threshold
            elif operator == '>=':
                return actual >= threshold
            elif operator == '<=':
                return actual <= threshold
            elif operator == '==':
                return actual == threshold
            elif operator == '!=':
                return actual != threshold
            else:
                warning(f"Unknown operator: {operator}")
                return False
        except Exception as e:
            exception(f"Error evaluating threshold: {str(e)}")
            return False

    # ============================================================================
    # MAINTENANCE WINDOWS
    # ============================================================================

    def is_in_maintenance_window(self, device_id: str) -> bool:
        """
        Check if device is currently in a maintenance window.

        Args:
            device_id: Device identifier

        Returns:
            bool: True if in maintenance window, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            now = datetime.now()

            cursor.execute('''
                SELECT id, start_time, end_time, recurrence_pattern
                FROM maintenance_windows
                WHERE device_id = %s AND enabled = true
            ''', (device_id,))

            windows = cursor.fetchall()

            for window in windows:
                start_time = window['start_time']
                end_time = window['end_time']
                recurrence = window['recurrence_pattern']

                # Check if current time is within window
                if recurrence == 'once':
                    if start_time <= now <= end_time:
                        debug(f"Device {device_id} is in one-time maintenance window")
                        return True
                elif recurrence == 'daily':
                    # Check if current time matches daily window time range
                    current_time = now.time()
                    if start_time.time() <= current_time <= end_time.time():
                        debug(f"Device {device_id} is in daily maintenance window")
                        return True
                elif recurrence == 'weekly':
                    # Check if current day and time match weekly window
                    if now.weekday() == start_time.weekday():
                        current_time = now.time()
                        if start_time.time() <= current_time <= end_time.time():
                            debug(f"Device {device_id} is in weekly maintenance window")
                            return True

            return False

        except Exception as e:
            exception(f"Error checking maintenance window for device {device_id}: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    # ============================================================================
    # COOLDOWN MANAGEMENT
    # ============================================================================

    def check_cooldown(self, device_id: str, alert_config_id: int, cooldown_seconds: int = 900) -> bool:
        """
        Check if alert is in cooldown period.

        Args:
            device_id: Device identifier
            alert_config_id: Alert configuration ID
            cooldown_seconds: Cooldown period in seconds (default 15 minutes)

        Returns:
            bool: True if in cooldown, False otherwise
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                SELECT cooldown_until
                FROM alert_cooldowns
                WHERE device_id = %s AND alert_config_id = %s
            ''', (device_id, alert_config_id))

            row = cursor.fetchone()
            if row and row[0]:
                cooldown_until = row[0]
                if datetime.now() < cooldown_until:
                    debug(f"Alert {alert_config_id} for device {device_id} is in cooldown until {cooldown_until}")
                    return True

            return False

        except Exception as e:
            exception(f"Error checking cooldown: {str(e)}")
            return False

        finally:
            if conn:
                conn.close()

    def set_cooldown(self, device_id: str, alert_config_id: int, cooldown_seconds: int = 900):
        """
        Set cooldown period for an alert.

        Args:
            device_id: Device identifier
            alert_config_id: Alert configuration ID
            cooldown_seconds: Cooldown period in seconds (default 15 minutes)
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cooldown_until = datetime.now() + timedelta(seconds=cooldown_seconds)

            # Upsert cooldown record
            cursor.execute('''
                INSERT INTO alert_cooldowns (device_id, alert_config_id, cooldown_until, created_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (device_id, alert_config_id)
                DO UPDATE SET cooldown_until = EXCLUDED.cooldown_until, created_at = NOW()
            ''', (device_id, alert_config_id, cooldown_until))

            conn.commit()
            debug(f"Set cooldown for alert {alert_config_id} on device {device_id} until {cooldown_until}")

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Error setting cooldown: {str(e)}")

        finally:
            if conn:
                conn.close()

    def clear_expired_cooldowns(self):
        """Remove expired cooldown records"""
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                DELETE FROM alert_cooldowns
                WHERE cooldown_until < NOW()
            ''')

            deleted_count = cursor.rowcount
            conn.commit()

            if deleted_count > 0:
                debug(f"Cleared {deleted_count} expired cooldown records")

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Error clearing expired cooldowns: {str(e)}")

        finally:
            if conn:
                conn.close()

    # ============================================================================
    # CLEANUP AND UTILITY
    # ============================================================================

    def cleanup_old_alert_history(self, days: int = 90):
        """
        Clean up alert history older than specified days.

        Args:
            days: Number of days to retain (default 90)
        """
        conn = None
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute('''
                DELETE FROM alert_history
                WHERE time < NOW() - INTERVAL '%s days'
            ''', (days,))

            deleted_count = cursor.rowcount
            conn.commit()

            if deleted_count > 0:
                info(f"Cleaned up {deleted_count} alert history records older than {days} days")

        except Exception as e:
            if conn:
                conn.rollback()
            exception(f"Error cleaning up alert history: {str(e)}")

        finally:
            if conn:
                conn.close()

    def get_metric_display_name(self, metric_type: str) -> str:
        """
        Get human-readable display name for metric type.

        Args:
            metric_type: Metric type code

        Returns:
            str: Display name
        """
        metric_names = {
            'cpu': 'CPU Usage',
            'memory': 'Memory Usage',
            'sessions': 'Session Count',
            'threats': 'Threat Activity',
            'interface_errors': 'Interface Errors',
            'interface_down': 'Interface Status',
            'disk': 'Disk Usage',
            'license_expiring': 'License Expiration',
            'firewall_unreachable': 'Firewall Health'
        }
        return metric_names.get(metric_type, metric_type.replace('_', ' ').title())

    def format_alert_message(self, metric_type: str, actual_value: float, threshold_value: float, operator: str) -> str:
        """
        Format alert message with metric details.

        Args:
            metric_type: Metric type
            actual_value: Actual metric value
            threshold_value: Threshold value
            operator: Comparison operator

        Returns:
            str: Formatted alert message
        """
        metric_name = self.get_metric_display_name(metric_type)

        # Format based on metric type
        if metric_type in ['cpu', 'memory', 'disk']:
            return f"{metric_name} is {actual_value:.1f}% (threshold: {operator} {threshold_value:.1f}%)"
        elif metric_type == 'sessions':
            return f"{metric_name} is {int(actual_value)} (threshold: {operator} {int(threshold_value)})"
        elif metric_type == 'threats':
            return f"{metric_name}: {int(actual_value)} threats detected (threshold: {operator} {int(threshold_value)})"
        elif metric_type == 'interface_errors':
            return f"{metric_name}: {int(actual_value)} errors/minute (threshold: {operator} {int(threshold_value)})"
        elif metric_type == 'interface_down':
            return f"{metric_name}: Interface is down"
        elif metric_type == 'license_expiring':
            return f"{metric_name}: License expires in {int(actual_value)} days (threshold: {operator} {int(threshold_value)} days)"
        elif metric_type == 'firewall_unreachable':
            return f"{metric_name}: Firewall is unreachable"
        else:
            return f"{metric_name}: {actual_value} (threshold: {operator} {threshold_value})"


# Singleton instance
_alert_manager_instance = None

def get_alert_manager() -> AlertManager:
    """Get singleton AlertManager instance"""
    global _alert_manager_instance
    if _alert_manager_instance is None:
        _alert_manager_instance = AlertManager()
    return _alert_manager_instance

# Backward compatibility: Create lowercase instance for old imports
# (alert_templates.py, routes_alerts.py, throughput_collector.py use this)
alert_manager = get_alert_manager()

# Backward compatibility: Export format_alert_message as standalone function
# (throughput_collector.py imports this)
def format_alert_message(metric_type: str, actual_value: float, threshold_value: float, operator: str) -> str:
    """Backward compatible wrapper for alert_manager.format_alert_message()"""
    return alert_manager.format_alert_message(metric_type, actual_value, threshold_value, operator)
