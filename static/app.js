console.log('[APP.JS] ===== FILE LOADING STARTED =====');

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

// Fetch data from API
async function fetchThroughputData() {
    try {
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const params = {};
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
            showInfo('Waiting for first data collection. Charts will appear in ~60 seconds.');

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
        // If currentTimeRange is from Insights dashboard (1h, 6h, 24h, etc.), default to 30m
        const mainDashboardRanges = ['5m', '15m', '30m', '60m'];
        let timeRange = window.currentTimeRange || '30m';
        if (!mainDashboardRanges.includes(timeRange)) {
            console.warn(`Time range '${timeRange}' not valid for main dashboard, using '30m'`);
            timeRange = '30m';
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

    // OPTIMIZATION: Parallelize independent API calls for faster loading
    console.log('[OPTIMIZATION] Loading settings, devices, and metadata in parallel...');
    const startTime = performance.now();

    const [settingsResult, devicesResult, metadataResult] = await Promise.allSettled([
        initSettings(),
        (typeof loadDevices === 'function') ? loadDevices() : Promise.resolve(),
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
 * Initialize current device ID from settings (Enterprise Fix v1.12.0)
 * Ensures window.currentDeviceId is set before any page loads
 * This prevents blank device_id errors in Analytics and other pages
 */
async function initializeCurrentDevice() {
    console.log('[Global] Initializing current device...');

    // Check if already initialized
    if (window.currentDeviceId && window.currentDeviceId.trim() !== '') {
        console.log('[Global] Device already initialized:', window.currentDeviceId);
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

            // OPTIMIZATION: Cache settings to avoid duplicate fetch in initSettings()
            window.CacheUtil.set('settings', data.settings, 5 * 60 * 1000);
            console.log('[Global] Settings cached for 5 minutes');

            if (deviceId && deviceId.trim() !== '') {
                console.log('[Global] Loaded device from settings:', deviceId);
                return deviceId;
            } else {
                console.warn('[Global] No device selected in settings');
            }
        }
    } catch (error) {
        console.error('[Global] Failed to fetch settings:', error);
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
                console.log('[Global] Auto-selected first enabled device:', firstEnabledDevice.name);

                // Persist selection to settings using ApiClient (CSRF token auto-injected)
                try {
                    await window.apiClient.post('/api/settings', {
                        selected_device_id: firstEnabledDevice.id
                    });
                    console.log('[Global] Persisted device selection to settings');
                } catch (error) {
                    console.warn('[Global] Failed to persist device selection:', error);
                }

                return firstEnabledDevice.id;
            } else {
                console.warn('[Global] No enabled devices found');
            }
        } else {
            console.warn('[Global] No devices configured');
        }
    } catch (error) {
        console.error('[Global] Failed to fetch devices:', error);
    }

    // No device available
    window.currentDeviceId = '';
    console.warn('[Global] No device initialized - user must select one');
    return '';
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

// Start the app when DOM is ready (initialize device first!)
console.log('[APP.JS] Script loaded - DOMContentLoaded listener registered');

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[APP.JS] DOMContentLoaded fired - starting initialization...');

    // Initialize device first (critical for all pages)
    await initializeCurrentDevice();

    // Then run normal initialization
    await init();  // Fixed: await the async function

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
// Load from localStorage if available, otherwise default to '30m'
// CRITICAL FIX (v1.14.1): Validate that loaded value is in allowed list
// NOTE: validTimeRanges MUST match the actual options in the HTML dropdown (templates/index.html)
const validTimeRanges = ['5m', '15m', '30m', '60m'];
const storedTimeRange = localStorage.getItem('timeRange');
console.log('[TIME RANGE] Loaded from localStorage:', storedTimeRange);
if (storedTimeRange && validTimeRanges.includes(storedTimeRange)) {
    window.currentTimeRange = storedTimeRange;
    console.log('[TIME RANGE] Using saved time range:', storedTimeRange);
} else {
    console.warn(`[TIME RANGE] Invalid time range in localStorage: '${storedTimeRange}', defaulting to '30m'`);
    window.currentTimeRange = '30m';
    localStorage.setItem('timeRange', '30m');
}

/**
 * Handle time range dropdown change
 */
async function handleTimeRangeChange(range) {
    console.log('=== TIME RANGE CHANGED (v1.14.1 FIX ACTIVE) ===');
    console.log('New time range:', range);
    console.log('This should load ONLY', range, 'of data, not 24 hours');
    window.currentTimeRange = range;

    // Save to localStorage for site-wide persistence
    localStorage.setItem('timeRange', range);
    console.log('[TIME RANGE] Saved to localStorage:', range);

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
 * Fetch threat data from dedicated /api/threats endpoint
 * Completely independent of throughput time range selection
 * This keeps threat data separate from network throughput metrics
 */
async function fetchThreatData() {
    try {
        console.log('[THREATS] Fetching threat data (independent of time range)');

        // Call dedicated /api/threats endpoint
        // This is COMPLETELY separate from throughput data and time ranges
        const response = await window.apiClient.get('/api/threats');

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

// Page navigation
// Track currently visible page for device change refreshes
let currentVisiblePage = 'homepage';

function initPageNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const pages = {
        'homepage': document.getElementById('homepage-content'),
        'connected-devices': document.getElementById('connected-devices-content'),
        'applications': document.getElementById('applications-content'),
        'device-info': document.getElementById('device-info-content'),
        'logs': document.getElementById('logs-content'),
        'analytics': document.getElementById('analytics-content'),
        'devices': document.getElementById('devices-content'),
        'settings': document.getElementById('settings-content')
    };

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.getAttribute('data-page');
            currentVisiblePage = targetPage; // Track current page

            // Update active menu item
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');

            // Show target page, hide others
            Object.keys(pages).forEach(pageKey => {
                if (pageKey === targetPage) {
                    pages[pageKey].style.display = 'block';
                    if (pageKey === 'homepage') {
                        // Reload chord diagrams when navigating back to homepage
                        if (typeof loadChordDiagrams === 'function' && typeof d3 !== 'undefined') {
                            console.log('[NAV] Navigated to homepage - reloading chord diagrams');
                            loadChordDiagrams().catch(error => {
                                console.error('[NAV] Error loading chord diagrams:', error);
                            });
                        }

                        // ALSO reload tag-filtered chord diagram if tags are selected
                        if (typeof loadTagFilteredChordDiagram === 'function' && typeof d3 !== 'undefined') {
                            console.log('[NAV] Navigated to homepage - reloading tag-filtered chord diagram');
                            // Load tag-filtered diagram (it will check for saved tags internally)
                            loadTagFilteredChordDiagram().catch(error => {
                                console.error('[NAV] Error loading tag-filtered chord diagram:', error);
                            });
                        }
                    } else if (pageKey === 'device-info') {
                        // Load interfaces by default (first tab)
                        loadInterfaces();
                    } else if (pageKey === 'connected-devices') {
                        loadConnectedDevices();
                    } else if (pageKey === 'applications') {
                        loadApplications();
                        setupApplicationsEventListeners();
                        restoreApplicationsFiltersState();
                    } else if (pageKey === 'logs') {
                        // Load system logs by default (first tab)
                        loadSystemLogs();
                    } else if (pageKey === 'analytics') {
                        // Load analytics dashboard page
                        initAnalyticsPage();
                    } else if (pageKey === 'devices') {
                        loadDevices();
                    } else if (pageKey === 'settings') {
                        loadSettings();
                    }
                } else {
                    pages[pageKey].style.display = 'none';
                }
            });
        });
    });

    // Modal event listeners for devices page
    const addDeviceBtn = document.getElementById('addDeviceBtn');
    if (addDeviceBtn) {
        addDeviceBtn.addEventListener('click', () => showDeviceModal());
    }

    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', hideDeviceModal);
    }

    const cancelModalBtn = document.getElementById('cancelModalBtn');
    if (cancelModalBtn) {
        cancelModalBtn.addEventListener('click', hideDeviceModal);
    }

    const deviceForm = document.getElementById('deviceForm');
    if (deviceForm) {
        deviceForm.addEventListener('submit', saveDevice);
    }

    const testConnectionBtn = document.getElementById('testConnectionBtn');
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', testConnection);
    }

    // Logs page tab switching
    const logsTabs = document.querySelectorAll('.logs-tab');
    if (logsTabs.length > 0) {
        logsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');

                // Update active tab styling
                logsTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.color = 'rgba(255, 255, 255, 0.6)';
                    t.style.borderBottom = '3px solid transparent';
                });
                tab.classList.add('active');
                tab.style.color = '#FA582D';
                tab.style.borderBottom = '3px solid #FA582D';

                // Show target tab content, hide others
                const systemLogsTab = document.getElementById('system-logs-tab');
                const trafficLogsTab = document.getElementById('traffic-logs-tab');

                if (targetTab === 'system-logs') {
                    systemLogsTab.style.display = 'block';
                    trafficLogsTab.style.display = 'none';
                    loadSystemLogs();
                } else if (targetTab === 'traffic-logs') {
                    systemLogsTab.style.display = 'none';
                    trafficLogsTab.style.display = 'block';
                    updateTrafficPage();
                }
            });
        });
    }

    // Device Info page tab switching
    const deviceInfoTabs = document.querySelectorAll('.device-info-tab');
    if (deviceInfoTabs.length > 0) {
        deviceInfoTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');

                // Update active tab styling
                deviceInfoTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.color = 'rgba(255, 255, 255, 0.6)';
                    t.style.borderBottom = '3px solid transparent';
                });
                tab.classList.add('active');
                tab.style.color = '#FA582D';
                tab.style.borderBottom = '3px solid #FA582D';

                // Show target tab content, hide others
                const softwareUpdatesTab = document.getElementById('software-updates-tab');
                const interfacesTab = document.getElementById('interfaces-tab');
                const dhcpTab = document.getElementById('dhcp-tab');
                const techSupportTab = document.getElementById('tech-support-tab');
                const rebootTab = document.getElementById('reboot-tab');

                if (targetTab === 'software-updates') {
                    softwareUpdatesTab.style.display = 'block';
                    interfacesTab.style.display = 'none';
                    dhcpTab.style.display = 'none';
                    techSupportTab.style.display = 'none';
                    rebootTab.style.display = 'none';
                    loadSoftwareUpdates();
                } else if (targetTab === 'interfaces') {
                    softwareUpdatesTab.style.display = 'none';
                    interfacesTab.style.display = 'block';
                    dhcpTab.style.display = 'none';
                    techSupportTab.style.display = 'none';
                    rebootTab.style.display = 'none';
                    loadInterfaces();
                } else if (targetTab === 'dhcp') {
                    softwareUpdatesTab.style.display = 'none';
                    interfacesTab.style.display = 'none';
                    dhcpTab.style.display = 'block';
                    techSupportTab.style.display = 'none';
                    rebootTab.style.display = 'none';
                    loadDhcpLeases();
                } else if (targetTab === 'tech-support') {
                    softwareUpdatesTab.style.display = 'none';
                    interfacesTab.style.display = 'none';
                    dhcpTab.style.display = 'none';
                    techSupportTab.style.display = 'block';
                    rebootTab.style.display = 'none';
                } else if (targetTab === 'reboot') {
                    softwareUpdatesTab.style.display = 'none';
                    interfacesTab.style.display = 'none';
                    dhcpTab.style.display = 'none';
                    techSupportTab.style.display = 'none';
                    rebootTab.style.display = 'block';
                }
            });
        });
    }

    // Software Updates sub-tab switching (PAN-OS / Components)
    const softwareSubTabs = document.querySelectorAll('.software-sub-tab');
    if (softwareSubTabs.length > 0) {
        softwareSubTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');

                // Update active sub-tab styling
                softwareSubTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.color = 'rgba(255, 255, 255, 0.6)';
                    t.style.borderBottom = '3px solid transparent';
                });
                tab.classList.add('active');
                tab.style.color = '#FA582D';
                tab.style.borderBottom = '3px solid #FA582D';

                // Show target sub-tab content, hide others
                const panosSubTab = document.getElementById('panos-sub-tab');
                const componentsSubTab = document.getElementById('components-sub-tab');

                if (targetTab === 'panos') {
                    panosSubTab.style.display = 'block';
                    componentsSubTab.style.display = 'none';
                } else if (targetTab === 'components') {
                    panosSubTab.style.display = 'none';
                    componentsSubTab.style.display = 'block';
                }
            });
        });
    }
}

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
    // 7. REFRESH ALL PAGE DATA
    // ========================================================================
    console.log('Triggering refresh of all page data...');

    // Restart update interval for dashboard data
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
    }

    // Preload historical data for charts before starting real-time updates
    await preloadChartData();

    // Fixed v1.14.1: Don't immediately call fetchThroughputData after preload
    // This was adding a single latest sample to the historical chart, contaminating it
    // Just start the interval, the first call will happen after UPDATE_INTERVAL
    console.log(`Starting auto-refresh with ${UPDATE_INTERVAL}ms interval...`);
    updateIntervalId = setInterval(fetchThroughputData, UPDATE_INTERVAL);
    console.log(`✓ Auto-refresh interval started (first update in ${UPDATE_INTERVAL/1000}s)`);

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
        rebootButton.style.background = '';
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

        // Populate tag filter dropdown for new device and reload tag diagram if tags selected
        if (typeof populateTagFilterDropdown === 'function') {
            console.log('Populating tag filter dropdown for new device...');
            try {
                await populateTagFilterDropdown();
                // Reload tag diagram if tags are selected
                const tagSelect = document.getElementById('chordTagFilter');
                if (tagSelect && tagSelect.selectedOptions.length > 0 && typeof loadTagFilteredChordDiagram === 'function') {
                    await loadTagFilteredChordDiagram();
                }
            } catch (error) {
                console.error('[REFRESH] Error with tag filter:', error);
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
    // Tile 1: Data Plane CPU
    const cpuElement = document.getElementById('cyberHealthCpu');
    if (cpuElement && data.cpu && data.cpu.data_plane_cpu !== undefined) {
        cpuElement.textContent = data.cpu.data_plane_cpu + '%';
    }

    // Tile 2: System Memory
    const memoryElement = document.getElementById('cyberHealthMemory');
    if (memoryElement && data.cpu && data.cpu.memory_used_pct !== undefined) {
        memoryElement.textContent = data.cpu.memory_used_pct + '%';
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
// Chord Diagram Functions - Client-to-Destination Traffic Visualization
// ===================================================================================

/**
 * Fetch and render chord diagrams for client-destination traffic flows
 * Displays two separate diagrams: Internal traffic and Internet traffic
 */
async function loadChordDiagrams() {
    console.log('[CHORD] Loading chord diagrams for client-destination traffic flow');

    try {
        // Get CSRF token from meta tag
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        const response = await fetch('/api/client-destination-flow', {
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
            console.log('[CHORD] Flow data received:', {
                internal_nodes: data.internal.nodes.length,
                internal_flows: data.internal.flows.length,
                internet_nodes: data.internet.nodes.length,
                internet_flows: data.internet.flows.length
            });

            // Update flow counts
            const internalCount = document.getElementById('chordInternalCount');
            const internetCount = document.getElementById('chordInternetCount');
            if (internalCount) {
                internalCount.textContent = `${data.internal.flows.length} flows`;
            }
            if (internetCount) {
                internetCount.textContent = `${data.internet.flows.length} flows`;
            }

            // Render both chord diagrams
            renderChordDiagram('chordInternalSvg', data.internal, 'internal');
            renderChordDiagram('chordInternetSvg', data.internet, 'internet');
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
        // Green/cool theme for internet traffic
        colorScheme = ['#4CAF50', '#66BB6A', '#81C784', '#A5D6A7', '#26A69A', '#00ACC1', '#00BCD4', '#0097A7'];
    }

    const color = d3.scaleOrdinal()
        .domain(d3.range(data.nodes.length))
        .range(colorScheme);

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
        .style('fill', d => color(d.source.index))
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

            tooltip.style('opacity', 1)
                .html(`<strong>${sourceNode}</strong> → <strong>${targetNode}</strong><br/>${valueText}`)
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

            tooltip.style('opacity', 1)
                .html(`<strong>${data.nodes[d.index]}</strong>`)
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
            // Show full IP address for clarity
            return data.nodes[d.index];
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
        console.log(`[CHORD-TAG] Saving tag filter selection: ${selectedTags.join(', ')}`);

        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        const response = await fetch('/api/settings/tag-filter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({ selected_tags: selectedTags })
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
        const response = await fetch('/api/settings/tag-filter');

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        if (data.status === 'success' && data.selected_tags) {
            console.log(`[CHORD-TAG] Loaded saved tag selection: ${data.selected_tags.join(', ')}`);
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

        const response = await fetch(`/api/client-destination-flow-by-tag?tags=${encodeURIComponent(tagsParam)}`, {
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

// Note: Modal functions (showCriticalThreatsModal, showMediumThreatsModal, showBlockedUrlsModal, showTopAppsModal)
// have been moved to pages.js for better code organization

