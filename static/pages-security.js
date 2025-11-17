/**
 * PANfm Security Monitoring UI
 * Frontend for scheduled scan management and security dashboard
 * Version: 1.12.0 (Security Monitoring)
 */

// ===== Global State =====
let schedules = [];
let dashboardStats = null;

// ===== Timezone Helper =====
function getUserTimezone() {
    // Get user's selected timezone from settings (loaded by settings.js)
    return window.userTimezone || 'UTC';
}

// ===== Dashboard Statistics =====

async function loadSecurityDashboard() {
    console.log('Loading security dashboard...');

    try {
        const response = await fetch('/api/security/dashboard');
        const data = await response.json();

        if (data.status === 'success') {
            dashboardStats = data.stats;
            renderSecurityDashboard(data.stats);
        } else {
            showError('Failed to load security dashboard');
        }
    } catch (error) {
        console.error('Error loading security dashboard:', error);
        showError('Error loading security dashboard');
    }
}

function renderSecurityDashboard(stats) {
    const container = document.getElementById('securityDashboardStats');
    if (!container) {
        console.error('securityDashboardStats container not found');
        return;
    }

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">';

    // Total Schedules tile
    html += `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px; color: white;">
            <div style="font-size: 0.9em; opacity: 0.9; font-family: var(--font-secondary); margin-bottom: 8px;">Total Schedules</div>
            <div style="font-size: 2.5em; font-weight: bold; font-family: var(--font-primary);">${stats.total_schedules}</div>
            <div style="font-size: 0.85em; opacity: 0.8; margin-top: 8px; font-family: var(--font-secondary);">${stats.enabled_schedules} active</div>
        </div>
    `;

    // Queued Scans tile
    html += `
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 20px; border-radius: 8px; color: white;">
            <div style="font-size: 0.9em; opacity: 0.9; font-family: var(--font-secondary); margin-bottom: 8px;">Queued Scans</div>
            <div style="font-size: 2.5em; font-weight: bold; font-family: var(--font-primary);">${stats.queued_scans}</div>
            <div style="font-size: 0.85em; opacity: 0.8; margin-top: 8px; font-family: var(--font-secondary);">Pending execution</div>
        </div>
    `;

    // Recent Scans tile
    html += `
        <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 20px; border-radius: 8px; color: white;">
            <div style="font-size: 0.9em; opacity: 0.9; font-family: var(--font-secondary); margin-bottom: 8px;">Recent Scans</div>
            <div style="font-size: 2.5em; font-weight: bold; font-family: var(--font-primary);">${stats.recent_scans}</div>
            <div style="font-size: 0.85em; opacity: 0.8; margin-top: 8px; font-family: var(--font-secondary);">Last 24 hours</div>
        </div>
    `;

    // Critical Changes tile
    html += `
        <div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); padding: 20px; border-radius: 8px; color: white;">
            <div style="font-size: 0.9em; opacity: 0.9; font-family: var(--font-secondary); margin-bottom: 8px;">Critical Changes</div>
            <div style="font-size: 2.5em; font-weight: bold; font-family: var(--font-primary);">${stats.critical_changes}</div>
            <div style="font-size: 0.85em; opacity: 0.8; margin-top: 8px; font-family: var(--font-secondary);">${stats.unacknowledged_changes} unacknowledged</div>
        </div>
    `;

    html += '</div>';
    container.innerHTML = html;
}

// ===== Schedule Management =====

