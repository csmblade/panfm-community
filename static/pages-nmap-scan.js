/**
 * Nmap Network Scanning Module
 *
 * Provides nmap fingerprinting functionality for connected devices with RFC 1918 private IPs.
 * Features:
 * - IP address validation (RFC 1918 only)
 * - Scan type selection (quick, balanced, thorough)
 * - Real-time scan progress indicator
 * - Detailed results display (OS, ports, services)
 * - Error handling and user feedback
 *
 * Version: 1.10.14 (Network Scanning)
 * Author: PANfm
 */

/**
 * Open nmap scan modal for a specific IP address
 * @param {string} ipAddress - IP address to scan (must be RFC 1918 private)
 */
function openNmapScanModal(ipAddress) {
    console.log('Opening nmap scan modal for IP:', ipAddress);

    // Validate IP format
    if (!ipAddress || !isValidIPFormat(ipAddress)) {
        alert('Invalid IP address format');
        return;
    }

    // Validate RFC 1918 private IP
    if (!isPrivateIP(ipAddress)) {
        alert('Security: Only RFC 1918 private IPs can be scanned (10.x.x.x, 172.16-31.x.x, 192.168.x.x)');
        return;
    }

    // Set IP in modal
    document.getElementById('nmapScanIp').textContent = ipAddress;

    // Reset UI state
    document.getElementById('nmapScanControls').style.display = 'block';
    document.getElementById('nmapScanProgress').style.display = 'none';
    document.getElementById('nmapScanResults').style.display = 'none';
    document.getElementById('nmapScanError').style.display = 'none';

    // Reset scan type to balanced
    document.getElementById('nmapScanType').value = 'balanced';

    // Show modal
    document.getElementById('nmapScanModal').style.display = 'flex';
}

/**
 * Close nmap scan modal
 */
function closeNmapScanModal() {
    document.getElementById('nmapScanModal').style.display = 'none';
}

/**
 * Start nmap scan for the selected IP
 */
