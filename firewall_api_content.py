"""
Content Update Functions (App & Threat, Antivirus, WildFire, URL Filtering, GlobalProtect)
Handles checking, downloading, and installing content updates for all component types

Per user requirements:
- Download and install as combined workflow
- Support individual component updates
- No reboot required

Separate module per .clinerules file size guidelines
"""

import xml.etree.ElementTree as ET
from logger import debug, error, exception, warning
from utils import api_request_post

# Supported content types with their PAN-OS API type identifiers
# Note: Only content, anti-virus, and wildfire support the <upgrade><check> API
# URL Filtering uses PAN-DB cloud updates, GlobalProtect Data uses different mechanism
CONTENT_TYPES = {
    'content': {
        'name': 'Application & Threat',
        'api_type': 'content',
        'description': 'Application identification and threat signatures',
        'supports_check': True
    },
    'anti-virus': {
        'name': 'Antivirus',
        'api_type': 'anti-virus',
        'description': 'Antivirus signature database',
        'supports_check': True
    },
    'wildfire': {
        'name': 'WildFire',
        'api_type': 'wildfire',
        'description': 'WildFire cloud-based malware analysis signatures',
        'supports_check': True
    },
}


def get_content_types():
    """Return list of supported content types with their metadata"""
    return CONTENT_TYPES.copy()


def check_content_updates(firewall_ip, api_key, content_type='content'):
    """
    Check for available content updates for a specific content type

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication
        content_type: Content type key (default: 'content' for App & Threat)
                     Valid types: content, anti-virus, wildfire, url-filtering, global-protect-datafile

    Returns:
        dict: {
            'status': 'success' or 'error',
            'content_type': str (type key),
            'name': str (display name),
            'current_version': str (current content version),
            'latest_version': str (latest available version),
            'needs_update': bool,
            'downloaded': str ('yes'/'no'),
            'message': str
        }
    """
    # Validate content type
    if content_type not in CONTENT_TYPES:
        error(f"Invalid content type: {content_type}")
        return {'status': 'error', 'content_type': content_type, 'name': content_type, 'message': f'Invalid content type: {content_type}'}

    type_info = CONTENT_TYPES[content_type]
    api_type = type_info['api_type']
    type_name = type_info['name']

    debug(f"Checking {type_name} updates for firewall: {firewall_ip}")

    try:
        cmd = f'<request><{api_type}><upgrade><check></check></upgrade></{api_type}></request>'
        debug(f"Sending {type_name} check command: {cmd}")

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')

        if not response:
            error(f"No response from firewall {firewall_ip}")
            return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': 'No response from firewall'}

        debug(f"Content check response (first 500 chars): {response[:500]}")

        root = ET.fromstring(response)
        status = root.get('status')

        if status != 'success':
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"Content check failed: {error_msg}")
            return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': error_msg}

        # Parse content version info
        current_version = None
        latest_version = None
        latest_downloaded = 'no'
        all_versions = []

        # Find content entries and collect all versions
        for entry in root.findall('.//entry'):
            version = entry.findtext('version', '')
            is_current = entry.findtext('current', 'no')
            is_latest = entry.findtext('latest', 'no')
            is_downloaded = entry.findtext('downloaded', 'no')

            version_data = {
                'version': version,
                'current': is_current,
                'latest': is_latest,
                'downloaded': is_downloaded
            }
            all_versions.append(version_data)

            if is_current == 'yes':
                current_version = version
                debug(f"Found current content version: {current_version}")
            if is_latest == 'yes':
                latest_version = version
                latest_downloaded = is_downloaded
                debug(f"Found latest content version (marked): {latest_version}, downloaded: {latest_downloaded}")

        # If no version is explicitly marked as latest, find the newest version
        # by comparing all available versions (highest version number)
        if not latest_version and all_versions:
            # Sort versions to find the newest
            sorted_versions = sorted(all_versions, key=lambda x: x['version'], reverse=True)
            latest_version = sorted_versions[0]['version']
            latest_downloaded = sorted_versions[0]['downloaded']
            debug(f"No explicit latest version found, using newest: {latest_version}")

        needs_update = (current_version != latest_version) if (current_version and latest_version) else False

        debug(f"{type_name} update status: current={current_version}, latest={latest_version}, needs_update={needs_update}, all_versions={len(all_versions)}")

        return {
            'status': 'success',
            'content_type': content_type,
            'name': type_name,
            'current_version': current_version or 'Unknown',
            'latest_version': latest_version or 'Unknown',
            'needs_update': needs_update,
            'downloaded': latest_downloaded,
            'message': 'Update available' if needs_update else 'Up to date'
        }

    except ET.ParseError as e:
        exception(f"Failed to parse {type_name} updates response: {e}")
        return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': f'Parse error: {str(e)}'}
    except Exception as e:
        exception(f"Error checking {type_name} updates: {e}")
        return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': str(e)}


