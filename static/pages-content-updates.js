/**
 * Content Update Orchestration Module
 * Handles App & Threat, Antivirus, WildFire content updates
 *
 * User Requirements:
 * - Download and install as combined workflow
 * - Same modal design as PAN-OS upgrades
 * - No reboot required
 *
 * File created per .clinerules to keep other files under size limits
 */

// Global state
let contentUpdateState = {
    currentStep: null,  // 'check', 'download', 'install', 'complete'
    downloadJobId: null,
    installJobId: null,
    pollInterval: null,
    updateInfo: null
};

/**
 * Check for content updates
 * Called when user clicks "Check for Updates" button
 */
async function checkContentUpdates() {
    const btn = document.getElementById('checkContentUpdatesBtn');
    const info = document.getElementById('contentUpdateInfo');

    if (!btn || !info) {
        console.error('Content update UI elements not found');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Checking...';
    info.style.display = 'none';

    try {
        console.log('Checking for content updates...');
        const response = await window.apiClient.get('/api/content-updates/check');
        if (!response.ok) {
            throw new Error('Failed to check for content updates');
        }
        const data = response.data;

        console.log('Content update check response:', data);

        if (data.status === 'success') {
            contentUpdateState.updateInfo = data;
            displayContentUpdateStatus(data);
        } else {
            info.innerHTML = `<p style="color: #dc3545; margin-top: 10px;">❌ Error: ${data.message}</p>`;
            info.style.display = 'block';
        }
    } catch (error) {
        console.error('Error checking content updates:', error);
        info.innerHTML = `<p style="color: #dc3545; margin-top: 10px;">❌ Error: ${error.message}</p>`;
        info.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check for Updates';
    }
}

/**
 * Display content update status
 */
function displayContentUpdateStatus(data) {
    const info = document.getElementById('contentUpdateInfo');

    if (data.needs_update) {
        const isDownloaded = data.downloaded && data.downloaded.toLowerCase() === 'yes';
        const buttonText = isDownloaded ? 'Install Update' : 'Download & Install Update';
        const buttonTitle = isDownloaded ? 'Version already downloaded - will skip download step' : 'Will download and install the update';

        let statusHtml = '';
        if (isDownloaded) {
            statusHtml = `
                <div style="padding: 8px; background: #d4edda; border: 1px solid #28a745; border-radius: 4px; margin-bottom: 12px; font-size: 0.9em;">
                    <span style="color: #155724;">Version ${data.latest_version} already downloaded</span>
                </div>
            `;
        }

        info.innerHTML = `
            <div style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-radius: 8px; border-left: 4px solid #FA582D;">
                <div style="margin-bottom: 10px;">
                    <strong style="color: #333; font-family: var(--font-primary);">Current Version:</strong>
                    <span style="color: #666; font-family: monospace; font-size: 1.1em;">${data.current_version}</span>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong style="color: #333; font-family: var(--font-primary);">Latest Version:</strong>
                    <span style="color: #28a745; font-family: monospace; font-size: 1.1em; font-weight: 600;">${data.latest_version}</span>
                </div>
                <div style="padding: 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;">
                    <strong style="color: #856404;">Content Update Available</strong>
                    <p style="margin: 8px 0 0 0; color: #856404;">A new content update is available for Application & Threat signatures.</p>
                    ${statusHtml}
                    <button onclick="startContentUpdate()" title="${buttonTitle}" style="padding: 10px 20px; background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-family: var(--font-primary); box-shadow: 0 2px 4px rgba(250, 88, 45, 0.3);">
                        ${buttonText}
                    </button>
                </div>
            </div>
        `;
    } else {
        info.innerHTML = `
            <div style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-radius: 8px; border-left: 4px solid #FA582D;">
                <div style="margin-bottom: 10px;">
                    <strong style="color: #333; font-family: var(--font-primary);">Current Version:</strong>
                    <span style="color: #666; font-family: monospace; font-size: 1.1em;">${data.current_version}</span>
                </div>
                <div style="padding: 12px; background: #d4edda; border: 1px solid #28a745; border-radius: 6px; color: #155724;">
                    <strong>Content Up to Date</strong>
                    <p style="margin: 8px 0 0 0;">You are running the latest version of Application & Threat content.</p>
                </div>
            </div>
        `;
    }

    info.style.display = 'block';
}

/**
 * Start content update workflow
 * Combined download + install process
 * Skips download if already downloaded
 */
async function startContentUpdate() {
    console.log('Starting content update workflow...');

    // Check if already downloaded
    const isDownloaded = contentUpdateState.updateInfo?.downloaded &&
                         contentUpdateState.updateInfo.downloaded.toLowerCase() === 'yes';

    // Build confirmation message
    const steps = [];
    let n = 1;
    if (!isDownloaded) steps.push(`${n++}. Download content update ${contentUpdateState.updateInfo?.latest_version}`);
    steps.push(`${n++}. Install content update ${contentUpdateState.updateInfo?.latest_version}`);

    const msg = `This will update Application & Threat content from ${contentUpdateState.updateInfo?.current_version} to ${contentUpdateState.updateInfo?.latest_version}.\n\nThe process will:\n${steps.join('\n')}\n\nNo reboot is required. Continue?`;

    if (!confirm(msg)) return;

    // Show modal
    showContentUpdateModal();

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

        let currentProgress = 0;

        // Step 1: Download (skip if already downloaded)
        if (!isDownloaded) {
            updateContentProgress('Downloading', 'Starting content download...', 0, false);

            const downloadResponse = await window.apiClient.post('/api/content-updates/download');
            if (!downloadResponse.ok) {
                throw new Error('Failed to start content download');
            }

            const downloadData = downloadResponse.data;
            console.log('Download response:', downloadData);

            if (downloadData.status === 'success') {
                contentUpdateState.downloadJobId = downloadData.jobid;

                // Poll download job (0% to 50%)
                const downloadSuccess = await pollContentJob(downloadData.jobid, 'Downloading', 'Content Download', 0, 50);

                if (!downloadSuccess) {
                    setTimeout(() => hideContentUpdateModal(), 3000);
                    return;
                }

                console.log('Content download complete');
                await new Promise(resolve => setTimeout(resolve, 1500));
                currentProgress = 50;

            } else {
                updateContentProgress('Failed', `Download failed: ${downloadData.message}`, 0, true);
                setTimeout(() => hideContentUpdateModal(), 3000);
                return;
            }
        } else {
            console.log('Content already downloaded, skipping download step');
            currentProgress = 50;
        }

        // Step 2: Install
        await startContentInstall(currentProgress);

    } catch (error) {
        console.error('Content update error:', error);
        updateContentProgress('Failed', `Error: ${error.message}`, 0, true);
        setTimeout(() => hideContentUpdateModal(), 3000);
    }
}

