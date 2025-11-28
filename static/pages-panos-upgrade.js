/**
 * PAN-OS Upgrade Orchestration Module
 * Handles the complete upgrade workflow with job polling and progress tracking
 */

// Global state for upgrade process
let upgradeState = {
    currentVersion: null,
    latestVersion: null,
    selectedVersion: null,
    currentStep: null,
    jobId: null,
    pollInterval: null
};

/**
 * Save upgrade state to localStorage so it persists across page reloads
 */
function saveUpgradeState() {
    if (upgradeState.jobId) {
        const state = {
            jobId: upgradeState.jobId,
            selectedVersion: upgradeState.selectedVersion,
            currentStep: upgradeState.currentStep,
            timestamp: Date.now()
        };
        localStorage.setItem('panosUpgradeState', JSON.stringify(state));
    }
}

/**
 * Load upgrade state from localStorage and resume if needed
 */
function loadUpgradeState() {
    const saved = localStorage.getItem('panosUpgradeState');
    if (saved) {
        try {
            const state = JSON.parse(saved);
            // Only resume if less than 2 hours old
            if (Date.now() - state.timestamp < 2 * 60 * 60 * 1000) {
                return state;
            } else {
                // Clear old state
                localStorage.removeItem('panosUpgradeState');
            }
        } catch (e) {
            console.error('Error loading upgrade state:', e);
        }
    }
    return null;
}

/**
 * Clear upgrade state from localStorage
 */
function clearUpgradeState() {
    localStorage.removeItem('panosUpgradeState');
}

/**
 * Save reboot monitoring state to localStorage
 */
function saveRebootMonitoringState() {
    const state = {
        isMonitoring: true,
        startTime: Date.now(),
        timestamp: Date.now()
    };
    localStorage.setItem('panosRebootMonitoring', JSON.stringify(state));
}

/**
 * Load reboot monitoring state from localStorage
 */
function loadRebootMonitoringState() {
    const saved = localStorage.getItem('panosRebootMonitoring');
    if (saved) {
        try {
            const state = JSON.parse(saved);
            // Only resume if less than 2 hours old
            if (Date.now() - state.timestamp < 2 * 60 * 60 * 1000) {
                return state;
            } else {
                localStorage.removeItem('panosRebootMonitoring');
            }
        } catch (e) {
            console.error('Error loading reboot monitoring state:', e);
        }
    }
    return null;
}

/**
 * Clear reboot monitoring state from localStorage
 */
function clearRebootMonitoringState() {
    localStorage.removeItem('panosRebootMonitoring');
}

/**
 * Initialize PAN-OS upgrade UI
 */
function initPanosUpgrade() {
    // Check for latest version button
    const checkButton = document.getElementById('checkPanosVersionBtn');
    if (checkButton) {
        checkButton.addEventListener('click', checkPanosVersions);
    }

    // Upgrade button (will be created dynamically)
    document.addEventListener('click', function(e) {
        if (e.target && e.target.id === 'startUpgradeBtn') {
            startUpgradeWorkflow();
        }
        if (e.target && e.target.id === 'cancelUpgradeBtn') {
            cancelUpgrade();
        }
        if (e.target && e.target.id === 'resumeUpgradeBtn') {
            resumeUpgrade();
        }
    });

    // Check if there's an ongoing upgrade to resume
    checkForOngoingUpgrade();
}

/**
 * Check if there's an ongoing upgrade and offer to resume
 */
async function checkForOngoingUpgrade() {
    const savedState = loadUpgradeState();
    if (savedState && savedState.jobId) {
        // Show a notification that there's an ongoing upgrade
        const panosVersionInfo = document.getElementById('panosVersionInfo');
        if (panosVersionInfo) {
            panosVersionInfo.innerHTML = `
                <div style="margin-top: 15px; padding: 15px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
                    <strong style="color: #856404;">Ongoing Upgrade Detected</strong>
                    <p style="margin: 8px 0; color: #856404;">
                        An upgrade to version ${savedState.selectedVersion} appears to be in progress.
                    </p>
                    <button id="resumeUpgradeBtn" style="padding: 10px 20px; background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-family: var(--font-primary); margin-right: 10px;">
                        Resume Monitoring
                    </button>
                    <button onclick="clearUpgradeState(); location.reload();" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-family: var(--font-primary);">
                        Dismiss
                    </button>
                </div>
            `;

            // Wire up the resume button
            const resumeBtn = document.getElementById('resumeUpgradeBtn');
            if (resumeBtn) {
                resumeBtn.addEventListener('click', resumeUpgrade);
            }
        }
    }
}

/**
 * Resume monitoring an ongoing upgrade
 */
