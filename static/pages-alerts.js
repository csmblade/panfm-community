/**
 * PANfm Alerts Management UI
 * Frontend for alert configuration, history, and notifications
 */

// ===== Alert Configuration Management =====

async function loadAlertConfigs(deviceId = null) {
    console.log('Loading alert configurations...');
    await loadDeviceNamesCache();  // Load device names first

    let url = '/api/alerts/configs';
    if (deviceId) {
        url += `?device_id=${encodeURIComponent(deviceId)}`;
    }

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderAlertConfigs(data.data);
            } else {
                showError('Failed to load alert configurations');
            }
        })
        .catch(error => {
            console.error('Error loading alert configs:', error);
            showError('Error loading alert configurations');
        });
}

function renderAlertConfigs(configs) {
    console.log('[DEBUG] renderAlertConfigs called with', configs.length, 'configs:', configs);
    const container = document.getElementById('alertConfigsTable');
    if (!container) {
        console.error('[ERROR] alertConfigsTable container not found!');
        return;
    }

    if (configs.length === 0) {
        console.log('[DEBUG] No configs to render, showing empty message');
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 40px; font-family: var(--font-secondary);">No alert configurations found. Create your first alert using the buttons above.</p>';
        return;
    }

    console.log('[DEBUG] Building styled table HTML for', configs.length, 'configs');

    let html = `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
                <thead>
                    <tr style="background: #FA582D; color: white;">
                        <th style="padding: 12px; text-align: left; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary); border-bottom: 2px solid #FA582D;">Device</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary); border-bottom: 2px solid #FA582D;">Metric</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary); border-bottom: 2px solid #FA582D;">Threshold</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary); border-bottom: 2px solid #FA582D;">Severity</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary); border-bottom: 2px solid #FA582D;">Channels</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary); border-bottom: 2px solid #FA582D;">Status</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary); border-bottom: 2px solid #FA582D;">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    configs.forEach((config, index) => {
        const severityColors = {
            'critical': '#dc3545',
            'warning': '#ffc107',
            'info': '#17a2b8'
        };
        const severityColor = severityColors[config.severity] || '#6c757d';
        const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';

        html += `
            <tr style="background: ${rowBg}; transition: background 0.2s;" onmouseover="this.style.background='#fff3e6'" onmouseout="this.style.background='${rowBg}'">
                <td style="padding: 12px; color: #333; font-size: 0.9em; border-bottom: 1px solid #ddd;"><strong>${escapeHtml(getDeviceNameById(config.device_id))}</strong></td>
                <td style="padding: 12px; color: #555; font-size: 0.85em; border-bottom: 1px solid #ddd;">${formatMetricName(config.metric_type)}</td>
                <td style="padding: 12px; color: #555; font-size: 0.85em; border-bottom: 1px solid #ddd;"><code style="background: #f1f3f5; padding: 2px 6px; border-radius: 4px;">${config.threshold_operator} ${config.threshold_value}</code></td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">
                    <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; background: ${severityColor}; color: white; font-size: 0.75em; font-weight: 600; text-transform: uppercase; font-family: var(--font-primary);">${config.severity}</span>
                </td>
                <td style="padding: 12px; color: #555; font-size: 0.85em; border-bottom: 1px solid #ddd;">${(config.notification_channels || []).join(', ') || 'None'}</td>
                <td style="padding: 12px; text-align: center; font-size: 0.85em; border-bottom: 1px solid #ddd;">
                    ${config.enabled ?
                        '<span style="color: #28a745; font-weight: 600;">✓ Enabled</span>' :
                        '<span style="color: #6c757d;">✗ Disabled</span>'}
                </td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">
                    <button onclick="editAlertConfig(${config.id})" style="padding: 6px 12px; margin: 0 4px; background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; border: none; border-radius: 6px; font-size: 0.8em; font-weight: 600; cursor: pointer; transition: transform 0.2s; font-family: var(--font-primary);" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">Edit</button>
                    <button onclick="deleteAlertConfig(${config.id})" style="padding: 6px 12px; margin: 0 4px; background: linear-gradient(135deg, #dc3545 0%, #bd2130 100%); color: white; border: none; border-radius: 6px; font-size: 0.8em; font-weight: 600; cursor: pointer; transition: transform 0.2s; font-family: var(--font-primary);" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">Delete</button>
                </td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            <div style="color: #666; text-align: right; margin-top: 10px; font-size: 0.85em; font-family: var(--font-secondary);">
                Total: ${configs.length} alert${configs.length !== 1 ? 's' : ''}
            </div>
        </div>
    `;
    console.log('[DEBUG] Setting innerHTML with styled HTML (length:', html.length, 'chars)');
    container.innerHTML = html;
    console.log('[DEBUG] Table rendered successfully! Orange header should be visible.');
}

function showCreateAlertModal() {
    document.getElementById('alertConfigModal').style.display = 'flex';
    document.getElementById('alertConfigForm').reset();
    document.getElementById('alertConfigId').value = '';
    loadDevicesIntoDropdown('alertConfigDeviceId');

    // Don't set up device change handler here - let users manually add options if needed
}

function showCreateApplicationAlertModal() {
    document.getElementById('alertConfigModal').style.display = 'flex';
    document.getElementById('alertConfigForm').reset();
    document.getElementById('alertConfigId').value = '';
    loadDevicesIntoDropdown('alertConfigDeviceId');

    // Set up device change handler to load applications dynamically
    const deviceDropdown = document.getElementById('alertConfigDeviceId');

    // Remove any existing change listeners to avoid duplicates
    const newDeviceDropdown = deviceDropdown.cloneNode(true);
    deviceDropdown.parentNode.replaceChild(newDeviceDropdown, deviceDropdown);

    // Add the change listener to load applications
    newDeviceDropdown.addEventListener('change', loadApplicationsForDevice);

    // Also hide standard metrics from the dropdown
    setTimeout(() => {
        const metricDropdown = document.getElementById('alertConfigMetricType');
        Array.from(metricDropdown.options).forEach(option => {
            // Hide standard metrics, only show application metrics
            if (!option.value.startsWith('app_') && option.value !== '') {
                option.style.display = 'none';
            }
        });
    }, 100);
}

async function loadApplicationsForDevice() {
    const deviceId = document.getElementById('alertConfigDeviceId').value;
    const metricDropdown = document.getElementById('alertConfigMetricType');

    if (!deviceId) {
        // Remove application options if no device selected
        removeApplicationOptions();
        return;
    }

    try {
        const response = await fetch(`/api/alerts/applications?device_id=${encodeURIComponent(deviceId)}`);
        const data = await response.json();

        if (data.status === 'success' && data.applications && data.applications.length > 0) {
            // Remove existing application options
            removeApplicationOptions();

            // Add new application options
            const applications = data.applications;
            applications.forEach(appName => {
                const option = document.createElement('option');
                option.value = `app_${appName}`;
                option.textContent = `Application: ${appName.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
                metricDropdown.appendChild(option);
            });

            console.log(`Loaded ${applications.length} applications for device ${deviceId}`);
        }
    } catch (error) {
        console.error('Error loading applications:', error);
    }
}

