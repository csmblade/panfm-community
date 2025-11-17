"""
Nmap integration for network scanning and device fingerprinting.

This module provides nmap scanning capabilities for connected devices within
RFC 1918 private IP address ranges. Includes security validation, command
execution, and XML parsing of scan results.

Version: 1.10.14 (Network Scanning)
Author: PANfm
"""

import subprocess
import ipaddress
import xml.etree.ElementTree as ET
from logger import debug, info, warning, error, exception
from typing import Dict, List, Optional, Tuple


def is_private_ip(ip_str: str) -> bool:
    """
    Validate if IP address is in RFC 1918 private address space.

    RFC 1918 Private Address Ranges:
    - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
    - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)

    Args:
        ip_str: IP address as string

    Returns:
        True if IP is private (RFC 1918), False otherwise
    """
    debug("Validating RFC 1918 private IP: %s", ip_str)

    try:
        ip_obj = ipaddress.ip_address(ip_str)
        is_private = ip_obj.is_private

        debug("IP %s is_private: %s", ip_str, is_private)
        return is_private

    except ValueError as e:
        warning("Invalid IP address format: %s - %s", ip_str, str(e))
        return False


def check_nmap_available() -> Tuple[bool, str]:
    """
    Check if nmap is installed and available.

    Returns:
        Tuple of (is_available: bool, version_string: str)
    """
    debug("Checking nmap availability")

    try:
        result = subprocess.run(
            ['nmap', '--version'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0] if result.stdout else 'Unknown version'
            info("Nmap is available: %s", version_line)
            return True, version_line
        else:
            warning("Nmap command failed with return code: %d", result.returncode)
            return False, "Nmap not available"

    except FileNotFoundError:
        error("Nmap executable not found in PATH")
        return False, "Nmap not installed"
    except subprocess.TimeoutExpired:
        error("Nmap version check timed out")
        return False, "Nmap check timeout"
    except Exception as e:
        exception("Error checking nmap availability: %s", str(e))
        return False, f"Error: {str(e)}"


def run_nmap_scan(ip_address: str, scan_type: str = 'balanced') -> Dict:
    """
    Execute nmap scan against target IP address.

    Scan Types:
    - 'quick': Fast scan (-T4, -F) - 60 second timeout
    - 'balanced': Balanced scan (-Pn -sV -O --version-intensity 5 -T4) [DEFAULT] - 120 second timeout
    - 'thorough': Comprehensive scan (-Pn -sV -sC -O --version-all -T3) - 180 second timeout

    Security:
    - Only scans RFC 1918 private IPs
    - Uses subprocess.run() with list args (no shell injection)
    - Dynamic timeout based on scan type (60-180 seconds)
    - Output parsed as XML only

    Args:
        ip_address: Target IP address (must be RFC 1918 private)
        scan_type: Type of scan ('quick', 'balanced', 'thorough')

    Returns:
        Dict with keys:
        - success: bool
        - message: str
        - data: Dict (scan results) or None
        - raw_xml: str (raw nmap XML output) or None
    """
    debug("Starting nmap scan for IP: %s, scan_type: %s", ip_address, scan_type)

    # Security: Validate RFC 1918 private IP
    if not is_private_ip(ip_address):
        error("Security: Attempted scan of non-private IP: %s", ip_address)
        return {
            'success': False,
            'message': f'Security: Only RFC 1918 private IPs can be scanned (10.x, 172.16-31.x, 192.168.x)',
            'data': None,
            'raw_xml': None
        }

    # Check nmap availability
    available, version = check_nmap_available()
    if not available:
        error("Nmap not available: %s", version)
        return {
            'success': False,
            'message': f'Nmap not available: {version}',
            'data': None,
            'raw_xml': None
        }

    # Build nmap command based on scan type
    if scan_type == 'quick':
        cmd = ['nmap', '-Pn', '-T4', '-F', '-oX', '-', ip_address]
        timeout_seconds = 60
        debug("Using quick scan profile (timeout: 60s)")
    elif scan_type == 'thorough':
        cmd = ['nmap', '-Pn', '-sV', '-sC', '-O', '--version-all', '-T3', '-oX', '-', ip_address]
        timeout_seconds = 180
        debug("Using thorough scan profile (timeout: 180s)")
    else:  # balanced (default)
        # Balanced scan: service detection + OS fingerprinting
        # Note: -O flag may fail without root/CAP_NET_RAW but scan will continue
        cmd = ['nmap', '-Pn', '-sV', '-O', '--version-intensity', '5', '-T4', '-oX', '-', ip_address]
        timeout_seconds = 120
        debug("Using balanced scan profile (default, timeout: 120s)")

    info("Executing nmap command: %s", ' '.join(cmd))

    try:
        # Execute nmap with dynamic timeout based on scan type
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds
        )

        if result.returncode != 0:
            error("Nmap scan failed with return code: %d", result.returncode)
            error("Nmap stderr: %s", result.stderr[:500])
            return {
                'success': False,
                'message': f'Nmap scan failed (exit code {result.returncode})',
                'data': None,
                'raw_xml': None
            }

        xml_output = result.stdout
        debug("Nmap scan completed, XML output length: %d bytes", len(xml_output))

        # Parse XML results
        parsed_data = parse_nmap_xml(xml_output)

        if parsed_data:
            info("Nmap scan successful for %s, found %d open ports",
                 ip_address, len(parsed_data.get('ports', [])))
            return {
                'success': True,
                'message': 'Scan completed successfully',
                'data': parsed_data,
                'raw_xml': xml_output
            }
        else:
            warning("Nmap scan completed but XML parsing failed")
            return {
                'success': False,
                'message': 'Scan completed but XML parsing failed',
                'data': None,
                'raw_xml': xml_output
            }

    except subprocess.TimeoutExpired:
        error("Nmap scan timed out after %d seconds for IP: %s", timeout_seconds, ip_address)
        return {
            'success': False,
            'message': f'Scan timed out after {timeout_seconds} seconds',
            'data': None,
            'raw_xml': None
        }
    except Exception as e:
        exception("Error executing nmap scan: %s", str(e))
        return {
            'success': False,
            'message': f'Error executing scan: {str(e)}',
            'data': None,
            'raw_xml': None
        }