/**
 * Poll job status with progress updates
 * Matches PAN-OS upgrade polling exactly
 */
async function pollContentJob(jobId, stepName, stepDisplayName, progressStart, progressEnd) {
    return new Promise((resolve) => {
        let pollCount = 0;
        const maxPolls = 120; // 30 minutes with 15-second intervals

        console.log(`Starting to poll job ${jobId} for step: ${stepName}`);

        const pollInterval = setInterval(async () => {
            pollCount++;

            try {
                const response = await fetch(`/api/panos-upgrade/job-status/${jobId}`);
                const data = await response.json();

                if (data.status === 'success') {
                    const job = data.job;
                    console.log(`Job ${jobId} status:`, job);

                    // Calculate progress within the range
                    const jobProgress = parseInt(job.progress) || 0;
                    const currentProgress = progressStart + (jobProgress * (progressEnd - progressStart) / 100);

                    // Update progress display
                    updateContentProgress(stepName, `${stepDisplayName}: ${job.status}`, currentProgress, false);

                    if (job.status === 'FIN') {
                        clearInterval(pollInterval);

                        // Check for failures
                        const isFailed = job.result === 'FAIL' ||
                                       (job.details && job.details.toLowerCase().includes('fail'));

                        if (isFailed) {
                            updateContentProgress('Failed', `${stepDisplayName} failed: ${job.details || job.result}`, currentProgress, true);
                            resolve(false);
                        } else {
                            updateContentProgress(stepName, `${stepDisplayName} complete!`, progressEnd, false);
                            resolve(true);
                        }
                    }
                } else {
                    clearInterval(pollInterval);
                    updateContentProgress('Failed', `Failed to check job status: ${data.message}`, 0, true);
                    resolve(false);
                }

            } catch (error) {
                clearInterval(pollInterval);
                updateContentProgress('Failed', `Error checking job status: ${error.message}`, 0, true);
                resolve(false);
            }

            // Timeout after max polls
            if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                updateContentProgress('Failed', `${stepDisplayName} timed out after 30 minutes`, 0, true);
                resolve(false);
            }

        }, 15000); // Poll every 15 seconds
    });
}

