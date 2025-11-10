"""
Throughput Collector Module

Background service for collecting and storing historical network throughput data.
Runs as scheduled job via APScheduler to periodically collect data from enabled devices.

Author: PANfm Development Team
Created: 2025-11-06
"""

import json
from datetime import datetime
from typing import Dict, Optional
from logger import debug, info, warning, error, exception
from device_manager import device_manager
from firewall_api import get_throughput_data, get_firewall_config
from firewall_api_logs import get_system_logs, get_threat_stats, get_traffic_logs
from throughput_storage import ThroughputStorage


class ThroughputCollector:
    """Background collector for network throughput data."""

    def __init__(self, storage: ThroughputStorage, retention_days: int = 90):
        """
        Initialize the throughput collector.

        Args:
            storage: ThroughputStorage instance
            retention_days: Number of days to retain historical data
        """
        self.storage = storage
        self.retention_days = retention_days
        self.collection_count = 0
        self.last_cleanup = None
        debug("ThroughputCollector initialized with %d-day retention", retention_days)

    def collect_all_devices(self):
        """
        Collect throughput data from all enabled devices and store in database.

        This is the main collection function called by the APScheduler job.
        """
        debug("Starting throughput collection cycle #%d", self.collection_count + 1)

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

                    if throughput_data and throughput_data.get('status') == 'success':
                        # Store throughput sample in database
                        if self.storage.insert_sample(device_id, throughput_data):
                            success_count += 1
                            debug("Successfully stored throughput data for device: %s", device_name)
                        else:
                            warning("Failed to store throughput data for device: %s", device_name)
                    else:
                        warning("Failed to get throughput data for device: %s", device_name)

                    # Phase 3: Collect detailed logs from firewall API
                    self._collect_logs_for_device(device_id, device_name)

                except Exception as e:
                    exception("Error collecting data for device %s: %s", device_name, str(e))
                    continue

            self.collection_count += 1
            info("Collection cycle #%d complete: %d/%d devices successful",
                 self.collection_count, success_count, len(enabled_devices))

            # Run cleanup periodically (every 24 hours = ~5760 collections at 15s intervals)
            if self.collection_count % 5760 == 0:
                self._run_cleanup()

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
        try:
            debug("Collecting threat logs for device: %s", device_name)

            # Get threat statistics (includes critical_logs, medium_logs, blocked_url_logs)
            threat_data = get_threat_stats(firewall_config, max_logs=50)

            if threat_data and threat_data.get('status') == 'success':
                # Store critical threat logs
                critical_logs = threat_data.get('critical_logs', [])
                if critical_logs:
                    self.storage.insert_threat_logs(device_id, critical_logs, 'critical')
                    debug("Stored %d critical threat logs for device: %s", len(critical_logs), device_name)

                # Store medium threat logs
                medium_logs = threat_data.get('medium_logs', [])
                if medium_logs:
                    self.storage.insert_threat_logs(device_id, medium_logs, 'medium')
                    debug("Stored %d medium threat logs for device: %s", len(medium_logs), device_name)

                # Store URL filtering logs
                url_logs = threat_data.get('blocked_url_logs', [])
                if url_logs:
                    self.storage.insert_url_filtering_logs(device_id, url_logs)
                    debug("Stored %d URL filtering logs for device: %s", len(url_logs), device_name)
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


def init_collector(db_path: str, retention_days: int = 90) -> ThroughputCollector:
    """
    Initialize the global throughput collector.

    Args:
        db_path: Path to SQLite database file
        retention_days: Number of days to retain historical data

    Returns:
        ThroughputCollector instance
    """
    global collector

    debug("Initializing global throughput collector (retention: %d days)", retention_days)

    storage = ThroughputStorage(db_path)
    collector = ThroughputCollector(storage, retention_days)

    info("Throughput collector initialized successfully")
    return collector


def get_collector() -> Optional[ThroughputCollector]:
    """
    Get the global collector instance.

    Returns:
        ThroughputCollector instance or None if not initialized
    """
    return collector
