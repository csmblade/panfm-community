/**
 * PANfm - Chord Diagram Module
 * Client-to-Destination Traffic Visualization
 *
 * Extracted from app.js for file size reduction (v1.0.15)
 * Contains all chord diagram rendering, filtering, and tag-based visualization
 */

console.log('[APP-CHORD.JS] ===== MODULE LOADING STARTED =====');

// ===================================================================================
// Chord Diagram Functions - Client-to-Destination Traffic Visualization
// ===================================================================================

// Cache for traffic data (so we can re-filter without re-fetching)
let cachedInternetTrafficData = null;
let cachedInternalTrafficData = null;

// v1.0.12: Cache for chord DNS lookups (shared with window for external access)
let chordDnsCache = window.reverseDnsCache || {};

/**
 * Check if an IP address is private (RFC 1918)
 * v1.0.12: Used to filter IPs for DNS lookup (only public IPs)
 * @param {string} ip - IP address to check
 * @returns {boolean} True if private
 */
function isPrivateIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    const parts = ip.split('.').map(p => parseInt(p));
    if (parts.length !== 4) return false;

    // 10.0.0.0/8
    if (parts[0] === 10) return true;

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 127.0.0.0/8 (localhost)
    if (parts[0] === 127) return true;

    return false;
}

/**
 * Perform DNS lookup for public IPs in chord diagram data
 * v1.0.12: Only looks up public IPs to reduce API calls
 * @param {Array} nodes - Array of IP addresses
 * @returns {Promise<Object>} Map of IP -> hostname
 */
async function performChordDnsLookup(nodes) {
    if (!nodes || nodes.length === 0) return {};

    // Filter to only public IPs not in cache
    const publicIps = nodes.filter(ip => !isPrivateIP(ip) && !chordDnsCache[ip]);

    if (publicIps.length === 0) {
        console.log('[CHORD] All IPs are cached or private');
        return chordDnsCache;
    }

    console.log(`[CHORD] DNS lookup for ${publicIps.length} public IPs`);

    try {
        const response = await window.apiClient.post('/api/reverse-dns', {
            ip_addresses: publicIps,
            timeout: 2
        });

        if (response.ok && response.data?.status === 'success') {
            Object.assign(chordDnsCache, response.data.results);
            console.log(`[CHORD] Cached ${Object.keys(response.data.results).length} DNS results`);
        }
    } catch (error) {
        console.error('[CHORD] DNS lookup error:', error);
    }

    return chordDnsCache;
}

/**
 * Get display label for chord diagram node
 * v1.0.12: Returns hostname for public IPs if available
 * @param {string} ip - IP address
 * @returns {string} Hostname or IP
 */
function getChordNodeLabel(ip) {
    if (isPrivateIP(ip)) return ip;  // Keep private IPs as-is

    const hostname = chordDnsCache[ip];
    if (hostname && hostname !== ip) {
        return hostname;
    }
    return ip;
}

/**
 * Load internal traffic filter preferences from settings
 */
async function loadInternalTrafficFilters() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            const filters = settings.internal_traffic_filters || {rfc1918: true, all: false};

            const rfc1918El = document.getElementById('filterRfc1918');
            const allEl = document.getElementById('filterAllInternal');

            if (rfc1918El) rfc1918El.checked = filters.rfc1918;
            if (allEl) allEl.checked = filters.all;

            console.log('[CHORD] Loaded internal traffic filters:', filters);
        }
    } catch (error) {
        console.error('[CHORD] Error loading internal filter preferences:', error);
    }
}

/**
 * Save internal traffic filter preferences to settings
 */
async function saveInternalTrafficFilters() {
    const filters = {
        rfc1918: document.getElementById('filterRfc1918')?.checked ?? true,
        all: document.getElementById('filterAllInternal')?.checked ?? false
    };

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        // Get current settings first
        const settingsResponse = await fetch('/api/settings');
        const currentSettings = settingsResponse.ok ? await settingsResponse.json() : {};

        // Update with new filter values
        currentSettings.internal_traffic_filters = filters;

        // Save back
        await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify(currentSettings)
        });

        console.log('[CHORD] Saved internal traffic filters:', filters);
    } catch (error) {
        console.error('[CHORD] Error saving internal filter preferences:', error);
    }
}

/**
 * Handle internal traffic filter checkbox change
 */
function onInternalFilterChange() {
    // Save preferences
    saveInternalTrafficFilters();

    // Re-render with cached data if available
    if (cachedInternalTrafficData) {
        renderFilteredInternalTraffic(cachedInternalTrafficData);
    }
}

/**
 * Get filtered internal flows based on checkbox selections
 */
