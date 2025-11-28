console.log('[APP.JS] ===== FILE LOADING STARTED =====');

// ============================================================================
// Device Initialization State (v1.0.5 - Enterprise Device Switching Fix)
// Prevents race conditions during device selection initialization
// ============================================================================
window.deviceInitialized = false;
window.deviceInitializing = false;
window.initialDataLoaded = false;  // v1.0.6: Track if initial dashboard data has been loaded
window.onDemandCollectionInProgress = false;  // v1.0.7: Track if on-demand collection is already running

// ============================================================================
// Performance Optimization: Frontend Caching Utility (v2.0.1)
// ============================================================================
const CacheUtil = {
    // Cache storage with TTL (Time To Live)
    cache: new Map(),

    /**
     * Set cache entry with optional TTL
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {number} ttl - Time to live in milliseconds (default: 5 minutes)
     */
    set(key, value, ttl = 5 * 60 * 1000) {
        this.cache.set(key, {
            value: value,
            expires: Date.now() + ttl
        });
    },

    /**
     * Get cached value if not expired
     * @param {string} key - Cache key
     * @returns {*} Cached value or null if expired/not found
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    },

    /**
     * Invalidate cache entry
     * @param {string} key - Cache key
     */
    invalidate(key) {
        this.cache.delete(key);
    },

    /**
     * Clear all cache
     */
    clear() {
        this.cache.clear();
    }
};

// Make CacheUtil globally accessible
window.CacheUtil = CacheUtil;

// ============================================================================
// Device Context Helper Functions (v1.0.5 - Enterprise Device Switching Fix)
// These ensure device_id is passed on ALL API calls to eliminate race conditions
// ============================================================================

/**
 * Build URL with device_id parameter
 * Always uses window.currentDeviceId as single source of truth
 * @param {string} baseUrl - The base API URL (e.g., '/api/threats')
 * @param {Object} additionalParams - Optional additional query parameters
 * @returns {string} URL with device_id and any additional params
 */
function buildDeviceUrl(baseUrl, additionalParams = {}) {
    const params = new URLSearchParams(additionalParams);
    if (window.currentDeviceId) {
        params.set('device_id', window.currentDeviceId);
    }
    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

// Make globally accessible
window.buildDeviceUrl = buildDeviceUrl;

// Configuration (will be loaded from settings)
let UPDATE_INTERVAL = 60000; // Update every 60 seconds (Phase 2: database-first architecture)
const MAX_DATA_POINTS = 30; // Show last 30 data points
const MAX_MINI_POINTS = 20; // Mini charts show last 20 points

let updateIntervalId = null; // Store interval ID for updates
let sessionKeepaliveIntervalId = null; // Store interval ID for session keepalive (Tony Mode)

// Data storage
// Make chartData globally accessible
window.chartData = {
    labels: [],
    timestamps: [],  // Store ISO timestamps for accurate duplicate detection
    inbound: [],
    outbound: [],
    total: []
};
const chartData = window.chartData; // Create local alias for convenience

let miniChartData = {
    sessions: [],
    tcp: [],
    udp: [],
    pps: []
};

// Historical data for trend calculation (last 5 minutes worth of data)
let historicalData = {
    inbound: [],
    outbound: [],
    total: [],
    sessions: [],
    tcp: [],
    udp: [],
    icmp: [],
    criticalThreats: [],
    mediumThreats: [],
    blockedUrls: [],
    urlFiltering: [],
    interfaceErrors: []
};

// Storage for modal data (global so pages.js can access them)
window.currentCriticalLogs = [];
window.currentHighLogs = [];
window.currentMediumLogs = [];
window.currentBlockedUrlLogs = [];
window.currentTopApps = [];

// ============================================================================
// Device Switch Loading Overlay (v2.1.18 - Enterprise UX)
// ============================================================================

// Track overlay state for minimum display time
let overlayShowTime = 0;
const OVERLAY_MIN_DISPLAY_MS = 800; // Minimum 800ms display to avoid flash

/**
 * Show full-screen loading overlay during device switch
 * @param {string} deviceName - Name of device being switched to
 */
function showDeviceSwitchOverlay(deviceName) {
    const overlay = document.getElementById('deviceSwitchOverlay');
    const message = document.getElementById('deviceSwitchMessage');
    const progress = document.getElementById('deviceSwitchProgress');

    if (overlay) {
        if (message) message.textContent = `Switching to ${deviceName}...`;
        if (progress) progress.textContent = 'Initializing...';
        overlay.style.display = 'flex';
        overlayShowTime = Date.now();
        console.log('[OVERLAY] Shown at', overlayShowTime);
    }
}

/**
 * Update progress message on loading overlay
 * @param {string} step - Current progress step description
 */
function updateDeviceSwitchProgress(step) {
    const progress = document.getElementById('deviceSwitchProgress');
    if (progress) {
        progress.textContent = step;
        console.log('[OVERLAY] Progress:', step);
    }
}

/**
 * Hide loading overlay when device switch completes
 * Ensures minimum display time to avoid jarring flash
 */
async function hideDeviceSwitchOverlay() {
    const overlay = document.getElementById('deviceSwitchOverlay');
    if (overlay) {
        // Ensure minimum display time
        const elapsed = Date.now() - overlayShowTime;
        if (elapsed < OVERLAY_MIN_DISPLAY_MS) {
            const remaining = OVERLAY_MIN_DISPLAY_MS - elapsed;
            console.log(`[OVERLAY] Waiting ${remaining}ms for minimum display time`);
            await new Promise(resolve => setTimeout(resolve, remaining));
        }
        overlay.style.display = 'none';
        console.log('[OVERLAY] Hidden after', Date.now() - overlayShowTime, 'ms');
    }
}

// Make overlay functions globally accessible (for devices.js)
window.showDeviceSwitchOverlay = showDeviceSwitchOverlay;
window.updateDeviceSwitchProgress = updateDeviceSwitchProgress;
window.hideDeviceSwitchOverlay = hideDeviceSwitchOverlay;

// Enterprise Threat Configuration (v1.10.14)
// Reusable, scalable configuration for threat severity tiles
// Supports critical, high, medium, blocked URLs - easy to extend for future severities
const THREAT_CONFIG = {
    critical: {
        title: 'CRITICAL THREATS',
        dataKey: 'critical_count',
        logsKey: 'critical_logs',
        lastSeenKey: 'critical_last_seen',
        color: '#FA582D',
        gradient: 'linear-gradient(135deg, #FA582D 0%, #FF7A55 100%)',
        elementIds: {
            value: 'criticalValue',
            latest: 'criticalLatest',
            lastSeen: 'criticalLastSeen'
        },
        modalFunction: 'showCriticalThreatsModal',
        globalLogsVar: 'currentCriticalLogs'
    },
    high: {
        title: 'HIGH THREATS',
        dataKey: 'high_count',
        logsKey: 'high_logs',
        lastSeenKey: 'high_last_seen',
        color: '#E04F26',
        gradient: 'linear-gradient(135deg, #E04F26 0%, #FF6B3D 100%)',
        elementIds: {
            value: 'highValue',
            latest: 'highLatest',
            lastSeen: 'highLastSeen'
        },
        modalFunction: 'showHighThreatsModal',
        globalLogsVar: 'currentHighLogs'
    },
    medium: {
        title: 'MEDIUM THREATS',
        dataKey: 'medium_count',
        logsKey: 'medium_logs',
        lastSeenKey: 'medium_last_seen',
        color: '#C64620',
        gradient: 'linear-gradient(135deg, #C64620 0%, #E85A31 100%)',
        elementIds: {
            value: 'mediumValue',
            latest: 'mediumLatest',
            lastSeen: 'mediumLastSeen'
        },
        modalFunction: 'showMediumThreatsModal',
        globalLogsVar: 'currentMediumLogs'
    },
    blocked: {
        title: 'BLOCKED URLS',
        dataKey: 'url_blocked',
        logsKey: 'blocked_url_logs',
        lastSeenKey: 'blocked_url_last_seen',
        color: '#AD3D1A',
        gradient: 'linear-gradient(135deg, #AD3D1A 0%, #D14925 100%)',
        elementIds: {
            value: 'blockedUrlValue',
            latest: 'blockedUrlLatest',
            lastSeen: 'blockedUrlLastSeen'
        },
        modalFunction: 'showBlockedUrlsModal',
        globalLogsVar: 'currentBlockedUrlLogs'
    }
};

// Global metadata cache for device enrichment (dashboard use)
window.deviceMetadataCache = {};

// Mini chart instances
let sessionChart = null;
let tcpChart = null;
let udpChart = null;
let ppsChart = null;

/**
 * Centralized API Client (v1.14.0 - Phase 2: API Standardization)
 *
 * Handles all API requests with:
 * - Automatic CSRF token injection
 * - Retry logic for failed requests
 * - Consistent error handling
 * - Request/response logging
 * - Waiting state detection
 */
class ApiClient {
    constructor() {
        this.baseUrl = '';  // Same origin
        this.defaultTimeout = 30000;  // 30 seconds
        this.maxRetries = 3;
        this.retryDelay = 1000;  // 1 second base delay
    }

    /**
     * Get CSRF token from meta tag
     */
    getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    /**
     * Main request method with retry logic and error handling
     */
    async request(endpoint, options = {}) {
        const {
            method = 'GET',
            body = null,
            headers = {},
            params = null,
            timeout = this.defaultTimeout,
            retries = this.maxRetries,
            skipRetry = false
        } = options;

        // Build headers
        const requestHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        // Add CSRF token for mutating requests
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
            requestHeaders['X-CSRFToken'] = this.getCsrfToken();
        }

        // Build URL with query parameters
        let url = `${this.baseUrl}${endpoint}`;
        if (params && Object.keys(params).length > 0) {
            const queryString = new URLSearchParams(params).toString();
            url = `${url}?${queryString}`;
            console.log(`[ApiClient] QUERY PARAMS DETECTED:`, params);
            console.log(`[ApiClient] QUERY STRING BUILT: ?${queryString}`);
        } else {
            console.log(`[ApiClient] NO QUERY PARAMS (params is ${params})`);
        }
        console.log(`[ApiClient] FINAL URL: ${url}`);

        // Build request config
        const config = {
            method,
            headers: requestHeaders,
            credentials: 'same-origin'
        };

        if (body) {
            config.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        // Execute request with timeout and retry logic
        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                console.log(`[ApiClient] ${method} ${url} (attempt ${attempt + 1}/${retries + 1})`);

                const response = await this._fetchWithTimeout(url, config, timeout);

                // Check HTTP status
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                // Parse JSON response
                const data = await response.json();

                // Check for waiting status
                if (data.status === 'waiting') {
                    console.log(`[ApiClient] Waiting state detected: ${data.message}`);
                    return {
                        ok: true,
                        data: data,
                        status: 'waiting'
                    };
                }

                // Check for error status
                if (data.status === 'error') {
                    console.error(`[ApiClient] API error: ${data.message}`);
                    return {
                        ok: false,
                        data: data,
                        status: 'error'
                    };
                }

                // Success
                return {
                    ok: true,
                    data: data,
                    status: 'success'
                };

            } catch (error) {
                lastError = error;
                console.error(`[ApiClient] Request failed (attempt ${attempt + 1}): ${error.message}`);

                // Don't retry on rate limit errors (HTTP 429) or client errors (4xx)
                // Rate limit retries make the problem worse by consuming more quota
                if (error.message && error.message.includes('HTTP 429')) {
                    console.warn(`[ApiClient] Rate limit exceeded - not retrying`);
                    return {
                        ok: false,
                        error: error,
                        status: 'rate_limit'
                    };
                }

                // Don't retry on other client errors (400-499 except 429 already handled)
                if (error.message && /HTTP 4\d\d/.test(error.message)) {
                    console.warn(`[ApiClient] Client error - not retrying`);
                    return {
                        ok: false,
                        error: error,
                        status: 'client_error'
                    };
                }

                // Don't retry on last attempt or if skipRetry is true
                if (attempt < retries && !skipRetry) {
                    await this._sleep(this.retryDelay * (attempt + 1));  // Exponential backoff
                }
            }
        }

        // All retries failed
        console.error(`[ApiClient] All ${retries + 1} attempts failed for ${endpoint}`);
        return {
            ok: false,
            error: lastError,
            status: 'network_error'
        };
    }

    /**
     * Fetch with timeout wrapper
     */
    _fetchWithTimeout(url, config, timeout) {
        return Promise.race([
            fetch(url, config),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), timeout)
            )
        ]);
    }

    /**
     * Sleep helper for retry delays
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Convenience methods for common HTTP verbs
    get(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'GET' });
    }

    post(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: 'POST', body });
    }

    put(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: 'PUT', body });
    }

    delete(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'DELETE' });
    }
}

// Create global API client instance (v1.14.0)
window.apiClient = new ApiClient();
console.log('[ApiClient] Centralized API client initialized (v1.14.0)');

// D3.js Line Chart Implementation (replicates Chart.js network throughput graph)
function initializeD3Chart() {
    const svg = d3.select("#throughputChart");
    const margin = {top: 10, right: 10, bottom: 35, left: 75};
    const width = svg.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = 240 - margin.top - margin.bottom;  // Reduced from 300 to 240

    // Clear any existing chart
    svg.selectAll("*").remove();

    // Define drop shadow filter for depth (only once during initialization)
    const defs = svg.append("defs");
    const filter = defs.append("filter")
        .attr("id", "drop-shadow")
        .attr("height", "130%");

    filter.append("feGaussianBlur")
        .attr("in", "SourceAlpha")
        .attr("stdDeviation", 2);

    filter.append("feOffset")
        .attr("dx", 0)
        .attr("dy", 1);

    filter.append("feComponentTransfer")
        .append("feFuncA")
        .attr("type", "linear")
        .attr("slope", 0.3);

    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode");
    feMerge.append("feMergeNode")
        .attr("in", "SourceGraphic");

    // Create chart group
    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Store globally for updates
    window.d3Chart = {
        svg: svg,
        g: g,
        margin: margin,
        width: width,
        height: height
    };

    return window.d3Chart;
}

// Update D3 line chart with new data
function updateD3Chart(data) {
    if (!window.d3Chart) {
        initializeD3Chart();
    }

    const {g, width, height, margin} = window.d3Chart;

    // Clear existing content
    g.selectAll("*").remove();

    // Prepare data
    const labels = data.labels || [];
    const inbound = data.inbound || [];
    const outbound = data.outbound || [];
    const total = data.total || [];

    if (labels.length === 0) return;

    // Create scales
    const xScale = d3.scalePoint()
        .domain(labels)
        .range([0, width])
        .padding(0);

    const allValues = [...inbound, ...outbound, ...total].filter(v => v !== null && v !== undefined);
    const maxY = d3.max(allValues) || 10;

    const yScale = d3.scaleLinear()
        .domain([0, maxY])
        .range([height, 0])
        .nice();

    // Create line generators with smooth curves
    const line = d3.line()
        .defined(d => d !== null && d !== undefined)
        .x((d, i) => xScale(labels[i]))
        .y(d => yScale(d))
        .curve(d3.curveMonotoneX);  // Smooth curve similar to Chart.js tension

    // Create area generators for filled areas
    const area = d3.area()
        .defined(d => d !== null && d !== undefined)
        .x((d, i) => xScale(labels[i]))
        .y0(height)
        .y1(d => yScale(d))
        .curve(d3.curveMonotoneX);

    // Draw grid lines (subtle but visible)
    g.append("g")
        .attr("class", "grid")
        .attr("opacity", 0.15)
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat("")
        )
        .selectAll("line")
        .style("stroke", "#F2F0EF");

    // Draw Total line and area (light cream color)
    g.append("path")
        .datum(total)
        .attr("fill", "rgba(242, 240, 239, 0.15)")
        .attr("d", area);

    g.append("path")
        .datum(total)
        .attr("fill", "none")
        .attr("stroke", "#F2F0EF")
        .attr("stroke-width", 3)
        .attr("filter", "url(#drop-shadow)")
        .attr("d", line);

    // Draw Outbound line and area (lighter orange/peach)
    g.append("path")
        .datum(outbound)
        .attr("fill", "rgba(242, 166, 90, 0.15)")
        .attr("d", area);

    g.append("path")
        .datum(outbound)
        .attr("fill", "none")
        .attr("stroke", "#F2A65A")
        .attr("stroke-width", 3)
        .attr("filter", "url(#drop-shadow)")
        .attr("d", line);

    // Draw Inbound line and area (PANfm brand orange)
    g.append("path")
        .datum(inbound)
        .attr("fill", "rgba(250, 88, 45, 0.15)")
        .attr("d", area);

    g.append("path")
        .datum(inbound)
        .attr("fill", "none")
        .attr("stroke", "#FA582D")
        .attr("stroke-width", 3)
        .attr("filter", "url(#drop-shadow)")
        .attr("d", line);

    // Add data point dots (Total - cream color)
    const totalData = total.map((value, i) => ({value, index: i}))
        .filter(d => d.value !== null && d.value !== undefined);

    g.selectAll(".dot-total")
        .data(totalData)
        .enter().append("circle")
        .attr("class", "dot-total")
        .attr("cx", d => xScale(labels[d.index]))
        .attr("cy", d => yScale(d.value))
        .attr("r", 3)
        .attr("fill", "#F2F0EF")
        .attr("stroke", "#FFFFFF")
        .attr("stroke-width", 1.5);

    // Add data point dots (Outbound - peach color)
    const outboundData = outbound.map((value, i) => ({value, index: i}))
        .filter(d => d.value !== null && d.value !== undefined);

    g.selectAll(".dot-outbound")
        .data(outboundData)
        .enter().append("circle")
        .attr("class", "dot-outbound")
        .attr("cx", d => xScale(labels[d.index]))
        .attr("cy", d => yScale(d.value))
        .attr("r", 3)
        .attr("fill", "#F2A65A")
        .attr("stroke", "#FFFFFF")
        .attr("stroke-width", 1.5);

    // Add data point dots (Inbound - PANfm orange)
    const inboundData = inbound.map((value, i) => ({value, index: i}))
        .filter(d => d.value !== null && d.value !== undefined);

    g.selectAll(".dot-inbound")
        .data(inboundData)
        .enter().append("circle")
        .attr("class", "dot-inbound")
        .attr("cx", d => xScale(labels[d.index]))
        .attr("cy", d => yScale(d.value))
        .attr("r", 3)
        .attr("fill", "#FA582D")
        .attr("stroke", "#FFFFFF")
        .attr("stroke-width", 1.5);

    // Add X axis with time labels
    const xAxis = d3.axisBottom(xScale)
        .tickValues(xScale.domain().filter((d, i) => i % Math.ceil(labels.length / 10) === 0));

    const xAxisGroup = g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(xAxis);

    xAxisGroup.selectAll("text")
        .style("font-size", "10px")
        .style("fill", "#F2F0EF")  // Light text color for dark background
        .attr("transform", "rotate(0)");

    xAxisGroup.selectAll("line, path")
        .style("stroke", "#F2F0EF")  // Light color for axis lines
        .style("opacity", "0.4");  // Increased from 0.3 for better visibility

    // Add Y axis
    const yAxis = d3.axisLeft(yScale)
        .ticks(6)
        .tickFormat(d => {
            // Format based on value magnitude for cleaner labels
            if (d >= 100) {
                return d.toFixed(0) + ' Mbps';
            } else if (d >= 10) {
                return d.toFixed(1) + ' Mbps';
            } else {
                return d.toFixed(2) + ' Mbps';
            }
        });

    const yAxisGroup = g.append("g")
        .call(yAxis);

    yAxisGroup.selectAll("text")
        .style("font-size", "12px")
        .style("fill", "#F2F0EF");  // Light text color for dark background

    yAxisGroup.selectAll("line, path")
        .style("stroke", "#F2F0EF")  // Light color for axis lines
        .style("opacity", "0.4");  // Increased from 0.3 for better visibility

    // Top-right legend removed - using bottom legend only (cleaner, doesn't block graph)
}

// Initialize on load
const chart = initializeD3Chart();
window.chart = chart;
window.throughputChart = chart;

// Calculate trend from historical data
function calculateTrend(dataArray) {
    if (dataArray.length < 2) return ''; // Not enough data

    // Get first half and second half averages
    const halfPoint = Math.floor(dataArray.length / 2);
    const firstHalf = dataArray.slice(0, halfPoint);
    const secondHalf = dataArray.slice(halfPoint);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;

    if (percentChange > 5) {
        return '<span style="color: #ffffff; font-size: 0.8em; margin-left: 5px; opacity: 0.8;">▲</span>';
    } else if (percentChange < -5) {
        return '<span style="color: #ffffff; font-size: 0.8em; margin-left: 5px; opacity: 0.8;">▼</span>';
    } else {
        return '<span style="color: #ffffff; font-size: 0.8em; margin-left: 5px; opacity: 0.8;">━</span>';
    }
}

/**
 * Calculate average of data array (for 5-minute averages)
 * @param {Array} dataArray - Array of numeric values
 * @returns {number} - Average value, rounded to 2 decimal places
 */
