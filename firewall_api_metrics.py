"""
Firewall API system resource metrics for Palo Alto firewalls
Handles CPU, memory, sessions, and interface statistics
"""
import xml.etree.ElementTree as ET
from utils import api_request_get
from logger import debug, exception


def get_firewall_config(device_id=None):
    """Import get_firewall_config from firewall_api to avoid circular import"""
    from firewall_api import get_firewall_config as _get_firewall_config
    return _get_firewall_config(device_id)


def get_system_resources(device_id=None):
    """Fetch system resource usage (CPU, memory, uptime) from Palo Alto firewall

    Args:
        device_id (str, optional): Specific device ID to query. If None, uses selected_device_id from settings.

    Returns:
        dict: Resource metrics including:
            - data_plane_cpu: Data plane CPU percentage
            - mgmt_plane_cpu: Management plane CPU percentage
            - uptime: System uptime string
            - memory_used_pct: Memory usage percentage
            - memory_used_mb: Memory used in MB
            - memory_total_mb: Total memory in MB
    """
    debug("get_system_resources called (device_id=%s)", device_id)
    try:
        _, api_key, base_url = get_firewall_config(device_id)

        # Check if no device is configured
        if not api_key or not base_url:
            debug("No device configured - returning 0 CPU values")
            return {'data_plane_cpu': 0, 'mgmt_plane_cpu': 0, 'uptime': None, 'memory_used_pct': 0, 'memory_used_mb': 0, 'memory_total_mb': 0}

        # Query for dataplane CPU load (with hour parameter for more reliable data)
        cmd = "<show><running><resource-monitor><hour><last>1</last></hour></resource-monitor></running></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)

        debug(f"\n=== CPU API Response ===")
        debug(f"Status: {response.status_code}")
        if response.status_code == 200:
            debug(f"Response XML (first 1000 chars):\n{response.text[:1000]}")

            # Export the full XML response for analysis
            try:
                with open('resource_monitor_output.xml', 'w') as f:
                    f.write(response.text)
                debug("Exported resource monitor XML to resource_monitor_output.xml")
            except Exception as e:
                debug(f"Error exporting resource monitor XML: {e}")

        data_plane_cpu = 0
        mgmt_plane_cpu = 0

        if response.status_code == 200:
            root = ET.fromstring(response.text)

            # Try to find data-plane CPU from resource monitor - look for minute average across all data processors
            # This will average across all dp0, dp1, dp2, etc. and all their cores
            all_cpu_values = []

            # Find all data processor entries (dp0, dp1, etc.)
            dp_processors = root.findall('.//data-processors/*')
            debug(f"Found {len(dp_processors)} data processors in resource monitor XML")

            for dp in dp_processors:
                # Try minute entries first, then hour entries as fallback
                dp_entries = dp.findall('.//minute/cpu-load-average/entry')
                if not dp_entries:
                    dp_entries = dp.findall('.//hour/cpu-load-average/entry')
                    debug(f"Data processor '{dp.tag}' has {len(dp_entries)} hour entries (minute not available)")
                else:
                    debug(f"Data processor '{dp.tag}' has {len(dp_entries)} minute entries")

                for entry in dp_entries:
                    value_elem = entry.find('value')
                    if value_elem is not None and value_elem.text:
                        # Value can be either a single number or comma-separated list
                        try:
                            # Try as comma-separated values first
                            if ',' in value_elem.text:
                                values = [int(v) for v in value_elem.text.strip().split(',') if v.strip()]
                                all_cpu_values.extend(values)
                            else:
                                # Single value per core
                                all_cpu_values.append(int(value_elem.text))
                        except:
                            pass

            if all_cpu_values:
                data_plane_cpu = int(sum(all_cpu_values) / len(all_cpu_values))
                debug(f"Found data-plane CPU (hour/min avg across {len(all_cpu_values)} cores): {data_plane_cpu}%")
            else:
                debug("WARNING: No data-plane CPU values found in minute or hour averages")

            # If minute average not found, try second average
            if data_plane_cpu == 0:
                dp_entries = root.findall('.//data-processors/dp0/second/cpu-load-average/entry')
                debug(f"Trying second averages: found {len(dp_entries)} entries")
                if dp_entries:
                    total_cpu = 0
                    count = 0
                    for entry in dp_entries:
                        value_elem = entry.find('value')
                        if value_elem is not None and value_elem.text:
                            try:
                                values = [int(v) for v in value_elem.text.strip().split(',') if v.strip()]
                                if values:
                                    avg = sum(values) / len(values)
                                    total_cpu += avg
                                    count += 1
                            except:
                                pass
                    if count > 0:
                        data_plane_cpu = int(total_cpu / count)
                        debug(f"Found data-plane CPU (second avg from {count} entries): {data_plane_cpu}%")
                    else:
                        debug("WARNING: No valid second average CPU values found")
                else:
                    debug("WARNING: No second average entries found in dp0")

        # Try the system resources command for management CPU and memory
        cmd2 = "<show><system><resources></resources></system></show>"
        params2 = {
            'type': 'op',
            'cmd': cmd2,
            'key': api_key
        }
        response2 = api_request_get(base_url, params=params2, verify=False, timeout=10)
        debug(f"Trying system resources command, status: {response2.status_code}")

        memory_used_pct = 0
        memory_total_mb = 0
        memory_used_mb = 0

        if response2.status_code == 200:
                # Export the XML response to a file for inspection
                try:
                    with open('system_resources_output.xml', 'w') as f:
                        f.write(response2.text)
                    debug("Exported system resources XML to system_resources_output.xml")
                except Exception as e:
                    debug(f"Error exporting XML: {e}")

                root2 = ET.fromstring(response2.text)

                # Try to get data plane CPU from XML field - try multiple possible field names
                dp_cpu_elem = (
                    root2.find('.//dp-cpu-utilization') or
                    root2.find('.//data-plane-cpu-utilization-pct') or
                    root2.find('.//data-plane-cpu-utilization') or
                    root2.find('.//dataplane-cpu-utilization-pct') or
                    root2.find('.//dp-cpu-utilization-pct')
                )

                # Use data plane CPU from XML if not already found from resource monitor
                if dp_cpu_elem is not None and dp_cpu_elem.text and data_plane_cpu == 0:
                    data_plane_cpu = int(dp_cpu_elem.text)
                    debug(f"Data Plane CPU from XML field '{dp_cpu_elem.tag}': {data_plane_cpu}%")
                elif data_plane_cpu == 0:
                    # Log available CPU-related fields for debugging
                    cpu_fields = [elem.tag for elem in root2.findall('.//*') if 'cpu' in elem.tag.lower()]
                    debug(f"WARNING: Data Plane CPU not found in any XML field. Available CPU fields: {cpu_fields}")

                result_text = root2.find('.//result')

                if result_text is not None and result_text.text:
                    lines = result_text.text.strip().split('\n')
                    debug(f"System resources output (first 500 chars):\n{result_text.text[:500]}")

                    # Management plane process names to track
                    mgmt_processes = [
                        'sysd',        # System daemon
                        'configd',     # Configuration daemon
                        'mgmtsrvr',    # Management server
                        'devsrvr',     # Device server
                        'useridd',     # User-ID daemon
                        'reportd',     # Reporting daemon
                        'logrcvr',     # Log receiver
                        'contentd',    # Content management
                        'authd',       # Authentication daemon
                        'dnsproxy',    # DNS proxy
                        'rasmgr',      # RAS manager
                        'routed'       # Routing daemon
                    ]

                    mgmt_cpu_total = 0.0
                    mgmt_process_count = 0

                    for line in lines:
                        # Parse process lines to calculate management plane CPU
                        # Format: PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ COMMAND
                        parts = line.split()
                        if len(parts) >= 12:
                            try:
                                # Check if line contains a management process
                                command = parts[-1]  # Last column is COMMAND
                                cpu_pct_str = parts[8]  # Column 9 is %CPU

                                # Check if this is a management process
                                for proc_name in mgmt_processes:
                                    if command.startswith(proc_name):
                                        cpu_pct = float(cpu_pct_str)
                                        mgmt_cpu_total += cpu_pct
                                        mgmt_process_count += 1
                                        debug(f"Found mgmt process: {command} using {cpu_pct}% CPU")
                                        break
                            except (ValueError, IndexError):
                                # Skip lines that don't match expected format
                                pass

                    # Calculate management plane CPU as sum of management processes
                    if mgmt_process_count > 0:
                        mgmt_plane_cpu = int(mgmt_cpu_total)
                        debug(f"Management CPU calculated from {mgmt_process_count} processes: {mgmt_plane_cpu}% (sum of individual process CPUs)")
                    else:
                        # Fallback to aggregate system CPU if no management processes found
                        for line in lines:
                            if '%Cpu(s):' in line or 'Cpu(s):' in line:
                                debug(f"Found CPU line (fallback): {line}")
                                try:
                                    parts = line.split(':')[1].split(',')
                                    user_cpu = 0
                                    sys_cpu = 0

                                    for part in parts:
                                        part = part.strip()
                                        if 'us' in part:
                                            user_cpu = float(part.split()[0])
                                        elif 'sy' in part:
                                            sys_cpu = float(part.split()[0])

                                    mgmt_plane_cpu = int(user_cpu + sys_cpu)
                                    debug(f"Management CPU from fallback (aggregate): {mgmt_plane_cpu}%")
                                except Exception as e:
                                    debug(f"Error parsing CPU line: {e}")

                    # Parse memory information (skip Swap line - only parse MiB Mem line)
                    for line in lines:
                        if 'MiB Mem' in line and 'total' in line:
                            debug(f"Found memory line: {line}")
                            try:
                                parts = line.split(',')
                                for part in parts:
                                    if 'total' in part:
                                        total_str = part.split('total')[0].strip().split()[-1]
                                        memory_total_mb = float(total_str)
                                    if 'used' in part and 'buff/cache' not in part:
                                        used_str = part.split('used')[0].strip().split()[-1]
                                        memory_used_mb = float(used_str)

                                if memory_total_mb > 0:
                                    memory_used_pct = int((memory_used_mb / memory_total_mb) * 100)
                                    debug(f"Memory: {memory_used_mb:.1f}MB / {memory_total_mb:.1f}MB ({memory_used_pct}%)")
                            except Exception as e:
                                debug(f"Error calculating memory: {e}")

        debug(f"Final CPU - Data plane: {data_plane_cpu}%, Mgmt plane: {mgmt_plane_cpu}%")

        # Get system uptime
        uptime = None
        uptime_cmd = "<show><system><info></info></system></show>"
        uptime_params = {
            'type': 'op',
            'cmd': uptime_cmd,
            'key': api_key
        }
        uptime_response = api_request_get(base_url, params=uptime_params, verify=False, timeout=10)
        if uptime_response.status_code == 200:
            uptime_root = ET.fromstring(uptime_response.text)
            uptime_elem = uptime_root.find('.//uptime')
            if uptime_elem is not None and uptime_elem.text:
                uptime = uptime_elem.text

        return {
            'data_plane_cpu': data_plane_cpu,
            'mgmt_plane_cpu': mgmt_plane_cpu,
            'uptime': uptime,
            'memory_used_pct': memory_used_pct,
            'memory_used_mb': int(memory_used_mb),
            'memory_total_mb': int(memory_total_mb)
        }

    except Exception as e:
        exception(f"CPU Error: {str(e)}")
        return {'data_plane_cpu': 0, 'mgmt_plane_cpu': 0, 'uptime': None, 'memory_used_pct': 0, 'memory_used_mb': 0, 'memory_total_mb': 0}