async function loadSchedules(deviceId = null) {
    console.log('Loading scheduled scans...');

    let url = '/api/security/schedules';
    if (deviceId) {
        url += `?device_id=${encodeURIComponent(deviceId)}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'success') {
            schedules = data.schedules;
            renderSchedulesTable(data.schedules);
        } else {
            showError('Failed to load schedules');
        }
    } catch (error) {
        console.error('Error loading schedules:', error);
        showError('Error loading schedules');
    }
}

function renderSchedulesTable(schedules) {
    const container = document.getElementById('schedulesTable');
    if (!container) {
        console.error('schedulesTable container not found');
        return;
    }

    if (schedules.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 40px; font-family: var(--font-secondary);">No scheduled scans configured. Click "Create Schedule" to add your first automated scan.</p>';
        return;
    }

    let html = `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
                <thead>
                    <tr style="background: #f5f5f5; border-bottom: 2px solid #FA582D;">
                        <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; font-family: var(--font-primary);">Name</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; font-family: var(--font-primary);">Target</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; font-family: var(--font-primary);">Schedule</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; color: #333; font-family: var(--font-primary);">Scan Type</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; color: #333; font-family: var(--font-primary);">Last Run</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; color: #333; font-family: var(--font-primary);">Status</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; color: #333; font-family: var(--font-primary);">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    schedules.forEach((schedule, index) => {
        const rowStyle = index % 2 === 0 ? 'background: #ffffff;' : 'background: #f8f9fa;';
        const targetDisplay = formatTargetDisplay(schedule.target_type, schedule.target_value);
        const scheduleDisplay = formatScheduleDisplay(schedule.schedule_type, schedule.schedule_value);
        const lastRunDisplay = formatLastRun(schedule.last_run_timestamp, schedule.last_run_status);

        html += `
            <tr style="${rowStyle} border-bottom: 1px solid #dee2e6;" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor='${index % 2 === 0 ? '#ffffff' : '#f8f9fa'}'">
                <td style="padding: 12px; color: #333;">
                    <strong>${escapeHtml(schedule.name)}</strong>
                    ${schedule.description ? '<br><span style="font-size: 0.85em; color: #666;">' + escapeHtml(schedule.description) + '</span>' : ''}
                </td>
                <td style="padding: 12px; color: #666;">${targetDisplay}</td>
                <td style="padding: 12px; color: #666;">${scheduleDisplay}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="background: #e7f3ff; color: #0056b3; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-family: var(--font-primary);">${schedule.scan_type}</span>
                </td>
                <td style="padding: 12px; text-align: center; color: #666; font-size: 0.85em;">${lastRunDisplay}</td>
                <td style="padding: 12px; text-align: center;">
                    ${schedule.enabled ?
                        '<span style="color: #28a745; font-weight: 600;">✓ Enabled</span>' :
                        '<span style="color: #6c757d;">✗ Disabled</span>'}
                </td>
                <td style="padding: 12px; text-align: center;">
                    <button onclick="toggleSchedule(${schedule.id})" style="padding: 6px 12px; margin: 0 4px; background: ${schedule.enabled ? '#6c757d' : '#28a745'}; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 0.85em;">
                        ${schedule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onclick="editSchedule(${schedule.id})" style="padding: 6px 12px; margin: 0 4px; background: #ff6600; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 0.85em;">Edit</button>
                    <button onclick="deleteSchedule(${schedule.id})" style="padding: 6px 12px; margin: 0 4px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 0.85em;">Delete</button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// ===== Schedule CRUD Operations =====

async function createSchedule() {
    console.log('Opening create schedule modal...');

    // Load available targets (tags and locations) and devices
    const targets = await loadScheduleTargets();
    const devices = await loadDevicesList();

    showScheduleModal(null, targets, devices);
}

async function loadScheduleTargets() {
    try {
        const response = await fetch('/api/security/schedule-targets');
        const data = await response.json();

        if (data.status === 'success') {
            return {
                tags: data.tags || [],
                locations: data.locations || []
            };
        }
    } catch (error) {
        console.error('Error loading schedule targets:', error);
    }

    return { tags: [], locations: [] };
}

async function loadDevicesList() {
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();

        if (data.status === 'success') {
            return data.devices || [];
        }
    } catch (error) {
        console.error('Error loading devices list:', error);
    }

    return [];
}

function showScheduleModal(schedule = null, targets = null, devices = []) {
    const isEdit = schedule !== null;
    const modalTitle = isEdit ? 'Edit Scheduled Scan' : 'Create Scheduled Scan';

    // Build device options HTML
    let deviceOptions = '<option value="">-- Select Device --</option>';
    devices.forEach(device => {
        const selected = isEdit && schedule.device_id === device.id ? 'selected' : '';
        deviceOptions += `<option value="${device.id}" ${selected}>${escapeHtml(device.name)}</option>`;
    });

    let html = `
        <div id="scheduleModal" style="display: flex; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.4); align-items: center; justify-content: center;">
            <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; position: relative;">
                <button onclick="closeScheduleModal()" style="position: absolute; top: 10px; right: 15px; font-size: 28px; font-weight: bold; color: #aaa; background: none; border: none; cursor: pointer;">×</button>

                <h3 style="margin: 0 0 20px 0; font-family: var(--font-primary); color: #333;">${modalTitle}</h3>

                <form id="scheduleForm" style="font-family: var(--font-secondary);">
                    <!-- Name -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Schedule Name *</label>
                        <input type="text" id="scheduleName" value="${isEdit ? escapeHtml(schedule.name) : ''}" required
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
                    </div>

                    <!-- Description -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Description</label>
                        <textarea id="scheduleDescription" rows="2"
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">${isEdit && schedule.description ? escapeHtml(schedule.description) : ''}</textarea>
                    </div>

                    <!-- Device Selection (NEW - REQUIRED) -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Firewall Device *</label>
                        <select id="scheduleDeviceId" required
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
                            ${deviceOptions}
                        </select>
                        <small style="color: #666; font-size: 0.85em;">Select which firewall to scan targets from</small>
                    </div>

                    <!-- Target Type -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Target Type *</label>
                        <select id="scheduleTargetType" onchange="updateTargetValueField()" required
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
                            <option value="all" ${isEdit && schedule.target_type === 'all' ? 'selected' : ''}>All Connected Devices</option>
                            <option value="tag" ${isEdit && schedule.target_type === 'tag' ? 'selected' : ''}>Devices with Tag</option>
                            <option value="location" ${isEdit && schedule.target_type === 'location' ? 'selected' : ''}>Devices at Location</option>
                            <option value="ip" ${isEdit && schedule.target_type === 'ip' ? 'selected' : ''}>Specific IP Address</option>
                        </select>
                    </div>

                    <!-- Target Value (dynamic based on target type) -->
                    <div id="targetValueContainer" style="margin-bottom: 15px;">
                        <!-- Populated by updateTargetValueField() -->
                    </div>

                    <!-- Scan Type -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Scan Type *</label>
                        <select id="scheduleScanType" required
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
                            <option value="quick" ${isEdit && schedule.scan_type === 'quick' ? 'selected' : ''}>Quick (Fast scan, 60 seconds)</option>
                            <option value="balanced" ${isEdit && schedule.scan_type === 'balanced' ? 'selected' : 'selected'}>Balanced (Recommended, 2 minutes)</option>
                            <option value="thorough" ${isEdit && schedule.scan_type === 'thorough' ? 'selected' : ''}>Thorough (Comprehensive, 3 minutes)</option>
                        </select>
                    </div>

                    <!-- Schedule Type -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Schedule Type *</label>
                        <select id="scheduleType" onchange="updateScheduleValueField()" required
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
                            <option value="interval" ${isEdit && schedule.schedule_type === 'interval' ? 'selected' : ''}>Interval (Every X seconds)</option>
                            <option value="daily" ${isEdit && schedule.schedule_type === 'daily' ? 'selected' : ''}>Daily (Specific time)</option>
                            <option value="weekly" ${isEdit && schedule.schedule_type === 'weekly' ? 'selected' : ''}>Weekly (Day and time)</option>
                            <option value="cron" ${isEdit && schedule.schedule_type === 'cron' ? 'selected' : ''}>Cron Expression</option>
                        </select>
                    </div>

                    <!-- Schedule Value (dynamic based on schedule type) -->
                    <div id="scheduleValueContainer" style="margin-bottom: 15px;">
                        <!-- Populated by updateScheduleValueField() -->
                    </div>

                    <!-- Submit Button -->
                    <div style="margin-top: 25px; text-align: right;">
                        <button type="button" onclick="closeScheduleModal()"
                            style="padding: 10px 20px; margin-right: 10px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 1em;">Cancel</button>
                        <button type="submit"
                            style="padding: 10px 20px; background: #FA582D; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 1em;">${isEdit ? 'Update Schedule' : 'Create Schedule'}</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // Store targets data globally for target value field
    window.scheduleTargets = targets;

    // Store schedule data if editing
    if (isEdit) {
        window.editingSchedule = schedule;
    }

    // Initialize dynamic fields
    updateTargetValueField();
    updateScheduleValueField();

    // Handle form submission
    document.getElementById('scheduleForm').onsubmit = async (e) => {
        e.preventDefault();
        await submitScheduleForm(isEdit);
    };
}

function updateTargetValueField() {
    const targetType = document.getElementById('scheduleTargetType').value;
    const container = document.getElementById('targetValueContainer');
    const schedule = window.editingSchedule;
    const targets = window.scheduleTargets || { tags: [], locations: [] };

    if (targetType === 'all') {
        container.innerHTML = '<p style="color: #666; font-size: 0.9em; margin: 0;">All connected devices will be scanned.</p>';
    } else if (targetType === 'tag') {
        let html = '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Tag *</label>';
        if (targets.tags.length > 0) {
            html += '<select id="scheduleTargetValue" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">';
            html += '<option value="">-- Select Tag --</option>';
            targets.tags.forEach(tag => {
                const selected = schedule && schedule.target_value === tag ? 'selected' : '';
                html += `<option value="${escapeHtml(tag)}" ${selected}>${escapeHtml(tag)}</option>`;
            });
            html += '</select>';
        } else {
            html += '<input type="text" id="scheduleTargetValue" required placeholder="Enter tag name" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">';
        }
        container.innerHTML = html;
    } else if (targetType === 'location') {
        let html = '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Location *</label>';
        if (targets.locations.length > 0) {
            html += '<select id="scheduleTargetValue" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">';
            html += '<option value="">-- Select Location --</option>';
            targets.locations.forEach(location => {
                const selected = schedule && schedule.target_value === location ? 'selected' : '';
                html += `<option value="${escapeHtml(location)}" ${selected}>${escapeHtml(location)}</option>`;
            });
            html += '</select>';
        } else {
            html += '<input type="text" id="scheduleTargetValue" required placeholder="Enter location" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">';
        }
        container.innerHTML = html;
    } else if (targetType === 'ip') {
        const value = schedule && schedule.target_value ? schedule.target_value : '';
        container.innerHTML = `
            <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">IP Address *</label>
            <input type="text" id="scheduleTargetValue" required placeholder="192.168.1.100" value="${escapeHtml(value)}"
                pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
                style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
            <small style="color: #666; font-size: 0.85em;">RFC 1918 private IP address</small>
        `;
    }
}

function updateScheduleValueField() {
    const scheduleType = document.getElementById('scheduleType').value;
    const container = document.getElementById('scheduleValueContainer');
    const schedule = window.editingSchedule;

    if (scheduleType === 'interval') {
        const value = schedule && schedule.schedule_value ? schedule.schedule_value : '3600';
        container.innerHTML = `
            <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Interval (seconds) *</label>
            <input type="number" id="scheduleValue" required min="60" step="60" value="${value}"
                style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
            <small style="color: #666; font-size: 0.85em;">Example: 3600 = Every hour, 7200 = Every 2 hours</small>
        `;
    } else if (scheduleType === 'daily') {
        const value = schedule && schedule.schedule_value ? schedule.schedule_value : '14:00';
        const tz = getUserTimezone();
        container.innerHTML = `
            <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Time (${tz}) *</label>
            <input type="time" id="scheduleValue" required value="${value}"
                style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
            <small style="color: #666; font-size: 0.85em;">Scans will run daily at this time (${tz})</small>
        `;
    } else if (scheduleType === 'weekly') {
        const value = schedule && schedule.schedule_value ? schedule.schedule_value : 'monday:14:00';
        const parts = value.split(':');
        const day = parts[0] || 'monday';
        const time = parts.length >= 3 ? `${parts[1]}:${parts[2]}` : '14:00';
        const tz = getUserTimezone();

        container.innerHTML = `
            <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Day of Week *</label>
            <select id="scheduleValueDay" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary); margin-bottom: 10px;">
                <option value="monday" ${day === 'monday' ? 'selected' : ''}>Monday</option>
                <option value="tuesday" ${day === 'tuesday' ? 'selected' : ''}>Tuesday</option>
                <option value="wednesday" ${day === 'wednesday' ? 'selected' : ''}>Wednesday</option>
                <option value="thursday" ${day === 'thursday' ? 'selected' : ''}>Thursday</option>
                <option value="friday" ${day === 'friday' ? 'selected' : ''}>Friday</option>
                <option value="saturday" ${day === 'saturday' ? 'selected' : ''}>Saturday</option>
                <option value="sunday" ${day === 'sunday' ? 'selected' : ''}>Sunday</option>
            </select>
            <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Time (${tz}) *</label>
            <input type="time" id="scheduleValueTime" required value="${time}"
                style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
            <small style="color: #666; font-size: 0.85em;">Scans will run weekly on this day and time (${tz})</small>
        `;
    } else if (scheduleType === 'cron') {
        const value = schedule && schedule.schedule_value ? schedule.schedule_value : '0 */6 * * *';
        container.innerHTML = `
            <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">Cron Expression *</label>
            <input type="text" id="scheduleValue" required placeholder="0 */6 * * *" value="${escapeHtml(value)}"
                style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; font-family: var(--font-secondary);">
            <small style="color: #666; font-size: 0.85em;">Format: minute hour day month day_of_week<br>Example: "0 */6 * * *" = Every 6 hours</small>
        `;
    }
}

async function submitScheduleForm(isEdit) {
    const name = document.getElementById('scheduleName').value.trim();
    const description = document.getElementById('scheduleDescription').value.trim();
    const targetType = document.getElementById('scheduleTargetType').value;
    const scanType = document.getElementById('scheduleScanType').value;
    const scheduleType = document.getElementById('scheduleType').value;

    // Get target value
    let targetValue = null;
    if (targetType !== 'all') {
        targetValue = document.getElementById('scheduleTargetValue').value.trim();
    }

    // Get schedule value
    let scheduleValue;
    if (scheduleType === 'weekly') {
        const day = document.getElementById('scheduleValueDay').value;
        const time = document.getElementById('scheduleValueTime').value;
        scheduleValue = `${day}:${time}`;
    } else {
        scheduleValue = document.getElementById('scheduleValue').value.trim();
    }

    // Get device ID from form (REQUIRED field)
    const deviceId = document.getElementById('scheduleDeviceId').value;

    if (!deviceId) {
        showError('Please select a firewall device');
        return;
    }

    const data = {
        device_id: deviceId,
        name: name,
        description: description || null,
        target_type: targetType,
        target_value: targetValue,
        scan_type: scanType,
        schedule_type: scheduleType,
        schedule_value: scheduleValue
    };

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

        let url = '/api/security/schedules';
        let method = 'POST';

        if (isEdit) {
            url += `/${window.editingSchedule.id}`;
            method = 'PUT';
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.status === 'success') {
            closeScheduleModal();
            await loadSchedules();
            await loadSecurityDashboard();
            showSuccess(isEdit ? 'Schedule updated successfully' : 'Schedule created successfully');
        } else {
            showError(result.message || 'Failed to save schedule');
        }
    } catch (error) {
        console.error('Error saving schedule:', error);
        showError('Error saving schedule');
    }
}

