/**
 * PANfm - Connected Devices Core Module
 *
 * Purpose: Core data management, state, and table rendering
 * Part of: Phase 6 JavaScript Refactoring (v1.8.2)
 *
 * Dependencies: None (this is the base module)
 *
 * Exports (via window.ConnectedDevices namespace):
 * - State variables (allDevices, metadata, sort state, etc.)
 * - loadConnectedDevices() - Main data loader
 * - renderConnectedDevicesTable() - Table rendering
 * - sortConnectedDevices(field) - Column sorting
 * - toggleDeviceRowExpansion(mac) - Expand/collapse details
 *
 * Also exports to window for inline event handlers:
 * - sortConnectedDevices(field)
 * - toggleDeviceRowExpansion(mac)
 */

console.log('✅ [CONNECTED DEVICES CORE] Version 1.13.1 - SORTING DEBUG ENABLED');

// ============================================================================
// GLOBAL STATE
// ============================================================================

let allConnectedDevices = [];
let connectedDevicesMetadata = {};
// v1.10.11: Changed default sort from 'age' to 'total_volume' (highest bandwidth first)
let connectedDevicesSortBy = 'total_volume'; // Default sort by total bandwidth
let connectedDevicesSortDesc = true; // Default descending (highest to lowest)
let deviceMetadataCache = {}; // Cache metadata keyed by MAC address (normalized lowercase)
let expandedRows = new Set(); // Track which rows are expanded for comments
let allTagsCache = []; // Cache all unique tags for autocomplete
let allLocationsCache = []; // Cache all unique locations for autocomplete

// ============================================================================
// DATA LOADING FUNCTIONS
// ============================================================================

/**
 * Load device metadata from API
 * Called during initial data load
 */
async function loadDeviceMetadata() {
    console.log('Loading device metadata...');
    try {
        const response = await window.apiClient.get('/api/device-metadata');
        if (!response.ok) {
            console.warn('Failed to load device metadata');
            deviceMetadataCache = {};
            return;
        }
        const data = response.data;

        if (data.status === 'success' && data.metadata) {
            // Normalize MAC addresses to lowercase for consistent lookup
            deviceMetadataCache = {};
            for (const [mac, metadata] of Object.entries(data.metadata)) {
                deviceMetadataCache[mac.toLowerCase()] = metadata;
            }
            console.log(`Loaded metadata for ${Object.keys(deviceMetadataCache).length} devices`);
        } else {
            console.warn('Failed to load device metadata:', data.message);
            deviceMetadataCache = {};
        }
    } catch (error) {
        console.error('Error loading device metadata:', error);
        deviceMetadataCache = {};
    }
}

/**
 * Load all unique tags for autocomplete
 */
async function loadAllTags() {
    console.log('Loading all tags for autocomplete...');
    try {
        const response = await window.apiClient.get('/api/device-metadata/tags');
        if (!response.ok) {
            console.warn('Failed to load tags');
            allTagsCache = [];
            return;
        }
        const data = response.data;

        if (data.status === 'success' && Array.isArray(data.tags)) {
            allTagsCache = data.tags;
            console.log(`Loaded ${allTagsCache.length} unique tags for autocomplete`);
        } else {
            console.warn('Failed to load tags:', data.message);
            allTagsCache = [];
        }
    } catch (error) {
        console.error('Error loading tags:', error);
        allTagsCache = [];
    }
}

/**
 * Load all unique locations for autocomplete
 */
async function loadAllLocations() {
    console.log('Loading all locations for autocomplete...');
    try {
        const response = await window.apiClient.get('/api/device-metadata/locations');
        if (!response.ok) {
            console.warn('Failed to load locations');
            allLocationsCache = [];
            return;
        }
        const data = response.data;

        if (data.status === 'success' && Array.isArray(data.locations)) {
            allLocationsCache = data.locations;
            console.log(`Loaded ${allLocationsCache.length} unique locations for autocomplete`);
        } else {
            console.warn('Failed to load locations:', data.message);
            allLocationsCache = [];
        }
    } catch (error) {
        console.error('Error loading locations:', error);
        allLocationsCache = [];
    }
}

/**
 * Main data loading function
 * Loads devices, metadata, tags, and locations in parallel
 */