/**
 * Start install step after download completes
 */
async function startContentInstall(currentProgress) {
    console.log('Starting content install...');

    updateContentProgress('Installing', 'Starting content installation...', currentProgress, false);

    try {
        const installResponse = await window.apiClient.post('/api/content-updates/install', {
            version: 'latest'
        });
        if (!installResponse.ok) {
            throw new Error('Failed to start content installation');
        }

        const installData = installResponse.data;
        console.log('Install response:', installData);

        if (installData.status === 'success') {
            contentUpdateState.installJobId = installData.jobid;

            // Poll install job (from current progress to 100%)
            const installSuccess = await pollContentJob(installData.jobid, 'Installing', 'Content Install', currentProgress, 100);

            if (installSuccess) {
                handleContentUpdateComplete();
            } else {
                setTimeout(() => hideContentUpdateModal(), 3000);
            }

        } else {
            updateContentProgress('Failed', `Install failed: ${installData.message}`, currentProgress, true);
            setTimeout(() => hideContentUpdateModal(), 3000);
        }

    } catch (error) {
        console.error('Install error:', error);
        updateContentProgress('Failed', `Install error: ${error.message}`, currentProgress, true);
        setTimeout(() => hideContentUpdateModal(), 3000);
    }
}

/**
 * Handle content update completion
 * No reboot needed for content updates
 */
function handleContentUpdateComplete() {
    console.log('Content update completed successfully');

    updateContentProgress('Complete', 'Content update completed successfully!', 100, false);

    // Update the display
    setTimeout(() => {
        hideContentUpdateModal();

        // Refresh components table
        if (typeof loadSoftwareUpdates === 'function') {
            loadSoftwareUpdates();
        }

        // Refresh content update status
        checkContentUpdates();

        alert('Content update completed successfully!\n\nThe firewall now has the latest Application & Threat content version.');
    }, 2000);
}

/**
 * Show update progress modal (matches PAN-OS exactly)
 */
function showContentUpdateModal() {
    const modal = document.getElementById('contentUpdateModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Hide modal
 */
function hideContentUpdateModal() {
    const modal = document.getElementById('contentUpdateModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Update content progress display (matches PAN-OS exactly)
 */
function updateContentProgress(step, message, progress, isError = false) {
    const stepElement = document.getElementById('contentUpdateStep');
    const messageElement = document.getElementById('contentUpdateMessage');
    const progressBar = document.getElementById('contentUpdateProgressBar');
    const progressPercent = document.getElementById('contentUpdateProgress');
    const cancelBtn = document.getElementById('cancelContentUpdateBtn');

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

    if (progressPercent) {
        progressPercent.textContent = `${Math.round(progress)}%`;
    }

    // Hide cancel button on completion or error
    if (cancelBtn && (progress === 100 || isError)) {
        cancelBtn.style.display = 'none';
    }
}

/**
 * Cancel content update (placeholder - content updates cannot be easily cancelled once started)
 */
function cancelContentUpdate() {
    if (confirm('Are you sure you want to close this window? The content update may still be running on the firewall.')) {
        hideContentUpdateModal();
        contentUpdateState.currentStep = null;
        contentUpdateState.downloadJobId = null;
        contentUpdateState.installJobId = null;
    }
}

/**
 * Initialize content updates UI
 * Called when Components tab loads
 */
function initContentUpdates() {
    console.log('Initializing content updates...');

    const checkBtn = document.getElementById('checkContentUpdatesBtn');
    if (checkBtn && !checkBtn.hasAttribute('data-initialized')) {
        checkBtn.addEventListener('click', checkContentUpdates);
        checkBtn.setAttribute('data-initialized', 'true');
        console.log('Content update button initialized');
    }
}

// Export functions
if (typeof window !== 'undefined') {
    window.initContentUpdates = initContentUpdates;
    window.checkContentUpdates = checkContentUpdates;
    window.startContentUpdate = startContentUpdate;
    window.cancelContentUpdate = cancelContentUpdate;
}
