/**
 * Sankey Diagram Module for Traffic Flow Visualization
 *
 * Displays source → destination → application flow relationships
 * with link width representing traffic volume.
 *
 * Browser caching strategy:
 * - localStorage cache with 60-second TTL
 * - Aligns with server-side 60s TTL cache
 * - Zero server load on repeated views within 60s window
 *
 * Dependencies: d3.js, d3-sankey.js
 *
 * Architecture: Database-First Pattern (v2.1.1)
 * - Data collected by clock.py every 60 seconds
 * - Web process queries via /api/device-flows endpoint
 */

// Modal elements (initialized on DOMContentLoaded)
let sankeyModal = null;
let closeSankeyModalBtn = null;
let sankeyDiagram = null;
let sankeyLoading = null;
let sankeyError = null;
let sankeyErrorMessage = null;
let sankeyClientInfo = null;
let sankeyTotalFlows = null;
let sankeyTotalVolume = null;
let sankeyTimeRange = null;
let sankeyFlowLimit = null;  // v1.0.14: Flow limit dropdown

// Current modal state (for refresh functionality)
let currentClientIp = null;
let currentExpectedVolume = null;
let currentFlowData = null;

// Cache TTL in milliseconds (60 seconds to align with server-side cache)
const CACHE_TTL_MS = 60 * 1000;

// Cache for reverse DNS lookups (IP -> hostname)
let reverseDnsCache = {};

// Cache for source IP hostnames from connected devices table (IP -> hostname)
let sourceHostnameCache = {};

/**
 * Load source IP hostnames from connected devices table
 * This provides DHCP hostnames and custom device names for internal IPs
 * @returns {Promise<void>}
 */
async function loadSourceHostnames() {
    try {
        console.log('[SANKEY] Loading source hostnames from connected devices...');
        const response = await fetch('/api/connected-devices');
        if (!response.ok) {
            console.warn('[SANKEY] Failed to load connected devices for hostname lookup');
            return;
        }
        const data = await response.json();
        if (data.status === 'success' && data.devices) {
            sourceHostnameCache = {};
            data.devices.forEach(device => {
                const ip = device.ip;
                // Priority: custom_name > hostname > original_hostname
                const hostname = device.custom_name || device.hostname || device.original_hostname;
                if (ip && hostname && hostname !== ip) {
                    sourceHostnameCache[ip] = hostname;
                }
            });
            console.log(`[SANKEY] Loaded ${Object.keys(sourceHostnameCache).length} source hostnames`);
        }
    } catch (error) {
        console.error('[SANKEY] Error loading source hostnames:', error);
    }
}

/**
 * Get hostname for source IP (from connected devices cache)
 * @param {string} ip - Source IP address
 * @returns {string} Hostname or original IP
 */
function getSourceHostname(ip) {
    const cleanIp = stripSubnet(ip);
    const hostname = sourceHostnameCache[cleanIp];
    return hostname || ip;
}

/**
 * Perform reverse DNS lookup for destination IPs
 * Uses the same API as Applications page (/api/reverse-dns)
 * v1.0.4: Strips subnet notation (/32) before lookup
 * @param {Array} ipAddresses - Array of IP addresses to lookup
 * @returns {Promise<Object>} Map of IP -> hostname
 */
async function performReverseDnsLookup(ipAddresses) {
    if (!ipAddresses || ipAddresses.length === 0) {
        return {};
    }

    // v1.0.4: Strip subnet notation from all IPs
    const cleanIps = ipAddresses.map(ip => stripSubnet(ip));

    // Filter out IPs we already have in cache
    const uncachedIps = cleanIps.filter(ip => !reverseDnsCache[ip]);

    if (uncachedIps.length === 0) {
        console.log('[SANKEY] All IPs found in reverse DNS cache');
        return reverseDnsCache;
    }

    console.log(`[SANKEY] Performing reverse DNS lookup for ${uncachedIps.length} IPs`);

    try {
        // Use window.apiClient if available (same as Applications page)
        let response;
        if (window.apiClient && window.apiClient.post) {
            response = await window.apiClient.post('/api/reverse-dns', {
                ip_addresses: uncachedIps,
                timeout: 2
            });
            if (response.ok && response.data && response.data.status === 'success') {
                // Merge results into cache
                Object.assign(reverseDnsCache, response.data.results);
                console.log(`[SANKEY] Cached ${Object.keys(response.data.results).length} reverse DNS results`);
            }
        } else {
            // Fallback to direct fetch
            response = await fetch('/api/reverse-dns', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
                },
                body: JSON.stringify({
                    ip_addresses: uncachedIps,
                    timeout: 2
                })
            });
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'success') {
                    Object.assign(reverseDnsCache, data.results);
                    console.log(`[SANKEY] Cached ${Object.keys(data.results).length} reverse DNS results`);
                }
            }
        }
    } catch (error) {
        console.error('[SANKEY] Error performing reverse DNS lookup:', error);
    }

    return reverseDnsCache;
}