async function startNmapScan() {
    const ipAddress = document.getElementById('nmapScanIp').textContent;
    const scanType = document.getElementById('nmapScanType').value;

    console.log('Starting nmap scan:', ipAddress, 'Type:', scanType);

    // Show progress, hide controls and results
    document.getElementById('nmapScanControls').style.display = 'none';
    document.getElementById('nmapScanProgress').style.display = 'block';
    document.getElementById('nmapScanResults').style.display = 'none';
    document.getElementById('nmapScanError').style.display = 'none';

    // Update progress text based on scan type
    const progressText = document.getElementById('nmapScanProgressText');
    if (scanType === 'quick') {
        progressText.textContent = 'Running quick scan (Fast scan, up to 60 seconds)...';
    } else if (scanType === 'thorough') {
        progressText.textContent = 'Running thorough scan (Comprehensive scan, up to 3 minutes)...';
    } else {
        progressText.textContent = 'Running balanced scan (Up to 2 minutes)...';
    }

    try {
        // Get CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

        // Execute nmap scan
        const response = await fetch(`/api/connected-devices/${ipAddress}/nmap-scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                scan_type: scanType
            })
        });

        const result = await response.json();

        if (result.status === 'success') {
            console.log('Nmap scan successful:', result);
            displayNmapResults(result);
        } else {
            console.error('Nmap scan failed:', result.message);
            displayNmapError(result.message);
        }

    } catch (error) {
        console.error('Error executing nmap scan:', error);
        displayNmapError(`Error: ${error.message}`);
    }
}

/**
 * Display nmap scan results in modal
 * @param {Object} result - Scan result from API
 */
function displayNmapResults(result) {
    // Hide progress, show results
    document.getElementById('nmapScanProgress').style.display = 'none';
    document.getElementById('nmapScanResults').style.display = 'block';

    const data = result.data;

    // Build results HTML
    let html = '';

    // Display detected changes (v1.11.0)
    if (result.changes && result.changes.length > 0) {
        html += displayScanChanges(result.changes);
    }

    // Host information section
    html += '<div style="background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px;">';
    html += '<h4 style="margin: 0 0 10px 0; font-family: var(--font-primary); color: #333;">Host Information</h4>';
    html += '<table style="width: 100%; font-family: var(--font-secondary); font-size: 0.9em;">';
    html += `<tr><td style="padding: 4px 0; color: #666; width: 120px;"><strong>IP Address:</strong></td><td>${escapeHtml(data.ip || 'Unknown')}</td></tr>`;

    if (data.hostname) {
        html += `<tr><td style="padding: 4px 0; color: #666;"><strong>Hostname:</strong></td><td>${escapeHtml(data.hostname)}</td></tr>`;
    }

    html += `<tr><td style="padding: 4px 0; color: #666;"><strong>Status:</strong></td><td><span style="color: ${data.status === 'up' ? '#28a745' : '#dc3545'}; font-weight: 600;">${escapeHtml(data.status || 'Unknown').toUpperCase()}</span></td></tr>`;

    if (result.scan_duration) {
        html += `<tr><td style="padding: 4px 0; color: #666;"><strong>Scan Duration:</strong></td><td>${escapeHtml(result.scan_duration)} seconds</td></tr>`;
    }

    html += '</table>';
    html += '</div>';

    // OS detection section
    if (data.os_matches && data.os_matches.length > 0) {
        html += '<div style="background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px;">';
        html += '<h4 style="margin: 0 0 10px 0; font-family: var(--font-primary); color: #333;">Operating System Detection</h4>';

        data.os_matches.forEach((os, index) => {
            const accuracy = parseFloat(os.accuracy) || 0;
            const color = accuracy >= 90 ? '#28a745' : accuracy >= 70 ? '#ffc107' : '#6c757d';

            html += '<div style="margin-bottom: 8px;">';
            html += `<div style="font-family: var(--font-secondary); font-size: 0.9em; margin-bottom: 4px;">${escapeHtml(os.name)}</div>`;
            html += '<div style="display: flex; align-items: center; gap: 10px;">';
            html += `<div style="flex: 1; background: #e0e0e0; border-radius: 4px; height: 20px; overflow: hidden;">`;
            html += `<div style="background: ${color}; width: ${accuracy}%; height: 100%; transition: width 0.3s;"></div>`;
            html += '</div>';
            html += `<span style="font-size: 0.85em; color: #666; font-family: var(--font-secondary); min-width: 60px;">${accuracy}% match</span>`;
            html += '</div>';
            html += '</div>';

            if (index === 0 && data.os_matches.length > 1) {
                html += '<div style="margin-top: 10px; font-size: 0.85em; color: #666; font-family: var(--font-secondary);">Additional matches:</div>';
            }
        });

        html += '</div>';
    }

    // Open ports section
    const openPorts = data.ports ? data.ports.filter(p => p.state === 'open') : [];

    if (openPorts.length > 0) {
        html += '<div style="background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px;">';
        html += `<h4 style="margin: 0 0 10px 0; font-family: var(--font-primary); color: #333;">Open Ports (${openPorts.length})</h4>`;
        html += '<div style="max-height: 300px; overflow-y: auto;">';
        html += '<table style="width: 100%; font-family: var(--font-secondary); font-size: 0.9em; border-collapse: collapse;">';
        html += '<thead>';
        html += '<tr style="border-bottom: 2px solid #ddd;">';
        html += '<th style="padding: 8px; text-align: left; font-weight: 600; color: #333;">Port</th>';
        html += '<th style="padding: 8px; text-align: left; font-weight: 600; color: #333;">Protocol</th>';
        html += '<th style="padding: 8px; text-align: left; font-weight: 600; color: #333;">Service</th>';
        html += '<th style="padding: 8px; text-align: left; font-weight: 600; color: #333;">Version</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        openPorts.forEach((port, index) => {
            const bgColor = index % 2 === 0 ? 'white' : '#fafafa';
            html += `<tr style="background: ${bgColor};">`;
            html += `<td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${escapeHtml(port.port)}</strong></td>`;
            html += `<td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(port.protocol || 'tcp')}</td>`;
            html += `<td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(port.service || 'unknown')}</td>`;

            let versionText = '';
            if (port.product) {
                versionText = port.product;
                if (port.version) {
                    versionText += ' ' + port.version;
                }
            } else {
                versionText = '-';
            }
            html += `<td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">${escapeHtml(versionText)}</td>`;
            html += '</tr>';
        });

        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        html += '</div>';
    } else {
        html += '<div style="background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px; text-align: center; color: #666; font-family: var(--font-secondary);">';
        html += 'No open ports detected';
        html += '</div>';
    }

    // Add "View History" button (v1.11.0)
    const ipAddress = data.ip;
    html += '<div style="margin-top: 20px; text-align: center;">';
    html += `<button onclick="viewScanHistory('${escapeHtml(ipAddress)}')" style="background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 0.9em;">📊 View Scan History</button>`;
    html += '</div>';

    // Set results HTML
    document.getElementById('nmapResultsContent').innerHTML = html;

    // Show "Run Another Scan" button
    document.getElementById('nmapScanControls').style.display = 'block';
}

