"""
Flask route handlers for device metadata and connected devices
Handles connected devices, DHCP leases, device metadata CRUD, migration, and reverse DNS
"""
from flask import jsonify, request, send_file
from datetime import datetime
import json
from io import BytesIO
from auth import login_required
# device_metadata.py imports removed - now using PostgreSQL via TimescaleStorage
from firewall_api import get_firewall_config
from utils import reverse_dns_lookup
from logger import debug, info, error, exception
from config import load_settings, TIMESCALE_DSN
from throughput_storage_timescale import TimescaleStorage


def _convert_metadata_for_frontend(metadata):
    """
    Convert PostgreSQL metadata format to frontend-compatible format.
    Maps 'custom_name' to 'name' for backward compatibility.
    """
    if not metadata:
        return metadata

    # If it's a dict of MAC -> metadata, convert each entry
    if isinstance(metadata, dict) and metadata:
        # Check if this is a dict of dicts (MAC -> metadata)
        first_value = next(iter(metadata.values()))
        if isinstance(first_value, dict):
            # Multiple devices
            converted = {}
            for mac, data in metadata.items():
                converted_data = dict(data)
                if 'custom_name' in converted_data:
                    converted_data['name'] = converted_data['custom_name']
                converted[mac] = converted_data
            return converted
        else:
            # Single device metadata
            converted = dict(metadata)
            if 'custom_name' in converted:
                converted['name'] = converted['custom_name']
            return converted

    return metadata

