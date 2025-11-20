"""
Throughput Collector Module

Background service for collecting and storing historical network throughput data.
Runs as scheduled job via APScheduler to periodically collect data from enabled devices.

Author: PANfm Development Team
Created: 2025-11-06
"""

import sys
import json
from datetime import datetime, timedelta
from typing import Dict, Optional
from logger import debug, info, warning, error, exception
from device_manager import device_manager
from firewall_api import get_throughput_data, get_firewall_config
from firewall_api_logs import get_system_logs, get_threat_stats, get_traffic_logs
from firewall_api_metrics import get_disk_usage
from firewall_api_health import get_database_versions
from config import TIMESCALE_DSN, USE_TIMESCALE

# PANfm v2.0.0 - TimescaleDB Only (SQLite removed)
from throughput_storage_timescale import TimescaleStorage as ThroughputStorage
info("PANfm v2.0.0: Using TimescaleDB for throughput storage")

from alert_manager import alert_manager, format_alert_message
from notification_manager import notification_manager

# Severity-based cooldown period constants (in seconds)
# Each severity level can have its own cooldown duration to provide granular control
_COOLDOWN_INFO_SECONDS = 300      # 5 minutes for INFO alerts
_COOLDOWN_WARNING_SECONDS = 300   # 5 minutes for WARNING alerts
_COOLDOWN_CRITICAL_SECONDS = 300  # 5 minutes for CRITICAL alerts


