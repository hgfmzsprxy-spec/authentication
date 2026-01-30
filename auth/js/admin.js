// Dynamic API URL - works on Vercel and localhost
// Detect base path from current location
const getBasePath = () => {
    const pathname = window.location.pathname;
    // If pathname is like /authentication/admin.html, extract /authentication
    const match = pathname.match(/^(\/[^\/]+)/);
    return match ? match[1] : '';
};

const basePath = getBasePath();
let API_URL = `${window.location.origin}${basePath}/api`;

// Fallback to localhost for local development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    API_URL = 'http://localhost:3000/api';
}

let allUsers = [];
let currentEditUserId = null;
let isCreatingNewUser = false;
let pendingUserEmail = '';
let userPermissions = {};
let currentBanUserId = null;
let availableApps = [];
let currentLogsUserId = null;
let allUserLogs = [];
let filteredUserLogs = [];

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
                    // Get first letter of email
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
    } catch (error) {
        console.error('Error loading permissions:', error);
    }
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

// Load dashboard stats
async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/admin/stats`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Failed to load stats');
        }
        
        const stats = await response.json();
        
        // Update stat cards
        const statModules = document.querySelectorAll('._4-grid .module');
        if (statModules.length >= 4) {
            // Users
            if (statModules[0]) {
                const numberEl = statModules[0].querySelector('.number');
                const captionEl = statModules[0].querySelector('.caption');
                if (numberEl) numberEl.textContent = stats.totalUsers || 0;
                if (captionEl) captionEl.textContent = 'Users';
            }
            // Total Licenses
            if (statModules[1]) {
                const numberEl = statModules[1].querySelector('.number');
                const captionEl = statModules[1].querySelector('.caption');
                if (numberEl) numberEl.textContent = stats.totalLicenses || 0;
                if (captionEl) captionEl.textContent = 'Total Licenses';
            }
            // Total Applications
            if (statModules[2]) {
                const numberEl = statModules[2].querySelector('.number');
                const captionEl = statModules[2].querySelector('.caption');
                if (numberEl) numberEl.textContent = stats.totalApplications || 0;
                if (captionEl) captionEl.textContent = 'Total Applications';
            }
            // Total Banned Licenses
            if (statModules[3]) {
                const numberEl = statModules[3].querySelector('.number');
                const captionEl = statModules[3].querySelector('.caption');
                if (numberEl) numberEl.textContent = stats.totalBannedLicenses || 0;
                if (captionEl) captionEl.textContent = 'Total Banned Licenses';
            }
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load all users
async function loadUsers() {
    try {
        const response = await fetch(`${API_URL}/admin/users`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                window.location.href = 'login.html';
                return;
            }
            throw new Error('Failed to load users');
        }
        
        const users = await response.json();
        allUsers = users;
        renderUsersTable(users);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function loadAvailableApps() {
    try {
        const response = await fetch(`${API_URL}/applications`, {
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error('Failed to load applications');
        }
        availableApps = await response.json();
    } catch (error) {
        console.error('Error loading applications for access:', error);
        availableApps = [];
    }
}

function renderAppAccessList(selectedIds = []) {
    const container = document.getElementById('app-access-list');
    if (!container) return;
    container.innerHTML = '';
    if (!availableApps.length) {
        const empty = document.createElement('div');
        empty.className = 'small-text text-grey-3';
        empty.textContent = 'No applications available.';
        container.appendChild(empty);
        return;
    }
    availableApps.forEach(app => {
        const isChecked = selectedIds.includes(app.app_id);
        const row = document.createElement('div');
        row.className = 'full-table-row';
        row.style.padding = '10px 0';
        row.innerHTML = `
            <div>
                <h6 class="no-space-bottom">${app.name}</h6>
                <div class="small-text text-grey-3">${app.app_id}</div>
            </div>
            <div class="form-block w-form">
                <label class="w-checkbox switch-field">
                    <div class="w-checkbox-input w-checkbox-input--inputType-custom switch-input ${isChecked ? 'w--redirected-checked' : ''}"></div>
                    <input type="checkbox" class="app-access-checkbox" data-app-id="${app.app_id}" ${isChecked ? 'checked' : ''} style="opacity:0;position:absolute;z-index:-1">
                    <span class="checkbox-label hidden w-form-label"></span>
                </label>
            </div>
        `;
        container.appendChild(row);
    });
    bindPermissionSwitches();
}

function getSelectedAppAccess() {
    const inputs = document.querySelectorAll('.app-access-checkbox');
    const selected = [];
    inputs.forEach(input => {
        if (input.checked) {
            selected.push(input.dataset.appId);
        }
    });
    return selected;
}

// Render users table
function renderUsersTable(users) {
    const tableBody = document.getElementById('users-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (users.length === 0) {
        const emptyRow = document.createElement('div');
        emptyRow.className = 'table-row-link';
        emptyRow.style.display = 'contents';
        emptyRow.innerHTML = `
            <div class="w-layout-grid table-row" style="grid-column: 1 / -1; grid-template-columns: 0.6fr 2fr 1.5fr 1.2fr 1.2fr 1.2fr 1.2fr 1.4fr 2fr;">
                <div class="table-title" style="grid-column: 1 / -1; text-align: center; padding: 20px;">
                    No users found
                </div>
            </div>
        `;
        tableBody.appendChild(emptyRow);
        return;
    }
    
    users.forEach(user => {
        const row = createUserRow(user);
        tableBody.appendChild(row);
    });
}

function countPermissionLeaves(node) {
    if (!node) return 0;
    if (typeof node === 'boolean') {
        return node ? 1 : 0;
    }
    if (typeof node !== 'object') {
        return 0;
    }
    return Object.values(node).reduce((sum, value) => sum + countPermissionLeaves(value), 0);
}

// Create user row
function createUserRow(user) {
    const row = document.createElement('div');
    row.className = 'table-row-link';
    row.style.display = 'contents';
    
    const status = user.status || 'Pending';
    let statusClass = 'bg-primary-blue';
    if (status === 'Active') {
        statusClass = 'bg-primary-green';
    }
    if (status === 'Banned') {
        statusClass = 'bg-primary-rose';
    }
    
    const avatarContent = user.avatar_url
        ? `<img src="${user.avatar_url}" alt="" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover;">`
        : `<div style="width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 0.9em;">${(user.email || 'U').charAt(0).toUpperCase()}</div>`;

    const displayName = user.display_name || '-';
    const permissionsCount = countPermissionLeaves(user.permissions || {});
    
    const totalLicenses = user.total_licenses || 0;
    const appAccessCount = user.app_access_count || 0;
    const keys24h = user.keys_24h || 0;

    row.innerHTML = `
        <div class="w-layout-grid table-row" style="grid-column: 1 / -1; align-items: center; grid-template-columns: 0.6fr 2fr 1.5fr 1.2fr 1.2fr 1.2fr 1.2fr 1.4fr 2fr;">
            <div style="display: flex; align-items: center; gap: 8px;">${avatarContent}</div>
            <div class="table-title" style="white-space: nowrap; overflow: visible;">${user.email}</div>
            <div class="table-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</div>
            <div class="status" style="display: flex; align-items: center; gap: 5px; white-space: nowrap;">
                <div class="indication-color ${statusClass}"></div>
                <div>${status}</div>
            </div>
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.9em;">
                ${totalLicenses}
            </div>
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.9em;">
                ${appAccessCount}
            </div>
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.9em;">
                ${keys24h}
            </div>
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${permissionsCount} permissions
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: nowrap; align-items: center; white-space: nowrap; overflow: visible;">
                <button onclick="editUserPermissions(${user.id})" style="padding: 5px 10px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Edit Permissions">Edit</button>
                ${status === 'Banned' ? `<button onclick="unbanUser(${user.id})" style="padding: 5px 10px; background: #9e9e9e; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Unban User">Unban</button>` : `<button onclick="openBanModal(${user.id}, '${user.email.replace(/'/g, "\\'")}')" style="padding: 5px 10px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Ban User">Ban</button>`}
                <button onclick="openUserLogsModal(${user.id}, '${user.email.replace(/'/g, "\\'")}')" style="padding: 5px 10px; background: #2196f3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="View User Logs">Logs</button>
                <button onclick="openWarnModal(${user.id}, '${user.email.replace(/'/g, "\\'")}')" style="padding: 5px 10px; background: #ffb731; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Warn User">Warn</button>
                <button onclick="deleteUser(${user.id}, '${user.email.replace(/'/g, "\\'")}')" style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Delete User">Delete</button>
            </div>
        </div>
    `;
    
    return row;
}

function openBanModal(userId, email) {
    currentBanUserId = userId;
    const modal = document.getElementById('ban-modal');
    const title = document.getElementById('ban-modal-title');
    const message = document.getElementById('ban-message');
    const durationInput = document.getElementById('ban-duration-value');
    const reasonInput = document.getElementById('ban-reason');
    if (title) {
        title.textContent = `Ban ${email}`;
    }
    if (message) {
        message.textContent = '';
        message.style.color = '#f44336';
    }
    if (durationInput) durationInput.value = '';
    if (reasonInput) reasonInput.value = '';
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeBanModal() {
    const modal = document.getElementById('ban-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

let currentWarnUserId = null;

function openWarnModal(userId, email) {
    currentWarnUserId = userId;
    const modal = document.getElementById('warn-modal');
    const title = document.getElementById('warn-modal-title');
    const message = document.getElementById('warn-message');
    const reasonInput = document.getElementById('warn-reason');
    if (title) {
        title.textContent = `Warn ${email}`;
    }
    if (message) {
        message.textContent = '';
        message.style.color = '#ffb731';
    }
    if (reasonInput) reasonInput.value = '';
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeWarnModal() {
    const modal = document.getElementById('warn-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    currentWarnUserId = null;
}

async function submitWarn() {
    const reason = document.getElementById('warn-reason')?.value || '';
    const message = document.getElementById('warn-message');

    if (!reason.trim()) {
        if (message) {
            message.textContent = 'Please provide a reason for the warning.';
            message.style.color = '#f44336';
        }
        return;
    }

    if (!currentWarnUserId) {
        if (message) {
            message.textContent = 'No user selected.';
            message.style.color = '#f44336';
        }
        return;
    }

    try {
        const response = await fetch(`${API_URL}/admin/users/${currentWarnUserId}/warn`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ reason })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            if (message) {
                message.textContent = 'User warned successfully.';
                message.style.color = '#4caf50';
            }
            setTimeout(() => {
                closeWarnModal();
                loadUsers();
            }, 1000);
        } else {
            if (message) {
                message.textContent = data.error || 'Failed to warn user.';
                message.style.color = '#f44336';
            }
        }
    } catch (error) {
        if (message) {
            message.textContent = 'Failed to warn user.';
            message.style.color = '#f44336';
        }
        console.error('Error warning user:', error);
    }
}

async function submitBan() {
    const durationValue = document.getElementById('ban-duration-value')?.value;
    const durationUnit = document.getElementById('ban-duration-unit')?.value || 'days';
    const reason = document.getElementById('ban-reason')?.value || '';
    const message = document.getElementById('ban-message');

    if (!currentBanUserId) return;
    if (!durationValue || parseInt(durationValue) <= 0) {
        if (message) {
            message.textContent = 'Please enter a valid duration.';
            message.style.color = '#f44336';
        }
        return;
    }

    try {
        const response = await fetch(`${API_URL}/admin/users/${currentBanUserId}/ban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                duration_value: parseInt(durationValue),
                duration_unit: durationUnit,
                reason: reason
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            if (message) {
                message.textContent = data.error || 'Failed to ban user.';
                message.style.color = '#f44336';
            }
            return;
        }
        closeBanModal();
        await loadUsers();
    } catch (error) {
        if (message) {
            message.textContent = 'Failed to ban user.';
            message.style.color = '#f44336';
        }
    }
}

