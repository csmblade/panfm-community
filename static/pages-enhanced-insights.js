/**
 * Enhanced Insights Modal (v1.13.0)
 *
 * Advanced system metrics dashboard with tabbed interface displaying:
 * - Disk usage metrics
 * - Session utilization tracking
 * - Database version information
 * - System health charts
 * - Network performance data
 * - Security metrics
 */

// Chart instances for System Health tab
let eiDiskChart = null;
let eiSessionChart = null;

/**
 * Open Enhanced Insights Modal
 */
window.openEnhancedInsightsModal = function() {
    const modal = document.getElementById('enhancedInsightsModal');
    if (modal) {
        modal.style.display = 'flex';

        // Load data when modal opens
        loadEnhancedInsightsData();

        // Initialize charts if not already created
        if (!eiDiskChart) {
            initializeEnhancedInsightsCharts();
        }
    }
};

/**
 * Close Enhanced Insights Modal
 */
window.closeEnhancedInsightsModal = function() {
    const modal = document.getElementById('enhancedInsightsModal');
    if (modal) {
        modal.style.display = 'none';
    }
};

/**
 * Switch between tabs in Enhanced Insights modal
 */
window.switchEnhancedInsightsTab = function(tabName) {
    console.log(`Switching to Enhanced Insights tab: ${tabName}`);

    // Hide all tab contents
    const tabContents = document.querySelectorAll('.ei-tab-content');
    tabContents.forEach(content => {
        content.style.display = 'none';
    });

    // Remove active class from all tabs
    const tabs = document.querySelectorAll('.ei-tab');
    tabs.forEach(tab => {
        tab.style.borderBottomColor = 'transparent';
        tab.style.color = '#666';
        tab.classList.remove('active');
    });

    // Show selected tab content
    const selectedContent = document.getElementById(`ei-tab-${tabName}`);
    if (selectedContent) {
        selectedContent.style.display = 'block';
    }

    // Add active class to selected tab
    const selectedTab = document.querySelector(`.ei-tab[data-tab="${tabName}"]`);
    if (selectedTab) {
        selectedTab.style.borderBottomColor = '#FA582D';
        selectedTab.style.color = '#FA582D';
        selectedTab.classList.add('active');
    }

    // Load tab-specific data
    if (tabName === 'system-health') {
        loadSystemHealthData();
    } else if (tabName === 'network') {
        loadNetworkData();
    } else if (tabName === 'security') {
        loadSecurityData();
    }
};

/**
 * Load Enhanced Insights data from API
 */