class ThroughputCollector:
    """Background collector for network throughput data."""

    def __init__(self, storage: ThroughputStorage, retention_days: int = 90):
        """
        Initialize the throughput collector.

        Args:
            storage: TimescaleStorage instance (TimescaleDB only as of v2.0.0)
            retention_days: Number of days to retain (ignored - TimescaleDB uses automatic retention policies)
        """
        self.storage = storage
        self.retention_days = retention_days
        self.collection_count = 0
        self.last_cleanup = None

        storage_type = "TimescaleDB" if USE_TIMESCALE else "SQLite"
        debug("ThroughputCollector initialized with %s storage (retention: %d days)",
              storage_type, retention_days)

    def collect_all_devices(self):
        """
        Collect throughput data from all enabled devices and store in database.

        This is the main collection function called by the APScheduler job.
        """
        debug("Starting throughput collection cycle")

        try:
            # Get all devices (load_devices returns a list directly)
            devices = device_manager.load_devices()

            if not devices or len(devices) == 0:
                debug("No devices configured, skipping collection")
                return

            # Count enabled devices
            enabled_devices = [d for d in devices if d.get('enabled', True)]
            debug("Found %d enabled devices out of %d total", len(enabled_devices), len(devices))

            # Collect data from each enabled device
            success_count = 0
            for device in enabled_devices:
                device_id = device.get('id')
                device_name = device.get('name', 'Unknown')

                debug("Collecting data for device: %s (ID: %s)", device_name, device_id)

                try:
                    # Get throughput data
                    throughput_data = get_throughput_data(device_id)

                    # Enhanced Insights: Collect disk usage metrics
                    disk_usage = get_disk_usage(device_id)
                    if disk_usage:
                        throughput_data['disk_usage'] = disk_usage
                        debug("Collected disk usage for device %s: root=%d%%, logs=%d%%, var=%d%%",
                              device_name,
                              disk_usage.get('root_pct', 0),
                              disk_usage.get('logs_pct', 0),
                              disk_usage.get('var_pct', 0))

                    # Enhanced Insights: Collect database versions
                    db_versions = get_database_versions(device_id)
                    if db_versions:
                        throughput_data['database_versions'] = db_versions
                        debug("Collected database versions for device %s: app=%s, threat=%s, wildfire=%s",
                              device_name,
                              db_versions.get('app_version', 'N/A'),
                              db_versions.get('threat_version', 'N/A'),
                              db_versions.get('wildfire_version', 'N/A'))

                    # Note: Session utilization is already enhanced in get_throughput_data()
                    # which calls get_session_count() that now returns max and utilization_pct

                    # Compute top bandwidth clients (internal and internet) and add to data
                    top_clients = self._compute_top_bandwidth_client(device_id)
                    if top_clients:
                        # Add all three client types to throughput data
                        throughput_data['top_bandwidth_client'] = top_clients.get('top_bandwidth', {})
                        throughput_data['top_internal_client'] = top_clients.get('top_internal', {})
                        throughput_data['top_internet_client'] = top_clients.get('top_internet', {})

                    # Compute top categories (LAN and Internet) from application_statistics
                    top_categories = self._compute_top_categories(device_id)
                    if top_categories:
                        # Add both category types to throughput data (as dictionaries)
                        throughput_data['top_category_lan'] = top_categories.get('top_category_lan', {})
                        throughput_data['top_category_internet'] = top_categories.get('top_category_internet', {})

                    # Compute top applications by bandwidth from application_statistics
                    top_apps = self._compute_top_applications(device_id, top_count=5)
                    if top_apps:
                        # Replace firewall API's session-based top_applications with bandwidth-based data
                        throughput_data['top_applications'] = top_apps

                    # Compute aggregate internal/internet traffic metrics for Analytics Dashboard
                    traffic_metrics = self._compute_traffic_metrics(device_id)
                    if traffic_metrics:
                        # Add internal/internet Mbps metrics to throughput data
                        throughput_data['internal_mbps'] = traffic_metrics.get('internal_mbps', 0)
                        throughput_data['internet_mbps'] = traffic_metrics.get('internet_mbps', 0)

                    if throughput_data and throughput_data.get('status') == 'success':
                        # Store throughput sample in database
                        if self.storage.insert_sample(device_id, throughput_data):
                            success_count += 1
                            debug("Successfully stored throughput data for device: %s", device_name)

                            # ============================================================
                            # Analytics Tables: Store application/category/client samples
                            # v2.0.0 - Migration 004
                            # ============================================================
                            timestamp = throughput_data.get('timestamp')
                            if timestamp:
                                # Store analytics data in parallel tables (non-blocking, errors logged but not fatal)
                                self._store_application_samples(device_id, timestamp)
                                self._store_category_bandwidth(device_id, timestamp)
                                self._store_client_bandwidth(device_id, timestamp)

                            # Check alert thresholds after successful data collection
                            self._check_alert_thresholds(device_id, device_name, throughput_data)
                        else:
                            error("Failed to store throughput data for device %s in database", device_name)
                    else:
                        # Collection failed - log detailed error information
                        error_msg = throughput_data.get('message', 'Unknown error') if throughput_data else 'No data returned'
                        error("Collection failed for device %s (%s): %s - This will create data gap in graph",
                              device_name, device.get('ip'), error_msg)

                    # Phase 3: Collect detailed logs from firewall API
                    import sys
                    sys.stderr.write(f"\n[LOG COLLECTION] Calling _collect_logs_for_device for {device_name}\n")
                    sys.stderr.flush()
                    self._collect_logs_for_device(device_id, device_name)

                except Exception as e:
                    exception("Error collecting data for device %s: %s", device_name, str(e))
                    continue

            info("Collection cycle complete: %d/%d devices successful",
                 success_count, len(enabled_devices))

            # Increment collection count
            self.collection_count += 1

        except Exception as e:
            exception("Error in collection cycle: %s", str(e))

    def _run_cleanup(self):
        """Run database cleanup to remove old samples."""
        debug("Running scheduled cleanup of old samples")

        try:
            deleted_count = self.storage.cleanup_old_samples(self.retention_days)
            self.last_cleanup = datetime.utcnow()

            if deleted_count > 0:
                info("Cleanup complete: removed %d old samples (retention: %d days)",
                     deleted_count, self.retention_days)
            else:
                debug("Cleanup complete: no old samples to remove")

        except Exception as e:
            exception("Error during cleanup: %s", str(e))

    def _check_alert_thresholds(self, device_id: str, device_name: str, throughput_data: Dict):
        """
        Check alert thresholds for collected metrics and trigger alerts if needed.

        Args:
            device_id: Device identifier
            device_name: Device name for logging
            throughput_data: Collected throughput data dictionary
        """
        print(f"[ALERT CHECK] ► Starting alert threshold check for device: {device_name} (ID: {device_id})")
        sys.stdout.flush()
        debug("Checking alert thresholds for device: %s", device_name)

        try:
            # Extract metrics from throughput data
            metrics = {}

            # Throughput metrics (already in Mbps from get_throughput_data)
            if 'inbound_mbps' in throughput_data:
                metrics['throughput_in'] = float(throughput_data['inbound_mbps'])
            if 'outbound_mbps' in throughput_data:
                metrics['throughput_out'] = float(throughput_data['outbound_mbps'])
            if 'total_mbps' in throughput_data:
                metrics['throughput_total'] = float(throughput_data['total_mbps'])

            # CPU metrics (handle both direct value and nested dict)
            if 'cpu_usage' in throughput_data:
                metrics['cpu'] = float(throughput_data['cpu_usage'])
            elif 'cpu' in throughput_data and isinstance(throughput_data['cpu'], dict):
                # Extract from nested cpu dict (e.g., {'data_plane': X, 'management': Y})
                if 'data_plane' in throughput_data['cpu']:
                    metrics['cpu'] = float(throughput_data['cpu']['data_plane'])

            # Memory metrics (handle both direct value and nested dict)
            if 'memory_usage' in throughput_data:
                metrics['memory'] = float(throughput_data['memory_usage'])
            elif 'cpu' in throughput_data and isinstance(throughput_data['cpu'], dict):
                # Memory might be in cpu dict
                if 'memory' in throughput_data['cpu']:
                    metrics['memory'] = float(throughput_data['cpu']['memory'])

            # Session count (handle both direct value and nested dict)
            if 'sessions' in throughput_data:
                sessions_data = throughput_data['sessions']
                if isinstance(sessions_data, dict):
                    # Extract active sessions from nested dict (e.g., {'active': X, 'tcp': Y, ...})
                    if 'active' in sessions_data:
                        metrics['sessions'] = float(sessions_data['active'])
                    elif 'total' in sessions_data:
                        metrics['sessions'] = float(sessions_data['total'])
                else:
                    metrics['sessions'] = float(sessions_data)

            # Threat counts (handle nested dict)
            if 'threats' in throughput_data and isinstance(throughput_data['threats'], dict):
                threats_data = throughput_data['threats']
                # Extract critical threat count
                if 'critical_count' in threats_data:
                    metrics['threats_critical'] = float(threats_data['critical_count'])
                elif 'critical' in threats_data:
                    metrics['threats_critical'] = float(threats_data['critical'])
            elif 'threats_critical_count' in throughput_data:
                metrics['threats_critical'] = float(throughput_data['threats_critical_count'])

            # Interface errors (if available)
            if 'interface_errors' in throughput_data:
                metrics['interface_errors'] = float(throughput_data['interface_errors'])

            print(f"[ALERT CHECK] Extracted {len(metrics)} metrics:")
            sys.stdout.flush()
            for metric_name, metric_value in metrics.items():
                print(f"[ALERT CHECK]   - {metric_name}: {metric_value}")
            sys.stdout.flush()
            debug("Extracted %d metrics for threshold checking", len(metrics))

            # Check thresholds using alert manager
            triggered_alerts = alert_manager.check_thresholds(device_id, metrics)

            print(f"[ALERT CHECK] alert_manager.check_thresholds() returned {len(triggered_alerts)} triggered alerts")
            sys.stdout.flush()

            if not triggered_alerts:
                print(f"[ALERT CHECK] ✓ No alerts triggered for device: {device_name}")
                sys.stdout.flush()

            # Process triggered alerts with cooldown logic
            current_time = datetime.utcnow()

            for alert_info in triggered_alerts:
                config = alert_info['config']
                actual_value = alert_info['actual_value']
                top_source = alert_info.get('top_source')  # Get source info for category alerts
                per_ip_results = alert_info.get('per_ip_results')  # Get per-IP bandwidth results
                alert_config_id = config['id']

                print(f"[ALERT CHECK] ⚠ ALERT TRIGGERED!")
                print(f"[ALERT CHECK]   Alert ID: {alert_config_id}")
                print(f"[ALERT CHECK]   Metric: {config['metric_type']}")
                print(f"[ALERT CHECK]   Threshold: {config['threshold_operator']} {config['threshold_value']}")
                print(f"[ALERT CHECK]   Actual Value: {actual_value}")
                print(f"[ALERT CHECK]   Severity: {config['severity']}")
                if top_source:
                    print(f"[ALERT CHECK]   Top Source: {top_source['ip']} ({top_source.get('hostname', 'N/A')})")
                if per_ip_results:
                    print(f"[ALERT CHECK]   Per-IP Results: {len(per_ip_results)} device(s)")
                    for result in per_ip_results:
                        bytes_mb = result['total_bytes'] / (1024 * 1024)
                        print(f"[ALERT CHECK]     - {result['ip']} ({result['hostname']}): {bytes_mb:.2f} MB {result['direction']}")
                sys.stdout.flush()

                # Determine cooldown period based on severity level
                severity = config['severity']
                if severity == 'info':
                    cooldown_seconds = _COOLDOWN_INFO_SECONDS
                elif severity == 'warning':
                    cooldown_seconds = _COOLDOWN_WARNING_SECONDS
                else:  # critical
                    cooldown_seconds = _COOLDOWN_CRITICAL_SECONDS

                # Check cooldown period to prevent alert spam (database-backed, persistent)
                in_cooldown = alert_manager.check_cooldown(device_id, alert_config_id, cooldown_seconds)

                print(f"[ALERT CHECK]   Cooldown: {cooldown_seconds}s ({severity}), In cooldown: {in_cooldown}")
                sys.stdout.flush()

                if in_cooldown:
                    debug(f"Alert {alert_config_id} ({severity}) still in cooldown period ({cooldown_seconds}s), skipping notification (will still record)")
                    # Still record in history for audit trail, but don't send notification
                    alert_manager.record_alert(
                        config_id=alert_config_id,
                        device_id=device_id,
                        metric_type=config['metric_type'],
                        threshold_value=config['threshold_value'],
                        actual_value=actual_value,
                        severity=config['severity'],
                        message=f"[COOLDOWN] {format_alert_message(config['metric_type'], actual_value, config['threshold_value'], config['threshold_operator'], device_name, top_source, per_ip_results)}"
                    )
                    continue  # Skip notification

                # Format alert message
                message = format_alert_message(
                    metric_type=config['metric_type'],
                    actual_value=actual_value,
                    threshold_value=config['threshold_value'],
                    operator=config['threshold_operator'],
                    device_name=device_name,
                    top_source=top_source,
                    per_ip_results=per_ip_results
                )

                # Record alert in history
                history_id = alert_manager.record_alert(
                    config_id=alert_config_id,
                    device_id=device_id,
                    metric_type=config['metric_type'],
                    threshold_value=config['threshold_value'],
                    actual_value=actual_value,
                    severity=config['severity'],
                    message=message
                )

                if history_id:
                    info("Alert triggered: %s (ID: %d)", message, history_id)
                    print(f"[ALERT CHECK] ✓ Alert recorded in history (ID: {history_id})")
                    sys.stdout.flush()

                    # Set cooldown period in database (persistent across restarts)
                    alert_manager.set_cooldown(device_id, alert_config_id, cooldown_seconds)
                    debug(f"Alert {alert_config_id} ({severity}) cooldown started ({cooldown_seconds}s = {cooldown_seconds/60:.1f} minutes)")
                    print(f"[ALERT CHECK] ✓ Cooldown started ({cooldown_seconds}s = {cooldown_seconds/60:.1f} minutes)")
                    sys.stdout.flush()

                    # Send notifications via configured channels
                    try:
                        print(f"[ALERT CHECK] Sending notifications to channels: {config.get('notification_channels', [])}")
                        sys.stdout.flush()
                        notification_result = notification_manager.send_alert(
                            alert_config=config,
                            message=message,
                            history_id=history_id,
                            device_name=device_name,
                            actual_value=actual_value
                        )
                        print(f"[ALERT CHECK] ✓ Notification result:")
                        sys.stdout.flush()
                        for channel, result in notification_result.items():
                            if result['enabled']:
                                status = "✓ SENT" if result['sent'] else f"✗ FAILED: {result.get('error', 'Unknown')}"
                                print(f"[ALERT CHECK]     {channel}: {status}")
                        sys.stdout.flush()
                        debug(f"Notification result: {notification_result}")
                    except Exception as notify_error:
                        print(f"[ALERT CHECK] ✗ ERROR sending notification: {notify_error}")
                        sys.stdout.flush()
                        exception(f"Error sending notification: {notify_error}")
                else:
                    print(f"[ALERT CHECK] ✗ Failed to record alert in database!")
                    sys.stdout.flush()
                    warning("Failed to record alert for device: %s", device_name)

            if triggered_alerts:
                info("Processed %d triggered alerts for device: %s", len(triggered_alerts), device_name)

        except Exception as e:
            print(f"[ALERT CHECK] ✗ EXCEPTION: {str(e)}")
            sys.stdout.flush()
            exception("Error checking alert thresholds for device %s: %s", device_name, str(e))

    def _compute_top_bandwidth_client(self, device_id: str) -> Dict:
        """
        Compute top bandwidth clients (internal and internet) from traffic_logs in last 5 minutes.

        Returns dict with three keys:
        - 'top_internal': Top client for internal-only traffic
        - 'top_internet': Top client for internet-bound traffic
        - 'top_bandwidth': Overall top client (for backward compatibility)
        """
        try:
            debug(f"Computing top bandwidth clients (internal & internet) for device {device_id}")

            # Get top internal client (internal-only traffic) - v1.10.12: Changed to 60 minutes
            top_internal = self.storage.get_top_internal_client(device_id, minutes=60)
            if top_internal:
                debug(f"Top internal client: {top_internal['ip']} ({top_internal.get('custom_name') or top_internal.get('hostname', 'Unknown')}) "
                      f"- {top_internal['total_bytes']/1_000_000:.2f} MB total")
            else:
                debug("No internal-only client found")

            # Get top internet client (internet-bound traffic) - v1.10.12: Changed to 60 minutes
            top_internet = self.storage.get_top_internet_client(device_id, minutes=60)
            if top_internet:
                debug(f"Top internet client: {top_internet['ip']} ({top_internet.get('custom_name') or top_internet.get('hostname', 'Unknown')}) "
                      f"- {top_internet['total_bytes']/1_000_000:.2f} MB total")
            else:
                debug("No internet client found")

            # For backward compatibility, use internet client as overall top (or internal if no internet)
            top_bandwidth = top_internet or top_internal or {}

            return {
                'top_internal': top_internal or {},
                'top_internet': top_internet or {},
                'top_bandwidth': top_bandwidth
            }

        except Exception as e:
            exception(f"Error computing top bandwidth clients: {str(e)}")
            return {
                'top_internal': {},
                'top_internet': {},
                'top_bandwidth': {}
            }

    def _compute_top_categories(self, device_id: str) -> Dict:
        """
        Compute top categories (LAN and Internet) from application_statistics in database.

        This reads from the same database source as the Applications page to ensure consistency.
        Returns properly formatted category objects matching the firewall API structure.

        Returns dict with two keys:
        - 'top_category_lan': Top category for LAN traffic (excludes 'private-ip-addresses')
        - 'top_category_internet': Top category for Internet traffic (all categories)

        Each category object contains: category, bytes, sessions, bytes_sent, bytes_received
        """
        try:
            debug(f"Computing top categories (LAN & Internet) for device {device_id}")

            # Query application statistics from database (latest collection)
            app_stats = self.storage.get_application_statistics(device_id, limit=1000)

            if not app_stats:
                debug("No application statistics available for top category computation")
                return {
                    'top_category_lan': {},
                    'top_category_internet': {}
                }

            # Aggregate by category
            category_data = {}
            for app in app_stats:
                category = app.get('category', 'unknown')

                if category not in category_data:
                    category_data[category] = {
                        'bytes': 0,
                        'sessions': 0,
                        'bytes_sent': 0,
                        'bytes_received': 0
                    }

                # Accumulate stats
                category_data[category]['bytes'] += app.get('bytes', 0)
                category_data[category]['sessions'] += app.get('sessions', 0)
                category_data[category]['bytes_sent'] += app.get('bytes_sent', 0)
                category_data[category]['bytes_received'] += app.get('bytes_received', 0)

            # Find top LAN category (ONLY 'private-ip-addresses' which represents local-to-local traffic)
            top_category_lan = {}
            if 'private-ip-addresses' in category_data:
                lan_stats = category_data['private-ip-addresses']
                top_category_lan = {
                    'category': 'private-ip-addresses',
                    'bytes': lan_stats['bytes'],
                    'sessions': lan_stats['sessions'],
                    'bytes_sent': lan_stats['bytes_sent'],
                    'bytes_received': lan_stats['bytes_received']
                }
                debug(f"Top LAN category: private-ip-addresses ({top_category_lan['bytes']/1_000_000:.2f} MB)")
            else:
                debug("No private-ip-addresses category found for Local LAN")

            # Find top Internet category (top category EXCLUDING 'private-ip-addresses')
            internet_categories = {cat: stats for cat, stats in category_data.items()
                                 if cat != 'private-ip-addresses'}

            top_category_internet = {}
            if internet_categories:
                # Get category with highest bytes
                top_internet_name = max(internet_categories, key=lambda cat: internet_categories[cat]['bytes'])
                top_category_internet = {
                    'category': top_internet_name,
                    'bytes': internet_categories[top_internet_name]['bytes'],
                    'sessions': internet_categories[top_internet_name]['sessions'],
                    'bytes_sent': internet_categories[top_internet_name]['bytes_sent'],
                    'bytes_received': internet_categories[top_internet_name]['bytes_received']
                }
                debug(f"Top Internet category: {top_internet_name} ({top_category_internet['bytes']/1_000_000:.2f} MB)")
            else:
                debug("No internet categories found (all traffic may be local LAN)")

            return {
                'top_category_lan': top_category_lan,
                'top_category_internet': top_category_internet
            }

        except Exception as e:
            exception(f"Error computing top categories: {str(e)}")
            return {
                'top_category_lan': {},
                'top_category_internet': {}
            }

    def _compute_traffic_metrics(self, device_id: str) -> Dict:
        """
        Compute aggregate internal and internet traffic metrics for Analytics Dashboard.

        Calculates total Mbps for:
        - internal_mbps: Local-to-local traffic (both IPs are private)
        - internet_mbps: Traffic to/from public IPs (local<->internet)

        Uses traffic_logs data from the last 60 seconds to match current throughput measurement.
        Returns metrics in Mbps to match the Analytics Dashboard requirements.

        Args:
            device_id: Device identifier

        Returns:
            Dict with 'internal_mbps' and 'internet_mbps' keys
        """
        try:
            debug(f"Computing aggregate traffic metrics (internal/internet) for device {device_id}")

            # Query traffic logs from last 60 seconds (matches throughput measurement window)
            from datetime import datetime, timedelta
            import sqlite3
            end_time = datetime.now()
            start_time = end_time - timedelta(seconds=60)

            # Get all traffic logs for the time window
            conn = sqlite3.connect(self.storage.db_path)
            cursor = conn.cursor()

            cursor.execute('''
                SELECT source_ip, dest_ip, bytes_sent, bytes_received
                FROM traffic_logs
                WHERE device_id = ? AND timestamp BETWEEN ? AND ?
            ''', (device_id, start_time.isoformat(), end_time.isoformat()))

            rows = cursor.fetchall()
            conn.close()

            if not rows or len(rows) == 0:
                debug("No traffic logs found in last 60s, returning zero metrics")
                return {'internal_mbps': 0, 'internet_mbps': 0}

            # Import helper functions
            from throughput_storage import is_private_ip, is_internet_traffic

            # Aggregate bytes by traffic type
            internal_bytes = 0
            internet_bytes = 0

            for row in rows:
                src_ip = row[0]
                dst_ip = row[1]
                bytes_sent = row[2] or 0
                bytes_received = row[3] or 0
                total_bytes = bytes_sent + bytes_received

                # Classify traffic
                if is_internet_traffic(src_ip, dst_ip):
                    # One end is private, one is public = internet traffic
                    internet_bytes += total_bytes
                elif is_private_ip(src_ip) and is_private_ip(dst_ip):
                    # Both private = internal traffic
                    internal_bytes += total_bytes
                # else: Both public IPs = transit traffic (ignore for now)

            # Convert bytes to Mbps (bytes → bits → megabits, divided by 60 seconds)
            internal_mbps = (internal_bytes * 8) / (1000000 * 60)
            internet_mbps = (internet_bytes * 8) / (1000000 * 60)

            debug(f"Traffic metrics: internal={internal_mbps:.2f} Mbps, internet={internet_mbps:.2f} Mbps "
                  f"(from {len(rows)} traffic log entries)")

            return {
                'internal_mbps': round(internal_mbps, 2),
                'internet_mbps': round(internet_mbps, 2)
            }

        except Exception as e:
            exception(f"Error computing traffic metrics: {str(e)}")
            return {'internal_mbps': 0, 'internet_mbps': 0}

    def _compute_top_applications(self, device_id: str, top_count: int = 5) -> Dict:
        """
        Compute top applications by bandwidth from application_statistics in database.

        This reads from the same database source as the Applications page to ensure consistency.
        Applications are sorted by total bytes (bandwidth usage), not session count.

        Args:
            device_id: Device identifier
            top_count: Number of top applications to return (default: 5)

        Returns:
            dict with 'apps' (list of top apps) and 'total_count' (total unique apps)
        """
        try:
            debug(f"Computing top {top_count} applications by bandwidth for device {device_id}")

            # Query application statistics from database (sorted by bytes_total DESC)
            app_stats = self.storage.get_application_statistics(device_id, limit=500)

            if not app_stats:
                debug("No application statistics available for top applications computation")
                return {
                    'apps': [],
                    'total_count': 0
                }

            # Get top N applications by total bytes
            top_apps = []
            for app in app_stats[:top_count]:
                top_apps.append({
                    'name': app.get('name', 'unknown'),
                    'count': app.get('sessions', 0),  # For backward compatibility (dashboard shows this)
                    'bytes': app.get('bytes', 0),  # Total bytes for the modal
                    'category': app.get('category', 'unknown')
                })

            total_count = len(app_stats)
            debug(f"Top {top_count} applications computed: {[app['name'] for app in top_apps]}")

            return {
                'apps': top_apps,
                'total_count': total_count
            }

        except Exception as e:
            exception(f"Error computing top applications: {str(e)}")
            return {
                'apps': [],
                'total_count': 0
            }

    # ========================================================================
    # Analytics Tables: Storage Methods for Application/Category/Client Data
    # Added: v2.0.0 - Migration 004
    # ========================================================================

    def _store_application_samples(self, device_id: str, timestamp: str):
        """
        Store application samples in application_samples analytics table.

        Reads from application_statistics table (already populated by _collect_application_statistics)
        and inserts into application_samples for historical trending.

        Args:
            device_id: Device identifier
            timestamp: Sample timestamp (ISO format string)
        """
        try:
            debug(f"Storing application samples for device {device_id}")

            # Parse timestamp
            from datetime import datetime
            if isinstance(timestamp, str):
                timestamp = timestamp.replace('Z', '+00:00')
                timestamp_dt = datetime.fromisoformat(timestamp)
            elif isinstance(timestamp, datetime):
                timestamp_dt = timestamp
            else:
                warning(f"Invalid timestamp format for analytics storage: {timestamp}")
                return

            # Get application statistics from database (already collected)
            app_stats = self.storage.get_application_statistics(device_id, limit=500)

            if not app_stats or len(app_stats) == 0:
                debug(f"No application statistics available for analytics storage (device {device_id})")
                return

            # Insert into application_samples table
            if self.storage.insert_application_samples(device_id, timestamp_dt, app_stats):
                debug(f"Successfully stored {len(app_stats)} application samples for device {device_id}")
            else:
                warning(f"Failed to store application samples for device {device_id}")

        except Exception as e:
            exception(f"Error storing application samples for device {device_id}: {str(e)}")

    def _store_category_bandwidth(self, device_id: str, timestamp: str):
        """
        Store category bandwidth samples in category_bandwidth analytics table.

        Aggregates application statistics by category and splits into traffic types:
        - 'lan': private-ip-addresses category only (local-to-local)
        - 'internet': All other categories (internet-bound traffic)

        Args:
            device_id: Device identifier
            timestamp: Sample timestamp (ISO format string)
        """
        try:
            debug(f"Storing category bandwidth for device {device_id}")

            # Parse timestamp
            from datetime import datetime
            if isinstance(timestamp, str):
                timestamp = timestamp.replace('Z', '+00:00')
                timestamp_dt = datetime.fromisoformat(timestamp)
            elif isinstance(timestamp, datetime):
                timestamp_dt = timestamp
            else:
                warning(f"Invalid timestamp format for analytics storage: {timestamp}")
                return

            # Get application statistics from database (already collected)
            app_stats = self.storage.get_application_statistics(device_id, limit=500)

            if not app_stats or len(app_stats) == 0:
                debug(f"No application statistics available for category bandwidth (device {device_id})")
                return

            # Aggregate by category
            category_data = {}
            for app in app_stats:
                category = app.get('category', 'unknown')

                if category not in category_data:
                    category_data[category] = {
                        'bytes': 0,
                        'bytes_sent': 0,
                        'bytes_received': 0,
                        'sessions': 0,
                        'applications': {}  # Track bytes per app in this category
                    }

                # Accumulate stats
                category_data[category]['bytes'] += app.get('bytes', 0)
                category_data[category]['bytes_sent'] += app.get('bytes_sent', 0)
                category_data[category]['bytes_received'] += app.get('bytes_received', 0)
                category_data[category]['sessions'] += app.get('sessions', 0)

                # Track top application in this category
                app_name = app.get('app', 'unknown')
                app_bytes = app.get('bytes', 0)
                category_data[category]['applications'][app_name] = app_bytes

            # Prepare category stats for insertion
            category_stats = []

            # 1. LAN traffic: private-ip-addresses category only
            if 'private-ip-addresses' in category_data:
                lan_data = category_data['private-ip-addresses']
                top_app = max(lan_data['applications'].items(), key=lambda x: x[1]) if lan_data['applications'] else (None, 0)

                category_stats.append({
                    'category': 'private-ip-addresses',
                    'traffic_type': 'lan',
                    'bytes': lan_data['bytes'],
                    'bytes_sent': lan_data['bytes_sent'],
                    'bytes_received': lan_data['bytes_received'],
                    'sessions': lan_data['sessions'],
                    'top_application': top_app[0],
                    'top_application_bytes': top_app[1]
                })
                debug(f"Category LAN: private-ip-addresses ({lan_data['bytes']/1_000_000:.2f} MB)")

            # 2. Internet traffic: All categories EXCEPT private-ip-addresses
            internet_categories = {cat: data for cat, data in category_data.items()
                                 if cat != 'private-ip-addresses'}

            for category, data in internet_categories.items():
                top_app = max(data['applications'].items(), key=lambda x: x[1]) if data['applications'] else (None, 0)

                category_stats.append({
                    'category': category,
                    'traffic_type': 'internet',
                    'bytes': data['bytes'],
                    'bytes_sent': data['bytes_sent'],
                    'bytes_received': data['bytes_received'],
                    'sessions': data['sessions'],
                    'top_application': top_app[0],
                    'top_application_bytes': top_app[1]
                })

            if internet_categories:
                debug(f"Category Internet: {len(internet_categories)} categories")

            # Insert into category_bandwidth table
            if category_stats:
                if self.storage.insert_category_bandwidth(device_id, timestamp_dt, category_stats):
                    debug(f"Successfully stored {len(category_stats)} category bandwidth samples for device {device_id}")
                else:
                    warning(f"Failed to store category bandwidth for device {device_id}")
            else:
                debug(f"No category data to store for device {device_id}")

        except Exception as e:
            exception(f"Error storing category bandwidth for device {device_id}: {str(e)}")

    def _store_client_bandwidth(self, device_id: str, timestamp: str):
        """
        Store per-client bandwidth samples in client_bandwidth analytics table.

        Aggregates traffic logs by client IP and splits into traffic types:
        - 'internal': Both source and destination are private IPs
        - 'internet': One end is private, one is public (internet-bound)
        - 'total': All traffic for this client

        Enriches with custom_name from device_metadata.json (denormalized).

        Args:
            device_id: Device identifier
            timestamp: Sample timestamp (ISO format string)
        """
        try:
            debug(f"Storing client bandwidth for device {device_id}")

            # Parse timestamp
            from datetime import datetime
            if isinstance(timestamp, str):
                timestamp = timestamp.replace('Z', '+00:00')
                timestamp_dt = datetime.fromisoformat(timestamp)
            elif isinstance(timestamp, datetime):
                timestamp_dt = timestamp
            else:
                warning(f"Invalid timestamp format for analytics storage: {timestamp}")
                return

            # Load device metadata for custom name enrichment (denormalized approach)
            from device_metadata import load_metadata
            metadata = load_metadata(device_id, use_cache=True)  # Per-device metadata

            # Get traffic logs from database (already collected, last 500 logs)
            traffic_logs = self.storage.get_traffic_logs(device_id, limit=500)

            if not traffic_logs or len(traffic_logs) == 0:
                debug(f"No traffic logs available for client bandwidth (device {device_id})")
                return

            # Helper function to check if IP is private
            def is_private_ip(ip_str):
                """Check if IP is in private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)"""
                if not ip_str or ip_str == 'N/A':
                    return False
                try:
                    from ipaddress import ip_address
                    ip = ip_address(ip_str)
                    return ip.is_private
                except:
                    return False

            # Aggregate by client IP and traffic type
            client_data = {}

            for log in traffic_logs:
                src_ip = log.get('src')
                dst_ip = log.get('dst')
                bytes_sent = int(log.get('bytes_sent', 0))
                bytes_received = int(log.get('bytes_received', 0))
                total_bytes = bytes_sent + bytes_received
                proto = log.get('proto', '')
                app = log.get('app', 'unknown')

                # Parse details_json for additional info
                details = {}
                if log.get('details_json'):
                    try:
                        import json
                        details = json.loads(log['details_json'])
                    except:
                        pass

                # Extract metadata
                from_zone = details.get('from_zone', '')
                inbound_if = details.get('inbound_if', '')

                # Determine traffic type
                is_src_private = is_private_ip(src_ip)
                is_dst_private = is_private_ip(dst_ip)

                if is_src_private and is_dst_private:
                    traffic_type = 'internal'
                elif is_src_private or is_dst_private:
                    traffic_type = 'internet'
                else:
                    traffic_type = 'total'  # Both public (transit)

                # Track client as source IP
                if src_ip and src_ip != 'N/A':
                    client_key = f"{src_ip}:{traffic_type}"

                    if client_key not in client_data:
                        client_data[client_key] = {
                            'client_ip': src_ip,
                            'client_mac': None,  # Not available in traffic logs
                            'hostname': None,  # Not available in traffic logs
                            'traffic_type': traffic_type,
                            'bytes': 0,
                            'bytes_sent': 0,
                            'bytes_received': 0,
                            'sessions': 0,
                            'sessions_tcp': 0,
                            'sessions_udp': 0,
                            'interface': inbound_if,
                            'zone': from_zone,
                            'vlan': None,  # Not easily available
                            'applications': {}  # Track bytes per app
                        }

                    client_data[client_key]['bytes'] += total_bytes
                    client_data[client_key]['bytes_sent'] += bytes_sent
                    client_data[client_key]['bytes_received'] += bytes_received
                    client_data[client_key]['sessions'] += 1

                    if proto == 'tcp':
                        client_data[client_key]['sessions_tcp'] += 1
                    elif proto == 'udp':
                        client_data[client_key]['sessions_udp'] += 1

                    # Track top application for this client
                    if app not in client_data[client_key]['applications']:
                        client_data[client_key]['applications'][app] = 0
                    client_data[client_key]['applications'][app] += total_bytes

            # Enrich with custom_name from metadata (denormalized)
            # Note: traffic_logs don't have MAC addresses, so we can't enrich here
            # Custom names will be NULL for now until we correlate with ARP data

            # Prepare client stats for insertion
            client_stats = []
            for client in client_data.values():
                # Find top application
                top_app = max(client['applications'].items(), key=lambda x: x[1]) if client['applications'] else (None, 0)

                client_stats.append({
                    'client_ip': client['client_ip'],
                    'client_mac': client['client_mac'],
                    'hostname': client['hostname'],
                    'custom_name': None,  # Will be enriched from ARP/DHCP in future enhancement
                    'traffic_type': client['traffic_type'],
                    'bytes': client['bytes'],
                    'bytes_sent': client['bytes_sent'],
                    'bytes_received': client['bytes_received'],
                    'sessions': client['sessions'],
                    'sessions_tcp': client['sessions_tcp'],
                    'sessions_udp': client['sessions_udp'],
                    'interface': client['interface'],
                    'vlan': client['vlan'],
                    'zone': client['zone'],
                    'top_application': top_app[0],
                    'top_application_bytes': top_app[1]
                })

            debug(f"Prepared {len(client_stats)} client bandwidth samples ({len([c for c in client_stats if c['traffic_type'] == 'internal'])} internal, "
                  f"{len([c for c in client_stats if c['traffic_type'] == 'internet'])} internet)")

            # Insert into client_bandwidth table
            if client_stats:
                if self.storage.insert_client_bandwidth(device_id, timestamp_dt, client_stats):
                    debug(f"Successfully stored {len(client_stats)} client bandwidth samples for device {device_id}")
                else:
                    warning(f"Failed to store client bandwidth for device {device_id}")
            else:
                debug(f"No client data to store for device {device_id}")

        except Exception as e:
            exception(f"Error storing client bandwidth for device {device_id}: {str(e)}")

    # ========================================================================
    # Phase 3: Detailed Log Collection Methods
    # ========================================================================

    def _collect_logs_for_device(self, device_id: str, device_name: str):
        """
        Collect all types of logs for a device and store in database.

        Args:
            device_id: Device identifier
            device_name: Device name for logging
        """
        debug("Collecting logs for device: %s", device_name)

        try:
            # Get firewall configuration
            firewall_config = get_firewall_config(device_id)
            if not firewall_config or not firewall_config[0]:  # Returns (ip, api_key, base_url)
                warning("No firewall configuration for device %s, skipping log collection", device_name)
                return

            # Collect threat logs (critical and medium)
            self._collect_threat_logs(device_id, device_name, firewall_config)

            # Collect system logs
            self._collect_system_logs(device_id, device_name, firewall_config)

            # Collect traffic logs
            self._collect_traffic_logs(device_id, device_name, firewall_config)

            # Collect application statistics
            self._collect_application_statistics(device_id, device_name, firewall_config)

            debug("Log collection complete for device: %s", device_name)

        except Exception as e:
            exception("Error collecting logs for device %s: %s", device_name, str(e))

    def _collect_threat_logs(self, device_id: str, device_name: str, firewall_config: tuple):
        """
        Collect threat logs (critical and medium) and URL filtering logs.

        Args:
            device_id: Device identifier
            device_name: Device name for logging
            firewall_config: Firewall configuration tuple
        """
        import sys
        sys.stderr.write(f"\n[THREAT COLLECTION] Starting threat log collection for device: {device_name}\n")
        sys.stderr.flush()

        try:
            debug("Collecting threat logs for device: %s", device_name)

            # Get threat statistics (includes critical_logs, medium_logs, blocked_url_logs)
            threat_data = get_threat_stats(firewall_config, max_logs=50)

            sys.stderr.write(f"[THREAT COLLECTION] get_threat_stats returned type: {type(threat_data)}\n")
            sys.stderr.write(f"[THREAT COLLECTION] threat_data keys: {threat_data.keys() if isinstance(threat_data, dict) else 'Not a dict'}\n")
            sys.stderr.write(f"[THREAT COLLECTION] status value: {threat_data.get('status') if isinstance(threat_data, dict) else 'N/A'}\n")
            sys.stderr.flush()

            if threat_data and threat_data.get('status') == 'success':
                # Store critical threat logs
                critical_logs = threat_data.get('critical_logs', [])
                sys.stderr.write(f"[THREAT COLLECTION] Critical logs: {len(critical_logs)}\n")
                if critical_logs:
                    result = self.storage.insert_threat_logs(device_id, critical_logs, 'critical')
                    sys.stderr.write(f"[THREAT COLLECTION] insert_threat_logs(critical) returned: {result}\n")
                    debug("Stored %d critical threat logs for device: %s", len(critical_logs), device_name)

                # Store high threat logs
                high_logs = threat_data.get('high_logs', [])
                sys.stderr.write(f"[THREAT COLLECTION] High logs: {len(high_logs)}\n")
                if high_logs:
                    result = self.storage.insert_threat_logs(device_id, high_logs, 'high')
                    sys.stderr.write(f"[THREAT COLLECTION] insert_threat_logs(high) returned: {result}\n")
                    debug("Stored %d high threat logs for device: %s", len(high_logs), device_name)

                # Store medium threat logs
                medium_logs = threat_data.get('medium_logs', [])
                sys.stderr.write(f"[THREAT COLLECTION] Medium logs: {len(medium_logs)}\n")
                if medium_logs:
                    result = self.storage.insert_threat_logs(device_id, medium_logs, 'medium')
                    sys.stderr.write(f"[THREAT COLLECTION] insert_threat_logs(medium) returned: {result}\n")
                    debug("Stored %d medium threat logs for device: %s", len(medium_logs), device_name)

                # Store URL filtering logs
                url_logs = threat_data.get('blocked_url_logs', [])
                sys.stderr.write(f"[THREAT COLLECTION] URL logs: {len(url_logs)}\n")
                if url_logs:
                    result = self.storage.insert_url_filtering_logs(device_id, url_logs)
                    sys.stderr.write(f"[THREAT COLLECTION] insert_url_filtering_logs returned: {result}\n")
                    debug("Stored %d URL filtering logs for device: %s", len(url_logs), device_name)

                sys.stderr.flush()
            else:
                debug("No threat data available for device: %s", device_name)

        except Exception as e:
            exception("Error collecting threat logs for device %s: %s", device_name, str(e))

    def _collect_system_logs(self, device_id: str, device_name: str, firewall_config: tuple):
        """
        Collect system event logs.

        Args:
            device_id: Device identifier
            device_name: Device name for logging
            firewall_config: Firewall configuration tuple
        """
        try:
            debug("Collecting system logs for device: %s", device_name)

            # Get system logs
            system_data = get_system_logs(firewall_config, max_logs=50)

            if system_data and system_data.get('status') == 'success':
                logs = system_data.get('logs', [])
                if logs:
                    self.storage.insert_system_logs(device_id, logs)
                    debug("Stored %d system logs for device: %s", len(logs), device_name)
            else:
                debug("No system logs available for device: %s", device_name)

        except Exception as e:
            exception("Error collecting system logs for device %s: %s", device_name, str(e))

    def _collect_traffic_logs(self, device_id: str, device_name: str, firewall_config: tuple):
        """
        Collect traffic session logs.

        Args:
            device_id: Device identifier
            device_name: Device name for logging
            firewall_config: Firewall configuration tuple
        """
        try:
            debug("Collecting traffic logs for device: %s", device_name)

            # Get traffic logs
            traffic_data = get_traffic_logs(firewall_config, max_logs=50)

            if traffic_data and traffic_data.get('status') == 'success':
                logs = traffic_data.get('logs', [])
                if logs:
                    self.storage.insert_traffic_logs(device_id, logs)
                    debug("Stored %d traffic logs for device: %s", len(logs), device_name)
            else:
                debug("No traffic logs available for device: %s", device_name)

        except Exception as e:
            exception("Error collecting traffic logs for device %s: %s", device_name, str(e))

    def _collect_application_statistics(self, device_id: str, device_name: str, firewall_config: tuple):
        """
        Aggregate application statistics from database traffic_logs.

        This is a lightweight aggregation that reads recent traffic_logs from the database
        (which are already being collected every 15 seconds) and aggregates them by application.
        NO firewall API calls - just database queries and Python aggregation.

        Args:
            device_id: Device identifier
            device_name: Device name for logging
            firewall_config: Firewall configuration tuple (not used, kept for compatibility)
        """
        try:
            debug("Aggregating application statistics from database for device: %s", device_name)

            # Get recent traffic logs from database (last 500 logs)
            traffic_logs = self.storage.get_traffic_logs(device_id, limit=500)

            if not traffic_logs:
                debug("No traffic logs available in database for device: %s", device_name)
                return

            # Aggregate by application
            app_stats = {}

            for log in traffic_logs:
                app = log.get('app', 'unknown')

                # Parse details_json to extract category, zones, and VLAN information
                details = {}
                if log.get('details_json'):
                    try:
                        details = json.loads(log['details_json'])
                    except (json.JSONDecodeError, TypeError):
                        pass

                # Extract data from details_json
                category = details.get('category', 'unknown')
                from_zone = details.get('from_zone', '')
                to_zone = details.get('to_zone', '')
                inbound_if = details.get('inbound_if', '')
                outbound_if = details.get('outbound_if', '')

                if app not in app_stats:
                    app_stats[app] = {
                        'app': app,
                        'category': category,
                        'sessions': 0,
                        'bytes': 0,
                        'bytes_sent': 0,
                        'bytes_received': 0,
                        'sources': {},  # Changed to dict to track bytes per source
                        'destinations': {},  # Changed to dict to track bytes+port per destination
                        'protocols': set(),
                        'ports': set(),
                        'vlans': set(),
                        'zones': set()
                    }

                # Aggregate data
                app_stats[app]['sessions'] += 1
                bytes_sent = int(log.get('bytes_sent', 0))
                bytes_received = int(log.get('bytes_received', 0))
                total_bytes = bytes_sent + bytes_received
                app_stats[app]['bytes_sent'] += bytes_sent
                app_stats[app]['bytes_received'] += bytes_received
                app_stats[app]['bytes'] += total_bytes

                # Track sources with bytes
                # Note: Enrichment data (hostnames, custom names) not available in traffic_logs
                # This will be added by the API endpoint when serving data
                src = log.get('src')
                if src:
                    if src not in app_stats[app]['sources']:
                        app_stats[app]['sources'][src] = {
                            'ip': src,
                            'bytes': 0
                        }
                    app_stats[app]['sources'][src]['bytes'] += total_bytes

                # Track destinations with bytes and port
                dst = log.get('dst')
                dport = log.get('dport', '0')
                if dst:
                    # Use dst:port as key for unique destination tracking
                    dest_key = f"{dst}:{dport}"
                    if dest_key not in app_stats[app]['destinations']:
                        app_stats[app]['destinations'][dest_key] = {
                            'ip': dst,
                            'port': dport if dport != '0' else 'N/A',
                            'bytes': 0
                        }
                    app_stats[app]['destinations'][dest_key]['bytes'] += total_bytes

                # Track protocols and ports
                proto = log.get('proto')
                if proto:
                    app_stats[app]['protocols'].add(proto)
                if dport and dport != '0':
                    app_stats[app]['ports'].add(dport)

                # Track security zones
                if from_zone:
                    app_stats[app]['zones'].add(from_zone)
                if to_zone:
                    app_stats[app]['zones'].add(to_zone)

                # Extract and track VLANs from interface names
                # Interface format: "ethernet1/1.100" where 100 is VLAN ID
                for interface in [inbound_if, outbound_if]:
                    if interface and '.' in interface:
                        try:
                            vlan_id = interface.split('.')[-1]
                            if vlan_id.isdigit():
                                app_stats[app]['vlans'].add(vlan_id)
                        except (IndexError, AttributeError):
                            pass

            # Convert dicts and sets to lists for storage
            applications = []
            for app_data in app_stats.values():
                # Convert sources dict to list, sorted by bytes descending
                source_details = sorted(
                    app_data['sources'].values(),
                    key=lambda x: x['bytes'],
                    reverse=True
                )

                # Convert destinations dict to list, sorted by bytes descending
                destination_details = sorted(
                    app_data['destinations'].values(),
                    key=lambda x: x['bytes'],
                    reverse=True
                )

                applications.append({
                    'app': app_data['app'],
                    'category': app_data['category'],
                    'sessions': app_data['sessions'],
                    'bytes': app_data['bytes'],
                    'bytes_sent': app_data['bytes_sent'],
                    'bytes_received': app_data['bytes_received'],
                    'source_count': len(source_details),
                    'dest_count': len(destination_details),
                    'source_details': source_details,
                    'destination_details': destination_details,
                    'protocols': list(app_data['protocols']),
                    'ports': sorted(list(app_data['ports'])),
                    'vlans': list(app_data['vlans']),
                    'zones': list(app_data['zones'])
                })

            # Store aggregated statistics in database
            if applications:
                if self.storage.insert_application_statistics(device_id, applications):
                    debug("Successfully stored %d application statistics for device: %s",
                          len(applications), device_name)
                else:
                    warning("Failed to store application statistics for device: %s", device_name)
            else:
                debug("No applications to store for device: %s", device_name)

        except Exception as e:
            exception("Error aggregating application statistics for device %s: %s", device_name, str(e))

    def force_cleanup(self) -> int:
        """
        Manually trigger cleanup of old samples.

        Returns:
            Number of samples deleted
        """
        info("Manual cleanup triggered")
        deleted_count = self.storage.cleanup_old_samples(self.retention_days)
        self.last_cleanup = datetime.utcnow()
        return deleted_count

    def get_collector_stats(self) -> Dict:
        """
        Get statistics about the collector.

        Returns:
            Dictionary with collector statistics
        """
        debug("Retrieving collector statistics")

        storage_stats = self.storage.get_storage_stats()

        stats = {
            'collection_count': self.collection_count,
            'last_cleanup': self.last_cleanup.isoformat() if self.last_cleanup else None,
            'retention_days': self.retention_days,
            'storage': storage_stats
        }

        return stats


# Global collector instance (initialized in app.py)
collector = None


def init_collector(db_path: str = None, retention_days: int = 90) -> ThroughputCollector:
    """
    Initialize the global throughput collector.

    PANfm v2.0.0: TimescaleDB only - SQLite support removed.

    Args:
        db_path: Deprecated (was SQLite path, now ignored)
        retention_days: Deprecated (TimescaleDB uses automatic retention policies)

    Returns:
        ThroughputCollector instance
    """
    global collector

    debug("Initializing throughput collector with TimescaleDB")
    info("TimescaleDB retention policies: 7d raw → 90d hourly → 1y daily (automatic)")

    # Initialize TimescaleDB storage with connection string from config
    storage = ThroughputStorage(TIMESCALE_DSN)
    collector = ThroughputCollector(storage, retention_days)

    info("TimescaleDB throughput collector initialized successfully")

    return collector


def get_collector() -> Optional[ThroughputCollector]:
    """
    Get the global collector instance.

    Returns:
        ThroughputCollector instance or None if not initialized
    """
    return collector