async function unbanUser(userId) {
    if (!confirm('Unban this user?')) return;
    try {
        const response = await fetch(`${API_URL}/admin/users/${userId}/unban`, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showMessage(data.error || 'Failed to unban user', 'error');
            return;
        }
        await loadUsers();
    } catch (error) {
        showMessage('Failed to unban user', 'error');
    }
}

// Create new user - opens permissions modal first
function createUser() {
    console.log('createUser() called');
    const emailInput = document.getElementById('new-user-email');
    if (!emailInput) {
        console.error('Email input not found!');
        showMessage('Email input not found', 'error');
        return;
    }
    
    const email = emailInput.value.trim();
    console.log('Email:', email);
    
    if (!email) {
        showMessage('Please enter an email address', 'error');
        return;
    }
    
    if (!email.includes('@')) {
        showMessage('Please enter a valid email address', 'error');
        return;
    }
    
    // Set creating mode
    isCreatingNewUser = true;
    currentEditUserId = null;
    pendingUserEmail = email;
    
    // Reset permissions form
    resetPermissionsForm();
    if (!availableApps.length) {
        loadAvailableApps().then(() => renderAppAccessList([]));
    } else {
        renderAppAccessList([]);
    }
    
    // Get modal
    const modal = document.getElementById('permissions-modal');
    if (!modal) {
        console.error('Permissions modal not found!');
        showMessage('Permissions modal not found', 'error');
        return;
    }
    
    // Update modal title to show email
    const modalTitle = document.querySelector('#permissions-modal .modal-header h3');
    if (modalTitle) {
        modalTitle.textContent = `Set Permissions for ${email}`;
    } else {
        console.warn('Modal title not found');
    }
    
    // Update save button text
    const saveButton = document.getElementById('save-permissions-btn');
    if (saveButton) {
        saveButton.textContent = 'Create User';
    } else {
        console.warn('Save button not found');
    }
    
    // Show modal - use both inline style and class
    console.log('Showing modal...');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.classList.add('active');
    
    // Ensure modal card is visible
    const modalCard = modal.querySelector('.modal-card');
    if (modalCard) {
        modalCard.style.transform = 'scale(1) translateY(0)';
        modalCard.style.opacity = '1';
    }
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
    
    console.log('Modal should be visible now');
}

