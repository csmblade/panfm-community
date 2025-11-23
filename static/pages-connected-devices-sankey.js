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

// Cache TTL in milliseconds (60 seconds to align with server-side cache)
const CACHE_TTL_MS = 60 * 1000;

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
}

/**
 * Open Sankey diagram modal for a specific client IP
 * @param {string} clientIp - Client IP address
 */
async function openSankeyDiagram(clientIp) {
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

        if (!flowData || !flowData.flows || flowData.flows.length === 0) {
            showSankeyError('No traffic flow data available for this client in the last 60 minutes.');
            hideSankeyLoading();
            return;
        }

        // Update summary stats
        updateSankeyStats(flowData);

        // Render diagram
        renderSankeyDiagram(flowData.flows);

        hideSankeyLoading();
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
 */
function updateSankeyStats(flowData) {
    if (sankeyTotalFlows) {
        sankeyTotalFlows.textContent = (flowData.flows || []).length.toLocaleString();
    }

    if (sankeyTotalVolume) {
        const totalBytes = (flowData.flows || []).reduce((sum, flow) => sum + (flow.bytes || 0), 0);
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

    // Check if d3 and d3.sankey are available
    if (typeof d3 === 'undefined') {
        showSankeyError('D3.js library not loaded. Please refresh the page.');
        return;
    }

    if (typeof d3.sankey === 'undefined') {
        showSankeyError('d3-sankey library not loaded. Please refresh the page.');
        return;
    }

    // Build nodes and links for Sankey diagram
    const { nodes, links } = buildSankeyData(flows);

    if (nodes.length === 0 || links.length === 0) {
        showSankeyError('No flow data to visualize.');
        return;
    }

    // Diagram dimensions
    const container = sankeyDiagram;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 10, right: 10, bottom: 10, left: 10 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create Sankey layout
    const sankey = d3.sankey()
        .nodeWidth(15)
        .nodePadding(10)
        .extent([[1, 1], [chartWidth - 1, chartHeight - 5]]);

    // Generate Sankey data
    const { nodes: sankeyNodes, links: sankeyLinks } = sankey({
        nodes: nodes.map(d => Object.assign({}, d)),
        links: links.map(d => Object.assign({}, d))
    });

    // Color scale for nodes
    const colorScale = d3.scaleOrdinal()
        .domain(['source', 'application', 'destination'])
        .range(['#FA582D', '#2196F3', '#4CAF50']);

    // Draw links
    svg.append('g')
        .selectAll('path')
        .data(sankeyLinks)
        .enter()
        .append('path')
        .attr('d', d3.sankeyLinkHorizontal())
        .attr('stroke-width', d => Math.max(1, d.width))
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
        .text(d => `${d.source.name} → ${d.target.name}\n${formatBytesHuman(d.value)}`);

    // Draw nodes
    const node = svg.append('g')
        .selectAll('rect')
        .data(sankeyNodes)
        .enter()
        .append('g');

    node.append('rect')
        .attr('x', d => d.x0)
        .attr('y', d => d.y0)
        .attr('height', d => d.y1 - d.y0)
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

    // Add labels
    node.append('text')
        .attr('x', d => d.x0 < chartWidth / 2 ? d.x1 + 6 : d.x0 - 6)
        .attr('y', d => (d.y1 + d.y0) / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', d => d.x0 < chartWidth / 2 ? 'start' : 'end')
        .text(d => d.name)
        .style('font-family', 'var(--font-secondary)')
        .style('font-size', '12px')
        .style('fill', '#333');
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
    function getOrCreateNode(name, type) {
        const key = `${type}_${name}`;
        if (!nodeMap.has(key)) {
            const node = { name, type };
            nodeMap.set(key, nodes.length);
            nodes.push(node);
        }
        return nodeMap.get(key);
    }

    // Process each flow
    flows.forEach(flow => {
        const sourceIp = flow.source_ip || 'unknown';
        const destIp = flow.dest_ip || 'unknown';
        const destPort = flow.dest_port || '';
        const application = flow.application || 'unknown';
        const bytes = flow.bytes || 0;

        // Skip flows with zero bytes
        if (bytes === 0) return;

        // Create destination label with port (e.g., "192.168.1.100:443")
        const destLabel = destPort ? `${destIp}:${destPort}` : destIp;

        // Get or create nodes
        const sourceIdx = getOrCreateNode(sourceIp, 'source');
        const appIdx = getOrCreateNode(application, 'application');
        const destIdx = getOrCreateNode(destLabel, 'destination');

        // Create links: source → application → destination
        // Link 1: source → application
        const link1Key = `${sourceIdx}_${appIdx}`;
        let link1 = links.find(l => l.source === sourceIdx && l.target === appIdx);
        if (!link1) {
            link1 = { source: sourceIdx, target: appIdx, value: 0 };
            links.push(link1);
        }
        link1.value += bytes;

        // Link 2: application → destination
        const link2Key = `${appIdx}_${destIdx}`;
        let link2 = links.find(l => l.source === appIdx && l.target === destIdx);
        if (!link2) {
            link2 = { source: appIdx, target: destIdx, value: 0 };
            links.push(link2);
        }
        link2.value += bytes;
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
 * Get selected device ID from settings
 * @returns {string|null} Device ID or null
 */
function getSelectedDeviceId() {
    // Try to get from global window.settings object (set by app.js)
    if (typeof window.settings !== 'undefined' && window.settings.selected_device_id) {
        return window.settings.selected_device_id;
    }

    // Fallback: try to get from localStorage (if devices.js stores it)
    const storedDeviceId = localStorage.getItem('selected_device_id');
    if (storedDeviceId) {
        return storedDeviceId;
    }

    console.warn('No device ID found in settings or localStorage');
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

// Initialize modal when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initSankeyModal();
    console.log('Sankey diagram module initialized');
});