function removeApplicationOptions() {
    const metricDropdown = document.getElementById('alertConfigMetricType');
    const options = Array.from(metricDropdown.options);

    options.forEach(option => {
        if (option.value.startsWith('app_')) {
            metricDropdown.removeChild(option);
        }
    });
}

function saveAlertConfig() {
    console.log('[saveAlertConfig] Function called');

    const id = document.getElementById('alertConfigId').value;
    const isEdit = id !== '';

    const data = {
        device_id: document.getElementById('alertConfigDeviceId').value,
        metric_type: document.getElementById('alertConfigMetricType').value,
        threshold_value: parseFloat(document.getElementById('alertConfigThreshold').value),
        threshold_operator: document.getElementById('alertConfigOperator').value,
        severity: document.getElementById('alertConfigSeverity').value,
        notification_channels: Array.from(document.getElementById('alertConfigChannels').selectedOptions).map(opt => opt.value),
        enabled: document.getElementById('alertConfigEnabled').checked
    };

    console.log('[saveAlertConfig] Form data:', data);

    // Validate required fields
    if (!data.device_id) {
        console.error('[saveAlertConfig] Validation failed: No device selected');
        showError('Please select a device');
        return;
    }

    if (!data.metric_type) {
        console.error('[saveAlertConfig] Validation failed: No metric selected');
        showError('Please select a metric type');
        return;
    }

    if (isNaN(data.threshold_value)) {
        console.error('[saveAlertConfig] Validation failed: Invalid threshold value');
        showError('Please enter a valid threshold value');
        return;
    }

    const url = isEdit ? `/api/alerts/configs/${id}` : '/api/alerts/configs';
    const method = isEdit ? 'PUT' : 'POST';

    console.log(`[saveAlertConfig] Sending ${method} request to ${url}`);

    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        console.log(`[saveAlertConfig] Response status: ${response.status}`);
        return response.json();
    })
    .then(result => {
        console.log('[saveAlertConfig] Response data:', result);
        if (result.status === 'success') {
            closeAlertConfigModal();
            loadAlertConfigs();
            showSuccess(isEdit ? 'Alert updated successfully' : 'Alert created successfully');
        } else {
            showError(result.message || 'Failed to save alert');
        }
    })
    .catch(error => {
        console.error('[saveAlertConfig] Error caught:', error);
        showError('Error saving alert configuration: ' + error.message);
    });
}