// Reset permissions form to default (all unchecked)
function resetPermissionsForm() {
    // Security Logs
    document.getElementById('perm-security-view').checked = false;
    document.getElementById('perm-security-edit').checked = false;
    
    // Custom Messages
    document.getElementById('perm-messages-view').checked = false;
    document.getElementById('perm-messages-edit').checked = false;
    
    // Applications
    document.getElementById('perm-apps-create').checked = false;
    document.getElementById('perm-apps-edit').checked = false;
    document.getElementById('perm-apps-delete').checked = false;
    document.getElementById('perm-licenses-delete-all').checked = false;
    
    // Application edit options
    document.getElementById('perm-apps-edit-name').checked = false;
    document.getElementById('perm-apps-edit-version').checked = false;
    document.getElementById('perm-apps-edit-status').checked = false;
    document.getElementById('perm-apps-edit-webhook').checked = false;
    document.getElementById('perm-apps-edit-hwid').checked = false;
    document.getElementById('perm-apps-edit-appid').checked = false;
    
    // Licenses
    document.getElementById('perm-licenses-view').checked = false;
    document.getElementById('perm-licenses-create').checked = false;
    document.getElementById('perm-licenses-edit').checked = false;
    document.getElementById('perm-licenses-delete').checked = false;
    document.getElementById('perm-licenses-ban').checked = false;
    document.getElementById('perm-licenses-reset-hwid').checked = false;
    document.getElementById('perm-licenses-extend').checked = false;
    document.getElementById('perm-licenses-pause').checked = false;
    document.getElementById('perm-resellers-view').checked = false;

    const accessInputs = document.querySelectorAll('.app-access-checkbox');
    accessInputs.forEach(input => {
        input.checked = false;
        const switchEl = input.closest('label')?.querySelector('.switch-input');
        if (switchEl) {
            switchEl.classList.remove('w--redirected-checked');
        }
    });

    refreshPermissionSwitches();
}