function getFilteredInternalFlows(internalData) {
    const combined = {nodes: [], flows: []};

    const showRfc1918 = document.getElementById('filterRfc1918')?.checked ?? true;
    const showAll = document.getElementById('filterAllInternal')?.checked ?? false;

    if (showRfc1918 && internalData.rfc1918) {
        mergeFlowData(combined, internalData.rfc1918);
    }
    if (showAll && internalData.all) {
        mergeFlowData(combined, internalData.all);
    }

    // Sort nodes for consistent ordering
    combined.nodes.sort();

    // Sort flows by value descending
    combined.flows.sort((a, b) => b.value - a.value);

    return combined;
}

/**
 * Render filtered internal traffic diagram
 */
function renderFilteredInternalTraffic(internalData) {
    const filteredData = getFilteredInternalFlows(internalData);

    // Update flow count
    const internalCount = document.getElementById('chordInternalCount');
    if (internalCount) {
        internalCount.textContent = `${filteredData.flows.length} flows`;
    }

    // Render the filtered chord diagram
    renderChordDiagram('chordInternalSvg', filteredData, 'internal');
}

/**
 * Load internet traffic filter preferences from settings
 */
async function loadInternetTrafficFilters() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            const filters = settings.internet_traffic_filters || {outbound: true, inbound: true, transit: false};

            const outboundEl = document.getElementById('filterOutbound');
            const inboundEl = document.getElementById('filterInbound');
            const transitEl = document.getElementById('filterTransit');

            if (outboundEl) outboundEl.checked = filters.outbound;
            if (inboundEl) inboundEl.checked = filters.inbound;
            if (transitEl) transitEl.checked = filters.transit;

            console.log('[CHORD] Loaded internet traffic filters:', filters);
        }
    } catch (error) {
        console.error('[CHORD] Error loading filter preferences:', error);
    }
}

/**
 * Save internet traffic filter preferences to settings
 */
async function saveInternetTrafficFilters() {
    const filters = {
        outbound: document.getElementById('filterOutbound')?.checked ?? true,
        inbound: document.getElementById('filterInbound')?.checked ?? true,
        transit: document.getElementById('filterTransit')?.checked ?? false
    };

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        // Get current settings first
        const settingsResponse = await fetch('/api/settings');
        const currentSettings = settingsResponse.ok ? await settingsResponse.json() : {};

        // Update with new filter values
        currentSettings.internet_traffic_filters = filters;

        // Save back
        await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify(currentSettings)
        });

        console.log('[CHORD] Saved internet traffic filters:', filters);
    } catch (error) {
        console.error('[CHORD] Error saving filter preferences:', error);
    }
}

/**
 * Handle internet traffic filter checkbox change
 */
function onInternetFilterChange() {
    // Save preferences
    saveInternetTrafficFilters();

    // Re-render with cached data if available
    if (cachedInternetTrafficData) {
        renderFilteredInternetTraffic(cachedInternetTrafficData);
    }
}

/**
 * Merge flow data from multiple sources into combined data
 */
function mergeFlowData(combined, source) {
    if (!source || !source.flows) return;

    // Add unique nodes
    source.nodes.forEach(node => {
        if (!combined.nodes.includes(node)) {
            combined.nodes.push(node);
        }
    });

    // Add all flows
    combined.flows.push(...source.flows);
}

/**
 * Get filtered internet flows based on checkbox selections
 */
function getFilteredInternetFlows(internetData) {
    const combined = {nodes: [], flows: []};

    const showOutbound = document.getElementById('filterOutbound')?.checked ?? true;
    const showInbound = document.getElementById('filterInbound')?.checked ?? true;
    const showTransit = document.getElementById('filterTransit')?.checked ?? false;

    if (showOutbound && internetData.outbound) {
        mergeFlowData(combined, internetData.outbound);
    }
    if (showInbound && internetData.inbound) {
        mergeFlowData(combined, internetData.inbound);
    }
    if (showTransit && internetData.transit) {
        mergeFlowData(combined, internetData.transit);
    }

    // Sort nodes for consistent ordering
    combined.nodes.sort();

    // Sort flows by value descending
    combined.flows.sort((a, b) => b.value - a.value);

    return combined;
}

/**
 * Render filtered internet traffic diagram
 * v1.0.12: Now async to support DNS lookup for public IPs
 */
async function renderFilteredInternetTraffic(internetData) {
    const filteredData = getFilteredInternetFlows(internetData);

    // Update flow count
    const internetCount = document.getElementById('chordInternetCount');
    if (internetCount) {
        internetCount.textContent = `${filteredData.flows.length} flows`;
    }

    // v1.0.12: Perform DNS lookup for public IPs if enabled
    if (window.panfmSettings?.reverse_dns_enabled && filteredData.nodes?.length > 0) {
        await performChordDnsLookup(filteredData.nodes);
    }

    // Render the filtered chord diagram
    renderChordDiagram('chordInternetSvg', filteredData, 'internet');
}