function deleteAlertConfig(id) {
    if (!confirm('Are you sure you want to delete this alert configuration?')) {
        return;
    }

    fetch(`/api/alerts/configs/${id}`, {
        method: 'DELETE',
        headers: {
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            loadAlertConfigs();
            showSuccess('Alert deleted successfully');
        } else {
            showError(result.message || 'Failed to delete alert');
        }
    })
    .catch(error => {
        console.error('Error deleting alert:', error);
        showError('Error deleting alert');
    });
}

function closeAlertConfigModal() {
    document.getElementById('alertConfigModal').style.display = 'none';
}

// ===== Alert History Management =====

async function loadAlertHistory(unresolvedOnly = false) {
    console.log('Loading alert history...');
    await loadDeviceNamesCache();  // Load device names first

    let url = '/api/alerts/history?limit=100';
    if (unresolvedOnly) {
        url += '&unresolved_only=true';
    }

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderAlertHistory(data.data);
            } else {
                showError('Failed to load alert history');
            }
        })
        .catch(error => {
            console.error('Error loading alert history:', error);
            showError('Error loading alert history');
        });
}

function renderAlertHistory(history) {
    const container = document.getElementById('alertHistoryTable');
    if (!container) return;

    if (history.length === 0) {
        container.innerHTML = '<p>No alerts in history.</p>';
        return;
    }

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Device</th>
                    <th>Message</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    history.forEach(alert => {
        const severityClass = alert.severity === 'critical' ? 'severity-critical' :
                            alert.severity === 'warning' ? 'severity-warning' : 'severity-info';

        const statusText = alert.resolved_at ? '✓ Resolved' :
                          alert.acknowledged_at ? '⚠ Acknowledged' : '🔴 Active';

        html += `
            <tr>
                <td>${formatTimestamp(alert.triggered_at)}</td>
                <td>${escapeHtml(getDeviceNameById(alert.device_id))}</td>
                <td>${escapeHtml(alert.message)}</td>
                <td><span class="severity-badge ${severityClass}">${alert.severity}</span></td>
                <td>${statusText}</td>
                <td>
                    ${!alert.acknowledged_at ? `<button onclick="acknowledgeAlert(${alert.id})" class="btn-small">Acknowledge</button>` : ''}
                    ${!alert.resolved_at ? `<button onclick="resolveAlert(${alert.id})" class="btn-small btn-success">Resolve</button>` : ''}
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function acknowledgeAlert(id) {
    fetch(`/api/alerts/history/${id}/acknowledge`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            acknowledged_by: 'admin'  // TODO: Get from session
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            loadAlertHistory();
            showSuccess('Alert acknowledged');
        } else {
            showError(result.message || 'Failed to acknowledge alert');
        }
    })
    .catch(error => {
        console.error('Error acknowledging alert:', error);
        showError('Error acknowledging alert');
    });
}

function resolveAlert(id) {
    const reason = prompt('Enter resolution reason (optional):') || 'Manually resolved';

    fetch(`/api/alerts/history/${id}/resolve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            resolved_reason: reason
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            loadAlertHistory();
            showSuccess('Alert resolved');
        } else {
            showError(result.message || 'Failed to resolve alert');
        }
    })
    .catch(error => {
        console.error('Error resolving alert:', error);
        showError('Error resolving alert');
    });
}

// ===== Alert Statistics =====

function loadAlertStats() {
    fetch('/api/alerts/stats')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderAlertStats(data.data);
            }
        })
        .catch(error => {
            console.error('Error loading alert stats:', error);
        });
}