def download_content_update(firewall_ip, api_key, content_type='content'):
    """
    Download latest content update for a specific content type

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication
        content_type: Content type key (default: 'content' for App & Threat)

    Returns:
        dict: {
            'status': 'success' or 'error',
            'content_type': str (type key),
            'name': str (display name),
            'jobid': str (job ID for polling),
            'message': str
        }
    """
    # Validate content type
    if content_type not in CONTENT_TYPES:
        error(f"Invalid content type: {content_type}")
        return {'status': 'error', 'message': f'Invalid content type: {content_type}'}

    type_info = CONTENT_TYPES[content_type]
    api_type = type_info['api_type']
    type_name = type_info['name']

    debug(f"Downloading latest {type_name} update for: {firewall_ip}")

    try:
        cmd = f'<request><{api_type}><upgrade><download><latest/></download></upgrade></{api_type}></request>'
        debug(f"Sending {type_name} download command: {cmd}")

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')

        if not response:
            error(f"No response from firewall for {type_name} download")
            return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': 'No response from firewall'}

        debug(f"{type_name} download response (first 500 chars): {response[:500]}")

        root = ET.fromstring(response)
        status = root.get('status')

        if status == 'success':
            job_elem = root.find('.//job')
            if job_elem is not None:
                jobid = job_elem.text
                debug(f"{type_name} download job started with jobid: {jobid}")
                return {
                    'status': 'success',
                    'content_type': content_type,
                    'name': type_name,
                    'jobid': jobid,
                    'message': f'{type_name} download started'
                }
            else:
                error(f"No job ID found in {type_name} success response")
                return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': 'No job ID in response'}
        else:
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"{type_name} download failed: {error_msg}")
            return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': error_msg}

    except ET.ParseError as e:
        exception(f"Failed to parse {type_name} download response: {e}")
        return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': f'Parse error: {str(e)}'}
    except Exception as e:
        exception(f"Error downloading {type_name}: {e}")
        return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': str(e)}


def install_content_update(firewall_ip, api_key, content_type='content', version='latest'):
    """
    Install downloaded content update for any content type

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication
        content_type: Content type key (default: 'content' for App & Threat)
                     Valid types: content, anti-virus, wildfire, url-filtering, global-protect-datafile
        version: Version to install (default: 'latest')

    Returns:
        dict: {
            'status': 'success' or 'error',
            'content_type': str (type key),
            'name': str (display name),
            'jobid': str (job ID for polling),
            'message': str
        }
    """
    # Validate content type
    if content_type not in CONTENT_TYPES:
        error(f"Invalid content type for install: {content_type}")
        return {'status': 'error', 'message': f'Invalid content type: {content_type}'}

    type_info = CONTENT_TYPES[content_type]
    api_type = type_info['api_type']
    type_name = type_info['name']

    debug(f"Installing {type_name} update version: {version} for: {firewall_ip}")

    try:
        cmd = f'<request><{api_type}><upgrade><install><version>{version}</version></install></upgrade></{api_type}></request>'
        debug(f"Sending {type_name} install command: {cmd}")

        response = api_request_post(firewall_ip, api_key, cmd, cmd_type='op')

        if not response:
            error(f"No response from firewall for {type_name} install")
            return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': 'No response from firewall'}

        debug(f"{type_name} install response (first 500 chars): {response[:500]}")

        root = ET.fromstring(response)
        status = root.get('status')

        if status == 'success':
            job_elem = root.find('.//job')
            if job_elem is not None:
                jobid = job_elem.text
                debug(f"{type_name} install job started with jobid: {jobid}")
                return {
                    'status': 'success',
                    'content_type': content_type,
                    'name': type_name,
                    'jobid': jobid,
                    'message': f'{type_name} install started'
                }
            else:
                error(f"No job ID found in {type_name} success response")
                return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': 'No job ID in response'}
        else:
            error_msg = root.findtext('.//msg', 'Unknown error')
            error(f"{type_name} install failed: {error_msg}")
            return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': error_msg}

    except ET.ParseError as e:
        exception(f"Failed to parse {type_name} install response: {e}")
        return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': f'Parse error: {str(e)}'}
    except Exception as e:
        exception(f"Error installing {type_name}: {e}")
        return {'status': 'error', 'content_type': content_type, 'name': type_name, 'message': str(e)}


def check_all_content_updates(firewall_ip, api_key):
    """
    Check for updates for all supported content types

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication

    Returns:
        dict: {
            'status': 'success' or 'partial' or 'error',
            'results': list of check results for each content type,
            'updates_available': int (count of components with updates),
            'message': str
        }
    """
    debug(f"Checking all content updates for firewall: {firewall_ip}")

    results = []
    errors = []
    updates_available = 0

    for content_type in CONTENT_TYPES.keys():
        try:
            result = check_content_updates(firewall_ip, api_key, content_type)
            results.append(result)

            if result.get('status') == 'success' and result.get('needs_update'):
                updates_available += 1
            elif result.get('status') == 'error':
                errors.append(f"{content_type}: {result.get('message', 'Unknown error')}")

        except Exception as e:
            exception(f"Error checking {content_type}: {e}")
            errors.append(f"{content_type}: {str(e)}")
            results.append({
                'status': 'error',
                'content_type': content_type,
                'name': CONTENT_TYPES[content_type]['name'],
                'message': str(e)
            })

    # Determine overall status
    if len(errors) == len(CONTENT_TYPES):
        status = 'error'
        message = 'All content checks failed'
    elif errors:
        status = 'partial'
        message = f'Some checks failed: {"; ".join(errors)}'
    else:
        status = 'success'
        message = f'{updates_available} update(s) available' if updates_available else 'All content up to date'

    debug(f"All content check complete: {status}, {updates_available} updates available, {len(errors)} errors")

    return {
        'status': status,
        'results': results,
        'updates_available': updates_available,
        'message': message
    }
