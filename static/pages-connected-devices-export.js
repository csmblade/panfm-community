/**
 * PANfm - Connected Devices Export Module
 *
 * Purpose: Export functionality for connected devices (CSV, XML)
 * Part of: Phase 6 JavaScript Refactoring (v1.8.2)
 *
 * Dependencies:
 * - pages-connected-devices-core.js (for allConnectedDevices state)
 *
 * Exports:
 * - exportDevices(format) - Main export router
 * - exportDevicesCSV(devices) - CSV export
 * - exportDevicesXML(devices) - XML export
 * - escapeXML(text) - XML escaping helper
 * - downloadFile(content, filename, mimeType) - File download helper
 */

/**
 * Export connected devices in specified format (CSV or XML)
 * Applies current filters and search term from UI
 *
 * @param {string} format - Export format ('csv' or 'xml')
 */
function exportDevices(format) {
    const vlanFilter = document.getElementById('connectedDevicesVlanFilter')?.value || '';
    const statusFilter = document.getElementById('connectedDevicesStatusFilter')?.value || '';
    const searchTerm = (document.getElementById('connectedDevicesSearchInput')?.value || '').toLowerCase().trim();

    // Filter devices (same logic as table rendering)
    let filteredDevices = window.ConnectedDevices.allDevices.filter(device => {
        if (searchTerm) {
            const searchableText = `${device.hostname} ${device.ip} ${device.mac} ${device.interface}`.toLowerCase();
            if (!searchableText.includes(searchTerm)) return false;
        }
        if (vlanFilter && device.vlan !== vlanFilter) return false;
        if (statusFilter && device.status !== statusFilter) return false;
        return true;
    });

    if (format === 'csv') {
        exportDevicesCSV(filteredDevices);
    } else if (format === 'xml') {
        exportDevicesXML(filteredDevices);
    }
}

/**
 * Export devices to CSV format
 *
 * @param {Array} devices - Array of device objects to export
 */
function exportDevicesCSV(devices) {
    // v1.10.11: Added Total Volume column
    const headers = ['Hostname', 'IP Address', 'MAC Address', 'VLAN', 'Security Zone', 'Interface', 'TTL (minutes)', 'Total Volume', 'Status'];
    let csv = headers.join(',') + '\n';

    devices.forEach(device => {
        const row = [
            device.hostname,
            device.ip,
            device.mac,
            device.vlan,
            device.zone || '-',
            device.interface,
            device.ttl,
            device.total_volume || 0,
            device.status
        ];
        csv += row.map(field => `"${field}"`).join(',') + '\n';
    });

    downloadFile(csv, 'connected-devices.csv', 'text/csv');
}

/**
 * Export devices to XML format
 *
 * @param {Array} devices - Array of device objects to export
 */
function exportDevicesXML(devices) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<connected-devices>\n';

    devices.forEach(device => {
        xml += '  <device>\n';
        xml += `    <hostname>${escapeXML(device.hostname)}</hostname>\n`;
        xml += `    <ip>${escapeXML(device.ip)}</ip>\n`;
        xml += `    <mac>${escapeXML(device.mac)}</mac>\n`;
        xml += `    <vlan>${escapeXML(device.vlan)}</vlan>\n`;
        xml += `    <zone>${escapeXML(device.zone || '-')}</zone>\n`;
        xml += `    <interface>${escapeXML(device.interface)}</interface>\n`;
        xml += `    <ttl>${escapeXML(device.ttl)}</ttl>\n`;
        xml += `    <total_volume>${device.total_volume || 0}</total_volume>\n`;
        xml += `    <bytes_sent>${device.bytes_sent || 0}</bytes_sent>\n`;
        xml += `    <bytes_received>${device.bytes_received || 0}</bytes_received>\n`;
        xml += `    <status>${escapeXML(device.status)}</status>\n`;
        xml += '  </device>\n';
    });

    xml += '</connected-devices>';

    downloadFile(xml, 'connected-devices.xml', 'application/xml');
}

/**
 * Escape special XML characters
 *
 * @param {string} text - Text to escape
 * @returns {string} - XML-safe text
 */
function escapeXML(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Download content as a file
 *
 * @param {string} content - File content
 * @param {string} filename - Filename for download
 * @param {string} mimeType - MIME type (e.g., 'text/csv')
 */
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Export to global namespace for inline event handlers
window.exportDevices = exportDevices;
window.exportDevicesCSV = exportDevicesCSV;
window.exportDevicesXML = exportDevicesXML;
