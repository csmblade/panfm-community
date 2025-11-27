/**
 * settings.js - Settings Management Module
 *
 * Handles settings functionality including:
 * - Settings load and save
 * - Settings tab switching
 * - Monitored interface updates
 * - Vendor database management
 * - Password change functionality
 * - Tile heading updates
 */

// Settings functionality
async function loadSettings() {
    try {
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const response = await window.apiClient.get('/api/settings');

        if (!response.ok) {
            console.error('Failed to load settings');
            return;
        }

        const data = response.data;

        if (data.status === 'success') {
            document.getElementById('refreshInterval').value = data.settings.refresh_interval;
            document.getElementById('debugLogging').checked = data.settings.debug_logging || false;
            document.getElementById('tonyMode').checked = data.settings.tony_mode || false;
            document.getElementById('timezone').value = data.settings.timezone || 'UTC';

            // Reverse DNS setting (v1.0.12)
            document.getElementById('reverseDnsEnabled').checked = data.settings.reverse_dns_enabled || false;

            // Store settings globally for use across all pages
            window.panfmSettings = window.panfmSettings || {};
            window.panfmSettings.reverse_dns_enabled = data.settings.reverse_dns_enabled || false;

            // Store timezone globally for use in time formatting functions
            window.userTimezone = data.settings.timezone || 'UTC';

            // Initialize Tony Mode session keepalive
            initializeTonyMode(data.settings.tony_mode || false);

            // Monitored interface will be loaded from the selected device in updateDeviceSelector
        }

        // Initialize vendor DB controls (will load info automatically)
        initVendorDbControls();

        // Initialize service port DB controls (will load info automatically)
        initServicePortDbControls();
        
        // Initialize metadata export/import controls (non-blocking)
        initMetadataControls();
    } catch (error) {
        console.error('Error loading settings:', error);
        // Even if there's an error, try to initialize DB controls
        try {
            initVendorDbControls();
            initServicePortDbControls();
        } catch (dbError) {
            console.error('Error initializing database controls:', dbError);
        }
    }
}

// Initialize device metadata export/import controls
function initMetadataControls() {
    try {
        const exportBtn = document.getElementById('exportMetadataBtn');
        if (exportBtn && !exportBtn.hasAttribute('data-listener')) {
            // Check if exportDeviceMetadata function exists (loaded from pages-connected-devices.js)
            if (typeof exportDeviceMetadata === 'function') {
                exportBtn.addEventListener('click', exportDeviceMetadata);
                exportBtn.setAttribute('data-listener', 'true');
            } else {
                console.warn('exportDeviceMetadata function not available yet, will retry on button click');
                // Set up a fallback that will work once the function is loaded
                exportBtn.addEventListener('click', function() {
                    if (typeof exportDeviceMetadata === 'function') {
                        exportDeviceMetadata();
                    } else {
                        alert('Metadata export function not loaded. Please refresh the page.');
                    }
                });
                exportBtn.setAttribute('data-listener', 'true');
            }
        }
    } catch (error) {
        console.error('Error initializing metadata controls:', error);
        // Don't let this break the settings loading
    }
}

