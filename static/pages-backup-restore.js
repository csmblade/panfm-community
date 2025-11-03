/**
 * Backup & Restore Page JavaScript for PANfm
 * Handles comprehensive backup/restore and metadata migration
 */

// Global variable to store loaded backup data
let loadedBackupData = null;

/**
 * Initialize backup/restore page functionality
 * Called when settings page loads
 */
function initBackupRestore() {
    console.log('Initializing Backup & Restore functionality');

    // Create Backup button
    const createBackupBtn = document.getElementById('createBackupBtn');
    if (createBackupBtn) {
        createBackupBtn.addEventListener('click', createAndDownloadBackup);
    }

    // Backup file input - when file selected, parse and show info
    const backupFileInput = document.getElementById('backupFileInput');
    if (backupFileInput) {
        backupFileInput.addEventListener('change', handleBackupFileSelected);
    }

    // Restore button
    const restoreBackupBtn = document.getElementById('restoreBackupBtn');
    if (restoreBackupBtn) {
        restoreBackupBtn.addEventListener('click', restoreFromBackup);
    }

    // Migration check button
    const checkMigrationBtn = document.getElementById('checkMigrationBtn');
    if (checkMigrationBtn) {
        checkMigrationBtn.addEventListener('click', checkMigrationStatus);
    }

    // Migration execute button
    const migrateBtnSettings = document.getElementById('migrateBtnSettings');
    if (migrateBtnSettings) {
        migrateBtnSettings.addEventListener('click', executeMigration);
    }

    // Auto-check migration status on load
    checkMigrationStatus();
}

/**
 * Create comprehensive backup and download as JSON file
 */
async function createAndDownloadBackup() {
    console.log('Creating backup...');
    const btn = document.getElementById('createBackupBtn');
    const messageDiv = document.getElementById('backupMessage');

    try {
        // Disable button
        btn.disabled = true;
        btn.textContent = '⏳ Creating Backup...';

        // Call API to create backup
        const response = await fetch('/api/backup/export', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
            }
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            // Create download
            const backupData = result.data;
            const filename = result.filename;

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Show success message with security warning
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#fff3cd';
            messageDiv.style.border = '1px solid #ffc107';
            messageDiv.style.color = '#856404';
            messageDiv.innerHTML = `
                <div style="margin-bottom: 10px;">
                    <strong>✅ Backup created successfully!</strong> Downloaded as <code>${filename}</code>
                </div>
                <div style="background: #fff; padding: 10px; border-left: 4px solid #dc3545; margin-top: 10px;">
                    <strong>🔒 SECURITY WARNING:</strong><br>
                    This backup contains your <strong>encryption key</strong> and can decrypt all sensitive data
                    (API keys, passwords, metadata). Store it securely:
                    <ul style="margin: 5px 0; padding-left: 20px;">
                        <li>Encrypted USB drive or secure cloud storage</li>
                        <li>Password manager's secure notes</li>
                        <li>Offline encrypted backup location</li>
                    </ul>
                    <strong>❌ DO NOT:</strong> Email this file or store it in plaintext.
                </div>
            `;

            console.log('Backup created and downloaded:', filename);
        } else {
            throw new Error(result.message || 'Failed to create backup');
        }
    } catch (error) {
        console.error('Error creating backup:', error);
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.border = '1px solid #f5c6cb';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = `❌ Error: ${error.message}`;
    } finally {
        // Re-enable button
        btn.disabled = false;
        btn.textContent = '📥 Create & Download Backup';
    }
}

/**
 * Handle backup file selection - parse and display info
 */
async function handleBackupFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    console.log('Backup file selected:', file.name);

    try {
        // Read file
        const text = await file.text();
        const backupData = JSON.parse(text);

        // Store globally
        loadedBackupData = backupData;

        // Get backup info from API
        const response = await fetch('/api/backup/info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
            },
            body: JSON.stringify({ backup: backupData })
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            const info = result.info;

            // Display backup info
            const backupInfoDiv = document.getElementById('backupInfo');
            const backupInfoList = document.getElementById('backupInfoList');

            backupInfoList.innerHTML = `
                <li><strong>Version:</strong> ${info.version}</li>
                <li><strong>Created:</strong> ${new Date(info.timestamp).toLocaleString()}</li>
                <li><strong>Settings:</strong> ${info.has_settings ? '✅ Included' : '❌ Not included'}</li>
                <li><strong>Devices:</strong> ${info.has_devices ? `✅ ${info.device_count} devices` : '❌ Not included'}</li>
                <li><strong>Metadata:</strong> ${info.has_metadata ? `✅ ${info.metadata_count} entries` : '❌ Not included'}</li>
            `;

            backupInfoDiv.style.display = 'block';

            // Enable restore button
            const restoreBtn = document.getElementById('restoreBackupBtn');
            restoreBtn.disabled = false;
            restoreBtn.style.opacity = '1';

            console.log('Backup info loaded:', info);
        } else {
            throw new Error(result.message || 'Failed to get backup info');
        }
    } catch (error) {
        console.error('Error reading backup file:', error);
        alert(`Error reading backup file: ${error.message}`);

        // Hide info, disable restore
        document.getElementById('backupInfo').style.display = 'none';
        const restoreBtn = document.getElementById('restoreBackupBtn');
        restoreBtn.disabled = true;
        restoreBtn.style.opacity = '0.5';
    }
}