function closeScheduleModal() {
    const modal = document.getElementById('scheduleModal');
    if (modal) {
        modal.remove();
    }
    window.editingSchedule = null;
    window.scheduleTargets = null;
}

async function editSchedule(scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) {
        showError('Schedule not found');
        return;
    }

    const targets = await loadScheduleTargets();
    const devices = await loadDevicesList();
    showScheduleModal(schedule, targets, devices);
}

async function deleteSchedule(scheduleId) {
    if (!confirm('Are you sure you want to delete this schedule? This action cannot be undone.')) {
        return;
    }

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

        const response = await fetch(`/api/security/schedules/${scheduleId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': csrfToken
            }
        });

        const result = await response.json();

        if (result.status === 'success') {
            await loadSchedules();
            await loadSecurityDashboard();
            showSuccess('Schedule deleted successfully');
        } else {
            showError(result.message || 'Failed to delete schedule');
        }
    } catch (error) {
        console.error('Error deleting schedule:', error);
        showError('Error deleting schedule');
    }
}

async function toggleSchedule(scheduleId) {
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

        const response = await fetch(`/api/security/schedules/${scheduleId}/toggle`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            }
        });

        const result = await response.json();

        if (result.status === 'success') {
            await loadSchedules();
            await loadSecurityDashboard();
            showSuccess(result.message);
        } else {
            showError(result.message || 'Failed to toggle schedule');
        }
    } catch (error) {
        console.error('Error toggling schedule:', error);
        showError('Error toggling schedule');
    }
}

// ===== Formatting Helpers =====

function formatTargetDisplay(targetType, targetValue) {
    if (targetType === 'all') {
        return '<span style="color: #0056b3; font-weight: 600;">All Devices</span>';
    } else if (targetType === 'tag') {
        return `Tag: <span style="background: #e7f3ff; color: #0056b3; padding: 2px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(targetValue)}</span>`;
    } else if (targetType === 'location') {
        return `Location: <span style="background: #e7f3ff; color: #0056b3; padding: 2px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(targetValue)}</span>`;
    } else if (targetType === 'ip') {
        return `IP: <code style="background: #f1f3f5; padding: 2px 6px; border-radius: 4px;">${escapeHtml(targetValue)}</code>`;
    }
    return 'Unknown';
}