/**
 * Fetch and render chord diagrams for client-destination traffic flows
 * Displays two separate diagrams: Internal traffic and Internet traffic
 */
async function loadChordDiagrams() {
    console.log('[CHORD] Loading chord diagrams for client-destination traffic flow');

    try {
        // Load both filter preferences first
        await loadInternalTrafficFilters();
        await loadInternetTrafficFilters();

        // Get CSRF token from meta tag
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        // v1.0.6: Pass device_id to ensure correct device data
        const chordUrl = buildDeviceUrl('/api/client-destination-flow');
        const response = await fetch(chordUrl, {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.status === 'success') {
            // Cache both datasets for re-filtering without API calls
            cachedInternalTrafficData = data.internal;
            cachedInternetTrafficData = data.internet;

            console.log('[CHORD] Flow data received:', {
                rfc1918_flows: data.internal.rfc1918?.flows?.length || 0,
                all_flows: data.internal.all?.flows?.length || 0,
                outbound_flows: data.internet.outbound?.flows?.length || 0,
                inbound_flows: data.internet.inbound?.flows?.length || 0,
                transit_flows: data.internet.transit?.flows?.length || 0
            });

            // Render filtered internal traffic diagram
            renderFilteredInternalTraffic(data.internal);

            // Render filtered internet traffic diagram
            renderFilteredInternetTraffic(data.internet);
        } else {
            console.error('[CHORD] API returned error status:', data.message);
            showChordError('chordInternalLoading', 'No internal flow data');
            showChordError('chordInternetLoading', 'No internet flow data');
        }
    } catch (error) {
        console.error('[CHORD] Error loading chord diagrams:', error);
        showChordError('chordInternalLoading', 'Error loading data');
        showChordError('chordInternetLoading', 'Error loading data');
    }
}

/**
 * Render a chord diagram using D3.js
 * @param {string} svgId - ID of SVG element to render into
 * @param {object} data - Flow data with nodes and flows arrays
 * @param {string} type - Type of diagram ('internal' or 'internet')
 */
function renderChordDiagram(svgId, data, type) {
    // FIX #2: Add D3.js availability check at function entry
    if (typeof d3 === 'undefined') {
        console.warn('[CHORD] D3.js library not available, cannot render diagram');
        const loadingId = svgId.replace('Svg', 'Loading');
        const loadingElement = document.getElementById(loadingId);
        if (loadingElement) {
            loadingElement.textContent = 'D3.js not loaded';
            loadingElement.style.color = 'rgba(255,100,100,0.7)';
        }
        return;
    }

    const svg = d3.select(`#${svgId}`);
    const container = svg.node().parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear existing content
    svg.selectAll('*').remove();

    // Hide loading message
    const loadingId = svgId.replace('Svg', 'Loading');
    document.getElementById(loadingId).style.display = 'none';

    // Check if we have data
    if (!data.nodes || data.nodes.length === 0 || !data.flows || data.flows.length === 0) {
        console.log(`[CHORD] No ${type} flow data to display`);
        showChordMessage(svg, width, height, 'No traffic flows');
        return;
    }

    console.log(`[CHORD] Rendering ${type} chord diagram with ${data.nodes.length} nodes and ${data.flows.length} flows`);

    // Create matrix for chord diagram
    const nodeIndex = {};
    data.nodes.forEach((node, i) => {
        nodeIndex[node] = i;
    });

    // Initialize matrix (nodes x nodes)
    const matrix = Array(data.nodes.length).fill(0).map(() => Array(data.nodes.length).fill(0));

    // Fill matrix with flow values
    data.flows.forEach(flow => {
        const sourceIdx = nodeIndex[flow.source];
        const targetIdx = nodeIndex[flow.target];
        if (sourceIdx !== undefined && targetIdx !== undefined) {
            matrix[sourceIdx][targetIdx] += flow.value;
        }
    });

    // Calculate outer and inner radius - reduced to 0.32 to leave room for IP labels
    const outerRadius = Math.min(width, height) * 0.32;
    const innerRadius = Math.max(outerRadius - 35, 10); // Ensure innerRadius is at least 10px

    // Safety check: ensure minimum dimensions for chord diagram
    if (outerRadius < 50) {
        console.warn(`[CHORD] Container too small for ${type} chord diagram (outer radius: ${outerRadius}px)`);
        showChordMessage(svg, width, height, 'Container too small');
        return;
    }

    // Create chord layout
    const chord = d3.chord()
        .padAngle(0.05)
        .sortSubgroups(d3.descending);

    const arc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);

    const ribbon = d3.ribbon()
        .radius(innerRadius);

    // Color scale - different themes for each diagram type
    let colorScheme;
    if (type === 'internal') {
        // Orange/warm theme for internal traffic
        colorScheme = ['#FA582D', '#FF7F50', '#FFA07A', '#FF6347', '#FF8C00', '#FFD700', '#FFA500', '#FF4500'];
    } else if (type === 'tag_filter') {
        // Purple/blue theme for tagged traffic
        colorScheme = ['#9C27B0', '#AB47BC', '#BA68C8', '#CE93D8', '#7B1FA2', '#8E24AA', '#9C27B0', '#AA00FF'];
    } else {
        // Green/cool theme for internet traffic (fallback)
        colorScheme = ['#4CAF50', '#66BB6A', '#81C784', '#A5D6A7', '#26A69A', '#00ACC1', '#00BCD4', '#0097A7'];
    }

    const color = d3.scaleOrdinal()
        .domain(d3.range(data.nodes.length))
        .range(colorScheme);

    // Direction-based colors for internet traffic flows
    const directionColors = {
        'outbound': '#4CAF50',  // Green - Private → Public
        'inbound': '#2196F3',   // Blue - Public → Private
        'transit': '#9C27B0',   // Purple - Public → Public
        'internal': '#FA582D'   // Orange - Private → Private (fallback)
    };

    // Build a lookup map for flow directions: "source->target" -> direction
    const flowDirectionMap = {};
    if (data.flows) {
        data.flows.forEach(flow => {
            if (flow.direction) {
                const key = `${flow.source}->${flow.target}`;
                flowDirectionMap[key] = flow.direction;
            }
        });
    }

    // Function to get ribbon color based on flow direction (for internet traffic)
    const getRibbonColor = (sourceIdx, targetIdx) => {
        if (type !== 'internet') {
            return color(sourceIdx);  // Use standard color scheme for non-internet diagrams
        }
        const sourceNode = data.nodes[sourceIdx];
        const targetNode = data.nodes[targetIdx];
        const key = `${sourceNode}->${targetNode}`;
        const direction = flowDirectionMap[key];
        return directionColors[direction] || color(sourceIdx);
    };

    // Create SVG group centered
    const g = svg.append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

    // Generate chords
    const chords = chord(matrix);

    // Draw the ribbons (flows)
    const ribbons = g.append('g')
        .selectAll('path')
        .data(chords)
        .join('path')
        .attr('d', ribbon)
        .style('fill', d => getRibbonColor(d.source.index, d.target.index))
        .style('opacity', 0.7)
        .style('stroke', 'none')
        .on('mouseover', function(event, d) {
            // Highlight ribbon on hover
            d3.select(this)
                .style('opacity', 1)
                .style('stroke', '#fff')
                .style('stroke-width', 2);

            // Show tooltip
            const sourceNode = data.nodes[d.source.index];
            const targetNode = data.nodes[d.target.index];
            const value = matrix[d.source.index][d.target.index];
            const valueText = formatBytes(value);

            // Get direction label for internet traffic
            let directionLabel = '';
            if (type === 'internet') {
                const key = `${sourceNode}->${targetNode}`;
                const direction = flowDirectionMap[key];
                if (direction) {
                    const directionLabels = {
                        'outbound': '<span style="color: #4CAF50;">Outbound</span> (Private→Public)',
                        'inbound': '<span style="color: #2196F3;">Inbound</span> (Public→Private)',
                        'transit': '<span style="color: #9C27B0;">Transit</span> (Public→Public)'
                    };
                    directionLabel = `<br/><em>${directionLabels[direction] || direction}</em>`;
                }
            }

            tooltip.style('opacity', 1)
                .html(`<strong>${sourceNode}</strong> → <strong>${targetNode}</strong><br/>${valueText}${directionLabel}`)
                .style('left', `${event.pageX + 10}px`)
                .style('top', `${event.pageY - 28}px`);
        })
        .on('mouseout', function(event, d) {
            d3.select(this)
                .style('opacity', 0.7)
                .style('stroke', 'none');

            tooltip.style('opacity', 0);
        });

    // Draw the arcs (nodes)
    const groups = g.append('g')
        .selectAll('g')
        .data(chords.groups)
        .join('g');

    groups.append('path')
        .attr('d', arc)
        .style('fill', d => color(d.index))
        .style('stroke', '#fff')
        .style('stroke-width', 2)
        .on('mouseover', function(event, d) {
            d3.select(this)
                .style('opacity', 0.8);

            // v1.0.12: Show hostname + IP in tooltip for internet/tagged traffic if DNS enabled
            const ip = data.nodes[d.index];
            let tooltipHtml = `<strong>${ip}</strong>`;

            if ((type === 'internet' || type === 'tag_filter') && window.panfmSettings?.reverse_dns_enabled) {
                const hostname = getChordNodeLabel(ip);
                if (hostname !== ip) {
                    tooltipHtml = `<strong>${hostname}</strong><br/><span style="color:#888">${ip}</span>`;
                }
            }

            tooltip.style('opacity', 1)
                .html(tooltipHtml)
                .style('left', `${event.pageX + 10}px`)
                .style('top', `${event.pageY - 28}px`);
        })
        .on('mouseout', function(event, d) {
            d3.select(this)
                .style('opacity', 1);

            tooltip.style('opacity', 0);
        });

    // Add labels with full IP addresses - adjusted sizing and positioning
    const labelFontSize = Math.max(9, Math.min(11, width / 40)); // Adjusted for better fit
    const labelDistance = Math.min(10, width * 0.02); // Dynamic label distance based on container

    // v1.0.12: Check if DNS labels should be used (for internet and tagged traffic)
    const useDnsLabels = (type === 'internet' || type === 'tag_filter') && window.panfmSettings?.reverse_dns_enabled;

    groups.append('text')
        .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
        .attr('dy', '.35em')
        .attr('transform', d => `
            rotate(${(d.angle * 180 / Math.PI - 90)})
            translate(${outerRadius + labelDistance})
            ${d.angle > Math.PI ? 'rotate(180)' : ''}
        `)
        .style('text-anchor', d => d.angle > Math.PI ? 'end' : 'start')
        .style('font-size', `${labelFontSize}px`)
        .style('fill', '#fff')
        .style('font-weight', '600')
        .style('font-family', 'var(--font-secondary)')
        .style('letter-spacing', '0.3px')
        .text(d => {
            const ip = data.nodes[d.index];
            // v1.0.12: Use hostname for public IPs if DNS is enabled
            if (useDnsLabels) {
                return getChordNodeLabel(ip);
            }
            return ip;
        });

    // Create tooltip (global, shared between diagrams)
    if (!window.chordTooltip) {
        window.chordTooltip = d3.select('body').append('div')
            .attr('class', 'chord-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(0, 0, 0, 0.8)')
            .style('color', '#fff')
            .style('padding', '8px')
            .style('border-radius', '4px')
            .style('font-size', '12px')
            .style('font-family', 'var(--font-secondary)')
            .style('pointer-events', 'none')
            .style('opacity', 0)
            .style('z-index', 3000);
    }
    const tooltip = window.chordTooltip;

    console.log(`[CHORD] ${type} chord diagram rendered successfully`);
}