function renderAlertStats(stats) {
    // Update individual stat tiles
    const rulesEl = document.getElementById('alertStatsRules');
    const activeEl = document.getElementById('alertStatsActive');
    const criticalEl = document.getElementById('alertStatsCritical');
    const warningsEl = document.getElementById('alertStatsWarnings');

    if (rulesEl) rulesEl.textContent = stats.total_configs || 0;
    if (activeEl) activeEl.textContent = stats.unresolved_alerts || 0;
    if (criticalEl) criticalEl.textContent = stats.critical_alerts || 0;
    if (warningsEl) warningsEl.textContent = stats.warning_alerts || 0;
}

// ===== Notification Testing =====

function testEmailNotification() {
    console.log('Testing email notification...');

    fetch('/api/alerts/notifications/test/email', {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            showSuccess('Test email sent successfully!');
        } else {
            showError(result.message || 'Failed to send test email');
        }
    })
    .catch(error => {
        console.error('Error testing email:', error);
        showError('Error testing email notification');
    });
}

function testWebhookNotification() {
    console.log('Testing webhook notification...');

    fetch('/api/alerts/notifications/test/webhook', {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            showSuccess('Test webhook sent successfully!');
        } else {
            showError(result.message || 'Failed to send test webhook');
        }
    })
    .catch(error => {
        console.error('Error testing webhook:', error);
        showError('Error testing webhook notification');
    });
}

function testSlackNotification() {
    console.log('Testing Slack notification...');

    fetch('/api/alerts/notifications/test/slack', {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            showSuccess('Test Slack message sent successfully!');
        } else {
            showError(result.message || 'Failed to send test Slack message');
        }
    })
    .catch(error => {
        console.error('Error testing Slack:', error);
        showError('Error testing Slack notification');
    });
}

// ===== Utility Functions =====

function formatMetricName(metricType) {
    // Handle application metrics (format: "app_<application_name>")
    if (metricType.startsWith('app_')) {
        const appName = metricType.substring(4); // Remove "app_" prefix
        return `Application: ${appName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
    }

    // Handle category metrics (format: "category_<category_name>") - legacy
    if (metricType.startsWith('category_')) {
        const categoryName = metricType.substring(9); // Remove "category_" prefix
        return `Category: ${categoryName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
    }

    const names = {
        'throughput_in': 'Inbound Throughput',
        'throughput_out': 'Outbound Throughput',
        'throughput_total': 'Total Throughput',
        'cpu': 'CPU Usage',
        'memory': 'Memory Usage',
        'sessions': 'Active Sessions',
        'threats_critical': 'Critical Threats',
        'interface_errors': 'Interface Errors'
    };
    return names[metricType] || metricType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]').getAttribute('content');
}

function showSuccess(message) {
    // TODO: Implement toast notification
    alert(message);
}

function showError(message) {
    // TODO: Implement toast notification
    alert('Error: ' + message);
}

// ===== Device Name Cache =====

// Device name cache for alert displays
let deviceNamesCache = null;

async function loadDeviceNamesCache() {
    if (deviceNamesCache) return deviceNamesCache;

    try {
        const response = await fetch('/api/devices');
        const data = await response.json();

        if (data.status === 'success' && data.devices) {
            deviceNamesCache = {};
            data.devices.forEach(device => {
                deviceNamesCache[device.id] = device.name;
            });
            console.log(`Loaded ${Object.keys(deviceNamesCache).length} device names into cache`);
            return deviceNamesCache;
        }
    } catch (error) {
        console.error('Error loading device names:', error);
    }
    return {};
}

function getDeviceNameById(deviceId) {
    if (!deviceNamesCache) return deviceId.substring(0, 8) + '...';
    return deviceNamesCache[deviceId] || (deviceId.substring(0, 8) + '...');
}

// ===== Alert Template Management =====

function loadAlertTemplates() {
    console.log('Loading alert templates...');

    fetch('/api/alerts/templates')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderAlertTemplates(data.data);
            } else {
                showError('Failed to load alert templates');
            }
        })
        .catch(error => {
            console.error('Error loading templates:', error);
            showError('Error loading alert templates');
        });
}

