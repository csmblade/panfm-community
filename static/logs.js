/**
 * logs.js - Log Management Module
 *
 * Handles traffic logs and system logs functionality including:
 * - Traffic log fetching and rendering
 * - System log fetching, filtering, and sorting
 * - Log table rendering and search
 * - Time formatting and parsing
 */

// Store all traffic logs for filtering
let allTrafficLogs = [];

// Store all system logs for filtering
let allSystemLogs = [];
let systemLogsMetadata = {};

// Load traffic logs
async function updateTrafficPage() {
    const tableDiv = document.getElementById('trafficLogsTable');
    const errorDiv = document.getElementById('trafficLogsErrorMessage');

    try {
        console.log('Fetching traffic logs...');
        const response = await window.apiClient.get('/api/traffic-logs', {
            params: { max_logs: 100 }
        });
        console.log('Response status:', response.ok ? 'success' : 'error');

        if (!response.ok) {
            throw new Error('Failed to load traffic logs');
        }

        const data = response.data;
        console.log('Traffic logs data:', data);

        if (data.status === 'success' && data.logs && data.logs.length > 0) {
            errorDiv.style.display = 'none';

            // Store logs for filtering
            allTrafficLogs = data.logs;

            // Render the traffic logs table
            renderTrafficLogsTable(allTrafficLogs, data.timestamp);
        } else {
            errorDiv.textContent = data.message || 'No traffic logs available';
            errorDiv.style.display = 'block';
            tableDiv.innerHTML = '';
        }
    } catch (error) {
        console.error('Error loading traffic logs:', error);
        document.getElementById('trafficLogsErrorMessage').textContent = 'Failed to load traffic logs: ' + error.message;
        document.getElementById('trafficLogsErrorMessage').style.display = 'block';
    }
}