async function loadEnhancedInsightsData() {
    const selectedDeviceId = localStorage.getItem('selected_device_id');
    if (!selectedDeviceId) {
        console.warn('No device selected for Enhanced Insights');
        return;
    }

    console.log('Loading Enhanced Insights data for device:', selectedDeviceId);

    try {
        // Fetch latest throughput data with enhanced metrics
        const response = await fetch(`/api/throughput/history?device_id=${selectedDeviceId}&range=1h`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('Enhanced Insights data loaded:', data);

        // Check for waiting status (v1.14.0 - Enterprise Reliability)
        if (data.status === 'waiting') {
            console.log('⏳ Waiting for first data collection...');
            showEnhancedInsightsWaiting(data.message, data.retry_after_seconds || 30);
            return;
        }

        if (data.samples && data.samples.length > 0) {
            // Get most recent sample for current metrics
            const latestSample = data.samples[data.samples.length - 1];
            updateEnhancedInsightsOverview(latestSample);
            updateDatabaseVersionsTab(latestSample);
        } else {
            console.warn('No samples available for Enhanced Insights');
            showNoDataMessage();
        }

    } catch (error) {
        console.error('Error loading Enhanced Insights data:', error);
        showErrorMessage('Failed to load Enhanced Insights data');
    }
}

/**
 * Update Overview tab with latest metrics
 */
function updateEnhancedInsightsOverview(sample) {
    console.log('Updating Enhanced Insights Overview with sample:', sample);

    // Disk Usage
    if (sample.disk_usage) {
        document.getElementById('ei-disk-root').textContent = `${sample.disk_usage.root_pct || 0}%`;
        document.getElementById('ei-disk-logs').textContent = `${sample.disk_usage.logs_pct || 0}%`;
        document.getElementById('ei-disk-var').textContent = `${sample.disk_usage.var_pct || 0}%`;
    } else {
        document.getElementById('ei-disk-root').textContent = '--';
        document.getElementById('ei-disk-logs').textContent = '--';
        document.getElementById('ei-disk-var').textContent = '--';
    }

    // Session Utilization
    if (sample.session_utilization) {
        const util = sample.session_utilization.utilization_pct || 0;
        document.getElementById('ei-session-util').textContent = `${util.toFixed(1)}%`;
        document.getElementById('ei-session-active').textContent = sample.sessions?.active || 0;
        document.getElementById('ei-session-max').textContent = sample.session_utilization.max_capacity || 0;
    } else if (sample.sessions) {
        // Fallback to sessions data if session_utilization not available yet
        const active = sample.sessions.active || 0;
        const max = sample.sessions.max || 0;
        const util = max > 0 ? (active / max * 100).toFixed(1) : 0;
        document.getElementById('ei-session-util').textContent = `${util}%`;
        document.getElementById('ei-session-active').textContent = active;
        document.getElementById('ei-session-max').textContent = max;
    } else {
        document.getElementById('ei-session-util').textContent = '--';
        document.getElementById('ei-session-active').textContent = '--';
        document.getElementById('ei-session-max').textContent = '--';
    }

    // Database Versions
    if (sample.database_versions) {
        document.getElementById('ei-threat-version').textContent = sample.database_versions.threat_version || 'N/A';
        document.getElementById('ei-app-version').textContent = sample.database_versions.app_version || 'N/A';
        document.getElementById('ei-wildfire-version').textContent = sample.database_versions.wildfire_version || 'N/A';
    } else {
        document.getElementById('ei-threat-version').textContent = '--';
        document.getElementById('ei-app-version').textContent = '--';
        document.getElementById('ei-wildfire-version').textContent = '--';
    }

    // System Status (simple health check based on metrics)
    const diskOk = !sample.disk_usage || (sample.disk_usage.root_pct < 90 && sample.disk_usage.logs_pct < 90);
    const sessionOk = !sample.session_utilization || sample.session_utilization.utilization_pct < 90;
    const status = (diskOk && sessionOk) ? 'Healthy' : 'Warning';
    const statusColor = status === 'Healthy' ? '#43e97b' : '#ffa500';

    const statusEl = document.getElementById('ei-system-status');
    if (statusEl) {
        statusEl.textContent = status;
        statusEl.style.color = statusColor;
    }

    // Last Check timestamp
    const timestamp = new Date(sample.timestamp);
    document.getElementById('ei-last-check').textContent = timestamp.toLocaleString();

    // Quick Stats (Current Metrics)
    document.getElementById('ei-cpu-dp').textContent = sample.cpu?.data_plane_cpu ? `${sample.cpu.data_plane_cpu}%` : '--';
    document.getElementById('ei-memory').textContent = sample.cpu?.memory_used_pct ? `${sample.cpu.memory_used_pct}%` : '--';
    document.getElementById('ei-sessions').textContent = sample.sessions?.active || '--';
    document.getElementById('ei-throughput').textContent = sample.total_mbps ? `${sample.total_mbps.toFixed(2)} Mbps` : '--';
}

/**
 * Update Database Versions tab
 */
function updateDatabaseVersionsTab(sample) {
    if (!sample.database_versions) {
        console.warn('No database versions data available');
        return;
    }

    const versions = sample.database_versions;

    // Update all version displays
    document.getElementById('ei-db-app-version').textContent = versions.app_version || 'N/A';
    document.getElementById('ei-db-threat-version').textContent = versions.threat_version || 'N/A';
    document.getElementById('ei-db-wildfire-version').textContent = versions.wildfire_version || 'N/A';
    document.getElementById('ei-db-url-version').textContent = versions.url_version || 'N/A';

    // Last updated timestamp
    const timestamp = new Date(sample.timestamp);
    document.getElementById('ei-db-last-updated').textContent = timestamp.toLocaleString();
}

/**
 * Initialize charts for System Health tab
 */
function initializeEnhancedInsightsCharts() {
    console.log('Initializing Enhanced Insights charts');

    // Disk Usage Chart
    const diskCtx = document.getElementById('ei-disk-chart');
    if (diskCtx) {
        eiDiskChart = new Chart(diskCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Root Partition',
                        data: [],
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102,126,234,0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: 'Logs Partition',
                        data: [],
                        borderColor: '#f093fb',
                        backgroundColor: 'rgba(240,147,251,0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: 'Var Partition',
                        data: [],
                        borderColor: '#4facfe',
                        backgroundColor: 'rgba(79,172,254,0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
    }

    // Session Utilization Chart
    const sessionCtx = document.getElementById('ei-session-chart');
    if (sessionCtx) {
        eiSessionChart = new Chart(sessionCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Session Utilization %',
                        data: [],
                        borderColor: '#FA582D',
                        backgroundColor: 'rgba(250,88,45,0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
    }
}

/**
 * Load System Health data and update charts
 */
async function loadSystemHealthData() {
    const selectedDeviceId = localStorage.getItem('selected_device_id');
    if (!selectedDeviceId) {
        console.warn('No device selected for System Health data');
        return;
    }

    console.log('Loading System Health chart data');

    try {
        // Fetch historical data (last 24 hours for charts)
        const response = await fetch(`/api/throughput/history?device_id=${selectedDeviceId}&range=24h`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.samples && data.samples.length > 0) {
            updateSystemHealthCharts(data.samples);
        } else {
            console.warn('No samples available for System Health charts');
        }

    } catch (error) {
        console.error('Error loading System Health data:', error);
    }
}

/**
 * Update System Health charts with historical data
 */
function updateSystemHealthCharts(samples) {
    if (!eiDiskChart || !eiSessionChart) {
        console.warn('Charts not initialized');
        return;
    }

    const labels = [];
    const rootData = [];
    const logsData = [];
    const varData = [];
    const sessionUtilData = [];

    samples.forEach(sample => {
        const date = new Date(sample.timestamp);
        const label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        labels.push(label);

        // Disk usage data
        if (sample.disk_usage) {
            rootData.push(sample.disk_usage.root_pct || 0);
            logsData.push(sample.disk_usage.logs_pct || 0);
            varData.push(sample.disk_usage.var_pct || 0);
        } else {
            rootData.push(0);
            logsData.push(0);
            varData.push(0);
        }

        // Session utilization data
        if (sample.session_utilization) {
            sessionUtilData.push(sample.session_utilization.utilization_pct || 0);
        } else if (sample.sessions && sample.sessions.max > 0) {
            // Calculate from active/max if session_utilization not available
            const util = (sample.sessions.active / sample.sessions.max) * 100;
            sessionUtilData.push(util);
        } else {
            sessionUtilData.push(0);
        }
    });

    // Update Disk Usage Chart
    eiDiskChart.data.labels = labels;
    eiDiskChart.data.datasets[0].data = rootData;
    eiDiskChart.data.datasets[1].data = logsData;
    eiDiskChart.data.datasets[2].data = varData;
    eiDiskChart.update();

    // Update Session Utilization Chart
    eiSessionChart.data.labels = labels;
    eiSessionChart.data.datasets[0].data = sessionUtilData;
    eiSessionChart.update();

    console.log(`System Health charts updated with ${samples.length} data points`);
}

/**
 * Load Network Performance data
 */
async function loadNetworkData() {
    console.log('Loading Network Performance data (placeholder)');
    const contentEl = document.getElementById('ei-network-content');
    if (contentEl) {
        contentEl.innerHTML = '<p style="color: #999; font-family: var(--font-secondary);">Network performance metrics will be available in a future update.</p>';
    }
}

/**
 * Load Security metrics data
 */
async function loadSecurityData() {
    console.log('Loading Security metrics (placeholder)');
    const contentEl = document.getElementById('ei-security-content');
    if (contentEl) {
        contentEl.innerHTML = '<p style="color: #999; font-family: var(--font-secondary);">Security metrics will be available in a future update.</p>';
    }
}

/**
 * Show no data message
 */
function showNoDataMessage() {
    console.warn('No data available for Enhanced Insights');
    document.getElementById('ei-disk-root').textContent = 'No Data';
    document.getElementById('ei-session-util').textContent = 'No Data';
    document.getElementById('ei-threat-version').textContent = 'No Data';
    document.getElementById('ei-system-status').textContent = 'No Data';
}

/**
 * Show error message
 */
function showErrorMessage(message) {
    console.error('Enhanced Insights error:', message);
    // Could show a toast notification here
}

/**
 * Show waiting state message (v1.14.0 - Enterprise Reliability)
 * Displays friendly message during initial data collection period
 */
function showEnhancedInsightsWaiting(message, retryAfterSeconds) {
    console.log(`Enhanced Insights waiting state: ${message}`);

    // Clear all metric displays with waiting message
    document.getElementById('ei-disk-root').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-disk-logs').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-disk-var').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';

    document.getElementById('ei-session-util').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-session-active').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳</span>';
    document.getElementById('ei-session-max').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳</span>';

    document.getElementById('ei-threat-version').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-app-version').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-wildfire-version').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';

    document.getElementById('ei-system-status').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting for data...</span>';
    document.getElementById('ei-last-check').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Initial collection in progress</span>';

    // Quick Stats
    document.getElementById('ei-cpu-dp').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳</span>';
    document.getElementById('ei-memory').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳</span>';
    document.getElementById('ei-sessions').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳</span>';
    document.getElementById('ei-throughput').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳</span>';

    // Database Versions tab
    document.getElementById('ei-db-app-version').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-db-threat-version').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-db-wildfire-version').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-db-url-version').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Waiting...</span>';
    document.getElementById('ei-db-last-updated').innerHTML = '<span style="font-size: 0.85em; color: #FA582D;">⏳ Initial collection in progress</span>';

    // Auto-retry after specified delay
    console.log(`Auto-retry scheduled in ${retryAfterSeconds} seconds`);
    setTimeout(() => {
        console.log('Auto-retry: reloading Enhanced Insights...');
        loadEnhancedInsightsData();
    }, retryAfterSeconds * 1000);
}

// Close modal when clicking outside of it
window.onclick = function(event) {
    const modal = document.getElementById('enhancedInsightsModal');
    if (event.target === modal) {
        closeEnhancedInsightsModal();
    }
};

console.log('Enhanced Insights module loaded (v1.13.0)');