async function saveSettingsData() {
    try {
        const refreshInterval = parseInt(document.getElementById('refreshInterval').value);
        const debugLogging = document.getElementById('debugLogging').checked;
        const tonyMode = document.getElementById('tonyMode').checked;
        const timezone = document.getElementById('timezone').value;

        // Reverse DNS setting (v1.0.12)
        const reverseDnsEnabled = document.getElementById('reverseDnsEnabled').checked;

        // Get current settings to preserve selected_device_id and monitored_interface
        const currentSettingsResponse = await window.apiClient.get('/api/settings');

        const settingsToSave = {
            refresh_interval: refreshInterval,
            debug_logging: debugLogging,
            tony_mode: tonyMode,
            timezone: timezone,
            reverse_dns_enabled: reverseDnsEnabled
        };

        // Preserve selected_device_id and monitored_interface from current settings
        if (currentSettingsResponse.ok && currentSettingsResponse.data.status === 'success') {
            if (currentSettingsResponse.data.settings.selected_device_id) {
                settingsToSave.selected_device_id = currentSettingsResponse.data.settings.selected_device_id;
            }
            if (currentSettingsResponse.data.settings.monitored_interface) {
                settingsToSave.monitored_interface = currentSettingsResponse.data.settings.monitored_interface;
            }
        }

        // Use centralized ApiClient (v1.14.0 - CSRF token auto-injected)
        const response = await window.apiClient.post('/api/settings', settingsToSave);

        if (!response.ok) {
            throw new Error('Failed to save settings');
        }

        const data = response.data;

        if (data.status === 'success') {
            // Update local variables
            UPDATE_INTERVAL = refreshInterval * 1000;
            window.userTimezone = timezone;

            // Update global reverse DNS setting (v1.0.12)
            window.panfmSettings = window.panfmSettings || {};
            window.panfmSettings.reverse_dns_enabled = reverseDnsEnabled;

            // Clear DNS cache when settings change (provider or enabled state)
            if (window.reverseDnsCache) {
                window.reverseDnsCache = {};
                console.log('Reverse DNS cache cleared due to settings change');
            }

            // Restart update interval with new timing
            if (updateIntervalId) {
                clearInterval(updateIntervalId);
            }
            updateIntervalId = setInterval(fetchThroughputData, UPDATE_INTERVAL);

            // Show success message
            const successMsg = document.getElementById('settingsSuccessMessage');
            successMsg.style.display = 'block';
            setTimeout(() => {
                successMsg.style.display = 'none';
            }, 3000);

            // Update debug alert visibility
            const debugAlert = document.getElementById('debugAlert');
            if (debugLogging === true) {
                debugAlert.style.display = 'block';
            } else {
                debugAlert.style.display = 'none';
            }

            // Update Tony Mode session keepalive
            initializeTonyMode(tonyMode);
        } else {
            alert('Failed to save settings: ' + data.message);
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Error saving settings: ' + error.message);
    }
}

function resetSettingsData() {
    document.getElementById('refreshInterval').value = 60;
    document.getElementById('debugLogging').checked = false;
    document.getElementById('tonyMode').checked = false;
    document.getElementById('timezone').value = 'UTC';
    // Reverse DNS settings (v1.0.12)
    document.getElementById('reverseDnsEnabled').checked = false;
}

// Update monitored interface from dashboard
// updateMonitoredInterface function moved to app.js to access device variables

async function initSettings() {
    // OPTIMIZATION: Check cache first to avoid duplicate API call
    let cachedSettings = window.CacheUtil ? window.CacheUtil.get('settings') : null;

    try {
        let settings;

        if (cachedSettings) {
            console.log('[OPTIMIZATION] Using cached settings (avoiding duplicate /api/settings call)');
            settings = cachedSettings;
        } else {
            console.log('[OPTIMIZATION] No cached settings, fetching from API');
            // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
            const response = await window.apiClient.get('/api/settings');

            if (!response.ok) {
                console.error('Failed to load settings on init');
                return;
            }

            const data = response.data;

            if (data.status !== 'success') {
                console.error('Settings API returned error');
                return;
            }

            settings = data.settings;

            // Cache for future use
            if (window.CacheUtil) {
                window.CacheUtil.set('settings', settings, 5 * 60 * 1000);
            }
        }

        // Apply settings
        UPDATE_INTERVAL = settings.refresh_interval * 1000;

        // Store settings globally for use by ThroughputDataService and other modules
        window.appSettings = settings;

        // Store timezone globally for use in time formatting functions
        window.userTimezone = settings.timezone || 'UTC';

        // Show debug alert if debug logging is enabled
        const debugAlert = document.getElementById('debugAlert');
        if (settings.debug_logging === true) {
            debugAlert.style.display = 'block';
        } else {
            debugAlert.style.display = 'none';
        }

    } catch (error) {
        console.error('Error loading initial settings:', error);
    }

    // Setup event listeners
    document.getElementById('saveSettings').addEventListener('click', saveSettingsData);
    document.getElementById('resetSettings').addEventListener('click', resetSettingsData);

    // Setup password change listener
    initPasswordChange();

    // Setup settings tab switching
    initSettingsTabs();

    // Check if password change is required (from URL parameter)
    checkPasswordChangeRequired();
}

// Settings tab switching functionality
function initSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    const tabContents = document.querySelectorAll('.settings-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');

            // Remove active class from all tabs
            tabs.forEach(t => {
                t.classList.remove('active');
                t.style.color = '#666';
                t.style.borderBottomColor = 'transparent';
                t.style.background = 'transparent';
            });

            // Add active class to clicked tab
            tab.classList.add('active');
            tab.style.color = '#333';
            tab.style.borderBottomColor = '#FA582D';
            tab.style.background = 'white';

            // Hide all tab contents
            tabContents.forEach(content => {
                content.style.display = 'none';
            });

            // Show target tab content
            const targetContent = document.getElementById(targetTab + '-tab');
            if (targetContent) {
                targetContent.style.display = 'block';
                
                // Load database info when databases tab is opened
                if (targetTab === 'databases') {
                    // Load vendor DB info if not already loaded
                    const vendorDbStatus = document.getElementById('vendorDbStatus');
                    if (vendorDbStatus && (!vendorDbStatus.textContent || vendorDbStatus.textContent === 'Loading...')) {
                        loadVendorDbInfo();
                    }

                    // Load service port DB info if not already loaded
                    const servicePortDbStatus = document.getElementById('servicePortDbStatus');
                    if (servicePortDbStatus && (!servicePortDbStatus.textContent || servicePortDbStatus.textContent === 'Loading...')) {
                        loadServicePortDbInfo();
                    }
                }

                // Load maintenance tab when opened
                if (targetTab === 'services') {
                    loadMaintenanceDeviceTable();
                    loadDatabaseSize();
                    initTagManagement();  // Load tag management (v2.2.0)
                }
            }
        });
    });
}