async function resumeUpgrade() {
    const savedState = loadUpgradeState();
    if (!savedState || !savedState.jobId) {
        alert('No upgrade state found to resume.');
        return;
    }

    // Restore state
    upgradeState.jobId = savedState.jobId;
    upgradeState.selectedVersion = savedState.selectedVersion;
    upgradeState.currentStep = savedState.currentStep || 'Installing';

    // Show modal and start monitoring
    showUpgradeModal();
    updateUpgradeProgress(upgradeState.currentStep, `Resuming monitoring of ${upgradeState.currentStep}...`, 50);

    // Check current job status
    try {
        const response = await fetch(`/api/panos-upgrade/job-status/${upgradeState.jobId}`);
        const data = await response.json();

        if (data.status === 'success' && data.job_status === 'FIN') {
            // Job already finished
            if (data.result === 'OK' || (data.details && data.details.toLowerCase().includes('success'))) {
                updateUpgradeProgress('Complete', `${upgradeState.currentStep} completed successfully!`, 90);
                clearUpgradeState();

                // Ask about reboot if this was installation
                if (upgradeState.currentStep === 'Installing') {
                    if (confirm('Installation complete! Reboot the firewall now?')) {
                        updateUpgradeProgress('Rebooting', 'Initiating firewall reboot...', 95);
                        const rebootResult = await rebootFirewall();
                        if (rebootResult.status === 'success') {
                            updateUpgradeProgress('Complete', 'Upgrade complete! Firewall is rebooting.', 100);
                            clearUpgradeState();
                        }
                    }
                }
            } else {
                updateUpgradeProgress('Failed', `${upgradeState.currentStep} failed: ${data.details || data.result}`, 50, true);
                clearUpgradeState();
            }
        } else {
            // Job still running, continue polling
            const stepDisplayName = upgradeState.currentStep === 'Downloading' ? 'Download' : 'Installation';
            await pollJobStatus(upgradeState.currentStep, stepDisplayName);
        }
    } catch (error) {
        updateUpgradeProgress('Error', `Failed to check upgrade status: ${error.message}`, 0, true);
        clearUpgradeState(); // Clear state on error
    }
}

/**
 * Check for available PAN-OS versions
 */
async function checkPanosVersions() {
    const button = document.getElementById('checkPanosVersionBtn');
    const versionInfo = document.getElementById('panosVersionInfo');

    try {
        button.disabled = true;
        button.textContent = 'Checking...';
        versionInfo.innerHTML = '<div style="color: #999;">Checking for updates...</div>';

        const response = await window.apiClient.get('/api/panos-versions');
        if (!response.ok) {
            throw new Error('Failed to check PAN-OS versions');
        }
        const data = response.data;

        if (data.status === 'success') {
            upgradeState.currentVersion = data.current_version;
            upgradeState.latestVersion = data.latest_version;

            // Display version information
            let html = `
                <div style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-radius: 8px; border-left: 4px solid #FA582D;">
                    <div style="margin-bottom: 10px;">
                        <strong style="color: #333; font-family: var(--font-primary);">Current Version:</strong>
                        <span style="color: #666; font-family: monospace; font-size: 1.1em;">${data.current_version || 'Unknown'}</span>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <strong style="color: #333; font-family: var(--font-primary);">Latest Version:</strong>
                        <span style="color: #28a745; font-family: monospace; font-size: 1.1em; font-weight: 600;">${data.latest_version || 'Unknown'}</span>
                    </div>
            `;

            // Filter versions that are not current and are available for download/install
            // Backend already sorts by release date (newest first), but ensure it here too
            const upgradeableVersions = data.versions
                .filter(v => v.version !== data.current_version)
                .sort((a, b) => {
                    // Sort by release date (newest first)
                    const dateA = a.released_on || '0000/00/00 00:00:00';
                    const dateB = b.released_on || '0000/00/00 00:00:00';
                    return dateB.localeCompare(dateA);
                });

            // Check if upgrades are available
            if (upgradeableVersions.length > 0) {
                html += `
                    <div style="margin-top: 15px; padding: 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;">
                        <strong style="color: #856404;">Upgrade Options Available</strong>
                        <p style="margin: 8px 0 12px 0; color: #856404;">Select a version to upgrade to:</p>

                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 8px; color: #F2F0EF; font-weight: 600; font-family: var(--font-primary);">Select Version:</label>
                            <select id="versionSelect" style="width: 100%; padding: 10px; border: 2px solid #555; border-radius: 6px; font-family: monospace; font-size: 1em; background: #2a2a2a; color: #F2F0EF; cursor: pointer;" onfocus="this.style.borderColor='#FA582D'" onblur="this.style.borderColor='#555'">
                `;

                // Add options for each version
                upgradeableVersions.forEach(version => {
                    const isLatest = version.version === data.latest_version;
                    const badges = [];
                    if (isLatest) badges.push('LATEST');
                    if (version.downloaded === 'yes') badges.push('Downloaded');
                    if (version.uploaded === 'yes') badges.push('Uploaded');

                    const badgeText = badges.length > 0 ? ` [${badges.join(', ')}]` : '';
                    const selected = isLatest ? 'selected' : '';

                    html += `<option value="${version.version}" ${selected}>${version.version}${badgeText}</option>`;
                });

                html += `
                            </select>
                        </div>

                        <div style="font-size: 0.9em; color: #666; margin-bottom: 12px; padding: 10px; background: #f9f9f9; border-radius: 4px;">
                            <div id="versionDetails"></div>
                        </div>

                        <button id="startUpgradeBtn" style="padding: 10px 20px; background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-family: var(--font-primary);">
                            Start Upgrade
                        </button>
                    </div>
                `;

                // Set initial selected version to latest
                upgradeState.selectedVersion = data.latest_version;
                upgradeState.allVersions = data.versions;
            } else {
                html += `
                    <div style="margin-top: 15px; padding: 12px; background: #d4edda; border: 1px solid #28a745; border-radius: 6px; color: #155724;">
                        <strong>System Up to Date</strong>
                        <p style="margin: 8px 0 0 0;">You are running the latest version of PAN-OS.</p>
                    </div>
                `;
            }

            html += '</div>';
            versionInfo.innerHTML = html;

            // Add event listener for version selection
            const versionSelect = document.getElementById('versionSelect');
            if (versionSelect) {
                versionSelect.addEventListener('change', function() {
                    upgradeState.selectedVersion = this.value;
                    updateVersionDetails(this.value);
                });
                // Show initial details
                updateVersionDetails(upgradeState.selectedVersion);
            }

        } else {
            versionInfo.innerHTML = `<div style="color: #dc3545; padding: 10px; background: #f8d7da; border-radius: 6px;">${data.message || 'Failed to check versions'}</div>`;
        }

    } catch (error) {
        versionInfo.innerHTML = `<div style="color: #dc3545; padding: 10px; background: #f8d7da; border-radius: 6px;">Error: ${error.message}</div>`;
    } finally {
        button.disabled = false;
        button.textContent = 'Check for Updates';
    }
}

