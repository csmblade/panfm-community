"""
PAN-OS Software Upgrade Functions
Handles checking, downloading, installing, and rebooting PAN-OS versions

This module is separated from main firewall_api.py to maintain modularity
and keep file sizes manageable per .clinerules guidelines.
"""

import xml.etree.ElementTree as ET
from logger import debug, error, warning, exception
from utils import api_request_post


def check_available_panos_versions(firewall_ip, api_key):
    """
    Check for available PAN-OS software versions

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication

    Returns:
        dict: {
            'status': 'success' or 'error',
            'versions': [list of version dicts],
            'current_version': str,
            'latest_version': str,
            'message': str (error message if applicable)
        }
    """
    debug("Checking available PAN-OS versions")

    try:
        debug(f"Checking PAN-OS versions for firewall: {firewall_ip}")

        # API command to check for software updates
        cmd = '<request><system><software><check></check></software></system></request>'
        debug(f"Sending command: {cmd}")

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')
        debug(f"Received response: {response[:200] if response else 'None'}")

        if not response:
            error(f"No response from firewall {firewall_ip} for software check command after retries")
            return {
                'status': 'error',
                'message': 'Failed to get response from firewall after multiple retry attempts. Check firewall connectivity, API access, and ensure firewall is not overloaded.'
            }

        # Parse XML response
        root = ET.fromstring(response)

        # Check response status
        status = root.get('status')
        if status != 'success':
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"Failed to check PAN-OS versions: {error_msg}")
            return {
                'status': 'error',
                'message': error_msg
            }

        # Extract software version information
        versions = []
        current_version = None
        latest_version = None

        # Find all version entries
        for entry in root.findall('.//entry'):
            version_data = {
                'version': entry.findtext('version', 'Unknown'),
                'filename': entry.findtext('filename', ''),
                'size': entry.findtext('size', '0'),
                'size_kb': entry.findtext('size-kb', '0'),
                'released_on': entry.findtext('released-on', ''),
                'downloaded': entry.findtext('downloaded', 'no'),
                'current': entry.findtext('current', 'no'),
                'latest': entry.findtext('latest', 'no'),
                'uploaded': entry.findtext('uploaded', 'no')
            }

            versions.append(version_data)

            # Track current version
            if version_data['current'] == 'yes':
                current_version = version_data['version']

        # Sort versions by release date (newest first) to properly handle hotfixes
        # Hotfixes like 12.1.3-h1 are released AFTER 12.1.3 but API marks base as "latest"
        def parse_release_date(v):
            """Parse release date string to sortable format (YYYY/MM/DD HH:MM:SS)"""
            try:
                # Format: "2025/09/25 10:35:41"
                return v.get('released_on', '') or '0000/00/00 00:00:00'
            except:
                return '0000/00/00 00:00:00'

        versions.sort(key=parse_release_date, reverse=True)

        # Determine actual latest version based on release date (not API 'latest' flag)
        # The API marks the base version as latest, but hotfixes released later are actually newer
        if versions:
            # Find the newest version in the same major.minor series as current
            if current_version:
                current_major_minor = '.'.join(current_version.split('.')[:2])
                same_series = [v for v in versions if v['version'].startswith(current_major_minor)]
                if same_series:
                    # Latest in current series (sorted by release date, so first is newest)
                    latest_version = same_series[0]['version']
                else:
                    latest_version = versions[0]['version']
            else:
                latest_version = versions[0]['version']

        debug(f"Found {len(versions)} PAN-OS versions. Current: {current_version}, Latest (by date): {latest_version}")

        return {
            'status': 'success',
            'versions': versions,
            'current_version': current_version,
            'latest_version': latest_version
        }

    except ET.ParseError as e:
        exception(f"Failed to parse PAN-OS versions response: {e}")
        return {
            'status': 'error',
            'message': f'XML parsing error: {str(e)}'
        }
    except Exception as e:
        exception(f"Error checking PAN-OS versions: {e}")
        return {
            'status': 'error',
            'message': str(e)
        }


def download_panos_version(firewall_ip, api_key, version):
    """
    Download a specific PAN-OS version

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication
        version: Version string to download (e.g., "11.0.0")

    Returns:
        dict: {
            'status': 'success' or 'error',
            'job_id': str (if success),
            'message': str
        }
    """
    debug(f"Downloading PAN-OS version {version}")

    try:
        # API command to download software version
        cmd = f'<request><system><software><download><version>{version}</version></download></software></system></request>'

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')

        if not response:
            error(f"No response from firewall {firewall_ip} after retries")
            return {
                'status': 'error',
                'message': 'Failed to get response from firewall after multiple retry attempts. The firewall may be busy or temporarily unavailable. Please wait and try again.'
            }

        # Parse XML response
        root = ET.fromstring(response)

        # Check response status
        status = root.get('status')
        if status != 'success':
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"Failed to start download: {error_msg}")
            return {
                'status': 'error',
                'message': error_msg
            }

        # Extract job ID
        job_id = root.findtext('.//job', None)

        if not job_id:
            error("No job ID returned from download request")
            return {
                'status': 'error',
                'message': 'No job ID returned'
            }

        debug(f"Download started successfully. Job ID: {job_id}")

        return {
            'status': 'success',
            'job_id': job_id,
            'message': f'Download started for version {version}'
        }

    except ET.ParseError as e:
        exception(f"Failed to parse download response: {e}")
        return {
            'status': 'error',
            'message': f'XML parsing error: {str(e)}'
        }
    except Exception as e:
        exception(f"Error downloading PAN-OS version: {e}")
        return {
            'status': 'error',
            'message': str(e)
        }