// Vendor Database Functions
async function loadVendorDbInfo() {
    console.log('Loading vendor database info...');
    try {
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const response = await window.apiClient.get('/api/vendor-db/info');

        if (!response.ok) {
            throw new Error('Failed to load vendor DB info');
        }

        const data = response.data;

        if (data.status === 'success') {
            const info = data.info;

            // Get DOM elements and check if they exist before updating
            const statusEl = document.getElementById('vendorDbStatus');
            const entriesEl = document.getElementById('vendorDbEntries');
            const sizeEl = document.getElementById('vendorDbSize');
            const modifiedEl = document.getElementById('vendorDbModified');

            if (statusEl) {
                statusEl.textContent = info.exists ? '✓ Loaded' : '✗ Not loaded';
                statusEl.style.color = info.exists ? '#28a745' : '#dc3545';
            }
            if (entriesEl) entriesEl.textContent = info.entries.toLocaleString();
            if (sizeEl) sizeEl.textContent = `${info.size_mb} MB`;
            if (modifiedEl) modifiedEl.textContent = info.modified;
        }
    } catch (error) {
        console.error('Error loading vendor DB info:', error);
        // Check if element exists before updating
        const statusEl = document.getElementById('vendorDbStatus');
        if (statusEl) {
            statusEl.textContent = 'Error';
            statusEl.style.color = '#dc3545';
        }
    }
}

async function uploadVendorDb() {
    const fileInput = document.getElementById('vendorDbFileInput');
    const messageDiv = document.getElementById('vendorDbUploadMessage');
    const uploadBtn = document.getElementById('uploadVendorDbBtn');

    if (!fileInput.files || fileInput.files.length === 0) {
        messageDiv.textContent = 'Please select a file first';
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#fff3cd';
        messageDiv.style.color = '#856404';
        messageDiv.style.border = '1px solid #ffeaa7';
        return;
    }

    const file = fileInput.files[0];

    if (!file.name.endsWith('.json')) {
        messageDiv.textContent = 'File must be a JSON file';
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.border = '1px solid #f5c6cb';
        return;
    }

    // Disable button during upload
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    try {
        const formData = new FormData();
        formData.append('file', file);

        // Get CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        const response = await fetch('/api/vendor-db/upload', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            },
            body: formData
        });

        const data = await response.json();

        if (data.status === 'success') {
            messageDiv.textContent = data.message;
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#d4edda';
            messageDiv.style.color = '#155724';
            messageDiv.style.border = '1px solid #c3e6cb';

            // Refresh info display
            await loadVendorDbInfo();

            // Clear file input
            fileInput.value = '';
        } else {
            messageDiv.textContent = 'Error: ' + data.message;
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.style.border = '1px solid #f5c6cb';
        }
    } catch (error) {
        console.error('Error uploading vendor DB:', error);
        messageDiv.textContent = 'Upload failed: ' + error.message;
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.border = '1px solid #f5c6cb';
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload Database';
    }
}