/**
 * Get hostname for destination IP (from reverse DNS cache)
 * v1.0.4: Strips subnet notation before lookup
 * v1.0.12: Handles both PTR and FreeIPAPI response formats
 * @param {string} ip - IP address (may include /32 subnet notation)
 * @returns {string} Hostname or clean IP (without subnet)
 */
function getHostnameForIp(ip) {
    const cleanIp = stripSubnet(ip);
    const cached = reverseDnsCache[cleanIp];

    if (!cached) {
        return cleanIp;  // Not in cache
    }

    // v1.0.12: Handle object format from API (both PTR and FreeIPAPI)
    let hostname;
    if (typeof cached === 'object' && cached.hostname) {
        hostname = cached.hostname;
    } else if (typeof cached === 'string') {
        hostname = cached;
    } else {
        return cleanIp;
    }

    if (hostname && hostname !== cleanIp) {
        console.log(`[SANKEY] DNS resolved: ${ip} -> ${hostname}`);
        return hostname;
    }
    return cleanIp;  // Return clean IP without /32
}

/**
 * Get enriched data for destination IP (FreeIPAPI only)
 * v1.0.12: Returns geo/ISP info if available
 * @param {string} ip - IP address
 * @returns {Object|null} Enriched data or null
 */
function getEnrichedDataForIp(ip) {
    const cleanIp = stripSubnet(ip);
    const cached = reverseDnsCache[cleanIp];

    if (typeof cached === 'object' && (cached.country || cached.isp)) {
        return cached;
    }
    return null;
}

/**
 * Clear the reverse DNS cache (v1.0.4)
 * Called when user toggles reverse DNS lookup on/off
 * Ensures fresh lookups when re-enabled
 */
function clearSankeyDnsCache() {
    const prevCount = Object.keys(reverseDnsCache).length;
    reverseDnsCache = {};
    console.log(`[SANKEY] Cleared reverse DNS cache (${prevCount} entries)`);
}

// Export clear function for use by toggle handler (v1.0.4)
window.clearSankeyDnsCache = clearSankeyDnsCache;

/**
 * Check if reverse DNS lookup is enabled
 * v1.0.12: Uses global Settings page setting (window.panfmSettings)
 * @returns {boolean} True if enabled
 */
function isReverseDnsEnabled() {
    const enabled = window.panfmSettings?.reverse_dns_enabled || false;
    console.log(`[SANKEY] Reverse DNS enabled (from global settings): ${enabled}`);
    return enabled;
}


/**
 * Strip subnet notation from IP address (e.g., "192.168.1.1/32" -> "192.168.1.1")
 * @param {string} ip - IP address possibly with subnet notation
 * @returns {string} Clean IP address without subnet
 */
function stripSubnet(ip) {
    if (!ip) return ip;
    const slashIndex = ip.indexOf('/');
    return slashIndex > 0 ? ip.substring(0, slashIndex) : ip;
}

/**
 * Initialize modal event handlers
 */
