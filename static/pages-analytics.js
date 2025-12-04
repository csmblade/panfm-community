/**
 * PANfm Insights Dashboard Module
 * Provides historical data analysis, trend visualization, and log search capabilities
 * @version 1.17.0
 */

// Analytics state
let analyticsChart = null;
let analyticsCpuChart = null;
let analyticsMemoryChart = null;
let analyticsSessionsChart = null;
let analyticsThreatsChart = null;
// v1.0.17: New threat dashboard charts
let threatSourcesChart = null;
let threatActionsChart = null;
let threatCategoriesChart = null;
let threatDashboardData = null;  // Cache for threat dashboard data
let comparisonChart1 = null; // Throughput vs Sessions
let comparisonChart2 = null; // CPU vs Memory
let comparisonChart3 = null; // TCP vs UDP
let comparisonChart4 = null; // Internal vs Internet
// v1.0.14: Removed comparisonChart5 (Threats vs Sessions) - threat data now from dedicated timeline
let comparisonChart6 = null; // Errors vs Throughput
let analyticsData = [];
let currentAnalyticsRange = '24h';

/**
 * Initialize the Insights Dashboard page
 * Called when user navigates to Insights page
 */
window.initAnalyticsPage = function() {
    console.log('Initializing Insights Dashboard...');

    // Restore saved time range selection
    restoreAnalyticsTimeRange();

    // Initialize charts if not already done
    if (!analyticsChart) {
        initAnalyticsChart();
    }
    if (!analyticsCpuChart) {
        initAnalyticsCpuChart();
    }
    if (!analyticsMemoryChart) {
        initAnalyticsMemoryChart();
    }
    if (!analyticsSessionsChart) {
        initAnalyticsSessionsChart();
    }
    if (!analyticsThreatsChart) {
        initAnalyticsThreatsChart();
    }

    // v1.0.17: Initialize threat dashboard charts
    initThreatDashboardCharts();

    // Initialize comparison charts
    if (!comparisonChart1) {
        initComparisonCharts();
    }

    // Load data for default time range
    loadAnalyticsData();

    // Load top bandwidth clients
    loadTopClients();
};

/**
 * Initialize the Chart.js chart for analytics
 */