/**
 * Display nmap scan error in modal
 * @param {string} errorMessage - Error message to display
 */
function displayNmapError(errorMessage) {
    // Hide progress, show error
    document.getElementById('nmapScanProgress').style.display = 'none';
    document.getElementById('nmapScanError').style.display = 'block';

    document.getElementById('nmapScanErrorMessage').textContent = errorMessage;

    // Show controls again for retry
    document.getElementById('nmapScanControls').style.display = 'block';
}

/**
 * Validate if string is valid IP address format
 * @param {string} ip - IP address string
 * @returns {boolean}
 */
function isValidIPFormat(ip) {
    const pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!pattern.test(ip)) return false;

    const parts = ip.split('.');
    return parts.every(part => {
        const num = parseInt(part);
        return num >= 0 && num <= 255;
    });
}

/**
 * Check if IP is RFC 1918 private address
 * @param {string} ip - IP address string
 * @returns {boolean}
 */
function isPrivateIP(ip) {
    const parts = ip.split('.').map(p => parseInt(p));

    // 10.0.0.0/8
    if (parts[0] === 10) {
        return true;
    }

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
        return true;
    }

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) {
        return true;
    }

    return false;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string}
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Display scan changes detected (added in v1.11.0)
 * @param {Array} changes - Array of change events from API
 */
function displayScanChanges(changes) {
    if (!changes || changes.length === 0) {
        return ''; // No changes to display
    }

    let html = '<div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 15px; margin-bottom: 20px;">';
    html += '<h4 style="margin: 0 0 10px 0; font-family: var(--font-primary); color: #856404;">⚠ Changes Detected</h4>';

    changes.forEach(change => {
        const severityColors = {
            'critical': '#dc3545',
            'high': '#fd7e14',
            'medium': '#ffc107',
            'low': '#6c757d'
        };

        const color = severityColors[change.severity] || '#6c757d';
        const changeTypeLabels = {
            'port_opened': '🔓 Port Opened',
            'port_closed': '🔒 Port Closed',
            'os_changed': '💻 OS Changed',
            'service_version_changed': '🔄 Service Updated'
        };

        const label = changeTypeLabels[change.change_type] || change.change_type;

        html += '<div style="margin-bottom: 8px; padding: 8px; background: white; border-left: 4px solid ' + color + '; border-radius: 4px;">';
        html += '<div style="font-family: var(--font-secondary); font-size: 0.9em;">';
        html += `<strong style="color: ${color};">[${change.severity.toUpperCase()}]</strong> `;
        html += `<strong>${label}</strong>`;

        if (change.old_value && change.new_value) {
            html += `: ${escapeHtml(change.old_value)} → ${escapeHtml(change.new_value)}`;
        } else if (change.new_value) {
            html += `: ${escapeHtml(change.new_value)}`;
        } else if (change.old_value) {
            html += `: ${escapeHtml(change.old_value)}`;
        }

        // Show risk reason for high-risk ports
        if (change.details && change.details.risk_reason) {
            html += `<br><span style="font-size: 0.85em; color: #666;">Risk: ${escapeHtml(change.details.risk_reason)}</span>`;
        }

        html += '</div>';
        html += '</div>';
    });

    html += '</div>';
    return html;
}

/**
 * View scan history for an IP address (added in v1.11.0)
 * @param {string} ipAddress - IP address to view history for
 */
