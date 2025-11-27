/**
 * PANfm - Page Navigation Module
 * Handles page switching, tab navigation, and modal event listeners
 *
 * Extracted from app.js for file size reduction (v1.0.15)
 */

console.log('[APP-NAVIGATION.JS] ===== MODULE LOADING STARTED =====');

// Track currently visible page for device change refreshes
let currentVisiblePage = 'homepage';

// Export to window for access by other modules
window.currentVisiblePage = currentVisiblePage;

/**
 * Get the currently visible page
 * @returns {string} Current page identifier
 */
function getCurrentVisiblePage() {
    return currentVisiblePage;
}

/**
 * Set the currently visible page
 * @param {string} page - Page identifier
 */
function setCurrentVisiblePage(page) {
    currentVisiblePage = page;
    window.currentVisiblePage = page;
}

/**
 * Initialize page navigation and tab switching
 * Sets up event listeners for menu items and tab controls
 */
function initPageNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const pages = {
        'homepage': document.getElementById('homepage-content'),
        'connected-devices': document.getElementById('connected-devices-content'),
        'applications': document.getElementById('applications-content'),
        'device-info': document.getElementById('device-info-content'),
        'logs': document.getElementById('logs-content'),
        'analytics': document.getElementById('analytics-content'),
        'devices': document.getElementById('devices-content'),
        'settings': document.getElementById('settings-content')
    };

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetPage = item.getAttribute('data-page');
            setCurrentVisiblePage(targetPage); // Track current page

            // Update active menu item
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');

            // Show target page, hide others
            Object.keys(pages).forEach(pageKey => {
                if (pageKey === targetPage) {
                    pages[pageKey].style.display = 'block';
                    if (pageKey === 'homepage') {
                        // Reload chord diagrams when navigating back to homepage
                        if (typeof loadChordDiagrams === 'function' && typeof d3 !== 'undefined') {
                            console.log('[NAV] Navigated to homepage - reloading chord diagrams');
                            loadChordDiagrams().catch(error => {
                                console.error('[NAV] Error loading chord diagrams:', error);
                            });
                        }

                        // ALSO reload tag-filtered chord diagram if tags are selected
                        if (typeof loadTagFilteredChordDiagram === 'function' && typeof d3 !== 'undefined') {
                            console.log('[NAV] Navigated to homepage - reloading tag-filtered chord diagram');
                            // Load tag-filtered diagram (it will check for saved tags internally)
                            loadTagFilteredChordDiagram().catch(error => {
                                console.error('[NAV] Error loading tag-filtered chord diagram:', error);
                            });
                        }
                    } else if (pageKey === 'device-info') {
                        // Load interfaces by default (first tab)
                        if (typeof loadInterfaces === 'function') loadInterfaces();
                    } else if (pageKey === 'connected-devices') {
                        if (typeof loadConnectedDevices === 'function') loadConnectedDevices();
                    } else if (pageKey === 'applications') {
                        if (typeof loadApplications === 'function') loadApplications();
                        if (typeof setupApplicationsEventListeners === 'function') setupApplicationsEventListeners();
                        if (typeof restoreApplicationsFiltersState === 'function') restoreApplicationsFiltersState();
                    } else if (pageKey === 'logs') {
                        // Load system logs by default (first tab)
                        if (typeof loadSystemLogs === 'function') loadSystemLogs();
                    } else if (pageKey === 'analytics') {
                        // Load analytics dashboard page
                        if (typeof initAnalyticsPage === 'function') initAnalyticsPage();
                    } else if (pageKey === 'devices') {
                        if (typeof loadDevices === 'function') loadDevices();
                    } else if (pageKey === 'settings') {
                        if (typeof loadSettings === 'function') loadSettings();
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
        addDeviceBtn.addEventListener('click', () => {
            if (typeof showDeviceModal === 'function') showDeviceModal();
        });
    }

    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (typeof hideDeviceModal === 'function') hideDeviceModal();
        });
    }

    const cancelModalBtn = document.getElementById('cancelModalBtn');
    if (cancelModalBtn) {
        cancelModalBtn.addEventListener('click', () => {
            if (typeof hideDeviceModal === 'function') hideDeviceModal();
        });
    }

    const deviceForm = document.getElementById('deviceForm');
    if (deviceForm) {
        deviceForm.addEventListener('submit', (e) => {
            if (typeof saveDevice === 'function') saveDevice(e);
        });
    }

    const testConnectionBtn = document.getElementById('testConnectionBtn');
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', () => {
            if (typeof testConnection === 'function') testConnection();
        });
    }

    // Initialize tab switching
    initLogsTabSwitching();
    initDeviceInfoTabSwitching();
    initSoftwareSubTabSwitching();

    console.log('[APP-NAVIGATION.JS] Page navigation initialized');
}