function initAnalyticsChart() {
    const ctx = document.getElementById('analyticsChart');
    if (!ctx) {
        console.error('Analytics chart canvas not found');
        return;
    }

    analyticsChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Inbound (Mbps)',
                    data: [],
                    borderColor: '#FA582D',
                    backgroundColor: 'rgba(250, 88, 45, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5
                },
                {
                    label: 'Outbound (Mbps)',
                    data: [],
                    borderColor: '#E04F26',
                    backgroundColor: 'rgba(224, 79, 38, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5
                },
                {
                    label: 'Total (Mbps)',
                    data: [],
                    borderColor: '#B8541E',
                    backgroundColor: 'rgba(184, 84, 30, 0.1)',
                    borderWidth: 3,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Roboto', sans-serif",
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: {
                        family: "'Roboto', sans-serif",
                        size: 14
                    },
                    bodyFont: {
                        family: "'Open Sans', sans-serif",
                        size: 12
                    },
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} Mbps`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 10
                        },
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(242, 240, 239, 0.1)'
                    },
                    ticks: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 11
                        },
                        callback: function(value) {
                            return value.toFixed(1) + ' Mbps';
                        }
                    }
                }
            }
        }
    });

    console.log('Insights chart initialized');
}

/**
 * Initialize CPU Chart
 */
function initAnalyticsCpuChart() {
    const ctx = document.getElementById('analyticsCpuChart');
    if (!ctx) {
        console.error('CPU chart canvas not found');
        return;
    }

    analyticsCpuChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Data Plane CPU (%)',
                    data: [],
                    borderColor: '#E04F26',
                    backgroundColor: 'rgba(224, 79, 38, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5
                },
                {
                    label: 'Management Plane CPU (%)',
                    data: [],
                    borderColor: '#B8541E',
                    backgroundColor: 'rgba(184, 84, 30, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Roboto', sans-serif",
                            size: 11
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: {
                        family: "'Roboto', sans-serif",
                        size: 12
                    },
                    bodyFont: {
                        family: "'Open Sans', sans-serif",
                        size: 11
                    },
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 9
                        },
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: 'rgba(242, 240, 239, 0.1)'
                    },
                    ticks: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 10
                        },
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        }
    });

    console.log('CPU chart initialized');
}

/**
 * Initialize Memory Chart
 */
function initAnalyticsMemoryChart() {
    const ctx = document.getElementById('analyticsMemoryChart');
    if (!ctx) {
        console.error('Memory chart canvas not found');
        return;
    }

    analyticsMemoryChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Memory Usage (%)',
                    data: [],
                    borderColor: '#C23C14',
                    backgroundColor: 'rgba(194, 60, 20, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Roboto', sans-serif",
                            size: 11
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: {
                        family: "'Roboto', sans-serif",
                        size: 12
                    },
                    bodyFont: {
                        family: "'Open Sans', sans-serif",
                        size: 11
                    },
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        line80: {
                            type: 'line',
                            yMin: 80,
                            yMax: 80,
                            borderColor: '#FFA500',
                            borderWidth: 1,
                            borderDash: [5, 5],
                            label: {
                                content: '80% Warning',
                                enabled: true,
                                position: 'end'
                            }
                        },
                        line90: {
                            type: 'line',
                            yMin: 90,
                            yMax: 90,
                            borderColor: '#FF0000',
                            borderWidth: 1,
                            borderDash: [5, 5],
                            label: {
                                content: '90% Critical',
                                enabled: true,
                                position: 'end'
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 9
                        },
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: 'rgba(242, 240, 239, 0.1)'
                    },
                    ticks: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 10
                        },
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        }
    });

    console.log('Memory chart initialized');
}

/**
 * Initialize the sessions breakdown stacked area chart
 */
function initAnalyticsSessionsChart() {
    const ctx = document.getElementById('analyticsSessionsChart');
    if (!ctx) {
        console.error('Sessions chart canvas element not found');
        return;
    }

    analyticsSessionsChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'TCP Sessions',
                    data: [],
                    backgroundColor: 'rgba(33, 150, 243, 0.5)',
                    borderColor: '#2196F3',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#2196F3',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 2
                },
                {
                    label: 'UDP Sessions',
                    data: [],
                    backgroundColor: 'rgba(76, 175, 80, 0.5)',
                    borderColor: '#4CAF50',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#4CAF50',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 2
                },
                {
                    label: 'ICMP Sessions',
                    data: [],
                    backgroundColor: 'rgba(255, 152, 0, 0.5)',
                    borderColor: '#FF9800',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#FF9800',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            stacked: false,
            plugins: {
                title: {
                    display: false
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Roboto', sans-serif",
                            size: 12,
                            weight: '500'
                        },
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: {
                        family: "'Roboto', sans-serif",
                        size: 13,
                        weight: 'bold'
                    },
                    bodyFont: {
                        family: "'Open Sans', sans-serif",
                        size: 12
                    },
                    padding: 12,
                    cornerRadius: 6,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += context.parsed.y.toLocaleString();
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
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 10
                        },
                        maxRotation: 45,
                        minRotation: 0
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    stacked: true,
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(242, 240, 239, 0.1)'
                    },
                    ticks: {
                        color: '#F2F0EF',
                        font: {
                            family: "'Open Sans', sans-serif",
                            size: 10
                        },
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                }
            }
        }
    });

    console.log('Sessions breakdown chart initialized (stacked area)');
}

/**
 * Initialize the threat count timeline chart (v1.0.17: Stacked area by severity)
 */
function initAnalyticsThreatsChart() {
    const ctx = document.getElementById('analyticsThreatsChart');
    if (!ctx) {
        console.error('Threats chart canvas element not found');
        return;
    }

    analyticsThreatsChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Critical',
                    data: [],
                    backgroundColor: 'rgba(183, 28, 28, 0.7)',
                    borderColor: '#b71c1c',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'High',
                    data: [],
                    backgroundColor: 'rgba(230, 81, 0, 0.7)',
                    borderColor: '#e65100',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Medium',
                    data: [],
                    backgroundColor: 'rgba(249, 168, 37, 0.7)',
                    borderColor: '#f9a825',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'URL Blocked',
                    data: [],
                    backgroundColor: 'rgba(21, 101, 192, 0.7)',
                    borderColor: '#1565C0',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                title: {
                    display: false
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#F2F0EF',
                        font: { family: "'Roboto', sans-serif", size: 11 },
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { family: "'Roboto', sans-serif", size: 13, weight: 'bold' },
                    bodyFont: { family: "'Open Sans', sans-serif", size: 12 },
                    padding: 12,
                    cornerRadius: 6,
                    displayColors: true,
                    callbacks: {
                        footer: function(tooltipItems) {
                            const total = tooltipItems.reduce((sum, item) => sum + item.parsed.y, 0);
                            return 'Total: ' + total.toLocaleString() + ' threats';
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: '#F2F0EF',
                        font: { family: "'Open Sans', sans-serif", size: 10 },
                        maxRotation: 45,
                        minRotation: 0
                    }
                },
                y: {
                    display: true,
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: 'rgba(242, 240, 239, 0.1)' },
                    ticks: {
                        color: '#F2F0EF',
                        font: { family: "'Open Sans', sans-serif", size: 10 },
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                }
            }
        }
    });

    console.log('Threats timeline chart initialized (line chart with area fill)');
}

/**
 * Initialize all 6 comparison mini-charts
 */
function initComparisonCharts() {
    // Common options for all comparison charts
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        plugins: {
            legend: {
                display: true,
                position: 'bottom',
                labels: {
                    color: '#F2F0EF',
                    font: { family: "'Roboto', sans-serif", size: 9 },
                    padding: 8,
                    boxWidth: 12,
                    usePointStyle: true
                }
            },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleFont: { family: "'Roboto', sans-serif", size: 11 },
                bodyFont: { family: "'Open Sans', sans-serif", size: 10 },
                padding: 8,
                cornerRadius: 4,
                displayColors: true
            }
        },
        scales: {
            x: {
                display: true,
                grid: { display: false },
                ticks: {
                    color: '#F2F0EF',
                    font: { size: 8 },
                    maxRotation: 45,
                    minRotation: 0,
                    maxTicksLimit: 8
                }
            },
            y: {
                display: true,
                beginAtZero: true,
                grid: { color: 'rgba(242, 240, 239, 0.1)' },
                ticks: {
                    color: '#F2F0EF',
                    font: { size: 8 },
                    maxTicksLimit: 5
                }
            }
        }
    };

    // Chart 1: Throughput vs Sessions
    const ctx1 = document.getElementById('comparisonChart1');
    if (ctx1) {
        comparisonChart1 = new Chart(ctx1.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Throughput (Mbps)', data: [], borderColor: '#FA582D', backgroundColor: 'rgba(250, 88, 45, 0.1)', yAxisID: 'y', tension: 0.4, borderWidth: 2, pointRadius: 0 },
                    { label: 'Sessions', data: [], borderColor: '#9C27B0', backgroundColor: 'rgba(156, 39, 176, 0.1)', yAxisID: 'y1', tension: 0.4, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: {
                ...commonOptions,
                scales: {
                    ...commonOptions.scales,
                    y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#F2F0EF', font: { size: 8 }, maxTicksLimit: 5 } }
                }
            }
        });
    }

    // Chart 2: CPU vs Memory
    const ctx2 = document.getElementById('comparisonChart2');
    if (ctx2) {
        comparisonChart2 = new Chart(ctx2.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'CPU (%)', data: [], borderColor: '#E04F26', backgroundColor: 'rgba(224, 79, 38, 0.1)', tension: 0.4, borderWidth: 2, pointRadius: 0 },
                    { label: 'Memory (%)', data: [], borderColor: '#C23C14', backgroundColor: 'rgba(194, 60, 20, 0.1)', tension: 0.4, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: commonOptions
        });
    }

    // Chart 3: TCP vs UDP Sessions
    const ctx3 = document.getElementById('comparisonChart3');
    if (ctx3) {
        comparisonChart3 = new Chart(ctx3.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'TCP', data: [], borderColor: '#2196F3', backgroundColor: 'rgba(33, 150, 243, 0.1)', tension: 0.4, borderWidth: 2, pointRadius: 0 },
                    { label: 'UDP', data: [], borderColor: '#4CAF50', backgroundColor: 'rgba(76, 175, 80, 0.1)', tension: 0.4, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: commonOptions
        });
    }

    // Chart 4: Internal vs Internet Traffic
    const ctx4 = document.getElementById('comparisonChart4');
    if (ctx4) {
        comparisonChart4 = new Chart(ctx4.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Internal (Mbps)', data: [], borderColor: '#4CAF50', backgroundColor: 'rgba(76, 175, 80, 0.1)', tension: 0.4, borderWidth: 2, pointRadius: 0 },
                    { label: 'Internet (Mbps)', data: [], borderColor: '#FF9800', backgroundColor: 'rgba(255, 152, 0, 0.1)', tension: 0.4, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: commonOptions
        });
    }

    // v1.0.14: Removed Chart 5 (Threats vs Sessions) - threat data now from dedicated timeline

    // Chart 6: Interface Errors vs Throughput (renumbered to Chart 5 in UI)
    const ctx6 = document.getElementById('comparisonChart6');
    if (ctx6) {
        comparisonChart6 = new Chart(ctx6.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Errors', data: [], borderColor: '#FF5722', backgroundColor: 'rgba(255, 87, 34, 0.1)', yAxisID: 'y', tension: 0.4, borderWidth: 2, pointRadius: 0 },
                    { label: 'Throughput (Mbps)', data: [], borderColor: '#FA582D', backgroundColor: 'rgba(250, 88, 45, 0.1)', yAxisID: 'y1', tension: 0.4, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: {
                ...commonOptions,
                scales: {
                    ...commonOptions.scales,
                    y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#F2F0EF', font: { size: 8 }, maxTicksLimit: 5 } }
                }
            }
        });
    }

    console.log('All 5 comparison mini-charts initialized');  // v1.0.14: Reduced from 6
}

/**
 * Get current device ID with fallback to settings API
 * Ensures we always have a valid device_id before making API calls
 * @returns {Promise<string>} Device ID or empty string
 */
async function getAnalyticsDeviceId() {
    let deviceId = window.currentDeviceId || '';

    // If no device selected, try to get from settings
    if (!deviceId || deviceId.trim() === '') {
        console.log('[Insights] No device selected, fetching from settings...');
        try {
            const settingsResponse = await window.apiClient.get('/api/settings');
            if (settingsResponse.ok && settingsResponse.data.status === 'success') {
                deviceId = settingsResponse.data.settings.selected_device_id || '';
                window.currentDeviceId = deviceId;
                console.log('[Insights] Loaded device from settings:', deviceId);
            }
        } catch (error) {
            console.warn('[Insights] Failed to fetch settings:', error);
        }
    }

    return deviceId;
}

/**
 * Load analytics data for the selected time range
 * Enterprise version with health check, retry logic, and proper initialization handling
 */
window.loadAnalyticsData = async function(retryCount = 0) {
    const timeRangeSelect = document.getElementById('analyticsTimeRange');
    if (!timeRangeSelect) return;

    currentAnalyticsRange = timeRangeSelect.value;
    console.log(`Loading insights data for range: ${currentAnalyticsRange} (attempt ${retryCount + 1})`);

    // Show loading state
    updateLoadingState(true);

    try {
        // Step 1: Check system health before loading data (enterprise startup)
        const healthResponse = await window.apiClient.get('/api/system/health');
        if (!healthResponse.ok) {
            throw new Error('Health check failed');
        }

        const health = healthResponse.data;
        console.log('System health:', health);

        // Step 2: If system not ready, show initialization message and retry
        if (!health.ready) {
            showInitializingMessage(health);

            // Auto-retry after suggested delay (max 3 retries)
            if (retryCount < 3) {
                const retryDelay = (health.retry_after || 5) * 1000;
                console.log(`System not ready, retrying in ${retryDelay/1000}s... (${retryCount + 1}/3)`);
                setTimeout(() => loadAnalyticsData(retryCount + 1), retryDelay);
            } else {
                console.warn('Max retries reached, giving up');
                showErrorMessage('System still initializing after 3 retries. Please refresh the page.');
            }

            updateLoadingState(false);
            return;
        }

        // Step 3: System is ready, ensure device is selected before loading data
        const deviceId = await getAnalyticsDeviceId();

        // Final validation - cannot load analytics without a device
        if (!deviceId || deviceId.trim() === '') {
            showErrorMessage('No device selected. Please select a device from the dropdown at the top of the page.');
            updateLoadingState(false);
            return;
        }

        // Fetch historical data with validated device_id
        const historyUrl = `/api/throughput/history?device_id=${deviceId}&range=${currentAnalyticsRange}&resolution=auto`;
        const historyResponse = await fetch(historyUrl);

        if (!historyResponse.ok) {
            // Check if error response has a JSON body with message
            try {
                const errorData = await historyResponse.json();
                if (errorData.message) {
                    throw new Error(errorData.message);
                }
            } catch (e) {
                // If JSON parsing fails, use generic error
            }
            throw new Error(`Failed to fetch history: ${historyResponse.status}`);
        }

        const historyData = await historyResponse.json();

        // Step 4: Handle different response statuses
        if (historyData.status === 'success' && historyData.samples && historyData.samples.length > 0) {
            // Data available - update all charts
            analyticsData = historyData.samples;
            updateAnalyticsChart(historyData.samples);
            updateCpuChart(historyData.samples);
            updateMemoryChart(historyData.samples);
            updateSessionsChart(historyData.samples);
            // v1.0.13: Load threat timeline from dedicated endpoint (fixes inflated counts bug)
            loadThreatTimeline(currentAnalyticsRange);
            updateComparisonCharts(historyData.samples);
            updatePeakStatistics(historyData.samples);
            updateDataRangeDisplay(historyData);

            // Update sample count
            const sampleCountEl = document.getElementById('analyticsSampleCount');
            if (sampleCountEl) {
                sampleCountEl.textContent = historyData.samples.length.toLocaleString();
            }

            // Clear any previous error messages
            clearErrorMessage();

        } else if (historyData.status === 'success' && historyData.sample_count === 0) {
            // Fixed v1.14.1: Handle empty results gracefully instead of retrying
            // Backend now returns success with empty samples instead of 'no_data' status
            const timeRangeLabel = document.getElementById('analyticsTimeRange')?.selectedOptions[0]?.text || currentAnalyticsRange;
            const message = historyData.message ||
                `No data available for ${timeRangeLabel}. Try a shorter time range or wait for more data to be collected.`;

            console.log('Empty result for time range:', message);
            showNoDataMessage(message);

        } else if (historyData.status === 'no_data') {
            // Legacy 'no_data' status - only occurs during true system initialization
            console.log('System initializing:', historyData.reason || 'No samples collected yet');
            showNoDataMessage('Initial data collection in progress. Charts will populate within 60 seconds...');

            // Auto-retry only during true system startup (max 5 retries)
            if (retryCount < 5) {
                const retryDelay = historyData.retry_after ? (historyData.retry_after * 1000) : 3000;
                console.log(`System initializing, retrying in ${retryDelay/1000}s... (${retryCount + 1}/5)`);
                setTimeout(() => loadAnalyticsData(retryCount + 1), retryDelay);
            } else {
                console.log('System still initializing after 5 retries. Please check clock process.');
            }

        } else {
            console.warn('Unexpected response:', historyData);
            showNoDataMessage('Unable to load analytics data. Please try again.');
        }

        // Also reload top clients when time range changes
        loadTopClients();

    } catch (error) {
        console.error('Error loading analytics data:', error);

        // Better error messages
        if (error.message.includes('503')) {
            showErrorMessage('System initializing, please wait...');
            // Auto-retry for 503 errors (max 3 retries)
            if (retryCount < 3) {
                setTimeout(() => loadAnalyticsData(retryCount + 1), 10000);
            }
        } else {
            showErrorMessage(`Failed to load analytics data: ${error.message}`);
        }
    } finally {
        updateLoadingState(false);
    }
};

/**
 * Refresh analytics data (button click handler)
 */
window.refreshAnalyticsData = function() {
    loadAnalyticsData();
    loadTopClients();
};

/**
 * Update the chart with new data
 * @param {Array} samples - Array of throughput samples
 */
function updateAnalyticsChart(samples) {
    if (!analyticsChart || !samples || samples.length === 0) {
        return;
    }

    const labels = [];
    const inboundData = [];
    const outboundData = [];
    const totalData = [];

    samples.forEach(sample => {
        const date = new Date(sample.timestamp);

        // Format label based on time range
        let label;
        if (currentAnalyticsRange === '1h' || currentAnalyticsRange === '6h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '24h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
        }

        labels.push(label);
        inboundData.push(sample.inbound_mbps || 0);
        outboundData.push(sample.outbound_mbps || 0);
        totalData.push(sample.total_mbps || 0);
    });

    analyticsChart.data.labels = labels;
    analyticsChart.data.datasets[0].data = inboundData;
    analyticsChart.data.datasets[1].data = outboundData;
    analyticsChart.data.datasets[2].data = totalData;
    analyticsChart.update();

    console.log(`Chart updated with ${samples.length} data points`);
}

/**
 * Update CPU chart with data
 * @param {Array} samples - Array of throughput samples
 */
function updateCpuChart(samples) {
    if (!analyticsCpuChart || !samples || samples.length === 0) {
        return;
    }

    const labels = [];
    const dataPlaneData = [];
    const mgmtPlaneData = [];

    samples.forEach(sample => {
        const date = new Date(sample.timestamp);

        // Format label based on time range
        let label;
        if (currentAnalyticsRange === '1h' || currentAnalyticsRange === '6h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '24h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
        }

        labels.push(label);
        // CPU data is nested in cpu object
        dataPlaneData.push(sample.cpu?.data_plane_cpu || 0);
        mgmtPlaneData.push(sample.cpu?.mgmt_plane_cpu || 0);
    });

    analyticsCpuChart.data.labels = labels;
    analyticsCpuChart.data.datasets[0].data = dataPlaneData;
    analyticsCpuChart.data.datasets[1].data = mgmtPlaneData;
    analyticsCpuChart.update();

    console.log(`CPU chart updated with ${samples.length} data points`);
}

/**
 * Update Memory chart with data
 * @param {Array} samples - Array of throughput samples
 */
function updateMemoryChart(samples) {
    if (!analyticsMemoryChart || !samples || samples.length === 0) {
        return;
    }

    const labels = [];
    const memoryData = [];

    samples.forEach(sample => {
        const date = new Date(sample.timestamp);

        // Format label based on time range
        let label;
        if (currentAnalyticsRange === '1h' || currentAnalyticsRange === '6h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '24h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
        }

        labels.push(label);
        // Memory data is nested in cpu object
        memoryData.push(sample.cpu?.memory_used_pct || 0);
    });

    analyticsMemoryChart.data.labels = labels;
    analyticsMemoryChart.data.datasets[0].data = memoryData;
    analyticsMemoryChart.update();

    console.log(`Memory chart updated with ${samples.length} data points`);
}

/**
 * Update sessions breakdown chart with stacked area data
 * @param {Array} samples - Array of throughput samples
 */
function updateSessionsChart(samples) {
    if (!samples || samples.length === 0 || !analyticsSessionsChart) return;

    const labels = [];
    const tcpData = [];
    const udpData = [];
    const icmpData = [];

    samples.forEach(sample => {
        const date = new Date(sample.timestamp);
        let label;

        // Format labels based on time range
        if (currentAnalyticsRange === '1h' || currentAnalyticsRange === '6h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '24h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '7d' || currentAnalyticsRange === '30d') {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } else {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
        }

        labels.push(label);

        // Extract session data (sessions is a nested object)
        const sessions = sample.sessions || {};
        tcpData.push(sessions.tcp || 0);
        udpData.push(sessions.udp || 0);
        icmpData.push(sessions.icmp || 0);
    });

    analyticsSessionsChart.data.labels = labels;
    analyticsSessionsChart.data.datasets[0].data = tcpData;
    analyticsSessionsChart.data.datasets[1].data = udpData;
    analyticsSessionsChart.data.datasets[2].data = icmpData;
    analyticsSessionsChart.update();

    console.log(`Sessions chart updated with ${samples.length} data points (TCP/UDP/ICMP)`);
}

/**
 * Load threat dashboard data from comprehensive API endpoint
 * v1.0.17: New multi-panel threat dashboard with severity breakdown,
 * top sources, action summary, and threat categories.
 *
 * @param {string} range - Time range (1h, 6h, 24h, 7d, 30d)
 */
async function loadThreatTimeline(range) {
    // Use same device ID source as other analytics charts
    const deviceId = window.currentDeviceId || '';
    if (!deviceId) {
        console.warn('No device selected for threat dashboard');
        return;
    }

    try {
        // v1.0.17: Use new dashboard endpoint for comprehensive data
        const response = await fetch(`/api/threats/dashboard?device_id=${encodeURIComponent(deviceId)}&range=${range}`);

        if (!response.ok) {
            console.error(`Failed to fetch threat dashboard: ${response.status}`);
            return;
        }

        const data = await response.json();

        if (data.status === 'success') {
            // Cache the data for tab switching
            threatDashboardData = data;

            // Update all dashboard components
            updateThreatSummary(data);
            updateThreatsChart(data.severity_timeline);
            updateThreatSourcesChart(data.top_sources);
            updateThreatActionsChart(data.action_summary);
            updateThreatCategoriesChart(data.threat_categories);

            console.log(`Threat dashboard loaded: ${data.total_threats} threats`);
        } else {
            console.warn('No threat dashboard data:', data.message || 'Unknown error');
            clearThreatDashboard();
        }
    } catch (error) {
        console.error('Error loading threat dashboard:', error);
        clearThreatDashboard();
    }
}

/**
 * Update threat summary counts and badge
 */
function updateThreatSummary(data) {
    // Update total badge
    const badge = document.getElementById('threatTotalBadge');
    if (badge) {
        const total = data.total_threats || 0;
        badge.textContent = total === 1 ? '1 threat' : `${total.toLocaleString()} threats`;
    }

    // Update severity counts (matches main dashboard: Critical, High, Medium, URL)
    const totals = data.severity_totals || {};
    document.getElementById('threatCriticalCount').textContent = (totals.critical || 0).toLocaleString();
    document.getElementById('threatHighCount').textContent = (totals.high || 0).toLocaleString();
    document.getElementById('threatMediumCount').textContent = (totals.medium || 0).toLocaleString();
    document.getElementById('threatUrlCount').textContent = (totals.url || 0).toLocaleString();
}

/**
 * Update threats timeline chart with severity breakdown (stacked area)
 * v1.0.17: Now shows Critical/High/Medium/URL as stacked areas (matches main dashboard)
 *
 * @param {Array} timeline - Array of {bucket, critical, high, medium, url} objects
 */
function updateThreatsChart(timeline) {
    if (!analyticsThreatsChart) return;

    if (!timeline || timeline.length === 0) {
        analyticsThreatsChart.data.labels = [];
        analyticsThreatsChart.data.datasets.forEach(ds => ds.data = []);
        analyticsThreatsChart.update();
        console.log('Threats chart: No data to display');
        return;
    }

    const labels = [];
    const criticalData = [];
    const highData = [];
    const mediumData = [];
    const urlData = [];

    timeline.forEach(item => {
        const date = new Date(item.bucket);
        let label;

        // Format labels based on time range
        if (currentAnalyticsRange === '1h' || currentAnalyticsRange === '6h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '24h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '7d' || currentAnalyticsRange === '30d') {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } else {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
        }

        labels.push(label);
        criticalData.push(item.critical || 0);
        highData.push(item.high || 0);
        mediumData.push(item.medium || 0);
        urlData.push(item.url || 0);
    });

    analyticsThreatsChart.data.labels = labels;
    analyticsThreatsChart.data.datasets[0].data = criticalData;
    analyticsThreatsChart.data.datasets[1].data = highData;
    analyticsThreatsChart.data.datasets[2].data = mediumData;
    analyticsThreatsChart.data.datasets[3].data = urlData;
    analyticsThreatsChart.update();

    const total = criticalData.reduce((a, b) => a + b, 0) +
                  highData.reduce((a, b) => a + b, 0) +
                  mediumData.reduce((a, b) => a + b, 0) +
                  urlData.reduce((a, b) => a + b, 0);
    console.log(`Threats chart updated with ${timeline.length} data points (${total} total threats)`);
}

/**
 * Clear all threat dashboard displays
 */
function clearThreatDashboard() {
    // Clear badge
    const badge = document.getElementById('threatTotalBadge');
    if (badge) badge.textContent = '0 threats';

    // Clear severity counts (matches main dashboard: Critical, High, Medium, URL)
    document.getElementById('threatCriticalCount').textContent = '0';
    document.getElementById('threatHighCount').textContent = '0';
    document.getElementById('threatMediumCount').textContent = '0';
    document.getElementById('threatUrlCount').textContent = '0';

    // Clear charts
    if (analyticsThreatsChart) {
        analyticsThreatsChart.data.labels = [];
        analyticsThreatsChart.data.datasets.forEach(ds => ds.data = []);
        analyticsThreatsChart.update();
    }
    if (threatSourcesChart) {
        threatSourcesChart.data.labels = [];
        threatSourcesChart.data.datasets[0].data = [];
        threatSourcesChart.update();
    }
    if (threatActionsChart) {
        threatActionsChart.data.labels = [];
        threatActionsChart.data.datasets[0].data = [];
        threatActionsChart.update();
    }
    if (threatCategoriesChart) {
        threatCategoriesChart.data.labels = [];
        threatCategoriesChart.data.datasets[0].data = [];
        threatCategoriesChart.update();
    }
}

/**
 * Update all 6 comparison mini-charts with data
 * @param {Array} samples - Array of throughput samples
 */
function updateComparisonCharts(samples) {
    if (!samples || samples.length === 0) return;

    const labels = [];
    const throughputData = [];
    const sessionsData = [];
    const cpuData = [];
    const memoryData = [];
    const tcpData = [];
    const udpData = [];
    const internalData = [];
    const internetData = [];
    // v1.0.14: Removed threatsData - threat data now from dedicated timeline
    const errorsData = [];

    samples.forEach(sample => {
        const date = new Date(sample.timestamp);
        let label;

        // Format labels based on time range (abbreviated for mini-charts)
        if (currentAnalyticsRange === '1h' || currentAnalyticsRange === '6h') {
            label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (currentAnalyticsRange === '24h') {
            label = date.getHours() + 'h';
        } else if (currentAnalyticsRange === '7d' || currentAnalyticsRange === '30d') {
            label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } else {
            label = (date.getMonth() + 1) + '/' + date.getDate();
        }

        labels.push(label);

        // Extract data for all charts
        throughputData.push(sample.total_mbps || 0);
        sessionsData.push((sample.sessions?.active || sample.sessions?.tcp + sample.sessions?.udp + sample.sessions?.icmp) || 0);
        // CPU and Memory data is nested in cpu object
        cpuData.push(sample.cpu?.data_plane_cpu || 0);
        memoryData.push(sample.cpu?.memory_used_pct || 0);
        tcpData.push(sample.sessions?.tcp || 0);
        udpData.push(sample.sessions?.udp || 0);
        internalData.push(sample.internal_mbps || 0);
        internetData.push(sample.internet_mbps || 0);
        // v1.0.14: Removed threatsData - threat data now from dedicated timeline
        errorsData.push(sample.interface_errors || 0);
    });

    // Update Chart 1: Throughput vs Sessions
    if (comparisonChart1) {
        comparisonChart1.data.labels = labels;
        comparisonChart1.data.datasets[0].data = throughputData;
        comparisonChart1.data.datasets[1].data = sessionsData;
        comparisonChart1.update();
    }

    // Update Chart 2: CPU vs Memory
    if (comparisonChart2) {
        comparisonChart2.data.labels = labels;
        comparisonChart2.data.datasets[0].data = cpuData;
        comparisonChart2.data.datasets[1].data = memoryData;
        comparisonChart2.update();
    }

    // Update Chart 3: TCP vs UDP
    if (comparisonChart3) {
        comparisonChart3.data.labels = labels;
        comparisonChart3.data.datasets[0].data = tcpData;
        comparisonChart3.data.datasets[1].data = udpData;
        comparisonChart3.update();
    }

    // Update Chart 4: Internal vs Internet
    if (comparisonChart4) {
        comparisonChart4.data.labels = labels;
        comparisonChart4.data.datasets[0].data = internalData;
        comparisonChart4.data.datasets[1].data = internetData;
        comparisonChart4.update();
    }

    // v1.0.14: Removed Chart 5 (Threats vs Sessions) - threat data now from dedicated timeline

    // Update Chart 6: Errors vs Throughput (renumbered to Chart 5 in UI)
    if (comparisonChart6) {
        comparisonChart6.data.labels = labels;
        comparisonChart6.data.datasets[0].data = errorsData;
        comparisonChart6.data.datasets[1].data = throughputData;
        comparisonChart6.update();
    }

    console.log(`All 5 comparison charts updated with ${samples.length} data points`);  // v1.0.14: Reduced from 6
}

/**
 * Calculate and display peak statistics
 * @param {Array} samples - Array of throughput samples
 */
function updatePeakStatistics(samples) {
    if (!samples || samples.length === 0) return;

    let peakThroughput = 0;
    let peakThroughputTime = null;
    let peakSessions = 0;
    let peakSessionsTime = null;
    let totalThroughput = 0;

    samples.forEach(sample => {
        const total = sample.total_mbps || 0;
        // Sessions is a nested object with 'active', 'tcp', 'udp', 'icmp' properties
        const sessions = sample.sessions ? (sample.sessions.active || 0) : 0;

        totalThroughput += total;

        if (total > peakThroughput) {
            peakThroughput = total;
            peakThroughputTime = sample.timestamp;
        }

        if (sessions > peakSessions) {
            peakSessions = sessions;
            peakSessionsTime = sample.timestamp;
        }
    });

    const avgThroughput = samples.length > 0 ? totalThroughput / samples.length : 0;

    // Update peak throughput
    const peakThroughputEl = document.getElementById('analyticsPeakThroughput');
    const peakTimeEl = document.getElementById('analyticsPeakTime');
    if (peakThroughputEl) {
        peakThroughputEl.textContent = `${peakThroughput.toFixed(2)} Mbps`;
    }
    if (peakTimeEl && peakThroughputTime) {
        const peakDate = new Date(peakThroughputTime);
        peakTimeEl.textContent = `at ${peakDate.toLocaleString()}`;
    }

    // Update average throughput
    const avgThroughputEl = document.getElementById('analyticsAvgThroughput');
    if (avgThroughputEl) {
        avgThroughputEl.textContent = `${avgThroughput.toFixed(2)} Mbps`;
    }

    // Update peak sessions
    const peakSessionsEl = document.getElementById('analyticsPeakSessions');
    const peakSessionsTimeEl = document.getElementById('analyticsPeakSessionsTime');
    if (peakSessionsEl) {
        peakSessionsEl.textContent = Math.round(peakSessions || 0).toLocaleString();
    }
    if (peakSessionsTimeEl && peakSessionsTime) {
        const sessionsDate = new Date(peakSessionsTime);
        peakSessionsTimeEl.textContent = `at ${sessionsDate.toLocaleString()}`;
    }

    // Calculate CPU and Memory statistics
    let totalCpuDataPlane = 0;
    let peakCpuDataPlane = 0;
    let totalCpuMgmt = 0;
    let peakCpuMgmt = 0;
    let totalMemory = 0;
    let peakMemory = 0;

    samples.forEach(sample => {
        // CPU and Memory data is nested in cpu object
        // Ensure values are numbers (parseFloat handles strings from database)
        const cpuDP = parseFloat(sample.cpu?.data_plane_cpu) || 0;
        const cpuMgmt = parseFloat(sample.cpu?.mgmt_plane_cpu) || 0;
        const memory = parseFloat(sample.cpu?.memory_used_pct) || 0;

        totalCpuDataPlane += cpuDP;
        totalCpuMgmt += cpuMgmt;
        totalMemory += memory;

        if (cpuDP > peakCpuDataPlane) peakCpuDataPlane = cpuDP;
        if (cpuMgmt > peakCpuMgmt) peakCpuMgmt = cpuMgmt;
        if (memory > peakMemory) peakMemory = memory;
    });

    const avgCpuDataPlane = samples.length > 0 ? totalCpuDataPlane / samples.length : 0;
    const avgCpuMgmt = samples.length > 0 ? totalCpuMgmt / samples.length : 0;
    const avgMemory = samples.length > 0 ? totalMemory / samples.length : 0;

    // Update CPU Data Plane stats
    const avgCpuDataPlaneEl = document.getElementById('avgCpuDataPlane');
    const peakCpuDataPlaneEl = document.getElementById('peakCpuDataPlane');
    if (avgCpuDataPlaneEl) {
        avgCpuDataPlaneEl.textContent = `${(avgCpuDataPlane || 0).toFixed(1)}%`;
    }
    if (peakCpuDataPlaneEl) {
        peakCpuDataPlaneEl.textContent = `${(peakCpuDataPlane || 0).toFixed(1)}%`;
    }

    // Update CPU Management Plane stats
    const avgCpuMgmtEl = document.getElementById('avgCpuMgmt');
    const peakCpuMgmtEl = document.getElementById('peakCpuMgmt');
    if (avgCpuMgmtEl) {
        avgCpuMgmtEl.textContent = `${(avgCpuMgmt || 0).toFixed(1)}%`;
    }
    if (peakCpuMgmtEl) {
        peakCpuMgmtEl.textContent = `${(peakCpuMgmt || 0).toFixed(1)}%`;
    }

    // Update Memory stats
    const avgMemoryEl = document.getElementById('avgMemory');
    const peakMemoryEl = document.getElementById('peakMemory');
    if (avgMemoryEl) {
        avgMemoryEl.textContent = `${(avgMemory || 0).toFixed(1)}%`;
    }
    if (peakMemoryEl) {
        peakMemoryEl.textContent = `${(peakMemory || 0).toFixed(1)}%`;
    }

    // Calculate session statistics (TCP, UDP, ICMP breakdown)
    let peakTotalSessions = 0;
    let peakTcpSessions = 0;
    let peakUdpSessions = 0;
    let peakIcmpSessions = 0;

    samples.forEach(sample => {
        const sessions = sample.sessions || {};
        // Ensure values are integers (parseFloat then Math.round handles strings from database)
        const tcp = Math.round(parseFloat(sessions.tcp) || 0);
        const udp = Math.round(parseFloat(sessions.udp) || 0);
        const icmp = Math.round(parseFloat(sessions.icmp) || 0);
        const total = tcp + udp + icmp;

        if (total > peakTotalSessions) peakTotalSessions = total;
        if (tcp > peakTcpSessions) peakTcpSessions = tcp;
        if (udp > peakUdpSessions) peakUdpSessions = udp;
        if (icmp > peakIcmpSessions) peakIcmpSessions = icmp;
    });

    // Update session stats
    const peakTotalSessionsEl = document.getElementById('peakTotalSessions');
    const peakTcpSessionsEl = document.getElementById('peakTcpSessions');
    const peakUdpSessionsEl = document.getElementById('peakUdpSessions');
    const peakIcmpSessionsEl = document.getElementById('peakIcmpSessions');

    if (peakTotalSessionsEl) {
        peakTotalSessionsEl.textContent = peakTotalSessions.toLocaleString();
    }
    if (peakTcpSessionsEl) {
        peakTcpSessionsEl.textContent = peakTcpSessions.toLocaleString();
    }
    if (peakUdpSessionsEl) {
        peakUdpSessionsEl.textContent = peakUdpSessions.toLocaleString();
    }
    if (peakIcmpSessionsEl) {
        peakIcmpSessionsEl.textContent = peakIcmpSessions.toLocaleString();
    }

    // v1.0.14: Removed threat statistics from here - threats use dedicated timeline chart
    // which queries threat_logs directly for accurate counts

    console.log(`Peak statistics updated - CPU DP: ${avgCpuDataPlane.toFixed(1)}%/${peakCpuDataPlane.toFixed(1)}%, CPU Mgmt: ${avgCpuMgmt.toFixed(1)}%/${peakCpuMgmt.toFixed(1)}%, Memory: ${avgMemory.toFixed(1)}%/${peakMemory.toFixed(1)}%, Sessions: ${peakTotalSessions.toLocaleString()} (TCP: ${peakTcpSessions.toLocaleString()}, UDP: ${peakUdpSessions.toLocaleString()}, ICMP: ${peakIcmpSessions.toLocaleString()})`);
}

/**
 * Update the data range display text
 * @param {Object} data - Response data containing metadata
 */
function updateDataRangeDisplay(data) {
    const rangeEl = document.getElementById('analyticsDataRange');
    if (!rangeEl) return;

    if (data.samples && data.samples.length > 0) {
        const firstSample = data.samples[0];
        const lastSample = data.samples[data.samples.length - 1];

        const startDate = new Date(firstSample.timestamp);
        const endDate = new Date(lastSample.timestamp);

        rangeEl.textContent = `${startDate.toLocaleString()} - ${endDate.toLocaleString()}`;
        rangeEl.style.color = '#F2F0EF'; // Light text for dark theme
    } else {
        rangeEl.textContent = 'No data available';
        rangeEl.style.color = '#999'; // Gray for no data
    }
}

/**
 * Export analytics data to CSV
 */
window.exportAnalyticsCSV = async function() {
    try {
        const deviceId = await getAnalyticsDeviceId();

        // Validate device selection
        if (!deviceId || deviceId.trim() === '') {
            alert('No device selected. Please select a device from the dropdown.');
            return;
        }

        const exportUrl = `/api/throughput/history/export?device_id=${deviceId}&range=${currentAnalyticsRange}`;

        // Trigger download
        window.location.href = exportUrl;

        console.log('CSV export initiated');
    } catch (error) {
        console.error('Export failed:', error);
        alert('Failed to export data. Please try again.');
    }
};

/**
 * Search logs based on user input
 */
window.searchLogs = async function() {
    const searchInput = document.getElementById('logSearchInput');
    const searchType = document.getElementById('logSearchType');
    const resultsContainer = document.getElementById('logSearchResults');

    if (!searchInput || !resultsContainer) return;

    const query = searchInput.value.trim();
    if (!query) {
        resultsContainer.innerHTML = '<div style="color: #999; text-align: center; padding: 40px;">Please enter a search term</div>';
        return;
    }

    resultsContainer.innerHTML = '<div style="color: #666; text-align: center; padding: 40px;">Searching...</div>';

    try {
        const deviceId = window.currentDeviceId || '';
        const logType = searchType.value;

        // Search in current logs (stored in global variables)
        let results = [];
        const queryLower = query.toLowerCase();

        // Search system logs
        if (logType === 'all' || logType === 'system') {
            const systemLogs = window.currentSystemLogs || [];
            systemLogs.forEach(log => {
                const logText = JSON.stringify(log).toLowerCase();
                if (logText.includes(queryLower)) {
                    results.push({ type: 'System', ...log });
                }
            });
        }

        // Search threat logs (critical + medium)
        if (logType === 'all' || logType === 'threat') {
            const criticalLogs = window.currentCriticalLogs || [];
            const mediumLogs = window.currentMediumLogs || [];

            criticalLogs.forEach(log => {
                const logText = JSON.stringify(log).toLowerCase();
                if (logText.includes(queryLower)) {
                    results.push({ type: 'Critical Threat', ...log });
                }
            });

            mediumLogs.forEach(log => {
                const logText = JSON.stringify(log).toLowerCase();
                if (logText.includes(queryLower)) {
                    results.push({ type: 'Medium Threat', ...log });
                }
            });
        }

        // Search traffic logs (blocked URLs)
        if (logType === 'all' || logType === 'traffic') {
            const blockedLogs = window.currentBlockedUrlLogs || [];
            blockedLogs.forEach(log => {
                const logText = JSON.stringify(log).toLowerCase();
                if (logText.includes(queryLower)) {
                    results.push({ type: 'Blocked URL', ...log });
                }
            });
        }

        // Display results
        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div style="color: #999; text-align: center; padding: 40px;">
                    No logs found matching "<strong>${escapeHtml(query)}</strong>"
                </div>
            `;
        } else {
            let html = `
                <div style="margin-bottom: 15px; color: #666;">
                    Found <strong>${results.length}</strong> results for "<strong>${escapeHtml(query)}</strong>"
                </div>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f5f5f5;">
                            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Type</th>
                            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Details</th>
                            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Time</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            results.slice(0, 100).forEach((log, index) => {
                const bgColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
                const typeColor = log.type.includes('Critical') ? '#dc3545' :
                                  log.type.includes('Medium') ? '#fd7e14' :
                                  log.type.includes('Blocked') ? '#6c757d' : '#17a2b8';

                // Format log details
                let details = '';
                if (log.threat) {
                    details = escapeHtml(log.threat);
                } else if (log.url) {
                    details = escapeHtml(log.url);
                } else if (log.msg || log.message) {
                    details = escapeHtml(log.msg || log.message);
                } else {
                    details = escapeHtml(JSON.stringify(log).substring(0, 100) + '...');
                }

                // Highlight search term
                const highlightedDetails = details.replace(
                    new RegExp(`(${escapeRegExp(query)})`, 'gi'),
                    '<mark style="background: #fff3cd; padding: 2px;">$1</mark>'
                );

                const time = log.time ? new Date(log.time).toLocaleString() : 'N/A';

                html += `
                    <tr style="background: ${bgColor};">
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">
                            <span style="color: ${typeColor}; font-weight: 600;">${escapeHtml(log.type)}</span>
                        </td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; word-break: break-all;">
                            ${highlightedDetails}
                        </td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #999; font-size: 0.9em;">
                            ${time}
                        </td>
                    </tr>
                `;
            });

            html += '</tbody></table>';

            if (results.length > 100) {
                html += `<div style="color: #666; text-align: center; padding: 15px; font-style: italic;">Showing first 100 of ${results.length} results</div>`;
            }

            resultsContainer.innerHTML = html;
        }

        console.log(`Search completed: ${results.length} results for "${query}"`);

    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = '<div style="color: #dc3545; text-align: center; padding: 40px;">Search failed. Please try again.</div>';
    }
};

/**
 * Show loading state for statistics
 * @param {boolean} loading - Whether loading is in progress
 */
function updateLoadingState(loading) {
    const elements = [
        'analyticsPeakThroughput',
        'analyticsAvgThroughput',
        'analyticsPeakSessions',
        'analyticsSampleCount'
    ];

    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (loading) {
                el.textContent = '...';
            }
        }
    });
}

/**
 * Show no data message
 * @param {string} message - Custom message to display (optional)
 */
function showNoDataMessage(message) {
    const sampleCountEl = document.getElementById('analyticsSampleCount');
    if (sampleCountEl) {
        sampleCountEl.textContent = '0';
    }

    const rangeEl = document.getElementById('analyticsDataRange');
    if (rangeEl) {
        rangeEl.textContent = message || 'No data available for selected range';
        rangeEl.style.color = '#999'; // Gray for info messages
    }
}

/**
 * Show error message
 * @param {string} message - Error message to display
 */
function showErrorMessage(message) {
    console.error(message);
    const rangeEl = document.getElementById('analyticsDataRange');
    if (rangeEl) {
        rangeEl.textContent = message;
        rangeEl.style.color = '#dc3545'; // Red for errors
    }
}

/**
 * Show initializing message during enterprise startup
 * @param {object} health - Health check response object
 */
function showInitializingMessage(health) {
    const sampleCountEl = document.getElementById('analyticsSampleCount');
    if (sampleCountEl) {
        sampleCountEl.textContent = health.sample_count_last_hour || '0';
    }

    const rangeEl = document.getElementById('analyticsDataRange');
    if (rangeEl) {
        rangeEl.textContent = health.message || 'System initializing, please wait...';
        rangeEl.style.color = '#5bc0de'; // Info blue for initialization messages
    }

    console.log('System initializing:', health);
}

/**
 * Clear error messages when data successfully loads
 */
function clearErrorMessage() {
    const rangeEl = document.getElementById('analyticsDataRange');
    if (rangeEl) {
        rangeEl.style.color = '#F2F0EF'; // Reset to light text for dark theme
    }
}

/**
 * Escape HTML characters for safe display
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

/**
 * Escape special regex characters
 * @param {string} string - String to escape
 * @returns {string} Escaped string
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Load Top Bandwidth Clients
 */
window.loadTopClients = async function() {
    const tableDiv = document.getElementById('topClientsTable');
    if (!tableDiv) return;

    try {
        const deviceId = await getAnalyticsDeviceId();
        const timeRange = document.getElementById('analyticsTimeRange')?.value || '24h';
        const filterType = document.getElementById('clientFilterType')?.value || 'all';

        // Validate device selection
        if (!deviceId || deviceId.trim() === '') {
            tableDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #d9534f; font-family: var(--font-secondary);">No device selected. Please select a device from the dropdown.</div>';
            return;
        }

        // Show loading
        tableDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #999; font-family: var(--font-secondary);">Loading top clients...</div>';

        const url = `/api/analytics/top-clients?device_id=${deviceId}&range=${timeRange}&filter=${filterType}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.status === 'success' && data.top_clients && data.top_clients.length > 0) {
            renderTopClientsTable(data.top_clients, data.total_clients);
        } else {
            tableDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #999; font-family: var(--font-secondary);">No client data available for this time range</div>';
        }

    } catch (error) {
        console.error('Error loading top clients:', error);
        tableDiv.innerHTML = '<div style="text-align: center; padding: 40px; color: #d9534f; font-family: var(--font-secondary);">Failed to load top clients data</div>';
    }
};

