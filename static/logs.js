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
        // v1.0.5: Pass device_id to eliminate race conditions during device switching
        const url = window.buildDeviceUrl('/api/traffic-logs', { max_logs: 100 });
        const response = await window.apiClient.get(url);
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

    // Create search box and table HTML with dark theme
    let tableHtml = `
        <div style="margin-bottom: 20px;">
            <input type="text"
                id="trafficLogsSearchInput"
                placeholder="Search by source, destination, app, protocol, or action..."
                style="width: 100%; padding: 12px 15px; border: 2px solid #555; border-radius: 8px; font-size: 0.95em; box-sizing: border-box; background: #2a2a2a; color: #F2F0EF;"
            />
        </div>
        <div style="background: linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.15); border-top: 4px solid #F2F0EF;">
            <div style="padding: 15px 20px; background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); color: white; display: flex; justify-content: space-between; align-items: center; font-family: var(--font-primary);">
                <div>
                    <strong style="font-size: 1.1em;">Traffic Logs</strong>
                    <span style="margin-left: 15px; opacity: 0.9; font-family: var(--font-secondary);">Showing ${logs.length} of ${allTrafficLogs.length} logs</span>
                </div>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                    <thead>
                        <tr style="background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); border-bottom: 2px solid #555; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Time</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Source</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Destination</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">App</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Proto</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Action</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Bytes</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Packets</th>
                        </tr>
                    </thead>
                    <tbody id="trafficLogsTableBody">
    `;

    // Add rows for each log entry with dark theme
    logs.forEach((log, index) => {
        const rowStyle = index % 2 === 0 ? 'background: linear-gradient(135deg, #2a2a2a 0%, #252525 100%);' : 'background: linear-gradient(135deg, #333333 0%, #2d2d2d 100%);';
        const actionColor = log.action === 'allow' ? '#10b981' : '#dc2626';
        const time = parsePaloAltoTime(log.time);
        const totalBytes = parseInt(log.bytes_sent || 0) + parseInt(log.bytes_received || 0);
        const formattedBytes = formatBytes(totalBytes);

        tableHtml += `
            <tr style="${rowStyle} border-bottom: 1px solid #444; border-left: 4px solid transparent; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #3a3a3a 0%, #333333 100%)'; this.style.borderLeft='4px solid #FA582D';" onmouseout="this.style.background='${index % 2 === 0 ? 'linear-gradient(135deg, #2a2a2a 0%, #252525 100%)' : 'linear-gradient(135deg, #333333 0%, #2d2d2d 100%)'}'; this.style.borderLeft='4px solid transparent';">
                <td style="padding: 12px; color: #bbb; white-space: nowrap; font-family: var(--font-secondary);">${time}</td>
                <td style="padding: 12px; color: #F2F0EF; font-family: var(--font-secondary);">${log.src}:${log.sport}</td>
                <td style="padding: 12px; color: #F2F0EF; font-family: var(--font-secondary);">${log.dst}:${log.dport}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.app}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.proto}</td>
                <td style="padding: 12px; color: ${actionColor}; font-weight: 600; font-family: var(--font-primary);">${log.action}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${formattedBytes}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${parseInt(log.packets || 0).toLocaleString()}</td>
            </tr>
        `;
    });

    tableHtml += `
                    </tbody>
                </table>
            </div>
            <div style="margin-top: 0; padding: 15px 20px; background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); border-top: 1px solid #555; color: #bbb; font-size: 0.9em; font-family: var(--font-secondary);" id="trafficLogsFooter">
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
            const rowStyle = index % 2 === 0 ? 'background: linear-gradient(135deg, #2a2a2a 0%, #252525 100%);' : 'background: linear-gradient(135deg, #333333 0%, #2d2d2d 100%);';
            const actionColor = log.action === 'allow' ? '#10b981' : '#dc2626';
            const time = parsePaloAltoTime(log.time);
            const totalBytes = parseInt(log.bytes_sent || 0) + parseInt(log.bytes_received || 0);
            const formattedBytes = formatBytes(totalBytes);

            rowsHtml += `
                <tr style="${rowStyle} border-bottom: 1px solid #444; border-left: 4px solid transparent; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #3a3a3a 0%, #333333 100%)'; this.style.borderLeft='4px solid #FA582D';" onmouseout="this.style.background='${index % 2 === 0 ? 'linear-gradient(135deg, #2a2a2a 0%, #252525 100%)' : 'linear-gradient(135deg, #333333 0%, #2d2d2d 100%)'}'; this.style.borderLeft='4px solid transparent';">
                    <td style="padding: 12px; color: #bbb; white-space: nowrap; font-family: var(--font-secondary);">${time}</td>
                    <td style="padding: 12px; color: #F2F0EF; font-family: var(--font-secondary);">${log.src}:${log.sport}</td>
                    <td style="padding: 12px; color: #F2F0EF; font-family: var(--font-secondary);">${log.dst}:${log.dport}</td>
                    <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.app}</td>
                    <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.proto}</td>
                    <td style="padding: 12px; color: ${actionColor}; font-weight: 600; font-family: var(--font-primary);">${log.action}</td>
                    <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${formattedBytes}</td>
                    <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${parseInt(log.packets || 0).toLocaleString()}</td>
                </tr>
            `;
        });

        if (filteredLogs.length === 0) {
            rowsHtml = `
                <tr>
                    <td colspan="8" style="padding: 20px; text-align: center; color: #bbb; font-family: var(--font-secondary);">
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
        // v1.0.5: Pass device_id to eliminate race conditions during device switching
        const url = window.buildDeviceUrl('/api/system-logs');
        const response = await window.apiClient.get(url);
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

    // Create table HTML with dark theme
    let tableHtml = `
        <div style="background: linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.15); border-top: 4px solid #F2F0EF;">
            <div style="padding: 15px 20px; background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); color: white; display: flex; justify-content: space-between; align-items: center; font-family: var(--font-primary);">
                <div>
                    <strong style="font-size: 1.1em;">System Logs</strong>
                    <span style="margin-left: 15px; opacity: 0.9; font-family: var(--font-secondary);">Showing ${sortedLogs.length} of ${systemLogsMetadata.total} logs</span>
                </div>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); border-bottom: 2px solid #555; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Time</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Event ID</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Severity</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Module</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Subtype</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Description</th>
                            <th style="padding: 14px 12px; text-align: left; font-weight: 700; color: #F2F0EF; white-space: nowrap; font-family: var(--font-primary); text-transform: uppercase; letter-spacing: 0.5px; font-size: 0.75em;">Result</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    // Add rows for each log entry with dark theme
    sortedLogs.forEach((log, index) => {
        const rowStyle = index % 2 === 0 ? 'background: linear-gradient(135deg, #2a2a2a 0%, #252525 100%);' : 'background: linear-gradient(135deg, #333333 0%, #2d2d2d 100%);';
        const severityColor = log.severity === 'critical' ? '#dc2626' : (log.severity === 'high' ? '#f59e0b' : '#bbb');

        tableHtml += `
            <tr style="${rowStyle} border-bottom: 1px solid #444; border-left: 4px solid transparent; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='linear-gradient(135deg, #3a3a3a 0%, #333333 100%)'; this.style.borderLeft='4px solid #FA582D';" onmouseout="this.style.background='${index % 2 === 0 ? 'linear-gradient(135deg, #2a2a2a 0%, #252525 100%)' : 'linear-gradient(135deg, #333333 0%, #2d2d2d 100%)'}'; this.style.borderLeft='4px solid transparent';">
                <td style="padding: 12px; color: #bbb; font-size: 0.9em; white-space: nowrap; font-family: var(--font-secondary);">${formatTimestamp(log.time)}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.eventid}</td>
                <td style="padding: 12px; color: ${severityColor}; font-weight: 600; font-family: var(--font-primary);">${log.severity}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.module}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.subtype}</td>
                <td style="padding: 12px; color: #F2F0EF; max-width: 400px; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-secondary);" title="${log.description}">${log.description}</td>
                <td style="padding: 12px; color: #bbb; font-family: var(--font-secondary);">${log.result}</td>
            </tr>
        `;
    });

    tableHtml += `
                </tbody>
            </table>
            </div>
            <div style="margin-top: 0; padding: 15px 20px; background: linear-gradient(135deg, #3c3c3c 0%, #2d2d2d 100%); border-top: 1px solid #555; color: #bbb; font-size: 0.9em; font-family: var(--font-secondary);">
                Showing ${sortedLogs.length} of ${systemLogsMetadata.total} logs${searchTerm ? ' (search filtered)' : ''}${filterSeverity !== 'all' ? ` (filtered by ${filterSeverity})` : ''} | Last updated: ${new Date(systemLogsMetadata.timestamp).toLocaleString('en-US', { timeZone: window.userTimezone || 'UTC' })}
            </div>
        </div>
    `;

    tableDiv.innerHTML = tableHtml;
}
