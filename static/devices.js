/**
 * devices.js - Device Management Module
 *
 * Handles firewall device management including:
 * - Device selector initialization
 * - Device CRUD operations (Create, Read, Update, Delete)
 * - Device switching and state management
 * - Device modal and forms
 * - Connection testing
 */

function initDeviceSelector() {
    console.log('=== initDeviceSelector called ===');

    // Add event listener to device selector ONCE
    const deviceSelector = document.getElementById('deviceSelector');
    console.log('Device selector element:', deviceSelector);
    if (deviceSelector) {
        console.log('Attaching change event listener to device selector');
        deviceSelector.addEventListener('change', onDeviceChange);
    } else {
        console.error('Device selector not found!');
    }

    // Load devices and populate selector
    loadDevices();
}

// ============================================================================
// Device Management Functions
// ============================================================================

let currentDevices = [];
let currentGroups = [];
let selectedDeviceId = '';
let devicesSortBy = 'name';
let devicesSortDesc = false;

async function loadDevices() {
    try {
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const response = await window.apiClient.get('/api/devices');

        if (!response.ok) {
            console.error('Failed to load devices:', response.status);
            return;
        }

        const data = response.data;

        if (data.status === 'success') {
            currentDevices = data.devices;
            currentGroups = data.groups;
            renderDevicesTable();
            updateGroupOptions();
            await updateDeviceSelector();
        }
    } catch (error) {
        console.error('Error loading devices:', error);
    }
}

async function updateDeviceSelector() {
    console.log('=== updateDeviceSelector called ===');
    console.log('currentDevices length:', currentDevices.length);
    const selector = document.getElementById('deviceSelector');
    if (!selector) {
        console.error('deviceSelector element not found!');
        return;
    }
    console.log('deviceSelector element found');

    // ALWAYS fetch selected device from backend settings (source of truth)
    console.log('Fetching settings to get selected device...');
    try {
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const response = await window.apiClient.get('/api/settings');

        if (!response.ok) {
            console.error('Failed to fetch settings:', response.status);
            selectedDeviceId = '';
            return;
        }

        const data = response.data;
        if (data.status === 'success') {
            selectedDeviceId = data.settings.selected_device_id || '';
            console.log('Got selectedDeviceId from settings:', selectedDeviceId);
        }
    } catch (error) {
        console.error('Error fetching settings:', error);
        selectedDeviceId = '';
    }

    // Populate selector
    if (currentDevices.length === 0) {
        selector.innerHTML = '<option value="">No devices configured</option>';
        selectedDeviceId = '';
        // Update status to show no device connected
        if (typeof updateStatus === 'function') {
            updateStatus(false, 'no_device');
            console.log('No devices configured, updated status');
        }
        return;
    }

    // Build options
    let options = '';
    currentDevices.forEach(device => {
        const selected = device.id === selectedDeviceId ? 'selected' : '';
        options += `<option value="${device.id}" ${selected}>${device.name} (${device.ip})</option>`;
    });
    selector.innerHTML = options;
    selector.value = selectedDeviceId;
    console.log('Set selector value to:', selectedDeviceId);

    // Load interface for the selected device (if one is selected)
    if (selectedDeviceId) {
        const device = currentDevices.find(d => d.id === selectedDeviceId);
        if (device) {
            const deviceInterface = device.monitored_interface || 'ethernet1/12';
            const interfaceInput = document.getElementById('monitoredInterfaceInput');
            if (interfaceInput) {
                interfaceInput.value = deviceInterface;
                console.log('Loaded interface for selected device:', deviceInterface);
            }

            // Update the status bubble to show the connected device name
            if (typeof updateStatus === 'function') {
                updateStatus(true, '', device.name);
                console.log('Updated status bubble with device name:', device.name);
            }
        }
    } else {
        // No device selected even though devices exist
        if (typeof updateStatus === 'function') {
            updateStatus(false, 'no_device');
            console.log('Devices exist but none selected, updated status');
        }
    }
}