// Edit user permissions
function editUserPermissions(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    if (!availableApps.length) {
        loadAvailableApps().then(() => {
            renderAppAccessList(user.app_access || []);
        });
    }
    
    // Set editing mode
    isCreatingNewUser = false;
    currentEditUserId = userId;
    pendingUserEmail = '';
    
    // Populate permissions form
    const permissions = user.permissions || {};
    
    // Security Logs
    document.getElementById('perm-security-view').checked = permissions['security_logs']?.view || false;
    document.getElementById('perm-security-edit').checked = permissions['security_logs']?.edit || false;
    
    // Custom Messages
    document.getElementById('perm-messages-view').checked = permissions['custom_messages']?.view || false;
    document.getElementById('perm-messages-edit').checked = permissions['custom_messages']?.edit || false;
    
    // Applications
    document.getElementById('perm-apps-create').checked = permissions['applications']?.create || false;
    document.getElementById('perm-apps-edit').checked = permissions['applications']?.edit || false;
    document.getElementById('perm-apps-delete').checked = permissions['applications']?.delete || false;
    document.getElementById('perm-licenses-delete-all').checked = permissions['licenses']?.deleteAll || false;
    
    // Application edit options
    if (permissions['applications']?.editOptions) {
        const editOpts = permissions['applications'].editOptions;
        document.getElementById('perm-apps-edit-name').checked = editOpts.name || false;
        document.getElementById('perm-apps-edit-version').checked = editOpts.version || false;
        document.getElementById('perm-apps-edit-status').checked = editOpts.status || false;
        document.getElementById('perm-apps-edit-webhook').checked = editOpts.webhook || false;
        document.getElementById('perm-apps-edit-hwid').checked = editOpts.hwid || false;
        document.getElementById('perm-apps-edit-appid').checked = editOpts.appid || false;
    } else {
        // Reset if no editOptions
        document.getElementById('perm-apps-edit-name').checked = false;
        document.getElementById('perm-apps-edit-version').checked = false;
        document.getElementById('perm-apps-edit-status').checked = false;
        document.getElementById('perm-apps-edit-webhook').checked = false;
        document.getElementById('perm-apps-edit-hwid').checked = false;
        document.getElementById('perm-apps-edit-appid').checked = false;
    }
    
    // Licenses
    document.getElementById('perm-licenses-view').checked = permissions['licenses']?.view || false;
    document.getElementById('perm-licenses-create').checked = permissions['licenses']?.create || false;
    document.getElementById('perm-licenses-edit').checked = permissions['licenses']?.edit || false;
    document.getElementById('perm-licenses-delete').checked = permissions['licenses']?.delete || false;
    document.getElementById('perm-licenses-ban').checked = permissions['licenses']?.ban || false;
    document.getElementById('perm-licenses-reset-hwid').checked = permissions['licenses']?.resetHwid || false;
    document.getElementById('perm-licenses-extend').checked = permissions['licenses']?.extend || false;
    document.getElementById('perm-licenses-pause').checked = permissions['licenses']?.pause || false;
    document.getElementById('perm-resellers-view').checked = permissions['resellers']?.view || false;

    refreshPermissionSwitches();
    
    // Update modal title
    const modalTitle = document.querySelector('#permissions-modal .modal-header h3');
    if (modalTitle) {
        modalTitle.textContent = `Edit Permissions for ${user.email}`;
    }
    
    // Update save button text
    const saveButton = document.getElementById('save-permissions-btn');
    if (saveButton) {
        saveButton.textContent = 'Save Permissions';
    }
    
    // Show modal - match create flow
    const modal = document.getElementById('permissions-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.classList.add('active');

    const modalCard = modal.querySelector('.modal-card');
    if (modalCard) {
        modalCard.style.transform = 'scale(1) translateY(0)';
        modalCard.style.opacity = '1';
    }

    document.body.style.overflow = 'hidden';
    renderAppAccessList(user.app_access || []);
}

// Save user permissions
async function saveUserPermissions() {
    // Collect permissions
    const permissions = {
        security_logs: {
            view: document.getElementById('perm-security-view').checked,
            edit: document.getElementById('perm-security-edit').checked
        },
        custom_messages: {
            view: document.getElementById('perm-messages-view').checked,
            edit: document.getElementById('perm-messages-edit').checked
        },
        applications: {
            create: document.getElementById('perm-apps-create').checked,
            edit: document.getElementById('perm-apps-edit').checked,
            delete: document.getElementById('perm-apps-delete').checked,
            editOptions: {
                name: document.getElementById('perm-apps-edit-name').checked,
                version: document.getElementById('perm-apps-edit-version').checked,
                status: document.getElementById('perm-apps-edit-status').checked,
                webhook: document.getElementById('perm-apps-edit-webhook').checked,
                hwid: document.getElementById('perm-apps-edit-hwid').checked,
                appid: document.getElementById('perm-apps-edit-appid').checked
            }
        },
        licenses: {
            view: document.getElementById('perm-licenses-view').checked,
            create: document.getElementById('perm-licenses-create').checked,
            edit: document.getElementById('perm-licenses-edit').checked,
            delete: document.getElementById('perm-licenses-delete').checked,
            ban: document.getElementById('perm-licenses-ban').checked,
            resetHwid: document.getElementById('perm-licenses-reset-hwid').checked,
            extend: document.getElementById('perm-licenses-extend').checked,
            pause: document.getElementById('perm-licenses-pause').checked,
            deleteAll: document.getElementById('perm-licenses-delete-all').checked
        },
        resellers: {
            view: document.getElementById('perm-resellers-view').checked
        }
    };
    const allowedAppIds = getSelectedAppAccess();
    
    try {
        if (isCreatingNewUser) {
            // Create new user with permissions
            if (!pendingUserEmail) {
                showMessage('Email is required', 'error');
                return;
            }
            
            const response = await fetch(`${API_URL}/admin/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ email: pendingUserEmail, permissions, allowed_app_ids: allowedAppIds })
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to create user');
            }
            
            const data = await response.json();
            
            if (data.success) {
                showMessage('User created successfully with permissions!', 'success');
                // Clear email input
                document.getElementById('new-user-email').value = '';
                closePermissionsModal();
                await loadUsers();
                await loadStats();
            }
        } else {
            // Update existing user permissions
            if (!currentEditUserId) {
                showMessage('User ID is required', 'error');
                return;
            }
            
            const response = await fetch(`${API_URL}/admin/users/${currentEditUserId}/permissions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ permissions, allowed_app_ids: allowedAppIds })
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to save permissions');
            }
            
            const data = await response.json();
            
            if (data.success) {
                showMessage('Permissions saved successfully!', 'success');
                closePermissionsModal();
                await loadUsers();
            }
        }
    } catch (error) {
        showMessage(error.message || 'Error saving permissions', 'error');
        console.error('Error saving permissions:', error);
    }
}

