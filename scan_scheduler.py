"""
Scan Scheduler for PANfm Security Monitoring
Manages scheduled nmap scans with APScheduler integration.

Supports:
- Tag-based scheduled scans (e.g., all devices with 'finance' tag)
- Location-based scheduled scans (e.g., all devices in 'Building A')
- IP-based scheduled scans (specific IP addresses)
- All-device scheduled scans (scan all connected devices)
- Multi-device isolation (each firewall has independent schedules)

Version: 1.12.0 (Security Monitoring)
Author: PANfm
"""

import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from logger import debug, info, warning, error, exception
from scan_storage import ScanStorage
from device_manager import device_manager
from device_metadata import load_metadata
from firewall_api import get_firewall_config
from firewall_api_devices import get_connected_devices
from firewall_api_nmap import run_nmap_scan
from config import load_settings


class ScanScheduler:
    """
    Manages scheduled nmap scans using APScheduler.

    Features:
    - Schedule scans based on tags, locations, IPs, or all devices
    - Support interval, daily, weekly, and cron schedules
    - Multi-device support (each firewall has independent schedules)
    - Concurrent scan execution with resource limits
    - Queue-based execution tracking
    """

    def __init__(self, storage: ScanStorage, max_concurrent_scans: int = 3):
        """
        Initialize the scan scheduler.

        Args:
            storage: ScanStorage instance for database operations
            max_concurrent_scans: Maximum concurrent scans per device (default: 3)
        """
        debug("Initializing ScanScheduler (max_concurrent=%d)", max_concurrent_scans)

        self.storage = storage
        self.max_concurrent_scans = max_concurrent_scans
        self.scheduler = None
        self.running = False

        # Load timezone from settings
        settings = load_settings()
        self.timezone = settings.get('timezone', 'UTC')
        debug("ScanScheduler using timezone: %s", self.timezone)

        # Thread safety for concurrent operations
        self._lock = threading.Lock()

        # Track active scans per device (prevent resource exhaustion)
        self._active_scans: Dict[str, int] = {}  # {device_id: count}

        info("ScanScheduler initialized successfully (timezone=%s)", self.timezone)

    def start(self):
        """
        Start the scheduler and load all enabled schedules from database.
        """
        debug("Starting ScanScheduler")

        if self.running:
            warning("Scheduler already running, ignoring start request")
            return

        try:
            # Initialize APScheduler (BackgroundScheduler for non-blocking operation)
            self.scheduler = BackgroundScheduler(
                timezone=self.timezone,
                job_defaults={
                    'coalesce': True,           # Combine multiple missed runs
                    'max_instances': 1,         # Prevent overlapping executions
                    'misfire_grace_time': 300   # 5 minutes grace for missed jobs
                }
            )

            # Load all enabled schedules from database and add to scheduler
            self._load_schedules()

            # Start the scheduler
            self.scheduler.start()
            self.running = True

            info("ScanScheduler started successfully")

        except Exception as e:
            exception("Failed to start ScanScheduler: %s", str(e))
            raise

    def stop(self, wait: bool = True):
        """
        Stop the scheduler gracefully.

        Args:
            wait: If True, wait for running jobs to complete
        """
        debug("Stopping ScanScheduler (wait=%s)", wait)

        if not self.running:
            warning("Scheduler not running, ignoring stop request")
            return

        try:
            if self.scheduler:
                self.scheduler.shutdown(wait=wait)

            self.running = False
            info("ScanScheduler stopped successfully")

        except Exception as e:
            exception("Error stopping ScanScheduler: %s", str(e))

    def _load_schedules(self):
        """
        Load all enabled schedules from database and add to APScheduler.
        """
        debug("Loading enabled schedules from database")

        try:
            # Get all enabled schedules from database
            schedules = self.storage.get_scheduled_scans(enabled_only=True)

            if not schedules:
                debug("No enabled schedules found in database")
                return

            info("Loading %d enabled schedules", len(schedules))

            for schedule in schedules:
                try:
                    self._add_schedule_to_scheduler(schedule)
                except Exception as e:
                    error("Failed to load schedule %d: %s", schedule['id'], str(e))

            info("Loaded %d schedules successfully", len(schedules))

        except Exception as e:
            exception("Error loading schedules: %s", str(e))

    def _add_schedule_to_scheduler(self, schedule: Dict):
        """
        Add a single schedule to APScheduler.

        Args:
            schedule: Schedule dict from database
        """
        schedule_id = schedule['id']
        schedule_type = schedule['schedule_type']
        schedule_value = schedule['schedule_value']

        debug("Adding schedule %d (%s) to scheduler", schedule_id, schedule_type)

        try:
            # Build APScheduler trigger based on schedule_type
            trigger = self._build_trigger(schedule_type, schedule_value)

            # Add job to scheduler
            self.scheduler.add_job(
                func=self._execute_scheduled_scan,
                trigger=trigger,
                args=[schedule_id],
                id=f"scan_schedule_{schedule_id}",
                name=f"{schedule['name']} (ID: {schedule_id})",
                replace_existing=True
            )

            debug("Schedule %d added to APScheduler", schedule_id)

        except Exception as e:
            exception("Failed to add schedule %d to scheduler: %s", schedule_id, str(e))
            raise

    def _build_trigger(self, schedule_type: str, schedule_value: str):
        """
        Build APScheduler trigger from schedule configuration.

        Args:
            schedule_type: Type of schedule ('interval', 'daily', 'weekly', 'cron')
            schedule_value: Schedule value (depends on type)

        Returns:
            APScheduler trigger instance

        Raises:
            ValueError: If schedule configuration is invalid
        """
        debug("Building trigger for type=%s, value=%s", schedule_type, schedule_value)

        if schedule_type == 'interval':
            # Interval in seconds (e.g., '3600' for hourly)
            try:
                seconds = int(schedule_value)
                return IntervalTrigger(seconds=seconds, timezone=self.timezone)
            except ValueError:
                raise ValueError(f"Invalid interval value: {schedule_value}")

        elif schedule_type == 'daily':
            # Daily at specific time (e.g., '14:00')
            try:
                hour, minute = schedule_value.split(':')
                return CronTrigger(hour=int(hour), minute=int(minute), timezone=self.timezone)
            except ValueError:
                raise ValueError(f"Invalid daily time format: {schedule_value}")

        elif schedule_type == 'weekly':
            # Weekly on specific day and time (e.g., 'monday:14:00')
            try:
                day, time = schedule_value.split(':')
                hour, minute = time.split(':')
                return CronTrigger(
                    day_of_week=day.lower(),
                    hour=int(hour),
                    minute=int(minute),
                    timezone=self.timezone
                )
            except ValueError:
                raise ValueError(f"Invalid weekly format: {schedule_value}")

        elif schedule_type == 'cron':
            # Cron expression (e.g., '0 */6 * * *' for every 6 hours)
            try:
                minute, hour, day, month, day_of_week = schedule_value.split()
                return CronTrigger(
                    minute=minute,
                    hour=hour,
                    day=day,
                    month=month,
                    day_of_week=day_of_week,
                    timezone=self.timezone
                )
            except ValueError:
                raise ValueError(f"Invalid cron expression: {schedule_value}")

        else:
            raise ValueError(f"Unknown schedule type: {schedule_type}")

    def _execute_scheduled_scan(self, schedule_id: int):
        """
        Execute a scheduled scan (called by APScheduler).

        Args:
            schedule_id: ID of schedule to execute
        """
        debug("Executing scheduled scan %d", schedule_id)

        try:
            # Get schedule details from database
            schedules = self.storage.get_scheduled_scans()
            schedule = next((s for s in schedules if s['id'] == schedule_id), None)

            if not schedule:
                error("Schedule %d not found in database", schedule_id)
                return

            # Check if schedule is still enabled
            if not schedule.get('enabled', True):
                debug("Schedule %d is disabled, skipping execution", schedule_id)
                return

            device_id = schedule['device_id']
            target_type = schedule['target_type']
            target_value = schedule['target_value']
            scan_type = schedule['scan_type']

            info("Executing schedule %d: %s (type=%s, target=%s)",
                 schedule_id, schedule['name'], target_type, target_value)

            # Resolve targets (tag/location/ip/all → list of IPs)
            target_ips = self._resolve_targets(device_id, target_type, target_value)

            if not target_ips:
                warning("No targets found for schedule %d, skipping", schedule_id)
                self.storage.update_schedule_execution(
                    schedule_id=schedule_id,
                    status='skipped',
                    error='No targets found'
                )
                return

            info("Schedule %d resolved to %d target IPs", schedule_id, len(target_ips))

            # Queue scans for each target IP
            queued_count = 0
            for ip in target_ips:
                queue_id = self._queue_scan(
                    schedule_id=schedule_id,
                    device_id=device_id,
                    target_ip=ip,
                    scan_type=scan_type
                )
                if queue_id:
                    queued_count += 1

            info("Schedule %d: Queued %d scans", schedule_id, queued_count)

            # Process scan queue with concurrency limits
            self._process_scan_queue(device_id)

            # Update schedule execution tracking
            self.storage.update_schedule_execution(
                schedule_id=schedule_id,
                status='success'
            )

        except Exception as e:
            exception("Error executing scheduled scan %d: %s", schedule_id, str(e))
            self.storage.update_schedule_execution(
                schedule_id=schedule_id,
                status='failed',
                error=str(e)
            )

    def _resolve_targets(self, device_id: str, target_type: str,
                        target_value: Optional[str]) -> List[str]:
        """
        Resolve scan targets to list of IP addresses.

        Args:
            device_id: Device ID (firewall)
            target_type: Type of target ('tag', 'location', 'ip', 'all')
            target_value: Value for target (depends on type)

        Returns:
            List of IP addresses to scan
        """
        debug("Resolving targets: type=%s, value=%s, device=%s",
              target_type, target_value, device_id)

        try:
            # Get firewall config for this device
            firewall_config = get_firewall_config(device_id)

            # Get connected devices from firewall
            connected = get_connected_devices(firewall_config)

            if not connected:
                debug("No connected devices found on firewall %s", device_id)
                return []

            # Load device metadata for this device
            metadata = load_metadata(device_id=device_id)

            # Filter based on target_type
            if target_type == 'all':
                # Scan all connected devices
                target_ips = [d['ip'] for d in connected if d.get('ip')]
                debug("Resolved 'all' to %d IPs", len(target_ips))

            elif target_type == 'tag':
                # Scan devices with specific tag
                target_ips = []
                for device in connected:
                    mac = device.get('mac', '').lower()
                    device_meta = metadata.get(mac, {})
                    tags = device_meta.get('tags', [])

                    if target_value in tags:
                        ip = device.get('ip')
                        if ip:
                            target_ips.append(ip)

                debug("Resolved tag '%s' to %d IPs", target_value, len(target_ips))

            elif target_type == 'location':
                # Scan devices at specific location
                target_ips = []
                for device in connected:
                    mac = device.get('mac', '').lower()
                    device_meta = metadata.get(mac, {})
                    location = device_meta.get('location', '')

                    if location == target_value:
                        ip = device.get('ip')
                        if ip:
                            target_ips.append(ip)

                debug("Resolved location '%s' to %d IPs", target_value, len(target_ips))

            elif target_type == 'ip':
                # Scan specific IP address
                target_ips = [target_value] if target_value else []
                debug("Resolved IP to 1 target")

            else:
                error("Unknown target type: %s", target_type)
                return []

            return target_ips

        except Exception as e:
            exception("Error resolving targets: %s", str(e))
            return []

    def _queue_scan(self, schedule_id: int, device_id: str,
                   target_ip: str, scan_type: str) -> Optional[int]:
        """
        Queue a scan for execution.

        Args:
            schedule_id: ID of schedule that triggered this scan
            device_id: Device ID (firewall)
            target_ip: Target IP address
            scan_type: Scan type ('quick', 'balanced', 'thorough')

        Returns:
            Queue ID if successful, None otherwise
        """
        debug("Queueing scan: device=%s, ip=%s, type=%s",
              device_id, target_ip, scan_type)

        try:
            queued_at = datetime.now().isoformat()

            # Insert into scan_queue table
            queue_id = self.storage.create_scan_queue_entry(
                schedule_id=schedule_id,
                device_id=device_id,
                target_ip=target_ip,
                scan_type=scan_type,
                status='queued',
                queued_at=queued_at
            )

            if queue_id:
                debug("Scan queued with ID %d", queue_id)
            else:
                error("Failed to queue scan for IP %s", target_ip)

            return queue_id

        except Exception as e:
            exception("Error queueing scan: %s", str(e))
            return None

    def _process_scan_queue(self, device_id: str):
        """
        Process queued scans for a specific device with concurrency limits.

        Args:
            device_id: Device ID to process queue for
        """
        debug("Processing scan queue for device %s", device_id)

        try:
            # Get queued scans for this device
            queued_scans = self.storage.get_queued_scans(device_id=device_id)

            if not queued_scans:
                debug("No queued scans for device %s", device_id)
                return

            info("Processing %d queued scans for device %s",
                 len(queued_scans), device_id)

            # Execute scans with concurrency limit
            with ThreadPoolExecutor(max_workers=self.max_concurrent_scans) as executor:
                futures = {
                    executor.submit(self._execute_scan, scan): scan
                    for scan in queued_scans
                }

                for future in as_completed(futures):
                    scan = futures[future]
                    try:
                        future.result()  # Wait for completion
                    except Exception as e:
                        error("Scan execution failed for queue %d: %s",
                              scan['id'], str(e))

            info("Completed processing scan queue for device %s", device_id)

        except Exception as e:
            exception("Error processing scan queue: %s", str(e))

    def _execute_scan(self, queue_entry: Dict):
        """
        Execute a single scan from the queue.

        Args:
            queue_entry: Queue entry dict from database
        """
        queue_id = queue_entry['id']
        device_id = queue_entry['device_id']
        target_ip = queue_entry['target_ip']
        scan_type = queue_entry['scan_type']

        debug("Executing scan from queue %d: ip=%s", queue_id, target_ip)

        try:
            # Update queue status to 'running'
            started_at = datetime.now().isoformat()
            self.storage.update_scan_queue_entry(
                queue_id=queue_id,
                status='running',
                started_at=started_at
            )

            # Execute nmap scan
            result = run_nmap_scan(ip_address=target_ip, scan_type=scan_type)

            if result['success']:
                # Store scan result in database
                scan_id = self.storage.store_scan_result(
                    device_id=device_id,
                    ip_address=target_ip,
                    scan_type=scan_type,
                    scan_data=result['data'],
                    raw_xml=result['raw_xml']
                )

                # Update queue status to 'completed'
                completed_at = datetime.now().isoformat()
                self.storage.update_scan_queue_entry(
                    queue_id=queue_id,
                    status='completed',
                    completed_at=completed_at,
                    scan_id=scan_id
                )

                info("Scan completed: queue=%d, ip=%s, scan_id=%d",
                     queue_id, target_ip, scan_id)

            else:
                # Scan failed, update queue with error
                completed_at = datetime.now().isoformat()
                self.storage.update_scan_queue_entry(
                    queue_id=queue_id,
                    status='failed',
                    completed_at=completed_at,
                    error_message=result['message']
                )

                error("Scan failed: queue=%d, ip=%s, error=%s",
                      queue_id, target_ip, result['message'])

        except Exception as e:
            exception("Error executing scan from queue %d: %s", queue_id, str(e))

            # Update queue status to 'failed'
            completed_at = datetime.now().isoformat()
            self.storage.update_scan_queue_entry(
                queue_id=queue_id,
                status='failed',
                completed_at=completed_at,
                error_message=str(e)
            )

    def add_schedule(self, device_id: str, name: str, target_type: str,
                    target_value: Optional[str], scan_type: str,
                    schedule_type: str, schedule_value: str,
                    description: Optional[str] = None,
                    created_by: str = 'admin') -> Optional[int]:
        """
        Add a new scheduled scan.

        Args:
            device_id: Device ID (firewall)
            name: Friendly name for schedule
            target_type: Type of target ('tag', 'location', 'ip', 'all')
            target_value: Value for target (depends on type)
            scan_type: Scan type ('quick', 'balanced', 'thorough')
            schedule_type: Schedule type ('interval', 'daily', 'weekly', 'cron')
            schedule_value: Schedule value (depends on type)
            description: Optional description
            created_by: Username who created the schedule

        Returns:
            Schedule ID if successful, None otherwise
        """
        debug("Adding new schedule: %s for device %s", name, device_id)

        try:
            # Create schedule in database
            schedule_id = self.storage.create_scheduled_scan(
                device_id=device_id,
                name=name,
                target_type=target_type,
                target_value=target_value,
                scan_type=scan_type,
                schedule_type=schedule_type,
                schedule_value=schedule_value,
                description=description,
                created_by=created_by
            )

            if not schedule_id:
                error("Failed to create schedule in database")
                return None

            # Add to APScheduler if scheduler is running
            if self.running:
                schedule = {
                    'id': schedule_id,
                    'name': name,
                    'schedule_type': schedule_type,
                    'schedule_value': schedule_value
                }
                self._add_schedule_to_scheduler(schedule)

            info("Schedule %d created successfully", schedule_id)
            return schedule_id

        except Exception as e:
            exception("Failed to add schedule: %s", str(e))
            return None

    def remove_schedule(self, schedule_id: int) -> bool:
        """
        Remove a scheduled scan.

        Args:
            schedule_id: Schedule ID to remove

        Returns:
            True if successful, False otherwise
        """
        debug("Removing schedule %d", schedule_id)

        try:
            # Remove from APScheduler if running
            if self.running:
                job_id = f"scan_schedule_{schedule_id}"
                try:
                    self.scheduler.remove_job(job_id)
                    debug("Removed job %s from scheduler", job_id)
                except Exception:
                    debug("Job %s not found in scheduler", job_id)

            # Delete from database
            success = self.storage.delete_scheduled_scan(schedule_id)

            if success:
                info("Schedule %d removed successfully", schedule_id)
            else:
                error("Failed to remove schedule %d from database", schedule_id)

            return success

        except Exception as e:
            exception("Failed to remove schedule: %s", str(e))
            return False

    def update_schedule(self, schedule_id: int, **kwargs) -> bool:
        """
        Update a scheduled scan.

        Args:
            schedule_id: Schedule ID to update
            **kwargs: Fields to update

        Returns:
            True if successful, False otherwise
        """
        debug("Updating schedule %d", schedule_id)

        try:
            # Update in database
            success = self.storage.update_scheduled_scan(schedule_id, **kwargs)

            if not success:
                error("Failed to update schedule in database")
                return False

            # If schedule configuration changed, reload in APScheduler
            if self.running and ('schedule_type' in kwargs or 'schedule_value' in kwargs):
                # Remove old job
                job_id = f"scan_schedule_{schedule_id}"
                try:
                    self.scheduler.remove_job(job_id)
                except Exception:
                    pass

                # Get updated schedule and re-add
                schedules = self.storage.get_scheduled_scans()
                schedule = next((s for s in schedules if s['id'] == schedule_id), None)

                if schedule and schedule.get('enabled', True):
                    self._add_schedule_to_scheduler(schedule)

            info("Schedule %d updated successfully", schedule_id)
            return True

        except Exception as e:
            exception("Failed to update schedule: %s", str(e))
            return False


# Module initialization
debug("scan_scheduler module loaded (v1.12.0 - Security Monitoring)")