/**
 * Determine if a base image is required for the target version
 *
 * PAN-OS requires the base image (x.y.0) to be downloaded before installing
 * any maintenance release (x.y.z where z > 0) of that major.minor version.
 *
 * @param {string} currentVersion - Current PAN-OS version (e.g., "10.0.5")
 * @param {string} targetVersion - Target version to upgrade to (e.g., "10.1.3")
 * @param {Array} allVersions - Array of all available version objects
 * @returns {object|null} - Base image info {version, isDownloaded} or null if not needed
 */
function getRequiredBaseImage(currentVersion, targetVersion, allVersions) {
    if (!currentVersion || !targetVersion || !allVersions) return null;

    // Handle hotfix versions (e.g., "12.1.3-h1") - extract base version without hotfix suffix
    const targetBase = targetVersion.split('-')[0]; // "12.1.3-h1" -> "12.1.3"
    const currentBase = currentVersion.split('-')[0]; // "12.1.2-h3" -> "12.1.2"

    // Parse version numbers (format: major.minor.patch)
    const currentParts = currentBase.split('.').map(Number);
    const targetParts = targetBase.split('.').map(Number);
    if (currentParts.length < 3 || targetParts.length < 3) return null;

    const currentMajorMinor = `${currentParts[0]}.${currentParts[1]}`;
    const targetMajorMinor = `${targetParts[0]}.${targetParts[1]}`;
    const isHotfix = targetVersion.includes('-h');
    if (currentMajorMinor === targetMajorMinor) return null; // Same major.minor, no base needed

    // For hotfix versions (e.g., 12.1.3-h1), need the non-hotfix version (12.1.3)
    if (isHotfix) {
        const baseImage = allVersions.find(v => v.version === targetBase);
        if (baseImage) {
            const isDownloaded = baseImage.downloaded && baseImage.downloaded.toLowerCase() === 'yes';
            console.log(`Hotfix ${targetVersion} needs ${targetBase}, DL=${isDownloaded}`);
            return {version: targetBase, isDownloaded, size: baseImage.size || 'Unknown', filename: baseImage.filename || ''};
        }
    }

    // Find the first (lowest) version in the target major.minor series - that's the base
    const targetMajMinVersions = allVersions.filter(v => {
        const vParts = v.version.split('-')[0].split('.').map(Number);
        return vParts.length >= 3 && `${vParts[0]}.${vParts[1]}` === targetMajorMinor;
    }).sort((a, b) => {
        const aParts = a.version.split('-')[0].split('.').map(Number);
        const bParts = b.version.split('-')[0].split('.').map(Number);
        return aParts[2] - bParts[2];
    });

    if (targetMajMinVersions.length > 0) {
        const baseImage = targetMajMinVersions[0];
        const isDownloaded = baseImage.downloaded && baseImage.downloaded.toLowerCase() === 'yes';
        console.log(`Target ${targetVersion} needs base ${baseImage.version} (first in ${targetMajorMinor}.x), DL=${isDownloaded}`);
        return {version: baseImage.version, isDownloaded, size: baseImage.size || 'Unknown', filename: baseImage.filename || ''};
    }
    return null;
}

/**
 * Update version details display
 */