// Close permissions modal
function closePermissionsModal() {
    const modal = document.getElementById('permissions-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.style.opacity = '0';
        modal.classList.remove('active');
    }
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    currentEditUserId = null;
    isCreatingNewUser = false;
    pendingUserEmail = '';
    resetPermissionsForm();
}

// Delete user
async function deleteUser(userId, email) {
    if (!confirm(`Are you sure you want to delete user "${email}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/admin/users/${userId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete user');
        }
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('User deleted successfully!', 'success');
            await loadUsers();
            await loadStats();
        }
    } catch (error) {
        showMessage(error.message || 'Error deleting user', 'error');
        console.error('Error deleting user:', error);
    }
}

// Show message
function showMessage(text, type) {
    const messageDiv = document.getElementById('admin-message');
    if (!messageDiv) return;
    
    messageDiv.textContent = text;
    messageDiv.className = type === 'success' ? 'success-message' : 'error-message';
    messageDiv.style.display = 'block';
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

function bindPermissionSwitches() {
    const modal = document.getElementById('permissions-modal');
    if (!modal) return;

    const inputs = modal.querySelectorAll('input[type="checkbox"]');
    inputs.forEach((input) => {
        if (input.dataset.switchBound === 'true') return;
        const label = input.closest('label.w-checkbox.switch-field');
        const switchEl = label ? label.querySelector('.switch-input') : null;
        const update = () => {
            if (!switchEl) return;
            switchEl.classList.toggle('w--redirected-checked', input.checked);
        };
        input.addEventListener('change', update);
        input.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        input.dataset.switchBound = 'true';
        update();
    });
}

function refreshPermissionSwitches() {
    const modal = document.getElementById('permissions-modal');
    if (!modal) return;
    const inputs = modal.querySelectorAll('input[type="checkbox"]');
    inputs.forEach((input) => {
        const label = input.closest('label.w-checkbox.switch-field');
        const switchEl = label ? label.querySelector('.switch-input') : null;
        if (!switchEl) return;
        switchEl.classList.toggle('w--redirected-checked', input.checked);
    });
}

// Initialize
window.addEventListener('load', async () => {
    // Load user info and permissions first
    await loadUserInfo();
    
    await loadStats();
    await loadAvailableApps();
    await loadUsers();
    
    // Setup create user form
    const createUserForm = document.getElementById('create-user-form');
    if (createUserForm) {
        console.log('Create user form found, adding event listener');
        createUserForm.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('Form submitted, calling createUser()');
            createUser();
        });
    } else {
        console.error('Create user form not found!');
    }
    
    // Setup permissions modal close
    const permissionsModal = document.getElementById('permissions-modal');
    if (permissionsModal) {
        permissionsModal.addEventListener('click', (e) => {
            if (e.target === permissionsModal) {
                closePermissionsModal();
            }
        });
    }

    const banModal = document.getElementById('ban-modal');
    if (banModal) {
        banModal.addEventListener('click', (e) => {
            if (e.target === banModal) {
                closeBanModal();
            }
        });
    }
    const confirmBanBtn = document.getElementById('confirm-ban-btn');
    if (confirmBanBtn) {
        confirmBanBtn.addEventListener('click', submitBan);
    }

    const warnModal = document.getElementById('warn-modal');
    if (warnModal) {
        warnModal.addEventListener('click', (e) => {
            if (e.target === warnModal) {
                closeWarnModal();
            }
        });
    }
    const confirmWarnBtn = document.getElementById('confirm-warn-btn');
    if (confirmWarnBtn) {
        confirmWarnBtn.addEventListener('click', submitWarn);
    }

    bindPermissionSwitches();
    
    // Initialize license format form
    const formatForm = document.getElementById('license-format-form');
    if (formatForm) {
        bindFormatSwitches();
        loadLicenseFormat();
        
        formatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const format = document.getElementById('license-format-input').value;
            const bigLetters = document.getElementById('format-big-letters').checked;
            const digits = document.getElementById('format-digits').checked;
            const specialChars = document.getElementById('format-special-chars').checked;
            
            if (!format) {
                showLicenseFormatMessage('Please enter a format', 'error');
                return;
            }
            
            try {
                const response = await fetch(`${API_URL}/admin/license-format`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        format,
                        options: {
                            bigLetters,
                            digits,
                            specialChars
                        }
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    showLicenseFormatMessage('License format saved successfully!', 'success');
                } else {
                    showLicenseFormatMessage(data.error || 'Error saving format', 'error');
                }
            } catch (error) {
                console.error('Error saving license format:', error);
                showLicenseFormatMessage('Error saving format', 'error');
            }
        });
    }
});

// User Logs Modal Functions
async function openUserLogsModal(userId, email) {
    currentLogsUserId = userId;
    const modal = document.getElementById('user-logs-modal');
    const title = document.getElementById('user-logs-modal-title');
    
    if (title) {
        title.textContent = `License Logs - ${email}`;
    }
    
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    
    // Load logs
    await loadUserLogs(userId);
    await loadAvailableAppsForLogs();
}

function closeUserLogsModal() {
    const modal = document.getElementById('user-logs-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    currentLogsUserId = null;
    allUserLogs = [];
    filteredUserLogs = [];
}

async function loadAvailableAppsForLogs() {
    try {
        const response = await fetch(`${API_URL}/applications`, {
            credentials: 'include'
        });
        if (response.ok) {
            const apps = await response.json();
            const select = document.getElementById('logs-filter-app');
            if (select) {
                select.innerHTML = '<option value="">All Applications</option>';
                apps.forEach(app => {
                    const option = document.createElement('option');
                    option.value = app.app_id;
                    option.textContent = app.name;
                    select.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error loading apps for filter:', error);
    }
}

async function loadUserLogs(userId) {
    try {
        const response = await fetch(`${API_URL}/admin/users/${userId}/logs`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load logs');
        }
        
        const logs = await response.json();
        allUserLogs = logs;
        filteredUserLogs = [...logs];
        renderLogsTable();
    } catch (error) {
        console.error('Error loading user logs:', error);
        const tableBody = document.getElementById('user-logs-table-body');
        if (tableBody) {
            tableBody.innerHTML = `
                <div class="w-layout-grid table-row" style="grid-column: 1 / -1; text-align: center; padding: 20px;">
                    <div class="table-title" style="grid-column: 1 / -1; color: #f44336;">Error loading logs</div>
                </div>
            `;
        }
    }
}

function renderLogsTable() {
    const tableBody = document.getElementById('user-logs-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (filteredUserLogs.length === 0) {
        tableBody.innerHTML = `
            <div class="w-layout-grid table-row" style="grid-column: 1 / -1; text-align: center; padding: 20px;">
                <div class="table-title" style="grid-column: 1 / -1;">No logs found</div>
            </div>
        `;
        return;
    }
    
    filteredUserLogs.forEach(log => {
        const row = createLogRow(log);
        tableBody.appendChild(row);
    });
}

function createLogRow(log) {
    const row = document.createElement('div');
    row.className = 'table-row-link';
    row.style.display = 'contents';
    
    const createdDate = new Date(log.created_at).toLocaleString();
    const expiresDate = log.expires_at ? new Date(log.expires_at).toLocaleString() : 'Unlimited';
    const status = log.is_banned ? 'Banned' : (log.is_active ? 'Active' : 'Inactive');
    const statusClass = log.is_banned ? 'bg-primary-rose' : (log.is_active ? 'bg-primary-green' : 'bg-primary-yellow');
    const hwidValue = log.locked_hwid || 'Not set';
    
    // Format duration
    let durationText = 'Unlimited';
    if (!log.is_unlimited && log.duration_value && log.duration_unit) {
        durationText = `${log.duration_value} ${log.duration_unit}`;
    } else if (log.is_unlimited) {
        durationText = 'Unlimited';
    }
    
    row.innerHTML = `
        <div class="w-layout-grid table-row" style="grid-column: 1 / -1; align-items: center; grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1.5fr;">
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; font-size: 0.85em;">${log.license_key}</div>
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${log.app_name || log.app_id}</div>
            <div style="white-space: nowrap; font-size: 0.9em;">${durationText}</div>
            <div style="white-space: nowrap; font-size: 0.9em;">${createdDate}</div>
            <div style="white-space: nowrap; font-size: 0.9em;">${expiresDate}</div>
            <div class="status" style="display: flex; align-items: center; gap: 5px; white-space: nowrap;">
                <div class="indication-color ${statusClass}"></div>
                <div>${status}</div>
            </div>
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.85em; font-family: monospace;">${hwidValue}</div>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center; white-space: nowrap; overflow: visible;">
                ${log.is_banned ? 
                    `<button onclick="unbanLicenseFromLogs('${log.license_key}')" style="padding: 4px 8px; background: #9e9e9e; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75em; white-space: nowrap;">Unban</button>` :
                    `<button onclick="banLicenseFromLogs('${log.license_key}')" style="padding: 4px 8px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75em; white-space: nowrap;">Ban</button>`
                }
                <button onclick="extendLicenseFromLogs('${log.license_key}')" style="padding: 4px 8px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75em; white-space: nowrap;">Extend</button>
                <button onclick="resetHwidFromLogs('${log.license_key}')" style="padding: 4px 8px; background: #2196f3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75em; white-space: nowrap;">HWID</button>
                <button onclick="deleteLicenseFromLogs('${log.license_key}')" style="padding: 4px 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75em; white-space: nowrap;">Delete</button>
            </div>
        </div>
    `;
    
    return row;
}

function applyLogsFilters() {
    const appFilter = document.getElementById('logs-filter-app')?.value || '';
    const dateFilter = document.getElementById('logs-filter-date')?.value || '';
    
    filteredUserLogs = allUserLogs.filter(log => {
        if (appFilter && log.app_id !== appFilter) return false;
        if (dateFilter) {
            const logDate = new Date(log.created_at).toISOString().split('T')[0];
            if (logDate !== dateFilter) return false;
        }
        return true;
    });
    
    renderLogsTable();
}

function clearLogsFilters() {
    document.getElementById('logs-filter-app').value = '';
    document.getElementById('logs-filter-date').value = '';
    filteredUserLogs = [...allUserLogs];
    renderLogsTable();
}

async function banLicenseFromLogs(licenseKey) {
    if (!confirm('Are you sure you want to ban this license?')) return;
    
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}/ban`, {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            await loadUserLogs(currentLogsUserId);
        } else {
            alert('Failed to ban license');
        }
    } catch (error) {
        console.error('Error banning license:', error);
        alert('Error banning license');
    }
}

async function unbanLicenseFromLogs(licenseKey) {
    if (!confirm('Are you sure you want to unban this license?')) return;
    
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}/unban`, {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            await loadUserLogs(currentLogsUserId);
        } else {
            alert('Failed to unban license');
        }
    } catch (error) {
        console.error('Error unbanning license:', error);
        alert('Error unbanning license');
    }
}

async function extendLicenseFromLogs(licenseKey) {
    const durationValue = prompt('Enter duration value:');
    if (!durationValue) return;
    
    const durationUnit = prompt('Enter duration unit (minutes/hours/days/weeks/months):');
    if (!durationUnit) return;
    
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                duration_value: parseInt(durationValue),
                duration_unit: durationUnit
            })
        });
        
        if (response.ok) {
            await loadUserLogs(currentLogsUserId);
        } else {
            alert('Failed to extend license');
        }
    } catch (error) {
        console.error('Error extending license:', error);
        alert('Error extending license');
    }
}

async function resetHwidFromLogs(licenseKey) {
    if (!confirm('Are you sure you want to reset HWID for this license?')) return;
    
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}/reset-hwid`, {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            await loadUserLogs(currentLogsUserId);
        } else {
            alert('Failed to reset HWID');
        }
    } catch (error) {
        console.error('Error resetting HWID:', error);
        alert('Error resetting HWID');
    }
}

