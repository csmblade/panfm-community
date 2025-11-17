"""
Security Monitoring Routes for PANfm
API endpoints for scheduled scan management and security dashboard.

Endpoints:
- Schedule CRUD (create, read, update, delete)
- Schedule execution status
- Scan queue management
- Security dashboard statistics

Version: 1.12.0 (Security Monitoring)
Author: PANfm
"""

from flask import Blueprint, jsonify, request, session
from auth import login_required
from logger import debug, info, warning, error, exception
from config import load_settings, NMAP_SCANS_DB_FILE
from scan_storage import ScanStorage
from scan_scheduler import ScanScheduler
from device_metadata import get_all_tags, get_all_locations
from typing import Optional


def register_security_routes(app, limiter):
    """
    Register security monitoring routes with Flask app.

    Args:
        app: Flask application instance
        limiter: Flask-Limiter instance for rate limiting
    """
    debug("Registering security monitoring routes")

    # Initialize scan storage (shared instance)
    storage = ScanStorage(NMAP_SCANS_DB_FILE)

    # Note: Scheduler is managed by clock.py, not initialized here
    # These routes interact with database directly

    # ============================================================================
    # Scheduled Scans Management
    # ============================================================================

    @app.route('/api/security/schedules', methods=['GET'])
    @login_required
    @limiter.limit("600 per hour")  # Read endpoint
    def get_scheduled_scans():
        """
        Retrieve all scheduled scans with optional filtering.

        Query parameters:
            - device_id: Filter by device ID (optional)
            - enabled_only: Return only enabled schedules (true/false, default: false)

        Response:
            {
                "status": "success",
                "schedules": [
                    {
                        "id": 1,
                        "device_id": "...",
                        "name": "Finance Tag Scan",
                        "description": "Scan all devices with finance tag",
                        "target_type": "tag",
                        "target_value": "finance",
                        "scan_type": "balanced",
                        "schedule_type": "daily",
                        "schedule_value": "14:00",
                        "enabled": true,
                        "last_run_timestamp": "2025-11-14T...",
                        "last_run_status": "success",
                        "created_at": "2025-11-14T...",
                        "created_by": "admin"
                    }
                ],
                "count": 1
            }
        """
        debug("=== Get scheduled scans endpoint called ===")

        try:
            # Get query parameters
            device_id = request.args.get('device_id')
            enabled_only = request.args.get('enabled_only', 'false').lower() == 'true'

            # Retrieve schedules from database
            schedules = storage.get_scheduled_scans(
                device_id=device_id,
                enabled_only=enabled_only
            )

            info("Retrieved %d scheduled scans", len(schedules))

            return jsonify({
                'status': 'success',
                'schedules': schedules,
                'count': len(schedules)
            })

        except Exception as e:
            exception("Error retrieving scheduled scans: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error retrieving scheduled scans: {str(e)}'
            }), 500

    @app.route('/api/security/schedules', methods=['POST'])
    @login_required
    @limiter.limit("100 per hour")  # Write endpoint
    def create_scheduled_scan():
        """
        Create a new scheduled scan.

        Request body:
            {
                "device_id": "uuid",
                "name": "Finance Tag Scan",
                "description": "Scan all devices with finance tag",
                "target_type": "tag|location|ip|all",
                "target_value": "finance" (or null for 'all'),
                "scan_type": "quick|balanced|thorough",
                "schedule_type": "interval|daily|weekly|cron",
                "schedule_value": "3600" | "14:00" | "monday:14:00" | "0 */6 * * *"
            }

        Response:
            {
                "status": "success",
                "message": "Schedule created successfully",
                "schedule_id": 1
            }
        """
        debug("=== Create scheduled scan endpoint called ===")

        try:
            # Get request data
            data = request.get_json()

            if not data:
                return jsonify({
                    'status': 'error',
                    'message': 'Request body required'
                }), 400

            # Validate required fields
            required_fields = ['device_id', 'name', 'target_type', 'scan_type',
                             'schedule_type', 'schedule_value']

            for field in required_fields:
                if field not in data:
                    return jsonify({
                        'status': 'error',
                        'message': f'Missing required field: {field}'
                    }), 400

            # Validate target_type
            valid_target_types = ['tag', 'location', 'ip', 'all']
            if data['target_type'] not in valid_target_types:
                return jsonify({
                    'status': 'error',
                    'message': f'Invalid target_type. Must be one of: {", ".join(valid_target_types)}'
                }), 400

            # Validate scan_type
            valid_scan_types = ['quick', 'balanced', 'thorough']
            if data['scan_type'] not in valid_scan_types:
                return jsonify({
                    'status': 'error',
                    'message': f'Invalid scan_type. Must be one of: {", ".join(valid_scan_types)}'
                }), 400

            # Validate schedule_type
            valid_schedule_types = ['interval', 'daily', 'weekly', 'cron']
            if data['schedule_type'] not in valid_schedule_types:
                return jsonify({
                    'status': 'error',
                    'message': f'Invalid schedule_type. Must be one of: {", ".join(valid_schedule_types)}'
                }), 400

            # Get username from session
            username = session.get('username', 'admin')

            # Create schedule in database
            schedule_id = storage.create_scheduled_scan(
                device_id=data['device_id'],
                name=data['name'],
                target_type=data['target_type'],
                target_value=data.get('target_value'),
                scan_type=data['scan_type'],
                schedule_type=data['schedule_type'],
                schedule_value=data['schedule_value'],
                description=data.get('description'),
                created_by=username
            )

            if schedule_id:
                info("Created scheduled scan %d: %s", schedule_id, data['name'])
                return jsonify({
                    'status': 'success',
                    'message': 'Schedule created successfully',
                    'schedule_id': schedule_id
                })
            else:
                error("Failed to create scheduled scan")
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to create schedule'
                }), 500

        except Exception as e:
            exception("Error creating scheduled scan: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error creating schedule: {str(e)}'
            }), 500

    @app.route('/api/security/schedules/<int:schedule_id>', methods=['GET'])
    @login_required
    @limiter.limit("600 per hour")  # Read endpoint
    def get_scheduled_scan(schedule_id):
        """
        Get a specific scheduled scan by ID.

        Response:
            {
                "status": "success",
                "schedule": { ... }
            }
        """
        debug("=== Get scheduled scan endpoint called for ID: %d ===", schedule_id)

        try:
            # Retrieve all schedules and find the one with matching ID
            schedules = storage.get_scheduled_scans()
            schedule = next((s for s in schedules if s['id'] == schedule_id), None)

            if schedule:
                return jsonify({
                    'status': 'success',
                    'schedule': schedule
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': f'Schedule {schedule_id} not found'
                }), 404

        except Exception as e:
            exception("Error retrieving schedule %d: %s", schedule_id, str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error retrieving schedule: {str(e)}'
            }), 500

    @app.route('/api/security/schedules/<int:schedule_id>', methods=['PUT'])
    @login_required
    @limiter.limit("100 per hour")  # Write endpoint
    def update_scheduled_scan(schedule_id):
        """
        Update a scheduled scan.

        Request body (all fields optional):
            {
                "name": "Updated Name",
                "description": "Updated description",
                "target_type": "tag|location|ip|all",
                "target_value": "...",
                "scan_type": "quick|balanced|thorough",
                "schedule_type": "interval|daily|weekly|cron",
                "schedule_value": "...",
                "enabled": true|false
            }

        Response:
            {
                "status": "success",
                "message": "Schedule updated successfully"
            }
        """
        debug("=== Update scheduled scan endpoint called for ID: %d ===", schedule_id)

        try:
            # Get request data
            data = request.get_json()

            if not data:
                return jsonify({
                    'status': 'error',
                    'message': 'Request body required'
                }), 400

            # Get username from session
            username = session.get('username', 'admin')
            data['updated_by'] = username

            # Update schedule in database
            success = storage.update_scheduled_scan(schedule_id, **data)

            if success:
                info("Updated scheduled scan %d", schedule_id)
                return jsonify({
                    'status': 'success',
                    'message': 'Schedule updated successfully'
                })
            else:
                error("Failed to update schedule %d", schedule_id)
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to update schedule'
                }), 500

        except Exception as e:
            exception("Error updating schedule %d: %s", schedule_id, str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error updating schedule: {str(e)}'
            }), 500

    @app.route('/api/security/schedules/<int:schedule_id>', methods=['DELETE'])
    @login_required
    @limiter.limit("100 per hour")  # Write endpoint
    def delete_scheduled_scan(schedule_id):
        """
        Delete a scheduled scan.

        Response:
            {
                "status": "success",
                "message": "Schedule deleted successfully"
            }
        """
        debug("=== Delete scheduled scan endpoint called for ID: %d ===", schedule_id)

        try:
            # Delete schedule from database
            success = storage.delete_scheduled_scan(schedule_id)

            if success:
                info("Deleted scheduled scan %d", schedule_id)
                return jsonify({
                    'status': 'success',
                    'message': 'Schedule deleted successfully'
                })
            else:
                error("Failed to delete schedule %d", schedule_id)
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to delete schedule'
                }), 500

        except Exception as e:
            exception("Error deleting schedule %d: %s", schedule_id, str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error deleting schedule: {str(e)}'
            }), 500

    @app.route('/api/security/schedules/<int:schedule_id>/toggle', methods=['POST'])
    @login_required
    @limiter.limit("100 per hour")  # Write endpoint
    def toggle_scheduled_scan(schedule_id):
        """
        Toggle a schedule's enabled status.

        Response:
            {
                "status": "success",
                "message": "Schedule enabled/disabled",
                "enabled": true|false
            }
        """
        debug("=== Toggle scheduled scan endpoint called for ID: %d ===", schedule_id)

        try:
            # Get current schedule
            schedules = storage.get_scheduled_scans()
            schedule = next((s for s in schedules if s['id'] == schedule_id), None)

            if not schedule:
                return jsonify({
                    'status': 'error',
                    'message': f'Schedule {schedule_id} not found'
                }), 404

            # Toggle enabled status
            new_enabled = not schedule.get('enabled', True)

            # Get username from session
            username = session.get('username', 'admin')

            # Update schedule
            success = storage.update_scheduled_scan(
                schedule_id,
                enabled=new_enabled,
                updated_by=username
            )

            if success:
                status_text = 'enabled' if new_enabled else 'disabled'
                info("Schedule %d %s", schedule_id, status_text)
                return jsonify({
                    'status': 'success',
                    'message': f'Schedule {status_text}',
                    'enabled': new_enabled
                })
            else:
                error("Failed to toggle schedule %d", schedule_id)
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to toggle schedule'
                }), 500

        except Exception as e:
            exception("Error toggling schedule %d: %s", schedule_id, str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error toggling schedule: {str(e)}'
            }), 500

    # ============================================================================
    # Schedule Helper Endpoints
    # ============================================================================

    @app.route('/api/security/schedule-targets', methods=['GET'])
    @login_required
    @limiter.limit("600 per hour")  # Read endpoint
    def get_schedule_targets():
        """
        Get available schedule targets (tags and locations).

        Query parameters:
            - device_id: Device ID to get targets for (optional)

        Response:
            {
                "status": "success",
                "tags": ["finance", "priority", "employee"],
                "locations": ["Building A", "Server Room", "Office 205"]
            }
        """
        debug("=== Get schedule targets endpoint called ===")

        try:
            # Get device ID from query params or settings
            device_id = request.args.get('device_id')

            if not device_id:
                settings = load_settings()
                device_id = settings.get('selected_device_id')

            # Get tags and locations from metadata
            tags = get_all_tags(device_id=device_id)
            locations = get_all_locations(device_id=device_id)

            debug("Retrieved %d tags and %d locations", len(tags), len(locations))

            return jsonify({
                'status': 'success',
                'tags': tags,
                'locations': locations
            })

        except Exception as e:
            exception("Error retrieving schedule targets: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error retrieving targets: {str(e)}'
            }), 500

    # ============================================================================
    # Scan Queue Endpoints
    # ============================================================================

    @app.route('/api/security/scan-queue', methods=['GET'])
    @login_required
    @limiter.limit("600 per hour")  # Read endpoint
    def get_scan_queue():
        """
        Get queued scans with optional filtering.

        Query parameters:
            - device_id: Filter by device ID (optional)

        Response:
            {
                "status": "success",
                "queue": [
                    {
                        "id": 1,
                        "schedule_id": 1,
                        "device_id": "...",
                        "target_ip": "192.168.1.100",
                        "scan_type": "balanced",
                        "status": "queued",
                        "queued_at": "2025-11-14T...",
                        "started_at": null,
                        "completed_at": null
                    }
                ],
                "count": 1
            }
        """
        debug("=== Get scan queue endpoint called ===")

        try:
            # Get device ID from query params
            device_id = request.args.get('device_id')

            # Retrieve queued scans
            queue = storage.get_queued_scans(device_id=device_id)

            info("Retrieved %d queued scans", len(queue))

            return jsonify({
                'status': 'success',
                'queue': queue,
                'count': len(queue)
            })

        except Exception as e:
            exception("Error retrieving scan queue: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error retrieving scan queue: {str(e)}'
            }), 500

    # ============================================================================
    # Security Dashboard Statistics
    # ============================================================================

    @app.route('/api/security/dashboard', methods=['GET'])
    @login_required
    @limiter.limit("600 per hour")  # Read endpoint
    def get_security_dashboard():
        """
        Get security dashboard statistics.

        Query parameters:
            - device_id: Device ID to get stats for (optional)

        Response:
            {
                "status": "success",
                "stats": {
                    "total_schedules": 5,
                    "enabled_schedules": 3,
                    "disabled_schedules": 2,
                    "queued_scans": 10,
                    "recent_scans": 25,
                    "recent_changes": 5,
                    "critical_changes": 2,
                    "unacknowledged_changes": 3
                }
            }
        """
        debug("=== Get security dashboard endpoint called ===")

        try:
            # Get device ID from query params or settings
            device_id = request.args.get('device_id')

            if not device_id:
                settings = load_settings()
                device_id = settings.get('selected_device_id')

            # Get schedules
            all_schedules = storage.get_scheduled_scans(device_id=device_id)
            enabled_schedules = [s for s in all_schedules if s.get('enabled', True)]
            disabled_schedules = [s for s in all_schedules if not s.get('enabled', True)]

            # Get queued scans
            queued = storage.get_queued_scans(device_id=device_id)

            # Get recent scans (last 24 hours)
            recent_scans = storage.get_scan_history(device_id=device_id, target_ip=None, limit=100)

            # Get recent changes
            all_changes = storage.get_change_events(device_id=device_id, limit=100)
            critical_changes = [c for c in all_changes if c.get('severity') == 'critical']
            unacknowledged = [c for c in all_changes if not c.get('acknowledged', False)]

            stats = {
                'total_schedules': len(all_schedules),
                'enabled_schedules': len(enabled_schedules),
                'disabled_schedules': len(disabled_schedules),
                'queued_scans': len(queued),
                'recent_scans': len(recent_scans),
                'recent_changes': len(all_changes),
                'critical_changes': len(critical_changes),
                'unacknowledged_changes': len(unacknowledged)
            }

            info("Retrieved security dashboard stats for device %s", device_id)

            return jsonify({
                'status': 'success',
                'stats': stats
            })

        except Exception as e:
            exception("Error retrieving security dashboard: %s", str(e))
            return jsonify({
                'status': 'error',
                'message': f'Error retrieving dashboard: {str(e)}'
            }), 500

    info("Security monitoring routes registered successfully")


# Module initialization
debug("routes_security module loaded (v1.12.0 - Security Monitoring)")