function initVendorDbControls() {
    try {
        // Upload button
        const uploadBtn = document.getElementById('uploadVendorDbBtn');
        if (uploadBtn && !uploadBtn.hasAttribute('data-listener')) {
            uploadBtn.addEventListener('click', uploadVendorDb);
            uploadBtn.setAttribute('data-listener', 'true');
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshVendorDbInfoBtn');
        if (refreshBtn && !refreshBtn.hasAttribute('data-listener')) {
            refreshBtn.addEventListener('click', loadVendorDbInfo);
            refreshBtn.setAttribute('data-listener', 'true');
        }

        // Load initial info (functions handle null checks internally)
        loadVendorDbInfo();
    } catch (error) {
        console.error('Error initializing vendor DB controls:', error);
    }
}

// ============================================================================
// Service Port Database Functions
// ============================================================================

async function loadServicePortDbInfo() {
    console.log('Loading service port database info...');
    try {
        // Use centralized ApiClient (v1.14.0 - Enterprise Reliability)
        const response = await window.apiClient.get('/api/service-port-db/info');

        if (!response.ok) {
            throw new Error('Failed to load service port DB info');
        }

        const data = response.data;

        if (data.status === 'success') {
            const info = data.info;

            const statusEl = document.getElementById('servicePortDbStatus');
            const entriesEl = document.getElementById('servicePortDbEntries');
            const sizeEl = document.getElementById('servicePortDbSize');
            const modifiedEl = document.getElementById('servicePortDbModified');

            if (statusEl) {
                statusEl.textContent = info.exists ? '✓ Loaded' : '✗ Not loaded';
                statusEl.style.color = info.exists ? '#28a745' : '#dc3545';
            }
            if (entriesEl) entriesEl.textContent = info.entries.toLocaleString();
            if (sizeEl) sizeEl.textContent = `${info.size_mb} MB`;
            if (modifiedEl) modifiedEl.textContent = info.modified;
        }
    } catch (error) {
        console.error('Error loading service port DB info:', error);
        const statusEl = document.getElementById('servicePortDbStatus');
        if (statusEl) {
            statusEl.textContent = 'Error';
            statusEl.style.color = '#dc3545';
        }
    }
}

async function uploadServicePortDb() {
    const fileInput = document.getElementById('servicePortDbFileInput');
    const messageDiv = document.getElementById('servicePortDbUploadMessage');
    const uploadBtn = document.getElementById('uploadServicePortDbBtn');

    if (!fileInput.files || fileInput.files.length === 0) {
        messageDiv.textContent = 'Please select a file first';
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#fff3cd';
        messageDiv.style.color = '#856404';
        messageDiv.style.border = '1px solid #ffeaa7';
        return;
    }

    const file = fileInput.files[0];

    if (!file.name.endsWith('.xml')) {
        messageDiv.textContent = 'File must be an XML file';
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.border = '1px solid #f5c6cb';
        return;
    }

    // Disable button during upload
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    try {
        const formData = new FormData();
        formData.append('file', file);

        // Get CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        const response = await fetch('/api/service-port-db/upload', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            },
            body: formData
        });

        const data = await response.json();

        if (data.status === 'success') {
            messageDiv.textContent = data.message;
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#d4edda';
            messageDiv.style.color = '#155724';
            messageDiv.style.border = '1px solid #c3e6cb';

            // Refresh info display
            await loadServicePortDbInfo();

            // Clear file input
            fileInput.value = '';
        } else {
            messageDiv.textContent = 'Error: ' + data.message;
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.style.border = '1px solid #f5c6cb';
        }
    } catch (error) {
        console.error('Error uploading service port DB:', error);
        messageDiv.textContent = 'Upload failed: ' + error.message;
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.border = '1px solid #f5c6cb';
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload Database';
    }
}

function initServicePortDbControls() {
    try {
        // Upload button
        const uploadBtn = document.getElementById('uploadServicePortDbBtn');
        if (uploadBtn && !uploadBtn.hasAttribute('data-listener')) {
            uploadBtn.addEventListener('click', uploadServicePortDb);
            uploadBtn.setAttribute('data-listener', 'true');
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshServicePortDbInfoBtn');
        if (refreshBtn && !refreshBtn.hasAttribute('data-listener')) {
            refreshBtn.addEventListener('click', loadServicePortDbInfo);
            refreshBtn.setAttribute('data-listener', 'true');
        }

        // Load initial info (functions handle null checks internally)
        loadServicePortDbInfo();
    } catch (error) {
        console.error('Error initializing service port DB controls:', error);
    }
}

// ============================================================================
// Password Change Functions
// ============================================================================

/**
 * Check if password change is required (from URL parameter)
 * If yes, automatically open Settings page and Security tab with warning
 */
function checkPasswordChangeRequired() {
    console.log('[PASSWORD-CHANGE] Checking if password change required...');
    const urlParams = new URLSearchParams(window.location.search);
    const mustChangePassword = urlParams.get('must_change_password');
    console.log('[PASSWORD-CHANGE] URL parameter value:', mustChangePassword);

    if (mustChangePassword === 'true') {
        console.log('[PASSWORD-CHANGE] Password change required - showing prompt');

        // Show password change warning
        const warningDiv = document.getElementById('passwordChangeWarning');
        if (warningDiv) {
            console.log('[PASSWORD-CHANGE] Showing warning div');
            warningDiv.style.display = 'block';
        } else {
            console.error('[PASSWORD-CHANGE] Warning div not found!');
        }

        // Switch to Settings page
        console.log('[PASSWORD-CHANGE] Switching to Settings page');
        showPage('settings');

        // Switch to Security tab
        const securityTab = document.querySelector('.settings-tab[data-tab="security"]');
        if (securityTab) {
            console.log('[PASSWORD-CHANGE] Clicking Security tab');
            securityTab.click();
        } else {
            console.error('[PASSWORD-CHANGE] Security tab not found!');
        }

        // Clear URL parameter
        window.history.replaceState({}, document.title, '/');
        console.log('[PASSWORD-CHANGE] URL parameter cleared');
    } else {
        console.log('[PASSWORD-CHANGE] No password change required');
    }
}

/**
 * Initialize password change functionality
 */
function initPasswordChange() {
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn && !changePasswordBtn.hasAttribute('data-listener')) {
        changePasswordBtn.addEventListener('click', handlePasswordChange);
        changePasswordBtn.setAttribute('data-listener', 'true');
    }
}