async function onDeviceChange() {
    console.log('=== onDeviceChange fired ===');
    console.log('Device dropdown changed!');

    const selector = document.getElementById('deviceSelector');
    selectedDeviceId = selector.value;
    console.log('Selected device ID:', selectedDeviceId);

    // Save selected device to settings
    try {
        // Get CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        console.log('CSRF token:', csrfToken ? 'found' : 'missing');

        console.log('Fetching current settings...');
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const settingsResponse = await window.apiClient.get('/api/settings');
        console.log('Current settings response:', settingsResponse);

        if (!settingsResponse.ok) {
            console.error('Failed to fetch settings');
            return;
        }

        const currentSettings = settingsResponse.data;

        if (currentSettings.status === 'success') {
            const settings = currentSettings.settings;
            settings.selected_device_id = selectedDeviceId;

            console.log('Saving device selection to settings...');
            // ApiClient auto-injects CSRF token
            const saveResponse = await window.apiClient.post('/api/settings', settings);
            console.log('Device selection save response:', saveResponse);

            if (!saveResponse.ok || saveResponse.data.status !== 'success') {
                console.error('Failed to save device selection:', saveResponse.data?.message);
                alert('Failed to save device selection: ' + (saveResponse.data?.message || 'Unknown error'));
                return;
            }

            // Load interface for this device
            const device = currentDevices.find(d => d.id === selectedDeviceId);
            console.log('Found device:', device);

            if (device) {
                const interfaceInput = document.getElementById('monitoredInterfaceInput');
                const deviceInterface = device.monitored_interface || 'ethernet1/12';
                console.log('Device interface:', deviceInterface);

                if (interfaceInput) {
                    interfaceInput.value = deviceInterface;
                    console.log('Updated interface input to:', deviceInterface);
                }

                // Update the status bubble to show the new device name
                if (typeof updateStatus === 'function') {
                    updateStatus(true, '', device.name);
                    console.log('Updated status bubble with new device name:', device.name);
                }

                // Update settings with device's interface
                settings.monitored_interface = deviceInterface;
                console.log('Saving interface to settings...');
                // ApiClient auto-injects CSRF token
                const interfaceSaveResponse = await window.apiClient.post('/api/settings', settings);
                console.log('Interface save response:', interfaceSaveResponse);

                if (!interfaceSaveResponse.ok || interfaceSaveResponse.data.status !== 'success') {
                    console.error('Failed to save interface:', interfaceSaveResponse.data?.message);
                }

                // If device doesn't have interface saved yet, save the default
                if (!device.monitored_interface) {
                    console.log('Device has no interface saved, saving default...');
                    // Create update payload WITHOUT api_key to avoid double encryption
                    const deviceUpdatePayload = {
                        name: device.name,
                        ip: device.ip,
                        group: device.group || 'Default',
                        description: device.description || '',
                        enabled: device.enabled !== undefined ? device.enabled : true,
                        monitored_interface: deviceInterface
                    };
                    // ApiClient auto-injects CSRF token
                    const deviceUpdateResponse = await window.apiClient.put(`/api/devices/${selectedDeviceId}`, deviceUpdatePayload);
                    console.log('Device update response:', deviceUpdateResponse.status);
                }
            }

            // Wait to ensure settings are fully saved and available for reading
            console.log('Waiting for settings to save and flush to disk...');
            await new Promise(resolve => setTimeout(resolve, 500));

            // Verify settings were saved by reading them back
            console.log('Verifying settings were saved...');
            // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
            const verifyResponse = await window.apiClient.get('/api/settings');

            if (verifyResponse.ok && verifyResponse.data.status === 'success') {
                console.log('Verified selected_device_id in settings:', verifyResponse.data.settings.selected_device_id);
                if (verifyResponse.data.settings.selected_device_id !== selectedDeviceId) {
                    console.error('WARNING: Settings verification failed! Selected device ID mismatch.');
                    console.error('Expected:', selectedDeviceId, 'Got:', verifyResponse.data.settings.selected_device_id);
                }
            }

            // Call centralized function to clear and refresh ALL data
            // This function is defined in app.js and handles all data clearing/refreshing
            console.log('Calling refreshAllDataForDevice()...');
            if (typeof refreshAllDataForDevice === 'function') {
                refreshAllDataForDevice();
            } else {
                console.error('refreshAllDataForDevice function not found!');
            }
        }
    } catch (error) {
        console.error('Error in onDeviceChange:', error);
    }
    console.log('=== onDeviceChange complete ===');
}

function sortDevices(field) {
    // Toggle sort direction if clicking the same field
    if (devicesSortBy === field) {
        devicesSortDesc = !devicesSortDesc;
    } else {
        devicesSortBy = field;
        devicesSortDesc = false; // Default to ascending
    }
    renderDevicesTable();
    updateSortIndicators();
}