function renderAlertTemplates(templates) {
    const container = document.getElementById('alertTemplatesContainer');
    if (!container) return;

    if (templates.length === 0) {
        container.innerHTML = '<p>No templates available.</p>';
        return;
    }

    let html = '<div class="templates-grid">';

    templates.forEach(template => {
        html += `
            <div class="template-card">
                <h3>${escapeHtml(template.name)}</h3>
                <p class="template-description">${escapeHtml(template.description)}</p>
                <div class="template-info">
                    <span class="badge">${escapeHtml(template.category)}</span>
                    <span class="badge">${template.alert_count} alerts</span>
                </div>
                <button onclick="viewTemplateDetails('${template.id}')" class="btn-small">View Details</button>
                <button onclick="showApplyTemplateModal('${template.id}')" class="btn-small btn-primary">Apply Template</button>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function viewTemplateDetails(templateId) {
    console.log(`Viewing template: ${templateId}`);

    fetch(`/api/alerts/templates/${templateId}`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                showTemplateDetailsModal(data.data);
            } else {
                showError('Failed to load template details');
            }
        })
        .catch(error => {
            console.error('Error loading template details:', error);
            showError('Error loading template details');
        });
}

function showTemplateDetailsModal(template) {
    const modal = document.getElementById('templateDetailsModal');
    if (!modal) return;

    let alertsHtml = '<ul class="template-alerts-list">';
    template.alerts.forEach(alert => {
        alertsHtml += `
            <li>
                <strong>${formatMetricName(alert.metric_type)}</strong>:
                ${alert.threshold_operator} ${alert.threshold_value}
                <span class="severity-badge severity-${alert.severity}">${alert.severity}</span>
                <br><em>${escapeHtml(alert.description)}</em>
            </li>
        `;
    });
    alertsHtml += '</ul>';

    document.getElementById('templateDetailsContent').innerHTML = `
        <h2>${escapeHtml(template.name)}</h2>
        <p><strong>Category:</strong> ${escapeHtml(template.category)}</p>
        <p><strong>Description:</strong> ${escapeHtml(template.description)}</p>
        <h3>Alert Rules (${template.alerts.length})</h3>
        ${alertsHtml}
    `;

    modal.style.display = 'flex';
}

function closeTemplateDetailsModal() {
    document.getElementById('templateDetailsModal').style.display = 'none';
}

function showApplyTemplateModal(templateId) {
    document.getElementById('applyTemplateModal').style.display = 'flex';
    document.getElementById('applyTemplateId').value = templateId;
    loadDevicesIntoDropdown('applyTemplateDeviceId');
}

function applyTemplate() {
    const templateId = document.getElementById('applyTemplateId').value;
    const deviceId = document.getElementById('applyTemplateDeviceId').value;
    const channels = Array.from(document.getElementById('applyTemplateChannels').selectedOptions).map(opt => opt.value);

    if (!deviceId) {
        showError('Please select a device');
        return;
    }

    console.log(`Applying template ${templateId} to device ${deviceId}`);

    fetch(`/api/alerts/templates/${templateId}/apply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            device_id: deviceId,
            notification_channels: channels
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            closeApplyTemplateModal();
            loadAlertConfigs();
            showSuccess(`Template applied successfully! Created ${result.created.length} alerts.`);
        } else {
            showError(result.message || 'Failed to apply template');
        }
    })
    .catch(error => {
        console.error('Error applying template:', error);
        showError('Error applying template');
    });
}

function closeApplyTemplateModal() {
    document.getElementById('applyTemplateModal').style.display = 'none';
}

// ===== Quick Start Scenarios =====

function loadQuickStartScenarios() {
    console.log('Loading quick start scenarios...');

    fetch('/api/alerts/quick-start')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderQuickStartScenarios(data.data);
            } else {
                showError('Failed to load quick start scenarios');
            }
        })
        .catch(error => {
            console.error('Error loading quick start:', error);
            showError('Error loading quick start scenarios');
        });
}