function initSankeyModal() {
    sankeyModal = document.getElementById('sankeyModal');
    closeSankeyModalBtn = document.getElementById('closeSankeyModalBtn');
    sankeyDiagram = document.getElementById('sankeyDiagram');
    sankeyLoading = document.getElementById('sankeyLoading');
    sankeyError = document.getElementById('sankeyError');
    sankeyErrorMessage = document.getElementById('sankeyErrorMessage');
    sankeyClientInfo = document.getElementById('sankeyClientInfo');
    sankeyTotalFlows = document.getElementById('sankeyTotalFlows');
    sankeyTotalVolume = document.getElementById('sankeyTotalVolume');
    sankeyTimeRange = document.getElementById('sankeyTimeRange');
    sankeyFlowLimit = document.getElementById('sankeyFlowLimit');  // v1.0.14

    if (!sankeyModal || !closeSankeyModalBtn) {
        console.error('Sankey modal elements not found');
        return;
    }

    // Close button handler
    closeSankeyModalBtn.addEventListener('click', closeSankeyModal);

    // Close on outside click
    sankeyModal.addEventListener('click', (event) => {
        if (event.target === sankeyModal) {
            closeSankeyModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sankeyModal.style.display === 'flex') {
            closeSankeyModal();
        }
    });

    // v1.0.14: Flow limit dropdown change handler
    if (sankeyFlowLimit) {
        sankeyFlowLimit.addEventListener('change', () => {
            console.log(`[SANKEY] Flow limit changed to: ${sankeyFlowLimit.value}`);
            // Re-render diagram with new limit if we have flow data
            if (currentFlowData && currentFlowData.flows) {
                clearSankeyDiagram();
                renderSankeyDiagram(currentFlowData.flows);
                updateSankeyStats(currentFlowData, currentExpectedVolume);
            }
        });
    }
}

/**
 * Open Sankey diagram modal for a specific client IP
 * @param {string} clientIp - Client IP address
 * @param {number} expectedTotalVolume - Total volume from client_bandwidth table (bytes)
 */
async function openSankeyDiagram(clientIp, expectedTotalVolume = null) {
    if (!sankeyModal) {
        console.error('Sankey modal not initialized');
        return;
    }

    // Get current device ID from settings
    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
        showSankeyError('No device selected. Please select a device first.');
        return;
    }

    // Store current state for refresh functionality
    currentClientIp = clientIp;
    currentExpectedVolume = expectedTotalVolume;

    // Show modal
    sankeyModal.style.display = 'flex';

    // Update client info
    if (sankeyClientInfo) {
        sankeyClientInfo.innerHTML = `Source: <span style="font-weight: 600; color: #FA582D;">${escapeHtml(clientIp)}</span>`;
    }

    // Reset states
    showSankeyLoading();
    hideSankeyError();
    clearSankeyDiagram();

    // Fetch and render data
    try {
        const flowData = await fetchTrafficFlows(deviceId, clientIp);
        currentFlowData = flowData;  // Store for refresh

        if (!flowData || !flowData.flows || flowData.flows.length === 0) {
            showSankeyError('No traffic flow data available for this client in the last 60 minutes.');
            hideSankeyLoading();
            return;
        }

        // Debug: Log actual API response
        console.log('[SANKEY DEBUG] API Response:', flowData);
        console.log('[SANKEY DEBUG] First flow:', flowData.flows[0]);
        console.log('[SANKEY DEBUG] Expected total volume (from client_bandwidth):', expectedTotalVolume);

        // v1.0.4: Always load source hostnames from connected devices (for internal IP resolution)
        await loadSourceHostnames();

        // v1.0.4: Update header with source hostname if available
        const sourceHostname = getSourceHostname(clientIp);
        if (sankeyClientInfo) {
            if (sourceHostname !== clientIp && sourceHostname !== stripSubnet(clientIp)) {
                sankeyClientInfo.innerHTML = `Source: <span style="font-weight: 600; color: #FA582D;">${escapeHtml(sourceHostname)}</span> <span style="color: #999; font-size: 0.9em;">(${escapeHtml(stripSubnet(clientIp))})</span>`;
            } else {
                sankeyClientInfo.innerHTML = `Source: <span style="font-weight: 600; color: #FA582D;">${escapeHtml(stripSubnet(clientIp))}</span>`;
            }
        }

        // Perform reverse DNS lookup for destination IPs only if enabled
        const dnsEnabled = isReverseDnsEnabled();
        if (dnsEnabled) {
            console.log('[SANKEY] Reverse DNS enabled, looking up destination IPs...');
            // v1.0.4: Extract dest IPs and strip /32 subnet notation
            const destIps = [...new Set(flowData.flows.map(f => stripSubnet(f.dest_ip)).filter(Boolean))];
            console.log('[SANKEY] Destination IPs to lookup:', destIps);
            await performReverseDnsLookup(destIps);
            console.log('[SANKEY] DNS cache after lookup:', reverseDnsCache);
        } else {
            console.log('[SANKEY] Reverse DNS disabled, skipping lookup');
        }

        // Update summary stats (pass expectedTotalVolume to display correct value)
        updateSankeyStats(flowData, expectedTotalVolume);

        // CRITICAL FIX: Hide loading spinner BEFORE rendering diagram
        // The loading spinner may be hiding the diagram container
        hideSankeyLoading();

        // Defer diagram rendering to ensure modal is fully displayed
        // Using setTimeout to ensure the browser has fully rendered the modal and computed styles
        console.log('[SANKEY] Waiting for modal to fully render before creating diagram...');
        setTimeout(() => {
            // Now the modal container should have non-zero dimensions
            console.log('[SANKEY] Modal should now be fully rendered, attempting to create diagram');
            renderSankeyDiagram(flowData.flows);
        }, 100);  // 100ms delay to ensure modal layout is complete
    } catch (error) {
        console.error('Error loading Sankey diagram:', error);
        showSankeyError(`Failed to load traffic flow data: ${error.message}`);
        hideSankeyLoading();
    }
}