/**
 * Handle password change form submission
 */
async function handlePasswordChange() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const messageDiv = document.getElementById('passwordChangeMessage');
    const changeBtn = document.getElementById('changePasswordBtn');

    // Clear previous message
    messageDiv.style.display = 'none';
    messageDiv.textContent = '';

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
        showPasswordMessage('All fields are required', 'error');
        return;
    }

    if (newPassword.length < 8) {
        showPasswordMessage('New password must be at least 8 characters', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showPasswordMessage('New passwords do not match', 'error');
        return;
    }

    // Disable button during request
    changeBtn.disabled = true;
    changeBtn.textContent = 'Changing Password...';

    try {
        // Use centralized ApiClient (v1.14.0 - CSRF token auto-injected)
        const response = await window.apiClient.post('/api/change-password', {
            old_password: currentPassword,
            new_password: newPassword
        });

        if (!response.ok) {
            throw new Error('Failed to change password');
        }

        const data = response.data;

        if (data.status === 'success') {
            showPasswordMessage(data.message || 'Password changed successfully!', 'success');

            // Clear form fields
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';

            // Hide warning if shown
            const warningDiv = document.getElementById('passwordChangeWarning');
            if (warningDiv) {
                warningDiv.style.display = 'none';
            }
        } else {
            showPasswordMessage(data.message || 'Failed to change password', 'error');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        showPasswordMessage('Error changing password: ' + error.message, 'error');
    } finally {
        // Re-enable button
        changeBtn.disabled = false;
        changeBtn.textContent = 'Change Password';
    }
}

/**
 * Show password change message
 * @param {string} message - Message to display
 * @param {string} type - 'success' or 'error'
 */
function showPasswordMessage(message, type) {
    const messageDiv = document.getElementById('passwordChangeMessage');

    messageDiv.textContent = message;
    messageDiv.style.display = 'block';

    if (type === 'success') {
        messageDiv.style.background = '#d4edda';
        messageDiv.style.color = '#155724';
        messageDiv.style.border = '1px solid #c3e6cb';
    } else {
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.border = '1px solid #f5c6cb';
    }

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
    }
}

// Start when DOM is ready
// Initialization is handled by app.js DOMContentLoaded listener
// This script just provides the settings functionality
// No need to call init() here - app.js handles it

/**
 * Initialize or update Tony Mode session keepalive
 * @param {boolean} enabled - Whether Tony Mode is enabled
 */
function initializeTonyMode(enabled) {
    // Clear any existing keepalive interval
    if (window.sessionKeepaliveIntervalId) {
        clearInterval(window.sessionKeepaliveIntervalId);
        window.sessionKeepaliveIntervalId = null;
        console.log('Tony Mode: Stopped session keepalive');
    }

    // If Tony Mode is enabled, start session keepalive
    if (enabled) {
        // Ping the server every 10 minutes to keep session alive
        // Session lifetime is 24 hours, so this ensures it never expires
        const KEEPALIVE_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

        window.sessionKeepaliveIntervalId = setInterval(async () => {
            try {
                // Use centralized ApiClient (v1.14.0 - fire-and-forget with retry)
                window.apiClient.post('/api/session-keepalive').catch(err => {
                    console.warn('Tony Mode: Session keepalive failed:', err);
                });
                console.log('Tony Mode: Session keepalive ping sent');
            } catch (error) {
                console.error('Tony Mode: Session keepalive error:', error);
            }
        }, KEEPALIVE_INTERVAL);

        console.log('Tony Mode: Started session keepalive (every 10 minutes)');
    }
}