async function loadConnectedDevices() {
    console.log('Loading connected devices...');
    try {
        // Load metadata, tags, and locations in parallel with devices
        // v1.10.11: Request bandwidth data for Total Volume column
        const [devicesResponse, metadataResponse, tagsResponse, locationsResponse] = await Promise.all([
            window.apiClient.get('/api/connected-devices', { params: { include_bandwidth: true } }),
            window.apiClient.get('/api/device-metadata'),
            window.apiClient.get('/api/device-metadata/tags'),
            window.apiClient.get('/api/device-metadata/locations')
        ]);

        if (!devicesResponse.ok) {
            throw new Error('Failed to load connected devices');
        }

        const data = devicesResponse.data;
        const metadataData = metadataResponse.ok ? metadataResponse.data : { status: 'error' };
        const tagsData = tagsResponse.ok ? tagsResponse.data : { status: 'error' };
        const locationsData = locationsResponse.ok ? locationsResponse.data : { status: 'error' };

        // Cache metadata
        if (metadataData.status === 'success' && metadataData.metadata) {
            deviceMetadataCache = {};
            for (const [mac, metadata] of Object.entries(metadataData.metadata)) {
                deviceMetadataCache[mac.toLowerCase()] = metadata;
            }
        }

        // Cache tags for autocomplete
        if (tagsData.status === 'success' && Array.isArray(tagsData.tags)) {
            allTagsCache = tagsData.tags;
            console.log(`Loaded ${allTagsCache.length} unique tags for autocomplete`);
        }

        // Cache locations for autocomplete
        if (locationsData.status === 'success' && Array.isArray(locationsData.locations)) {
            allLocationsCache = locationsData.locations;
            console.log(`Loaded ${allLocationsCache.length} unique locations for autocomplete`);
        }

        const tableDiv = document.getElementById('connectedDevicesTable');
        const errorDiv = document.getElementById('connectedDevicesErrorMessage');

        if (data.status === 'success' && data.devices.length > 0) {
            errorDiv.style.display = 'none';

            // Store devices for filtering/searching
            allConnectedDevices = data.devices;
            connectedDevicesMetadata = {
                total: data.total,
                timestamp: data.timestamp
            };

            console.log(`Loaded ${data.devices.length} connected devices`);

            // Set up event listeners
            setupConnectedDevicesEventListeners();

            // Render the table
            renderConnectedDevicesTable();

            // Restore filter visibility state (default: hidden)
            restoreConnectedDevicesFilterState();

            // Restore reverse DNS checkbox state
            restoreReverseDnsState();
        } else {
            errorDiv.textContent = data.message || 'No connected devices found';
            errorDiv.style.display = 'block';
            tableDiv.innerHTML = '';
        }
    } catch (error) {
        console.error('Error loading connected devices:', error);
        document.getElementById('connectedDevicesErrorMessage').textContent = 'Failed to load connected devices: ' + error.message;
        document.getElementById('connectedDevicesErrorMessage').style.display = 'block';
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

/**
 * Set up all event listeners for filters, search, and buttons
 */
function setupConnectedDevicesEventListeners() {
    // Search input
    const searchInput = document.getElementById('connectedDevicesSearchInput');
    if (searchInput && !searchInput.hasAttribute('data-listener')) {
        searchInput.addEventListener('input', () => renderConnectedDevicesTable());
        searchInput.setAttribute('data-listener', 'true');
    }

    // VLAN filter
    const vlanFilter = document.getElementById('connectedDevicesVlanFilter');
    if (vlanFilter && !vlanFilter.hasAttribute('data-listener')) {
        vlanFilter.addEventListener('change', () => renderConnectedDevicesTable());
        vlanFilter.setAttribute('data-listener', 'true');
    }

    // Zone filter
    const zoneFilter = document.getElementById('connectedDevicesZoneFilter');
    if (zoneFilter && !zoneFilter.hasAttribute('data-listener')) {
        zoneFilter.addEventListener('change', () => renderConnectedDevicesTable());
        zoneFilter.setAttribute('data-listener', 'true');
    }

    // Limit selector
    const limitSelect = document.getElementById('connectedDevicesLimit');
    if (limitSelect && !limitSelect.hasAttribute('data-listener')) {
        limitSelect.addEventListener('change', () => renderConnectedDevicesTable());
        limitSelect.setAttribute('data-listener', 'true');
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshConnectedDevicesBtn');
    if (refreshBtn && !refreshBtn.hasAttribute('data-listener')) {
        refreshBtn.addEventListener('click', () => loadConnectedDevices());
        refreshBtn.setAttribute('data-listener', 'true');
    }

    // Export buttons (functions imported from export module)
    const exportCSVBtn = document.getElementById('exportDevicesCSV');
    if (exportCSVBtn && !exportCSVBtn.hasAttribute('data-listener')) {
        exportCSVBtn.addEventListener('click', () => window.exportDevices('csv'));
        exportCSVBtn.setAttribute('data-listener', 'true');
    }

    const exportXMLBtn = document.getElementById('exportDevicesXML');
    if (exportXMLBtn && !exportXMLBtn.hasAttribute('data-listener')) {
        exportXMLBtn.addEventListener('click', () => window.exportDevices('xml'));
        exportXMLBtn.setAttribute('data-listener', 'true');
    }

    // Populate VLAN and Zone filters with unique values
    populateVLANFilter();
    populateZoneFilter();
}

// ============================================================================
// SORTING & FILTERING
// ============================================================================

/**
 * Sort connected devices by specified field
 * Toggles direction if clicking same field
 *
 * @param {string} field - Field name to sort by
 */
function sortConnectedDevices(field) {
    // Toggle sort direction if clicking the same field
    if (connectedDevicesSortBy === field) {
        connectedDevicesSortDesc = !connectedDevicesSortDesc;
    } else {
        connectedDevicesSortBy = field;
        // Default direction based on field type
        if (field === 'age') {
            connectedDevicesSortDesc = false; // Ascending for age (lowest first)
        } else {
            connectedDevicesSortDesc = true; // Descending for others
        }
    }
    renderConnectedDevicesTable();
}

/**
 * Populate VLAN filter dropdown with unique VLANs from devices
 */
function populateVLANFilter() {
    const vlanFilter = document.getElementById('connectedDevicesVlanFilter');
    if (!vlanFilter) return;

    // Get unique VLANs
    const vlans = new Set();
    allConnectedDevices.forEach(device => {
        if (device.vlan && device.vlan !== '-') {
            vlans.add(device.vlan);
        }
    });

    // Clear existing options (except "All VLANs")
    while (vlanFilter.options.length > 1) {
        vlanFilter.remove(1);
    }

    // Add VLAN options sorted
    Array.from(vlans).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.localeCompare(b);
    }).forEach(vlan => {
        const option = document.createElement('option');
        option.value = vlan;
        option.textContent = `VLAN ${vlan}`;
        vlanFilter.appendChild(option);
    });
}

/**
 * Populate Zone filter dropdown with unique zones from devices
 */
function populateZoneFilter() {
    const zoneFilter = document.getElementById('connectedDevicesZoneFilter');
    if (!zoneFilter) return;

    // Get unique zones
    const zones = new Set();
    allConnectedDevices.forEach(device => {
        if (device.zone && device.zone !== '-') {
            zones.add(device.zone);
        }
    });

    // Clear existing options (except "All Zones")
    while (zoneFilter.options.length > 1) {
        zoneFilter.remove(1);
    }

    // Add zone options sorted alphabetically
    Array.from(zones).sort().forEach(zone => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = zone;
        zoneFilter.appendChild(option);
    });
}