def get_interface_stats(device_id=None):
    """Fetch interface statistics from Palo Alto firewall

    Args:
        device_id (str, optional): Specific device ID to query. If None, uses selected_device_id from settings.

    Returns:
        dict: Interface statistics including:
            - interfaces: List of interfaces with errors/drops
            - total_errors: Sum of all input/output errors
            - total_drops: Sum of all input drops
    """
    debug("get_interface_stats called (device_id=%s)", device_id)
    try:
        _, api_key, base_url = get_firewall_config(device_id)

        # Check if no device is configured
        if not api_key or not base_url:
            debug("No device configured - returning empty interface stats")
            return {'interfaces': [], 'total_errors': 0, 'total_drops': 0}

        # Get interface statistics
        cmd = "<show><counter><interface>all</interface></counter></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)
        debug(f"Interface stats API Status: {response.status_code}")

        interfaces = []
        total_errors = 0
        total_drops = 0

        if response.status_code == 200:
            root = ET.fromstring(response.text)
            debug(f"Interface stats XML (first 2000 chars):\n{response.text[:2000]}")

            # Parse interface entries
            for ifentry in root.findall('.//ifnet/entry'):
                name_elem = ifentry.find('name')
                ierrors_elem = ifentry.find('ierrors')
                oerrors_elem = ifentry.find('oerrors')
                idrops_elem = ifentry.find('idrops')

                if name_elem is not None:
                    interface_name = name_elem.text
                    ierrors = int(ierrors_elem.text) if ierrors_elem is not None and ierrors_elem.text else 0
                    oerrors = int(oerrors_elem.text) if oerrors_elem is not None and oerrors_elem.text else 0
                    idrops = int(idrops_elem.text) if idrops_elem is not None and idrops_elem.text else 0

                    total_errors += ierrors + oerrors
                    total_drops += idrops

                    # Only include interfaces with errors or drops
                    if ierrors > 0 or oerrors > 0 or idrops > 0:
                        interfaces.append({
                            'name': interface_name,
                            'ierrors': ierrors,
                            'oerrors': oerrors,
                            'idrops': idrops,
                            'total_errors': ierrors + oerrors
                        })

            debug(f"Found {len(interfaces)} interfaces with errors/drops")
            debug(f"Total errors: {total_errors}, Total drops: {total_drops}")

        return {
            'interfaces': interfaces,
            'total_errors': total_errors,
            'total_drops': total_drops
        }

    except Exception as e:
        debug(f"Interface stats error: {str(e)}")
        return {'interfaces': [], 'total_errors': 0, 'total_drops': 0}


