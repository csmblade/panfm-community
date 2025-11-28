/**
 * Content Update Orchestration Module
 * Handles App & Threat, Antivirus, WildFire, URL Filtering, GlobalProtect content updates
 *
 * User Requirements:
 * - Download and install as combined workflow (v1.0.16)
 * - Same modal design as PAN-OS upgrades
 * - No reboot required
 * - Individual component update buttons per row
 * - Update All button for batch updates
 *
 * File created per .clinerules to keep other files under size limits
 */

// Global state
let contentUpdateState = {
    currentStep: null,  // 'check', 'download', 'install', 'complete'
    downloadJobId: null,
    installJobId: null,
    pollInterval: null,
    updateInfo: null,
    allComponentsInfo: null,  // Results from check-all API
    updatesAvailable: 0,      // Count of components with updates
    isUpdating: false         // Prevent concurrent updates
};

/**
 * Check for content updates for ALL content types
 * Called when user clicks "Check for Updates" button
 * v1.0.16: Now checks all 5 content types at once
 */
async function checkContentUpdates() {
    const btn = document.getElementById('checkContentUpdatesBtn');
    const updateAllBtn = document.getElementById('updateAllBtn');
    const info = document.getElementById('contentUpdateInfo');

    if (!btn || !info) {
        console.error('Content update UI elements not found');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Checking all components...';
    info.style.display = 'none';
    if (updateAllBtn) updateAllBtn.disabled = true;

    try {
        console.log('Checking for content updates (all types)...');
        const response = await window.apiClient.get('/api/content-updates/check-all');
        if (!response.ok) {
            throw new Error('Failed to check for content updates');
        }
        const data = response.data;

        console.log('Content update check-all response:', data);

        if (data.status === 'success' || data.status === 'partial') {
            contentUpdateState.allComponentsInfo = data.results;
            contentUpdateState.updatesAvailable = data.updates_available;

            // Display summary status
            displayAllContentUpdateStatus(data);

            // Enable Update All button if updates available
            if (updateAllBtn) {
                if (data.updates_available > 0) {
                    updateAllBtn.disabled = false;
                    updateAllBtn.style.opacity = '1';
                    updateAllBtn.style.cursor = 'pointer';
                    updateAllBtn.title = `Update ${data.updates_available} component(s)`;
                } else {
                    updateAllBtn.disabled = true;
                    updateAllBtn.style.opacity = '0.5';
                    updateAllBtn.style.cursor = 'not-allowed';
                    updateAllBtn.title = 'All components are up to date';
                }
            }
        } else {
            info.innerHTML = `<p style="color: #dc3545; margin-top: 10px;">Error: ${data.message}</p>`;
            info.style.display = 'block';
        }
    } catch (error) {
        console.error('Error checking content updates:', error);
        info.innerHTML = `<p style="color: #dc3545; margin-top: 10px;">Error: ${error.message}</p>`;
        info.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check for Updates';
    }
}

/**
 * Display content update status for ALL components (v1.0.16)
 * Shows summary and updates the components table with action buttons
 */
function displayAllContentUpdateStatus(data) {
    const info = document.getElementById('contentUpdateInfo');

    if (data.updates_available > 0) {
        info.innerHTML = `
            <div style="margin-top: 15px; padding: 15px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; border-left: 4px solid #FA582D;">
                <strong style="color: #856404;">${data.updates_available} Update(s) Available</strong>
                <p style="margin: 8px 0 0 0; color: #856404;">Click "Update All" to download and install all available updates, or use the individual Update buttons in the table below.</p>
            </div>
        `;
    } else {
        info.innerHTML = `
            <div style="margin-top: 15px; padding: 15px; background: #d4edda; border: 1px solid #28a745; border-radius: 8px; border-left: 4px solid #28a745;">
                <strong style="color: #155724;">Content Up to Date</strong>
                <p style="margin: 8px 0 0 0; color: #155724;">All content components are running the latest versions.</p>
            </div>
        `;
    }
    info.style.display = 'block';

    // Update components table with check results and action buttons
    renderComponentsTableWithActions(data.results);
}

/**
 * Render components table with Update action buttons (v1.0.16)
 * Uses same styling as pages.js renderSoftwareTable for consistency
 */
function renderComponentsTableWithActions(results) {
    const tableContainer = document.getElementById('componentsTable');
    if (!tableContainer) return;

    let html = `
        <table style="width: 100%; border-collapse: collapse; font-family: var(--font-secondary); font-size: 0.9em;">
            <thead>
                <tr style="background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white;">
                    <th style="padding: 12px; text-align: left; font-family: var(--font-primary);">Component</th>
                    <th style="padding: 12px; text-align: left; font-family: var(--font-primary);">Version</th>
                    <th style="padding: 12px; text-align: center; font-family: var(--font-primary);">Status</th>
                    <th style="padding: 12px; text-align: center; font-family: var(--font-primary);">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    results.forEach((component, index) => {
        const needsUpdate = component.needs_update === true;
        const isDownloaded = component.downloaded && component.downloaded.toLowerCase() === 'yes';
        const hasError = component.status === 'error';
        const bgColor = index % 2 === 0 ? '#f9f9f9' : '#ffffff';

        // Status column
        let statusHtml;
        if (hasError) {
            statusHtml = `<span style="color: #dc3545;">Error</span>`;
        } else if (needsUpdate) {
            statusHtml = `<span style="color: #856404; font-weight: 600;">Update Available</span>`;
        } else {
            statusHtml = `<span style="color: #28a745; font-weight: 600;">Up to date</span>`;
        }

        // Actions column
        let actionsHtml;
        if (hasError) {
            actionsHtml = `<span style="color: #dc3545; font-size: 0.85em;">${component.message || 'Check failed'}</span>`;
        } else if (needsUpdate) {
            const btnText = isDownloaded ? 'Install' : 'Update';
            const btnTitle = isDownloaded ? 'Install downloaded update' : 'Download and install update';
            actionsHtml = `
                <button onclick="updateSingleComponent('${component.content_type}', '${component.name}')"
                        title="${btnTitle}"
                        class="content-update-btn"
                        style="padding: 6px 14px; background: linear-gradient(135deg, #FA582D 0%, #FF7A55 100%); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.85em;">
                    ${btnText}
                </button>
            `;
        } else {
            actionsHtml = `<span style="color: #28a745; font-weight: 600;">✓</span>`;
        }

        html += `
            <tr style="background: ${bgColor}; border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 12px; font-weight: 600; color: #333; font-family: var(--font-primary);">${component.name || component.content_type}</td>
                <td style="padding: 12px; color: #666; font-family: monospace;">${component.current_version || 'N/A'}</td>
                <td style="padding: 12px; text-align: center;">${statusHtml}</td>
                <td style="padding: 12px; text-align: center;">${actionsHtml}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    tableContainer.innerHTML = html;
}

/**
 * Legacy display function (kept for backward compatibility)
 */
function displayContentUpdateStatus(data) {
    // Use the new all-components display if we have results array
    if (data.results) {
        displayAllContentUpdateStatus(data);
        return;
    }

    // Legacy single-component display
    const info = document.getElementById('contentUpdateInfo');

    if (data.needs_update) {
        const isDownloaded = data.downloaded && data.downloaded.toLowerCase() === 'yes';
        const buttonText = isDownloaded ? 'Install Update' : 'Download & Install Update';
        const buttonTitle = isDownloaded ? 'Version already downloaded - will skip download step' : 'Will download and install the update';

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
 * Update a single component (v1.0.16)
 * Called from per-row Update button in components table
 */
async function updateSingleComponent(contentType, displayName) {
    if (contentUpdateState.isUpdating) {
        alert('An update is already in progress. Please wait.');
        return;
    }

    // Find component info from cached results
    const component = contentUpdateState.allComponentsInfo?.find(c => c.content_type === contentType);
    if (!component) {
        alert('Component information not found. Please click "Check for Updates" first.');
        return;
    }

    const isDownloaded = component.downloaded && component.downloaded.toLowerCase() === 'yes';
    const steps = [];
    let n = 1;
    if (!isDownloaded) steps.push(`${n++}. Download ${displayName} update`);
    steps.push(`${n++}. Install ${displayName} update`);

    const msg = `This will update ${displayName} from ${component.current_version} to ${component.latest_version}.\n\nThe process will:\n${steps.join('\n')}\n\nNo reboot is required. Continue?`;

    if (!confirm(msg)) return;

    contentUpdateState.isUpdating = true;
    disableAllUpdateButtons(true);

    showContentUpdateModal();

    try {
        let currentProgress = 0;

        // Step 1: Download (skip if already downloaded)
        if (!isDownloaded) {
            updateContentProgress('Downloading', `Downloading ${displayName}...`, 0, false);

            const downloadResponse = await window.apiClient.post('/api/content-updates/download', {
                content_type: contentType
            });

            if (!downloadResponse.ok) {
                throw new Error('Failed to start download');
            }

            const downloadData = downloadResponse.data;
            console.log(`${displayName} download response:`, downloadData);

            if (downloadData.status === 'success') {
                contentUpdateState.downloadJobId = downloadData.jobid;

                const downloadSuccess = await pollContentJob(downloadData.jobid, 'Downloading', `${displayName} Download`, 0, 50);

                if (!downloadSuccess) {
                    setTimeout(() => hideContentUpdateModal(), 3000);
                    return;
                }

                console.log(`${displayName} download complete`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                currentProgress = 50;
            } else {
                updateContentProgress('Failed', `Download failed: ${downloadData.message}`, 0, true);
                setTimeout(() => hideContentUpdateModal(), 3000);
                return;
            }
        } else {
            console.log(`${displayName} already downloaded, skipping download step`);
            currentProgress = 50;
        }

        // Step 2: Install
        updateContentProgress('Installing', `Installing ${displayName}...`, currentProgress, false);

        const installResponse = await window.apiClient.post('/api/content-updates/install', {
            content_type: contentType,
            version: 'latest'
        });

        if (!installResponse.ok) {
            throw new Error('Failed to start installation');
        }

        const installData = installResponse.data;
        console.log(`${displayName} install response:`, installData);

        if (installData.status === 'success') {
            contentUpdateState.installJobId = installData.jobid;

            const installSuccess = await pollContentJob(installData.jobid, 'Installing', `${displayName} Install`, currentProgress, 100);

            if (installSuccess) {
                updateContentProgress('Complete', `${displayName} updated successfully!`, 100, false);
                setTimeout(() => {
                    hideContentUpdateModal();
                    checkContentUpdates(); // Refresh all component statuses
                }, 2000);
            } else {
                setTimeout(() => hideContentUpdateModal(), 3000);
            }
        } else {
            updateContentProgress('Failed', `Install failed: ${installData.message}`, currentProgress, true);
            setTimeout(() => hideContentUpdateModal(), 3000);
        }

    } catch (error) {
        console.error(`${displayName} update error:`, error);
        updateContentProgress('Failed', `Error: ${error.message}`, 0, true);
        setTimeout(() => hideContentUpdateModal(), 3000);
    } finally {
        contentUpdateState.isUpdating = false;
        disableAllUpdateButtons(false);
    }
}

/**
 * Update ALL components with available updates (v1.0.16)
 * Called from "Update All" button
 */
async function updateAllComponents() {
    if (contentUpdateState.isUpdating) {
        alert('An update is already in progress. Please wait.');
        return;
    }

    const componentsToUpdate = contentUpdateState.allComponentsInfo?.filter(c =>
        c.status === 'success' && c.needs_update === true
    ) || [];

    if (componentsToUpdate.length === 0) {
        alert('No updates available. Click "Check for Updates" first.');
        return;
    }

    const componentNames = componentsToUpdate.map(c => c.name).join('\n- ');
    const msg = `This will update ${componentsToUpdate.length} component(s):\n- ${componentNames}\n\nEach component will be downloaded and installed sequentially.\n\nNo reboot is required. Continue?`;

    if (!confirm(msg)) return;

    contentUpdateState.isUpdating = true;
    disableAllUpdateButtons(true);

    showContentUpdateModal();

    const results = { success: [], failed: [] };
    const totalComponents = componentsToUpdate.length;

    try {
        for (let i = 0; i < totalComponents; i++) {
            const component = componentsToUpdate[i];
            const displayName = component.name;
            const contentType = component.content_type;
            const isDownloaded = component.downloaded && component.downloaded.toLowerCase() === 'yes';

            // Calculate progress range for this component
            const progressPerComponent = 100 / totalComponents;
            const progressStart = i * progressPerComponent;
            const progressMid = progressStart + (progressPerComponent / 2);
            const progressEnd = (i + 1) * progressPerComponent;

            updateContentProgress(
                `Updating ${i + 1}/${totalComponents}`,
                `Processing ${displayName}...`,
                progressStart,
                false
            );

            try {
                // Download (if needed)
                if (!isDownloaded) {
                    updateContentProgress(`Updating ${i + 1}/${totalComponents}`, `Downloading ${displayName}...`, progressStart, false);

                    const downloadResponse = await window.apiClient.post('/api/content-updates/download', {
                        content_type: contentType
                    });

                    if (!downloadResponse.ok || downloadResponse.data.status !== 'success') {
                        throw new Error(downloadResponse.data?.message || 'Download failed');
                    }

                    const downloadSuccess = await pollContentJob(
                        downloadResponse.data.jobid,
                        `Updating ${i + 1}/${totalComponents}`,
                        `${displayName} Download`,
                        progressStart,
                        progressMid
                    );

                    if (!downloadSuccess) {
                        throw new Error('Download job failed');
                    }

                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Install
                updateContentProgress(`Updating ${i + 1}/${totalComponents}`, `Installing ${displayName}...`, progressMid, false);

                const installResponse = await window.apiClient.post('/api/content-updates/install', {
                    content_type: contentType,
                    version: 'latest'
                });

                if (!installResponse.ok || installResponse.data.status !== 'success') {
                    throw new Error(installResponse.data?.message || 'Install failed');
                }

                const installSuccess = await pollContentJob(
                    installResponse.data.jobid,
                    `Updating ${i + 1}/${totalComponents}`,
                    `${displayName} Install`,
                    progressMid,
                    progressEnd
                );

                if (!installSuccess) {
                    throw new Error('Install job failed');
                }

                results.success.push(displayName);
                console.log(`✓ ${displayName} updated successfully`);

            } catch (componentError) {
                console.error(`✗ ${displayName} update failed:`, componentError);
                results.failed.push({ name: displayName, error: componentError.message });
                // Continue with next component
            }
        }

        // Show final summary
        if (results.failed.length === 0) {
            updateContentProgress('Complete', `All ${totalComponents} component(s) updated successfully!`, 100, false);
        } else if (results.success.length > 0) {
            updateContentProgress(
                'Partial Success',
                `Updated ${results.success.length}/${totalComponents}. Failed: ${results.failed.map(f => f.name).join(', ')}`,
                100,
                true
            );
        } else {
            updateContentProgress('Failed', 'All updates failed', 100, true);
        }

        setTimeout(() => {
            hideContentUpdateModal();
            checkContentUpdates(); // Refresh all component statuses

            // Show summary alert
            let summary = `Update Summary:\n\n`;
            if (results.success.length > 0) {
                summary += `✓ Successfully updated:\n  - ${results.success.join('\n  - ')}\n\n`;
            }
            if (results.failed.length > 0) {
                summary += `✗ Failed:\n  - ${results.failed.map(f => `${f.name}: ${f.error}`).join('\n  - ')}`;
            }
            alert(summary);
        }, 2000);

    } catch (error) {
        console.error('Update all error:', error);
        updateContentProgress('Failed', `Error: ${error.message}`, 0, true);
        setTimeout(() => hideContentUpdateModal(), 3000);
    } finally {
        contentUpdateState.isUpdating = false;
        disableAllUpdateButtons(false);
    }
}

/**
 * Disable/enable all update buttons during update process
 */
function disableAllUpdateButtons(disabled) {
    const updateAllBtn = document.getElementById('updateAllBtn');
    if (updateAllBtn) updateAllBtn.disabled = disabled;

    document.querySelectorAll('.content-update-btn').forEach(btn => {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '0.5' : '1';
        btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    });
}

/**
 * Legacy start content update workflow (kept for backward compatibility)
 * Combined download + install process
 * Skips download if already downloaded
 */
async function startContentUpdate() {
    // If we have allComponentsInfo, use the new single component update for 'content' type
    if (contentUpdateState.allComponentsInfo) {
        const contentComponent = contentUpdateState.allComponentsInfo.find(c => c.content_type === 'content');
        if (contentComponent && contentComponent.needs_update) {
            await updateSingleComponent('content', 'Application & Threat');
            return;
        }
    }

    // Legacy flow for backward compatibility
    console.log('Starting content update workflow (legacy)...');

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
                    // Job data is at top level of response, not nested under 'job'
                    console.log(`Job ${jobId} status:`, data);

                    // Calculate progress within the range
                    const jobProgress = parseInt(data.progress) || 0;
                    const currentProgress = progressStart + (jobProgress * (progressEnd - progressStart) / 100);

                    // Convert PAN-OS job status to user-friendly text
                    const statusMap = {
                        'PEND': 'Pending',
                        'ACT': 'Active',
                        'FIN': 'Finished'
                    };
                    const friendlyStatus = statusMap[data.job_status] || data.job_status;

                    // Update progress display
                    updateContentProgress(stepName, `${stepDisplayName}: ${friendlyStatus}`, currentProgress, false);

                    if (data.job_status === 'FIN') {
                        clearInterval(pollInterval);

                        // Check for failures
                        const isFailed = data.result === 'FAIL' ||
                                       (data.details && data.details.toLowerCase().includes('fail'));

                        if (isFailed) {
                            updateContentProgress('Failed', `${stepDisplayName} failed: ${data.details || data.result}`, currentProgress, true);
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
    // v1.0.16: New functions for individual and batch updates
    window.updateSingleComponent = updateSingleComponent;
    window.updateAllComponents = updateAllComponents;
}