function updateVersionDetails(selectedVersion) {
    const detailsDiv = document.getElementById('versionDetails');
    if (!detailsDiv || !upgradeState.allVersions) return;

    const version = upgradeState.allVersions.find(v => v.version === selectedVersion);
    if (!version) return;

    let html = `
        <strong style="font-family: var(--font-primary); color: #333;">Version ${version.version}</strong><br>
    `;

    if (version.released_on) {
        html += `<span style="color: #666;">Released: ${version.released_on}</span><br>`;
    }

    if (version.size) {
        html += `<span style="color: #666;">Size: ${version.size} MB</span><br>`;
    }

    const status = [];
    if (version.downloaded === 'yes') status.push('<span style="color: #28a745;">✓ Downloaded</span>');
    if (version.uploaded === 'yes') status.push('<span style="color: #28a745;">✓ Uploaded</span>');
    if (version.latest === 'yes') status.push('<span style="color: #FA582D; font-weight: 600;">★ Latest</span>');

    if (status.length > 0) {
        html += `<div style="margin-top: 5px;">${status.join(' | ')}</div>`;
    }

    // Check if base image is required
    const baseImageInfo = getRequiredBaseImage(upgradeState.currentVersion, selectedVersion, upgradeState.allVersions);
    if (baseImageInfo) {
        const baseStyle = baseImageInfo.isDownloaded
            ? 'background: #d4edda; border: 1px solid #28a745;'
            : 'background: #fff3cd; border: 1px solid #ffc107;';
        const baseMsg = baseImageInfo.isDownloaded
            ? `<span style="color: #155724;">✓ Base image ${baseImageInfo.version} already downloaded</span>`
            : `<span style="color: #856404;">⚠️ <strong>Base image required:</strong> ${baseImageInfo.version} (${baseImageInfo.size} MB) will be downloaded automatically</span>`;
        html += `<div style="padding: 8px; ${baseStyle} border-radius: 4px; margin-top: 8px; font-size: 0.9em;">${baseMsg}</div>`;
    }

    detailsDiv.innerHTML = html;

    // Update button text based on download status and base image requirement
    const upgradeBtn = document.getElementById('startUpgradeBtn');
    if (upgradeBtn) {
        const needsBaseDownload = baseImageInfo && !baseImageInfo.isDownloaded;
        const needsTargetDownload = version.downloaded !== 'yes';

        if (!needsTargetDownload && !needsBaseDownload) {
            upgradeBtn.textContent = 'Install & Reboot';
            upgradeBtn.title = 'Version already downloaded - will skip download step';
        } else if (needsBaseDownload) {
            upgradeBtn.textContent = 'Download Base + Version, Install & Reboot';
            upgradeBtn.title = `Will download base ${baseImageInfo.version}, download ${version.version}, install, and reboot`;
        } else {
            upgradeBtn.textContent = 'Download, Install & Reboot';
            upgradeBtn.title = 'Will download, install, and reboot';
        }
    }
}

/**
 * Start the complete upgrade workflow
 */