async function viewScanHistory(ipAddress) {
    console.log('Loading scan history for:', ipAddress);

    try {
        const response = await fetch(`/api/connected-devices/${ipAddress}/scan-history?limit=10`);
        const result = await response.json();

        if (result.status === 'success') {
            displayScanHistoryModal(ipAddress, result.scans);
        } else {
            alert(`Failed to load scan history: ${result.message}`);
        }
    } catch (error) {
        console.error('Error loading scan history:', error);
        alert(`Error loading scan history: ${error.message}`);
    }
}

/**
 * Display scan history in a modal
 * @param {string} ipAddress - IP address
 * @param {Array} scans - Array of historical scan records
 */
function displayScanHistoryModal(ipAddress, scans) {
    let html = '<div style="font-family: var(--font-secondary);">';
    html += `<h3 style="font-family: var(--font-primary); margin-bottom: 20px;">Scan History for ${escapeHtml(ipAddress)}</h3>`;

    if (scans.length === 0) {
        html += '<p style="color: #666;">No previous scans found for this IP address.</p>';
    } else {
        scans.forEach((scan, index) => {
            const scanDate = new Date(scan.scan_timestamp);
            const isLatest = index === 0;

            html += '<div style="border: 1px solid #ddd; border-radius: 6px; padding: 15px; margin-bottom: 15px; background: ' + (isLatest ? '#e7f3ff' : 'white') + ';">';

            if (isLatest) {
                html += '<span style="background: #007bff; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.85em; margin-bottom: 10px; display: inline-block;">Latest</span>';
            }

            html += '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px;">';
            html += `<div><strong>Date:</strong> ${scanDate.toLocaleString()}</div>`;
            html += `<div><strong>Duration:</strong> ${scan.scan_duration_seconds}s</div>`;
            html += `<div><strong>Status:</strong> <span style="color: ${scan.host_status === 'up' ? '#28a745' : '#dc3545'};">${escapeHtml(scan.host_status || 'unknown').toUpperCase()}</span></div>`;
            html += `<div><strong>Open Ports:</strong> ${scan.open_ports_count} of ${scan.total_ports}</div>`;

            if (scan.hostname) {
                html += `<div><strong>Hostname:</strong> ${escapeHtml(scan.hostname)}</div>`;
            }

            if (scan.os_name) {
                html += `<div><strong>OS:</strong> ${escapeHtml(scan.os_name)} (${scan.os_accuracy}%)</div>`;
            }

            html += '</div>';

            // Show port summary
            if (scan.scan_results && scan.scan_results.ports) {
                const openPorts = scan.scan_results.ports.filter(p => p.state === 'open');
                if (openPorts.length > 0) {
                    html += '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee;">';
                    html += '<strong>Open Ports:</strong> ';
                    const portSummary = openPorts.slice(0, 5).map(p => `${p.port}/${p.protocol} (${p.service || 'unknown'})`).join(', ');
                    html += portSummary;
                    if (openPorts.length > 5) {
                        html += ` and ${openPorts.length - 5} more...`;
                    }
                    html += '</div>';
                }
            }

            html += '</div>';
        });
    }

    html += '</div>';

    // Create and show modal
    const modal = document.createElement('div');
    modal.id = 'scanHistoryModal';
    modal.style.cssText = 'display: flex; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.4); align-items: center; justify-content: center;';

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background-color: white; padding: 30px; border-radius: 8px; max-width: 800px; max-height: 80vh; overflow-y: auto; position: relative;';

    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = 'position: absolute; top: 10px; right: 15px; font-size: 28px; font-weight: bold; color: #aaa; background: none; border: none; cursor: pointer;';
    closeButton.onclick = () => {
        document.body.removeChild(modal);
    };

    // v1.11.1 FIX: Set innerHTML first, THEN append close button to preserve onclick handler
    modalContent.innerHTML = html;
    modalContent.appendChild(closeButton);
    modal.appendChild(modalContent);

    // Also close when clicking outside the modal content
    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };

    document.body.appendChild(modal);
}

console.log('Nmap scan module loaded (v1.11.0 - with scan history)');