async function deleteLicenseFromLogs(licenseKey) {
    if (!confirm('Are you sure you want to delete this license? This action cannot be undone.')) return;
    
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            await loadUserLogs(currentLogsUserId);
        } else {
            alert('Failed to delete license');
        }
    } catch (error) {
        console.error('Error deleting license:', error);
        alert('Error deleting license');
    }
}

async function deleteAllUserLicenses() {
    if (!currentLogsUserId) {
        alert('No user selected');
        return;
    }
    
    if (!confirm('Are you sure you want to delete ALL licenses for this user? This action cannot be undone!')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/admin/users/${currentLogsUserId}/delete-all-licenses`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            alert(`Successfully deleted ${data.deleted_count || 0} license(s)`);
            await loadUserLogs(currentLogsUserId);
        } else {
            alert(data.error || 'Failed to delete all licenses');
        }
    } catch (error) {
        console.error('Error deleting all licenses:', error);
        alert('Error deleting all licenses');
    }
}

// Load and display activity logs
async function loadActivityLogs() {
    const terminal = document.getElementById('activity-logs-terminal');
    if (!terminal) return;
    
    try {
        const response = await fetch(`${API_URL}/admin/logs`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            terminal.innerHTML = '<div style="color: #ff4444;">Error loading logs</div>';
            return;
        }
        
        const logs = await response.json();
        
        if (logs.length === 0) {
            terminal.innerHTML = '<div style="color: #888;">No activity logs yet</div>';
            return;
        }
        
        terminal.innerHTML = logs.map(log => {
            const date = new Date(log.created_at);
            const dateStr = date.toLocaleString('pl-PL', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            let actionText = '';
            switch(log.action_type) {
                case 'license_generate':
                    actionText = `Generated license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'license_delete':
                    actionText = `Deleted license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'license_extend':
                    actionText = `Extended license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'license_ban':
                    actionText = `Banned license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'license_unban':
                    actionText = `Unbanned license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'license_reset_hwid':
                    actionText = `Reset HWID for license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'license_pause':
                    actionText = `Paused license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'license_unpause':
                    actionText = `Unpaused license key: ${log.license_key || 'N/A'}`;
                    break;
                case 'custom_message_update':
                    actionText = `Updated custom message: ${log.action_details || 'N/A'}`;
                    break;
                case 'security_log_update':
                    actionText = `Updated security log: ${log.action_details || 'N/A'}`;
                    break;
                case 'application_edit':
                    actionText = `Edited application: ${log.app_id || 'N/A'}`;
                    break;
                default:
                    actionText = log.action_details || log.action_type;
            }
            
            const appInfo = log.app_id ? ` [App: ${log.app_id}]` : '';
            const licenseInfo = log.license_key ? ` [Key: ${log.license_key.substring(0, 8)}...]` : '';
            
            return `<div style="margin-bottom: 8px;">
                <span style="color: #888;">[${dateStr}]</span> 
                <span style="color: #00ff00;">${log.user_email || 'Unknown'}</span>
                <span style="color: #ffff00;">${actionText}</span>${appInfo}${licenseInfo}
            </div>`;
        }).join('');
        
        // Auto-scroll to top (newest logs)
        terminal.scrollTop = 0;
    } catch (error) {
        console.error('Error loading activity logs:', error);
        terminal.innerHTML = '<div style="color: #ff4444;">Error loading logs</div>';
    }
}