function renderQuickStartScenarios(scenarios) {
    const container = document.getElementById('quickStartContainer');
    if (!container) return;

    if (scenarios.length === 0) {
        container.innerHTML = '<p>No quick start scenarios available.</p>';
        return;
    }

    let html = '<div class="quick-start-grid">';

    scenarios.forEach(scenario => {
        html += `
            <div class="scenario-card">
                <h3>${escapeHtml(scenario.name)}</h3>
                <p class="scenario-description">${escapeHtml(scenario.description)}</p>
                <div class="scenario-info">
                    <p><strong>Templates:</strong> ${scenario.templates.length}</p>
                    <p><strong>Channels:</strong> ${scenario.channels.join(', ')}</p>
                </div>
                <button onclick="showApplyQuickStartModal('${scenario.id}')" class="btn-primary">Apply Scenario</button>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function showApplyQuickStartModal(scenarioId) {
    document.getElementById('applyQuickStartModal').style.display = 'flex';
    document.getElementById('applyQuickStartId').value = scenarioId;
    loadDevicesIntoDropdown('applyQuickStartDeviceId');
}

function applyQuickStart() {
    const scenarioId = document.getElementById('applyQuickStartId').value;
    const deviceId = document.getElementById('applyQuickStartDeviceId').value;

    if (!deviceId) {
        showError('Please select a device');
        return;
    }

    console.log(`Applying quick start ${scenarioId} to device ${deviceId}`);

    fetch(`/api/alerts/quick-start/${scenarioId}/apply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            device_id: deviceId
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            closeApplyQuickStartModal();
            loadAlertConfigs();
            const totalCreated = result.templates.reduce((sum, t) => sum + t.created.length, 0);
            showSuccess(`Quick start applied successfully! Created ${totalCreated} alerts across ${result.templates.length} templates.`);
        } else {
            showError(result.message || 'Failed to apply quick start');
        }
    })
    .catch(error => {
        console.error('Error applying quick start:', error);
        showError('Error applying quick start');
    });
}

function closeApplyQuickStartModal() {
    document.getElementById('applyQuickStartModal').style.display = 'none';
}

// ===== Device Management =====