// Parse Palo Alto time format to readable format
function parsePaloAltoTime(timeStr) {
    if (!timeStr) return '-';

    try {
        let date;

        // Check if it's a Unix timestamp (all digits)
        if (/^\d+$/.test(timeStr)) {
            // Convert to milliseconds if it's in seconds
            const timestamp = timeStr.length === 10 ? parseInt(timeStr) * 1000 : parseInt(timeStr);
            date = new Date(timestamp);
        } else if (timeStr.includes('/')) {
            // Palo Alto format: 2025/01/13 10:30:45
            const normalized = timeStr.replace(/\//g, '-');
            date = new Date(normalized);
        } else if (timeStr.includes('-')) {
            // Already in ISO-like format
            date = new Date(timeStr);
        } else {
            return timeStr; // Return original if format unknown
        }

        if (isNaN(date.getTime())) {
            return timeStr; // Return original if parsing fails
        }

        // Get user's timezone preference (default to UTC if not set)
        const userTz = window.userTimezone || 'UTC';

        return date.toLocaleString('en-US', {
            timeZone: userTz,
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    } catch (e) {
        return timeStr;
    }
}

// Format bytes to human-readable format (KB, MB, GB)
function formatBytes(bytes) {
    const value = parseInt(bytes || 0);

    if (value === 0) return '0 B';

    if (value < 1024) {
        return `${value} B`;
    } else if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(2)} KB`;
    } else if (value < 1024 * 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    } else {
        return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
}

// Render traffic logs table with optional filtering
function renderTrafficLogsTable(logs, timestamp) {
    const tableDiv = document.getElementById('trafficLogsTable');

    // Create search box and table HTML
    let tableHtml = `
        <div style="margin-bottom: 20px;">
            <input type="text"
                id="trafficLogsSearchInput"
                placeholder="Search by source, destination, app, protocol, or action..."
                style="width: 100%; padding: 12px 15px; border: 2px solid #ff6600; border-radius: 8px; font-size: 0.95em; box-sizing: border-box;"
            />
        </div>
        <div style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.15); border-top: 4px solid #ff6600;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                <thead>
                    <tr style="border-bottom: 2px solid #ff6600;">
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">Time</th>
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">Source</th>
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">Destination</th>
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">App</th>
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">Proto</th>
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">Action</th>
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">Bytes</th>
                        <th style="padding: 10px; text-align: left; color: #333; font-weight: 600;">Packets</th>
                    </tr>
                </thead>
                <tbody id="trafficLogsTableBody">
    `;

    // Add rows for each log entry
    logs.forEach((log, index) => {
        const bgColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff';
        const actionColor = log.action === 'allow' ? '#10b981' : '#dc2626';
        const time = parsePaloAltoTime(log.time);
        const totalBytes = parseInt(log.bytes_sent || 0) + parseInt(log.bytes_received || 0);
        const formattedBytes = formatBytes(totalBytes);

        tableHtml += `
            <tr style="background: ${bgColor}; border-bottom: 1px solid #eee;">
                <td style="padding: 10px; color: #666; white-space: nowrap;">${time}</td>
                <td style="padding: 10px; color: #333;">${log.src}:${log.sport}</td>
                <td style="padding: 10px; color: #333;">${log.dst}:${log.dport}</td>
                <td style="padding: 10px; color: #666;">${log.app}</td>
                <td style="padding: 10px; color: #666;">${log.proto}</td>
                <td style="padding: 10px; color: ${actionColor}; font-weight: 600;">${log.action}</td>
                <td style="padding: 10px; color: #666;">${formattedBytes}</td>
                <td style="padding: 10px; color: #666;">${parseInt(log.packets || 0).toLocaleString()}</td>
            </tr>
        `;
    });

    tableHtml += `
                </tbody>
            </table>
            <div style="margin-top: 15px; padding: 10px; background: #f0f0f0; border-radius: 8px; color: #666; font-size: 0.9em;" id="trafficLogsFooter">
                Showing ${logs.length} of ${allTrafficLogs.length} logs | Last updated: ${new Date(timestamp).toLocaleString('en-US', { timeZone: window.userTimezone || 'UTC' })}
            </div>
        </div>
    `;

    tableDiv.innerHTML = tableHtml;

    // Add search event listener
    const searchInput = document.getElementById('trafficLogsSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterTrafficLogs(e.target.value);
        });
    }
}

// Filter traffic logs based on search term
function filterTrafficLogs(searchTerm) {
    const term = searchTerm.toLowerCase().trim();

    if (!term) {
        // Show all logs if search is empty
        renderTrafficLogsTable(allTrafficLogs, new Date().toISOString());
        return;
    }

    // Filter logs by searching across multiple fields
    const filteredLogs = allTrafficLogs.filter(log => {
        return (
            (log.src && log.src.toLowerCase().includes(term)) ||
            (log.dst && log.dst.toLowerCase().includes(term)) ||
            (log.app && log.app.toLowerCase().includes(term)) ||
            (log.proto && log.proto.toLowerCase().includes(term)) ||
            (log.action && log.action.toLowerCase().includes(term)) ||
            (log.sport && log.sport.toString().includes(term)) ||
            (log.dport && log.dport.toString().includes(term))
        );
    });

    // Re-render table with filtered logs
    const tableBody = document.getElementById('trafficLogsTableBody');
    const footer = document.getElementById('trafficLogsFooter');

    if (tableBody) {
        let rowsHtml = '';
        filteredLogs.forEach((log, index) => {
            const bgColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff';
            const actionColor = log.action === 'allow' ? '#10b981' : '#dc2626';
            const time = parsePaloAltoTime(log.time);
            const totalBytes = parseInt(log.bytes_sent || 0) + parseInt(log.bytes_received || 0);
            const formattedBytes = formatBytes(totalBytes);

            rowsHtml += `
                <tr style="background: ${bgColor}; border-bottom: 1px solid #eee;">
                    <td style="padding: 10px; color: #666; white-space: nowrap;">${time}</td>
                    <td style="padding: 10px; color: #333;">${log.src}:${log.sport}</td>
                    <td style="padding: 10px; color: #333;">${log.dst}:${log.dport}</td>
                    <td style="padding: 10px; color: #666;">${log.app}</td>
                    <td style="padding: 10px; color: #666;">${log.proto}</td>
                    <td style="padding: 10px; color: ${actionColor}; font-weight: 600;">${log.action}</td>
                    <td style="padding: 10px; color: #666;">${formattedBytes}</td>
                    <td style="padding: 10px; color: #666;">${parseInt(log.packets || 0).toLocaleString()}</td>
                </tr>
            `;
        });

        if (filteredLogs.length === 0) {
            rowsHtml = `
                <tr>
                    <td colspan="8" style="padding: 20px; text-align: center; color: #999;">
                        No logs match your search criteria
                    </td>
                </tr>
            `;
        }

        tableBody.innerHTML = rowsHtml;
    }

    if (footer) {
        footer.innerHTML = `Showing ${filteredLogs.length} of ${allTrafficLogs.length} logs | Last updated: ${new Date().toLocaleString('en-US', { timeZone: window.userTimezone || 'UTC' })}`;
    }
}

// Update threat log display
async function loadSystemLogs() {
    try {
        const response = await window.apiClient.get('/api/system-logs');
        if (!response.ok) {
            throw new Error('Failed to load system logs');
        }
        const data = response.data;

        const tableDiv = document.getElementById('systemLogsTable');
        const errorDiv = document.getElementById('systemLogsErrorMessage');

        if (data.status === 'success' && data.logs.length > 0) {
            errorDiv.style.display = 'none';

            // Store logs and metadata for filtering/searching
            allSystemLogs = data.logs;
            systemLogsMetadata = {
                total: data.total,
                timestamp: data.timestamp
            };

            // Load saved sort preference
            const sortBy = localStorage.getItem('systemLogsSortBy') || 'time';
            const sortSelect = document.getElementById('systemLogsSortBy');
            if (sortSelect) {
                sortSelect.value = sortBy;

                // Add event listener if not already added
                if (!sortSelect.hasAttribute('data-listener')) {
                    sortSelect.addEventListener('change', (e) => {
                        localStorage.setItem('systemLogsSortBy', e.target.value);
                        renderSystemLogsTable();
                    });
                    sortSelect.setAttribute('data-listener', 'true');
                }
            }

            // Load saved severity filter preference
            const filterSeverity = localStorage.getItem('systemLogsFilterSeverity') || 'all';
            const filterSelect = document.getElementById('systemLogsFilterSeverity');
            if (filterSelect) {
                filterSelect.value = filterSeverity;

                // Add event listener if not already added
                if (!filterSelect.hasAttribute('data-listener')) {
                    filterSelect.addEventListener('change', (e) => {
                        localStorage.setItem('systemLogsFilterSeverity', e.target.value);
                        renderSystemLogsTable();
                    });
                    filterSelect.setAttribute('data-listener', 'true');
                }
            }

            // Add search event listener
            const searchInput = document.getElementById('systemLogsSearchInput');
            if (searchInput && !searchInput.hasAttribute('data-listener')) {
                searchInput.addEventListener('input', (e) => {
                    renderSystemLogsTable();
                });
                searchInput.setAttribute('data-listener', 'true');
            }

            // Render the table
            renderSystemLogsTable();
        } else {
            errorDiv.textContent = data.message || 'No system logs available';
            errorDiv.style.display = 'block';
            tableDiv.innerHTML = '';
        }
    } catch (error) {
        console.error('Error loading system logs:', error);
        document.getElementById('systemLogsErrorMessage').textContent = 'Failed to load system logs: ' + error.message;
        document.getElementById('systemLogsErrorMessage').style.display = 'block';
    }
}

// Render system logs table with filtering and sorting
function renderSystemLogsTable() {
    const tableDiv = document.getElementById('systemLogsTable');
    const sortBy = localStorage.getItem('systemLogsSortBy') || 'time';
    const filterSeverity = localStorage.getItem('systemLogsFilterSeverity') || 'all';
    const searchTerm = (document.getElementById('systemLogsSearchInput')?.value || '').toLowerCase().trim();

    // Apply severity filter
    let filteredLogs = [...allSystemLogs];
    if (filterSeverity !== 'all') {
        filteredLogs = filteredLogs.filter(log =>
            log.severity.toLowerCase() === filterSeverity.toLowerCase()
        );
    }

    // Apply search filter
    if (searchTerm) {
        filteredLogs = filteredLogs.filter(log => {
            return (
                (log.time && log.time.toLowerCase().includes(searchTerm)) ||
                (log.eventid && log.eventid.toString().toLowerCase().includes(searchTerm)) ||
                (log.severity && log.severity.toLowerCase().includes(searchTerm)) ||
                (log.module && log.module.toLowerCase().includes(searchTerm)) ||
                (log.subtype && log.subtype.toLowerCase().includes(searchTerm)) ||
                (log.description && log.description.toLowerCase().includes(searchTerm)) ||
                (log.result && log.result.toLowerCase().includes(searchTerm))
            );
        });
    }

    // Sort the filtered logs based on selected criteria
    const sortedLogs = sortSystemLogs(filteredLogs, sortBy);

            // Create table HTML
            let tableHtml = `
                <div style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.15); border-top: 4px solid #ff6600;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom: 2px solid #ff6600;">
                                <th style="padding: 12px; text-align: left; color: #333; font-weight: 600;">Time</th>
                                <th style="padding: 12px; text-align: left; color: #333; font-weight: 600;">Event ID</th>
                                <th style="padding: 12px; text-align: left; color: #333; font-weight: 600;">Severity</th>
                                <th style="padding: 12px; text-align: left; color: #333; font-weight: 600;">Module</th>
                                <th style="padding: 12px; text-align: left; color: #333; font-weight: 600;">Subtype</th>
                                <th style="padding: 12px; text-align: left; color: #333; font-weight: 600;">Description</th>
                                <th style="padding: 12px; text-align: left; color: #333; font-weight: 600;">Result</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            // Add rows for each log entry
            sortedLogs.forEach((log, index) => {
                const bgColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff';
                const severityColor = log.severity === 'critical' ? '#dc2626' : (log.severity === 'high' ? '#f59e0b' : '#666');

                tableHtml += `
                    <tr style="background: ${bgColor}; border-bottom: 1px solid #eee;">
                        <td style="padding: 12px; color: #666; font-size: 0.9em; white-space: nowrap;">${formatTimestamp(log.time)}</td>
                        <td style="padding: 12px; color: #666;">${log.eventid}</td>
                        <td style="padding: 12px; color: ${severityColor}; font-weight: 600;">${log.severity}</td>
                        <td style="padding: 12px; color: #666;">${log.module}</td>
                        <td style="padding: 12px; color: #666;">${log.subtype}</td>
                        <td style="padding: 12px; color: #333; max-width: 400px; overflow: hidden; text-overflow: ellipsis;" title="${log.description}">${log.description}</td>
                        <td style="padding: 12px; color: #666;">${log.result}</td>
                    </tr>
                `;
            });

    tableHtml += `
                    </tbody>
                </table>
                <div style="margin-top: 15px; padding: 10px; background: #f0f0f0; border-radius: 8px; color: #666; font-size: 0.9em;">
                    Showing ${sortedLogs.length} of ${systemLogsMetadata.total} logs${searchTerm ? ' (search filtered)' : ''}${filterSeverity !== 'all' ? ` (filtered by ${filterSeverity})` : ''} | Last updated: ${new Date(systemLogsMetadata.timestamp).toLocaleString('en-US', { timeZone: window.userTimezone || 'UTC' })}
                </div>
            </div>
    `;

    tableDiv.innerHTML = tableHtml;
}