// License Format Configuration Functions
async function loadLicenseFormat() {
    try {
        const response = await fetch(`${API_URL}/admin/license-format`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.format) {
                document.getElementById('license-format-input').value = data.format;
            }
            if (data.options) {
                document.getElementById('format-big-letters').checked = data.options.bigLetters === true;
                document.getElementById('format-digits').checked = data.options.digits === true;
                document.getElementById('format-special-chars').checked = data.options.specialChars === true;
                
                // Update switch visual state
                refreshFormatSwitches();
            }
        }
    } catch (error) {
        console.error('Error loading license format:', error);
    }
}

function refreshFormatSwitches() {
    const inputs = document.querySelectorAll('#license-format-form input[type="checkbox"]');
    inputs.forEach((input) => {
        const label = input.closest('label.w-checkbox.switch-field');
        if (!label) return;
        const switchInput = label.querySelector('.switch-input');
        if (switchInput) {
            if (input.checked) {
                switchInput.classList.add('w--redirected-checked');
            } else {
                switchInput.classList.remove('w--redirected-checked');
            }
        }
    });
}

function bindFormatSwitches() {
    const form = document.getElementById('license-format-form');
    if (!form) return;
    
    const inputs = form.querySelectorAll('input[type="checkbox"]');
    inputs.forEach((input) => {
        input.addEventListener('change', () => {
            refreshFormatSwitches();
        });
        
        const label = input.closest('label.w-checkbox.switch-field');
        if (label) {
            label.addEventListener('click', (e) => {
                if (e.target !== input) {
                    e.preventDefault();
                    input.checked = !input.checked;
                    refreshFormatSwitches();
                }
            });
        }
    });
}