// ============================================================================
// TABLE RENDERING
// ============================================================================

/**
 * Main table rendering function
 * Applies filters, sorting, and generates HTML table
 */
function renderConnectedDevicesTable() {
    // Debug logging to verify sort state
    console.log(`[RENDER] Sort: field=${connectedDevicesSortBy}, desc=${connectedDevicesSortDesc}, devices count=${allConnectedDevices.length}`);

    const tableDiv = document.getElementById('connectedDevicesTable');
    const searchTerm = (document.getElementById('connectedDevicesSearchInput')?.value || '').toLowerCase().trim();
    const vlanFilter = document.getElementById('connectedDevicesVlanFilter')?.value || '';
    const zoneFilter = document.getElementById('connectedDevicesZoneFilter')?.value || '';
    const limit = parseInt(document.getElementById('connectedDevicesLimit')?.value || '50');

    // Enrich devices with metadata from cache
    const enrichedDevices = allConnectedDevices.map(device => {
        // Handle null/undefined MAC addresses (e.g., "(incomplete)" ARP entries)
        const normalizedMac = device.mac ? device.mac.toLowerCase() : '';
        const metadata = normalizedMac ? deviceMetadataCache[normalizedMac] : null;

        if (metadata) {
            // Create enriched device object with metadata fields
            return {
                ...device,
                custom_name: metadata.name || device.custom_name,
                location: metadata.location || device.location,
                tags: metadata.tags || device.tags || [],
                comment: metadata.comment || device.comment,
                original_hostname: device.hostname // Preserve original hostname
            };
        }
        return device;
    });

    // Filter devices
    let filteredDevices = enrichedDevices.filter(device => {
        // Search filter (includes tags, custom names, location, comments)
        if (searchTerm) {
            const tagsText = (device.tags && Array.isArray(device.tags)) ? device.tags.join(' ') : '';
            const customNameText = device.custom_name || '';
            const locationText = device.location || '';
            const commentText = device.comment || '';
            const searchableText = `${device.hostname || ''} ${device.original_hostname || device.hostname || ''} ${customNameText} ${locationText} ${device.ip || ''} ${device.mac || ''} ${device.interface || ''} ${tagsText} ${commentText}`.toLowerCase();
            if (!searchableText.includes(searchTerm)) {
                return false;
            }
        }

        // VLAN filter
        if (vlanFilter && device.vlan !== vlanFilter) {
            return false;
        }

        // Zone filter
        if (zoneFilter && device.zone !== zoneFilter) {
            return false;
        }

        return true;
    });

    // Apply sorting
    filteredDevices.sort((a, b) => {
        let aVal = a[connectedDevicesSortBy];
        let bVal = b[connectedDevicesSortBy];

        // Handle missing values for numeric fields
        if (connectedDevicesSortBy === 'age' || connectedDevicesSortBy === 'total_volume') {
            if (aVal === undefined || aVal === null) aVal = 0;
            if (bVal === undefined || bVal === null) bVal = 0;
        } else {
            // Handle missing values for string fields
            if (aVal === undefined || aVal === null) aVal = '';
            if (bVal === undefined || bVal === null) bVal = '';
        }

        // For numeric fields (age, total_volume), always use numeric comparison
        if (connectedDevicesSortBy === 'age' || connectedDevicesSortBy === 'total_volume') {
            // Debug logging for first few comparisons
            if (Math.random() < 0.01) {
                console.log(`[SORT DEBUG] ${connectedDevicesSortBy}: a=${aVal} (${typeof aVal}), b=${bVal} (${typeof bVal}), desc=${connectedDevicesSortDesc}`);
            }
            return connectedDevicesSortDesc ? bVal - aVal : aVal - bVal;
        }

        // For string fields, use locale compare (ensure both are strings)
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return connectedDevicesSortDesc ?
                bVal.localeCompare(aVal) :
                aVal.localeCompare(bVal);
        }

        // Convert to strings if types mismatch (safety fallback)
        if (typeof aVal === 'string' || typeof bVal === 'string') {
            const aStr = String(aVal);
            const bStr = String(bVal);
            return connectedDevicesSortDesc ?
                bStr.localeCompare(aStr) :
                aStr.localeCompare(bStr);
        }

        // For other numeric fields (vlan, etc.)
        return connectedDevicesSortDesc ? bVal - aVal : aVal - bVal;
    });

    // Debug: Log first 5 sorted devices with total_volume
    if (connectedDevicesSortBy === 'total_volume') {
        console.log('[SORTED] First 5 devices by total_volume:', filteredDevices.slice(0, 5).map(d => ({
            ip: d.ip,
            total_volume: d.total_volume,
            type: typeof d.total_volume
        })));
    }

    // Apply limit (unless "All" is selected)
    const displayDevices = limit === -1 ? filteredDevices : filteredDevices.slice(0, limit);

    // Helper function for sort indicators
    const getSortIndicator = (field) => {
        if (connectedDevicesSortBy === field) {
            return connectedDevicesSortDesc ? ' ▼' : ' ▲';
        }
        return '';
    };

    // Create table HTML
    let html = `
        <div style="background: linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.15); border-top: 4px solid #F2F0EF;">
            <div style="padding: 15px 20px; background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); color: white; display: flex; justify-content: space-between; align-items: center; font-family: var(--font-primary);">
                <div>
                    <strong style="font-size: 1.1em;">Connected Devices</strong>
                    <span style="margin-left: 15px; opacity: 0.9; font-family: var(--font-secondary);">Showing ${displayDevices.length} of ${filteredDevices.length} devices</span>
                </div>
                <div style="font-size: 0.9em; opacity: 0.9; font-family: var(--font-secondary);">
                    Total: ${allConnectedDevices.length}
                </div>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-family: var(--font-secondary); font-size: 0.9em; background: transparent;">
                    <thead>
                        <tr style="background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); border-bottom: 2px solid #555; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); width: 30px;"></th>
                            <th onclick="sortConnectedDevices('hostname')" style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Hostname${getSortIndicator('hostname')}</th>
                            <th onclick="sortConnectedDevices('ip')" style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">IP Address${getSortIndicator('ip')}</th>
                            <th onclick="sortConnectedDevices('mac')" style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">MAC Address${getSortIndicator('mac')}</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Tags</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Location</th>
                            <th onclick="sortConnectedDevices('vlan')" style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">VLAN${getSortIndicator('vlan')}</th>
                            <th onclick="sortConnectedDevices('zone')" style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Security Zone${getSortIndicator('zone')}</th>
                            <th onclick="sortConnectedDevices('interface')" style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Interface${getSortIndicator('interface')}</th>
                            <th onclick="sortConnectedDevices('age')" style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Age (minutes)${getSortIndicator('age')}</th>
                            <th onclick="sortConnectedDevices('total_volume')" style="padding: 14px 12px; text-align: right; font-weight: 700; color: #FA582D; white-space: nowrap; font-family: var(--font-primary); cursor: pointer; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Total Volume${getSortIndicator('total_volume')}</th>
                        </tr>
                    </thead>
                    <tbody>`;

    displayDevices.forEach((device, index) => {
        const rowStyle = index % 2 === 0 ? 'background: linear-gradient(135deg, #2a2a2a 0%, #252525 100%);' : 'background: linear-gradient(135deg, #333333 0%, #2d2d2d 100%);';
        // Handle null/undefined MAC addresses (e.g., "(incomplete)" ARP entries)
        const normalizedMac = device.mac ? device.mac.toLowerCase() : '';
        const isExpanded = normalizedMac ? expandedRows.has(normalizedMac) : false;
        const hasComment = device.comment && device.comment.trim();

        // Format hostname cell - show custom name prominently, hostname as subtitle
        let hostnameCell = '';
        if (device.custom_name) {
            hostnameCell = `<div style="font-weight: 600; color: #F2F0EF;">${escapeHtml(device.custom_name)}</div>`;
            const originalHostname = device.original_hostname || device.hostname || '-';
            if (originalHostname !== '-') {
                hostnameCell += `<div style="font-size: 0.85em; color: #999; margin-top: 2px;">${escapeHtml(originalHostname)}</div>`;
            }
        } else {
            hostnameCell = `<div style="color: #ccc;">${escapeHtml(device.hostname || '-')}</div>`;
        }

        // Format tags cell - show as colored badge chips
        let tagsCell = '';
        if (device.tags && Array.isArray(device.tags) && device.tags.length > 0) {
            tagsCell = device.tags.map(tag => {
                return `<span style="display: inline-block; background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.75em; font-weight: 600; margin: 2px 2px 2px 0; white-space: nowrap; box-shadow: 0 2px 4px rgba(250, 88, 45, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2);">${escapeHtml(tag)}</span>`;
            }).join('');
        } else {
            tagsCell = '<span style="color: #999;">-</span>';
        }

        // Format location cell - show as colored badge chip (similar to tags)
        let locationCell = '';
        if (device.location && device.location.trim()) {
            locationCell = `<span style="display: inline-block; background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%); color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.75em; font-weight: 600; white-space: nowrap; box-shadow: 0 2px 4px rgba(74, 144, 226, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2);">${escapeHtml(device.location)}</span>`;
        } else {
            locationCell = '<span style="color: #999;">-</span>';
        }

        // Chevron icon for expand/collapse (only shown if comment or location exists)
        const hasLocation = device.location && device.location.trim();
        const hasDetails = hasComment || hasLocation;
        let chevronCell = '';
        if (hasDetails) {
            const chevron = isExpanded ? '▼' : '▶';
            chevronCell = `<div onclick="toggleDeviceRowExpansion('${normalizedMac}'); event.stopPropagation();" style="cursor: pointer; color: #FA582D; font-size: 0.9em; user-select: none; padding: 4px; text-align: center;" title="${isExpanded ? 'Collapse' : 'Expand'} details">${chevron}</div>`;
        } else {
            chevronCell = '<div style="padding: 4px; text-align: center;"></div>';
        }

        // Format MAC address cell with vendor name and virtual indicator
        let macCell = `<div style="font-family: monospace; color: #F2F0EF;">${device.mac}</div>`;

        // Add badge for virtual/randomized MACs on a new line
        if (device.is_virtual) {
            // Different badge for privacy/randomized MACs (iPhone, Android, Windows)
            if (device.is_randomized) {
                macCell += `<div style="margin-top: 4px;"><span style="background: #FA582D; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.75em; font-weight: 600;" title="${device.virtual_type || 'Randomized MAC for Privacy'}">PRIVATE</span></div>`;
            } else {
                // Regular virtual MAC (VMs, containers)
                macCell += `<div style="margin-top: 4px;"><span style="background: #FA582D; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.75em; font-weight: 600;" title="${device.virtual_type || 'Virtual/Locally Administered MAC'}">VIRTUAL</span></div>`;
            }
        }

        // Add vendor name underneath if available
        if (device.vendor) {
            macCell += `<div style="font-size: 0.85em; color: #999; margin-top: 2px;">${device.vendor}</div>`;
        }

        // Add virtual type detail if available
        if (device.is_virtual && device.virtual_type) {
            const detailColor = device.is_randomized ? '#C44520' : '#C44520';
            macCell += `<div style="font-size: 0.75em; color: ${detailColor}; margin-top: 2px;">${device.virtual_type}</div>`;
        }

        // Make row clickable to open edit modal (function from metadata module)
        const rowId = `device-row-${normalizedMac.replace(/:/g, '-')}`;
        const deviceDataAttr = escapeHtml(JSON.stringify(device).replace(/"/g, '&quot;'));
        html += `
            <tr id="${rowId}" onclick="window.openDeviceEditModal('${escapeHtml(device.mac)}')" data-device='${deviceDataAttr}' style="${rowStyle} border-bottom: 1px solid #444; border-left: 4px solid transparent; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #3a3a3a 0%, #333333 100%)'; this.style.borderLeft='4px solid #FA582D';" onmouseout="this.style.background='${index % 2 === 0 ? 'linear-gradient(135deg, #2a2a2a 0%, #252525 100%)' : 'linear-gradient(135deg, #333333 0%, #2d2d2d 100%)'}'; this.style.borderLeft='4px solid transparent';">
                <td style="padding: 8px 12px;">${chevronCell}</td>
                <td style="padding: 12px;">${hostnameCell}</td>
                <td style="padding: 12px; color: #ccc; font-family: monospace;">
                    <span onclick="event.stopPropagation(); window.openNmapScanModal('${escapeHtml(device.ip)}');" style="color: #FA582D; cursor: pointer; text-decoration: underline;" title="Click to run nmap scan">${device.ip}</span>
                </td>
                <td style="padding: 12px;">${macCell}</td>
                <td style="padding: 12px;">${tagsCell}</td>
                <td style="padding: 12px;">${locationCell}</td>
                <td style="padding: 12px; color: #ccc;">${device.vlan}</td>
                <td style="padding: 12px; color: #ccc;">${device.zone || '-'}</td>
                <td style="padding: 12px; color: #ccc; font-family: monospace;">${device.interface}</td>
                <td style="padding: 12px; color: #ccc;">${device.ttl}</td>
                <td onclick="event.stopPropagation(); window.openSankeyDiagram('${device.ip}', ${device.total_volume || 0})" style="padding: 12px; text-align: right; color: #FA582D; font-weight: 700; font-size: 1.05em; text-shadow: 0 1px 2px rgba(250, 88, 45, 0.2); cursor: pointer; transition: all 0.2s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'" title="Click to view traffic flow breakdown">${formatBytesHuman(device.total_volume || 0)}</td>
            </tr>`;

        // Add expandable row detail for location/comments (if either exists)
        if (hasDetails) {
            const commentRowId = `device-comment-${normalizedMac.replace(/:/g, '-')}`;
            const displayStyle = isExpanded ? '' : 'display: none;';
            html += `
            <tr id="${commentRowId}" style="${displayStyle} background: #2a2a2a; border-bottom: 1px solid #444;">
                <td colspan="11" style="padding: 12px 12px 12px 48px; color: #ccc; font-size: 0.9em; border-top: 1px solid #555;">`;

            // Show location if it exists
            if (hasLocation) {
                html += `
                    <div style="margin-bottom: ${hasComment ? '12px' : '0'};">
                        <div style="font-weight: 600; color: #F2F0EF; margin-bottom: 4px;">Location:</div>
                        <div style="white-space: pre-wrap;">${escapeHtml(device.location)}</div>
                    </div>`;
            }

            // Show comment if it exists
            if (hasComment) {
                html += `
                    <div>
                        <div style="font-weight: 600; color: #F2F0EF; margin-bottom: 4px;">Comment:</div>
                        <div style="white-space: pre-wrap;">${escapeHtml(device.comment)}</div>
                    </div>`;
            }

            html += `
                </td>
            </tr>`;
        }
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>`;

    tableDiv.innerHTML = html;
}

/**
 * Toggle row expansion for comments/location details
 *
 * @param {string} mac - MAC address of device
 */
function toggleDeviceRowExpansion(mac) {
    const normalizedMac = mac.toLowerCase();
    if (expandedRows.has(normalizedMac)) {
        expandedRows.delete(normalizedMac);
    } else {
        expandedRows.add(normalizedMac);
    }
    renderConnectedDevicesTable();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Escape HTML special characters
 *
 * @param {string} text - Text to escape
 * @returns {string} - HTML-safe text
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format bytes to human-readable format (B, KB, MB, GB, TB)
 * v1.10.11: Added for Total Volume column display
 */
function formatBytesHuman(bytes) {
    if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get sort indicator for table headers (▼ for descending, ▲ for ascending)
 * v1.10.11: Added for sortable columns
 */
function getSortIndicator(field) {
    if (connectedDevicesSortBy === field) {
        return connectedDevicesSortDesc ? ' ▼' : ' ▲';
    }
    return '';
}

// ============================================================================
// COLLAPSIBLE FILTER AREA
// ============================================================================

/**
 * Toggle visibility of Connected Devices filter area
 * Saves state to localStorage for persistence across page loads
 */
function toggleConnectedDevicesFilters() {
    const filterArea = document.getElementById('connectedDevicesFilterArea');
    const toggleBtn = document.getElementById('toggleConnectedDevicesFiltersBtn');

    if (!filterArea || !toggleBtn) {
        console.warn('Filter area or toggle button not found');
        return;
    }

    const isCurrentlyHidden = filterArea.style.display === 'none';

    if (isCurrentlyHidden) {
        // Show filters
        filterArea.style.display = 'block';
        toggleBtn.innerHTML = '▲ Hide Filters';
        localStorage.setItem('connectedDevicesFiltersVisible', 'true');
    } else {
        // Hide filters
        filterArea.style.display = 'none';
        toggleBtn.innerHTML = '▼ Show Filters';
        localStorage.setItem('connectedDevicesFiltersVisible', 'false');
    }
}

/**
 * Restore Connected Devices filter visibility state from localStorage
 * Default: HIDDEN (as requested by user)
 */
function restoreConnectedDevicesFilterState() {
    const filterArea = document.getElementById('connectedDevicesFilterArea');
    const toggleBtn = document.getElementById('toggleConnectedDevicesFiltersBtn');

    if (!filterArea || !toggleBtn) {
        return;
    }

    // Default is HIDDEN (user requested "default should be hidden")
    const isVisible = localStorage.getItem('connectedDevicesFiltersVisible') === 'true';

    if (isVisible) {
        filterArea.style.display = 'block';
        toggleBtn.innerHTML = '▲ Hide Filters';
    } else {
        filterArea.style.display = 'none';
        toggleBtn.innerHTML = '▼ Show Filters';
    }
}

// ============================================================================
// REVERSE DNS LOOKUP
// ============================================================================

// Global reverse DNS state and cache
let reverseDnsEnabled = false;
const dnsCache = new Map();  // IP -> hostname cache

/**
 * Toggle reverse DNS lookup feature
 * Saves state to localStorage for persistence
 * Clears DNS cache and triggers Sankey modal refresh if open
 * v1.0.4: Also clears Sankey DNS cache and syncs Applications tab checkbox
 * @param {boolean} enabled - Whether reverse DNS is enabled
 */
function toggleReverseDnsLookup(enabled) {
    reverseDnsEnabled = enabled;
    localStorage.setItem('reverseDnsEnabled', enabled ? 'true' : 'false');
    console.log(`[DNS] Reverse DNS lookup ${enabled ? 'enabled' : 'disabled'}`);

    // Clear DNS cache to force fresh lookups
    dnsCache.clear();
    console.log('[DNS] Connected Devices cache cleared');

    // v1.0.4: Clear Sankey DNS cache
    if (typeof window.clearSankeyDnsCache === 'function') {
        window.clearSankeyDnsCache();
    }

    // v1.0.4: Sync all reverse DNS checkboxes (Connected Devices + Applications)
    const connectedDevicesCheckbox = document.getElementById('enableReverseDnsLookup');
    const applicationsCheckbox = document.getElementById('enableReverseDnsLookupApps');
    if (connectedDevicesCheckbox) connectedDevicesCheckbox.checked = enabled;
    if (applicationsCheckbox) applicationsCheckbox.checked = enabled;

    // If Sankey modal is open, trigger a refresh to apply DNS changes
    if (window.SankeyModal && typeof window.SankeyModal.refresh === 'function') {
        console.log('[DNS] Refreshing open Sankey modal...');
        window.SankeyModal.refresh();
    }
}

/**
 * Restore reverse DNS checkbox state from localStorage
 * Called on page load
 * v1.0.4: Also syncs Applications tab checkbox
 */
function restoreReverseDnsState() {
    // Default: disabled
    reverseDnsEnabled = localStorage.getItem('reverseDnsEnabled') === 'true';

    // v1.0.4: Sync both checkboxes (Connected Devices + Applications)
    const connectedDevicesCheckbox = document.getElementById('enableReverseDnsLookup');
    const applicationsCheckbox = document.getElementById('enableReverseDnsLookupApps');

    if (connectedDevicesCheckbox) connectedDevicesCheckbox.checked = reverseDnsEnabled;
    if (applicationsCheckbox) applicationsCheckbox.checked = reverseDnsEnabled;

    console.log(`[DNS] Restored reverse DNS state: ${reverseDnsEnabled ? 'enabled' : 'disabled'}`);
}

/**
 * Perform reverse DNS lookup for an IP address
 * Uses the hostname data from connected devices (DHCP leases)
 * @param {string} ip - IP address to lookup
 * @returns {string} Hostname or original IP if not found
 */
function performReverseDnsLookup(ip) {
    if (!reverseDnsEnabled) {
        return ip;  // Return IP as-is if DNS is disabled
    }

    // Check cache first
    if (dnsCache.has(ip)) {
        return dnsCache.get(ip);
    }

    // Look up hostname from connected devices data
    const device = allConnectedDevices.find(d => d.ip === ip);
    let hostname = ip;  // Default to IP

    if (device) {
        // Prefer custom name, then hostname, then IP
        if (device.custom_name && device.custom_name.trim() !== '') {
            hostname = device.custom_name;
        } else if (device.hostname && device.hostname !== '-' && device.hostname.trim() !== '') {
            hostname = device.hostname;
        }
        console.log(`[DNS] Resolved ${ip} → ${hostname}`);
    } else {
        console.log(`[DNS] No hostname found for ${ip}, using IP`);
    }

    // Cache the result
    dnsCache.set(ip, hostname);
    return hostname;
}

/**
 * Get the display label for an IP (hostname if DNS enabled, IP otherwise)
 * @param {string} ip - IP address
 * @returns {string} Display label
 */
function getIpDisplayLabel(ip) {
    if (!reverseDnsEnabled) {
        return ip;
    }
    // Perform lookup (will use cache if available)
    return performReverseDnsLookup(ip);
}

/**
 * Check if reverse DNS lookup is enabled
 * @returns {boolean} True if enabled
 */
function isReverseDnsEnabled() {
    return reverseDnsEnabled;
}

// ============================================================================
// EXPORTS TO GLOBAL NAMESPACE
// ============================================================================

// Export state and functions via window.ConnectedDevices namespace
// Use getters to ensure we always return current state (not snapshot at assignment time)
window.ConnectedDevices = {
    // State - Use getters to maintain references
    get allDevices() { return allConnectedDevices; },
    get metadata() { return connectedDevicesMetadata; },
    get sortBy() { return connectedDevicesSortBy; },
    get sortDesc() { return connectedDevicesSortDesc; },
    get metadataCache() { return deviceMetadataCache; },
    get expandedRows() { return expandedRows; },
    get tagsCache() { return allTagsCache; },
    get locationsCache() { return allLocationsCache; },

    // Functions
    loadConnectedDevices: loadConnectedDevices,
    renderTable: renderConnectedDevicesTable,
    sortDevices: sortConnectedDevices,
    toggleExpansion: toggleDeviceRowExpansion,
    toggleFilters: toggleConnectedDevicesFilters,
    restoreFilterState: restoreConnectedDevicesFilterState,
    toggleReverseDns: toggleReverseDnsLookup,
    restoreReverseDnsState: restoreReverseDnsState,
    isReverseDnsEnabled: isReverseDnsEnabled,
    getIpDisplayLabel: getIpDisplayLabel
};

// Export specific functions for inline event handlers in HTML
window.sortConnectedDevices = sortConnectedDevices;
window.toggleDeviceRowExpansion = toggleDeviceRowExpansion;
window.toggleConnectedDevicesFilters = toggleConnectedDevicesFilters;
window.toggleReverseDnsLookup = toggleReverseDnsLookup;
window.loadConnectedDevices = loadConnectedDevices;