def install_panos_version(firewall_ip, api_key, version):
    """
    Install a downloaded PAN-OS version

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication
        version: Version string to install (e.g., "11.0.0")

    Returns:
        dict: {
            'status': 'success' or 'error',
            'job_id': str (if success),
            'message': str
        }
    """
    debug(f"Installing PAN-OS version {version}")

    try:
        # API command to install software version
        cmd = f'<request><system><software><install><version>{version}</version></install></software></system></request>'

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')

        if not response:
            error(f"No response from firewall {firewall_ip} after retries")
            return {
                'status': 'error',
                'message': 'Failed to get response from firewall after multiple retry attempts. The firewall may be busy or temporarily unavailable. Please wait and try again.'
            }

        # Parse XML response
        root = ET.fromstring(response)

        # Check response status
        status = root.get('status')
        if status != 'success':
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"Failed to start installation: {error_msg}")
            return {
                'status': 'error',
                'message': error_msg
            }

        # Extract job ID
        job_id = root.findtext('.//job', None)

        if not job_id:
            error("No job ID returned from install request")
            return {
                'status': 'error',
                'message': 'No job ID returned'
            }

        debug(f"Installation started successfully. Job ID: {job_id}")

        return {
            'status': 'success',
            'job_id': job_id,
            'message': f'Installation started for version {version}'
        }

    except ET.ParseError as e:
        exception(f"Failed to parse install response: {e}")
        return {
            'status': 'error',
            'message': f'XML parsing error: {str(e)}'
        }
    except Exception as e:
        exception(f"Error installing PAN-OS version: {e}")
        return {
            'status': 'error',
            'message': str(e)
        }


def check_job_status(firewall_ip, api_key, job_id):
    """
    Check the status of a running job (download or install)

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication
        job_id: Job ID to check

    Returns:
        dict: {
            'status': 'success' or 'error',
            'job_status': 'FIN', 'PEND', 'ACT', etc.,
            'progress': int (0-100),
            'result': str ('OK', 'FAIL', etc.),
            'details': str,
            'message': str
        }
    """
    debug(f"Checking status of job {job_id}")

    try:
        # API command to check job status
        cmd = f'<show><jobs><id>{job_id}</id></jobs></show>'

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')

        if not response:
            error(f"No response from firewall {firewall_ip} after retries")
            return {
                'status': 'error',
                'message': 'Failed to get response from firewall after multiple retry attempts. The firewall may be busy or temporarily unavailable. Please wait and try again.'
            }

        # Parse XML response
        root = ET.fromstring(response)

        # Check response status
        status = root.get('status')
        if status != 'success':
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"Failed to check job status: {error_msg}")
            return {
                'status': 'error',
                'message': error_msg
            }

        # Extract job information
        job = root.find('.//job')
        if job is None:
            return {
                'status': 'error',
                'message': 'Job not found'
            }

        job_status = job.findtext('status', 'UNKNOWN')
        progress_text = job.findtext('progress', '0')
        result = job.findtext('result', '')  # Empty string if not present
        details = job.findtext('details/line', '')

        # Parse progress (might be "5" or "5%" or "Completed")
        try:
            progress = int(progress_text.strip('%'))
        except:
            progress = 100 if job_status == 'FIN' else 0

        # Log detailed job information for debugging
        debug(f"Job {job_id} - status: {job_status}, progress: {progress}%, result: '{result}', details: '{details}'")

        # If result is empty but job is finished, check details for success/failure indicators
        if not result and job_status == 'FIN':
            if details and ('success' in details.lower() or 'complete' in details.lower()):
                result = 'OK'
            elif details and ('fail' in details.lower() or 'error' in details.lower()):
                result = 'FAIL'
            else:
                # Job finished without explicit result - treat as success
                result = 'OK'

        return {
            'status': 'success',
            'job_status': job_status,
            'progress': progress,
            'result': result,
            'details': details,
            'message': f'Job status: {job_status}'
        }

    except ET.ParseError as e:
        exception(f"Failed to parse job status response: {e}")
        return {
            'status': 'error',
            'message': f'XML parsing error: {str(e)}'
        }
    except Exception as e:
        exception(f"Error checking job status: {e}")
        return {
            'status': 'error',
            'message': str(e)
        }


def reboot_firewall(firewall_ip, api_key):
    """
    Reboot the firewall

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication

    Returns:
        dict: {
            'status': 'success' or 'error',
            'message': str
        }
    """
    warning(f"Initiating firewall reboot for {firewall_ip}")

    try:
        # API command to reboot the system
        cmd = '<request><restart><system></system></restart></request>'

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')

        if not response:
            error(f"No response from firewall {firewall_ip} after retries")
            return {
                'status': 'error',
                'message': 'Failed to get response from firewall after multiple retry attempts. The firewall may be busy or temporarily unavailable. Please wait and try again.'
            }

        # Parse XML response
        root = ET.fromstring(response)

        # Check response status
        status = root.get('status')
        if status != 'success':
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"Failed to reboot firewall: {error_msg}")
            return {
                'status': 'error',
                'message': error_msg
            }

        warning("Firewall reboot initiated successfully")

        return {
            'status': 'success',
            'message': 'Firewall reboot initiated. The firewall will be unavailable for several minutes.'
        }

    except ET.ParseError as e:
        exception(f"Failed to parse reboot response: {e}")
        return {
            'status': 'error',
            'message': f'XML parsing error: {str(e)}'
        }
    except Exception as e:
        exception(f"Error rebooting firewall: {e}")
        return {
            'status': 'error',
            'message': str(e)
        }