/**
 * Show error message in chord diagram container
 */
function showChordError(loadingId, message) {
    const element = document.getElementById(loadingId);
    if (element) {
        element.textContent = message;
        element.style.display = 'block';
        element.style.color = 'rgba(255, 100, 100, 0.8)';
    }
}

/**
 * Show message in SVG (no data, error, etc.)
 */
function showChordMessage(svg, width, height, message) {
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .style('fill', 'rgba(255, 255, 255, 0.6)')
        .style('font-size', '14px')
        .style('font-family', 'var(--font-secondary)')
        .text(message);
}

// ========================================================================
// TAG-FILTERED CHORD DIAGRAM FUNCTIONS
// ========================================================================

/**
 * Save tag filter selection to settings (persistent across restarts)
 */
async function saveTagFilterSelection(selectedTags) {
    try {
        // v1.0.7: Save per-device tag filter using device_id
        const deviceId = window.currentDeviceId;
        console.log(`[CHORD-TAG] Saving tag filter selection for device ${deviceId || 'global'}: ${selectedTags.join(', ')}`);

        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        const response = await fetch('/api/settings/tag-filter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                selected_tags: selectedTags,
                device_id: deviceId  // v1.0.7: Include device_id for per-device storage
            })
        });

        if (!response.ok) {
            console.warn('[CHORD-TAG] Failed to save tag selection');
        } else {
            console.log('[CHORD-TAG] Tag selection saved successfully');
        }
    } catch (error) {
        console.error('[CHORD-TAG] Error saving tag selection:', error);
    }
}