def get_interface_traffic_counters():
    """
    Fetch per-interface traffic counters (bytes in/out) from Palo Alto firewall

    Returns:
        dict: Interface name mapped to traffic stats
        Example: {'ethernet1/1': {'ibytes': 12345, 'obytes': 67890, 'total_bytes': 80235}, ...}
    """
    debug("get_interface_traffic_counters called")
    try:
        _, api_key, base_url = get_firewall_config()

        # Check if no device is configured
        if not api_key or not base_url:
            debug("No device configured - returning empty traffic counters")
            return {}

        # Get interface counters
        cmd = "<show><counter><interface>all</interface></counter></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)
        debug(f"Interface traffic counters API Status: {response.status_code}")

        interface_counters = {}

        if response.status_code == 200:
            root = ET.fromstring(response.text)

            # Parse hardware entries for byte counters (physical interfaces)
            for hw_entry in root.findall('.//hw/entry'):
                name_elem = hw_entry.find('name')
                ibytes_elem = hw_entry.find('ibytes')
                obytes_elem = hw_entry.find('obytes')

                if name_elem is not None and name_elem.text:
                    interface_name = name_elem.text
                    ibytes = int(ibytes_elem.text) if ibytes_elem is not None and ibytes_elem.text else 0
                    obytes = int(obytes_elem.text) if obytes_elem is not None and obytes_elem.text else 0

                    interface_counters[interface_name] = {
                        'ibytes': ibytes,
                        'obytes': obytes,
                        'total_bytes': ibytes + obytes
                    }

            # Parse ifnet entries for subinterfaces (logical interfaces like ethernet1/1.100)
            for ifnet_entry in root.findall('.//ifnet/entry'):
                name_elem = ifnet_entry.find('name')
                ibytes_elem = ifnet_entry.find('ibytes')
                obytes_elem = ifnet_entry.find('obytes')

                if name_elem is not None and name_elem.text:
                    interface_name = name_elem.text
                    # Only process if this is a subinterface (contains a dot) or not already in counters
                    if '.' in interface_name or interface_name not in interface_counters:
                        ibytes = int(ibytes_elem.text) if ibytes_elem is not None and ibytes_elem.text else 0
                        obytes = int(obytes_elem.text) if obytes_elem is not None and obytes_elem.text else 0

                        interface_counters[interface_name] = {
                            'ibytes': ibytes,
                            'obytes': obytes,
                            'total_bytes': ibytes + obytes
                        }

            debug(f"Found traffic counters for {len(interface_counters)} interfaces (including subinterfaces)")

        return interface_counters

    except Exception as e:
        debug(f"Interface traffic counters error: {str(e)}")
        return {}


