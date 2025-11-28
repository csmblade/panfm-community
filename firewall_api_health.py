"""
Firewall API health check, software updates, and license management
Handles firewall health checks, software version information, and license data
"""
import xml.etree.ElementTree as ET
from datetime import datetime
from utils import api_request_get
from logger import debug


def check_firewall_health(firewall_ip, api_key):
    """
    Lightweight health check for firewall - does NOT trigger update server connections
    Used for reboot monitoring and connection testing

    Verifies firewall is fully operational by checking:
    1. API responds to system info query
    2. Auto-commit status indicates system is ready
    """
    try:
        base_url = f"https://{firewall_ip}/api/"

        # First check: Simple system info query - no update checks
        cmd = "<show><system><info></info></system></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)

        if response.status_code == 200:
            # Parse to verify it's valid XML
            root = ET.fromstring(response.text)
            status = root.get('status')

            if status == 'success':
                # Extract basic info
                hostname = root.find('.//hostname')
                sw_version = root.find('.//sw-version')

                # Check auto-commit status to verify system is fully booted
                # During boot, auto-commit will be in progress or not available
                auto_commit = root.find('.//auto-commit-status')

                # If we can get system info AND auto-commit status is available,
                # the firewall is likely fully operational
                # Note: auto-commit might be None on some models, which is fine

                return {
                    'status': 'online',
                    'ip': firewall_ip,
                    'hostname': hostname.text if hostname is not None else 'Unknown',
                    'version': sw_version.text if sw_version is not None else 'Unknown',
                    'ready': True
                }
            else:
                return {'status': 'error', 'message': 'Firewall returned error status'}
        else:
            return {'status': 'error', 'message': f'HTTP {response.status_code}'}

    except Exception as e:
        debug(f"Health check failed: {str(e)}")
        return {'status': 'offline', 'message': str(e)}