/**
 * Load saved tag filter selection from settings
 */
async function loadTagFilterSelection() {
    try {
        // v1.0.7: Load per-device tag filter using device_id
        const deviceId = window.currentDeviceId;
        const url = deviceId
            ? `/api/settings/tag-filter?device_id=${encodeURIComponent(deviceId)}`
            : '/api/settings/tag-filter';

        const response = await fetch(url);

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        if (data.status === 'success' && data.selected_tags) {
            console.log(`[CHORD-TAG] Loaded saved tag selection for device ${deviceId || 'global'}: ${data.selected_tags.join(', ')}`);
            return data.selected_tags;
        }

        return [];
    } catch (error) {
        console.error('[CHORD-TAG] Error loading saved tag selection:', error);
        return [];
    }
}

/**
 * Update the tag filter display at the bottom of the Tagged Traffic section
 * @param {Array} selectedTags - Array of selected tag names
 */
function updateTagFilterDisplay(selectedTags) {
    const displayElement = document.getElementById('chordTagFiltersList');
    if (!displayElement) {
        console.warn('[CHORD-TAG] Tag filters list element not found');
        return;
    }

    if (!selectedTags || selectedTags.length === 0) {
        displayElement.textContent = 'None';
        displayElement.style.color = 'rgba(255, 255, 255, 0.7)';
    } else {
        // Display tags as comma-separated list with badges
        displayElement.innerHTML = selectedTags.map(tag =>
            `<span style="display: inline-block; background: rgba(250, 88, 45, 0.2); border: 1px solid rgba(250, 88, 45, 0.5); border-radius: 4px; padding: 2px 8px; margin: 0 4px; font-size: 0.9em;">${escapeHtml(tag)}</span>`
        ).join('');
        displayElement.style.color = 'rgba(255, 255, 255, 0.9)';
    }

    console.log(`[CHORD-TAG] Updated tag display with ${selectedTags.length} tags`);
}