def get_session_count(device_id=None):
    """Fetch session count from Palo Alto firewall

    Args:
        device_id (str, optional): Specific device ID to query. If None, uses selected_device_id from settings.

    Returns:
        dict: Session counts including:
            - active: Total active sessions
            - tcp: TCP sessions
            - udp: UDP sessions
            - icmp: ICMP sessions
            - max: Maximum session capacity
            - utilization_pct: Session utilization percentage
    """
    debug("get_session_count called (device_id=%s)", device_id)
    try:
        _, api_key, base_url = get_firewall_config(device_id)

        # Check if no device is configured
        if not api_key or not base_url:
            debug("No device configured - returning 0 session counts")
            return {'active': 0, 'tcp': 0, 'udp': 0, 'icmp': 0, 'max': 0, 'utilization_pct': 0}

        cmd = "<show><session><info></info></session></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)

        if response.status_code == 200:
            root = ET.fromstring(response.text)

            # Extract session counts
            num_active = root.find('.//num-active')
            num_tcp = root.find('.//num-tcp')
            num_udp = root.find('.//num-udp')
            num_icmp = root.find('.//num-icmp')
            num_max = root.find('.//num-max')

            active = int(num_active.text) if num_active is not None and num_active.text else 0
            max_sessions = int(num_max.text) if num_max is not None and num_max.text else 0

            # Calculate utilization percentage
            utilization_pct = round((active / max_sessions * 100), 2) if max_sessions > 0 else 0

            return {
                'active': active,
                'tcp': int(num_tcp.text) if num_tcp is not None and num_tcp.text else 0,
                'udp': int(num_udp.text) if num_udp is not None and num_udp.text else 0,
                'icmp': int(num_icmp.text) if num_icmp is not None and num_icmp.text else 0,
                'max': max_sessions,
                'utilization_pct': utilization_pct
            }
        else:
            return {'active': 0, 'tcp': 0, 'udp': 0, 'icmp': 0, 'max': 0, 'utilization_pct': 0}

    except Exception as e:
        exception(f"Session count error: {str(e)}")
        return {'active': 0, 'tcp': 0, 'udp': 0, 'icmp': 0, 'max': 0, 'utilization_pct': 0}