/**
 * Load the maintenance tab with device table
 * Simplified for Community Edition
 */
async function refreshServicesStatus() {
    await loadMaintenanceDeviceTable();
    await loadDatabaseSize();
}

/**
 * Load database size information
 */
async function loadDatabaseSize() {
    const sizeInfo = document.getElementById('databaseSizeInfo');
    if (!sizeInfo) return;

    try {
        const response = await window.apiClient.get('/api/database/size');
        if (!response.ok) {
            throw new Error('Failed to load database size');
        }

        const data = response.data;
        const rowCounts = data.row_counts || {};

        // Format row counts
        const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
        const formattedRows = totalRows.toLocaleString();

        sizeInfo.innerHTML = `
            <span style="font-size: 1.1em; color: #FA582D; font-weight: 600;">${data.total_size}</span>
            <span style="margin-left: 15px; color: #808080;">|</span>
            <span style="margin-left: 15px;">${formattedRows} records</span>
        `;

    } catch (error) {
        console.error('Error loading database size:', error);
        sizeInfo.textContent = 'Unable to load database size';
    }
}

/**
 * Load device table for maintenance tab
 */
async function loadMaintenanceDeviceTable() {
    const tableBody = document.getElementById('maintenanceDeviceTable');
    if (!tableBody) return;

    try {
        const response = await window.apiClient.get('/api/devices');
        if (!response.ok) {
            throw new Error('Failed to load devices');
        }

        // API returns {status, devices, groups} - extract devices array
        const data = response.data;
        const devices = data.devices || [];

        if (!devices || devices.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="3" style="padding: 30px; text-align: center; color: #888; background: #2a2a2a;">
                        No devices configured. Add devices in the Managed Devices section.
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        devices.forEach((device, index) => {
            const rowBg = index % 2 === 0 ? '#2a2a2a' : '#333333';
            html += `
                <tr style="border-bottom: 1px solid #444; background: ${rowBg}; transition: all 0.2s;" onmouseover="this.style.background='#404040'; this.style.borderLeft='3px solid #FA582D'" onmouseout="this.style.background='${rowBg}'; this.style.borderLeft='none'">
                    <td style="padding: 12px 15px; color: #FA582D; font-weight: 500;">${escapeHtml(device.name)}</td>
                    <td style="padding: 12px 15px; color: #b0b0b0; font-family: monospace;">${escapeHtml(device.ip)}</td>
                    <td style="padding: 12px 15px; text-align: center;">
                        <button onclick="clearDeviceData('${device.id}', '${escapeHtml(device.name)}')"
                                style="padding: 6px 16px; background: #dc2626; color: #F2F0EF; border: none; border-radius: 4px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;"
                                onmouseover="this.style.background='#b91c1c'; this.style.transform='scale(1.05)'"
                                onmouseout="this.style.background='#dc2626'; this.style.transform='scale(1)'">
                            Clear Data
                        </button>
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;

    } catch (error) {
        console.error('Error loading maintenance device table:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="3" style="padding: 30px; text-align: center; color: #f87171; background: #2a2a2a;">
                    Error loading devices: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Clear data for a specific device
 */
async function clearDeviceData(deviceId, deviceName) {
    const confirmed = confirm(
        `⚠️ Clear all historical data for "${deviceName}"?\n\n` +
        'This will delete:\n' +
        '• Throughput history\n' +
        '• Alert history\n' +
        '• Connected devices data\n\n' +
        'This action cannot be undone.'
    );

    if (!confirmed) return;

    try {
        const response = await window.apiClient.post('/api/database/clear', { device_id: deviceId });

        if (!response.ok) {
            throw new Error(response.data?.message || 'Failed to clear data');
        }

        alert(`✅ Data cleared successfully for "${deviceName}"`);
        await loadMaintenanceDeviceTable();
        await loadDatabaseSize();

    } catch (error) {
        console.error('Error clearing device data:', error);
        alert('❌ Error: ' + error.message);
    }
}

/**
 * Clear data for all devices
 */
async function clearAllDeviceData() {
    const confirmed = confirm(
        '⚠️ WARNING: Clear ALL historical data for ALL devices?\n\n' +
        'This will delete:\n' +
        '• All throughput history\n' +
        '• All alert history\n' +
        '• All connected devices data\n\n' +
        'This action cannot be undone!'
    );

    if (!confirmed) return;

    // Double confirmation for destructive action
    const doubleConfirm = confirm(
        '🔴 FINAL CONFIRMATION\n\n' +
        'You are about to PERMANENTLY DELETE all database records.\n\n' +
        'Click OK to proceed, or Cancel to abort.'
    );

    if (!doubleConfirm) return;

    try {
        const response = await window.apiClient.post('/api/database/clear', {});

        if (!response.ok) {
            throw new Error(response.data?.message || 'Failed to clear data');
        }

        alert('✅ All data cleared successfully');
        await loadMaintenanceDeviceTable();
        await loadDatabaseSize();

    } catch (error) {
        console.error('Error clearing all device data:', error);
        alert('❌ Error: ' + error.message);
    }
}

/**
 * Format relative time (e.g., "2 minutes ago", "in 5 minutes")
 */
function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = date - now;
    const diffSecs = Math.abs(Math.floor(diffMs / 1000));
    const isPast = diffMs < 0;

    if (diffSecs < 60) {
        return isPast ? 'Just now' : 'In a few seconds';
    } else if (diffSecs < 3600) {
        const mins = Math.floor(diffSecs / 60);
        return isPast ? `${mins} min${mins !== 1 ? 's' : ''} ago` : `in ${mins} min${mins !== 1 ? 's' : ''}`;
    } else if (diffSecs < 86400) {
        const hours = Math.floor(diffSecs / 3600);
        return isPast ? `${hours} hour${hours !== 1 ? 's' : ''} ago` : `in ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
        const days = Math.floor(diffSecs / 86400);
        return isPast ? `${days} day${days !== 1 ? 's' : ''} ago` : `in ${days} day${days !== 1 ? 's' : ''}`;
    }
}

// ============================================================================
// TAG MANAGEMENT (Maintenance Tab)
// ============================================================================

/**
 * Load devices for tag management dropdown
 */
async function loadTagManagementDevices() {
    const select = document.getElementById('tagManagementDeviceSelect');
    if (!select) return;

    try {
        const response = await window.apiClient.get('/api/tags/devices');
        if (!response.ok) {
            throw new Error('Failed to load devices');
        }

        const data = response.data;
        const devices = data.devices || [];

        // Keep "All Devices" option, add specific devices
        let html = '<option value="">All Devices (Global)</option>';
        devices.forEach(device => {
            const tagCount = device.tag_count > 0 ? ` (${device.tag_count} tags)` : '';
            html += `<option value="${device.device_id}">${escapeHtml(device.device_name)}${tagCount}</option>`;
        });

        select.innerHTML = html;

    } catch (error) {
        console.error('Error loading devices for tag management:', error);
    }
}

/**
 * Load tag management table
 */
async function loadTagManagement() {
    const tableBody = document.getElementById('tagManagementTableBody');
    const statsDiv = document.getElementById('tagManagementStats');
    if (!tableBody) return;

    // Get selected device filter
    const deviceSelect = document.getElementById('tagManagementDeviceSelect');
    const deviceId = deviceSelect ? deviceSelect.value : '';

    tableBody.innerHTML = '<tr><td colspan="3" style="padding: 30px; text-align: center; color: #888;">Loading tags...</td></tr>';

    try {
        // Build API URL with optional device filter
        let url = '/api/tags';
        if (deviceId) {
            url += `?device_id=${encodeURIComponent(deviceId)}`;
        }

        const response = await window.apiClient.get(url);
        if (!response.ok) {
            throw new Error('Failed to load tags');
        }

        const data = response.data;
        const tags = data.tags || [];

        if (tags.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="3" style="padding: 30px; text-align: center; color: #888; background: #2a2a2a;">
                        No tags found${deviceId ? ' for this device' : ''}. Tags are created when you add metadata to connected devices.
                    </td>
                </tr>
            `;
            if (statsDiv) {
                statsDiv.textContent = '0 tags';
            }
            return;
        }

        // Build table rows
        let html = '';
        tags.forEach((tagInfo, index) => {
            const tag = tagInfo.tag;
            const count = tagInfo.count || 0;
            const rowBg = index % 2 === 0 ? '#2a2a2a' : '#333333';
            html += `
                <tr style="border-bottom: 1px solid #444; background: ${rowBg}; transition: all 0.2s;" onmouseover="this.style.background='#404040'; this.style.borderLeft='3px solid #FA582D'" onmouseout="this.style.background='${rowBg}'; this.style.borderLeft='none'">
                    <td style="padding: 12px 15px; color: #F2F0EF;">
                        <span style="display: inline-block; padding: 4px 10px; background: #FA582D; color: #F2F0EF; border-radius: 4px; font-size: 0.9em; font-weight: 500;">
                            ${escapeHtml(tag)}
                        </span>
                    </td>
                    <td style="padding: 12px 15px; text-align: center; color: #b0b0b0;">
                        ${count} device${count !== 1 ? 's' : ''}
                    </td>
                    <td style="padding: 12px 15px; text-align: center;">
                        <button onclick="renameTag('${escapeHtml(tag).replace(/'/g, "\\'")}', '${deviceId}')"
                                style="padding: 6px 12px; background: #2563eb; color: #F2F0EF; border: none; border-radius: 4px; font-size: 0.85em; font-weight: 500; cursor: pointer; margin-right: 8px; transition: transform 0.2s;"
                                onmouseover="this.style.background='#1d4ed8'; this.style.transform='scale(1.05)'"
                                onmouseout="this.style.background='#2563eb'; this.style.transform='scale(1)'">
                            Rename
                        </button>
                        <button onclick="deleteTag('${escapeHtml(tag).replace(/'/g, "\\'")}', '${deviceId}')"
                                style="padding: 6px 12px; background: #dc2626; color: #F2F0EF; border: none; border-radius: 4px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;"
                                onmouseover="this.style.background='#b91c1c'; this.style.transform='scale(1.05)'"
                                onmouseout="this.style.background='#dc2626'; this.style.transform='scale(1)'">
                            Delete
                        </button>
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;

        // Update stats
        if (statsDiv) {
            const totalUsage = tags.reduce((sum, t) => sum + (t.count || 0), 0);
            statsDiv.textContent = `${tags.length} tag${tags.length !== 1 ? 's' : ''} • ${totalUsage} total usage${deviceId ? '' : ' (all devices)'}`;
        }

    } catch (error) {
        console.error('Error loading tag management:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="3" style="padding: 30px; text-align: center; color: #dc2626;">
                    Error loading tags: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Rename a tag
 */
async function renameTag(oldTag, deviceId) {
    const newTag = prompt(`Enter new name for tag "${oldTag}":`, oldTag);
    if (!newTag || newTag.trim() === '' || newTag.trim() === oldTag) {
        return;
    }

    const trimmedNewTag = newTag.trim();

    try {
        // Build API URL with optional device filter
        let url = `/api/tags/${encodeURIComponent(oldTag)}`;
        if (deviceId) {
            url += `?device_id=${encodeURIComponent(deviceId)}`;
        }

        const response = await window.apiClient.put(url, { new_name: trimmedNewTag });

        if (!response.ok) {
            throw new Error(response.data?.message || 'Failed to rename tag');
        }

        const data = response.data;
        alert(`✅ Tag renamed: "${oldTag}" → "${trimmedNewTag}"\n\n${data.affected_count} device${data.affected_count !== 1 ? 's' : ''} updated.`);

        // Reload tag table
        await loadTagManagement();

    } catch (error) {
        console.error('Error renaming tag:', error);
        alert('❌ Error: ' + error.message);
    }
}

/**
 * Delete a tag
 */
async function deleteTag(tag, deviceId) {
    const scope = deviceId ? 'this device' : 'ALL devices';
    const confirmed = confirm(
        `⚠️ Delete tag "${tag}" from ${scope}?\n\n` +
        'This will remove the tag from all devices using it. ' +
        'The devices themselves will not be deleted.\n\n' +
        'This action cannot be undone.'
    );

    if (!confirmed) return;

    try {
        // Build API URL with optional device filter
        let url = `/api/tags/${encodeURIComponent(tag)}`;
        if (deviceId) {
            url += `?device_id=${encodeURIComponent(deviceId)}`;
        }

        const response = await window.apiClient.delete(url);

        if (!response.ok) {
            throw new Error(response.data?.message || 'Failed to delete tag');
        }

        const data = response.data;
        alert(`✅ Tag "${tag}" deleted.\n\n${data.affected_count} device${data.affected_count !== 1 ? 's' : ''} updated.`);

        // Reload tag table
        await loadTagManagement();

    } catch (error) {
        console.error('Error deleting tag:', error);
        alert('❌ Error: ' + error.message);
    }
}

/**
 * Initialize tag management when Maintenance tab is opened
 */
function initTagManagement() {
    loadTagManagementDevices();
    loadTagManagement();
}