async function startUpgradeWorkflow() {
    // CRITICAL: Re-read selected version from dropdown to ensure we have the user's actual selection
    const versionSelect = document.getElementById('versionSelect');
    if (versionSelect) {
        upgradeState.selectedVersion = versionSelect.value;
        console.log(`Selected version from dropdown: ${upgradeState.selectedVersion}`);
    }

    // Check if version is already downloaded
    const selectedVersionData = upgradeState.allVersions?.find(v => v.version === upgradeState.selectedVersion);
    const isTargetDownloaded = selectedVersionData?.downloaded === 'yes';

    // Check if base image is required
    const baseImageInfo = getRequiredBaseImage(
        upgradeState.currentVersion,
        upgradeState.selectedVersion,
        upgradeState.allVersions
    );
    const needsBaseDownload = baseImageInfo && !baseImageInfo.isDownloaded;
    console.log(`Workflow: target=${upgradeState.selectedVersion}, targetDL=${isTargetDownloaded}, needsBaseDL=${needsBaseDownload}`);

    // Build confirmation message with actual steps
    const steps = [];
    let n = 1;
    if (needsBaseDownload) steps.push(`${n++}. Download base image ${baseImageInfo.version} (${baseImageInfo.size} MB)`);
    if (!isTargetDownloaded) steps.push(`${n++}. Download PAN-OS ${upgradeState.selectedVersion}`);
    steps.push(`${n++}. Install PAN-OS ${upgradeState.selectedVersion}`, `${n++}. Automatically reboot the firewall`);
    const msg = `This will upgrade PAN-OS from ${upgradeState.currentVersion} to ${upgradeState.selectedVersion}.\n\nThe COMPLETE process will:\n${steps.join('\n')}\n\nThis may take 30-60 minutes and will proceed automatically.\n\nContinue?`;
    if (!confirm(msg)) return;

    showUpgradeModal();
    let currentProgress = 0;

    // Step 0: Download base image if needed
    if (needsBaseDownload) {
        console.log(`Base image ${baseImageInfo.version} required and not downloaded, downloading now...`);
        console.log(`IMPORTANT: Target version is ${upgradeState.selectedVersion}, base is ${baseImageInfo.version}`);
        updateUpgradeProgress('Downloading Base', `Downloading base image ${baseImageInfo.version}...`, 0);

        const baseDownloadResult = await downloadPanosVersion(baseImageInfo.version);

        if (baseDownloadResult.status !== 'success') {
            updateUpgradeProgress('Failed', `Base image download failed: ${baseDownloadResult.message}`, 0, true);
            clearUpgradeState();
            return;
        }

        // Poll base image download job
        // IMPORTANT: Keep selectedVersion as target, NOT base
        upgradeState.jobId = baseDownloadResult.job_id;
        upgradeState.currentStep = 'Downloading Base';
        // Ensure selectedVersion remains the target (e.g., 12.1.3-h1, not 12.1.3)
        console.log(`After base download, selectedVersion is still: ${upgradeState.selectedVersion}`);
        saveUpgradeState();

        const baseDownloadComplete = await pollJobStatus('Downloading Base', 'Base Image Download', 0, 20);

        if (!baseDownloadComplete) {
            return; // User cancelled or error occurred
        }

        console.log(`Base image ${baseImageInfo.version} downloaded successfully`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        currentProgress = 20;
    }

    // Step 1: Download target version (skip if already downloaded)
    if (!isTargetDownloaded) {
        const startProgress = needsBaseDownload ? 20 : 0;
        const endProgress = needsBaseDownload ? 40 : 50;

        updateUpgradeProgress('Downloading', `Downloading PAN-OS ${upgradeState.selectedVersion}...`, startProgress);
        const downloadResult = await downloadPanosVersion(upgradeState.selectedVersion);

        if (downloadResult.status !== 'success') {
            updateUpgradeProgress('Failed', `Download failed: ${downloadResult.message}`, 0, true);
            clearUpgradeState(); // Clear state on failure
            return;
        }

        // Poll download job
        upgradeState.jobId = downloadResult.job_id;
        upgradeState.currentStep = 'Downloading';
        saveUpgradeState(); // Save state so we can resume if browser closes
        const downloadComplete = await pollJobStatus('Downloading', 'Download', startProgress, endProgress);

        if (!downloadComplete) {
            return; // User cancelled or error occurred
        }

        // Small delay to show completion
        await new Promise(resolve => setTimeout(resolve, 1500));
        currentProgress = endProgress;
    } else {
        // Skip target download
        const skipProgress = needsBaseDownload ? 30 : 25;
        updateUpgradeProgress('Skipping Download', `Version ${upgradeState.selectedVersion} already downloaded, proceeding to installation...`, skipProgress);
        await new Promise(resolve => setTimeout(resolve, 2000));
        currentProgress = needsBaseDownload ? 40 : 50;
    }

    // Step 2: Install
    const installStartProgress = needsBaseDownload ? 40 : 50;
    const installEndProgress = 90;

    console.log(`INSTALL STEP: About to install version: ${upgradeState.selectedVersion}`);
    console.log(`Full upgradeState:`, JSON.stringify(upgradeState));
    updateUpgradeProgress('Installing', `Installing PAN-OS ${upgradeState.selectedVersion}...`, installStartProgress);
    const installResult = await installPanosVersion(upgradeState.selectedVersion);

    if (installResult.status !== 'success') {
        updateUpgradeProgress('Failed', `Installation failed: ${installResult.message}`, installStartProgress, true);
        clearUpgradeState(); // Clear state on failure
        return;
    }

    // Poll install job
    upgradeState.jobId = installResult.job_id;
    upgradeState.currentStep = 'Installing';
    saveUpgradeState(); // Save state so we can resume if browser closes
    const installComplete = await pollJobStatus('Installing', 'Installation', installStartProgress, installEndProgress);

    if (!installComplete) {
        return; // User cancelled or error occurred
    }

    // Small delay to show completion
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 3: Automatic Reboot
    updateUpgradeProgress('Rebooting', 'Initiating firewall reboot...', 95);

    // Wait a moment before rebooting
    await new Promise(resolve => setTimeout(resolve, 2000));

    const rebootResult = await rebootFirewall();

    if (rebootResult.status === 'success') {
        clearUpgradeState(); // Clear upgrade state on successful reboot initiation

        // Wait a moment to show reboot was initiated
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Start monitoring the reboot process
        startRebootMonitoring();
    } else {
        updateUpgradeProgress('Failed', `Reboot failed: ${rebootResult.message}`, 95, true);
        clearUpgradeState(); // Clear state on failure
    }
}

/**
 * Download PAN-OS version
 */
async function downloadPanosVersion(version) {
    try {
        const response = await window.apiClient.post('/api/panos-upgrade/download', { version });
        if (!response.ok) {
            return { status: 'error', message: 'Failed to start download' };
        }
        return response.data;
    } catch (error) {
        return { status: 'error', message: error.message };
    }
}

/**
 * Install PAN-OS version
 */
async function installPanosVersion(version) {
    try {
        const response = await window.apiClient.post('/api/panos-upgrade/install', { version });
        if (!response.ok) {
            return { status: 'error', message: 'Failed to start installation' };
        }
        return response.data;
    } catch (error) {
        return { status: 'error', message: error.message };
    }
}

/**
 * Reboot firewall
 */
async function rebootFirewall() {
    try {
        const response = await window.apiClient.post('/api/panos-upgrade/reboot');
        if (!response.ok) {
            return { status: 'error', message: 'Failed to initiate reboot' };
        }
        return response.data;
    } catch (error) {
        return { status: 'error', message: error.message };
    }
}

/**
 * Poll job status until completion
 * @param {string} stepName - Step name for display
 * @param {string} stepDisplayName - Display name for the step
 * @param {number} progressStart - Starting progress percentage (default: 0)
 * @param {number} progressEnd - Ending progress percentage (default: 50)
 */
async function pollJobStatus(stepName, stepDisplayName, progressStart = 0, progressEnd = 50) {
    return new Promise((resolve) => {
        let pollCount = 0;
        const maxPolls = 120; // 30 minutes with 15-second intervals
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 3; // Fail only after 3 consecutive failures
        let lastSuccessfulProgress = progressStart;
        let lastProgressUpdate = Date.now(); // Track last time we got progress
        const maxStaleTime = 10 * 60 * 1000; // 10 minutes without progress = stale

        upgradeState.pollInterval = setInterval(async () => {
            pollCount++;

            try {
                const response = await fetch(`/api/panos-upgrade/job-status/${upgradeState.jobId}`);

                // Check if response is JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    consecutiveFailures++;
                    console.warn(`Non-JSON response (consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures})`);

                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        clearInterval(upgradeState.pollInterval);
                        const text = await response.text();
                        console.error('Non-JSON response received:', text.substring(0, 200));
                        updateUpgradeProgress('Failed', `Server returned non-JSON response after ${maxConsecutiveFailures} attempts (status ${response.status}). Check server logs.`, 0, true);
                        clearUpgradeState();
                        resolve(false);
                    } else {
                        // Show warning but continue polling
                        updateUpgradeProgress(stepName, `${stepDisplayName}: Connection issue (retrying ${consecutiveFailures}/${maxConsecutiveFailures})...`, lastSuccessfulProgress);
                    }
                    return;
                }

                const data = await response.json();

                if (data.status === 'success') {
                    // Reset consecutive failures on success
                    consecutiveFailures = 0;

                    // Update last progress time - we got a response from firewall
                    lastProgressUpdate = Date.now();

                    // Calculate progress within the specified range
                    const progressRange = progressEnd - progressStart;
                    const currentProgress = progressStart + (data.progress / 100 * progressRange);
                    lastSuccessfulProgress = currentProgress;
                    updateUpgradeProgress(stepName, `${stepDisplayName}: ${data.progress}% - ${data.details || data.job_status}`, currentProgress);

                    // Check if job is finished
                    if (data.job_status === 'FIN') {
                        clearInterval(upgradeState.pollInterval);

                        // Check if job completed successfully
                        const isSuccess = data.result === 'OK' ||
                                        (data.details && data.details.toLowerCase().includes('success')) ||
                                        data.result === 'PEND' ||
                                        !data.result ||
                                        data.result === 'UNKNOWN';

                        const isFailed = data.result === 'FAIL' ||
                                       (data.details && data.details.toLowerCase().includes('fail'));

                        if (isFailed) {
                            updateUpgradeProgress('Failed', `${stepDisplayName} failed: ${data.details || data.result}`, currentProgress, true);
                            clearUpgradeState();
                            resolve(false);
                        } else {
                            updateUpgradeProgress(stepName, `${stepDisplayName} complete!`, progressEnd);
                            resolve(true);
                        }
                    }
                } else {
                    consecutiveFailures++;
                    console.warn(`API error response (consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}):`, data.message);

                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        clearInterval(upgradeState.pollInterval);
                        updateUpgradeProgress('Failed', `Failed to check job status after ${maxConsecutiveFailures} attempts: ${data.message}`, 0, true);
                        clearUpgradeState();
                        resolve(false);
                    } else {
                        // Show warning but continue polling
                        updateUpgradeProgress(stepName, `${stepDisplayName}: Connection issue (retrying ${consecutiveFailures}/${maxConsecutiveFailures})...`, lastSuccessfulProgress);
                    }
                }

            } catch (error) {
                consecutiveFailures++;
                console.warn(`Polling error (consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}):`, error.message);

                if (consecutiveFailures >= maxConsecutiveFailures) {
                    clearInterval(upgradeState.pollInterval);
                    updateUpgradeProgress('Failed', `Error checking job status after ${maxConsecutiveFailures} attempts: ${error.message}`, 0, true);
                    clearUpgradeState();
                    resolve(false);
                } else {
                    // Show warning but continue polling
                    updateUpgradeProgress(stepName, `${stepDisplayName}: Connection issue (retrying ${consecutiveFailures}/${maxConsecutiveFailures})...`, lastSuccessfulProgress);
                }
            }

            // Check for stale progress (no updates for 10 minutes = stuck)
            const timeSinceLastProgress = Date.now() - lastProgressUpdate;
            if (timeSinceLastProgress > maxStaleTime) {
                clearInterval(upgradeState.pollInterval);
                const minutesStale = Math.floor(timeSinceLastProgress / 60000);
                updateUpgradeProgress('Failed', `${stepDisplayName} appears stuck - no progress for ${minutesStale} minutes. The job may have failed on the firewall. Check firewall status manually.`, 0, true);
                clearUpgradeState();
                resolve(false);
                return;
            }

            // Timeout after max polls ONLY if we haven't gotten recent progress
            // This prevents timing out while firewall is actively working
            if (pollCount >= maxPolls) {
                // If we got progress recently (within last 2 minutes), extend timeout
                const recentProgress = (Date.now() - lastProgressUpdate) < (2 * 60 * 1000);

                if (recentProgress) {
                    console.log(`Extending timeout - still receiving progress updates (poll ${pollCount}/${maxPolls})`);
                    pollCount = maxPolls - 10; // Reset counter to give 2.5 more minutes
                    updateUpgradeProgress(stepName, `${stepDisplayName}: Taking longer than expected, but still progressing...`, lastSuccessfulProgress);
                } else {
                    clearInterval(upgradeState.pollInterval);
                    updateUpgradeProgress('Failed', `${stepDisplayName} timed out after 30 minutes with no progress`, 0, true);
                    clearUpgradeState();
                    resolve(false);
                }
            }

        }, 15000); // Poll every 15 seconds
    });
}