/**
 * Restore from backup file
 */
async function restoreFromBackup() {
    if (!loadedBackupData) {
        alert('No backup file loaded');
        return;
    }

    // Confirm
    if (!confirm('⚠️ This will overwrite your current configuration for the selected components. Are you sure?')) {
        return;
    }

    console.log('Restoring from backup...');
    const btn = document.getElementById('restoreBackupBtn');
    const messageDiv = document.getElementById('restoreMessage');

    try {
        // Disable button
        btn.disabled = true;
        btn.textContent = '⏳ Restoring...';

        // Get selected components
        const restoreSettings = document.getElementById('restoreSettings').checked;
        const restoreDevices = document.getElementById('restoreDevices').checked;
        const restoreMetadata = document.getElementById('restoreMetadata').checked;

        // Call API
        const response = await fetch('/api/backup/restore', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
            },
            body: JSON.stringify({
                backup: loadedBackupData,
                restore_settings: restoreSettings,
                restore_devices: restoreDevices,
                restore_metadata: restoreMetadata
            })
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            // Success
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#d4edda';
            messageDiv.style.border = '1px solid #c3e6cb';
            messageDiv.style.color = '#155724';
            messageDiv.innerHTML = `✅ Restore completed successfully!<br>Restored: ${result.restored.join(', ')}`;

            console.log('Restore successful:', result.restored);

            // Reload page after 2 seconds
            setTimeout(() => {
                location.reload();
            }, 2000);
        } else {
            // Partial success or error
            const errors = result.errors || [result.message];
            const restored = result.restored || [];

            messageDiv.style.display = 'block';
            if (restored.length > 0) {
                messageDiv.style.background = '#fff3cd';
                messageDiv.style.border = '1px solid #ffc107';
                messageDiv.style.color = '#856404';
                messageDiv.innerHTML = `⚠️ Partially restored: ${restored.join(', ')}<br>Errors: ${errors.join(', ')}`;
            } else {
                messageDiv.style.background = '#f8d7da';
                messageDiv.style.border = '1px solid #f5c6cb';
                messageDiv.style.color = '#721c24';
                messageDiv.innerHTML = `❌ Restore failed: ${errors.join(', ')}`;
            }
        }
    } catch (error) {
        console.error('Error restoring backup:', error);
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.border = '1px solid #f5c6cb';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = `❌ Error: ${error.message}`;
    } finally {
        // Re-enable button
        btn.disabled = false;
        btn.textContent = '🔄 Restore from Backup';
    }
}

/**
 * Check metadata migration status
 */
async function checkMigrationStatus() {
    console.log('Checking migration status...');
    const statusText = document.getElementById('migrationStatusText');
    const migrateBtn = document.getElementById('migrateBtnSettings');
    const messageDiv = document.getElementById('migrationMessage');

    try {
        statusText.textContent = 'Checking...';

        const response = await fetch('/api/metadata/migration/check', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            const needsMigration = result.needs_migration;

            if (needsMigration) {
                statusText.textContent = '⚠️ Migration needed (using legacy global format)';
                statusText.style.color = '#856404';
                statusText.style.fontWeight = '600';

                // Enable migrate button
                migrateBtn.disabled = false;
                migrateBtn.style.opacity = '1';
            } else {
                statusText.textContent = '✅ Already using per-device format (v1.6.0+)';
                statusText.style.color = '#155724';
                statusText.style.fontWeight = '600';

                // Disable migrate button
                migrateBtn.disabled = true;
                migrateBtn.style.opacity = '0.5';
            }

            console.log('Migration status:', needsMigration ? 'needed' : 'not needed');
        } else {
            throw new Error(result.message || 'Failed to check migration status');
        }
    } catch (error) {
        console.error('Error checking migration:', error);
        statusText.textContent = `❌ Error: ${error.message}`;
        statusText.style.color = '#721c24';
    }
}

/**
 * Execute metadata migration
 */
async function executeMigration() {
    // Confirm
    if (!confirm('⚠️ This will migrate metadata from global format to per-device format. This cannot be undone. Continue?')) {
        return;
    }

    console.log('Executing migration...');
    const btn = document.getElementById('migrateBtnSettings');
    const messageDiv = document.getElementById('migrationMessage');

    try {
        // Disable button
        btn.disabled = true;
        btn.textContent = '⏳ Migrating...';

        // Call API
        const response = await fetch('/api/metadata/migration/migrate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
            },
            body: JSON.stringify({})  // Will use selected_device_id from settings
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            // Success
            messageDiv.style.display = 'block';
            messageDiv.style.background = '#d4edda';
            messageDiv.style.border = '1px solid #c3e6cb';
            messageDiv.style.color = '#155724';
            messageDiv.textContent = '✅ Migration completed successfully!';

            console.log('Migration successful');

            // Refresh status
            setTimeout(() => {
                checkMigrationStatus();
                messageDiv.style.display = 'none';
            }, 3000);
        } else {
            throw new Error(result.message || 'Migration failed');
        }
    } catch (error) {
        console.error('Error during migration:', error);
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.border = '1px solid #f5c6cb';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = `❌ Error: ${error.message}`;

        // Re-enable button
        btn.disabled = false;
        btn.textContent = '⚡ Migrate Now';
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBackupRestore);
} else {
    initBackupRestore();
}