/**
 * Auto-load saved tag filter on page load
 * Called on page load and when device changes
 * Note: Dropdown removed - now using modal interface (openChordTagFilterModal)
 */
async function populateTagFilterDropdown() {
    console.log('[CHORD-TAG] Checking for saved tag filter selection');

    try {
        // Restore previously saved tag selection and auto-load diagram
        const savedTags = await loadTagFilterSelection();

        // Update the tag filter display
        updateTagFilterDisplay(savedTags);

        if (savedTags.length > 0) {
            console.log(`[CHORD-TAG] Found ${savedTags.length} saved tag selections`);

            // Load the diagram with saved tags
            if (typeof loadTagFilteredChordDiagram === 'function') {
                await loadTagFilteredChordDiagram();
            }
        } else {
            console.log('[CHORD-TAG] No saved tag selections found');
            // v2.1.20: Show empty state message when no tags saved
            // This fixes "Loading..." showing permanently after device switch
            const loadingElement = document.getElementById('chordTagLoading');
            if (loadingElement) {
                loadingElement.style.display = 'block';
                loadingElement.textContent = 'Click ⚙️ to select tags...';
                loadingElement.style.color = 'rgba(255,255,255,0.7)';
            }
            const countElement = document.getElementById('chordTagCount');
            if (countElement) {
                countElement.textContent = 'Select tags';
            }
            // Clear the SVG in case there's stale data
            if (typeof d3 !== 'undefined') {
                const svg = d3.select('#chordTagSvg');
                if (!svg.empty()) {
                    svg.selectAll('*').remove();
                }
            }
        }
    } catch (error) {
        console.error('[CHORD-TAG] Error loading saved tags:', error);
    }
}

/**
 * Load and render tag-filtered chord diagram
 * Called when tag selection changes or on auto-refresh
 * Note: Gets tags from saved settings (not from old dropdown)
 */