def register_device_metadata_routes(app, csrf, limiter):
    """Register device metadata and connected devices routes"""
    debug("Registering device metadata and connected devices routes")

    # ============================================================================
    # Connected Devices & DHCP Endpoints
    # ============================================================================

    @app.route('/api/connected-devices')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def connected_devices_api():
        """API endpoint for connected devices (ARP entries) - reads from database"""
        debug("=== Connected Devices API endpoint called ===")
        try:
            # Get current device ID from settings
            settings = load_settings()
            device_id = settings.get('selected_device_id', '')

            if not device_id:
                debug("No device selected, returning empty list")
                return jsonify({
                    'status': 'success',
                    'devices': [],
                    'total': 0,
                    'message': 'No device selected',
                    'timestamp': datetime.now().isoformat()
                })

            # Check if bandwidth data is requested (v1.10.11)
            include_bandwidth = request.args.get('include_bandwidth', 'false').lower() == 'true'

            # Query from database (max 90 seconds old)
            storage = TimescaleStorage(TIMESCALE_DSN)

            if include_bandwidth:
                debug("Fetching connected devices WITH bandwidth data (60-minute window)")
                devices = storage.get_connected_devices_with_bandwidth(device_id, max_age_seconds=90, bandwidth_window_minutes=60)
            else:
                debug("Fetching connected devices WITHOUT bandwidth data")
                devices = storage.get_connected_devices(device_id, max_age_seconds=90)

            if not devices:
                debug(f"No recent connected devices data for device {device_id}, waiting for collection")
                return jsonify({
                    'status': 'success',
                    'devices': [],
                    'total': 0,
                    'message': 'Waiting for data collection (updates every 60 seconds)',
                    'timestamp': datetime.now().isoformat()
                })

            debug(f"Retrieved {len(devices)} devices from database for device {device_id} (bandwidth: {include_bandwidth})")
            return jsonify({
                'status': 'success',
                'devices': devices,
                'total': len(devices),
                'source': 'database',
                'timestamp': datetime.now().isoformat()
            })
        except Exception as e:
            exception(f"Error in connected devices API: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'devices': [],
                'total': 0
            })

    @app.route('/api/dhcp-leases')
    @limiter.limit("600 per hour")  # Support auto-refresh every 5 seconds
    @login_required
    def dhcp_leases_api():
        """API endpoint for DHCP lease information"""
        debug("=== DHCP Leases API endpoint called ===")
        try:
            firewall_config = get_firewall_config()

            # Import DHCP function
            from firewall_api_dhcp import get_dhcp_leases_detailed

            leases = get_dhcp_leases_detailed(firewall_config)
            debug(f"Retrieved {len(leases)} DHCP lease(s) from firewall")

            return jsonify({
                'status': 'success',
                'leases': leases,
                'total': len(leases),
                'timestamp': datetime.now().isoformat()
            })
        except Exception as e:
            error(f"Error in DHCP leases API: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'leases': [],
                'total': 0
            })

    # ============================================================================
    # Nmap Network Scanning Endpoint (v1.10.14)
    # ============================================================================

    @app.route('/api/connected-devices/<ip>/nmap-scan', methods=['POST'])
    @login_required
    @limiter.limit("10 per hour")  # Limit resource-intensive scans
    def nmap_scan_device(ip):
        """
        Execute nmap scan on connected device IP address.

        Security:
        - Only RFC 1918 private IPs allowed (10.x, 172.16-31.x, 192.168.x)
        - Rate limited to 10 scans per hour
        - CSRF protection required
        - Dynamic timeout: Quick (60s), Balanced (120s), Thorough (180s)

        Request body (optional):
            {
                "scan_type": "quick" | "balanced" | "thorough"  (default: "balanced")
            }

        Response:
            {
                "status": "success" | "error",
                "message": "...",
                "data": {
                    "ip": "192.168.1.100",
                    "hostname": "...",
                    "status": "up" | "down",
                    "os_matches": [...],
                    "ports": [...]
                },
                "summary": "..." (human-readable summary),
                "scan_duration": "..." (seconds)
            }
        """
        debug(f"=== Nmap scan endpoint called for IP: {ip} ===")

        try:
            # Import nmap functions
            from firewall_api_nmap import run_nmap_scan, is_private_ip, get_scan_summary
            from scan_storage import ScanStorage

            # Security: Validate RFC 1918 private IP
            if not is_private_ip(ip):
                error(f"Security: Rejected nmap scan of non-private IP: {ip}")
                return jsonify({
                    'status': 'error',
                    'message': 'Security: Only RFC 1918 private IPs can be scanned (10.x.x.x, 172.16-31.x.x, 192.168.x.x)'
                }), 403

            # Get scan type from request body (optional)
            data = request.get_json() or {}
            scan_type = data.get('scan_type', 'balanced')

            # Validate scan type
            if scan_type not in ['quick', 'balanced', 'thorough']:
                return jsonify({
                    'status': 'error',
                    'message': f'Invalid scan_type: {scan_type}. Must be quick, balanced, or thorough'
                }), 400

            info(f"Starting {scan_type} nmap scan for IP: {ip}")

            # Execute nmap scan
            scan_result = run_nmap_scan(ip, scan_type=scan_type)

            if scan_result['success']:
                # Generate human-readable summary
                summary = get_scan_summary(scan_result['data'])

                info(f"Nmap scan successful for {ip}, {len(scan_result['data'].get('ports', []))} ports found")

                # Store scan result in database and detect changes
                try:
                    settings = load_settings()
                    device_id = settings.get('selected_device_id', 'unknown')

                    storage = ScanStorage()
                    scan_id = storage.store_scan_result(device_id, ip, scan_result['data'])

                    if scan_id:
                        debug(f"Stored scan result with ID: {scan_id}")

                        # Get any detected changes
                        changes = storage.get_change_events(device_id, target_ip=ip, limit=5)
                        debug(f"Retrieved {len(changes)} recent changes for {ip}")
                    else:
                        warning(f"Failed to store scan result for {ip}")
                        changes = []
                except Exception as storage_error:
                    exception(f"Error storing scan result: {str(storage_error)}")
                    changes = []
                    # Don't fail the request if storage fails

                return jsonify({
                    'status': 'success',
                    'message': scan_result['message'],
                    'data': scan_result['data'],
                    'summary': summary,
                    'scan_duration': scan_result['data'].get('scan_duration', 'Unknown'),
                    'scan_type': scan_type,
                    'changes': changes  # Include detected changes in response
                })
            else:
                error(f"Nmap scan failed for {ip}: {scan_result['message']}")
                return jsonify({
                    'status': 'error',
                    'message': scan_result['message'],
                    'data': None
                }), 500

        except Exception as e:
            exception(f"Error in nmap scan endpoint for {ip}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Error executing nmap scan: {str(e)}'
            }), 500

    # ============================================================================
    # Nmap Scan History & Change Detection Endpoints (v1.11.0)
    # ============================================================================

    @app.route('/api/connected-devices/<ip>/scan-history', methods=['GET'])
    @login_required
    @limiter.limit("600 per hour")  # Read-only endpoint
    def get_scan_history(ip):
        """
        Retrieve nmap scan history for a target IP address.

        Query parameters:
            - limit: Maximum number of scans to return (default: 10, max: 50)

        Response:
            {
                "status": "success",
                "scans": [
                    {
                        "id": 1,
                        "scan_timestamp": "2025-11-14T...",
                        "scan_type": "balanced",
                        "scan_duration_seconds": 110.5,
                        "hostname": "...",
                        "host_status": "up",
                        "os_name": "Linux 3.x",
                        "os_accuracy": 95,
                        "total_ports": 15,
                        "open_ports_count": 5,
                        "scan_results": {...}
                    }
                ]
            }
        """
        debug(f"=== Scan history endpoint called for IP: {ip} ===")

        try:
            from scan_storage import ScanStorage

            # Get limit from query params
            limit = request.args.get('limit', 10, type=int)
            if limit > 50:
                limit = 50  # Cap at 50 for performance

            # Get device ID from settings
            settings = load_settings()
            device_id = settings.get('selected_device_id', 'unknown')

            # Retrieve scan history
            storage = ScanStorage()
            scans = storage.get_scan_history(device_id, ip, limit=limit)

            info(f"Retrieved {len(scans)} scan history records for {ip}")

            return jsonify({
                'status': 'success',
                'scans': scans,
                'count': len(scans)
            })

        except Exception as e:
            exception(f"Error retrieving scan history for {ip}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Error retrieving scan history: {str(e)}'
            }), 500

    @app.route('/api/scan-changes', methods=['GET'])
    @login_required
    @limiter.limit("600 per hour")  # Read-only endpoint
    def get_scan_changes():
        """
        Retrieve scan change events with optional filtering.

        Query parameters:
            - target_ip: Filter by specific IP address (optional)
            - severity: Filter by severity (low, medium, high, critical) (optional)
            - acknowledged: Filter by acknowledgment status (true/false) (optional)
            - limit: Maximum number of changes to return (default: 50, max: 100)

        Response:
            {
                "status": "success",
                "changes": [
                    {
                        "id": 1,
                        "device_id": "...",
                        "target_ip": "192.168.1.100",
                        "change_timestamp": "2025-11-14T...",
                        "change_type": "port_opened",
                        "severity": "critical",
                        "old_value": null,
                        "new_value": "3389/tcp",
                        "details": {...},
                        "acknowledged": false
                    }
                ]
            }
        """
        debug("=== Scan changes endpoint called ===")

        try:
            from scan_storage import ScanStorage

            # Get device ID from settings
            settings = load_settings()
            device_id = settings.get('selected_device_id', 'unknown')

            # Get query parameters
            target_ip = request.args.get('target_ip')
            severity = request.args.get('severity')
            acknowledged_str = request.args.get('acknowledged')
            limit = request.args.get('limit', 50, type=int)

            if limit > 100:
                limit = 100  # Cap at 100 for performance

            # Parse acknowledged parameter
            acknowledged = None
            if acknowledged_str is not None:
                acknowledged = acknowledged_str.lower() in ['true', '1', 'yes']

            # Retrieve change events
            storage = ScanStorage()
            changes = storage.get_change_events(
                device_id=device_id,
                target_ip=target_ip,
                severity=severity,
                acknowledged=acknowledged,
                limit=limit
            )

            info(f"Retrieved {len(changes)} change events for device {device_id}")

            return jsonify({
                'status': 'success',
                'changes': changes,
                'count': len(changes)
            })

        except Exception as e:
            exception(f"Error retrieving scan changes: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Error retrieving scan changes: {str(e)}'
            }), 500

    @app.route('/api/scan-changes/<int:change_id>/acknowledge', methods=['POST'])
    @login_required
    @limiter.limit("100 per hour")  # Write endpoint
    def acknowledge_scan_change(change_id):
        """
        Mark a scan change event as acknowledged.

        Request body:
            {
                "acknowledged_by": "username"
            }

        Response:
            {
                "status": "success",
                "message": "Change acknowledged successfully"
            }
        """
        debug(f"=== Acknowledge scan change endpoint called for change_id: {change_id} ===")

        try:
            from scan_storage import ScanStorage
            from flask import session

            # Get username from request or session
            data = request.get_json() or {}
            acknowledged_by = data.get('acknowledged_by') or session.get('username', 'unknown')

            # Acknowledge the change
            storage = ScanStorage()
            success = storage.acknowledge_change(change_id, acknowledged_by)

            if success:
                info(f"Change {change_id} acknowledged by {acknowledged_by}")
                return jsonify({
                    'status': 'success',
                    'message': 'Change acknowledged successfully'
                })
            else:
                warning(f"Failed to acknowledge change {change_id}")
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to acknowledge change'
                }), 500

        except Exception as e:
            exception(f"Error acknowledging change {change_id}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Error acknowledging change: {str(e)}'
            }), 500

    # ============================================================================
    # Device Metadata Endpoints
    # ============================================================================

    @app.route('/api/device-metadata', methods=['GET'])
    @limiter.limit("600 per hour")  # Support bulk loading on page load
    @login_required
    def get_all_device_metadata():
        """Get all device metadata (for bulk loading on page load)"""
        debug("=== Get all device metadata API endpoint called ===")
        try:
            storage = TimescaleStorage(TIMESCALE_DSN)
            metadata = storage.get_all_device_metadata()
            # Convert custom_name -> name for frontend compatibility
            metadata = _convert_metadata_for_frontend(metadata)
            debug(f"Retrieved metadata for {len(metadata)} devices from PostgreSQL")
            return jsonify({
                'status': 'success',
                'metadata': metadata
            })
        except Exception as e:
            error(f"Error loading device metadata: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'metadata': {}
            }), 500

    @app.route('/api/device-metadata/<mac>', methods=['GET'])
    @limiter.limit("600 per hour")
    @login_required
    def get_single_device_metadata(mac):
        """Get metadata for a specific MAC address"""
        debug(f"=== Get device metadata for MAC: {mac} ===")
        try:
            storage = TimescaleStorage(TIMESCALE_DSN)
            metadata = storage.get_device_metadata(mac)
            # Convert custom_name -> name for frontend compatibility
            metadata = _convert_metadata_for_frontend(metadata)
            if metadata:
                return jsonify({
                    'status': 'success',
                    'metadata': metadata
                })
            else:
                return jsonify({
                    'status': 'success',
                    'metadata': None,
                    'message': 'No metadata found for this MAC address'
                })
        except Exception as e:
            error(f"Error getting device metadata for {mac}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/device-metadata', methods=['POST'])
    @login_required
    @limiter.limit("100 per hour")  # Device management category
    def create_or_update_device_metadata():
        """Create or update device metadata (requires CSRF token)"""
        debug("=== Create/update device metadata API endpoint called ===")
        try:
            data = request.get_json()

            if not data or 'mac' not in data:
                return jsonify({
                    'status': 'error',
                    'message': 'MAC address is required'
                }), 400

            mac = data.get('mac')
            custom_name = data.get('name')
            comment = data.get('comment')
            location = data.get('location')
            tags = data.get('tags')

            # Validate tags is a list if provided
            if tags is not None and not isinstance(tags, list):
                return jsonify({
                    'status': 'error',
                    'message': 'Tags must be a list'
                }), 400

            # Get device_id from settings
            settings = load_settings()
            device_id = settings.get('selected_device_id')

            storage = TimescaleStorage(TIMESCALE_DSN)
            success = storage.upsert_device_metadata(
                mac=mac,
                custom_name=custom_name,
                location=location,
                comment=comment,
                tags=tags,
                device_id=device_id
            )

            if success:
                # Return updated metadata
                updated_metadata = storage.get_device_metadata(mac)
                # Convert custom_name -> name for frontend compatibility
                updated_metadata = _convert_metadata_for_frontend(updated_metadata)
                return jsonify({
                    'status': 'success',
                    'metadata': updated_metadata,
                    'message': 'Metadata saved successfully'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to save metadata'
                }), 500
        except Exception as e:
            error(f"Error saving device metadata: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/device-metadata/<mac>', methods=['DELETE'])
    @login_required
    @limiter.limit("100 per hour")  # Device management category
    def delete_device_metadata_endpoint(mac):
        """Delete device metadata (requires CSRF token)"""
        debug(f"=== Delete device metadata for MAC: {mac} ===")
        try:
            storage = TimescaleStorage(TIMESCALE_DSN)
            success = storage.delete_device_metadata(mac)
            if success:
                return jsonify({
                    'status': 'success',
                    'message': 'Metadata deleted successfully'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to delete metadata'
                }), 500
        except Exception as e:
            error(f"Error deleting device metadata for {mac}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/device-metadata/tags', methods=['GET'])
    @limiter.limit("600 per hour")
    @login_required
    def get_all_device_tags():
        """Get all unique tags across all devices"""
        debug("=== Get all device tags API endpoint called ===")
        try:
            storage = TimescaleStorage(TIMESCALE_DSN)
            tags = storage.get_all_tags()
            return jsonify({
                'status': 'success',
                'tags': tags
            })
        except Exception as e:
            error(f"Error getting device tags: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'tags': []
            }), 500

    @app.route('/api/device-metadata/locations', methods=['GET'])
    @limiter.limit("600 per hour")
    @login_required
    def get_all_device_locations():
        """Get all unique locations across all devices"""
        debug("=== Get all device locations API endpoint called ===")
        try:
            storage = TimescaleStorage(TIMESCALE_DSN)
            locations = storage.get_all_locations()
            return jsonify({
                'status': 'success',
                'locations': locations
            })
        except Exception as e:
            error(f"Error getting device locations: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e),
                'locations': []
            }), 500

    @app.route('/api/device-metadata/export', methods=['GET'])
    @limiter.limit("100 per hour")
    @login_required
    def export_device_metadata():
        """Export device metadata as JSON backup file"""
        debug("=== Device metadata export endpoint called ===")
        try:
            # Load metadata from PostgreSQL
            storage = TimescaleStorage(TIMESCALE_DSN)
            metadata = storage.get_all_device_metadata()

            # Add export metadata
            export_data = {
                'export_date': datetime.now().isoformat(),
                'version': '2.0',
                'source': 'PostgreSQL/TimescaleDB',
                'total_devices': len(metadata),
                'metadata': metadata
            }

            json_str = json.dumps(export_data, indent=2)
            json_bytes = json_str.encode('utf-8')

            # Create BytesIO object for file download
            json_file = BytesIO(json_bytes)
            json_file.seek(0)

            # Generate filename with timestamp
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f'device_metadata_backup_{timestamp}.json'

            return send_file(
                json_file,
                mimetype='application/json',
                as_attachment=True,
                download_name=filename
            )
        except Exception as e:
            error(f"Error exporting device metadata: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/device-metadata/import', methods=['POST'])
    @login_required
    @limiter.limit("50 per hour")  # Limit imports to prevent abuse
    def import_device_metadata():
        """Import device metadata from JSON backup file"""
        debug("=== Device metadata import endpoint called ===")
        try:
            if 'file' not in request.files:
                return jsonify({
                    'status': 'error',
                    'message': 'No file provided'
                }), 400

            file = request.files['file']

            if file.filename == '':
                return jsonify({
                    'status': 'error',
                    'message': 'No file selected'
                }), 400

            if not file.filename.endswith('.json'):
                return jsonify({
                    'status': 'error',
                    'message': 'File must be a JSON file'
                }), 400

            # Read and parse JSON
            try:
                file_content = file.read().decode('utf-8')
                import_data = json.loads(file_content)
            except json.JSONDecodeError as e:
                return jsonify({
                    'status': 'error',
                    'message': f'Invalid JSON file: {str(e)}'
                }), 400

            # Extract metadata from import data
            # Support both old format (direct metadata dict) and new format (with export metadata)
            if 'metadata' in import_data:
                metadata_to_import = import_data['metadata']
                debug(f"Importing metadata from backup file (version: {import_data.get('version', 'unknown')}, export date: {import_data.get('export_date', 'unknown')})")
            elif isinstance(import_data, dict):
                # Assume it's a metadata dict directly
                metadata_to_import = import_data
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid metadata format in file'
                }), 400

            # Validate metadata structure
            if not isinstance(metadata_to_import, dict):
                return jsonify({
                    'status': 'error',
                    'message': 'Metadata must be a dictionary'
                }), 400

            # Get device_id from settings
            settings = load_settings()
            device_id = settings.get('selected_device_id')

            # Import metadata to PostgreSQL (merges with existing)
            storage = TimescaleStorage(TIMESCALE_DSN)
            imported_count = 0
            failed_count = 0

            for mac, metadata in metadata_to_import.items():
                try:
                    success = storage.upsert_device_metadata(
                        mac=mac,
                        custom_name=metadata.get('name') or metadata.get('custom_name'),
                        location=metadata.get('location'),
                        comment=metadata.get('comment'),
                        tags=metadata.get('tags', []),
                        device_id=device_id
                    )
                    if success:
                        imported_count += 1
                    else:
                        failed_count += 1
                except Exception as e:
                    error(f"Failed to import metadata for {mac}: {str(e)}")
                    failed_count += 1

            info(f"Device metadata imported: {imported_count} successful, {failed_count} failed")
            return jsonify({
                'status': 'success',
                'message': f'Metadata imported successfully ({imported_count} devices)',
                'devices_imported': imported_count,
                'devices_failed': failed_count
            })

        except Exception as e:
            error(f"Error importing device metadata: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    # ============================================================================
    # Utility Endpoints
    # ============================================================================

    @app.route('/api/reverse-dns', methods=['POST'])
    @login_required
    def reverse_dns_api():
        """
        Perform reverse DNS lookups on a list of IP addresses.

        Request body:
            {
                "ip_addresses": ["8.8.8.8", "1.1.1.1", ...],
                "timeout": 2  (optional, default: 2)
            }

        Response:
            {
                "status": "success",
                "results": {
                    "8.8.8.8": "dns.google",
                    "1.1.1.1": "one.one.one.one",
                    ...
                }
            }
        """
        debug("=== Reverse DNS API endpoint called ===")
        try:
            data = request.get_json()
            ip_addresses = data.get('ip_addresses', [])
            timeout = data.get('timeout', 2)

            # Validate input
            if not isinstance(ip_addresses, list):
                return jsonify({
                    'status': 'error',
                    'message': 'ip_addresses must be a list'
                }), 400

            if len(ip_addresses) == 0:
                return jsonify({
                    'status': 'success',
                    'results': {}
                })

            debug(f"Processing reverse DNS lookup for {len(ip_addresses)} IP addresses")

            # Perform reverse DNS lookups
            results = reverse_dns_lookup(ip_addresses, timeout)

            debug("Reverse DNS lookup completed successfully")
            return jsonify({
                'status': 'success',
                'results': results
            })

        except Exception as e:
            error(f"Error performing reverse DNS lookup: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    debug("Device metadata and connected devices routes registered successfully")