async function testLicenseFormat() {
    const format = document.getElementById('license-format-input').value;
    const bigLetters = document.getElementById('format-big-letters').checked;
    const digits = document.getElementById('format-digits').checked;
    const specialChars = document.getElementById('format-special-chars').checked;
    
    if (!format) {
        showLicenseFormatMessage('Please enter a format', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/admin/license-format/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                format,
                options: {
                    bigLetters,
                    digits,
                    specialChars
                }
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.test_key) {
            showLicenseFormatMessage(`Test license: ${data.test_key}`, 'success');
        } else {
            showLicenseFormatMessage(data.error || 'Error testing format', 'error');
        }
    } catch (error) {
        console.error('Error testing license format:', error);
        showLicenseFormatMessage('Error testing format', 'error');
    }
}

function showLicenseFormatMessage(text, type) {
    const messageDiv = document.getElementById('license-format-message');
    if (!messageDiv) return;
    
    messageDiv.textContent = text;
    messageDiv.style.display = 'block';
    messageDiv.style.color = type === 'success' ? '#155724' : '#721c24';
    messageDiv.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
    messageDiv.style.border = `1px solid ${type === 'success' ? '#c3e6cb' : '#f5c6cb'}`;
    
    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.style.display = 'none';
        messageDiv.style.background = '';
        messageDiv.style.border = '';
    }, 5000);
}


// Load activity logs when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        loadActivityLogs();
        // Refresh logs every 5 seconds
        setInterval(loadActivityLogs, 5000);
    });
} else {
    loadActivityLogs();
    // Refresh logs every 5 seconds
    setInterval(loadActivityLogs, 5000);
}