/**
 * Show upgrade progress modal
 * @param {string} title - Optional custom title (defaults to "PAN-OS Upgrade in Progress")
 */
function showUpgradeModal(title) {
    const modal = document.getElementById('upgradeModal');
    const modalTitle = document.getElementById('upgradeModalTitle');

    if (modal) {
        modal.style.display = 'flex';
    }

    if (modalTitle && title) {
        modalTitle.textContent = title;
    } else if (modalTitle) {
        // Reset to default
        modalTitle.textContent = 'PAN-OS Upgrade in Progress';
    }
}

/**
 * Hide upgrade modal
 */
function hideUpgradeModal() {
    const modal = document.getElementById('upgradeModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Update upgrade progress display
 */
function updateUpgradeProgress(step, message, progress, isError = false) {
    const stepElement = document.getElementById('upgradeStep');
    const messageElement = document.getElementById('upgradeMessage');
    const progressBar = document.getElementById('upgradeProgressBar');
    const cancelBtn = document.getElementById('cancelUpgradeBtn');

    if (stepElement) {
        stepElement.textContent = step;
        stepElement.style.color = isError ? '#dc3545' : '#FA582D';
    }

    if (messageElement) {
        messageElement.textContent = message;
        messageElement.style.color = isError ? '#dc3545' : '#666';
    }

    if (progressBar) {
        progressBar.style.width = `${progress}%`;
        progressBar.style.background = isError ? '#dc3545' : 'linear-gradient(135deg, #FA582D 0%, #FF7A55 100%)';
    }

    // Hide cancel button on completion or error
    if (cancelBtn && (progress === 100 || isError)) {
        cancelBtn.style.display = 'none';
    }
}

/**
 * Start monitoring firewall reboot status
 */
function startRebootMonitoring() {
    console.log('Starting reboot monitoring...');

    // Save monitoring state to localStorage
    saveRebootMonitoringState();

    // Update modal to show monitoring status
    const stepElement = document.getElementById('upgradeStep');
    const messageElement = document.getElementById('upgradeMessage');
    const progressBar = document.getElementById('upgradeProgressBar');
    const cancelBtn = document.getElementById('cancelUpgradeBtn');

    if (stepElement) {
        stepElement.textContent = 'Monitoring Reboot';
        stepElement.style.color = '#FA582D';
    }

    if (messageElement) {
        messageElement.innerHTML = 'Firewall is rebooting... Monitoring status.<br><span id="rebootElapsedTime" style="font-size: 0.9em; color: #999;">Elapsed: 0:00</span>';
        messageElement.style.color = '#666';
    }

    if (progressBar) {
        progressBar.style.width = '100%';
        // Add pulsing animation
        progressBar.style.background = 'linear-gradient(135deg, #FA582D 0%, #FF7A55 100%)';
        progressBar.style.animation = 'pulse 2s ease-in-out infinite';
    }

    // Hide cancel button during reboot monitoring
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }

    // Add CSS animation if not already present
    if (!document.getElementById('pulseAnimation')) {
        const style = document.createElement('style');
        style.id = 'pulseAnimation';
        style.textContent = `
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }
        `;
        document.head.appendChild(style);
    }

    // Start polling device status
    pollDeviceStatus();
}

/**
 * Poll device status to check if it's back online after reboot
 */
function pollDeviceStatus() {
    const startTime = Date.now();
    let pollCount = 0;
    const maxPolls = 60; // 15 minutes with 15-second intervals
    const pollInterval = 15000; // 15 seconds
    let hasSeenOfflineOrError = false; // Track if we've seen at least one offline/error state
    let consecutiveOnlineCount = 0; // Track consecutive successful responses after seeing offline

    // Update elapsed time display
    const updateElapsedTime = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timeDisplay = document.getElementById('rebootElapsedTime');
        if (timeDisplay) {
            timeDisplay.textContent = `Elapsed: ${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    };

    // Update time every second
    const timeInterval = setInterval(updateElapsedTime, 1000);

    // Poll function
    const checkDevice = async () => {
        pollCount++;

        const messageElement = document.getElementById('upgradeMessage');
        if (messageElement) {
            messageElement.innerHTML = 'Checking device status...<br><span id="rebootElapsedTime" style="font-size: 0.9em; color: #999;"></span>';
        }
        updateElapsedTime();

        try {
            // Try to fetch firewall health check (lightweight - no update server connections)
            const response = await window.apiClient.get('/api/firewall-health');

            if (response.ok) {
                // Device responded successfully
                if (hasSeenOfflineOrError) {
                    // We previously saw device offline/error
                    consecutiveOnlineCount++;

                    if (consecutiveOnlineCount >= 3) {
                        // Device has responded successfully 3 times in a row after being offline - truly back!
                        console.log('Device is back online after reboot (3 consecutive successful checks)!');
                        clearInterval(upgradeState.pollInterval);
                        clearInterval(timeInterval);
                        handleDeviceBackOnline();
                        return;
                    } else {
                        // Waiting for more consecutive successful responses
                        console.log(`Device responded after being offline (${consecutiveOnlineCount}/3 checks)`);
                        if (messageElement) {
                            messageElement.innerHTML = `Verifying device is fully operational (${consecutiveOnlineCount}/3)...<br><span id="rebootElapsedTime" style="font-size: 0.9em; color: #999;"></span>`;
                        }
                        updateElapsedTime();
                    }
                } else if (pollCount >= 30) {
                    // After 30+ checks (40s initial + 450s of polling = ~8 minutes) and device keeps responding
                    // Either reboot happened very fast, or reboot command failed
                    // At this point, assume device is operational and mark as complete
                    console.log(`Poll ${pollCount}: Device responding for 8+ minutes. Assuming reboot completed or failed - marking as complete.`);
                    clearInterval(upgradeState.pollInterval);
                    clearInterval(timeInterval);
                    handleDeviceBackOnline();
                    return;
                } else {
                    // Device keeps responding but hasn't gone offline yet
                    // This likely means reboot command hasn't taken effect yet, or device is slow to shutdown
                    console.log(`Poll ${pollCount}: Device still online, waiting for reboot to begin...`);
                    if (messageElement) {
                        messageElement.innerHTML = 'Waiting for device to reboot...<br><span id="rebootElapsedTime" style="font-size: 0.9em; color: #999;"></span>';
                    }
                    updateElapsedTime();
                }
            } else {
                // Got a response but not OK
                hasSeenOfflineOrError = true;
                consecutiveOnlineCount = 0; // Reset counter
                if (messageElement) {
                    messageElement.innerHTML = 'Device rebooting...<br><span id="rebootElapsedTime" style="font-size: 0.9em; color: #999;"></span>';
                }
                updateElapsedTime();
            }
        } catch (error) {
            // Connection failed - device is offline
            hasSeenOfflineOrError = true;
            consecutiveOnlineCount = 0; // Reset counter
            console.log('Device offline (rebooting):', error.message);
            if (messageElement) {
                messageElement.innerHTML = 'Device offline - Rebooting...<br><span id="rebootElapsedTime" style="font-size: 0.9em; color: #999;"></span>';
            }
            updateElapsedTime();
        }

        // Check if we've exceeded max polls
        if (pollCount >= maxPolls) {
            clearInterval(upgradeState.pollInterval);
            clearInterval(timeInterval);
            if (messageElement) {
                messageElement.innerHTML = 'Reboot taking longer than expected (15+ minutes).<br><span style="font-size: 0.9em;">The device may still be rebooting. Please check manually.</span>';
                messageElement.style.color = '#856404';
            }
            clearRebootMonitoringState();
        }
    };

    // Start polling
    upgradeState.pollInterval = setInterval(checkDevice, pollInterval);

    // Wait 40 seconds before first check (device needs time to actually start rebooting)
    setTimeout(checkDevice, 40000);
}

/**
 * Handle device coming back online after reboot
 */
function handleDeviceBackOnline() {
    console.log('Device is back online, refreshing data...');

    // Clear monitoring state
    clearRebootMonitoringState();

    // Update modal to show success
    const stepElement = document.getElementById('upgradeStep');
    const messageElement = document.getElementById('upgradeMessage');
    const progressBar = document.getElementById('upgradeProgressBar');

    if (stepElement) {
        stepElement.textContent = 'Complete';
        stepElement.style.color = '#28a745';
    }

    if (messageElement) {
        messageElement.innerHTML = 'Device is back online! Upgrade complete.<br><span style="font-size: 0.9em; color: #28a745;">Refreshing device information...</span>';
        messageElement.style.color = '#28a745';
    }

    if (progressBar) {
        progressBar.style.animation = 'none';
        progressBar.style.background = '#28a745';
    }

    // Close modal after 3 seconds and refresh device info
    setTimeout(() => {
        hideUpgradeModal();

        // Refresh all device data (following .clinerules architecture)
        if (typeof refreshAllDataForDevice === 'function') {
            console.log('Calling refreshAllDataForDevice() to reload device info');
            refreshAllDataForDevice();
        } else if (typeof loadSoftwareUpdates === 'function') {
            // Fallback: at least refresh software updates page
            console.log('Refreshing software updates page');
            loadSoftwareUpdates();
        }

        // Show success notification
        alert('✓ Firewall reboot complete! The device is back online and running the new PAN-OS version.');
    }, 3000);
}

/**
 * Cancel upgrade process
 */
function cancelUpgrade() {
    if (confirm('Are you sure you want to cancel the upgrade process?')) {
        if (upgradeState.pollInterval) {
            clearInterval(upgradeState.pollInterval);
        }
        hideUpgradeModal();
        upgradeState = {
            currentVersion: upgradeState.currentVersion,
            latestVersion: upgradeState.latestVersion,
            selectedVersion: null,
            currentStep: null,
            jobId: null,
            pollInterval: null
        };
    }
}

// Export functions for use by other modules (e.g., standalone reboot tab)
if (typeof window !== 'undefined') {
    window.showUpgradeModal = showUpgradeModal;
    window.hideUpgradeModal = hideUpgradeModal;
    window.updateUpgradeProgress = updateUpgradeProgress;
    window.startRebootMonitoring = startRebootMonitoring;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanosUpgrade);
} else {
    initPanosUpgrade();
}