function calculateAverage(dataArray) {
    if (!dataArray || dataArray.length === 0) return 0;
    const sum = dataArray.reduce((a, b) => a + b, 0);
    const avg = sum / dataArray.length;
    return Math.round(avg * 100) / 100; // Round to 2 decimal places
}

// Update the chart with new data
function updateChart(data, source = 'unknown') {
    console.log('[updateChart] Called with timestamp:', data.timestamp, 'from source:', source);

    // MODE GUARD: Prevent chart contamination between historical and real-time modes
    const isHistoricalMode = window.currentTimeRange && window.currentTimeRange !== '60m';

    if (isHistoricalMode) {
        // In historical mode, ONLY loadHistoricalThroughput can update chart
        if (source !== 'historical') {
            console.warn('[updateChart] BLOCKED: Historical mode active, ignoring', source, 'update to prevent contamination');
            return;
        }
    } else {
        // In real-time mode (60m), block historical updates
        if (source === 'historical') {
            console.warn('[updateChart] BLOCKED: Real-time mode active, ignoring historical update');
            return;
        }
    }

    // Validate timestamp exists
    if (!data.timestamp) {
        console.warn('No timestamp in data, skipping chart update');
        return;
    }

    // Handle no_data status (no recent data from collector)
    if (data.status === 'no_data') {
        console.warn('No recent throughput data available from collector');
        return; // Don't add to chart - creates gap instead of zero drop
    }

    const timestamp = new Date(data.timestamp);

    // Check if date is valid
    if (isNaN(timestamp.getTime())) {
        console.warn('Invalid timestamp in data:', data.timestamp);
        return;
    }

    // Get user's timezone preference (default to UTC if not set)
    const userTz = window.userTimezone || 'UTC';

    // Format time using user's timezone
    const timeLabel = timestamp.toLocaleTimeString('en-US', {
        timeZone: userTz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    // Deduplicate: Skip if the last data point has the EXACT SAME ISO timestamp
    // Use ISO timestamp comparison instead of formatted time labels to avoid false positives
    if (chartData.timestamps.length > 0 &&
        chartData.timestamps[chartData.timestamps.length - 1] === data.timestamp) {
        // True duplicate - same ISO timestamp - skip silently
        return;
    }

    // Add new data (backend already returns Mbps rates)
    chartData.timestamps.push(data.timestamp);
    chartData.labels.push(timeLabel);
    chartData.inbound.push(data.inbound_mbps);
    chartData.outbound.push(data.outbound_mbps);
    chartData.total.push(data.total_mbps);

    // Keep only the last MAX_DATA_POINTS
    if (chartData.labels.length > MAX_DATA_POINTS) {
        chartData.timestamps.shift();
        chartData.labels.shift();
        chartData.inbound.shift();
        chartData.outbound.shift();
        chartData.total.shift();
    }

    // Update D3 line chart with new data
    updateD3Chart(chartData);
}

// Update stat cards
function updateStats(data) {
    // Safety check: Convert null/undefined to 0
    const inbound = data.inbound_mbps ?? 0;
    const outbound = data.outbound_mbps ?? 0;
    const total = data.total_mbps ?? 0;

    console.log('[DEBUG] updateStats called with:', { inbound, outbound, total });

    // Store historical data for trends (keep last 30 data points = 30 minutes at 60 second intervals)
    historicalData.inbound.push(inbound);
    historicalData.outbound.push(outbound);
    historicalData.total.push(total);
    if (historicalData.inbound.length > 30) {
        historicalData.inbound.shift();
        historicalData.outbound.shift();
        historicalData.total.shift();
    }

    document.getElementById('inboundValue').innerHTML = (inbound !== null && inbound !== undefined ? inbound.toLocaleString() : '--') + calculateTrend(historicalData.inbound);
    document.getElementById('outboundValue').innerHTML = (outbound !== null && outbound !== undefined ? outbound.toLocaleString() : '--') + calculateTrend(historicalData.outbound);
    document.getElementById('totalValue').innerHTML = (total !== null && total !== undefined ? total.toLocaleString() : '--') + calculateTrend(historicalData.total);

    // Calculate 5-minute averages (last 5 samples at 60-second intervals = 300 seconds = 5 minutes)
    const last5Inbound = historicalData.inbound.slice(-5);
    const last5Outbound = historicalData.outbound.slice(-5);
    const last5Total = historicalData.total.slice(-5);

    const inboundAvg = calculateAverage(last5Inbound);
    const outboundAvg = calculateAverage(last5Outbound);
    const totalAvg = calculateAverage(last5Total);

    document.getElementById('inboundAvg').textContent = (inboundAvg !== null && inboundAvg !== undefined ? inboundAvg.toLocaleString() : '--');
    document.getElementById('outboundAvg').textContent = (outboundAvg !== null && outboundAvg !== undefined ? outboundAvg.toLocaleString() : '--');
    document.getElementById('totalAvg').textContent = (totalAvg !== null && totalAvg !== undefined ? totalAvg.toLocaleString() : '--');

    // Update session counts and mini chart
    if (data.sessions) {
        // Store historical data (keep last 30 data points = 30 minutes at 60 second intervals)
        historicalData.sessions.push(data.sessions.active);
        historicalData.tcp.push(data.sessions.tcp);
        historicalData.udp.push(data.sessions.udp);
        historicalData.icmp.push(data.sessions.icmp);
        if (historicalData.sessions.length > 30) {
            historicalData.sessions.shift();
            historicalData.tcp.shift();
            historicalData.udp.shift();
            historicalData.icmp.shift();
        }

        // Session data is now displayed in Firewall Health tiles
        // Old Network Traffic/Active Sessions section has been removed
        miniChartData.sessions.push(data.sessions.active);
        if (miniChartData.sessions.length > MAX_MINI_POINTS) {
            miniChartData.sessions.shift();
        }

        miniChartData.tcp.push(data.sessions.tcp);
        if (miniChartData.tcp.length > MAX_MINI_POINTS) {
            miniChartData.tcp.shift();
        }

        miniChartData.udp.push(data.sessions.udp);
        if (miniChartData.udp.length > MAX_MINI_POINTS) {
            miniChartData.udp.shift();
        }
    }

    // Update CPU metrics and mini charts
    if (data.cpu) {
        // Store historical data
        // Update uptime display in sidebar
        const sidebarUptimeElement = document.getElementById('sidebarUptime');
        if (data.cpu.uptime && sidebarUptimeElement) {
            sidebarUptimeElement.textContent = data.cpu.uptime;
        }

        // PPS is now displayed in Firewall Health tiles
        // Old Network Traffic section has been removed
        // Keep miniChartData tracking for potential future use
        if (data.total_pps !== undefined) {
            miniChartData.pps.push(data.total_pps);
            if (miniChartData.pps.length > MAX_MINI_POINTS) {
                miniChartData.pps.shift();
            }
        }

    }

    // Update PAN-OS version in sidebar
    if (data.panos_version !== undefined) {
        const versionElement = document.getElementById('sidebarPanosVersion');
        if (versionElement) {
            versionElement.textContent = data.panos_version || 'N/A';
        }
    }

    // Update WAN IP in sidebar
    if (data.wan_ip !== undefined) {
        const wanIpElement = document.getElementById('sidebarWanIp');
        if (wanIpElement) {
            wanIpElement.textContent = data.wan_ip || '-';
        }
    }

    // Update WAN speed in sidebar
    if (data.wan_speed !== undefined) {
        const wanSpeedElement = document.getElementById('sidebarWanSpeed');
        if (wanSpeedElement) {
            // Speed is already formatted with Mbps/Gbps suffix from backend
            wanSpeedElement.textContent = data.wan_speed || '-';
        }
    }

    // Update CPU temperature in sidebar
    if (data.cpu_temp !== undefined) {
        const cpuTempElement = document.getElementById('sidebarCpuTemp');
        if (cpuTempElement) {
            if (data.cpu_temp !== null && data.cpu_temp_max !== null) {
                // Format: "45°C / 85°C" (current / max)
                let tempText = `${data.cpu_temp}°C / ${data.cpu_temp_max}°C`;

                // Color code based on temperature thresholds
                let tempColor = '#FA582D';  // Default orange
                const tempPercentage = (data.cpu_temp / data.cpu_temp_max) * 100;

                if (tempPercentage >= 90 || data.cpu_temp_alarm) {
                    tempColor = '#ff4444';  // Red for critical (>90% or alarm)
                } else if (tempPercentage >= 75) {
                    tempColor = '#ff9900';  // Orange for warning (>75%)
                } else {
                    tempColor = '#00cc66';  // Green for normal (<75%)
                }

                cpuTempElement.innerHTML = `<span style="color: ${tempColor}">${tempText}</span>`;
            } else {
                cpuTempElement.textContent = 'N/A';
            }
        }
    }

    // Update interface stats
    if (data.interfaces) {
        const interfaceErrorsElement = document.getElementById('interfaceErrorsValue');
        const interfaceDetailsElement = document.getElementById('interfaceDetails');

        if (interfaceErrorsElement) {
            const totalIssues = data.interfaces.total_errors + data.interfaces.total_drops;

            // Store historical data
            historicalData.interfaceErrors.push(totalIssues);
            if (historicalData.interfaceErrors.length > 30) {
                historicalData.interfaceErrors.shift();
            }

            interfaceErrorsElement.innerHTML = (totalIssues !== null && totalIssues !== undefined ? totalIssues.toLocaleString() : '--') + calculateTrend(historicalData.interfaceErrors);

            if (interfaceDetailsElement) {
                const errors = data.interfaces.total_errors !== null && data.interfaces.total_errors !== undefined ? data.interfaces.total_errors.toLocaleString() : '--';
                const drops = data.interfaces.total_drops !== null && data.interfaces.total_drops !== undefined ? data.interfaces.total_drops.toLocaleString() : '--';
                interfaceDetailsElement.textContent = `${errors} errors, ${drops} drops`;
            }
        }
    }

    // Update top applications
    if (data.top_applications) {
        const topAppsValueElement = document.getElementById('topAppsValue');
        const topAppsContainer = document.getElementById('topAppsContainer');
        const topAppNameElement = document.getElementById('topAppName');

        // Store for modals
        window.currentTopApps = data.top_applications.apps || [];

        // Update total count
        if (topAppsValueElement) {
            topAppsValueElement.textContent = data.top_applications.total_count || 0;
        }

        // Update top application name
        if (topAppNameElement) {
            if (data.top_applications.apps && data.top_applications.apps.length > 0) {
                topAppNameElement.textContent = data.top_applications.apps[0].name;
            } else {
                topAppNameElement.textContent = 'N/A';
            }
        }

        // Update the list of apps
        if (topAppsContainer && data.top_applications.apps && data.top_applications.apps.length > 0) {
            let appsHtml = '';
            data.top_applications.apps.forEach((app) => {
                const barWidth = data.top_applications.apps[0].count > 0 ? (app.count / data.top_applications.apps[0].count * 100) : 0;
                appsHtml += `
                    <div style="margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                            <span style="color: #ffffff; font-size: 0.85em;">${app.name}</span>
                            <span style="color: #ffcc99; font-size: 0.85em; font-weight: 600;">${app.count}</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.2); border-radius: 4px; height: 6px; overflow: hidden;">
                            <div style="background: #ffffff; height: 100%; width: ${barWidth}%; transition: width 0.3s ease;"></div>
                        </div>
                    </div>
                `;
            });
            topAppsContainer.innerHTML = appsHtml;
        } else if (topAppsContainer) {
            topAppsContainer.innerHTML = '<div style="color: rgba(255,255,255,0.7); font-size: 0.85em; text-align: center;">No data</div>';
        }
    }

    // Update threat statistics and logs
    if (data.threats) {
        // Store historical data
        historicalData.criticalThreats.push(data.threats.critical_threats);
        historicalData.mediumThreats.push(data.threats.medium_threats);
        historicalData.blockedUrls.push(data.threats.blocked_urls);
        historicalData.urlFiltering.push(data.threats.url_filtering_total);
        if (historicalData.criticalThreats.length > 30) {
            historicalData.criticalThreats.shift();
            historicalData.mediumThreats.shift();
            historicalData.blockedUrls.shift();
            historicalData.urlFiltering.shift();
        }

        // Store threat logs for modals FIRST (v1.10.14 - configuration-driven)
        window.currentCriticalLogs = data.threats.critical_logs || [];
        window.currentHighLogs = data.threats.high_logs || [];
        window.currentMediumLogs = data.threats.medium_logs || [];
        window.currentBlockedUrlLogs = data.threats.blocked_url_logs || [];

        // v1.10.14: Enterprise configuration-driven threat tile updates
        // Iterate through all configured threat severities
        Object.keys(THREAT_CONFIG).forEach(severity => {
            const config = THREAT_CONFIG[severity];
            const logs = data.threats[config.logsKey] || [];

            // Store logs in global variable for modal access
            window[config.globalLogsVar] = logs;

            // Calculate unique counts (critical/high/medium by threat name, blocked URLs by URL)
            const uniqueItems = new Set();
            logs.forEach(log => {
                if (severity === 'blocked') {
                    // Blocked URLs - use URL field
                    const url = log.url || log.threat || 'Unknown';
                    uniqueItems.add(url);
                } else {
                    // Threats - use threat name
                    const threat = log.threat || 'Unknown';
                    uniqueItems.add(threat);
                }
            });

            // Update count value on tile (null-safe)
            const valueElement = document.getElementById(config.elementIds.value);
            if (valueElement) {
                const count = uniqueItems.size;
                valueElement.innerHTML = (count !== null && count !== undefined ? count.toLocaleString() : '0');
            }

            // Update latest threat/URL name on tile
            const latestElement = document.getElementById(config.elementIds.latest);
            if (latestElement && logs.length > 0) {
                const latestLog = logs[0];
                if (severity === 'blocked') {
                    latestElement.textContent = latestLog.url || latestLog.threat || 'No recent blocks';
                } else {
                    latestElement.textContent = latestLog.threat || 'No recent threats';
                }
            } else if (latestElement) {
                latestElement.textContent = '-';
            }

            // Update "Last seen" timestamp
            const lastSeenElement = document.getElementById(config.elementIds.lastSeen);
            if (lastSeenElement && data.threats[config.lastSeenKey]) {
                lastSeenElement.textContent = formatDaysAgo(data.threats[config.lastSeenKey]);
            }
        });
    }

    // System logs are now on their own page, no need to update here

    // Update license information in sidebar
    if (data.license) {
        const expiredElement = document.getElementById('sidebarLicenseExpired');
        const licensedElement = document.getElementById('sidebarLicenseLicensed');

        if (expiredElement) {
            expiredElement.textContent = data.license.expired || 0;
            // Use light theme color
            expiredElement.style.color = '#F2F0EF';
        }

        if (licensedElement) {
            licensedElement.textContent = data.license.licensed || 0;
            // Use light theme color
            licensedElement.style.color = '#F2F0EF';
        }
    }

    // Update Firewall Health tiles
    updateCyberHealth(data);

    // Update active alerts count
    // Note: updateTopCategory() is now handled within updateCyberHealth() as split view (LAN/Internet)
    updateActiveAlertsCount();
}

function updateThreatLogs(elementId, logs, borderColor) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';

    if (logs.length === 0) {
        container.innerHTML = '<div style="font-size: 0.7em; color: #999; padding: 5px;">No recent matches</div>';
        return;
    }

    // Create table
    const table = document.createElement('table');
    table.className = 'threat-log-table';

    // Create header
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th style="width: 60%;">Threat/URL</th>
            <th style="width: 40%;">Time</th>
        </tr>
    `;
    table.appendChild(thead);

    // Create body
    const tbody = document.createElement('tbody');

    logs.forEach(log => {
        const row = document.createElement('tr');
        row.style.borderLeftColor = borderColor;

        const threat = log.threat || log.url || 'Unknown';
        const src = log.src || 'N/A';
        const dst = log.dst || 'N/A';
        const dport = log.dport || 'N/A';
        const sport = log.sport || 'N/A';
        const action = log.action || 'N/A';
        const app = log.app || 'N/A';
        const category = log.category || 'N/A';
        const severity = log.severity || 'N/A';
        const datetime = log.time ? new Date(log.time) : null;

        // Get user's timezone preference (default to UTC if not set)
        const userTz = window.userTimezone || 'UTC';

        const time = datetime ? datetime.toLocaleTimeString('en-US', {
            timeZone: userTz,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }) : 'N/A';
        const fullTime = datetime ? datetime.toLocaleString('en-US', {
            timeZone: userTz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }) : 'N/A';

        // Build comprehensive tooltip
        let tooltipParts = [
            `Threat/URL: ${threat}`,
            `Time: ${fullTime}`,
            `Source: ${src}:${sport}`,
            `Destination: ${dst}:${dport}`,
            `Action: ${action}`,
            `Application: ${app}`
        ];

        if (severity !== 'N/A') tooltipParts.push(`Severity: ${severity}`);
        if (category !== 'N/A') tooltipParts.push(`Category: ${category}`);

        const tooltip = tooltipParts.join('\n');

        row.innerHTML = `
            <td style="border-left-color: ${borderColor};">
                <div class="threat-name" title="${tooltip}">${threat}</div>
            </td>
            <td style="border-left-color: ${borderColor};">
                <div class="threat-time" title="${tooltip}">${time}</div>
            </td>
        `;

        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);
}

// Initialize and update mini sparkline charts
function createMiniChart(canvasId, color) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    return new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: Array(MAX_MINI_POINTS).fill(''),
            datasets: [{
                data: [],
                borderColor: color,
                backgroundColor: color + '20',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { display: false },
                y: { display: false }
            },
            animation: { duration: 0 }
        }
    });
}

function updateMiniChart(chart, data, color) {
    if (!chart) return;

    chart.data.datasets[0].data = data;
    chart.update('none');
}

// Update status indicator
function updateStatus(isOnline, message = '', deviceName = '') {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    // Guard against null elements (can happen during early page load)
    if (!statusDot || !statusText) {
        console.warn('[STATUS] Status elements not found, skipping update');
        return;
    }

    if (isOnline) {
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');
        // If device name is provided, use it. Otherwise preserve existing text if it already has a device name
        if (deviceName) {
            statusText.textContent = `Connected: ${deviceName}`;
        } else if (!statusText.textContent.includes(':')) {
            // Only change to generic "Connected" if there's no device name already
            statusText.textContent = 'Connected';
        }
        // else: preserve existing "Connected: DeviceName" text
    } else {
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        // Special message for no devices configured
        if (message === 'no_device') {
            statusText.textContent = 'No device connected';
        } else if (deviceName) {
            statusText.textContent = `Disconnected: ${deviceName}`;
        } else if (!statusText.textContent.includes(':')) {
            statusText.textContent = message || 'Disconnected';
        }
        // else: preserve existing "Disconnected: DeviceName" text
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = `Error: ${message}`;
    errorDiv.style.display = 'block';

    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

// Show info message (for non-error informational messages during startup)
function showInfo(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = `Info: ${message}`;
    errorDiv.style.display = 'block';
    // Change background color to info blue instead of error red
    errorDiv.style.background = 'linear-gradient(135deg, #5bc0de 0%, #7dd3f0 100%)';

    setTimeout(() => {
        errorDiv.style.display = 'none';
        // Reset to error red for future error messages
        errorDiv.style.background = '';
    }, 5000);
}

// ============================================================================
// v1.0.7: On-Demand Collection Helper
// Triggers immediate data collection when no recent data exists
// Used on initial page load and device switch to avoid 60s wait
// ============================================================================
async function triggerOnDemandCollection(deviceId) {
    if (!deviceId) {
        console.warn('[ON-DEMAND] No device ID provided, skipping collection');
        return false;
    }

    if (window.onDemandCollectionInProgress) {
        console.log('[ON-DEMAND] Collection already in progress, skipping');
        return false;
    }

    window.onDemandCollectionInProgress = true;
    console.log('[ON-DEMAND] Triggering collection for device:', deviceId);

    try {
        // Queue the collection request
        const collectResponse = await window.apiClient.post('/api/throughput/collect-now', {
            device_id: deviceId
        });

        if (!collectResponse.ok || !collectResponse.data.request_id) {
            console.warn('[ON-DEMAND] Failed to queue collection:', collectResponse.data?.message);
            return false;
        }

        const requestId = collectResponse.data.request_id;
        console.log('[ON-DEMAND] Collection queued, request_id:', requestId);

        // Show info message to user
        showInfo('Collecting data from firewall... Please wait.');

        // Poll for completion (max 12 seconds, every 500ms)
        // Clock process runs every 5 seconds, so typical wait is 5-8 seconds
        for (let i = 0; i < 24; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));

            const elapsedSeconds = Math.round((i + 1) * 0.5);
            console.log(`[ON-DEMAND] Polling... ${elapsedSeconds}s`);

            try {
                const statusResponse = await window.apiClient.get(`/api/throughput/collect-status/${requestId}`);

                if (statusResponse.ok) {
                    const status = statusResponse.data.status;

                    if (status === 'completed') {
                        console.log('[ON-DEMAND] Collection completed - fresh data available');
                        return true;
                    } else if (status === 'failed') {
                        console.warn('[ON-DEMAND] Collection failed:', statusResponse.data.error_message);
                        return false;
                    }
                    // Continue polling if 'queued' or 'running'
                }
            } catch (pollError) {
                console.warn('[ON-DEMAND] Status poll error:', pollError);
                // Continue polling
            }
        }

        console.warn('[ON-DEMAND] Collection timed out after 12 seconds');
        return false;
    } catch (error) {
        console.error('[ON-DEMAND] Collection error:', error);
        return false;
    } finally {
        window.onDemandCollectionInProgress = false;
    }
}

// Make available globally
window.triggerOnDemandCollection = triggerOnDemandCollection;

// Fetch data from API
async function fetchThroughputData() {
    try {
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const params = {};

        // v2.1.18: Always include device_id to ensure correct device data
        // This fixes the issue where metrics showed wrong device data after switching
        if (window.currentDeviceId) {
            params.device_id = window.currentDeviceId;
        }

        if (window.currentTimeRange) {
            params.range = window.currentTimeRange;
        }

        const response = await window.apiClient.get('/api/throughput', { params });

        // ApiClient handles auth/rate limiting/errors automatically
        // Just check response status
        if (!response.ok) {
            console.error('Failed to fetch throughput data');
            updateStatus(false);
            showError('Failed to fetch throughput data. System may be initializing.');
            return;
        }

        const data = response.data;

        // DEBUG: Log the full API response
        console.log('[DEBUG] /api/throughput response:', JSON.stringify(data, null, 2));
        console.log('[DEBUG] Throughput values:', {
            inbound_mbps: data.inbound_mbps,
            outbound_mbps: data.outbound_mbps,
            total_mbps: data.total_mbps
        });

        if (data.status === 'success') {
            updateStats(data);
            updateChart(data);
            updateStatus(true);

        } else if (data.status === 'no_data') {
            // Not an error - system is initializing and waiting for first data collection
            console.log('No recent data available - system initializing');
            updateStatus(false);

            // v1.0.6: Clear "Loading..." states by calling updateCyberHealth with empty data
            // This prevents Firewall Health tiles from being stuck at "Loading..." indefinitely
            updateCyberHealth({
                cpu: { data_plane_cpu: null, memory_used_pct: null },
                total_pps: null,
                sessions: { active: null, tcp: null, udp: null, icmp: null },
                top_category_lan: null,
                top_category_internet: null,
                top_internal_client: null,
                top_internet_client: null,
                top_bandwidth_client_lan: null,
                top_bandwidth_client_internet: null
            });

            // v1.0.7: Automatically trigger on-demand collection on initial page load
            // This eliminates the 60-second wait when starting fresh containers
            if (window.currentDeviceId && !window.onDemandCollectionInProgress) {
                console.log('[APP] No data available - triggering automatic on-demand collection');
                showInfo('No data available. Collecting from firewall...');

                // Trigger collection and refresh data when complete
                triggerOnDemandCollection(window.currentDeviceId).then(success => {
                    if (success) {
                        console.log('[APP] On-demand collection succeeded, refreshing dashboard');
                        // Fetch data again now that collection is complete
                        fetchThroughputData();
                    } else {
                        console.warn('[APP] On-demand collection failed or timed out');
                        showInfo('Data collection taking longer than expected. Dashboard will update automatically.');
                    }
                });
            } else {
                showInfo('Waiting for first data collection. Charts will appear shortly.');
            }

        } else {
            // Actual error case (status: 'error')
            updateStatus(false);
            showError(data.message || 'Failed to fetch data');
        }
    } catch (error) {
        console.error('Fetch error:', error);
        updateStatus(false);
        showError('Connection error: ' + error.message);
    }
}

// Add smooth number animation
function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = current.toFixed(2);
    }, 16);
}

/**
 * Preload recent historical data to populate chart on page load
 * Queries last 30 minutes of data from database to avoid empty chart
 * Also preloads mini chart data for PPS and Sessions
 */
async function preloadChartData() {
    try {
        console.log('Preloading recent historical data for charts...');

        const deviceId = window.currentDeviceId;
        if (!deviceId) {
            console.warn('No device selected for preload, skipping...');
            return;
        }

        // Query data for current time range (Fixed v1.14.1 - was hardcoded to 30m)
        // CRITICAL: Only use main dashboard time ranges (5m, 15m, 30m, 60m)
        // If currentTimeRange is from Insights dashboard (1h, 6h, 24h, etc.), default to 15m
        const mainDashboardRanges = ['5m', '15m', '30m', '60m'];
        let timeRange = window.currentTimeRange || '15m';
        if (!mainDashboardRanges.includes(timeRange)) {
            console.warn(`Time range '${timeRange}' not valid for main dashboard, using '15m'`);
            timeRange = '15m';
        }
        console.log(`Preloading chart data for time range: ${timeRange}`);
        const response = await window.apiClient.get('/api/throughput/history', {
            params: { device_id: deviceId, range: timeRange }
        });
        if (!response.ok) {
            console.error('Failed to preload chart data');
            return;
        }
        const data = response.data;

        if (data.status === 'success' && data.samples && data.samples.length > 0) {
            console.log(`Preloaded ${data.samples.length} historical samples`);

            // Clear existing data
            chartData.timestamps = [];
            chartData.labels = [];
            chartData.inbound = [];
            chartData.outbound = [];
            chartData.total = [];

            // Clear mini chart data
            miniChartData.pps = [];
            miniChartData.sessions = [];
            miniChartData.tcp = [];
            miniChartData.udp = [];

            // Take last MAX_DATA_POINTS for main chart, last MAX_MINI_POINTS for mini charts
            const mainChartSamples = data.samples.slice(-MAX_DATA_POINTS);
            const miniChartSamples = data.samples.slice(-MAX_MINI_POINTS);

            // Populate main chart data arrays
            mainChartSamples.forEach(sample => {
                const userTz = window.userTimezone || 'UTC';
                const timestamp = new Date(sample.timestamp);
                const timeLabel = timestamp.toLocaleTimeString('en-US', {
                    timeZone: userTz,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
                chartData.timestamps.push(sample.timestamp);
                chartData.labels.push(timeLabel);
                chartData.inbound.push(sample.inbound_mbps || 0);
                chartData.outbound.push(sample.outbound_mbps || 0);
                chartData.total.push(sample.total_mbps || 0);
            });

            // Populate mini chart data arrays
            miniChartSamples.forEach(sample => {
                // PPS data
                miniChartData.pps.push(sample.total_pps || 0);

                // Sessions data
                miniChartData.sessions.push(sample.sessions_active || 0);
                miniChartData.tcp.push(sample.sessions_tcp || 0);
                miniChartData.udp.push(sample.sessions_udp || 0);
            });

            // Update main D3 line chart with preloaded data
            updateD3Chart(window.chartData);

            // Update mini charts with preloaded data
            if (ppsChart) {
                updateMiniChart(ppsChart, miniChartData.pps, '#ffffff');
            }
            if (sessionChart) {
                updateMiniChart(sessionChart, miniChartData.sessions, '#ff6600');
            }
            if (tcpChart) {
                updateMiniChart(tcpChart, miniChartData.tcp, '#3b82f6');
            }
            if (udpChart) {
                updateMiniChart(udpChart, miniChartData.udp, '#8b5cf6');
            }

            console.log(`Charts initialized with ${chartData.labels.length} main chart points and ${miniChartData.pps.length} mini chart points`);
        } else {
            console.log('No historical data available for preload');
        }
    } catch (error) {
        console.error('Error preloading chart data:', error);
        // Continue with empty chart if preload fails
    }
}

/**
 * Load device metadata cache for dashboard use
 * This populates the global metadata cache so dashboard can show custom names
 */
async function loadDeviceMetadataCache() {
    try {
        console.log('Loading device metadata cache for dashboard...');

        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const response = await window.apiClient.get('/api/device-metadata');

        if (!response.ok) {
            console.warn('Failed to load device metadata:', response.status);
            return;
        }

        const data = response.data;

        if (data.status === 'success' && data.metadata) {
            // Store metadata in global cache, keyed by MAC address (normalized to lowercase)
            window.deviceMetadataCache = {};
            Object.keys(data.metadata).forEach(mac => {
                const normalizedMac = mac.toLowerCase();
                window.deviceMetadataCache[normalizedMac] = data.metadata[mac];
            });

            console.log(`Loaded metadata for ${Object.keys(window.deviceMetadataCache).length} devices`);
        }
    } catch (error) {
        console.error('Error loading device metadata cache:', error);
        // Continue without metadata if it fails
    }
}

// Initialize the application
let isInitialized = false;
async function init() {
    if (isInitialized) {
        console.log('App already initialized, skipping...');
        return;
    }

    console.log('Initializing Palo Alto Firewall Monitor...');
    isInitialized = true;

    // FIX v2.1.17: Safeguard for device selection race condition
    // If window.currentDeviceId is not set, wait briefly for initializeCurrentDevice() to complete
    // This handles the case where init() runs before the async auto-select POST finishes
    if (!window.currentDeviceId) {
        console.warn('[INIT] No device ID set yet, waiting for auto-selection...');
        await new Promise(resolve => setTimeout(resolve, 100));
        // Double-check after wait
        if (!window.currentDeviceId) {
            console.warn('[INIT] Still no device ID after wait, initialization may show empty data initially');
        } else {
            console.log('[INIT] Device ID now available:', window.currentDeviceId);
        }
    }

    // OPTIMIZATION: Parallelize independent API calls for faster loading
    console.log('[OPTIMIZATION] Loading settings, devices, and metadata in parallel...');
    const startTime = performance.now();

    const [settingsResult, devicesResult, metadataResult] = await Promise.allSettled([
        initSettings(),
        (typeof initDeviceSelector === 'function') ? initDeviceSelector() : Promise.resolve(),
        loadDeviceMetadataCache()
    ]);

    const loadTime = (performance.now() - startTime).toFixed(0);
    console.log(`[OPTIMIZATION] Parallel loading completed in ${loadTime}ms`);

    // Check for failures
    if (settingsResult.status === 'rejected') {
        console.error('[OPTIMIZATION] Failed to load settings:', settingsResult.reason);
    }
    if (devicesResult.status === 'rejected') {
        console.error('[OPTIMIZATION] Failed to load devices:', devicesResult.reason);
    } else if (devicesResult.status === 'fulfilled') {
        console.log('Devices loaded on initialization');
    }
    if (metadataResult.status === 'rejected') {
        console.error('[OPTIMIZATION] Failed to load metadata:', metadataResult.reason);
    }

    // Initialize page navigation (menu clicks)
    initPageNavigation();

    // Initialize mini charts (destroy existing ones first to avoid "Canvas already in use" error)
    if (sessionChart) sessionChart.destroy();
    if (tcpChart) tcpChart.destroy();
    if (udpChart) udpChart.destroy();
    if (ppsChart) ppsChart.destroy();

    sessionChart = createMiniChart('sessionChart', '#ffffff');
    tcpChart = createMiniChart('tcpChart', '#3b82f6');
    udpChart = createMiniChart('udpChart', '#8b5cf6');
    ppsChart = createMiniChart('ppsChart', '#ffffff');

    // Set up interface update button
    const updateInterfaceBtn = document.getElementById('updateInterfaceBtn');
    if (updateInterfaceBtn) {
        updateInterfaceBtn.addEventListener('click', updateMonitoredInterface);
    }

    // Set up logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Set up time range dropdown
    const timeRangeSelect = document.getElementById('timeRangeSelect');
    if (timeRangeSelect) {
        // Set initial value based on saved time range
        timeRangeSelect.value = window.currentTimeRange;

        // CRITICAL FIX (v1.14.1): If localStorage has invalid value (e.g., '1h' but dropdown only has '60m'),
        // the dropdown.value assignment fails silently. We must detect this and sync to dropdown's actual value.
        if (timeRangeSelect.value !== window.currentTimeRange) {
            console.warn(`Time range mismatch: localStorage='${window.currentTimeRange}' but dropdown='${timeRangeSelect.value}'`);
            console.warn(`Syncing to dropdown value: ${timeRangeSelect.value}`);
            window.currentTimeRange = timeRangeSelect.value;
            localStorage.setItem('timeRange', timeRangeSelect.value);
        }

        // Handle dropdown change
        timeRangeSelect.addEventListener('change', () => {
            handleTimeRangeChange(timeRangeSelect.value);
        });
    }

    // ============================================================
    // ENTERPRISE DATA SERVICE INITIALIZATION (v2.1.0)
    // ============================================================

    try {
        // Initialize ThroughputDataService with current device
        const deviceId = window.currentDeviceId;
        if (deviceId && window.throughputService) {
            console.log('[INIT] Initializing ThroughputDataService...');

            // Subscribe BEFORE initialization so we catch the first snapshot update
            window.throughputService.subscribe('snapshot:update', async (data) => {
                console.log('[SERVICE] Received snapshot update, updating dashboard tiles and chart');
                console.log('[SERVICE] Snapshot data:', data);
                updateCyberHealth(data);
                updateStats(data);  // CRITICAL FIX: Update throughput values in graph header

                // CRITICAL FIX: Update chart with new data point (append to historical data)
                appendSnapshotToChart(data);

                // Also fetch threats (independent of throughput data)
                await fetchThreatData();

                // FIX #3: Update chord diagrams with proper error handling and D3.js check
                if (typeof loadChordDiagrams === 'function' && typeof d3 !== 'undefined') {
                    try {
                        await loadChordDiagrams();
                    } catch (error) {
                        console.error('[SERVICE] Error loading chord diagrams:', error);
                    }
                }

                // Update tag-filtered chord diagram (only if tags are selected)
                if (typeof loadTagFilteredChordDiagram === 'function' && typeof d3 !== 'undefined') {
                    try {
                        const tagSelect = document.getElementById('chordTagFilter');
                        if (tagSelect && tagSelect.selectedOptions.length > 0) {
                            await loadTagFilteredChordDiagram();
                        }
                    } catch (error) {
                        console.error('[SERVICE] Error loading tag-filtered chord diagram:', error);
                    }
                }
            });

            // Subscribe to device changes (clear old data)
            window.throughputService.subscribe('device:change', ({ newDeviceId }) => {
                console.log(`[SERVICE] Device changed to: ${newDeviceId}`);
                // Chart will be refreshed by loadHistoricalThroughput
            });

            // Subscribe to waiting state
            window.throughputService.subscribe('waiting', (data) => {
                console.log('[SERVICE] Waiting for data collection:', data.message);
            });

            // Subscribe to no_data events (v2.1.1 - collector has no recent data)
            window.throughputService.subscribe('no_data', (data) => {
                console.log('[SERVICE] No recent data from collector:', data.message);
                // Don't try to append to chart - no valid timestamp
            });

            // Subscribe to errors
            window.throughputService.subscribe('error', ({ type, error }) => {
                console.error(`[SERVICE] Data service error (${type}):`, error);
            });

            // Now initialize with settings (this will start auto-refresh)
            const settings = window.appSettings || {};
            console.log('[INIT] Initializing ThroughputDataService with settings:', settings);
            await window.throughputService.initialize(deviceId, settings);
            console.log('[INIT] ThroughputDataService initialized with refresh interval:', settings.refresh_interval);

            // Explicitly fetch snapshot to ensure tiles are populated
            console.log('[INIT] Fetching initial snapshot for dashboard tiles...');
            const initialSnapshot = await window.throughputService.getSnapshot();
            if (initialSnapshot && initialSnapshot.status === 'success') {
                console.log('[INIT] Initial snapshot received, updating tiles');
                updateCyberHealth(initialSnapshot);
                updateStats(initialSnapshot);  // CRITICAL FIX: Update throughput values in graph header
            } else {
                console.warn('[INIT] Initial snapshot not ready:', initialSnapshot);
            }

            // Fetch threats independently (NOT tied to throughput time range)
            console.log('[INIT] Fetching threat data independently...');
            await fetchThreatData();
        }

        // Load historical data for the selected time range on initialization
        console.log(`[INIT] Loading historical data for time range: ${window.currentTimeRange}`);
        await loadHistoricalThroughput(window.currentTimeRange);

        // Load chord diagrams for traffic flow visualization on homepage (with D3.js check)
        if (typeof loadChordDiagrams === 'function' && typeof d3 !== 'undefined') {
            console.log('[INIT] Loading chord diagrams for client-destination traffic flows...');
            try {
                await loadChordDiagrams();
            } catch (error) {
                console.error('[INIT] Error loading chord diagrams:', error);
            }
        }

        // Populate tag filter dropdown and load tag-filtered diagram (if tags selected)
        if (typeof populateTagFilterDropdown === 'function') {
            console.log('[INIT] Populating tag filter dropdown...');
            try {
                await populateTagFilterDropdown();
                // Note: Don't auto-load tag diagram - wait for user to select tags
            } catch (error) {
                console.error('[INIT] Error populating tag filter dropdown:', error);
            }
        }

        // Service auto-refresh is already running (updates tiles every 60s)
        // Chart stays static with historical data
        console.log('✓ Historical data loaded - dashboard in historical mode');
    } catch (error) {
        console.error('[INIT] Error initializing ThroughputDataService:', error);
    }
}

/**
 * Initialize current device ID from settings (Enterprise Fix v1.12.0, v1.0.5 Lock)
 * Ensures window.currentDeviceId is set before any page loads
 * This prevents blank device_id errors in Analytics and other pages
 *
 * v1.0.5: Added initialization lock to prevent race conditions where multiple
 * modules try to initialize/auto-select devices simultaneously.
 */
async function initializeCurrentDevice() {
    console.log('[DEVICE-INIT] Initializing current device...');

    // v1.0.5: Prevent concurrent initialization (race condition fix)
    if (window.deviceInitializing) {
        console.log('[DEVICE-INIT] Already initializing, waiting for completion...');
        // Wait for existing initialization to complete
        while (window.deviceInitializing) {
            await new Promise(r => setTimeout(r, 50));
        }
        console.log('[DEVICE-INIT] Initialization completed by other caller:', window.currentDeviceId);
        return window.currentDeviceId;
    }

    // v1.0.5: Already fully initialized - return immediately
    if (window.deviceInitialized && window.currentDeviceId && window.currentDeviceId.trim() !== '') {
        console.log('[DEVICE-INIT] Already initialized:', window.currentDeviceId);
        return window.currentDeviceId;
    }

    // Set lock to prevent concurrent initialization
    window.deviceInitializing = true;
    console.log('[DEVICE-INIT] Lock acquired, starting initialization...');

    try {
        // Check if already set (without lock check)
        if (window.currentDeviceId && window.currentDeviceId.trim() !== '') {
            console.log('[DEVICE-INIT] Device already set:', window.currentDeviceId);
            window.deviceInitialized = true;
            return window.currentDeviceId;
        }

        // Fetch current selected device from settings API (source of truth)
        try {
            // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
            const response = await window.apiClient.get('/api/settings');

            if (!response.ok) {
                throw new Error(`Failed to load settings: ${response.status}`);
            }

            const data = response.data;

            if (data.status === 'success' && data.settings) {
                const deviceId = data.settings.selected_device_id || '';
                window.currentDeviceId = deviceId;

                // Store global settings for use across all pages (v1.0.12)
                window.panfmSettings = window.panfmSettings || {};
                window.panfmSettings.reverse_dns_enabled = data.settings.reverse_dns_enabled || false;
                console.log('[Global] Reverse DNS enabled:', window.panfmSettings.reverse_dns_enabled);

                // OPTIMIZATION: Cache settings to avoid duplicate fetch in initSettings()
                window.CacheUtil.set('settings', data.settings, 5 * 60 * 1000);
                console.log('[Global] Settings cached for 5 minutes');

                if (deviceId && deviceId.trim() !== '') {
                    console.log('[DEVICE-INIT] Loaded device from settings:', deviceId);
                    window.deviceInitialized = true;
                    return deviceId;
                } else {
                    console.warn('[DEVICE-INIT] No device selected in settings');
                }
            }
        } catch (error) {
            console.error('[DEVICE-INIT] Failed to fetch settings:', error);
        }

        // If no device selected, try to auto-select first enabled device
        try {
            // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
            const devicesResponse = await window.apiClient.get('/api/devices');

            if (!devicesResponse.ok) {
                throw new Error(`Failed to load devices: ${devicesResponse.status}`);
            }

            const devicesData = devicesResponse.data;

            if (devicesData.devices && devicesData.devices.length > 0) {
                // Find first enabled device
                const firstEnabledDevice = devicesData.devices.find(d => d.enabled !== false);

                if (firstEnabledDevice) {
                    window.currentDeviceId = firstEnabledDevice.id;
                    console.log('[DEVICE-INIT] Auto-selected first enabled device:', firstEnabledDevice.name);

                    // Persist selection to settings using ApiClient (CSRF token auto-injected)
                    try {
                        await window.apiClient.post('/api/settings', {
                            selected_device_id: firstEnabledDevice.id
                        });
                        console.log('[DEVICE-INIT] Persisted device selection to settings');
                    } catch (error) {
                        console.warn('[DEVICE-INIT] Failed to persist device selection:', error);
                    }

                    window.deviceInitialized = true;
                    return firstEnabledDevice.id;
                } else {
                    console.warn('[DEVICE-INIT] No enabled devices found');
                }
            } else {
                console.warn('[DEVICE-INIT] No devices configured');
            }
        } catch (error) {
            console.error('[DEVICE-INIT] Failed to fetch devices:', error);
        }

        // No device available
        window.currentDeviceId = '';
        console.warn('[DEVICE-INIT] No device initialized - user must select one');
        return '';
    } finally {
        // v1.0.5: Always release the lock when done
        window.deviceInitializing = false;
        console.log('[DEVICE-INIT] Lock released, initialized:', window.deviceInitialized);
    }
}

// Export for use by other modules
window.initializeCurrentDevice = initializeCurrentDevice;

// ============================================================================
// Sidebar Separator Auto-Hide Functionality
// ============================================================================

/**
 * Initialize auto-hide behavior for the sidebar separator line
 * - Hides the orange separator line after 3 seconds of inactivity
 * - Shows it on hover over the sidebar
 * - Resets the timer on any mouse movement or interaction
 */
function initSidebarSeparatorAutoHide() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    let hideTimeout;
    const HIDE_DELAY = 3000; // 3 seconds

    // Function to show the separator
    function showSeparator() {
        sidebar.classList.remove('separator-hidden');
        resetHideTimer();
    }

    // Function to hide the separator
    function hideSeparator() {
        sidebar.classList.add('separator-hidden');
    }

    // Function to reset the hide timer
    function resetHideTimer() {
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(hideSeparator, HIDE_DELAY);
    }

    // Show on any mouse movement
    document.addEventListener('mousemove', showSeparator);

    // Show on sidebar interaction
    sidebar.addEventListener('mouseenter', showSeparator);
    sidebar.addEventListener('click', showSeparator);

    // Initial hide after delay
    resetHideTimer();

    console.log('[APP.JS] Sidebar separator auto-hide initialized');
}

/**
 * Initialize sidebar collapse/expand toggle functionality
 * - Collapses sidebar to maximize screen space
 * - Persists state in localStorage
 * - Updates toggle button icon based on state
 */
function initSidebarToggle() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    const toggleIcon = document.getElementById('toggleIcon');

    if (!sidebar || !toggleBtn || !toggleIcon) return;

    // Load saved state from localStorage
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        toggleIcon.textContent = '▶';
    }

    // Toggle sidebar on button click
    toggleBtn.addEventListener('click', () => {
        const willCollapse = !sidebar.classList.contains('collapsed');

        if (willCollapse) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
            toggleIcon.textContent = '▶';
            localStorage.setItem('sidebarCollapsed', 'true');
        } else {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
            toggleIcon.textContent = '◀';
            localStorage.setItem('sidebarCollapsed', 'false');
        }

        console.log(`[APP.JS] Sidebar ${willCollapse ? 'collapsed' : 'expanded'}`);
    });

    console.log('[APP.JS] Sidebar toggle initialized');
}

/**
 * Toggle mobile sidebar (hamburger menu)
 * Used on mobile/tablet screens
 */
function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    const menuBtn = document.querySelector('.mobile-menu-btn');

    if (!sidebar) return;

    const isExpanded = sidebar.classList.contains('expanded');

    if (isExpanded) {
        // Close sidebar
        sidebar.classList.remove('expanded');
        if (overlay) overlay.classList.remove('active');
        if (menuBtn) menuBtn.classList.remove('active');
        document.body.style.overflow = ''; // Re-enable scroll
    } else {
        // Open sidebar
        sidebar.classList.add('expanded');
        if (overlay) overlay.classList.add('active');
        if (menuBtn) menuBtn.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scroll
    }

    console.log(`[APP.JS] Mobile sidebar ${isExpanded ? 'closed' : 'opened'}`);
}

// Make toggleMobileSidebar available globally
window.toggleMobileSidebar = toggleMobileSidebar;

// Start the app when DOM is ready (initialize device first!)
console.log('[APP.JS] Script loaded - DOMContentLoaded listener registered');

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[APP.JS] DOMContentLoaded fired - starting initialization...');

    // Initialize device first (critical for all pages)
    await initializeCurrentDevice();

    // Then run normal initialization
    await init();  // Fixed: await the async function

    // Load dashboard time range from server settings (persists across reboots)
    await loadDashboardTimeRange();

    // Note: Tag filter event listener removed - now using modal interface
    // Modal functions: openChordTagFilterModal(), applyChordTagFilter()

    // Initialize auto-hide sidebar separator
    initSidebarSeparatorAutoHide();

    // Initialize sidebar collapse/expand toggle
    initSidebarToggle();

    console.log('[APP.JS] Initialization complete');
});

// ============================================================================
// Historical Throughput Functionality
// ============================================================================

// Current time range - global so modals can check if in historical mode
// Load from localStorage if available, otherwise default to '15m'
// CRITICAL FIX (v1.14.1): Validate that loaded value is in allowed list
// NOTE: validTimeRanges MUST match the actual options in the HTML dropdown (templates/index.html)
const validTimeRanges = ['5m', '15m', '30m', '60m'];
const DEFAULT_TIME_RANGE = '15m';  // Default to 15 minutes
const storedTimeRange = localStorage.getItem('timeRange');
console.log('[TIME RANGE] Loaded from localStorage:', storedTimeRange);
if (storedTimeRange && validTimeRanges.includes(storedTimeRange)) {
    window.currentTimeRange = storedTimeRange;
    console.log('[TIME RANGE] Using saved time range:', storedTimeRange);
} else {
    console.warn(`[TIME RANGE] Invalid time range in localStorage: '${storedTimeRange}', defaulting to '${DEFAULT_TIME_RANGE}'`);
    window.currentTimeRange = DEFAULT_TIME_RANGE;
    localStorage.setItem('timeRange', DEFAULT_TIME_RANGE);
}

/**
 * Handle time range dropdown change
 */
async function handleTimeRangeChange(range) {
    console.log('=== TIME RANGE CHANGED (v1.14.1 FIX ACTIVE) ===');
    console.log('New time range:', range);
    console.log('This should load ONLY', range, 'of data, not 24 hours');
    window.currentTimeRange = range;

    // Save to localStorage for immediate site-wide persistence
    localStorage.setItem('timeRange', range);
    console.log('[TIME RANGE] Saved to localStorage:', range);

    // Save to server settings for persistence across reboots/browser sessions
    saveDashboardTimeRange(range);

    // Update dropdown value if it exists (for consistency across pages)
    const timeRangeSelect = document.getElementById('timeRangeSelect');
    if (timeRangeSelect && timeRangeSelect.value !== range) {
        timeRangeSelect.value = range;
    }

    // Always load historical data for the selected time range
    // Stop real-time updates
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
        updateIntervalId = null;
    }

    // Load historical data for the selected range
    await loadHistoricalThroughput(range);
}

/**
 * Save dashboard time range to server settings for persistence across reboots
 */
async function saveDashboardTimeRange(range) {
    try {
        // Get current settings
        const getResponse = await window.apiClient.get('/api/settings');
        if (!getResponse.ok) {
            console.warn('[TIME RANGE] Failed to get settings for saving time range');
            return;
        }

        const settings = getResponse.data;
        settings.dashboard_time_range = range;

        // Save updated settings
        const saveResponse = await window.apiClient.post('/api/settings', settings);
        if (saveResponse.ok) {
            console.log('[TIME RANGE] Saved to server settings:', range);
        } else {
            console.warn('[TIME RANGE] Failed to save time range to server');
        }
    } catch (error) {
        console.error('[TIME RANGE] Error saving to server:', error);
    }
}

/**
 * Load dashboard time range from server settings (for persistence across reboots)
 */
async function loadDashboardTimeRange() {
    try {
        const response = await window.apiClient.get('/api/settings');
        if (response.ok && response.data.dashboard_time_range) {
            const serverRange = response.data.dashboard_time_range;
            if (validTimeRanges.includes(serverRange)) {
                console.log('[TIME RANGE] Loaded from server settings:', serverRange);
                window.currentTimeRange = serverRange;
                localStorage.setItem('timeRange', serverRange);

                // Update dropdown if present
                const timeRangeSelect = document.getElementById('timeRangeSelect');
                if (timeRangeSelect) {
                    timeRangeSelect.value = serverRange;
                }
                return serverRange;
            }
        }
    } catch (error) {
        console.warn('[TIME RANGE] Could not load from server, using localStorage/default');
    }
    return null;
}

/**
 * Fetch threat data from dedicated /api/threats endpoint
 * Completely independent of throughput time range selection
 * This keeps threat data separate from network throughput metrics
 */
async function fetchThreatData() {
    try {
        console.log('[THREATS] Fetching threat data (independent of time range)');

        // v1.0.5: Pass device_id to eliminate race conditions
        // This ensures we get threats for the correct device even during device switching
        const url = buildDeviceUrl('/api/threats');
        const response = await window.apiClient.get(url);

        if (!response.ok) {
            console.warn('[THREATS] Failed to fetch threat data');
            return;
        }

        const data = response.data;

        // Handle waiting status (collector not ready)
        if (data.status === 'waiting') {
            console.log('[THREATS] Waiting for first collection');
            return;
        }

        // Update threat tiles using isolated function
        if (data.status === 'success' && data.threats) {
            updateThreatTilesOnly(data.threats);
            console.log('[THREATS] Updated threat tiles from independent endpoint');
        }
    } catch (error) {
        console.error('[THREATS] Error fetching threat data:', error);
    }
}

/**
 * Append new snapshot data to chart (for auto-refresh)
 * CRITICAL FIX: This makes the chart auto-update with new data points
 */
function appendSnapshotToChart(data) {
    if (!data || !data.timestamp) {
        console.warn('[CHART] Cannot append snapshot - missing timestamp');
        return;
    }

    // Don't append if chart or chartData not initialized
    if (!window.chart || !window.chartData) {
        console.warn('[CHART] Chart not initialized, skipping append');
        return;
    }

    // Get user's timezone preference
    const userTz = window.userTimezone || 'UTC';

    // Format timestamp for display
    const timestamp = new Date(data.timestamp);
    const timeLabel = timestamp.toLocaleTimeString('en-US', {
        timeZone: userTz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    // Extract throughput values (with fallback to 0)
    const inbound = parseFloat(data.inbound_mbps) || 0;
    const outbound = parseFloat(data.outbound_mbps) || 0;
    const total = parseFloat(data.total_mbps) || 0;

    console.log(`[CHART] Appending new data point: ${timeLabel} - Total: ${total.toFixed(2)} Mbps`);

    // Append new data to chartData arrays
    window.chartData.timestamps.push(data.timestamp);
    window.chartData.labels.push(timeLabel);
    window.chartData.inbound.push(inbound);
    window.chartData.outbound.push(outbound);
    window.chartData.total.push(total);

    // Calculate max data points based on time range
    // Keep enough points to fill the time range (1 point per minute)
    const maxDataPoints = getMaxDataPointsForTimeRange(window.currentTimeRange);

    // Trim old data if exceeding max points (sliding window)
    if (window.chartData.labels.length > maxDataPoints) {
        const removeCount = window.chartData.labels.length - maxDataPoints;
        console.log(`[CHART] Trimming ${removeCount} old data points (max: ${maxDataPoints})`);

        window.chartData.timestamps.splice(0, removeCount);
        window.chartData.labels.splice(0, removeCount);
        window.chartData.inbound.splice(0, removeCount);
        window.chartData.outbound.splice(0, removeCount);
        window.chartData.total.splice(0, removeCount);
    }

    // Update D3 line chart
    updateD3Chart(window.chartData);

    console.log(`[CHART] Chart updated with ${window.chartData.labels.length} total points`);
}

/**
 * Get maximum data points to keep based on time range
 */
function getMaxDataPointsForTimeRange(range) {
    // Data is collected every 1 minute, so max points = minutes in range
    const maxPoints = {
        '5m': 5,
        '15m': 15,
        '30m': 30,
        '60m': 60
    };
    return maxPoints[range] || 60; // Default to 60 if unknown range
}

/**
 * Load historical throughput data
 */
async function loadHistoricalThroughput(range) {
    try {
        console.log('Loading historical data for range:', range);

        const deviceId = window.currentDeviceId;
        if (!deviceId) {
            console.warn('No device selected');
            return;
        }

        // ============================================================
        // ENTERPRISE DATA SERVICE (v2.1.0)
        // Use ThroughputDataService for cached, deduplicated data
        // ============================================================

        let samples = [];

        if (window.throughputService) {
            // Use service (with smart caching)
            console.log('[SERVICE] Fetching historical data via ThroughputDataService');
            samples = await window.throughputService.getHistorical(range);
        } else {
            // Fallback to direct API call (backward compatibility)
            console.warn('[FALLBACK] ThroughputDataService not available, using direct API call');
            const response = await window.apiClient.get('/api/throughput/history', {
                params: { device_id: deviceId, range: range }
            });

            if (response.status === 'waiting') {
                console.log('⏳ Historical data not ready yet, waiting...');
                console.log(response.data.message || 'Waiting for first data collection');
                return;
            }

            if (response.status === 'error' || !response.ok) {
                console.error('Failed to load historical data:', response.data?.message || 'Unknown error');
                return;
            }

            samples = response.data.samples || [];
        }

        // Handle empty samples
        if (!samples || samples.length === 0) {
            console.log('No historical samples available yet');
            return;
        }

        console.log(`Loaded ${samples.length} historical samples for range: ${range}`);
        console.log(`First sample timestamp: ${samples[0].timestamp}`);
        console.log(`Last sample timestamp: ${samples[samples.length - 1].timestamp}`);

        // Clear both chartData and chart datasets
        window.chartData.timestamps = [];
        window.chartData.labels = [];
        window.chartData.inbound = [];
        window.chartData.outbound = [];
        window.chartData.total = [];

        // Get user's timezone preference (default to UTC if not set)
        const userTz = window.userTimezone || 'UTC';

        // Add historical data to chartData object
        samples.forEach(sample => {
            const timestamp = new Date(sample.timestamp);
            const timeLabel = timestamp.toLocaleTimeString('en-US', {
                timeZone: userTz,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            window.chartData.timestamps.push(sample.timestamp);
            window.chartData.labels.push(timeLabel);
            window.chartData.inbound.push(sample.inbound_mbps || 0);
            window.chartData.outbound.push(sample.outbound_mbps || 0);
            window.chartData.total.push(sample.total_mbps || 0);
        });

        // Update D3 line chart from chartData
        console.log(`[CHART] Updating chart with ${window.chartData.labels.length} data points`);
        console.log(`[CHART] First label: ${window.chartData.labels[0]}, Last label: ${window.chartData.labels[window.chartData.labels.length - 1]}`);
        console.log(`[CHART] Inbound range: ${Math.min(...window.chartData.inbound).toFixed(2)} - ${Math.max(...window.chartData.inbound).toFixed(2)} Mbps`);
        console.log(`[CHART] Outbound range: ${Math.min(...window.chartData.outbound).toFixed(2)} - ${Math.max(...window.chartData.outbound).toFixed(2)} Mbps`);

        updateD3Chart(window.chartData);

        // Auto-load statistics and display them inline
        loadHistoricalStats(range);

        // Threat data is fetched independently via service subscription
        // No need to call it here - threats are NOT tied to time range selection
        // The ThroughputDataService automatically updates threats via updateCyberHealth()
    } catch (error) {
        console.error('Error loading historical data:', error);
    }
}

/**
 * Load historical statistics and display inline
 */
async function loadHistoricalStats(range) {
    try {
        const deviceId = window.currentDeviceId;
        if (!deviceId) return;

        const response = await window.apiClient.get('/api/throughput/history/stats', {
            params: { device_id: deviceId, range: range }
        });
        if (!response.ok) {
            console.error('Failed to load historical stats');
            return;
        }
        const data = response.data;

        if (data.status === 'success' && data.stats) {
            // Update average values (already displayed)
            document.getElementById('inboundAvg').textContent = data.stats.inbound_mbps.avg;
            document.getElementById('outboundAvg').textContent = data.stats.outbound_mbps.avg;
            document.getElementById('totalAvg').textContent = data.stats.total_mbps.avg;

            // Show and update min/max inline
            const inboundMinMax = document.getElementById('inboundMinMax');
            inboundMinMax.textContent = `(min: ${data.stats.inbound_mbps.min}, max: ${data.stats.inbound_mbps.max})`;
            inboundMinMax.style.display = 'inline';

            const outboundMinMax = document.getElementById('outboundMinMax');
            outboundMinMax.textContent = `(min: ${data.stats.outbound_mbps.min}, max: ${data.stats.outbound_mbps.max})`;
            outboundMinMax.style.display = 'inline';

            const totalMinMax = document.getElementById('totalMinMax');
            totalMinMax.textContent = `(min: ${data.stats.total_mbps.min}, max: ${data.stats.total_mbps.max})`;
            totalMinMax.style.display = 'inline';

            // Show sample count (null-safe)
            const sampleCountDisplay = document.getElementById('sampleCountDisplay');
            const sampleCount = document.getElementById('historicalSampleCount');
            sampleCount.textContent = (data.sample_count !== null && data.sample_count !== undefined ? data.sample_count.toLocaleString() : '--');
            sampleCountDisplay.style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// ============================================================================
// Logout Functionality
// ============================================================================

/**
 * Handle logout - clears session and redirects to login page
 */
async function handleLogout() {
    try {
        // Call logout API using ApiClient (v1.14.0 - CSRF token auto-injected)
        const response = await window.apiClient.post('/api/logout');

        // Redirect to login page regardless of response
        // This ensures user is logged out even if API call fails
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        // Still redirect to login page on error
        window.location.href = '/login';
    }
}

// updateMonitoredInterface function moved to devices.js where selectedDeviceId and currentDevices are defined

// Sidebar resize functionality
function initSidebarResize() {
    const sidebar = document.querySelector('.sidebar');
    const resizeHandle = document.querySelector('.resize-handle');
    let isResizing = false;

    resizeHandle.addEventListener('mousedown', () => {
        isResizing = true;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const newWidth = e.clientX;
        const minWidth = parseInt(getComputedStyle(sidebar).minWidth);
        const maxWidth = parseInt(getComputedStyle(sidebar).maxWidth);

        if (newWidth >= minWidth && newWidth <= maxWidth) {
            sidebar.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

// ===================================================================================
// Page Navigation - MOVED TO app-navigation.js (v1.0.15 - File Size Reduction)
// ===================================================================================
// All page navigation code has been extracted to static/app-navigation.js
// Functions available globally via window.* exports:
// - initPageNavigation(), getCurrentVisiblePage(), setCurrentVisiblePage()
// - initLogsTabSwitching(), initDeviceInfoTabSwitching(), initSoftwareSubTabSwitching()
// ===================================================================================

// Backward compatibility: reference window.currentVisiblePage from navigation module
// This getter ensures code that reads currentVisiblePage still works
Object.defineProperty(window, 'currentVisiblePageCompat', {
    get: function() { return window.currentVisiblePage || 'homepage'; }
});

/**
 * Clear ALL data displays visually (v2.1.19 - Visual Reset Fix)
 *
 * This function performs ONLY visual clearing of UI elements, without loading new data.
 * Used during device switching to show user that data is being reset BEFORE the overlay appears.
 *
 * Called by: onDeviceChange() in devices.js BEFORE showing the loading overlay
 *
 * @returns {Promise<void>}
 */
async function clearAllDataDisplays() {
    console.log('=== clearAllDataDisplays called (v2.1.19) ===');

    // ========================================================================
    // 1. CLEAR MAIN CHART DATA
    // ========================================================================
    chartData.timestamps = [];
    chartData.labels = [];
    chartData.inbound = [];
    chartData.outbound = [];
    chartData.total = [];

    // Clear D3 line chart visually and force re-initialization on next update
    // v2.1.20: Set d3Chart to null to force full re-initialization
    // This fixes the chart not fully redrawing after device switch
    if (window.d3Chart && window.d3Chart.g) {
        window.d3Chart.g.selectAll("*").remove();
    }
    // Force D3 chart to reinitialize on next updateD3Chart() call
    window.d3Chart = null;

    // ========================================================================
    // 2. CLEAR HISTORICAL DATA ARRAYS
    // ========================================================================
    historicalData.inbound = [];
    historicalData.outbound = [];
    historicalData.total = [];
    historicalData.sessions = [];
    historicalData.tcp = [];
    historicalData.udp = [];
    historicalData.icmp = [];
    historicalData.criticalThreats = [];
    historicalData.mediumThreats = [];
    historicalData.blockedUrls = [];
    historicalData.urlFiltering = [];
    historicalData.interfaceErrors = [];

    // ========================================================================
    // 3. CLEAR CHORD DIAGRAMS
    // ========================================================================
    if (typeof d3 !== 'undefined') {
        const chordInternalSvg = d3.select('#chordInternalSvg');
        if (!chordInternalSvg.empty()) {
            chordInternalSvg.selectAll('*').remove();
        }
        const chordInternetSvg = d3.select('#chordInternetSvg');
        if (!chordInternetSvg.empty()) {
            chordInternetSvg.selectAll('*').remove();
        }
        const chordTagSvg = d3.select('#chordTagSvg');
        if (!chordTagSvg.empty()) {
            chordTagSvg.selectAll('*').remove();
        }
    }

    // Show loading state in chord diagram placeholders
    const chordInternalLoading = document.getElementById('chordInternalLoading');
    const chordInternetLoading = document.getElementById('chordInternetLoading');
    const chordTagLoading = document.getElementById('chordTagLoading');

    if (chordInternalLoading) {
        chordInternalLoading.style.display = 'block';
        chordInternalLoading.textContent = 'Loading...';
        chordInternalLoading.style.color = 'rgba(255,255,255,0.7)';
    }
    if (chordInternetLoading) {
        chordInternetLoading.style.display = 'block';
        chordInternetLoading.textContent = 'Loading...';
        chordInternetLoading.style.color = 'rgba(255,255,255,0.7)';
    }
    if (chordTagLoading) {
        chordTagLoading.style.display = 'block';
        chordTagLoading.textContent = 'Loading...';
        chordTagLoading.style.color = 'rgba(255,255,255,0.7)';
    }

    // Clear chord counts
    const chordInternalCount = document.getElementById('chordInternalCount');
    const chordInternetCount = document.getElementById('chordInternetCount');
    const chordTagCount = document.getElementById('chordTagCount');
    if (chordInternalCount) chordInternalCount.textContent = '--';
    if (chordInternetCount) chordInternetCount.textContent = '--';
    if (chordTagCount) chordTagCount.textContent = '--';

    // ========================================================================
    // 4. RESET DASHBOARD VALUES TO DASHES (MORE VISIBLE THAN "Loading...")
    // ========================================================================
    // Throughput stats - use dashes for clearer visual reset
    const throughputIds = ['inboundValue', 'outboundValue', 'totalValue'];
    throughputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span style="font-size: 1.2em; color: #666;">--</span>';
    });

    // Reset averages
    const avgIds = ['inboundAvg', 'outboundAvg', 'totalAvg'];
    avgIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
    });

    // Session stats
    const sessionIds = ['sessionValue', 'tcpValue', 'udpValue', 'icmpValue'];
    sessionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span style="font-size: 1.2em; color: #666;">--</span>';
    });

    // Threat stats
    if (typeof THREAT_CONFIG !== 'undefined') {
        Object.keys(THREAT_CONFIG).forEach(severity => {
            const config = THREAT_CONFIG[severity];
            const valueElement = document.getElementById(config.elementIds.value);
            const latestElement = document.getElementById(config.elementIds.latest);
            const lastSeenElement = document.getElementById(config.elementIds.lastSeen);
            if (valueElement) valueElement.innerHTML = '<span style="font-size: 1.2em; color: #666;">--</span>';
            if (latestElement) latestElement.textContent = '--';
            if (lastSeenElement) lastSeenElement.textContent = '--';
        });
    }

    // Interface errors and PPS
    const metricIds = ['interfaceErrorsValue', 'totalPps', 'inboundPps', 'outboundPps'];
    metricIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span style="font-size: 1.2em; color: #666;">--</span>';
    });

    // ========================================================================
    // 5. RESET SIDEBAR STATS
    // ========================================================================
    const sidebarPPS = document.getElementById('sidebarPPS');
    const sidebarUptime = document.getElementById('sidebarUptime');
    const sidebarWanIp = document.getElementById('sidebarWanIp');
    const sidebarWanSpeed = document.getElementById('sidebarWanSpeed');
    const sidebarApiStats = document.getElementById('sidebarApiStats');
    const sidebarLastUpdate = document.getElementById('sidebarLastUpdate');
    const sidebarPanosVersion = document.getElementById('sidebarPanosVersion');
    const sidebarLicenseExpired = document.getElementById('sidebarLicenseExpired');
    const sidebarLicenseLicensed = document.getElementById('sidebarLicenseLicensed');

    if (sidebarPPS) sidebarPPS.textContent = '-- PPS';
    if (sidebarUptime) sidebarUptime.textContent = '--';
    if (sidebarWanIp) sidebarWanIp.textContent = '--';
    if (sidebarWanSpeed) sidebarWanSpeed.textContent = '--';
    if (sidebarApiStats) sidebarApiStats.textContent = '--';
    if (sidebarLastUpdate) sidebarLastUpdate.textContent = '--';
    if (sidebarPanosVersion) sidebarPanosVersion.textContent = '--';
    if (sidebarLicenseExpired) sidebarLicenseExpired.textContent = '--';
    if (sidebarLicenseLicensed) sidebarLicenseLicensed.textContent = '--';

    // Sidebar last seen stats
    const sidebarCritical = document.getElementById('sidebarCriticalLastSeen');
    const sidebarMedium = document.getElementById('sidebarMediumLastSeen');
    const sidebarBlocked = document.getElementById('sidebarBlockedUrlLastSeen');
    if (sidebarCritical) sidebarCritical.textContent = '--';
    if (sidebarMedium) sidebarMedium.textContent = '--';
    if (sidebarBlocked) sidebarBlocked.textContent = '--';

    // ========================================================================
    // 6. RESET MINI CHARTS
    // ========================================================================
    miniChartData.sessions = [];
    miniChartData.tcp = [];
    miniChartData.udp = [];
    miniChartData.pps = [];

    if (sessionChart) {
        sessionChart.data.datasets[0].data = [];
        sessionChart.update('none');
    }
    if (tcpChart) {
        tcpChart.data.datasets[0].data = [];
        tcpChart.update('none');
    }
    if (udpChart) {
        udpChart.data.datasets[0].data = [];
        udpChart.update('none');
    }
    if (ppsChart) {
        ppsChart.data.datasets[0].data = [];
        ppsChart.update('none');
    }

    // ========================================================================
    // 7. RESET FIREWALL HEALTH TILES
    // ========================================================================
    const cyberHealthIds = [
        'cyberHealthCpu', 'cyberHealthMemory', 'cyberHealthPps', 'cyberHealthSessions',
        'cyberHealthTopCategoryLAN', 'cyberHealthTopCategoryLANSent', 'cyberHealthTopCategoryLANReceived',
        'cyberHealthTopCategoryInternet', 'cyberHealthTopCategoryInternetSent', 'cyberHealthTopCategoryInternetReceived',
        'cyberHealthTopInternalIp', 'cyberHealthTopInternalHostname', 'cyberHealthTopInternalSent', 'cyberHealthTopInternalReceived',
        'cyberHealthTopInternetIp', 'cyberHealthTopInternetHostname', 'cyberHealthTopInternetSent', 'cyberHealthTopInternetReceived',
        'cyberHealthActiveAlerts'
    ];

    cyberHealthIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = '<span style="font-size: 1.2em; color: #666;">--</span>';
        }
    });

    // ========================================================================
    // 8. CLEAR THREAT LOGS AND APPLICATION DISPLAYS
    // ========================================================================
    const criticalLogs = document.getElementById('criticalLogs');
    if (criticalLogs) {
        criticalLogs.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">--</div>';
    }
    const mediumLogs = document.getElementById('mediumLogs');
    if (mediumLogs) {
        mediumLogs.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">--</div>';
    }
    const blockedUrlLogs = document.getElementById('blockedUrlLogs');
    if (blockedUrlLogs) {
        blockedUrlLogs.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">--</div>';
    }
    const topAppsContainer = document.getElementById('topAppsContainer');
    if (topAppsContainer) {
        topAppsContainer.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">--</div>';
    }

    console.log('=== clearAllDataDisplays complete ===');
}

// Export for devices.js access
window.clearAllDataDisplays = clearAllDataDisplays;

/**
 * CRITICAL: Centralized Device Change Handler
 *
 * This function is responsible for clearing and refreshing ALL data when
 * the connected device changes. Any new features that display data MUST
 * be registered here to ensure proper refresh on device change.
 *
 * Called by: onDeviceChange() in devices.js
 *
 * Responsibilities:
 * 1. Clear all chart data and reset charts
 * 2. Zero/reset all dashboard values and show loading states
 * 3. Clear all historical data arrays
 * 4. Reset all mini charts
 * 5. Clear threat logs and application displays
 * 6. Trigger refresh of all page-specific data
 * 7. Restart update interval with fresh data
 *
 * IMPORTANT: When adding new data displays to the dashboard or any page,
 * you MUST update this function to clear/reset those values.
 */
async function refreshAllDataForDevice() {
    console.log('=== refreshAllDataForDevice called ===');
    console.log('[DEBUG] currentVisiblePage =', currentVisiblePage);

    // Progress: Step 1 - Clearing displays
    updateDeviceSwitchProgress('Clearing displays...');

    // ========================================================================
    // 0. PRESERVE USER'S TIME RANGE SELECTION (Fixed v1.14.1)
    // ========================================================================
    // Removed forced reset to '1m' - user's selection should persist across device changes
    console.log('Preserving user time range selection:', currentTimeRange);

    // ========================================================================
    // 1. CLEAR MAIN CHART DATA
    // ========================================================================
    chartData.timestamps = [];
    chartData.labels = [];
    chartData.inbound = [];
    chartData.outbound = [];
    chartData.total = [];

    // Clear D3 line chart
    if (window.d3Chart) {
        window.d3Chart.g.selectAll("*").remove();
    }
    console.log('Main chart cleared');

    // ========================================================================
    // 2. CLEAR HISTORICAL DATA ARRAYS
    // ========================================================================
    historicalData.inbound = [];
    historicalData.outbound = [];
    historicalData.total = [];
    historicalData.sessions = [];
    historicalData.tcp = [];
    historicalData.udp = [];
    historicalData.icmp = [];
    historicalData.criticalThreats = [];
    historicalData.mediumThreats = [];
    historicalData.blockedUrls = [];
    historicalData.urlFiltering = [];
    historicalData.interfaceErrors = [];
    console.log('Historical data arrays cleared');

    // ========================================================================
    // 2a. CLEAR CHORD DIAGRAMS
    // ========================================================================
    // Clear SVG content and show loading state
    const chordInternalSvg = document.getElementById('chordInternalSvg');
    const chordInternetSvg = document.getElementById('chordInternetSvg');
    const chordInternalLoading = document.getElementById('chordInternalLoading');
    const chordInternetLoading = document.getElementById('chordInternetLoading');

    // FIX #1: Add D3.js availability check before calling d3.select()
    if (typeof d3 !== 'undefined') {
        if (chordInternalSvg) {
            d3.select('#chordInternalSvg').selectAll('*').remove();
        }
        if (chordInternetSvg) {
            d3.select('#chordInternetSvg').selectAll('*').remove();
        }
    }
    if (chordInternalLoading) {
        chordInternalLoading.style.display = 'block';
        chordInternalLoading.textContent = 'Loading...';
        chordInternalLoading.style.color = 'rgba(255,255,255,0.7)';
    }
    if (chordInternetLoading) {
        chordInternetLoading.style.display = 'block';
        chordInternetLoading.textContent = 'Loading...';
        chordInternetLoading.style.color = 'rgba(255,255,255,0.7)';
    }
    console.log('Chord diagrams cleared');

    // ========================================================================
    // 3. RESET DASHBOARD VALUES TO LOADING STATE
    // ========================================================================
    // Throughput stats
    const inboundValue = document.getElementById('inboundValue');
    if (inboundValue) {
        inboundValue.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    const outboundValue = document.getElementById('outboundValue');
    if (outboundValue) {
        outboundValue.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    const totalValue = document.getElementById('totalValue');
    if (totalValue) {
        totalValue.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    // Reset 5-minute averages
    const inboundAvg = document.getElementById('inboundAvg');
    if (inboundAvg) {
        inboundAvg.textContent = '-';
    }

    const outboundAvg = document.getElementById('outboundAvg');
    if (outboundAvg) {
        outboundAvg.textContent = '-';
    }

    const totalAvg = document.getElementById('totalAvg');
    if (totalAvg) {
        totalAvg.textContent = '-';
    }

    // Session stats
    const sessionValue = document.getElementById('sessionValue');
    if (sessionValue) {
        sessionValue.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    const tcpValue = document.getElementById('tcpValue');
    if (tcpValue) {
        tcpValue.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    const udpValue = document.getElementById('udpValue');
    if (udpValue) {
        udpValue.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    const icmpValue = document.getElementById('icmpValue');
    if (icmpValue) {
        icmpValue.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    // Threat stats (v1.10.14 - configuration-driven reset)
    Object.keys(THREAT_CONFIG).forEach(severity => {
        const config = THREAT_CONFIG[severity];

        // Reset count value
        const valueElement = document.getElementById(config.elementIds.value);
        if (valueElement) {
            valueElement.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
        }

        // Reset latest threat/URL name
        const latestElement = document.getElementById(config.elementIds.latest);
        if (latestElement) {
            latestElement.textContent = '-';
        }

        // Reset last seen timestamp
        const lastSeenElement = document.getElementById(config.elementIds.lastSeen);
        if (lastSeenElement) {
            lastSeenElement.textContent = '-';
        }
    });

    // Interface errors
    const interfaceErrorsElement = document.getElementById('interfaceErrorsValue');
    if (interfaceErrorsElement) {
        interfaceErrorsElement.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    // Network Traffic PPS (packets per second) counters
    const totalPps = document.getElementById('totalPps');
    if (totalPps) {
        totalPps.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    const inboundPps = document.getElementById('inboundPps');
    if (inboundPps) {
        inboundPps.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    const outboundPps = document.getElementById('outboundPps');
    if (outboundPps) {
        outboundPps.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
    }

    console.log('Dashboard values reset to loading');

    // ========================================================================
    // 4. RESET SIDEBAR STATS
    // ========================================================================
    const sidebarPPS = document.getElementById('sidebarPPS');
    const sidebarUptime = document.getElementById('sidebarUptime');
    const sidebarWanIp = document.getElementById('sidebarWanIp');
    const sidebarWanSpeed = document.getElementById('sidebarWanSpeed');
    const sidebarApiStats = document.getElementById('sidebarApiStats');
    const sidebarLastUpdate = document.getElementById('sidebarLastUpdate');
    const sidebarPanosVersion = document.getElementById('sidebarPanosVersion');
    const sidebarLicenseExpired = document.getElementById('sidebarLicenseExpired');
    const sidebarLicenseLicensed = document.getElementById('sidebarLicenseLicensed');

    if (sidebarPPS) sidebarPPS.textContent = '0 PPS';
    if (sidebarUptime) sidebarUptime.textContent = '-';
    if (sidebarWanIp) sidebarWanIp.textContent = '-';
    if (sidebarWanSpeed) sidebarWanSpeed.textContent = '-';
    if (sidebarApiStats) sidebarApiStats.textContent = '-';
    if (sidebarLastUpdate) sidebarLastUpdate.textContent = '-';
    if (sidebarPanosVersion) sidebarPanosVersion.textContent = '-';
    if (sidebarLicenseExpired) sidebarLicenseExpired.textContent = '0';
    if (sidebarLicenseLicensed) sidebarLicenseLicensed.textContent = '0';

    // Sidebar last seen stats
    const sidebarCritical = document.getElementById('sidebarCriticalLastSeen');
    const sidebarMedium = document.getElementById('sidebarMediumLastSeen');
    const sidebarBlocked = document.getElementById('sidebarBlockedUrlLastSeen');
    if (sidebarCritical) sidebarCritical.textContent = '-';
    if (sidebarMedium) sidebarMedium.textContent = '-';
    if (sidebarBlocked) sidebarBlocked.textContent = '-';

    console.log('Sidebar stats reset');

    // ========================================================================
    // 5. RESET MINI CHARTS
    // ========================================================================
    miniChartData.sessions = [];
    miniChartData.tcp = [];
    miniChartData.udp = [];
    miniChartData.pps = [];

    if (sessionChart) {
        sessionChart.data.datasets[0].data = [];
        sessionChart.update('none');
    }
    if (tcpChart) {
        tcpChart.data.datasets[0].data = [];
        tcpChart.update('none');
    }
    if (udpChart) {
        udpChart.data.datasets[0].data = [];
        udpChart.update('none');
    }
    if (ppsChart) {
        ppsChart.data.datasets[0].data = [];
        ppsChart.update('none');
    }

    console.log('Mini charts reset');

    // ========================================================================
    // 6. CLEAR THREAT LOGS AND APPLICATION DISPLAYS
    // ========================================================================
    const criticalLogs = document.getElementById('criticalLogs');
    if (criticalLogs) {
        criticalLogs.innerHTML = '<div style="color: #ffffff; text-align: center; padding: 10px;">Loading...</div>';
    }

    const mediumLogs = document.getElementById('mediumLogs');
    if (mediumLogs) {
        mediumLogs.innerHTML = '<div style="color: #ffffff; text-align: center; padding: 10px;">Loading...</div>';
    }

    const blockedUrlLogs = document.getElementById('blockedUrlLogs');
    if (blockedUrlLogs) {
        blockedUrlLogs.innerHTML = '<div style="color: #ffffff; text-align: center; padding: 10px;">Loading...</div>';
    }

    const topAppsContainer = document.getElementById('topAppsContainer');
    if (topAppsContainer) {
        topAppsContainer.innerHTML = '<div style="color: #ffffff; text-align: center; padding: 10px;">Loading...</div>';
    }

    // Clear chord diagrams and show loading state
    if (typeof d3 !== 'undefined') {
        const chordInternalSvg = d3.select('#chordInternalSvg');
        if (!chordInternalSvg.empty()) {
            chordInternalSvg.selectAll('*').remove();
        }
        const chordInternetSvg = d3.select('#chordInternetSvg');
        if (!chordInternetSvg.empty()) {
            chordInternetSvg.selectAll('*').remove();
        }
        const chordTagSvg = d3.select('#chordTagSvg');
        if (!chordTagSvg.empty()) {
            chordTagSvg.selectAll('*').remove();
        }
    }
    // Reuse chordInternalLoading and chordInternetLoading already declared at line 2208-2209
    if (chordInternalLoading) {
        chordInternalLoading.style.display = 'block';
    }
    if (chordInternetLoading) {
        chordInternetLoading.style.display = 'block';
    }
    const chordInternalCount = document.getElementById('chordInternalCount');
    if (chordInternalCount) {
        chordInternalCount.textContent = '--';
    }
    const chordInternetCount = document.getElementById('chordInternetCount');
    if (chordInternetCount) {
        chordInternetCount.textContent = '--';
    }
    const chordTagLoading = document.getElementById('chordTagLoading');
    if (chordTagLoading) {
        chordTagLoading.style.display = 'block';
        chordTagLoading.textContent = 'Select tags to view traffic';
        chordTagLoading.style.color = 'rgba(255,255,255,0.7)';
    }
    const chordTagCount = document.getElementById('chordTagCount');
    if (chordTagCount) {
        chordTagCount.textContent = '--';
    }

    // Reset Firewall Health tiles (9 metrics: CPU, Memory, PPS, Sessions, Top Category (LAN/Internet split), Top Internal/Internet Clients, Active Alerts)
    const cyberHealthIds = [
        'cyberHealthCpu', 'cyberHealthMemory', 'cyberHealthPps', 'cyberHealthSessions',
        'cyberHealthTopCategoryLAN', 'cyberHealthTopCategoryLANSent', 'cyberHealthTopCategoryLANReceived',
        'cyberHealthTopCategoryInternet', 'cyberHealthTopCategoryInternetSent', 'cyberHealthTopCategoryInternetReceived',
        'cyberHealthTopInternalIp', 'cyberHealthTopInternalHostname', 'cyberHealthTopInternalSent', 'cyberHealthTopInternalReceived',
        'cyberHealthTopInternetIp', 'cyberHealthTopInternetHostname', 'cyberHealthTopInternetSent', 'cyberHealthTopInternetReceived',
        'cyberHealthActiveAlerts'
    ];

    cyberHealthIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = '<span style="font-size: 0.7em;">Loading...</span>';
        }
    });

    console.log('Threat logs, app displays, and Firewall Health tiles cleared');

    // ========================================================================
    // 7. REFRESH ALL PAGE DATA (v1.0.5 - Enterprise Parallel Fetch)
    // ========================================================================
    console.log('Triggering refresh of all page data...');

    // Restart update interval for dashboard data
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
    }

    // v1.0.5: Verify we have a device selected
    const deviceId = window.currentDeviceId;
    if (!deviceId) {
        console.error('[REFRESH] No device selected, aborting refresh');
        return;
    }
    console.log(`[REFRESH] Refreshing data for device: ${deviceId}`);

    // v1.0.5: Re-initialize ThroughputDataService for the new device
    // This is CRITICAL - the service caches data per-device and must be reinitialized
    if (window.throughputService) {
        console.log('[REFRESH] Re-initializing ThroughputDataService for new device...');
        try {
            const settings = window.appSettings || {};
            await window.throughputService.initialize(deviceId, settings);
            console.log('[REFRESH] ThroughputDataService reinitialized');
        } catch (error) {
            console.error('[REFRESH] Failed to reinitialize ThroughputDataService:', error);
        }
    }

    // Progress: Step 2 - Loading data in parallel
    updateDeviceSwitchProgress('Loading data...');

    // v1.0.5: Fetch core data in PARALLEL using Promise.allSettled()
    // This is faster (~2-3s vs ~6-8s sequential) and isolates failures
    console.log('[REFRESH] Starting parallel core data fetch...');
    const coreResults = await Promise.allSettled([
        preloadChartData(),      // Historical chart data
        fetchThroughputData(),   // Current metrics (dashboard tiles)
        fetchThreatData()        // Threat data (critical/medium logs)
    ]);

    // Log results and handle any failures gracefully
    const resultNames = ['preloadChartData', 'fetchThroughputData', 'fetchThreatData'];
    coreResults.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            console.log(`[REFRESH] ✓ ${resultNames[i]} completed`);
        } else {
            console.error(`[REFRESH] ✗ ${resultNames[i]} failed:`, result.reason);
        }
    });

    // Then start the regular refresh interval
    console.log(`Starting auto-refresh with ${UPDATE_INTERVAL}ms interval...`);
    updateIntervalId = setInterval(fetchThroughputData, UPDATE_INTERVAL);
    console.log(`✓ Auto-refresh interval started`);

    // Progress: Step 4 - Loading page-specific data
    updateDeviceSwitchProgress('Loading page data...');

    // OPTIMIZATION: Only refresh the currently visible page (not all pages)
    // This reduces device switch from 8+ API calls to 1-2 calls
    console.log('Current visible page:', currentVisiblePage);
    console.log('Loading only visible page data...');

    // Clear UI state for Device Info tabs (lightweight - no API calls)
    const panosVersionInfo = document.getElementById('panosVersionInfo');
    if (panosVersionInfo) {
        panosVersionInfo.innerHTML = '';
    }
    const checkButton = document.getElementById('checkPanosVersionBtn');
    if (checkButton) {
        checkButton.disabled = false;
        checkButton.textContent = 'Check for Updates';
    }

    // Clear reboot UI state when switching devices
    const rebootButton = document.getElementById('rebootFirewallBtn');
    if (rebootButton) {
        rebootButton.disabled = false;
        rebootButton.textContent = 'Reboot Firewall';
        // Reset to red gradient for danger action
        rebootButton.style.background = 'linear-gradient(135deg, #dc3545 0%, #ff6b6b 100%)';
    }
    const rebootSuccess = document.getElementById('rebootSuccess');
    if (rebootSuccess) {
        rebootSuccess.style.display = 'none';
        rebootSuccess.innerHTML = '';
    }
    const rebootError = document.getElementById('rebootErrorMessage');
    if (rebootError) {
        rebootError.style.display = 'none';
        rebootError.textContent = '';
    }

    // Load only the currently visible page
    console.log('[DEBUG] Checking currentVisiblePage:', currentVisiblePage, 'matches home/homepage?', (currentVisiblePage === 'home' || currentVisiblePage === 'homepage'));
    if (currentVisiblePage === 'home' || currentVisiblePage === 'homepage') {
        // Dashboard - throughput already refreshed by interval above
        console.log('Dashboard active - using interval for updates');

        // FIX #4: Load chord diagrams with proper error handling and D3.js check
        if (typeof loadChordDiagrams === 'function' && typeof d3 !== 'undefined') {
            console.log('Loading chord diagrams for client-destination flows...');
            try {
                await loadChordDiagrams();
            } catch (error) {
                console.error('[REFRESH] Error loading chord diagrams:', error);
            }
        }

        // Restore saved tag filter selection and reload tag diagram if tags exist
        // Note: populateTagFilterDropdown() loads from server settings, updates UI, and loads diagram
        if (typeof populateTagFilterDropdown === 'function') {
            console.log('[REFRESH] Restoring tag filter selection from saved settings...');
            try {
                await populateTagFilterDropdown();
            } catch (error) {
                console.error('[REFRESH] Error restoring tag filter:', error);
            }
        }
    } else if (currentVisiblePage === 'connected-devices' && typeof loadConnectedDevices === 'function') {
        console.log('Loading Connected Devices page');
        loadConnectedDevices();
    } else if (currentVisiblePage === 'applications' && typeof loadApplications === 'function') {
        console.log('Loading Applications page');
        loadApplications();
    } else if (currentVisiblePage === 'device-info') {
        // Check which Device Info tab is visible
        const softwareTab = document.getElementById('software-updates-tab');
        const interfacesTab = document.getElementById('interfaces-tab');
        const dhcpTab = document.getElementById('dhcp-tab');

        if (softwareTab && softwareTab.style.display !== 'none' && typeof loadSoftwareUpdates === 'function') {
            console.log('Loading Software Updates tab');
            loadSoftwareUpdates();
        } else if (interfacesTab && interfacesTab.style.display !== 'none' && typeof loadInterfaces === 'function') {
            console.log('Loading Interfaces tab');
            loadInterfaces();
        } else if (dhcpTab && dhcpTab.style.display !== 'none' && typeof loadDhcpLeases === 'function') {
            console.log('Loading DHCP tab');
            loadDhcpLeases();
        }
        // Tech Support and Reboot tabs don't auto-load data
    } else if (currentVisiblePage === 'logs' && typeof loadSystemLogs === 'function') {
        console.log('Loading System Logs page');
        loadSystemLogs();
    } else if (currentVisiblePage === 'traffic' && typeof updateTrafficPage === 'function') {
        console.log('Loading Traffic page');
        updateTrafficPage();
    } else if (currentVisiblePage === 'alerts' && typeof loadAlertStats === 'function') {
        console.log('Loading Alerts page');
        // Reload alert statistics and configurations for new device
        loadAlertStats();
        loadAlertConfigs();
        loadAlertHistory(false);
    }

    console.log('=== refreshAllDataForDevice complete ===');
}

/**
 * Update Firewall Health status board tiles
 *
 * @param {Object} data - Throughput data from /api/throughput endpoint
 */
/**
 * Update System Info sidebar fields
 * Extracted from updateStats() to fix orphaned sidebar in v2.x
 * @param {Object} data - Throughput data snapshot
 */
function updateSidebarInfo(data) {
    // Update WAN IP
    if (data.wan_ip !== undefined) {
        const wanIpElement = document.getElementById('sidebarWanIp');
        if (wanIpElement) {
            wanIpElement.textContent = data.wan_ip || '-';
        }
    }

    // Update WAN Speed
    if (data.wan_speed !== undefined) {
        const wanSpeedElement = document.getElementById('sidebarWanSpeed');
        if (wanSpeedElement) {
            wanSpeedElement.textContent = data.wan_speed || '-';
        }
    }

    // Update PAN-OS Version
    if (data.pan_os_version !== undefined) {
        const versionElement = document.getElementById('sidebarPanosVersion');
        if (versionElement) {
            versionElement.textContent = data.pan_os_version || '-';
        }
    }

    // Update Firewall Uptime (convert seconds to human-readable format)
    if (data.uptime_seconds !== undefined && data.uptime_seconds !== null) {
        const sidebarUptimeElement = document.getElementById('sidebarUptime');
        if (sidebarUptimeElement) {
            const uptimeFormatted = formatUptimeFromSeconds(data.uptime_seconds);
            sidebarUptimeElement.textContent = uptimeFormatted;
        }
    }

    // Update License Information (nested object structure)
    const expiredElement = document.getElementById('sidebarLicenseExpired');
    const licensedElement = document.getElementById('sidebarLicenseLicensed');

    if (expiredElement && data.license && data.license.expired !== undefined) {
        expiredElement.textContent = data.license.expired || 0;
    }

    if (licensedElement && data.license && data.license.licensed !== undefined) {
        licensedElement.textContent = data.license.licensed || 0;
    }
}

/**
 * Format uptime from seconds to human-readable string
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime (e.g., "5d 6h 32m")
 */
function formatUptimeFromSeconds(seconds) {
    if (!seconds || seconds === 0) return '-';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

/**
 * Update ONLY threat tiles (isolated from chart and other stats)
 * Prevents threat updates from contaminating throughput graph
 * @param {Object} threats - Threat data object with logs for all severities
 */
function updateThreatTilesOnly(threats) {
    if (!threats) {
        console.warn('[updateThreatTilesOnly] No threat data provided');
        return;
    }

    // Store threat logs for modals (all severities)
    window.currentCriticalLogs = threats.critical_logs || [];
    window.currentHighLogs = threats.high_logs || [];
    window.currentMediumLogs = threats.medium_logs || [];
    window.currentBlockedUrlLogs = threats.blocked_url_logs || [];

    // Iterate through all configured threat severities
    Object.keys(THREAT_CONFIG).forEach(severity => {
        const config = THREAT_CONFIG[severity];
        const logs = threats[config.logsKey] || [];

        // Store logs in global variable for modal access
        window[config.globalLogsVar] = logs;

        // Calculate unique counts (critical/high/medium by threat name, blocked URLs by URL)
        const uniqueItems = new Set();
        logs.forEach(log => {
            if (severity === 'blocked') {
                // Blocked URLs - use URL field
                const url = log.url || log.threat || 'Unknown';
                uniqueItems.add(url);
            } else {
                // Threats - use threat name
                const threat = log.threat || 'Unknown';
                uniqueItems.add(threat);
            }
        });

        // Update count value on tile (just unique count, null-safe)
        const valueElement = document.getElementById(config.elementIds.value);
        if (valueElement) {
            const count = uniqueItems.size;
            valueElement.innerHTML = (count !== null && count !== undefined ? count.toLocaleString() : '0');
        }

        // Update latest threat/URL name on tile
        const latestElement = document.getElementById(config.elementIds.latest);
        if (latestElement && logs.length > 0) {
            const latestLog = logs[0];
            if (severity === 'blocked') {
                latestElement.textContent = latestLog.url || latestLog.threat || 'No recent blocks';
            } else {
                latestElement.textContent = latestLog.threat || 'No recent threats';
            }
        } else if (latestElement) {
            latestElement.textContent = '-';
        }

        // Update "Last seen" timestamp
        const lastSeenElement = document.getElementById(config.elementIds.lastSeen);
        if (lastSeenElement && threats[config.lastSeenKey]) {
            lastSeenElement.textContent = formatDaysAgo(threats[config.lastSeenKey]);
        }
    });

    console.log(`[updateThreatTilesOnly] Updated threat tiles: ${window.currentCriticalLogs.length} critical, ${window.currentHighLogs.length} high, ${window.currentMediumLogs.length} medium, ${window.currentBlockedUrlLogs.length} blocked URLs`);
}

function updateCyberHealth(data) {
    // Tile 1: Data Plane CPU - NULL-SAFE (v1.0.6)
    const cpuElement = document.getElementById('cyberHealthCpu');
    if (cpuElement) {
        if (data.cpu && data.cpu.data_plane_cpu !== undefined && data.cpu.data_plane_cpu !== null) {
            cpuElement.textContent = data.cpu.data_plane_cpu + '%';
        } else {
            cpuElement.textContent = '--';
        }
    }

    // Tile 2: System Memory - NULL-SAFE (v1.0.6)
    const memoryElement = document.getElementById('cyberHealthMemory');
    if (memoryElement) {
        if (data.cpu && data.cpu.memory_used_pct !== undefined && data.cpu.memory_used_pct !== null) {
            memoryElement.textContent = data.cpu.memory_used_pct + '%';
        } else {
            memoryElement.textContent = '--';
        }
    }

    // Tile 3: PPS (Packets Per Second) - NULL-SAFE
    const ppsElement = document.getElementById('cyberHealthPps');
    if (ppsElement && data.total_pps !== null && data.total_pps !== undefined) {
        ppsElement.textContent = data.total_pps.toLocaleString();
    } else if (ppsElement) {
        ppsElement.textContent = '--';
    }

    // Tile 4: Active Sessions - NULL-SAFE
    const sessionsElement = document.getElementById('cyberHealthSessions');
    if (sessionsElement && data.sessions && data.sessions.active !== null && data.sessions.active !== undefined) {
        sessionsElement.textContent = data.sessions.active.toLocaleString();
    } else if (sessionsElement) {
        sessionsElement.textContent = '--';
    }

    // Tile 5: Top Category (Local LAN and Internet split view)
    // Update Top Local LAN Category
    if (data.top_category_lan && data.top_category_lan.category) {
        const lanCategory = data.top_category_lan;
        const lanCategoryElement = document.getElementById('cyberHealthTopCategoryLAN');
        const lanSentElement = document.getElementById('cyberHealthTopCategoryLANSent');
        const lanReceivedElement = document.getElementById('cyberHealthTopCategoryLANReceived');

        if (lanCategoryElement) {
            lanCategoryElement.textContent = lanCategory.category;
        }

        if (lanSentElement) {
            lanSentElement.textContent = formatBytes(lanCategory.bytes_sent || 0);
        }

        if (lanReceivedElement) {
            lanReceivedElement.textContent = formatBytes(lanCategory.bytes_received || 0);
        }
    } else {
        const lanCategoryElement = document.getElementById('cyberHealthTopCategoryLAN');
        const lanSentElement = document.getElementById('cyberHealthTopCategoryLANSent');
        const lanReceivedElement = document.getElementById('cyberHealthTopCategoryLANReceived');
        if (lanCategoryElement) lanCategoryElement.textContent = '-';
        if (lanSentElement) lanSentElement.textContent = '--';
        if (lanReceivedElement) lanReceivedElement.textContent = '--';
    }

    // Update Top Internet Category
    if (data.top_category_internet && data.top_category_internet.category) {
        const internetCategory = data.top_category_internet;
        const internetCategoryElement = document.getElementById('cyberHealthTopCategoryInternet');
        const internetSentElement = document.getElementById('cyberHealthTopCategoryInternetSent');
        const internetReceivedElement = document.getElementById('cyberHealthTopCategoryInternetReceived');

        if (internetCategoryElement) {
            internetCategoryElement.textContent = internetCategory.category;
        }

        if (internetSentElement) {
            internetSentElement.textContent = formatBytes(internetCategory.bytes_sent || 0);
        }

        if (internetReceivedElement) {
            internetReceivedElement.textContent = formatBytes(internetCategory.bytes_received || 0);
        }
    } else {
        // DEBUG: Log what we received
        console.log('[DEBUG] Internet category data:', data.top_category_internet);
        console.log('[DEBUG] All available categories:', data.categories ? Object.keys(data.categories) : 'no categories');

        const internetCategoryElement = document.getElementById('cyberHealthTopCategoryInternet');
        const internetSentElement = document.getElementById('cyberHealthTopCategoryInternetSent');
        const internetReceivedElement = document.getElementById('cyberHealthTopCategoryInternetReceived');
        if (internetCategoryElement) internetCategoryElement.textContent = '-';
        if (internetSentElement) internetSentElement.textContent = '--';
        if (internetReceivedElement) internetReceivedElement.textContent = '--';
    }

    // Tile 6: Top Internal and Internet Clients (split view)

    // Update Top Internal Client
    if (data.top_internal_client && data.top_internal_client.ip) {
        const internal = data.top_internal_client;
        const internalIp = document.getElementById('cyberHealthTopInternalIp');
        const internalHostname = document.getElementById('cyberHealthTopInternalHostname');
        const internalSent = document.getElementById('cyberHealthTopInternalSent');
        const internalReceived = document.getElementById('cyberHealthTopInternalReceived');

        if (internalIp) {
            internalIp.textContent = internal.ip;
        }

        if (internalHostname) {
            // Prefer custom_name, fallback to hostname
            const displayName = internal.custom_name || internal.hostname || 'Unknown';
            internalHostname.textContent = displayName;
        }

        if (internalSent) {
            internalSent.textContent = formatBytes(internal.bytes_sent || 0);
        }

        if (internalReceived) {
            internalReceived.textContent = formatBytes(internal.bytes_received || 0);
        }
    } else {
        document.getElementById('cyberHealthTopInternalIp').textContent = 'N/A';
        document.getElementById('cyberHealthTopInternalHostname').textContent = '--';
        document.getElementById('cyberHealthTopInternalSent').textContent = '--';
        document.getElementById('cyberHealthTopInternalReceived').textContent = '--';
    }

    // Update Top Internet Client
    if (data.top_internet_client && data.top_internet_client.ip) {
        const internet = data.top_internet_client;
        const internetIp = document.getElementById('cyberHealthTopInternetIp');
        const internetHostname = document.getElementById('cyberHealthTopInternetHostname');
        const internetSent = document.getElementById('cyberHealthTopInternetSent');
        const internetReceived = document.getElementById('cyberHealthTopInternetReceived');

        if (internetIp) {
            internetIp.textContent = internet.ip;
        }

        if (internetHostname) {
            // Prefer custom_name, fallback to hostname
            const displayName = internet.custom_name || internet.hostname || 'Unknown';
            internetHostname.textContent = displayName;
        }

        if (internetSent) {
            internetSent.textContent = formatBytes(internet.bytes_sent || 0);
        }

        if (internetReceived) {
            internetReceived.textContent = formatBytes(internet.bytes_received || 0);
        }
    } else {
        document.getElementById('cyberHealthTopInternetIp').textContent = 'N/A';
        document.getElementById('cyberHealthTopInternetHostname').textContent = '--';
        document.getElementById('cyberHealthTopInternetSent').textContent = '--';
        document.getElementById('cyberHealthTopInternetReceived').textContent = '--';
    }

    // Update System Info sidebar (Fix: orphaned sidebar in v2.x - call extracted function)
    updateSidebarInfo(data);

    // Update threat tiles using isolated function (prevents graph contamination)
    if (data.threats) {
        updateThreatTilesOnly(data.threats);
    }

}

/**
 * Update active alerts count in Firewall Health bar
 * Fetches alert statistics and displays count of triggered/active alerts
 * Color codes by severity: Red (critical), Orange (warning), Blue (info), Green (none)
 */
function updateActiveAlertsCount() {
    const activeAlertsElement = document.getElementById('cyberHealthActiveAlerts');
    if (!activeAlertsElement) {
        console.warn('updateActiveAlertsCount: Element cyberHealthActiveAlerts not found');
        return;
    }

    window.apiClient.get('/api/alerts/stats')
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch alert stats');
            }
            const data = response.data;
            console.log('updateActiveAlertsCount: Received response', data);

            // API returns data.data (not data.stats)
            if (data && data.status === 'success' && data.data) {
                const stats = data.data;

                // Active alerts = unacknowledged alerts (critical + warning + info)
                const criticalCount = stats.critical_alerts || 0;
                const warningCount = stats.warning_alerts || 0;
                const infoCount = stats.info_alerts || 0;
                const totalActive = criticalCount + warningCount + infoCount;

                console.log(`updateActiveAlertsCount: Critical=${criticalCount}, Warning=${warningCount}, Info=${infoCount}, Total=${totalActive}`);

                activeAlertsElement.textContent = totalActive;

                // Color code by highest severity
                if (criticalCount > 0) {
                    activeAlertsElement.style.color = '#DC3545'; // Red for critical
                } else if (warningCount > 0) {
                    activeAlertsElement.style.color = '#FA582D'; // Orange for warning
                } else if (infoCount > 0) {
                    activeAlertsElement.style.color = '#17A2B8'; // Blue for info
                } else {
                    activeAlertsElement.style.color = '#4CAF50'; // Green for no alerts
                }
            } else {
                console.warn('updateActiveAlertsCount: Invalid response structure', data);
                activeAlertsElement.textContent = '-';
                activeAlertsElement.style.color = '';
            }
        })
        .catch(error => {
            console.error('updateActiveAlertsCount: Error fetching alert stats:', error);
            activeAlertsElement.textContent = '-';
            activeAlertsElement.style.color = '';
        });
}

// ===================================================================================
// Chord Diagram Functions - MOVED TO app-chord.js (v1.0.15 - File Size Reduction)
// ===================================================================================
// All chord diagram code has been extracted to static/app-chord.js for maintainability.
// Functions available globally via window.* exports:
// - loadChordDiagrams(), renderChordDiagram(), loadTagFilteredChordDiagram()
// - openChordTagFilterModal(), closeChordTagFilterModal(), applyChordTagFilter()
// - onInternalFilterChange(), onInternetFilterChange()
// - isPrivateIP(), formatBytes(), etc.
// ===================================================================================

