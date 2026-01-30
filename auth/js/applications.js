// Dynamic API URL - works on Vercel and localhost
// Detect base path from current location
const getBasePath = () => {
    const pathname = window.location.pathname;
    // If pathname is like /authentication/application.html, extract /authentication
    const match = pathname.match(/^(\/[^\/]+)/);
    return match ? match[1] : '';
};

const basePath = getBasePath();
let API_URL = `${window.location.origin}${basePath}/api`;

// Fallback to localhost for local development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    API_URL = 'http://localhost:3000/api';
}

let allApplications = [];
let currentEditAppId = null;
let currentEditApp = null;
let userPermissions = {};

// Load user info and permissions
async function loadUserInfo() {
    try {
        const response = await fetch(`${API_URL}/auth/me`, {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.loggedIn && data.user) {
            // Update profile in sidebar
            const userEmailEl = document.getElementById('user-email');
            const userAvatarEl = document.getElementById('user-avatar');
            
            if (userEmailEl) {
                userEmailEl.textContent = data.user.display_name || data.user.email;
            }
            
            if (userAvatarEl) {
                if (data.user.avatar_url) {
                    userAvatarEl.textContent = '';
                    userAvatarEl.style.backgroundImage = `url(${data.user.avatar_url})`;
                    userAvatarEl.style.backgroundSize = 'cover';
                    userAvatarEl.style.backgroundPosition = 'center';
                    userAvatarEl.style.backgroundRepeat = 'no-repeat';
                } else {
                    // Get first letter of email (default to 'U' if email is missing)
                    const firstLetter = (data.user.email || 'U').charAt(0).toUpperCase();
                    userAvatarEl.textContent = firstLetter;
                    userAvatarEl.style.backgroundImage = '';
                    userAvatarEl.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                }
            }
            
            // Load permissions
            await loadUserPermissions();
        } else {
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        window.location.href = 'login.html';
    }
}

// Load user permissions
async function loadUserPermissions() {
    try {
        const response = await fetch(`${API_URL}/auth/permissions`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Failed to load permissions');
            return;
        }
        
        const data = await response.json();
        userPermissions = data.permissions || {};
        
        // Apply permissions to UI
        applyPermissionsToUI();
    } catch (error) {
        console.error('Error loading permissions:', error);
    }
}

// Apply permissions to UI
function applyPermissionsToUI() {
    // Hide create application button if user can't create
    const createAppCard = document.querySelector('.table-module h4');
    if (createAppCard && createAppCard.textContent.includes('Create New Application')) {
        const createCard = createAppCard.closest('.table-module');
        if (createCard && !userPermissions['applications']?.create) {
            lockElement(createCard, 'No Permissions, Lack of administrator Consent.');
            createCard.querySelectorAll('input, select, button, textarea').forEach(disableElement);
        }
    }
    
    // Hide edit/delete buttons based on permissions
    // This will be handled when rendering table rows
}

// Logout function
async function logout() {
    if (!confirm('Are you sure you want to logout?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        if (data.success) {
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Error logging out:', error);
        window.location.href = 'login.html';
    }
}

// Load applications
async function loadApplications() {
    try {
        const response = await fetch(`${API_URL}/applications`);
        const apps = await response.json();
        allApplications = apps;
        renderApplicationsTable(apps);
        return apps;
    } catch (error) {
        console.error('Error loading applications:', error);
        showTableMessage('Error loading applications', 'error');
        return [];
    }
}

// Render applications table
function renderApplicationsTable(applications) {
    const tableBody = document.getElementById('applications-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (applications.length === 0) {
        tableBody.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No applications found</div>';
        return;
    }
    
    applications.forEach(app => {
        const row = createApplicationRow(app);
        tableBody.appendChild(row);
    });
}

// Create application row
function createApplicationRow(app) {
    const row = document.createElement('div');
    row.className = 'table-row-link';
    row.style.display = 'contents';
    
    // Status badge
    const status = app.status || 'Active';
    let statusClass = 'bg-primary-green';
    if (status === 'Inactive') {
        statusClass = 'bg-primary-rose';
    } else if (status === 'Under Maintenance') {
        statusClass = 'bg-primary-blue';
    }
    
    // HWID Lock status
    const hwidLockEnabled = app.hwid_lock_enabled || false;
    const hwidLockStatus = hwidLockEnabled ? 'Active' : 'Inactive';
    const hwidLockClass = hwidLockEnabled ? 'bg-primary-green' : 'bg-primary-rose';
    
    // Webhook display
    const webhook = app.webhook_url || 'Not set';
    const webhookShort = webhook.length > 30 ? webhook.substring(0, 30) + '...' : webhook;
    
    // Check if user has permission to edit webhook
    const canEditWebhook = userPermissions['applications']?.edit?.webhook;
    const hasWebhook = webhook !== 'Not set' && app.webhook_url;
    // Apply blur and disable copying only if webhook is set and user doesn't have permission
    const webhookDisplayStyle = (canEditWebhook || !hasWebhook)
        ? 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' 
        : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; filter: blur(4px); user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; pointer-events: none; cursor: not-allowed;';
    
    // Version display
    const version = app.version || '1.0.0';
    
    const editDisabled = !userPermissions['applications']?.edit;
    const viewLicensesDisabled = !userPermissions['licenses']?.view;
    const deleteDisabled = !userPermissions['applications']?.delete;

    // License count
    const licenseCount = app.license_count || 0;
    
    row.innerHTML = `
        <div class="w-layout-grid table-row _8-columns" style="grid-column: 1 / -1; align-items: center;">
            <div class="table-title" style="white-space: nowrap; overflow: visible;">${app.name}</div>
            <div style="white-space: nowrap;">${app.app_id}</div>
            <div style="white-space: nowrap; font-weight: 600;">${licenseCount}</div>
            <div style="white-space: nowrap;">${version}</div>
            <div class="status" style="display: flex; align-items: center; gap: 5px; white-space: nowrap;">
                <div class="indication-color ${statusClass}"></div>
                <div>${status}</div>
            </div>
            <div title="${canEditWebhook ? webhook : 'No permission to view webhook URL'}" style="${webhookDisplayStyle}">${webhookShort}</div>
            <div class="status" style="display: flex; align-items: center; gap: 5px; white-space: nowrap;">
                <div class="indication-color ${hwidLockClass}"></div>
                <div>${hwidLockStatus}</div>
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: nowrap; align-items: center; white-space: nowrap; overflow: visible;">
                <button data-action="edit-application" data-app-id="${app.app_id}" class="${editDisabled ? 'permission-disabled' : ''}" style="padding: 5px 10px; background: #ffc107; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Edit Application">Edit${editDisabled ? '<span class="lock-icon-inline"></span>' : ''}</button>
                <button data-action="view-licenses" data-app-id="${app.app_id}" class="${viewLicensesDisabled ? 'permission-disabled' : ''}" style="padding: 5px 10px; background: #9c27b0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="View Licenses">Licenses${viewLicensesDisabled ? '<span class="lock-icon-inline"></span>' : ''}</button>
                <button data-action="delete-application" data-app-id="${app.app_id}" data-app-name="${String(app.name).replace(/"/g, '&quot;')}" class="${deleteDisabled ? 'permission-disabled' : ''}" style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Delete Application">Delete${deleteDisabled ? '<span class="lock-icon-inline"></span>' : ''}</button>
            </div>
        </div>
    `;
    
    return row;
}

// Edit application - open modal
async function editApplication(appId) {
    try {
        const response = await fetch(`${API_URL}/applications/${appId}`);
        const app = await response.json();
        
        if (!response.ok) {
            showEditMessage('Application not found', 'error');
            return;
        }
        
        currentEditAppId = appId;
        currentEditApp = app;
        
        // Populate modal fields
        document.getElementById('edit-status').value = app.status || 'Active';
        document.getElementById('edit-hwid-lock').value = app.hwid_lock_enabled === 1 ? 'true' : 'false';
        document.getElementById('edit-version').value = app.version || '1.0.0';
        document.getElementById('edit-webhook').value = app.webhook_url || '';
        
        // Clear input fields
        document.getElementById('edit-new-name').value = '';
        document.getElementById('edit-confirm-name').value = '';
        document.getElementById('edit-delete-confirm-name').value = '';
        document.getElementById('edit-modal-message').textContent = '';
        
        // Hide/show buttons based on permissions
        const refreshBtn = document.querySelector('[onclick*="refreshAppId"]');
        const updateNameBtn = document.querySelector('[onclick*="updateApplicationName"]');
        const deleteAllBtn = document.querySelector('[onclick*="deleteAllLicenses"]');
        const statusSelect = document.getElementById('edit-status');
        const hwidSelect = document.getElementById('edit-hwid-lock');
        const versionInput = document.getElementById('edit-version');
        const versionUpdateBtn = document.querySelector('[onclick*="updateVersion"]');
        const webhookInput = document.getElementById('edit-webhook');
        const webhookUpdateBtn = document.querySelector('[onclick*="updateWebhook"]');
        
        // Apply blur to webhook input if user doesn't have permission
        const canEditWebhook = userPermissions['applications']?.edit?.webhook;
        if (webhookInput && !canEditWebhook && app.webhook_url) {
            webhookInput.style.filter = 'blur(4px)';
            webhookInput.style.userSelect = 'none';
            webhookInput.style.webkitUserSelect = 'none';
            webhookInput.style.mozUserSelect = 'none';
            webhookInput.style.msUserSelect = 'none';
        } else if (webhookInput && canEditWebhook) {
            webhookInput.style.filter = '';
            webhookInput.style.userSelect = '';
            webhookInput.style.webkitUserSelect = '';
            webhookInput.style.mozUserSelect = '';
            webhookInput.style.msUserSelect = '';
        }
        
        applyRowPermission(refreshBtn, userPermissions['applications']?.edit?.['app-id'], 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(updateNameBtn, userPermissions['applications']?.edit?.name, 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(deleteAllBtn, userPermissions['licenses']?.deleteAll, 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(statusSelect, userPermissions['applications']?.edit?.status, 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(hwidSelect, userPermissions['applications']?.edit?.hwid, 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(versionInput, userPermissions['applications']?.edit?.version, 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(versionUpdateBtn, userPermissions['applications']?.edit?.version, 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(webhookInput, userPermissions['applications']?.edit?.webhook, 'No Permissions, Lack of administrator Consent.', false);
        applyRowPermission(webhookUpdateBtn, userPermissions['applications']?.edit?.webhook, 'No Permissions, Lack of administrator Consent.', false);
        
        // Show modal
        document.getElementById('edit-application-modal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading application:', error);
        showEditMessage('Error loading application', 'error');
    }
}

function lockElement(element, message, showText = true) {
    if (!element) return;
    element.classList.add('permission-locked');
    if (!element.querySelector('.permission-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'permission-overlay';
        overlay.innerHTML = `
            <div class="lock-icon"></div>
            ${showText ? `<div>${message || 'No Permissions, Lack of administrator Consent.'}</div>` : ''}
        `;
        element.appendChild(overlay);
    }
}

function disableElement(element) {
    if (!element) return;
    element.classList.add('permission-disabled');
    element.setAttribute('disabled', 'disabled');
    element.setAttribute('aria-disabled', 'true');
    element.tabIndex = -1;
}

function applyRowPermission(control, allowed, message, showText = true) {
    if (!control) return;
    const row = control.closest('.full-table-row');
    // If allowed is false, undefined, or null, lock the row
    if (!allowed && row) {
        lockElement(row, message || 'No Permissions, Lack of administrator Consent.', showText);
        row.querySelectorAll('input, select, button, textarea').forEach(disableElement);
    } else if (allowed && row) {
        // If allowed, make sure the row is not locked
        row.classList.remove('permission-locked');
        const overlay = row.querySelector('.permission-overlay');
        if (overlay) {
            overlay.remove();
        }
        row.querySelectorAll('input, select, button, textarea').forEach(el => {
            el.removeAttribute('disabled');
            el.removeAttribute('aria-disabled');
            el.classList.remove('permission-disabled');
            if (el.hasAttribute('tabIndex') && el.getAttribute('tabIndex') === '-1') {
                el.removeAttribute('tabIndex');
            }
        });
    }
}

// Close edit modal
function closeEditModal() {
    document.getElementById('edit-application-modal').style.display = 'none';
    currentEditAppId = null;
    currentEditApp = null;
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const actionButton = e.target.closest('[data-action]');
    if (actionButton) {
        const action = actionButton.getAttribute('data-action');
        const appId = actionButton.getAttribute('data-app-id');
        const appName = actionButton.getAttribute('data-app-name');

        if (action === 'edit-application') {
            editApplication(appId);
            return;
        }
        if (action === 'view-licenses') {
            viewApplicationLicenses(appId);
            return;
        }
        if (action === 'delete-application') {
            deleteApplication(appId, appName || '');
            return;
        }
    }

    const modal = document.getElementById('edit-application-modal');
    if (e.target === modal) {
        closeEditModal();
    }
});

// Refresh APP-ID
async function refreshAppId() {
    if (!currentEditAppId) return;
    
    if (!confirm('Are you sure you want to refresh the APP-ID? This will update all related licenses.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/applications/${currentEditAppId}/refresh-app-id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showEditMessage(`APP-ID refreshed successfully! New APP-ID: ${data.new_app_id}`, 'success');
            currentEditAppId = data.new_app_id;
            await loadApplications();
        } else {
            showEditMessage(data.error || 'Error refreshing APP-ID', 'error');
        }
    } catch (error) {
        console.error('Error refreshing APP-ID:', error);
        showEditMessage('Error refreshing APP-ID', 'error');
    }
}

// Update application name
async function updateApplicationName() {
    if (!currentEditAppId || !currentEditApp) return;
    
    const newName = document.getElementById('edit-new-name').value.trim();
    const confirmName = document.getElementById('edit-confirm-name').value.trim();
    
    if (!newName || !confirmName) {
        showEditMessage('Please fill in both fields', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/applications/${currentEditAppId}/update-name`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                new_name: newName,
                current_name: confirmName
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showEditMessage('Application name updated successfully!', 'success');
            document.getElementById('edit-new-name').value = '';
            document.getElementById('edit-confirm-name').value = '';
            currentEditApp.name = newName;
            await loadApplications();
        } else {
            showEditMessage(data.error || 'Error updating application name', 'error');
        }
    } catch (error) {
        console.error('Error updating application name:', error);
        showEditMessage('Error updating application name', 'error');
    }
}

// Delete all licenses
async function deleteAllLicenses() {
    if (!currentEditAppId || !currentEditApp) return;
    
    const confirmName = document.getElementById('edit-delete-confirm-name').value.trim();
    
    if (!confirmName) {
        showEditMessage('Please enter the application name to confirm', 'error');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete ALL licenses for "${currentEditApp.name}"? This action cannot be undone!`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/applications/${currentEditAppId}/delete-all-licenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                application_name: confirmName
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showEditMessage(`Successfully deleted ${data.deleted_count} license(s)`, 'success');
            document.getElementById('edit-delete-confirm-name').value = '';
        } else {
            showEditMessage(data.error || 'Error deleting licenses', 'error');
        }
    } catch (error) {
        console.error('Error deleting licenses:', error);
        showEditMessage('Error deleting licenses', 'error');
    }
}

// Update status
async function updateStatus() {
    if (!currentEditAppId) return;
    
    const status = document.getElementById('edit-status').value;
    
    try {
        const response = await fetch(`${API_URL}/applications/${currentEditAppId}/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showEditMessage('Application status updated successfully!', 'success');
            currentEditApp.status = status;
            await loadApplications();
        } else {
            showEditMessage(data.error || 'Error updating status', 'error');
        }
    } catch (error) {
        console.error('Error updating status:', error);
        showEditMessage('Error updating status', 'error');
    }
}

// Update HWID Lock
async function updateHwidLock() {
    if (!currentEditAppId) return;
    
    const hwidLockEnabled = document.getElementById('edit-hwid-lock').value === 'true';
    
    try {
        const response = await fetch(`${API_URL}/applications/${currentEditAppId}/update-hwid-lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hwid_lock_enabled: hwidLockEnabled })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showEditMessage('HWID Lock status updated successfully!', 'success');
            currentEditApp.hwid_lock_enabled = hwidLockEnabled ? 1 : 0;
            await loadApplications();
        } else {
            showEditMessage(data.error || 'Error updating HWID Lock', 'error');
        }
    } catch (error) {
        console.error('Error updating HWID Lock:', error);
        showEditMessage('Error updating HWID Lock', 'error');
    }
}

// Update version
async function updateVersion() {
    if (!currentEditAppId) return;
    
    const version = document.getElementById('edit-version').value.trim();
    
    if (!version) {
        showEditMessage('Please enter a version', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/applications/${currentEditAppId}/update-version`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showEditMessage('Application version updated successfully!', 'success');
            currentEditApp.version = version;
            await loadApplications();
        } else {
            showEditMessage(data.error || 'Error updating version', 'error');
        }
    } catch (error) {
        console.error('Error updating version:', error);
        showEditMessage('Error updating version', 'error');
    }
}

// Update webhook
async function updateWebhook() {
    if (!currentEditAppId) return;
    
    const webhookUrl = document.getElementById('edit-webhook').value.trim();
    
    try {
        const response = await fetch(`${API_URL}/applications/${currentEditAppId}/update-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook_url: webhookUrl || null })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showEditMessage('Webhook URL updated successfully!', 'success');
            currentEditApp.webhook_url = webhookUrl || null;
            await loadApplications();
        } else {
            showEditMessage(data.error || 'Error updating webhook', 'error');
        }
    } catch (error) {
        console.error('Error updating webhook:', error);
        showEditMessage('Error updating webhook', 'error');
    }
}

// Show message in edit modal
function showEditMessage(text, type) {
    const messageDiv = document.getElementById('edit-modal-message');
    if (!messageDiv) return;
    
    messageDiv.textContent = text;
    messageDiv.style.color = type === 'success' ? '#28a745' : '#dc3545';
    messageDiv.style.fontWeight = '600';
    messageDiv.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
    messageDiv.style.border = `1px solid ${type === 'success' ? '#c3e6cb' : '#f5c6cb'}`;
    messageDiv.style.padding = '10px';
    messageDiv.style.borderRadius = '5px';
    messageDiv.style.marginTop = '20px';
    
    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.style.background = '';
        messageDiv.style.border = '';
        messageDiv.style.padding = '';
    }, 5000);
}

// View application licenses
function viewApplicationLicenses(appId) {
    // Redirect to licenses page with app filter
    window.location.href = `index.html?app_id=${appId}`;
}

// Delete application with confirmation
async function deleteApplication(appId, appName) {
    // Show confirmation prompt
    const confirmName = prompt(`To delete this application, please type the application name:\n\n"${appName}"`);
    
    if (!confirmName) {
        return; // User cancelled
    }
    
    if (confirmName.trim() !== appName) {
        alert('Application name does not match. Deletion cancelled.');
        return;
    }
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${appName}"?\n\nThis will also delete ALL licenses associated with this application. This action cannot be undone!`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/applications/${appId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            showTableMessage(data.error || 'Error deleting application', 'error');
            return;
        }
        
        showTableMessage('Application deleted successfully', 'success');
        // Reload applications
        await loadApplications();
    } catch (error) {
        console.error('Error deleting application:', error);
        showTableMessage('Error deleting application', 'error');
    }
}

// Show message for table caption
function showTableMessage(text, type) {
    const messageDiv = document.getElementById('table-caption');
    if (!messageDiv) return;
    
    const originalText = messageDiv.textContent;
    messageDiv.textContent = text;
    messageDiv.style.color = type === 'success' ? '#28a745' : '#dc3545';
    messageDiv.style.fontWeight = '600';
    
    setTimeout(() => {
        messageDiv.textContent = originalText;
        messageDiv.style.color = '';
        messageDiv.style.fontWeight = '';
    }, 3000);
}

// Create new application
async function createApplication(e) {
    e.preventDefault();
    
    const name = document.getElementById('application-name').value.trim();
    const description = document.getElementById('application-description').value.trim();
    
    if (!name) {
        showMessage('Application name is required', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(`Application "${name}" created successfully! APP-ID: ${data.app_id}`, 'success');
            // Reset form
            document.getElementById('application-name').value = '';
            document.getElementById('application-description').value = '';
            // Reload applications
            await loadApplications();
        } else {
            showMessage(data.error || 'Error creating application', 'error');
        }
    } catch (error) {
        console.error('Error creating application:', error);
        showMessage('Error creating application', 'error');
    }
}

// Show message
function showMessage(text, type) {
    const messageDiv = document.getElementById('create-app-message');
    if (!messageDiv) return;
    
    messageDiv.textContent = text;
    messageDiv.style.color = type === 'success' ? '#28a745' : '#dc3545';
    messageDiv.style.fontWeight = '600';
    messageDiv.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
    messageDiv.style.border = `1px solid ${type === 'success' ? '#c3e6cb' : '#f5c6cb'}`;
    messageDiv.style.padding = '10px';
    messageDiv.style.borderRadius = '5px';
    
    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.style.background = '';
        messageDiv.style.border = '';
        messageDiv.style.padding = '';
    }, 5000);
}

// Initialize on page load
window.addEventListener('load', async () => {
    // Load user info and permissions first
    await loadUserInfo();
    
    await loadApplications();
    
    // Setup create application form
    const createForm = document.getElementById('create-application-form');
    if (createForm) {
        createForm.addEventListener('submit', createApplication);
    }
    
    // Setup status and HWID lock change handlers
    const statusSelect = document.getElementById('edit-status');
    if (statusSelect) {
        statusSelect.addEventListener('change', updateStatus);
    }
    
    const hwidLockSelect = document.getElementById('edit-hwid-lock');
    if (hwidLockSelect) {
        hwidLockSelect.addEventListener('change', updateHwidLock);
    }
});