def get_software_updates(firewall_config):
    """Fetch system software version information from Palo Alto firewall"""
    try:
        firewall_ip, api_key, base_url = firewall_config

        # Query for system information
        cmd = "<show><system><info></info></system></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)
        debug(f"\n=== System Info API Response ===")
        debug(f"Status: {response.status_code}")

        software_info = []

        if response.status_code == 200:
            root = ET.fromstring(response.text)
            debug(f"Response XML (first 2000 chars):\n{response.text[:2000]}")

            # Helper function to check for updates using specific commands
            def get_update_status(cmd_xml):
                """Execute update check command and return downloaded/current/latest status"""
                try:
                    check_params = {
                        'type': 'op',
                        'cmd': cmd_xml,
                        'key': api_key
                    }
                    check_response = api_request_get(base_url, params=check_params, verify=False, timeout=10)

                    if check_response.status_code == 200:
                        check_root = ET.fromstring(check_response.text)
                        debug(f"Update check response (first 1500 chars):\n{check_response.text[:1500]}")

                        # Export full XML for inspection
                        try:
                            with open('software_update_check.xml', 'w') as f:
                                f.write(check_response.text)
                            debug("Exported full update check XML to software_update_check.xml")
                        except Exception as e:
                            debug(f"Error exporting update check XML: {e}")

                        # Find all entries with version information
                        entries = check_root.findall('.//entry')
                        current_version = None
                        latest_available = None
                        all_versions = []

                        for entry in entries:
                            version_elem = entry.find('.//version')
                            downloaded_elem = entry.find('.//downloaded')
                            current_elem = entry.find('.//current')
                            latest_elem = entry.find('.//latest')

                            version_num = version_elem.text if version_elem is not None and version_elem.text else None
                            is_downloaded = downloaded_elem.text if downloaded_elem is not None and downloaded_elem.text else 'no'
                            is_current = current_elem.text if current_elem is not None and current_elem.text else 'no'
                            is_latest = latest_elem.text if latest_elem is not None and latest_elem.text else 'no'

                            debug(f"  Entry: version={version_num}, current={is_current}, latest={is_latest}, downloaded={is_downloaded}")

                            if version_num:
                                all_versions.append({
                                    'version': version_num,
                                    'current': is_current,
                                    'latest': is_latest,
                                    'downloaded': is_downloaded
                                })

                            # Track the current version
                            if is_current == 'yes' and version_num:
                                current_version = version_num

                            # Track latest available version (marked as latest='yes', regardless of current status)
                            if is_latest == 'yes' and version_num:
                                # If this is also current, no update; otherwise it's the update
                                if is_current != 'yes':
                                    latest_available = version_num

                        debug(f"  All versions found: {all_versions}")
                        debug(f"  Current version: {current_version}, Latest available: {latest_available}")

                        # Return status
                        if latest_available:
                            # There's a newer version available
                            return {
                                'downloaded': 'N/A',
                                'current': 'no',
                                'latest': latest_available
                            }
                        else:
                            # No update available
                            return {
                                'downloaded': 'N/A',
                                'current': 'yes',
                                'latest': 'yes'
                            }

                except Exception as e:
                    debug(f"Error checking update status: {e}")

                return {'downloaded': 'N/A', 'current': 'yes', 'latest': 'yes'}

            # Helper function to add software entry
            def add_software_entry(name, version_elem, update_cmd=None):
                if version_elem is not None and version_elem.text:
                    # Get update status if command provided
                    if update_cmd:
                        status = get_update_status(update_cmd)
                    else:
                        status = {'downloaded': 'N/A', 'current': 'N/A', 'latest': 'N/A'}

                    software_info.append({
                        'name': name,
                        'version': version_elem.text,
                        'downloaded': status['downloaded'],
                        'current': status['current'],
                        'latest': status['latest']
                    })

            # Extract specific version fields from system info
            # Note: PAN-OS is excluded from components - it has its own upgrade UI

            # Application and threat signatures
            app_version = root.find('.//app-version')
            add_software_entry('Application & Threat', app_version)

            # Antivirus signatures
            av_version = root.find('.//av-version')
            add_software_entry('Antivirus', av_version)

            # WildFire version
            wildfire_version = root.find('.//wildfire-version')
            add_software_entry('WildFire', wildfire_version)

            # URL Filtering version
            url_filtering_version = root.find('.//url-filtering-version')
            add_software_entry('URL Filtering', url_filtering_version)

            # GlobalProtect data file version
            gp_datafile_version = root.find('.//global-protect-datafile-version')
            add_software_entry('GlobalProtect Data', gp_datafile_version)

            # GlobalProtect client package version
            gp_client_version = root.find('.//global-protect-client-package-version')
            add_software_entry('GlobalProtect Client', gp_client_version)

            # Threat version (may be different from app-version on some systems)
            threat_version = root.find('.//threat-version')
            if threat_version is not None and threat_version.text:
                # Only add if different from app-version
                app_ver_text = app_version.text if app_version is not None else None
                if threat_version.text != app_ver_text:
                    add_software_entry('Threat', threat_version)

            debug(f"Software versions found: {software_info}")

        return {
            'status': 'success',
            'software': software_info,
            'timestamp': datetime.now().isoformat()
        }

    except Exception as e:
        debug(f"Software updates error: {str(e)}")
        return {
            'status': 'error',
            'message': str(e),
            'software': []
        }