/**
 * Initialize Logs page tab switching
 */
function initLogsTabSwitching() {
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
                    if (systemLogsTab) systemLogsTab.style.display = 'block';
                    if (trafficLogsTab) trafficLogsTab.style.display = 'none';
                    if (typeof loadSystemLogs === 'function') loadSystemLogs();
                } else if (targetTab === 'traffic-logs') {
                    if (systemLogsTab) systemLogsTab.style.display = 'none';
                    if (trafficLogsTab) trafficLogsTab.style.display = 'block';
                    if (typeof updateTrafficPage === 'function') updateTrafficPage();
                }
            });
        });
    }
}

/**
 * Initialize Device Info page tab switching
 */
function initDeviceInfoTabSwitching() {
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

                // Hide all tabs first
                if (softwareUpdatesTab) softwareUpdatesTab.style.display = 'none';
                if (interfacesTab) interfacesTab.style.display = 'none';
                if (dhcpTab) dhcpTab.style.display = 'none';
                if (techSupportTab) techSupportTab.style.display = 'none';
                if (rebootTab) rebootTab.style.display = 'none';

                // Show selected tab
                if (targetTab === 'software-updates') {
                    if (softwareUpdatesTab) softwareUpdatesTab.style.display = 'block';
                    if (typeof loadSoftwareUpdates === 'function') loadSoftwareUpdates();
                } else if (targetTab === 'interfaces') {
                    if (interfacesTab) interfacesTab.style.display = 'block';
                    if (typeof loadInterfaces === 'function') loadInterfaces();
                } else if (targetTab === 'dhcp') {
                    if (dhcpTab) dhcpTab.style.display = 'block';
                    if (typeof loadDhcpLeases === 'function') loadDhcpLeases();
                } else if (targetTab === 'tech-support') {
                    if (techSupportTab) techSupportTab.style.display = 'block';
                } else if (targetTab === 'reboot') {
                    if (rebootTab) rebootTab.style.display = 'block';
                }
            });
        });
    }
}

/**
 * Initialize Software Updates sub-tab switching (PAN-OS / Components)
 */
function initSoftwareSubTabSwitching() {
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
                    if (panosSubTab) panosSubTab.style.display = 'block';
                    if (componentsSubTab) componentsSubTab.style.display = 'none';
                } else if (targetTab === 'components') {
                    if (panosSubTab) panosSubTab.style.display = 'none';
                    if (componentsSubTab) componentsSubTab.style.display = 'block';
                }
            });
        });
    }
}

// ============================================================================
// Export functions to global scope
// ============================================================================

window.getCurrentVisiblePage = getCurrentVisiblePage;
window.setCurrentVisiblePage = setCurrentVisiblePage;
window.initPageNavigation = initPageNavigation;
window.initLogsTabSwitching = initLogsTabSwitching;
window.initDeviceInfoTabSwitching = initDeviceInfoTabSwitching;
window.initSoftwareSubTabSwitching = initSoftwareSubTabSwitching;

console.log('[APP-NAVIGATION.JS] ===== MODULE LOADING COMPLETE =====');