function updateSortIndicators() {
    // Clear all indicators
    ['name', 'ip', 'group', 'uptime', 'version', 'status'].forEach(field => {
        const indicator = document.getElementById(`sort-${field}`);
        if (indicator) {
            indicator.textContent = '';
        }
    });

    // Set current indicator
    const currentIndicator = document.getElementById(`sort-${devicesSortBy}`);
    if (currentIndicator) {
        currentIndicator.textContent = devicesSortDesc ? ' ▼' : ' ▲';
    }
}

function renderDevicesTable() {
    const tbody = document.getElementById('devicesTableBody');

    if (currentDevices.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="padding: 40px; text-align: center; color: #999;">
                    No devices found. Click "Add Device" to get started.
                </td>
            </tr>
        `;
        return;
    }

    // Sort devices
    const sortedDevices = [...currentDevices].sort((a, b) => {
        let aVal, bVal;

        switch (devicesSortBy) {
            case 'name':
                aVal = a.name || '';
                bVal = b.name || '';
                break;
            case 'ip':
                aVal = a.ip || '';
                bVal = b.ip || '';
                break;
            case 'group':
                aVal = a.group || 'Default';
                bVal = b.group || 'Default';
                break;
            case 'uptime':
                aVal = a.uptime || 'N/A';
                bVal = b.uptime || 'N/A';
                break;
            case 'version':
                aVal = a.version || 'N/A';
                bVal = b.version || 'N/A';
                break;
            case 'status':
                // Sort by status priority: Online > Unavailable > Disabled
                const getStatusPriority = (device) => {
                    if (!device.enabled) return 2;
                    if (device.uptime === 'N/A' || device.uptime === 'Disabled') return 1;
                    return 0;
                };
                aVal = getStatusPriority(a);
                bVal = getStatusPriority(b);
                return devicesSortDesc ? bVal - aVal : aVal - bVal;
            default:
                aVal = a.name || '';
                bVal = b.name || '';
        }

        // String comparison
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return devicesSortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }

        // Numeric comparison
        return devicesSortDesc ? bVal - aVal : aVal - bVal;
    });

    tbody.innerHTML = sortedDevices.map(device => {
        // Determine device availability
        const isDisabled = !device.enabled;
        const isUnavailable = device.uptime === 'N/A' || device.uptime === 'Disabled';
        const isAvailable = device.enabled && !isUnavailable;

        // Status indicator: Green (available), Red (unavailable/disabled), Orange (disabled)
        let statusColor, statusBg, statusText;
        if (isDisabled) {
            statusColor = '#856404';
            statusBg = '#fff3cd';
            statusText = '⚫ Disabled';
        } else if (isUnavailable) {
            statusColor = '#721c24';
            statusBg = '#f8d7da';
            statusText = '🔴 Unavailable';
        } else {
            statusColor = '#155724';
            statusBg = '#d4edda';
            statusText = '🟢 Online';
        }

        return `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; color: #333;">${device.name}</td>
                <td style="padding: 12px; color: #666;">${device.ip}</td>
                <td style="padding: 12px; color: #666;">${device.group || 'Default'}</td>
                <td style="padding: 12px; color: #666;">${device.uptime || 'N/A'}</td>
                <td style="padding: 12px; color: #666;">${device.version || 'N/A'}</td>
                <td style="padding: 12px;">
                    <span style="display: inline-block; padding: 6px 12px; border-radius: 12px; font-size: 0.85em; font-weight: 600; background: ${statusBg}; color: ${statusColor};">
                        ${statusText}
                    </span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    <button onclick="editDevice('${device.id}')" style="padding: 6px 12px; background: #ff6600; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 5px;">
                        Edit
                    </button>
                    <button onclick="deleteDevice('${device.id}')" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Update sort indicators
    updateSortIndicators();
}

function updateGroupOptions() {
    const groupSelect = document.getElementById('deviceGroup');
    groupSelect.innerHTML = currentGroups.map(group =>
        `<option value="${group}">${group}</option>`
    ).join('');
}

function showDeviceModal(deviceId = null) {
    const modal = document.getElementById('deviceModal');
    const title = document.getElementById('deviceModalTitle');
    const form = document.getElementById('deviceForm');

    form.reset();
    document.getElementById('connectionTestResult').style.display = 'none';

    if (deviceId) {
        const device = currentDevices.find(d => d.id === deviceId);
        if (device) {
            title.textContent = 'Edit Device';
            document.getElementById('deviceId').value = device.id;
            document.getElementById('deviceName').value = device.name;
            document.getElementById('deviceIp').value = device.ip;
            document.getElementById('deviceApiKey').value = '';  // Don't populate encrypted key
            document.getElementById('deviceApiKey').placeholder = 'Leave blank to keep existing API key';
            document.getElementById('deviceApiKey').removeAttribute('required');  // Not required when editing
            document.getElementById('deviceGroup').value = device.group || 'Default';
            document.getElementById('deviceDescription').value = device.description || '';
            document.getElementById('deviceWanInterface').value = device.wan_interface || '';
        }
    } else {
        title.textContent = 'Add Device';
        document.getElementById('deviceId').value = '';
        document.getElementById('deviceApiKey').placeholder = '';
        document.getElementById('deviceApiKey').setAttribute('required', 'required');  // Required when adding
    }

    modal.style.display = 'flex';
}

function hideDeviceModal() {
    document.getElementById('deviceModal').style.display = 'none';
}

async function saveDevice(event) {
    event.preventDefault();

    const deviceId = document.getElementById('deviceId').value;
    const deviceData = {
        name: document.getElementById('deviceName').value,
        ip: document.getElementById('deviceIp').value,
        api_key: document.getElementById('deviceApiKey').value,
        group: document.getElementById('deviceGroup').value,
        description: document.getElementById('deviceDescription').value,
        wan_interface: document.getElementById('deviceWanInterface').value
    };

    try {
        // Use centralized ApiClient (v1.14.0 - CSRF token auto-injected)
        let response;
        if (deviceId) {
            response = await window.apiClient.put(`/api/devices/${deviceId}`, deviceData);
        } else {
            response = await window.apiClient.post('/api/devices', deviceData);
        }

        if (!response.ok) {
            throw new Error('Failed to save device');
        }

        const data = response.data;

        if (data.status === 'success') {
            hideDeviceModal();
            console.log('Device saved successfully, reloading devices...');

            // Get the new device ID and auto_selected flag if this was an add operation
            const newDeviceId = data.device?.id || null;
            const autoSelected = data.auto_selected || false;
            console.log('New device ID:', newDeviceId);
            console.log('Auto-selected by backend:', autoSelected);
            console.log('Was this an edit? deviceId =', deviceId);

            // Reload devices to get updated list
            await loadDevices();
            console.log('Devices reloaded, currentDevices count:', currentDevices.length);

            // If backend auto-selected this device (first device added), trigger data refresh
            if (autoSelected && newDeviceId && !deviceId) {
                console.log('Backend auto-selected new device, triggering data refresh...');

                // Force set the selected device ID locally to ensure it's set
                selectedDeviceId = newDeviceId;
                console.log('Forced selectedDeviceId to:', selectedDeviceId);

                // Update the device selector dropdown immediately
                await updateDeviceSelector();

                // Trigger a full data refresh immediately
                if (typeof refreshAllDataForDevice === 'function') {
                    console.log('Calling refreshAllDataForDevice to load data for newly added device');
                    refreshAllDataForDevice();
                }
            }

            alert(data.message);
        } else {
            alert('Error: ' + data.message);
        }
    } catch (error) {
        alert('Error saving device: ' + error.message);
    }
}

async function editDevice(deviceId) {
    showDeviceModal(deviceId);
}

async function deleteDevice(deviceId) {
    const device = currentDevices.find(d => d.id === deviceId);
    if (!confirm(`Are you sure you want to delete device "${device.name}"?`)) {
        return;
    }

    try {
        // Use centralized ApiClient (v1.14.0 - CSRF token auto-injected)
        const response = await window.apiClient.delete(`/api/devices/${deviceId}`);

        if (!response.ok) {
            throw new Error('Failed to delete device');
        }

        const data = response.data;

        if (data.status === 'success') {
            console.log('Device deleted successfully, reloading devices...');
            await loadDevices();
            console.log('Devices reloaded, currentDevices count:', currentDevices.length);
            alert(data.message);
        } else {
            alert('Error: ' + data.message);
        }
    } catch (error) {
        alert('Error deleting device: ' + error.message);
    }
}

async function testConnection() {
    const ip = document.getElementById('deviceIp').value;
    const apiKey = document.getElementById('deviceApiKey').value;
    const resultDiv = document.getElementById('connectionTestResult');

    if (!ip || !apiKey) {
        alert('Please enter IP and API Key first');
        return;
    }

    resultDiv.textContent = 'Testing connection...';
    resultDiv.style.display = 'block';
    resultDiv.style.background = '#fff3cd';
    resultDiv.style.color = '#856404';

    try {
        // Use centralized ApiClient (v1.14.0 - CSRF token auto-injected)
        const response = await window.apiClient.post('/api/devices/test-connection', {
            ip,
            api_key: apiKey
        });

        if (!response.ok) {
            throw new Error('Connection test failed');
        }

        const data = response.data;

        if (data.status === 'success') {
            resultDiv.textContent = '✓ ' + data.message;
            resultDiv.style.background = '#d4edda';
            resultDiv.style.color = '#155724';
        } else {
            resultDiv.textContent = '✗ ' + data.message;
            resultDiv.style.background = '#f8d7da';
            resultDiv.style.color = '#721c24';
        }
    } catch (error) {
        resultDiv.textContent = '✗ Connection test failed: ' + error.message;
        resultDiv.style.background = '#f8d7da';
        resultDiv.style.color = '#721c24';
    }
}

// ============================================================================
// Interface Update Function
// ============================================================================

async function updateMonitoredInterface() {
    console.log('=== updateMonitoredInterface fired ===');
    try {
        // Get CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        const interfaceInput = document.getElementById('monitoredInterfaceInput');
        const newInterface = interfaceInput.value.trim();
        console.log('New interface:', newInterface);

        if (!newInterface) {
            alert('Please enter an interface name (e.g., ethernet1/12)');
            return;
        }

        // Check if device is selected
        if (!selectedDeviceId) {
            alert('No device selected. Please select a device first.');
            console.error('No device selected');
            return;
        }

        console.log('Selected device ID:', selectedDeviceId);
        const device = currentDevices.find(d => d.id === selectedDeviceId);
        console.log('Found device:', device);

        if (!device) {
            alert('Could not find selected device');
            console.error('Device not found:', selectedDeviceId);
            return;
        }

        // Create clean payload with only necessary fields
        // NOTE: Do NOT include api_key here - it's already encrypted in the device object
        // and would cause double encryption if sent back to server
        const updatePayload = {
            name: device.name,
            ip: device.ip,
            group: device.group || 'Default',
            description: device.description || '',
            enabled: device.enabled !== undefined ? device.enabled : true,
            monitored_interface: newInterface
        };
        console.log('Updating device with interface:', newInterface);

        // Save device via API using ApiClient (v1.14.0 - CSRF token auto-injected)
        const updateResponse = await window.apiClient.put(`/api/devices/${selectedDeviceId}`, updatePayload);

        if (!updateResponse.ok) {
            throw new Error(`Device update failed: ${updateResponse.data?.message || 'Unknown error'}`);
        }

        const updateData = updateResponse.data;
        console.log('Device update response:', updateData);

        if (updateData.status !== 'success') {
            throw new Error(updateData.message || 'Failed to update device');
        }

        // Also save to global settings for backward compatibility
        console.log('Updating global settings...');
        const settingsResponse = await window.apiClient.get('/api/settings');

        if (settingsResponse.ok && settingsResponse.data.status === 'success') {
            const settings = settingsResponse.data.settings;
            settings.monitored_interface = newInterface;

            await window.apiClient.post('/api/settings', settings);
        }

        // Reload devices to ensure consistency
        console.log('Reloading devices...');
        await loadDevices();

        // Reset chart data (access from window global scope)
        if (typeof window.chartData !== 'undefined' && typeof window.chart !== 'undefined') {
            console.log('Clearing chart data...');
            window.chartData.labels = [];
            window.chartData.inbound = [];
            window.chartData.outbound = [];
            window.chartData.total = [];
            window.chart.update();
        }

        // Show success message on button
        const btn = document.getElementById('updateInterfaceBtn');
        const originalText = btn.textContent;
        const originalBg = btn.style.background;
        btn.textContent = '✓ Updated!';
        btn.style.background = '#10b981';

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = originalBg || 'linear-gradient(135deg, #FA582D 0%, #FF7A55 100%)';
        }, 2000);

        // Refresh data immediately
        console.log('Fetching new throughput data...');
        if (typeof fetchThroughputData === 'function') {
            fetchThroughputData();
        }

        console.log('Interface update successful');
    } catch (error) {
        console.error('Error updating interface:', error);
        alert('Error updating interface: ' + error.message);
    }
    console.log('=== updateMonitoredInterface complete ===');
}