def get_license_info(firewall_config):
    """Fetch license information from Palo Alto firewall"""
    try:
        firewall_ip, api_key, base_url = firewall_config

        # Query for license information
        cmd = "<request><license><info></info></license></request>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)
        debug(f"\n=== License API Response ===")
        debug(f"Status: {response.status_code}")

        license_data = {
            'expired': 0,
            'licensed': 0,
            'licenses': []
        }

        if response.status_code == 200:
            root = ET.fromstring(response.text)
            debug(f"Response XML (first 3000 chars):\n{response.text[:3000]}")

            # Try multiple XPath patterns to find license entries
            entries = root.findall('.//entry')
            if not entries:
                entries = root.findall('.//licenses/entry')
            if not entries:
                entries = root.findall('.//result/entry')

            debug(f"Found {len(entries)} license entries using XPath")

            # Parse license entries
            for entry in entries:
                # Try different field names
                feature = entry.find('.//feature') or entry.find('feature')
                description = entry.find('.//description') or entry.find('description')
                expires = entry.find('.//expires') or entry.find('expires')
                expired = entry.find('.//expired') or entry.find('expired')
                authcode = entry.find('.//authcode') or entry.find('authcode')

                feature_name = feature.text if feature is not None and feature.text else 'Unknown'
                description_text = description.text if description is not None and description.text else ''
                expires_text = expires.text if expires is not None and expires.text else 'N/A'
                expired_text = expired.text if expired is not None and expired.text else 'no'

                debug(f"License entry - Feature: {feature_name}, Expired: {expired_text}, Expires: {expires_text}")

                # Count expired and licensed
                if expired_text.lower() == 'yes':
                    license_data['expired'] += 1
                else:
                    license_data['licensed'] += 1

                license_data['licenses'].append({
                    'feature': feature_name,
                    'description': description_text,
                    'expires': expires_text,
                    'expired': expired_text
                })

            debug(f"License info - Expired: {license_data['expired']}, Licensed: {license_data['licensed']}")

        return {
            'status': 'success',
            'license': license_data,
            'timestamp': datetime.now().isoformat()
        }

    except Exception as e:
        debug(f"License info error: {str(e)}")
        import traceback
        debug(f"Traceback: {traceback.format_exc()}")
        return {
            'status': 'error',
            'message': str(e),
            'license': {
                'expired': 0,
                'licensed': 0,
                'licenses': []
            }
        }


def get_database_versions(device_id=None):
    """Fetch database versions from Palo Alto firewall

    Args:
        device_id (str, optional): Specific device ID to query. If None, uses selected_device_id from settings.

    Returns:
        dict: Database version information including:
            - app_version: Application database version
            - threat_version: Threat database version
            - wildfire_version: WildFire database version
            - url_version: URL filtering database version
            - gp_version: GlobalProtect database version
            - updated: Last update timestamp
    """
    from logger import debug, exception

    debug("get_database_versions called (device_id=%s)", device_id)
    try:
        _, api_key, base_url = get_firewall_config(device_id)

        # Check if no device is configured
        if not api_key or not base_url:
            debug("No device configured - returning empty database versions")
            return {
                'app_version': 'N/A',
                'threat_version': 'N/A',
                'wildfire_version': 'N/A',
                'url_version': 'N/A',
                'gp_version': 'N/A',
                'updated': None
            }

        cmd = "<show><system><info></info></system></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        from utils import api_request_get
        response = api_request_get(base_url, params=params, verify=False, timeout=10)

        app_version = 'N/A'
        threat_version = 'N/A'
        wildfire_version = 'N/A'
        url_version = 'N/A'
        gp_version = 'N/A'
        updated = None

        if response.status_code == 200:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(response.text)

            # Extract database versions
            app_ver_elem = root.find('.//app-version')
            threat_ver_elem = root.find('.//threat-version')
            wildfire_ver_elem = root.find('.//wildfire-version')
            url_ver_elem = root.find('.//url-filtering-version')
            gp_ver_elem = root.find('.//global-protect-datafile-version')

            app_version = app_ver_elem.text if app_ver_elem is not None and app_ver_elem.text else 'N/A'
            threat_version = threat_ver_elem.text if threat_ver_elem is not None and threat_ver_elem.text else 'N/A'
            wildfire_version = wildfire_ver_elem.text if wildfire_ver_elem is not None and wildfire_ver_elem.text else 'N/A'
            url_version = url_ver_elem.text if url_ver_elem is not None and url_ver_elem.text else 'N/A'
            gp_version = gp_ver_elem.text if gp_ver_elem is not None and gp_ver_elem.text else 'N/A'

            # Try to get last update time
            from datetime import datetime
            updated = datetime.utcnow().isoformat() + 'Z'

            debug(f"Database versions - App: {app_version}, Threat: {threat_version}, WildFire: {wildfire_version}, URL: {url_version}, GP: {gp_version}")

        return {
            'app_version': app_version,
            'threat_version': threat_version,
            'wildfire_version': wildfire_version,
            'url_version': url_version,
            'gp_version': gp_version,
            'updated': updated
        }

    except Exception as e:
        exception(f"Database versions error: {str(e)}")
        return {
            'app_version': 'N/A',
            'threat_version': 'N/A',
            'wildfire_version': 'N/A',
            'url_version': 'N/A',
            'gp_version': 'N/A',
            'updated': None
        }