function formatScheduleDisplay(scheduleType, scheduleValue) {
    if (scheduleType === 'interval') {
        const seconds = parseInt(scheduleValue);
        if (seconds < 3600) {
            return `Every ${Math.floor(seconds / 60)} minutes`;
        } else if (seconds < 86400) {
            return `Every ${Math.floor(seconds / 3600)} hours`;
        } else {
            return `Every ${Math.floor(seconds / 86400)} days`;
        }
    } else if (scheduleType === 'daily') {
        return `Daily at ${scheduleValue} ${getUserTimezone()}`;
    } else if (scheduleType === 'weekly') {
        const parts = scheduleValue.split(':');
        const day = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        const time = parts.length >= 3 ? `${parts[1]}:${parts[2]}` : '';
        return `${day} at ${time} ${getUserTimezone()}`;
    } else if (scheduleType === 'cron') {
        return `<code style="background: #f1f3f5; padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${escapeHtml(scheduleValue)}</code>`;
    }
    return 'Unknown';
}

function formatLastRun(timestamp, status) {
    if (!timestamp) {
        return '<span style="color: #999;">Never run</span>';
    }

    const date = new Date(timestamp);
    const timeAgo = getTimeAgo(date);

    let statusColor = '#6c757d';
    let statusIcon = '○';

    if (status === 'success') {
        statusColor = '#28a745';
        statusIcon = '✓';
    } else if (status === 'failed') {
        statusColor = '#dc3545';
        statusIcon = '✗';
    } else if (status === 'skipped') {
        statusColor = '#ffc107';
        statusIcon = '⊘';
    }

    return `
        <div style="color: ${statusColor}; font-weight: 600;">${statusIcon} ${status}</div>
        <div style="color: #999; font-size: 0.85em; margin-top: 2px;">${timeAgo}</div>
    `;
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showSuccess(message) {
    alert('✓ ' + message);
}

function showError(message) {
    alert('✗ ' + message);
}

// ===== Quick Action Button Handlers =====

function openCreateScheduleModal() {
    console.log('Opening create schedule modal...');
    createSchedule();
}

async function loadScanQueue() {
    console.log('Loading scan queue...');

    try {
        // Fetch queue data
        const response = await fetch('/api/security/scan-queue');
        const data = await response.json();

        if (data.status !== 'success') {
            showError(data.message || 'Failed to load scan queue');
            return;
        }

        // Show modal with queue data
        showScanQueueModal(data.queue);

    } catch (error) {
        console.error('Error loading scan queue:', error);
        showError('Failed to load scan queue');
    }
}

function showScanQueueModal(queue) {
    // Create modal HTML
    let html = `
        <div id="scanQueueModal" style="display: flex; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.4); align-items: center; justify-content: center;">
            <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 1000px; width: 90%; max-height: 90vh; overflow-y: auto; position: relative;">
                <button onclick="closeScanQueueModal()" style="position: absolute; top: 10px; right: 15px; font-size: 28px; font-weight: bold; color: #aaa; background: none; border: none; cursor: pointer;">×</button>

                <h3 style="margin: 0 0 10px 0; font-family: var(--font-primary); color: #333;">Scan Queue</h3>
                <p style="color: #666; margin: 0 0 20px 0; font-family: var(--font-secondary); font-size: 0.9em;">
                    Active and pending network scans from scheduled tasks
                </p>

                <div id="queueTableContainer">
                    ${renderScanQueueTable(queue)}
                </div>

                <div style="margin-top: 20px; text-align: right;">
                    <button onclick="refreshScanQueue()" style="padding: 10px 20px; margin-right: 10px; background: #FA582D; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 1em;">
                        🔄 Refresh
                    </button>
                    <button onclick="closeScanQueueModal()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-primary); font-size: 1em;">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // Auto-refresh every 5 seconds while modal is open
    window.scanQueueRefreshInterval = setInterval(refreshScanQueue, 5000);
}

function renderScanQueueTable(queue) {
    if (queue.length === 0) {
        return '<p style="color: #999; text-align: center; padding: 40px; font-family: var(--font-secondary);">No scans in queue. All scheduled scans are up to date.</p>';
    }

    let html = `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
                <thead>
                    <tr style="background: #f5f5f5; border-bottom: 2px solid #FA582D;">
                        <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; font-family: var(--font-primary);">Schedule</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; font-family: var(--font-primary);">Target IP</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; color: #333; font-family: var(--font-primary);">Scan Type</th>
                        <th style="padding: 12px; text-align: center; font-weight: 600; color: #333; font-family: var(--font-primary);">Status</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; font-family: var(--font-primary);">Queued At</th>
                        <th style="padding: 12px; text-align: left; font-weight: 600; color: #333; font-family: var(--font-primary);">Progress</th>
                    </tr>
                </thead>
                <tbody>
    `;

    queue.forEach((item, index) => {
        const rowStyle = index % 2 === 0 ? 'background: #ffffff;' : 'background: #f8f9fa;';
        const statusBadge = getStatusBadge(item.status);
        const timeAgo = item.queued_at ? getTimeAgo(new Date(item.queued_at)) : 'Unknown';
        const scheduleName = item.schedule_name || 'Manual Scan';
        const progress = formatQueueProgress(item);

        html += `
            <tr style="${rowStyle} border-bottom: 1px solid #dee2e6;">
                <td style="padding: 12px; color: #333;">
                    <strong>${escapeHtml(scheduleName)}</strong>
                </td>
                <td style="padding: 12px; color: #666;">
                    <code style="background: #f1f3f5; padding: 2px 6px; border-radius: 4px;">${escapeHtml(item.target_ip)}</code>
                </td>
                <td style="padding: 12px; text-align: center;">
                    <span style="background: #e7f3ff; color: #0056b3; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-family: var(--font-primary);">${item.scan_type}</span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    ${statusBadge}
                </td>
                <td style="padding: 12px; color: #666; font-size: 0.85em;">
                    ${timeAgo}
                </td>
                <td style="padding: 12px; color: #666; font-size: 0.85em;">
                    ${progress}
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    return html;
}

function getStatusBadge(status) {
    const badges = {
        'queued': '<span style="background: #ffc107; color: #333; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: 600;">⏳ Queued</span>',
        'running': '<span style="background: #17a2b8; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: 600;">⚙️ Running</span>',
        'completed': '<span style="background: #28a745; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: 600;">✓ Completed</span>',
        'failed': '<span style="background: #dc3545; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: 600;">✗ Failed</span>'
    };
    return badges[status] || '<span style="color: #999;">Unknown</span>';
}

function formatQueueProgress(item) {
    if (item.status === 'queued') {
        return '<span style="color: #999;">Waiting...</span>';
    } else if (item.status === 'running') {
        const startedAt = item.started_at ? new Date(item.started_at) : null;
        if (startedAt) {
            const elapsed = Math.floor((new Date() - startedAt) / 1000);
            return `<span style="color: #17a2b8;">Running (${elapsed}s)</span>`;
        }
        return '<span style="color: #17a2b8;">In progress...</span>';
    } else if (item.status === 'completed') {
        return item.scan_id ? `<span style="color: #28a745;">Scan #${item.scan_id}</span>` : '<span style="color: #28a745;">Done</span>';
    } else if (item.status === 'failed') {
        return item.error_message ? `<span style="color: #dc3545; font-size: 0.85em;">${escapeHtml(item.error_message)}</span>` : '<span style="color: #dc3545;">Error</span>';
    }
    return '';
}

async function refreshScanQueue() {
    console.log('Refreshing scan queue...');

    try {
        const response = await fetch('/api/security/scan-queue');
        const data = await response.json();

        if (data.status === 'success') {
            const container = document.getElementById('queueTableContainer');
            if (container) {
                container.innerHTML = renderScanQueueTable(data.queue);
            }
        }
    } catch (error) {
        console.error('Error refreshing scan queue:', error);
    }
}

function closeScanQueueModal() {
    // Stop auto-refresh
    if (window.scanQueueRefreshInterval) {
        clearInterval(window.scanQueueRefreshInterval);
        window.scanQueueRefreshInterval = null;
    }

    // Remove modal
    const modal = document.getElementById('scanQueueModal');
    if (modal) {
        modal.remove();
    }
}

async function showScanHistory() {
    console.log('Showing scan history...');
    // TODO: Navigate to nmap scan history page or show modal
    alert('Scan History - Navigate to Connected Devices > Network Scanning tab');
}

// ===== Page Initialization =====

async function initSecurityPage() {
    console.log('Initializing Security Monitoring page...');

    try {
        // Load settings to get timezone (if not already loaded by settings.js)
        if (!window.userTimezone) {
            try {
                const settingsResponse = await fetch('/api/settings');
                const settingsData = await settingsResponse.json();
                if (settingsData.status === 'success') {
                    window.userTimezone = settingsData.settings.timezone || 'UTC';
                    console.log('Loaded timezone from settings:', window.userTimezone);
                }
            } catch (error) {
                console.warn('Failed to load timezone from settings, defaulting to UTC:', error);
                window.userTimezone = 'UTC';
            }
        }

        // Load dashboard statistics
        await loadSecurityDashboard();

        // Load schedules list
        await loadSchedules();

        console.log('Security Monitoring page initialized');
    } catch (error) {
        console.error('Error initializing Security Monitoring page:', error);
        showError('Failed to initialize Security Monitoring page');
    }
}

console.log('Security Monitoring module loaded (v1.12.0)');
