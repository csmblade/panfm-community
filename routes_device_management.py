"""
Flask route handlers for device CRUD operations
Handles device list, create, read, update, delete, and connection testing
"""
from flask import jsonify, request
from auth import login_required
from config import load_settings, save_settings, EDITION, MAX_DEVICES
from device_manager import device_manager
from firewall_api import get_device_system_info  # OPTIMIZED: Combined uptime+version
from logger import debug, info, error, exception
from concurrent.futures import ThreadPoolExecutor, as_completed
from time import time


def register_device_management_routes(app, csrf, limiter):
    """Register device management CRUD routes"""
    debug("Registering device management CRUD routes")

    # ============================================================================
    # Device Info Caching (OPTIMIZATION)
    # ============================================================================
    # Cache device system info (uptime, version) for 30 seconds to reduce API calls
    _device_info_cache = {}
    CACHE_TTL = 30  # seconds

    def get_device_info_cached(device_id):
        """Get device system info with TTL-based caching"""
        now = time()
        cache_key = device_id

        # Check cache
        if cache_key in _device_info_cache:
            cached_data, cached_time = _device_info_cache[cache_key]
            if now - cached_time < CACHE_TTL:
                debug(f"Cache HIT for device {device_id} (age: {int(now - cached_time)}s)")
                return cached_data

        # Cache miss or expired - fetch from firewall
        debug(f"Cache MISS for device {device_id} - fetching from firewall")
        info = get_device_system_info(device_id)
        _device_info_cache[cache_key] = (info, now)
        return info

    # ============================================================================
    # Device Management API Endpoints
    # ============================================================================

    @app.route('/api/devices', methods=['GET'])
    @limiter.limit("600 per hour")  # Support frequent device list reads
    @login_required
    def get_devices():
        """Get all devices with encrypted API keys (OPTIMIZED: parallel + cached)"""
        try:
            start_time = time()

            # Load devices with encrypted API keys for API response (security)
            devices = device_manager.load_devices(decrypt_api_keys=False)
            groups = device_manager.get_groups()

            # Identify enabled devices that need info fetching
            enabled_devices = [d for d in devices if d.get('enabled', True)]
            debug(f"Fetching info for {len(enabled_devices)} enabled devices")

            # OPTIMIZATION: Fetch device info in parallel using ThreadPoolExecutor
            # This reduces load time from N×2s (sequential) to max(2s) (parallel)
            def fetch_device_info(device):
                """Fetch system info for a single device (runs in thread pool)"""
                try:
                    info = get_device_info_cached(device['id'])
                    device['uptime'] = info['uptime'] if info['uptime'] else 'N/A'
                    device['version'] = info['version'] if info['version'] else 'N/A'
                except Exception as e:
                    debug(f"Error fetching info for device {device['id']}: {str(e)}")
                    device['uptime'] = 'N/A'
                    device['version'] = 'N/A'
                return device

            # Use ThreadPoolExecutor for parallel execution (max 5 workers per API limit)
            with ThreadPoolExecutor(max_workers=5) as executor:
                # Submit all enabled devices for processing
                futures = {executor.submit(fetch_device_info, device): device for device in enabled_devices}

                # Wait for all futures to complete
                for future in as_completed(futures):
                    try:
                        future.result()  # Results are updated in-place on device dict
                    except Exception as e:
                        debug(f"Thread pool future failed: {str(e)}")

            # Mark disabled devices
            for device in devices:
                if not device.get('enabled', True):
                    device['uptime'] = 'Disabled'
                    device['version'] = 'N/A'

            elapsed = (time() - start_time) * 1000  # Convert to ms
            debug(f"Device list loaded in {elapsed:.0f}ms (parallel + cached)")

            return jsonify({
                'status': 'success',
                'devices': devices,
                'groups': groups
            })
        except Exception as e:
            exception(f"Error in get_devices: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/devices', methods=['POST'])
    @login_required
    @limiter.limit("100 per hour")
    def create_device():
        """Add a new device and manage selected_device_id"""
        debug("Create device request received")
        try:
            data = request.get_json()
            name = data.get('name', '').strip()
            ip = data.get('ip', '').strip()
            api_key = data.get('api_key', '').strip()
            group = data.get('group', 'Default')
            description = data.get('description', '')
            wan_interface = data.get('wan_interface', '').strip()

            debug(f"Adding new device: name={name}, ip={ip}, group={group}")

            # Validate required fields
            if not name or not ip or not api_key:
                debug("Validation failed: missing required fields")
                return jsonify({
                    'status': 'error',
                    'message': 'Name, IP, and API Key are required'
                }), 400

            # SECURITY: Input validation for device fields
            import re

            # Validate device name (alphanumeric, spaces, hyphens, underscores, max 100 chars)
            if not re.match(r'^[\w\s\-\.]{1,100}$', name):
                debug(f"Validation failed: invalid device name format: {name}")
                return jsonify({
                    'status': 'error',
                    'message': 'Device name must be 1-100 characters (letters, numbers, spaces, hyphens, underscores, dots)'
                }), 400

            # Validate IP address format
            import ipaddress
            try:
                ipaddress.ip_address(ip)
            except ValueError:
                debug(f"Validation failed: invalid IP address: {ip}")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid IP address format'
                }), 400

            # Validate group name if provided (alphanumeric, spaces, hyphens, underscores, max 50 chars)
            if group and not re.match(r'^[\w\s\-]{1,50}$', group):
                debug(f"Validation failed: invalid group name: {group}")
                return jsonify({
                    'status': 'error',
                    'message': 'Group name must be 1-50 characters (letters, numbers, spaces, hyphens, underscores)'
                }), 400

            # Validate WAN interface if provided (ethernet format)
            if wan_interface and not re.match(r'^(ethernet\d+/\d+|vlan\.\d+|loopback\.\d+|tunnel\.\d+)?$', wan_interface):
                debug(f"Validation failed: invalid WAN interface: {wan_interface}")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid interface format (e.g., ethernet1/1, vlan.100)'
                }), 400

            # Get device count before adding
            existing_devices = device_manager.load_devices(decrypt_api_keys=False)
            was_first_device = len(existing_devices) == 0
            debug(f"Existing device count: {len(existing_devices)}, is_first_device: {was_first_device}")

            # COMMUNITY EDITION: Check device limit
            if EDITION == 'community' and len(existing_devices) >= MAX_DEVICES:
                info(f"Community Edition device limit reached ({len(existing_devices)}/{MAX_DEVICES})")
                return jsonify({
                    'status': 'error',
                    'error': f'Community Edition is limited to {MAX_DEVICES} devices',
                    'edition': 'community',
                    'current_devices': len(existing_devices),
                    'max_devices': MAX_DEVICES,
                    'upgrade_url': 'https://panfm.io/pricing',
                    'message': f'Community Edition supports up to {MAX_DEVICES} devices. Upgrade to Enterprise Edition for unlimited devices.'
                }), 403

            new_device = device_manager.add_device(name, ip, api_key, group, description, wan_interface=wan_interface)
            debug(f"Device added successfully: {new_device['name']} ({new_device['id']})")

            # Auto-select this device if it's the first device OR no device is currently selected
            settings = load_settings()
            current_selected = settings.get('selected_device_id', '')
            auto_selected = False

            # Check if current selection is valid
            if current_selected:
                # Verify the currently selected device still exists
                selected_device_exists = device_manager.get_device(current_selected) is not None
                debug(f"Current selected device {current_selected} exists: {selected_device_exists}")
                if not selected_device_exists:
                    current_selected = ''

            if not current_selected or was_first_device:
                settings['selected_device_id'] = new_device['id']
                save_settings(settings)
                auto_selected = True
                info(f"Auto-selected device {new_device['name']} ({new_device['id']}) - first_device={was_first_device}, no_selection={not current_selected}")
                debug(f"Updated selected_device_id to: {new_device['id']}")
            else:
                debug(f"Device not auto-selected. Current selection: {current_selected}")

            return jsonify({
                'status': 'success',
                'device': new_device,
                'auto_selected': auto_selected,
                'message': 'Device added successfully'
            })
        except Exception as e:
            exception(f"Error creating device: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/devices/<device_id>', methods=['GET'])
    @login_required
    def get_device(device_id):
        """Get a specific device with encrypted API key"""
        try:
            # Get all devices with encrypted keys, then find the specific one
            devices = device_manager.load_devices(decrypt_api_keys=False)
            device = next((d for d in devices if d.get('id') == device_id), None)
            if device:
                return jsonify({
                    'status': 'success',
                    'device': device
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Device not found'
                }), 404
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/devices/<device_id>', methods=['PUT'])
    @login_required
    @limiter.limit("100 per hour")
    def update_device(device_id):
        """Update a device"""
        try:
            data = request.get_json()

            # If api_key is empty or not provided, remove it from updates to preserve existing key
            if 'api_key' in data and not data['api_key']:
                debug("API key is empty, removing from updates to preserve existing key")
                del data['api_key']

            updated_device = device_manager.update_device(device_id, data)
            if updated_device:
                return jsonify({
                    'status': 'success',
                    'device': updated_device,
                    'message': 'Device updated successfully'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Device not found'
                }), 404
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/devices/<device_id>', methods=['DELETE'])
    @login_required
    @limiter.limit("100 per hour")
    def delete_device(device_id):
        """Delete a device and manage selected_device_id"""
        debug(f"Delete device request for device_id: {device_id}")
        try:
            # Get device info before deleting for logging
            device_to_delete = device_manager.get_device(device_id)
            device_name = device_to_delete.get('name', 'unknown') if device_to_delete else 'unknown'

            success = device_manager.delete_device(device_id)
            if success:
                debug(f"Device {device_name} ({device_id}) deleted successfully")

                # Check if the deleted device was the selected one
                settings = load_settings()
                was_selected = settings.get('selected_device_id') == device_id
                debug(f"Deleted device was selected: {was_selected}")

                if was_selected:
                    # Get remaining devices (use load_devices, not decrypt for API responses)
                    remaining_devices = device_manager.load_devices(decrypt_api_keys=False)
                    debug(f"Remaining devices after deletion: {len(remaining_devices)}")

                    if remaining_devices:
                        # Select the first remaining device
                        new_selected_id = remaining_devices[0]['id']
                        new_selected_name = remaining_devices[0]['name']
                        settings['selected_device_id'] = new_selected_id
                        save_settings(settings)
                        info(f"Deleted device was selected. Auto-selected device {new_selected_name} ({new_selected_id})")
                        debug(f"Updated selected_device_id to: {new_selected_id}")
                    else:
                        # No devices left, clear selection
                        settings['selected_device_id'] = ''
                        save_settings(settings)
                        info("Deleted last device. Cleared device selection")
                        debug("Cleared selected_device_id (no devices remaining)")

                return jsonify({
                    'status': 'success',
                    'message': 'Device deleted successfully'
                })
            else:
                error(f"Failed to delete device {device_id}")
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to delete device'
                }), 500
        except Exception as e:
            exception(f"Error deleting device {device_id}: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/devices/<device_id>/test', methods=['POST'])
    @limiter.limit("60 per hour")  # Connection tests involve firewall API calls
    @login_required
    def test_device_connection(device_id):
        """Test connection to a device"""
        try:
            device = device_manager.get_device(device_id)
            if not device:
                return jsonify({
                    'status': 'error',
                    'message': 'Device not found'
                }), 404

            result = device_manager.test_connection(device['ip'], device['api_key'])
            return jsonify({
                'status': 'success' if result['success'] else 'error',
                'message': result['message']
            })
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/devices/test-connection', methods=['POST'])
    @limiter.limit("60 per hour")  # Connection tests involve firewall API calls
    @login_required
    def test_new_device_connection():
        """Test connection to a device (before saving)"""
        try:
            data = request.get_json()
            ip = data.get('ip', '').strip()
            api_key = data.get('api_key', '').strip()

            if not ip or not api_key:
                return jsonify({
                    'status': 'error',
                    'message': 'IP and API Key are required'
                }), 400

            result = device_manager.test_connection(ip, api_key)
            return jsonify({
                'status': 'success' if result['success'] else 'error',
                'message': result['message']
            })
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500