/**
 * Close Sankey diagram modal
 */
function closeSankeyModal() {
    if (sankeyModal) {
        sankeyModal.style.display = 'none';
    }
    clearSankeyDiagram();
}

/**
 * Fetch traffic flows from API with browser localStorage cache
 * @param {string} deviceId - Device ID
 * @param {string} clientIp - Client IP address
 * @returns {Promise<Object>} Flow data with flows array
 */
async function fetchTrafficFlows(deviceId, clientIp) {
    const cacheKey = `sankey_${deviceId}_${clientIp}`;

    // Check localStorage cache
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const cachedData = JSON.parse(cached);
            const now = Date.now();

            // Check if cache is still valid (within TTL)
            if (cachedData.timestamp && (now - cachedData.timestamp) < CACHE_TTL_MS) {
                console.log(`Using cached Sankey data for ${clientIp} (age: ${Math.round((now - cachedData.timestamp) / 1000)}s)`);
                return cachedData.data;
            } else {
                console.log(`Cache expired for ${clientIp}, fetching fresh data`);
                localStorage.removeItem(cacheKey);
            }
        } catch (error) {
            console.warn('Failed to parse cached Sankey data:', error);
            localStorage.removeItem(cacheKey);
        }
    }

    // Fetch from API
    const response = await fetch(`/api/device-flows/${deviceId}/${encodeURIComponent(clientIp)}`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Store in localStorage cache with timestamp
    try {
        const cacheData = {
            timestamp: Date.now(),
            data: data
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        console.log(`Cached Sankey data for ${clientIp} (60s TTL)`);
    } catch (error) {
        console.warn('Failed to cache Sankey data:', error);
        // Continue without caching (quota exceeded or other storage error)
    }

    return data;
}

/**
 * Update summary statistics in modal
 * @param {Object} flowData - Flow data object
 * @param {number|null} expectedTotalVolume - Expected total volume from client_bandwidth (bytes)
 */
function updateSankeyStats(flowData, expectedTotalVolume = null) {
    const totalFlowCount = (flowData.flows || []).length;
    // v1.0.14: Get flow limit from dropdown (default 50)
    const flowLimit = sankeyFlowLimit ? parseInt(sankeyFlowLimit.value, 10) : 50;
    const displayedFlowCount = Math.min(totalFlowCount, flowLimit);

    if (sankeyTotalFlows) {
        if (totalFlowCount > flowLimit) {
            sankeyTotalFlows.innerHTML = `<span style="font-size: 0.9em;">Top ${displayedFlowCount} of ${totalFlowCount.toLocaleString()}</span>`;
        } else {
            sankeyTotalFlows.textContent = totalFlowCount.toLocaleString();
        }
    }

    if (sankeyTotalVolume) {
        // Use expectedTotalVolume if provided (from client_bandwidth table - matches Connected Devices table)
        // Otherwise fall back to summing flows from traffic_flows table
        let totalBytes;
        if (expectedTotalVolume !== null && expectedTotalVolume !== undefined) {
            totalBytes = expectedTotalVolume;
            console.log('[SANKEY] Using expected total volume from client_bandwidth:', totalBytes);
        } else {
            totalBytes = (flowData.flows || []).reduce((sum, flow) => {
                return sum + (flow.bytes || 0);
            }, 0);
            console.log('[SANKEY] Calculated total volume from traffic_flows:', totalBytes);
        }
        sankeyTotalVolume.textContent = formatBytesHuman(totalBytes);
    }

    if (sankeyTimeRange) {
        sankeyTimeRange.textContent = '60 min';
    }
}

/**
 * Render Sankey diagram using d3-sankey
 * @param {Array} flows - Array of flow objects
 */
function renderSankeyDiagram(flows) {
    if (!sankeyDiagram) return;

    // Clear previous diagram
    clearSankeyDiagram();

    // v1.0.14: Get flow limit from dropdown (default 50)
    const flowLimit = sankeyFlowLimit ? parseInt(sankeyFlowLimit.value, 10) : 50;

    // Limit to top N flows by bytes to prevent layout issues with too many nodes
    const originalFlowCount = flows.length;
    flows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    const limitedFlows = flows.slice(0, flowLimit);
    const totalOriginalBytes = flows.reduce((sum, f) => sum + (f.bytes || 0), 0);
    const totalLimitedBytes = limitedFlows.reduce((sum, f) => sum + (f.bytes || 0), 0);
    const percentageRepresented = totalOriginalBytes > 0
        ? ((totalLimitedBytes / totalOriginalBytes) * 100).toFixed(1)
        : 100;

    console.log(`[SANKEY] Showing top ${flowLimit} of ${originalFlowCount} flows (${percentageRepresented}% of traffic)`);
    flows = limitedFlows;

    // Check if d3 and d3.sankey are available
    if (typeof d3 === 'undefined') {
        console.error('[SANKEY] D3.js library not loaded');
        showSankeyError('D3.js library not loaded. Please refresh the page.');
        return;
    }
    console.log('[SANKEY] D3.js loaded successfully');

    if (typeof d3.sankey === 'undefined') {
        console.error('[SANKEY] d3-sankey library not loaded');
        showSankeyError('d3-sankey library not loaded. Please refresh the page.');
        return;
    }
    console.log('[SANKEY] d3-sankey loaded successfully');

    // Build nodes and links for Sankey diagram
    console.log('[SANKEY] Building Sankey data from flows...');
    const { nodes, links } = buildSankeyData(flows);
    console.log(`[SANKEY] Built ${nodes.length} nodes and ${links.length} links`);

    if (nodes.length === 0 || links.length === 0) {
        console.error('[SANKEY] No nodes or links to visualize');
        showSankeyError('No flow data to visualize.');
        return;
    }

    // Diagram dimensions
    const container = sankeyDiagram;

    // Debug: Check container properties
    console.log('[SANKEY] Container element:', container);
    console.log('[SANKEY] Container offsetParent:', container.offsetParent);
    console.log('[SANKEY] Container display style:', window.getComputedStyle(container).display);
    console.log('[SANKEY] Container width style:', window.getComputedStyle(container).width);
    console.log('[SANKEY] Container height style:', window.getComputedStyle(container).height);

    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 10, right: 10, bottom: 10, left: 10 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    console.log(`[SANKEY] Container dimensions: ${width}x${height}, Chart: ${chartWidth}x${chartHeight}`);

    // Create SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create Sankey layout
    const sankey = d3.sankey()
        .nodeWidth(20)  // Increased from 15 to 20 for better proportions
        .nodePadding(3)  // Reduced from 5 to 3 for maximum vertical space
        .extent([[1, 1], [chartWidth - 1, chartHeight - 5]]);

    // Generate Sankey data
    console.log('[SANKEY] Computing Sankey layout...');
    const { nodes: sankeyNodes, links: sankeyLinks } = sankey({
        nodes: nodes.map(d => Object.assign({}, d)),
        links: links.map(d => Object.assign({}, d))
    });
    console.log(`[SANKEY] Layout computed: ${sankeyNodes.length} nodes, ${sankeyLinks.length} links`);

    // Color scale for nodes - PANfm brand theme
    const colorScale = d3.scaleOrdinal()
        .domain(['source', 'application', 'destination'])
        .range([
            '#FA582D',  // Source: PANfm brand orange
            '#666666',  // Application: Professional dark gray
            '#999999'   // Destination: Medium gray
        ]);

    // Draw links
    svg.append('g')
        .selectAll('path')
        .data(sankeyLinks)
        .enter()
        .append('path')
        .attr('d', d3.sankeyLinkHorizontal())
        .attr('stroke-width', d => Math.max(0.5, d.width))  // Prevent zero/negative widths
        .attr('fill', 'none')
        .attr('stroke', d => {
            // Gradient from source to target color
            return colorScale(d.source.type);
        })
        .attr('opacity', 0.4)
        .on('mouseover', function() {
            d3.select(this).attr('opacity', 0.7);
        })
        .on('mouseout', function() {
            d3.select(this).attr('opacity', 0.4);
        })
        .append('title')
        .text(d => {
            const apps = d.applications || ['Unknown'];
            const appList = apps.length > 3
                ? apps.slice(0, 3).join(', ') + ` (+${apps.length - 3} more)`
                : apps.join(', ');
            return `${d.source.name} → ${d.target.name}\nApplications: ${appList}\n${formatBytesHuman(d.value)}`;
        });

    // Draw nodes
    const node = svg.append('g')
        .selectAll('rect')
        .data(sankeyNodes)
        .enter()
        .append('g');

    node.append('rect')
        .attr('x', d => d.x0)
        .attr('y', d => d.y0)
        .attr('height', d => Math.max(1, d.y1 - d.y0))  // Defensive check to prevent negative heights
        .attr('width', d => d.x1 - d.x0)
        .attr('fill', d => colorScale(d.type))
        .attr('opacity', 0.8)
        .on('mouseover', function() {
            d3.select(this).attr('opacity', 1);
        })
        .on('mouseout', function() {
            d3.select(this).attr('opacity', 0.8);
        })
        .append('title')
        .text(d => `${d.name}\n${formatBytesHuman(d.value)}`);

    // Add labels - primary name (hostname or IP)
    node.append('text')
        .attr('x', d => d.x0 < chartWidth / 2 ? d.x1 + 6 : d.x0 - 6)
        .attr('y', d => d.originalIp ? (d.y1 + d.y0) / 2 - 6 : (d.y1 + d.y0) / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', d => d.x0 < chartWidth / 2 ? 'start' : 'end')
        .text(d => d.name)
        .style('font-family', 'var(--font-secondary)')
        .style('font-size', '12px')
        .style('fill', '#F2F0EF')  // Dark theme text color
        .style('font-weight', '500');

    // v1.0.14: Add secondary label for IP address underneath hostname (destination nodes only)
    node.filter(d => d.originalIp)
        .append('text')
        .attr('x', d => d.x0 < chartWidth / 2 ? d.x1 + 6 : d.x0 - 6)
        .attr('y', d => (d.y1 + d.y0) / 2 + 6)
        .attr('dy', '0.35em')
        .attr('text-anchor', d => d.x0 < chartWidth / 2 ? 'start' : 'end')
        .text(d => d.originalIp)
        .style('font-family', 'var(--font-secondary)')
        .style('font-size', '10px')
        .style('fill', '#888888')  // Dimmer color for IP
        .style('font-weight', '400');
}

/**
 * Build nodes and links for Sankey diagram from flow data
 * @param {Array} flows - Array of flow objects
 * @returns {Object} Object with nodes and links arrays
 */
function buildSankeyData(flows) {
    const nodes = [];
    const links = [];
    const nodeMap = new Map();

    // Helper to get or create node
    // v1.0.14: Added originalIp field to track IP when hostname is resolved
    function getOrCreateNode(name, type, originalIp = null) {
        const key = `${type}_${name}`;
        if (!nodeMap.has(key)) {
            const node = { name, type, originalIp };
            nodeMap.set(key, nodes.length);
            nodes.push(node);
        }
        return nodeMap.get(key);
    }

    // Use 3-layer Sankey: source → application → destination
    const dnsEnabled = isReverseDnsEnabled();

    flows.forEach(flow => {
        const sourceIp = flow.source_ip || 'unknown';
        const destIp = flow.dest_ip || 'unknown';
        const destPort = flow.dest_port || '';
        const application = flow.application || 'unknown';
        const bytes = flow.bytes || 0;

        // Skip flows with zero bytes
        if (bytes === 0) return;

        // v1.0.4: Use source hostname from connected devices table if available
        const sourceLabel = getSourceHostname(sourceIp);
        const cleanDestIp = stripSubnet(destIp);
        const destHostname = dnsEnabled ? getHostnameForIp(destIp) : cleanDestIp;

        // Create destination label with port (e.g., "192.168.1.100:443" or "hostname.com:443")
        const destLabel = destPort ? `${destHostname}:${destPort}` : destHostname;

        // v1.0.14: Track original IP for destination nodes when DNS resolved
        // This allows showing IP underneath hostname in the diagram
        const destOriginalIp = (dnsEnabled && destHostname !== cleanDestIp)
            ? (destPort ? `${cleanDestIp}:${destPort}` : cleanDestIp)
            : null;

        // Get or create nodes for all three layers
        const sourceIdx = getOrCreateNode(sourceLabel, 'source');
        const appIdx = getOrCreateNode(application, 'application');
        const destIdx = getOrCreateNode(destLabel, 'destination', destOriginalIp);

        // Create two links: source → application, application → destination
        links.push({
            source: sourceIdx,
            target: appIdx,
            value: bytes
        });

        links.push({
            source: appIdx,
            target: destIdx,
            value: bytes
        });
    });

    return { nodes, links };
}

/**
 * Show loading state
 */
function showSankeyLoading() {
    if (sankeyLoading) sankeyLoading.style.display = 'block';
    if (sankeyDiagram) sankeyDiagram.style.display = 'none';
}

/**
 * Hide loading state
 */
function hideSankeyLoading() {
    if (sankeyLoading) sankeyLoading.style.display = 'none';
    if (sankeyDiagram) sankeyDiagram.style.display = 'block';
}

/**
 * Show error state
 * @param {string} message - Error message
 */
function showSankeyError(message) {
    if (sankeyError) {
        sankeyError.style.display = 'block';
        if (sankeyErrorMessage) {
            sankeyErrorMessage.textContent = message;
        }
    }
}

/**
 * Hide error state
 */
function hideSankeyError() {
    if (sankeyError) {
        sankeyError.style.display = 'none';
    }
}

/**
 * Clear Sankey diagram
 */
function clearSankeyDiagram() {
    if (sankeyDiagram) {
        sankeyDiagram.innerHTML = '';
    }
}

/**
 * Get selected device ID from device selector
 * @returns {string|null} Device ID or null
 */
function getSelectedDeviceId() {
    // Get from device selector dropdown (most reliable source)
    const deviceSelector = document.getElementById('deviceSelector');
    if (deviceSelector && deviceSelector.value) {
        return deviceSelector.value;
    }

    console.warn('No device selected in device selector');
    return null;
}

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Bytes
 * @returns {string} Formatted string (e.g., "1.23 GB")
 */
function formatBytesHuman(bytes) {
    if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const k = 1024;
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const value = bytes / Math.pow(k, i);

    // Format with appropriate decimal places
    const formatted = i === 0 ? value.toFixed(0) : value.toFixed(2);

    return `${formatted} ${units[i]}`;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Refresh the currently open Sankey diagram
 * Used when reverse DNS setting is toggled
 */
function refreshSankeyDiagram() {
    if (!sankeyModal || sankeyModal.style.display !== 'flex') {
        console.log('[SANKEY] No modal open, skipping refresh');
        return;
    }

    if (!currentFlowData || !currentFlowData.flows) {
        console.log('[SANKEY] No flow data available, skipping refresh');
        return;
    }

    console.log('[SANKEY] Refreshing diagram with current flow data...');

    // Clear and re-render with current flow data
    clearSankeyDiagram();
    renderSankeyDiagram(currentFlowData.flows);
    hideSankeyLoading();
}

// Export functions to global scope for inline onclick handlers
window.openSankeyDiagram = openSankeyDiagram;
window.closeSankeyModal = closeSankeyModal;

// Export refresh function via SankeyModal namespace for DNS toggle
window.SankeyModal = {
    refresh: refreshSankeyDiagram
};

// Initialize modal when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initSankeyModal();
    console.log('Sankey diagram module initialized');
});