async function loadTagFilteredChordDiagram() {
    console.log('[CHORD-TAG] Loading tag-filtered chord diagram');

    // Check D3.js availability
    if (typeof d3 === 'undefined') {
        console.warn('[CHORD-TAG] D3.js not available, skipping');
        return;
    }

    try {
        // Get selected tags from saved settings (not from dropdown)
        const selectedTags = await loadTagFilterSelection();

        console.log(`[CHORD-TAG] Selected tags from settings: ${selectedTags.join(', ')}`);

        // If no tags selected, show empty state
        if (selectedTags.length === 0) {
            console.log('[CHORD-TAG] No tags selected, showing empty state');
            const svg = d3.select('#chordTagSvg');
            if (!svg.empty()) {
                svg.selectAll('*').remove();
            }
            const loadingElement = document.getElementById('chordTagLoading');
            if (loadingElement) {
                loadingElement.style.display = 'block';
                loadingElement.textContent = 'Click ⚙️ to select tags...';
                loadingElement.style.color = 'rgba(255,255,255,0.7)';
            }
            const countElement = document.getElementById('chordTagCount');
            if (countElement) {
                countElement.textContent = 'Select tags';
            }
            return;
        }

        // Show loading state
        const loadingElement = document.getElementById('chordTagLoading');
        if (loadingElement) {
            loadingElement.style.display = 'block';
            loadingElement.innerHTML = '<div style="width: 24px; height: 24px; border: 3px solid rgba(156, 39, 176, 0.3); border-top-color: #9C27B0; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 8px;"></div><div style="color: rgba(255,255,255,0.7); font-size: 0.8em;">Loading...</div>';
        }

        // Fetch filtered flow data
        const tagsParam = selectedTags.join(',');
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        // v1.0.6: Pass device_id to ensure correct device data
        const tagFlowUrl = buildDeviceUrl('/api/client-destination-flow-by-tag', { tags: tagsParam });
        const response = await fetch(tagFlowUrl, {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        console.log(`[CHORD-TAG] Received data:`, data);

        if (data.status === 'success') {
            // Update count display
            const countElement = document.getElementById('chordTagCount');
            if (countElement) {
                const flowCount = data.tag_filter.flows.length;
                const deviceCount = data.matching_devices;
                countElement.textContent = `${flowCount} unique connections (${deviceCount} devices)`;
            }

            // Check if we have data to display
            if (data.tag_filter.flows.length === 0) {
                console.log('[CHORD-TAG] No flows found for selected tags');
                const svg = d3.select('#chordTagSvg');
                if (!svg.empty()) {
                    svg.selectAll('*').remove();
                }
                if (loadingElement) {
                    loadingElement.style.display = 'block';
                    const message = data.message || `No traffic from ${data.matching_devices} matching devices`;
                    loadingElement.textContent = message;
                    loadingElement.style.color = 'rgba(255,200,100,0.8)';
                }
            } else {
                // v1.0.12: Perform DNS lookup for public IPs if enabled
                if (window.panfmSettings?.reverse_dns_enabled && data.tag_filter.nodes?.length > 0) {
                    await performChordDnsLookup(data.tag_filter.nodes);
                }

                // Render chord diagram
                console.log(`[CHORD-TAG] Rendering chord diagram with ${data.tag_filter.nodes.length} nodes and ${data.tag_filter.flows.length} flows`);
                renderChordDiagram('chordTagSvg', data.tag_filter, 'tag_filter');
            }
        } else {
            throw new Error(data.message || 'Unknown error');
        }

    } catch (error) {
        console.error('[CHORD-TAG] Error loading tag-filtered chord diagram:', error);
        showChordError('chordTagLoading', `Error: ${error.message}`);
        const countElement = document.getElementById('chordTagCount');
        if (countElement) {
            countElement.textContent = 'Error';
        }
    }
}

/**
 * Helper function to format bytes to human-readable format
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ============================================================================
// Chord Tag Filter Modal Functions
// ============================================================================

/**
 * Open the tag filter modal and populate it with available tags
 */
async function openChordTagFilterModal() {
    console.log('[CHORD-TAG-MODAL] Opening tag filter modal');

    const modal = document.getElementById('chordTagFilterModal');
    const modalSelect = document.getElementById('chordTagFilterModalSelect');

    if (!modal || !modalSelect) {
        console.error('[CHORD-TAG-MODAL] Modal elements not found in DOM');
        return;
    }

    try {
        // Fetch available tags
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        const response = await fetch('/api/device-metadata/tags', {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Clear existing options
        modalSelect.innerHTML = '';

        if (data.status === 'success' && data.tags && data.tags.length > 0) {
            // Add tags as options
            data.tags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag;
                option.textContent = tag;
                modalSelect.appendChild(option);
            });

            console.log(`[CHORD-TAG-MODAL] Loaded ${data.tags.length} tags`);

            // Restore previously saved tag selection
            const savedTags = await loadTagFilterSelection();
            if (savedTags.length > 0) {
                Array.from(modalSelect.options).forEach(option => {
                    if (savedTags.includes(option.value)) {
                        option.selected = true;
                    }
                });
                console.log(`[CHORD-TAG-MODAL] Restored ${savedTags.length} saved selections`);
            }
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No tags available';
            option.disabled = true;
            modalSelect.appendChild(option);
            console.log('[CHORD-TAG-MODAL] No tags available');
        }

        // Show modal
        modal.style.display = 'flex';

    } catch (error) {
        console.error('[CHORD-TAG-MODAL] Error loading tags:', error);
        modalSelect.innerHTML = '<option value="" disabled>Error loading tags</option>';
        // Still show modal to display the error
        modal.style.display = 'flex';
    }
}

/**
 * Close the tag filter modal
 */
function closeChordTagFilterModal() {
    console.log('[CHORD-TAG-MODAL] Closing tag filter modal');
    const modal = document.getElementById('chordTagFilterModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Clear all tag selections and refresh the diagram
 */
async function clearChordTagFilter() {
    console.log('[CHORD-TAG-MODAL] Clearing tag filter');

    const modalSelect = document.getElementById('chordTagFilterModalSelect');
    if (modalSelect) {
        // Clear all selections
        modalSelect.selectedIndex = -1;
        Array.from(modalSelect.options).forEach(option => {
            option.selected = false;
        });
    }

    // Save empty selection
    await saveTagFilterSelection([]);

    // Update the tag filter display (clear it)
    updateTagFilterDisplay([]);

    // Clear the diagram and show empty state
    const svg = d3.select('#chordTagSvg');
    if (!svg.empty()) {
        svg.selectAll('*').remove();
    }

    const loadingElement = document.getElementById('chordTagLoading');
    if (loadingElement) {
        loadingElement.style.display = 'block';
        loadingElement.textContent = 'Click ⚙️ to select tags...';
        loadingElement.style.color = 'rgba(255,255,255,0.7)';
    }

    const countElement = document.getElementById('chordTagCount');
    if (countElement) {
        countElement.textContent = 'Select tags';
    }

    console.log('[CHORD-TAG-MODAL] Tag filter cleared');
}

/**
 * Apply selected tag filter and refresh the diagram
 */
async function applyChordTagFilter() {
    console.log('[CHORD-TAG-MODAL] Applying tag filter');

    const modalSelect = document.getElementById('chordTagFilterModalSelect');
    if (!modalSelect) {
        console.error('[CHORD-TAG-MODAL] Modal select not found');
        return;
    }

    // Get selected tags
    const selectedOptions = Array.from(modalSelect.selectedOptions);
    const selectedTags = selectedOptions.map(option => option.value).filter(v => v);

    console.log(`[CHORD-TAG-MODAL] Selected tags: ${selectedTags.join(', ')}`);

    // Save selection
    await saveTagFilterSelection(selectedTags);

    // Update the tag filter display
    updateTagFilterDisplay(selectedTags);

    // Close modal
    closeChordTagFilterModal();

    // Load the filtered diagram
    if (typeof loadTagFilteredChordDiagram === 'function') {
        await loadTagFilteredChordDiagram();
    } else {
        console.error('[CHORD-TAG-MODAL] loadTagFilteredChordDiagram function not available');
    }
}

// Close modal when clicking outside of it
window.addEventListener('click', function(event) {
    const modal = document.getElementById('chordTagFilterModal');
    if (modal && event.target === modal) {
        closeChordTagFilterModal();
    }
});

// ============================================================================
// Export functions to global scope
// ============================================================================

// Make all chord functions globally accessible
window.isPrivateIP = isPrivateIP;
window.performChordDnsLookup = performChordDnsLookup;
window.getChordNodeLabel = getChordNodeLabel;
window.loadInternalTrafficFilters = loadInternalTrafficFilters;
window.saveInternalTrafficFilters = saveInternalTrafficFilters;
window.onInternalFilterChange = onInternalFilterChange;
window.getFilteredInternalFlows = getFilteredInternalFlows;
window.renderFilteredInternalTraffic = renderFilteredInternalTraffic;
window.loadInternetTrafficFilters = loadInternetTrafficFilters;
window.saveInternetTrafficFilters = saveInternetTrafficFilters;
window.onInternetFilterChange = onInternetFilterChange;
window.mergeFlowData = mergeFlowData;
window.getFilteredInternetFlows = getFilteredInternetFlows;
window.renderFilteredInternetTraffic = renderFilteredInternetTraffic;
window.loadChordDiagrams = loadChordDiagrams;
window.renderChordDiagram = renderChordDiagram;
window.showChordError = showChordError;
window.showChordMessage = showChordMessage;
window.saveTagFilterSelection = saveTagFilterSelection;
window.loadTagFilterSelection = loadTagFilterSelection;
window.updateTagFilterDisplay = updateTagFilterDisplay;
window.populateTagFilterDropdown = populateTagFilterDropdown;
window.loadTagFilteredChordDiagram = loadTagFilteredChordDiagram;
window.formatBytes = formatBytes;
window.openChordTagFilterModal = openChordTagFilterModal;
window.closeChordTagFilterModal = closeChordTagFilterModal;
window.clearChordTagFilter = clearChordTagFilter;
window.applyChordTagFilter = applyChordTagFilter;

console.log('[APP-CHORD.JS] ===== MODULE LOADING COMPLETE =====');