def get_disk_usage(device_id=None):
    """Fetch disk usage from Palo Alto firewall

    Args:
        device_id (str, optional): Specific device ID to query. If None, uses selected_device_id from settings.

    Returns:
        dict: Disk usage metrics including:
            - root_pct: Root partition usage percentage
            - logs_pct: Log partition usage percentage
            - var_pct: Var partition usage percentage
            - partitions: List of all partitions with details
    """
    debug("get_disk_usage called (device_id=%s)", device_id)
    try:
        _, api_key, base_url = get_firewall_config(device_id)

        # Check if no device is configured
        if not api_key or not base_url:
            debug("No device configured - returning 0 disk usage")
            return {'root_pct': 0, 'logs_pct': 0, 'var_pct': 0, 'partitions': []}

        cmd = "<show><system><disk-space></disk-space></system></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)

        root_pct = 0
        logs_pct = 0
        var_pct = 0
        partitions = []

        if response.status_code == 200:
            root = ET.fromstring(response.text)

            # The response contains filesystem information in text format
            result = root.find('.//result')
            if result is not None and result.text:
                lines = result.text.strip().split('\n')
                debug(f"Disk space output:\n{result.text[:500]}")

                # Parse disk usage lines (format: Filesystem Size Used Avail Use% Mounted)
                for line in lines[1:]:  # Skip header line
                    parts = line.split()
                    if len(parts) >= 6:
                        filesystem = parts[0]
                        use_pct_str = parts[4]  # e.g., "45%"
                        mounted = parts[5]

                        try:
                            use_pct = int(use_pct_str.rstrip('%'))

                            partitions.append({
                                'filesystem': filesystem,
                                'mounted': mounted,
                                'usage_pct': use_pct
                            })

                            # Map common mount points
                            if mounted == '/':
                                root_pct = use_pct
                            elif 'log' in mounted.lower() or '/opt/pancfg' in mounted:
                                logs_pct = use_pct
                            elif '/var' in mounted or '/dev/shm' in mounted:
                                var_pct = use_pct

                        except (ValueError, IndexError) as e:
                            debug(f"Error parsing disk line: {line} - {e}")

                debug(f"Parsed disk usage - Root: {root_pct}%, Logs: {logs_pct}%, Var: {var_pct}%")

        return {
            'root_pct': root_pct,
            'logs_pct': logs_pct,
            'var_pct': var_pct,
            'partitions': partitions
        }

    except Exception as e:
        exception(f"Disk usage error: {str(e)}")
        return {'root_pct': 0, 'logs_pct': 0, 'var_pct': 0, 'partitions': []}