def parse_nmap_xml(xml_output: str) -> Optional[Dict]:
    """
    Parse nmap XML output into structured dictionary.

    Extracts:
    - Host information (IP, hostname, status)
    - OS detection results (name, accuracy)
    - Open ports (port number, protocol, state, service, version)
    - Scan statistics (duration, start time)

    Args:
        xml_output: Raw XML output from nmap

    Returns:
        Dict with parsed scan results, or None if parsing fails
    """
    debug("Parsing nmap XML output (%d bytes)", len(xml_output))

    try:
        root = ET.fromstring(xml_output)

        # Initialize result structure
        result = {
            'ip': None,
            'hostname': None,
            'status': None,
            'os_matches': [],
            'ports': [],
            'scan_duration': None,
            'scan_start': None
        }

        # Extract scan statistics
        nmaprun = root
        if nmaprun.tag == 'nmaprun':
            result['scan_start'] = nmaprun.get('start')
            runstats = nmaprun.find('runstats')
            if runstats is not None:
                finished = runstats.find('finished')
                if finished is not None:
                    result['scan_duration'] = finished.get('elapsed')

        # Find host element
        host = root.find('host')
        if host is None:
            warning("No host element found in nmap XML")
            return None

        # Extract IP address
        address = host.find('address')
        if address is not None:
            result['ip'] = address.get('addr')
            debug("Found IP: %s", result['ip'])

        # Extract hostname
        hostnames = host.find('hostnames')
        if hostnames is not None:
            hostname = hostnames.find('hostname')
            if hostname is not None:
                result['hostname'] = hostname.get('name')
                debug("Found hostname: %s", result['hostname'])

        # Extract host status
        status = host.find('status')
        if status is not None:
            result['status'] = status.get('state')
            debug("Host status: %s", result['status'])

        # Extract OS detection
        os_elem = host.find('os')
        if os_elem is not None:
            for osmatch in os_elem.findall('osmatch'):
                os_name = osmatch.get('name')
                os_accuracy = osmatch.get('accuracy')
                result['os_matches'].append({
                    'name': os_name,
                    'accuracy': os_accuracy
                })
                debug("Found OS match: %s (accuracy: %s)", os_name, os_accuracy)

        # Extract open ports
        ports = host.find('ports')
        if ports is not None:
            for port in ports.findall('port'):
                port_id = port.get('portid')
                protocol = port.get('protocol')

                state = port.find('state')
                state_value = state.get('state') if state is not None else 'unknown'

                service = port.find('service')
                service_name = service.get('name') if service is not None else 'unknown'
                service_product = service.get('product') if service is not None else None
                service_version = service.get('version') if service is not None else None

                port_info = {
                    'port': port_id,
                    'protocol': protocol,
                    'state': state_value,
                    'service': service_name,
                    'product': service_product,
                    'version': service_version
                }

                result['ports'].append(port_info)
                debug("Found port: %s/%s - %s (%s)", port_id, protocol, service_name, state_value)

        info("Successfully parsed nmap XML: %d ports, %d OS matches",
             len(result['ports']), len(result['os_matches']))

        return result

    except ET.ParseError as e:
        exception("XML parsing error: %s", str(e))
        return None
    except Exception as e:
        exception("Error parsing nmap XML: %s", str(e))
        return None


def get_scan_summary(scan_data: Dict) -> str:
    """
    Generate human-readable summary of scan results.

    Args:
        scan_data: Parsed scan data from parse_nmap_xml()

    Returns:
        Multi-line summary string
    """
    if not scan_data:
        return "No scan data available"

    summary_lines = []

    # Host information
    summary_lines.append(f"Host: {scan_data.get('ip', 'Unknown')}")
    if scan_data.get('hostname'):
        summary_lines.append(f"Hostname: {scan_data.get('hostname')}")
    summary_lines.append(f"Status: {scan_data.get('status', 'Unknown')}")

    # OS detection
    os_matches = scan_data.get('os_matches', [])
    if os_matches:
        best_match = os_matches[0]
        summary_lines.append(f"OS: {best_match.get('name')} ({best_match.get('accuracy')}% confidence)")

    # Open ports
    open_ports = [p for p in scan_data.get('ports', []) if p.get('state') == 'open']
    summary_lines.append(f"Open Ports: {len(open_ports)}")

    for port in open_ports[:5]:  # Show first 5 ports
        port_str = f"  {port.get('port')}/{port.get('protocol')} - {port.get('service')}"
        if port.get('product'):
            port_str += f" ({port.get('product')}"
            if port.get('version'):
                port_str += f" {port.get('version')}"
            port_str += ")"
        summary_lines.append(port_str)

    if len(open_ports) > 5:
        summary_lines.append(f"  ... and {len(open_ports) - 5} more ports")

    # Scan duration
    if scan_data.get('scan_duration'):
        summary_lines.append(f"Scan Duration: {scan_data.get('scan_duration')} seconds")

    return '\n'.join(summary_lines)
