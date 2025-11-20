console.log('[APP.JS] ===== FILE LOADING STARTED =====');

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

// Initialize Chart.js
const ctx = document.getElementById('throughputChart').getContext('2d');
// Make chart globally accessible
const chart = window.chart = window.throughputChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: chartData.labels,
        datasets: [
            {
                label: 'Inbound',
                data: chartData.inbound,
                borderColor: '#ff6600',
                backgroundColor: 'rgba(255, 102, 0, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            },
            {
                label: 'Outbound',
                data: chartData.outbound,
                borderColor: '#ff9933',
                backgroundColor: 'rgba(255, 153, 51, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            },
            {
                label: 'Total',
                data: chartData.total,
                borderColor: '#333333',
                backgroundColor: 'rgba(51, 51, 51, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 12,
                titleFont: {
                    size: 14
                },
                bodyFont: {
                    size: 13
                },
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        label += context.parsed.y.toFixed(2) + ' MB';
                        return label;
                    }
                }
            }
        },
        scales: {
            x: {
                display: true,
                grid: {
                    display: false
                },
                ticks: {
                    font: {
                        size: 10
                    },
                    maxRotation: 0,
                    minRotation: 0,
                    maxTicksLimit: 10,
                    autoSkip: true,
                    autoSkipPadding: 10
                }
            },
            y: {
                display: true,
                beginAtZero: true,
                grid: {
                    color: 'rgba(0, 0, 0, 0.05)'
                },
                ticks: {
                    font: {
                        size: 12
                    },
                    callback: function(value) {
                        return value.toFixed(1) + ' Mbps';
                    }
                }
            }
        },
        animation: {
            duration: 750,
            easing: 'easeInOutQuart'
        }
    }
});

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

    // Update chart datasets directly
    chart.data.labels = chartData.labels.slice();
    chart.data.datasets[0].data = chartData.inbound.slice();
    chart.data.datasets[1].data = chartData.outbound.slice();
    chart.data.datasets[2].data = chartData.total.slice();

    // Update chart
    chart.update('none'); // No animation for smoother updates
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

    document.getElementById('inboundValue').innerHTML = inbound.toLocaleString() + calculateTrend(historicalData.inbound);
    document.getElementById('outboundValue').innerHTML = outbound.toLocaleString() + calculateTrend(historicalData.outbound);
    document.getElementById('totalValue').innerHTML = total.toLocaleString() + calculateTrend(historicalData.total);

    // Calculate 5-minute averages (last 5 samples at 60-second intervals = 300 seconds = 5 minutes)
    const last5Inbound = historicalData.inbound.slice(-5);
    const last5Outbound = historicalData.outbound.slice(-5);
    const last5Total = historicalData.total.slice(-5);

    const inboundAvg = calculateAverage(last5Inbound);
    const outboundAvg = calculateAverage(last5Outbound);
    const totalAvg = calculateAverage(last5Total);

    document.getElementById('inboundAvg').textContent = inboundAvg.toLocaleString();
    document.getElementById('outboundAvg').textContent = outboundAvg.toLocaleString();
    document.getElementById('totalAvg').textContent = totalAvg.toLocaleString();

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

            interfaceErrorsElement.innerHTML = totalIssues.toLocaleString() + calculateTrend(historicalData.interfaceErrors);

            if (interfaceDetailsElement) {
                interfaceDetailsElement.textContent = `${data.interfaces.total_errors.toLocaleString()} errors, ${data.interfaces.total_drops.toLocaleString()} drops`;
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

            // Update count value on tile
            const valueElement = document.getElementById(config.elementIds.value);
            if (valueElement) {
                valueElement.innerHTML = uniqueItems.size.toLocaleString();
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
            // Use brand theme color
            expiredElement.style.color = '#FA582D';
        }

        if (licensedElement) {
            licensedElement.textContent = data.license.licensed || 0;
            // Use brand theme color
            licensedElement.style.color = '#FA582D';
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

            // Update main chart with preloaded data
            chart.update();

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

    // Load settings first
    await initSettings();

    // Load devices and populate device selector
    if (typeof loadDevices === 'function') {
        await loadDevices();
        console.log('Devices loaded on initialization');
    }

    // Load device metadata cache for dashboard use
    await loadDeviceMetadataCache();

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

// Start the app when DOM is ready (initialize device first!)
console.log('[APP.JS] Script loaded - DOMContentLoaded listener registered');

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[APP.JS] DOMContentLoaded fired - starting initialization...');

    // Initialize device first (critical for all pages)
    await initializeCurrentDevice();

    // Then run normal initialization
    await init();  // Fixed: await the async function

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

    // Update chart
    window.chart.data.labels = window.chartData.labels.slice();
    window.chart.data.datasets[0].data = window.chartData.inbound.slice();
    window.chart.data.datasets[1].data = window.chartData.outbound.slice();
    window.chart.data.datasets[2].data = window.chartData.total.slice();

    window.chart.update('none'); // Update without animation for smoother real-time updates

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

        // Update chart from chartData
        window.chart.data.labels = window.chartData.labels.slice();
        window.chart.data.datasets[0].data = window.chartData.inbound.slice();
        window.chart.data.datasets[1].data = window.chartData.outbound.slice();
        window.chart.data.datasets[2].data = window.chartData.total.slice();

        console.log(`[CHART] Updating chart with ${window.chartData.labels.length} data points`);
        console.log(`[CHART] First label: ${window.chartData.labels[0]}, Last label: ${window.chartData.labels[window.chartData.labels.length - 1]}`);
        console.log(`[CHART] Inbound range: ${Math.min(...window.chartData.inbound).toFixed(2)} - ${Math.max(...window.chartData.inbound).toFixed(2)} Mbps`);
        console.log(`[CHART] Outbound range: ${Math.min(...window.chartData.outbound).toFixed(2)} - ${Math.max(...window.chartData.outbound).toFixed(2)} Mbps`);

        window.chart.update();

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

            // Show sample count
            const sampleCountDisplay = document.getElementById('sampleCountDisplay');
            const sampleCount = document.getElementById('historicalSampleCount');
            sampleCount.textContent = data.sample_count.toLocaleString();
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
        'alerts': document.getElementById('alerts-content'),
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
                    if (pageKey === 'device-info') {
                        // Load interfaces by default (first tab)
                        loadInterfaces();
                    } else if (pageKey === 'connected-devices') {
                        loadConnectedDevices();
                    } else if (pageKey === 'applications') {
                        loadApplications();
                        setupApplicationsEventListeners();
                    } else if (pageKey === 'logs') {
                        // Load system logs by default (first tab)
                        loadSystemLogs();
                    } else if (pageKey === 'alerts') {
                        // Load alerts page
                        if (typeof initAlertsPage === 'function') {
                            initAlertsPage();
                        }
                        if (typeof loadAlertTemplates === 'function') {
                            loadAlertTemplates();
                        }
                        if (typeof loadQuickStartScenarios === 'function') {
                            loadQuickStartScenarios();
                        }
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

    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    chart.data.datasets[1].data = [];
    chart.data.datasets[2].data = [];
    chart.update('none');
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
    if (currentVisiblePage === 'home') {
        // Dashboard - throughput already refreshed by interval above
        console.log('Dashboard active - using interval for updates');
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

    // Update License Information
    const expiredElement = document.getElementById('sidebarLicenseExpired');
    const licensedElement = document.getElementById('sidebarLicenseLicensed');

    if (expiredElement && data.license_expired !== undefined) {
        expiredElement.textContent = data.license_expired || 0;
    }

    if (licensedElement && data.license_active !== undefined) {
        licensedElement.textContent = data.license_active || 0;
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

        // Update count value on tile (just unique count)
        const valueElement = document.getElementById(config.elementIds.value);
        if (valueElement) {
            valueElement.innerHTML = uniqueItems.size.toLocaleString();
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

    // Tile 3: PPS (Packets Per Second)
    const ppsElement = document.getElementById('cyberHealthPps');
    if (ppsElement && data.total_pps !== undefined) {
        ppsElement.textContent = data.total_pps.toLocaleString();
    }

    // Tile 4: Active Sessions
    const sessionsElement = document.getElementById('cyberHealthSessions');
    if (sessionsElement && data.sessions && data.sessions.active !== undefined) {
        sessionsElement.textContent = data.sessions.active.toLocaleString();
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

// Note: Modal functions (showCriticalThreatsModal, showMediumThreatsModal, showBlockedUrlsModal, showTopAppsModal)
// have been moved to pages.js for better code organization