def get_cpu_temperature(device_id=None):
    """Fetch CPU temperature from Palo Alto firewall thermal sensors

    Args:
        device_id (str, optional): Specific device ID to query. If None, uses selected_device_id from settings.

    Returns:
        dict: Temperature metrics including:
            - cpu_temp: Current CPU temperature in Celsius
            - cpu_temp_max: Maximum CPU temperature threshold in Celsius
            - cpu_temp_alarm: Boolean indicating if temperature alarm is active
    """
    debug("get_cpu_temperature called (device_id=%s)", device_id)
    try:
        _, api_key, base_url = get_firewall_config(device_id)

        # Check if no device is configured
        if not api_key or not base_url:
            debug("No device configured - returning null temperature")
            return {'cpu_temp': None, 'cpu_temp_max': None, 'cpu_temp_alarm': False}

        # Get thermal/temperature information
        cmd = "<show><system><environmentals><thermal></thermal></environmentals></system></show>"
        params = {
            'type': 'op',
            'cmd': cmd,
            'key': api_key
        }

        response = api_request_get(base_url, params=params, verify=False, timeout=10)
        debug(f"Temperature API response status: {response.status_code}")

        if response.status_code == 200:
            root = ET.fromstring(response.text)

            # Look for CPU temperature entries
            # Format: <entry><DegreesC>45</DegreesC><max>85</max><alarm>no</alarm><slot>CPU</slot></entry>
            entries = root.findall('.//entry')

            cpu_temp = None
            cpu_temp_max = None
            cpu_temp_alarm = False

            for entry in entries:
                # Check if this entry is for CPU Die temperature sensor
                # XML format: <description>CPU Die temperature sensor</description>
                desc_elem = entry.find('description')

                if desc_elem is not None and 'CPU' in desc_elem.text.upper() and 'DIE' in desc_elem.text.upper():
                    # Found CPU Die temperature entry
                    temp_elem = entry.find('DegreesC')
                    max_elem = entry.find('max')
                    alarm_elem = entry.find('alarm')

                    if temp_elem is not None and temp_elem.text:
                        try:
                            cpu_temp = int(float(temp_elem.text))
                            debug(f"Found CPU temperature: {cpu_temp}°C")
                        except ValueError:
                            pass

                    if max_elem is not None and max_elem.text:
                        try:
                            cpu_temp_max = int(float(max_elem.text))
                            debug(f"Found CPU max temperature: {cpu_temp_max}°C")
                        except ValueError:
                            pass

                    if alarm_elem is not None and alarm_elem.text:
                        cpu_temp_alarm = alarm_elem.text.lower() == 'true'
                        debug(f"CPU temperature alarm: {cpu_temp_alarm}")

                    break  # Found CPU entry, stop searching

            if cpu_temp is None:
                debug("WARNING: No CPU temperature found in thermal data")

            return {
                'cpu_temp': cpu_temp,
                'cpu_temp_max': cpu_temp_max,
                'cpu_temp_alarm': cpu_temp_alarm
            }
        else:
            debug(f"Temperature API returned non-200 status: {response.status_code}")
            return {'cpu_temp': None, 'cpu_temp_max': None, 'cpu_temp_alarm': False}

    except Exception as e:
        exception(f"CPU temperature error: {str(e)}")
        return {'cpu_temp': None, 'cpu_temp_max': None, 'cpu_temp_alarm': False}