function loadDevicesIntoDropdown(selectId) {
    console.log(`[loadDevicesIntoDropdown] Called with selectId: ${selectId}`);

    const select = document.getElementById(selectId);
    if (!select) {
        console.error(`[loadDevicesIntoDropdown] ERROR: Dropdown element with ID '${selectId}' not found in DOM`);
        return;
    }

    console.log(`[loadDevicesIntoDropdown] Dropdown element found, fetching devices from /api/devices...`);

    fetch('/api/devices')
        .then(response => {
            console.log(`[loadDevicesIntoDropdown] API response status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            console.log(`[loadDevicesIntoDropdown] API response data:`, data);

            if (data.status === 'success') {
                select.innerHTML = '<option value="">Select Device</option>';

                if (!data.devices || data.devices.length === 0) {
                    console.warn(`[loadDevicesIntoDropdown] No devices found in response`);
                    select.innerHTML += '<option value="" disabled>No devices configured</option>';
                    return;
                }

                data.devices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.id;
                    option.textContent = `${device.name} (${device.ip})`;
                    select.appendChild(option);
                });

                console.log(`[loadDevicesIntoDropdown] SUCCESS: Loaded ${data.devices.length} devices into dropdown '${selectId}'`);
            } else {
                console.error(`[loadDevicesIntoDropdown] API returned error status:`, data.message);
                showError('Failed to load devices: ' + (data.message || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error(`[loadDevicesIntoDropdown] EXCEPTION caught:`, error);
            showError('Error loading devices. Check console for details.');
        });
}

// ===== Page Initialization =====

// Auto-refresh interval for alerts page (30 seconds)
let alertsRefreshInterval = null;

function initAlertsPage() {
    console.log('Initializing alerts page...');

    // Initial load
    loadAlertStats();
    loadAlertConfigs();
    loadAlertHistory(false);

    // Clear any existing interval
    if (alertsRefreshInterval) {
        clearInterval(alertsRefreshInterval);
    }

    // Set up auto-refresh every 30 seconds
    alertsRefreshInterval = setInterval(() => {
        console.log('Auto-refreshing alerts data...');
        loadAlertStats();
        loadAlertConfigs();
        loadAlertHistory(false);  // Refresh history to show new alerts
    }, 30000);  // 30 seconds

    console.log('Alerts page auto-refresh enabled (30s interval)');
}

// Clean up interval when leaving alerts page
function cleanupAlertsPage() {
    if (alertsRefreshInterval) {
        clearInterval(alertsRefreshInterval);
        alertsRefreshInterval = null;
        console.log('Alerts page auto-refresh disabled');
    }
}

function initTemplatesPage() {
    console.log('Initializing templates page...');
    loadAlertTemplates();
    loadQuickStartScenarios();
}

// ===== New Modal Functions for Improved UI =====

function showTemplatesModal() {
    const modal = document.getElementById('templatesBrowserModal');
    if (modal) {
        modal.style.display = 'flex';
        loadTemplatesIntoBrowser();
    }
}

function closeTemplatesBrowserModal() {
    const modal = document.getElementById('templatesBrowserModal');
    if (modal) modal.style.display = 'none';
}

function loadTemplatesIntoBrowser() {
    const container = document.getElementById('templatesBrowserContainer');
    if (!container) return;

    fetch('/api/alerts/templates')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderTemplatesInBrowser(data.data);
            } else {
                container.innerHTML = '<p style="color: #dc3545;">Failed to load templates</p>';
            }
        })
        .catch(error => {
            console.error('Error loading templates:', error);
            container.innerHTML = '<p style="color: #dc3545;">Error loading templates</p>';
        });
}

function renderTemplatesInBrowser(templates) {
    const container = document.getElementById('templatesBrowserContainer');
    if (!container) return;

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;">';

    templates.forEach(template => {
        html += `
            <div style="background: #f8f9fa; border: 2px solid #e0e0e0; border-radius: 10px; padding: 20px; transition: all 0.3s; cursor: pointer;"
                 onmouseover="this.style.borderColor='#FA582D'; this.style.boxShadow='0 4px 12px rgba(250, 88, 45, 0.2)'"
                 onmouseout="this.style.borderColor='#e0e0e0'; this.style.boxShadow='none'">
                <h3 style="color: #333; margin: 0 0 10px 0; font-size: 1.1em; font-family: var(--font-primary);">${escapeHtml(template.name)}</h3>
                <p style="color: #666; font-size: 0.9em; margin: 0 0 15px 0; min-height: 40px; font-family: var(--font-secondary);">${escapeHtml(template.description)}</p>
                <div style="display: flex; gap: 8px; margin-bottom: 15px;">
                    <span style="padding: 4px 12px; background: #FA582D; color: white; border-radius: 4px; font-size: 0.85em;">${escapeHtml(template.category)}</span>
                    <span style="padding: 4px 12px; background: #17a2b8; color: white; border-radius: 4px; font-size: 0.85em;">${template.alert_count} rules</span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="viewTemplateDetails('${template.id}')" style="flex: 1; padding: 8px; background: #f0f0f0; color: #333; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-family: var(--font-primary);">View Details</button>
                    <button onclick="closeTemplatesBrowserModal(); showApplyTemplateModal('${template.id}')" style="flex: 1; padding: 8px; background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9em; font-family: var(--font-primary);">Apply</button>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function showQuickStartModal() {
    const modal = document.getElementById('quickStartBrowserModal');
    if (modal) {
        modal.style.display = 'flex';
        loadQuickStartIntoBrowser();
    }
}

function closeQuickStartBrowserModal() {
    const modal = document.getElementById('quickStartBrowserModal');
    if (modal) modal.style.display = 'none';
}

function loadQuickStartIntoBrowser() {
    const container = document.getElementById('quickStartBrowserContainer');
    if (!container) return;

    fetch('/api/alerts/quick-start')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderQuickStartInBrowser(data.data);
            } else {
                container.innerHTML = '<p style="color: #dc3545;">Failed to load quick start scenarios</p>';
            }
        })
        .catch(error => {
            console.error('Error loading quick start:', error);
            container.innerHTML = '<p style="color: #dc3545;">Error loading quick start scenarios</p>';
        });
}

function renderQuickStartInBrowser(scenarios) {
    const container = document.getElementById('quickStartBrowserContainer');
    if (!container) return;

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px;">';

    scenarios.forEach(scenario => {
        html += `
            <div style="background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white; border-radius: 12px; padding: 25px; transition: all 0.3s; cursor: pointer; box-shadow: 0 4px 12px rgba(250, 88, 45, 0.2);"
                 onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 8px 20px rgba(250, 88, 45, 0.3)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(250, 88, 45, 0.2)'">
                <h3 style="margin: 0 0 12px 0; font-size: 1.2em; font-family: var(--font-primary);">🚀 ${escapeHtml(scenario.name)}</h3>
                <p style="margin: 0 0 20px 0; opacity: 0.95; font-size: 0.95em; min-height: 40px; font-family: var(--font-secondary);">${escapeHtml(scenario.description)}</p>
                <div style="background: rgba(255, 255, 255, 0.2); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <div style="margin-bottom: 8px;"><strong>Templates:</strong> ${scenario.templates.length}</div>
                    <div><strong>Channels:</strong> ${scenario.channels.join(', ')}</div>
                </div>
                <button onclick="closeQuickStartBrowserModal(); showApplyQuickStartModal('${scenario.id}')"
                        style="width: 100%; padding: 12px; background: white; color: #FA582D; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 1em; font-family: var(--font-primary);">
                    Deploy Scenario
                </button>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function closeAlertHistoryModal() {
    const modal = document.getElementById('alertHistoryModal');
    if (modal) modal.style.display = 'none';
}

function filterAlertHistory() {
    const unresolvedOnly = document.getElementById('historyUnresolvedOnly')?.checked || false;
    loadAlertHistoryIntoModal(unresolvedOnly);
}

function loadAlertHistoryIntoModal(unresolvedOnly = false) {
    const modal = document.getElementById('alertHistoryModal');
    const container = document.getElementById('alertHistoryTableModal');

    if (!modal || !container) return;

    modal.style.display = 'flex';

    let url = '/api/alerts/history?limit=100';
    if (unresolvedOnly) {
        url += '&unresolved_only=true';
    }

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                renderAlertHistoryInModal(data.data);
            } else {
                container.innerHTML = '<p style="color: #dc3545;">Failed to load alert history</p>';
            }
        })
        .catch(error => {
            console.error('Error loading alert history:', error);
            container.innerHTML = '<p style="color: #dc3545;">Error loading alert history</p>';
        });
}

function renderAlertHistoryInModal(alerts) {
    const container = document.getElementById('alertHistoryTableModal');
    if (!container) return;

    if (alerts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No alerts found.</p>';
        return;
    }

    let html = `
        <div style="overflow-x: auto;">
            <table class="data-table" style="width: 100%;">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Device</th>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    alerts.forEach(alert => {
        const severityClass = alert.severity === 'critical' ? 'severity-critical' :
                            alert.severity === 'warning' ? 'severity-warning' : 'severity-info';
        const time = new Date(alert.triggered_at).toLocaleString();
        const isResolved = alert.resolved_at != null;

        html += `
            <tr>
                <td>${time}</td>
                <td>${escapeHtml(getDeviceNameById(alert.device_id))}</td>
                <td>${formatMetricName(alert.metric_type)}</td>
                <td>${alert.actual_value.toFixed(2)}</td>
                <td><span class="severity-badge ${severityClass}">${alert.severity}</span></td>
                <td>${isResolved ? '✓ Resolved' : '⚠ Active'}</td>
                <td>
                    ${!alert.acknowledged_at ? `<button onclick="acknowledgeAlert(${alert.id})" class="btn-small">Acknowledge</button>` : ''}
                    ${!isResolved ? `<button onclick="resolveAlert(${alert.id})" class="btn-small">Resolve</button>` : ''}
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// Export functions for global access
window.loadAlertConfigs = loadAlertConfigs;
window.loadAlertHistory = loadAlertHistory;
window.showCreateAlertModal = showCreateAlertModal;
window.showCreateApplicationAlertModal = showCreateApplicationAlertModal;
window.saveAlertConfig = saveAlertConfig;
window.deleteAlertConfig = deleteAlertConfig;
window.closeAlertConfigModal = closeAlertConfigModal;
window.acknowledgeAlert = acknowledgeAlert;
window.resolveAlert = resolveAlert;
window.testEmailNotification = testEmailNotification;
window.testWebhookNotification = testWebhookNotification;
window.testSlackNotification = testSlackNotification;
window.initAlertsPage = initAlertsPage;
window.loadAlertTemplates = loadAlertTemplates;
window.viewTemplateDetails = viewTemplateDetails;
window.closeTemplateDetailsModal = closeTemplateDetailsModal;
window.showApplyTemplateModal = showApplyTemplateModal;
window.applyTemplate = applyTemplate;
window.closeApplyTemplateModal = closeApplyTemplateModal;
window.loadQuickStartScenarios = loadQuickStartScenarios;
window.showApplyQuickStartModal = showApplyQuickStartModal;
window.applyQuickStart = applyQuickStart;
window.closeApplyQuickStartModal = closeApplyQuickStartModal;
window.initTemplatesPage = initTemplatesPage;
window.showTemplatesModal = showTemplatesModal;
window.closeTemplatesBrowserModal = closeTemplatesBrowserModal;
window.showQuickStartModal = showQuickStartModal;
window.closeQuickStartBrowserModal = closeQuickStartBrowserModal;
window.closeAlertHistoryModal = closeAlertHistoryModal;
window.filterAlertHistory = filterAlertHistory;