/**
 * Format MB to human-readable string (KB, MB, GB, TB)
 * Note: Input is in MB (megabytes), not bytes
 */
function formatMBHuman(mb) {
    const bytes = mb * 1024 * 1024; // Convert MB to bytes
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format bandwidth (Mbps) to human-readable string (Kbps, Mbps, Gbps)
 */
function formatBandwidthHuman(mbps) {
    if (mbps === 0 || mbps === null || mbps === undefined) return '0 Kbps';

    // Convert to Kbps for base unit
    const kbps = mbps * 1000;

    if (kbps < 1) {
        // Very small values - show in bps
        return (kbps * 1000).toFixed(0) + ' bps';
    } else if (kbps < 1000) {
        // Less than 1 Mbps - show in Kbps
        return kbps.toFixed(1) + ' Kbps';
    } else if (kbps < 1000000) {
        // Less than 1 Gbps - show in Mbps
        return (kbps / 1000).toFixed(2) + ' Mbps';
    } else {
        // 1 Gbps or more
        return (kbps / 1000000).toFixed(2) + ' Gbps';
    }
}

/**
 * Render Top Clients Table
 */
function renderTopClientsTable(clients, totalClients) {
    const tableDiv = document.getElementById('topClientsTable');
    if (!tableDiv) return;

    // Build table HTML
    let html = `
        <div style="margin-bottom: 15px; color: #999; font-size: 0.9em; font-family: var(--font-secondary);">
            Showing top ${clients.length} of ${totalClients} unique clients
        </div>
        <table style="width: 100%; border-collapse: collapse; font-family: var(--font-secondary);">
            <thead>
                <tr style="background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); border-bottom: 2px solid #555; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    <th style="padding: 14px 12px; text-align: center; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Rank</th>
                    <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">IP Address</th>
                    <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Hostname</th>
                    <th style="padding: 14px 12px; text-align: right; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Volume</th>
                    <th style="padding: 14px 12px; text-align: right; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Avg Speed</th>
                    <th style="padding: 14px 12px; text-align: center; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Samples</th>
                </tr>
            </thead>
            <tbody>
    `;

    clients.forEach((client, index) => {
        const rank = index + 1;
        const rowStyle = index % 2 === 0 ? 'background: linear-gradient(135deg, #2a2a2a 0%, #252525 100%);' : 'background: linear-gradient(135deg, #333333 0%, #2d2d2d 100%);';

        // Format Volume - human readable (GB, MB, etc.)
        const totalMB = parseFloat(client.total_mb || 0);
        const formattedVolume = formatMBHuman(totalMB);

        // Format Avg Speed - human readable (Kbps, Mbps, Gbps)
        const avgMbps = parseFloat(client.avg_mbps || 0);
        const formattedAvgSpeed = formatBandwidthHuman(avgMbps);

        html += `
            <tr style="${rowStyle} border-bottom: 1px solid #444;">
                <td style="padding: 12px; text-align: center; font-size: 1em; color: #ccc; font-weight: 600;">${rank}</td>
                <td style="padding: 12px; font-family: monospace; color: #F2F0EF; font-weight: 500;">${escapeHtml(client.ip)}</td>
                <td style="padding: 12px; color: #ccc;">${escapeHtml(client.hostname)}</td>
                <td style="padding: 12px; text-align: right; font-weight: 600; color: #FA582D;">${formattedVolume}</td>
                <td style="padding: 12px; text-align: right; color: #ccc;">${formattedAvgSpeed}</td>
                <td style="padding: 12px; text-align: center; color: #999; font-size: 0.9em;">${client.sample_count}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    tableDiv.innerHTML = html;
}

/**
 * Refresh Top Clients
 */
window.refreshTopClients = function() {
    loadTopClients();
};

/**
 * Save analytics time range selection to localStorage
 */
window.saveAnalyticsTimeRange = function() {
    const select = document.getElementById('analyticsTimeRange');
    if (select) {
        const value = select.value;
        localStorage.setItem('analyticsTimeRange', value);
        console.log(`Saved analytics time range: ${value}`);
    }
};

/**
 * Restore analytics time range selection from localStorage
 * Defaults to 6h if no saved value exists
 */
function restoreAnalyticsTimeRange() {
    const select = document.getElementById('analyticsTimeRange');
    if (select) {
        const saved = localStorage.getItem('analyticsTimeRange');
        const defaultValue = '6h'; // Default to 6 hours
        const valueToUse = saved || defaultValue;

        select.value = valueToUse;
        currentAnalyticsRange = valueToUse;
        console.log(`Restored analytics time range: ${valueToUse}`);
    }
}

// ============================================================================
// Threat Dashboard Functions (v1.0.17)
// ============================================================================

/**
 * Initialize all threat dashboard charts
 */
function initThreatDashboardCharts() {
    // Sources Chart (horizontal bar)
    const sourcesCtx = document.getElementById('threatSourcesChart');
    if (sourcesCtx && !threatSourcesChart) {
        threatSourcesChart = new Chart(sourcesCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Threats',
                    data: [],
                    backgroundColor: '#D32F2F',
                    borderColor: '#b71c1c',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleFont: { family: "'Roboto', sans-serif", size: 12 },
                        bodyFont: { family: "'Open Sans', sans-serif", size: 11 },
                        callbacks: {
                            label: function(context) {
                                return context.parsed.x.toLocaleString() + ' threats';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: 'rgba(242, 240, 239, 0.1)' },
                        ticks: { color: '#F2F0EF', font: { size: 10 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#F2F0EF', font: { family: 'monospace', size: 10 } }
                    }
                }
            }
        });
    }

    // Actions Chart (doughnut)
    const actionsCtx = document.getElementById('threatActionsChart');
    if (actionsCtx && !threatActionsChart) {
        threatActionsChart = new Chart(actionsCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Blocked', 'Allowed', 'Alerted', 'Other'],
                datasets: [{
                    data: [0, 0, 0, 0],
                    backgroundColor: ['#4CAF50', '#F44336', '#FF9800', '#9E9E9E'],
                    borderColor: '#1a1a1a',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
                                return `${context.label}: ${context.parsed.toLocaleString()} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // Categories Chart (doughnut)
    const categoriesCtx = document.getElementById('threatCategoriesChart');
    if (categoriesCtx && !threatCategoriesChart) {
        threatCategoriesChart = new Chart(categoriesCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#D32F2F', '#E64A19', '#F57C00', '#FBC02D',
                        '#689F38', '#00796B', '#0288D1', '#512DA8', '#616161'
                    ],
                    borderColor: '#1a1a1a',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
                                return `${context.label}: ${context.parsed.toLocaleString()} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    console.log('Threat dashboard charts initialized');
}

/**
 * Update threat sources horizontal bar chart
 */
function updateThreatSourcesChart(sources) {
    if (!threatSourcesChart) return;

    if (!sources || sources.length === 0) {
        threatSourcesChart.data.labels = ['No data'];
        threatSourcesChart.data.datasets[0].data = [0];
        threatSourcesChart.update();
        return;
    }

    const labels = sources.map(s => s.ip);
    const data = sources.map(s => s.count);

    // Color by severity (more critical = more red)
    const colors = sources.map(s => {
        if (s.critical > 0) return '#b71c1c';
        if (s.high > 0) return '#e65100';
        return '#D32F2F';
    });

    threatSourcesChart.data.labels = labels;
    threatSourcesChart.data.datasets[0].data = data;
    threatSourcesChart.data.datasets[0].backgroundColor = colors;
    threatSourcesChart.update();
}

/**
 * Update threat actions doughnut chart
 */
function updateThreatActionsChart(actionSummary) {
    if (!threatActionsChart) return;

    const data = [
        actionSummary.blocked || 0,
        actionSummary.allowed || 0,
        actionSummary.alerted || 0,
        actionSummary.other || 0
    ];

    threatActionsChart.data.datasets[0].data = data;
    threatActionsChart.update();

    // Update legend
    const legendDiv = document.getElementById('threatActionsLegend');
    if (legendDiv) {
        const total = data.reduce((a, b) => a + b, 0);
        const labels = ['Blocked', 'Allowed', 'Alerted', 'Other'];
        const colors = ['#4CAF50', '#F44336', '#FF9800', '#9E9E9E'];

        let html = '<div style="font-family: var(--font-secondary);">';
        labels.forEach((label, i) => {
            const pct = total > 0 ? ((data[i] / total) * 100).toFixed(1) : 0;
            html += `
                <div style="display: flex; align-items: center; margin-bottom: 12px;">
                    <div style="width: 16px; height: 16px; border-radius: 4px; background: ${colors[i]}; margin-right: 12px;"></div>
                    <div style="flex: 1;">
                        <div style="color: #F2F0EF; font-weight: 600;">${label}</div>
                        <div style="color: #999; font-size: 0.9em;">${data[i].toLocaleString()} (${pct}%)</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        legendDiv.innerHTML = html;
    }
}

/**
 * Update threat categories doughnut chart
 */
function updateThreatCategoriesChart(categories) {
    if (!threatCategoriesChart) return;

    if (!categories || categories.length === 0) {
        threatCategoriesChart.data.labels = ['No data'];
        threatCategoriesChart.data.datasets[0].data = [1];
        threatCategoriesChart.update();
        return;
    }

    const labels = categories.map(c => c.category);
    const data = categories.map(c => c.count);

    threatCategoriesChart.data.labels = labels;
    threatCategoriesChart.data.datasets[0].data = data;
    threatCategoriesChart.update();

    // Update legend
    const legendDiv = document.getElementById('threatCategoriesLegend');
    if (legendDiv) {
        const total = data.reduce((a, b) => a + b, 0);
        const colors = [
            '#D32F2F', '#E64A19', '#F57C00', '#FBC02D',
            '#689F38', '#00796B', '#0288D1', '#512DA8', '#616161'
        ];

        let html = '<div style="font-family: var(--font-secondary);">';
        categories.slice(0, 8).forEach((cat, i) => {
            const pct = total > 0 ? ((cat.count / total) * 100).toFixed(1) : 0;
            html += `
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <div style="width: 14px; height: 14px; border-radius: 3px; background: ${colors[i % colors.length]}; margin-right: 10px;"></div>
                    <div style="flex: 1;">
                        <div style="color: #F2F0EF; font-weight: 500; font-size: 0.95em;">${cat.category}</div>
                        <div style="color: #999; font-size: 0.85em;">${cat.count.toLocaleString()} (${pct}%)</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        legendDiv.innerHTML = html;
    }
}

/**
 * Switch between threat dashboard tabs
 */
window.switchThreatTab = function(tabName) {
    console.log(`Switching threat tab to: ${tabName}`);

    // Hide all panels
    document.querySelectorAll('.threat-panel').forEach(panel => {
        panel.style.display = 'none';
    });

    // Deactivate all tabs
    document.querySelectorAll('.threat-tab').forEach(tab => {
        tab.style.background = 'transparent';
        tab.style.color = '#999';
    });

    // Show selected panel
    const panelId = `threatPanel${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`;
    const panel = document.getElementById(panelId);
    if (panel) {
        panel.style.display = 'block';
    }

    // Activate selected tab
    const tabId = `threatTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`;
    const tab = document.getElementById(tabId);
    if (tab) {
        tab.style.background = '#D32F2F';
        tab.style.color = 'white';
    }
};

// Module loaded
console.log('Insights Dashboard module loaded (v1.17.0)');
