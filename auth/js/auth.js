// Always use absolute path to /api (no base path needed)
let API_URL = `${window.location.origin}/api`;

let currentAppId = null;
let allLicenses = [];
let userPermissions = {};

async function resolveApiUrl() {
    const candidates = [];
    if (window.location && window.location.origin) {
        candidates.push(`${window.location.origin}/api`);
    }
    if (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        candidates.push('http://localhost:3000/api');
    }

    const tried = new Set();
    for (const candidate of candidates) {
        if (tried.has(candidate)) continue;
        tried.add(candidate);
        try {
            const response = await fetch(`${candidate}/health`, { credentials: 'include' });
            if (!response.ok) continue;
            const data = await response.json();
            if (data && data.ok) {
                API_URL = candidate;
                console.log(`[API] Using ${API_URL}`);
                return;
            }
        } catch (error) {
            // Try next candidate
        }
    }
    console.warn('[API] Could not verify /api/health, using', API_URL);
}

async function readJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }
    const text = await response.text();
    throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 200)}`);
}

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
    // Hide/show menu items based on permissions
    const menuItems = {
        'application': document.querySelector('a[href="application.html"]'),
        'licenses': document.querySelector('a[href="/"], a[href="/licenses"]'),
        'protection': document.querySelector('.nav-dropdown'),
        'settings': document.querySelector('a[href="settings.html"]'),
        'admin': document.querySelector('a[href="admin.html"]')
    };
    
    // Applications - always visible, lock handled in page logic
    
    // Licenses - always visible, lock handled in page logic
    
    // Protection (Security Logs / Custom Messages)
    const securityLink = document.querySelector('a[href="protection.html"]');
    const messagesLink = document.querySelector('a[href="messages.html"]');
    if (securityLink && !userPermissions['security_logs']?.view) {
        securityLink.style.display = 'none';
    }
    if (messagesLink && !userPermissions['custom_messages']?.view) {
        messagesLink.style.display = 'none';
    }
    if (menuItems.protection) {
        const canViewProtection = userPermissions['security_logs']?.view || 
                                 userPermissions['custom_messages']?.view;
        if (!canViewProtection) {
            menuItems.protection.style.display = 'none';
        }
    }
    
    // Settings
    if (menuItems.settings) {
        // Settings might be visible to all, but functionality will be restricted
    }
    
    // Admin - only for admin@admin.com
    if (menuItems.admin) {
        // Will be checked server-side
    }
    applyPagePermissionLocks();
}

function lockElement(element, message) {
    if (!element) return;
    element.classList.add('permission-locked');
    if (!element.querySelector('.permission-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'permission-overlay';
        overlay.innerHTML = `
            <div class="lock-icon"></div>
            <div>${message || 'No Permissions, Lack of administrator Consent.'}</div>
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

function applyPagePermissionLocks() {
    const path = window.location.pathname;

    if (path.includes('protection.html')) {
        const card = document.querySelector('.table-module');
        if (!userPermissions['security_logs']?.edit) {
            lockElement(card, 'No Permissions, Lack of administrator Consent.');
            card?.querySelectorAll('input, select, button, textarea').forEach(disableElement);
        }
    }

    if (path.includes('messages.html')) {
        const card = document.querySelector('.table-module');
        if (!userPermissions['custom_messages']?.edit) {
            lockElement(card, 'No Permissions, Lack of administrator Consent.');
            card?.querySelectorAll('input, select, button, textarea').forEach(disableElement);
        }
    }

    if (path.includes('index.html')) {
        const generateBtn = document.getElementById('open-generate-modal-btn');
        if (!userPermissions['licenses']?.create) {
            disableElement(generateBtn);
        }
        const pauseBtn = document.getElementById('open-pause-modal-btn');
        if (!userPermissions['licenses']?.pause) {
            disableElement(pauseBtn);
        }
        const extendBtn = document.getElementById('open-extend-modal-btn');
        if (!userPermissions['licenses']?.extend) {
            disableElement(extendBtn);
        }
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
        
        // Clear all cookies manually (fallback)
        document.cookie.split(";").forEach(function(c) { 
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
        });
        
        // Clear sessionStorage and localStorage
        sessionStorage.clear();
        localStorage.clear();
        
        if (data.success) {
            // Force redirect to login with cache bypass
            window.location.replace('login.html?' + Date.now());
        } else {
            // Still redirect even if server logout failed
            window.location.replace('login.html?' + Date.now());
        }
    } catch (error) {
        console.error('Error logging out:', error);
        // Clear cookies and storage even on error
        document.cookie.split(";").forEach(function(c) { 
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
        });
        sessionStorage.clear();
        localStorage.clear();
        window.location.replace('login.html?' + Date.now());
    }
}

// Load applications
async function loadApplications() {
    try {
        const response = await fetch(`${API_URL}/applications`);
        const apps = await response.json();
        
        // Update app selector if exists
        const appSelect = document.getElementById('app-select');
        if (appSelect) {
            appSelect.innerHTML = '<option value="">All Applications</option>' +
                apps.map(app => `<option value="${app.app_id}">${app.name}</option>`).join('');
            
            // Set selected value if currentAppId is set
            if (currentAppId) {
                appSelect.value = currentAppId;
            }
            
            appSelect.addEventListener('change', (e) => {
                currentAppId = e.target.value;
                loadLicenses();
            });
        }
        
        // Update license generation form app selector
        const licenseAppSelect = document.getElementById('license-app-select');
        if (licenseAppSelect) {
            licenseAppSelect.innerHTML = '<option value="">Select Application</option>' +
                apps.map(app => `<option value="${app.app_id}">${app.name}</option>`).join('');
            
            // Set selected value if currentAppId is set
            if (currentAppId) {
                licenseAppSelect.value = currentAppId;
            }
        }
        
        return apps;
    } catch (error) {
        console.error('Error loading applications:', error);
        return [];
    }
}

// Load licenses
async function loadLicenses() {
    try {
        let licenses = [];
        
        if (currentAppId) {
            // Load licenses for specific app
            const response = await fetch(`${API_URL}/licenses/${currentAppId}`);
            if (!response.ok) {
                console.error(`Failed to load licenses: ${response.status} ${response.statusText}`);
                return;
            }
            licenses = await response.json();
        } else {
            // Load all licenses from all apps
            const apps = await loadApplications();
            if (!apps || apps.length === 0) {
                console.log('No applications found');
                allLicenses = [];
                renderLicensesTable([], 'All Orders');
                return;
            }
            const promises = apps.map(app => 
                fetch(`${API_URL}/licenses/${app.app_id}`).then(r => {
                    if (!r.ok) {
                        console.error(`Failed to load licenses for app ${app.app_id}: ${r.status}`);
                        return [];
                    }
                    return r.json();
                }).catch(err => {
                    console.error(`Error loading licenses for app ${app.app_id}:`, err);
                    return [];
                })
            );
            const results = await Promise.all(promises);
            licenses = results.flat();
        }
        
        allLicenses = licenses;
        // Determine which tab is active and render accordingly
        const activeTab = document.querySelector('.w-tab-link.w--current');
        if (activeTab) {
            const tabName = activeTab.getAttribute('data-w-tab');
            if (tabName === 'All Orders') {
                renderLicensesTable(licenses, 'All Orders');
            } else if (tabName === 'Shipped') {
                filterLicensesByStatus('Active', 'Shipped');
            } else if (tabName === 'Processing') {
                filterLicensesByStatus('Not Activated', 'Processing');
            } else if (tabName === 'Cancelled') {
                filterLicensesByStatus('Banned', 'Cancelled');
            } else if (tabName === 'Expired') {
                filterLicensesByStatus('Expired', 'Expired');
            } else {
                renderLicensesTable(licenses, 'All Orders');
            }
        } else {
            renderLicensesTable(licenses, 'All Orders');
        }
        updateStats(licenses);
    } catch (error) {
        console.error('Error loading licenses:', error);
    }
}

// Render licenses table
function renderLicensesTable(licenses, tabName = null) {
    // Find the active tab pane or use the specified tab
    let activeTabPane = null;
    
    if (tabName) {
        // Map tab names to data-w-tab values
        const tabMap = {
            'All Orders': 'All Orders',
            'Active': 'Shipped',
            'Not Activated': 'Processing',
            'Banned': 'Cancelled',
            'Expired': 'Expired'
        };
        const dataTabValue = tabMap[tabName] || tabName;
        activeTabPane = document.querySelector(`[data-w-tab="${dataTabValue}"].w-tab-pane`);
    } else {
        // Find currently active tab pane
        activeTabPane = document.querySelector('.w-tab-pane.w--tab-active');
    }
    
    if (!activeTabPane) {
        // Fallback to first table-list
        activeTabPane = document.querySelector('.w-tab-pane');
    }
    
    const tableList = activeTabPane ? activeTabPane.querySelector('.table-list') : document.querySelector('.table-list');
    if (!tableList) return;
    
    // Clear existing rows (keep headers)
    const existingRows = tableList.querySelectorAll('.table-row-link');
    existingRows.forEach(row => row.remove());
    
    if (licenses.length === 0) {
        const emptyRow = document.createElement('div');
        emptyRow.className = 'table-row-link';
        emptyRow.style.display = 'contents';
        emptyRow.innerHTML = `
            <div class="w-layout-grid table-row _8-columns" style="grid-column: 1 / -1;">
                <div class="table-title" style="grid-column: 1 / -1; text-align: center; padding: 20px;">
                    No licenses found
                </div>
            </div>
        `;
        tableList.appendChild(emptyRow);
        return;
    }
    
    licenses.forEach(license => {
        const row = createLicenseRow(license);
        tableList.appendChild(row);
    });
}

// Create license row
function createLicenseRow(license) {
    const isUnlimited = license.is_unlimited === 1;
    const expiresAt = license.expires_at ? new Date(license.expires_at) : null;
    const isActivated = expiresAt !== null || isUnlimited;
    const now = new Date();
    const isExpired = !isUnlimited && expiresAt && now > expiresAt;
    const isBanned = license.is_banned === 1;
    const isInactive = license.is_active === 0;
    const isPaused = license.is_paused === 1;
    
    // Determine status
    let status = 'Not Activated';
    let statusClass = 'bg-primary-blue';
    if (isBanned) {
        status = 'Banned';
        statusClass = 'bg-primary-rose';
    } else if (isPaused) {
        status = 'Paused';
        statusClass = 'bg-primary-yellow';
    } else if (isInactive) {
        status = 'Inactive';
        statusClass = 'bg-primary-blue';
    } else if (!isActivated) {
        status = 'Not Activated';
        statusClass = 'bg-primary-blue';
    } else if (isUnlimited) {
        status = 'Unlimited';
        statusClass = 'bg-primary-green';
    } else if (isExpired) {
        status = 'Expired';
        statusClass = 'bg-primary-rose';
    } else {
        status = 'Active';
        statusClass = 'bg-primary-green';
    }
    
    const lockedHwid = license.locked_hwid || license.current_hwid || 'Not locked';
    
    // Format duration
    let durationDisplay = 'Unlimited';
    if (!isUnlimited && license.duration_value) {
        const unitNames = {
            'seconds': 'sec',
            'minutes': 'min',
            'hours': 'hr',
            'days': 'days'
        };
        durationDisplay = `${license.duration_value} ${unitNames[license.duration_unit] || 'days'}`;
    }
    
    // Format dates
    const createdDate = new Date(license.created_at);
    // Use last_check from license_usage table as activation date (first time license was checked/activated)
    const lastCheckDate = license.last_check ? new Date(license.last_check) : null;
    const activatedDateStr = lastCheckDate ? 
        `${lastCheckDate.toLocaleDateString('pl-PL')} (${lastCheckDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })})` : 
        'Not activated';
    
    // Format expires date with time
    let expiresDateStr = 'Never';
    if (expiresAt) {
        const dateStr = expiresAt.toLocaleDateString('pl-PL');
        const timeStr = expiresAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        expiresDateStr = `${dateStr} (${timeStr})`;
    } else if (isUnlimited) {
        expiresDateStr = 'Unlimited';
    }
    
    const row = document.createElement('div');
    row.className = 'table-row-link';
    row.style.display = 'contents';
    
    const appName = license.app_name || license.name || 'Unknown';
    
    const resetDisabled = !userPermissions['licenses']?.['reset-hwid'];
    const banDisabled = !userPermissions['licenses']?.ban;
    const extendDisabled = !userPermissions['licenses']?.extend;
    const deleteDisabled = !userPermissions['licenses']?.delete;

    row.innerHTML = `
        <div class="w-layout-grid table-row _8-columns" style="grid-column: 1 / -1; align-items: center;">
            <div class="table-title" title="${license.license_key}" style="white-space: nowrap; overflow: visible;">${license.license_key}</div>
            <div style="white-space: nowrap;">${appName}</div>
            <div style="white-space: nowrap;">${durationDisplay}</div>
            <div style="white-space: nowrap; font-size: 0.9em;">${activatedDateStr}</div>
            <div style="white-space: nowrap; font-size: 0.9em;">${expiresDateStr}</div>
            <div class="status" style="display: flex; align-items: center; gap: 5px; white-space: nowrap;">
                <div class="indication-color ${statusClass}"></div>
                <div>${status}</div>
            </div>
            <div title="${lockedHwid}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${lockedHwid.length > 20 ? lockedHwid.substring(0, 20) + '...' : lockedHwid}</div>
            <div style="display: flex; gap: 5px; flex-wrap: nowrap; align-items: center; white-space: nowrap; overflow: visible;">
                <button onclick="${resetDisabled ? '' : `resetHWID('${license.license_key}')`}" class="${resetDisabled ? 'permission-disabled' : ''}" style="padding: 5px 10px; background: #ffc107; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Reset HWID">HWID${resetDisabled ? '<span class="lock-icon-inline"></span>' : ''}</button>
                <button onclick="${banDisabled ? '' : `toggleBan('${license.license_key}', ${isBanned ? 'false' : 'true'})`}" class="${banDisabled ? 'permission-disabled' : ''}" style="padding: 5px 10px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="${isBanned ? 'Unban' : 'Ban'}">${isBanned ? 'Unban' : 'Ban'}${banDisabled ? '<span class="lock-icon-inline"></span>' : ''}</button>
                <button onclick="${extendDisabled ? '' : `showExtendDialog('${license.license_key}')`}" class="${extendDisabled ? 'permission-disabled' : ''}" style="padding: 5px 10px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Extend License">Extend${extendDisabled ? '<span class="lock-icon-inline"></span>' : ''}</button>
                <button onclick="${deleteDisabled ? '' : `deleteLicense('${license.license_key}')`}" class="${deleteDisabled ? 'permission-disabled' : ''}" style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; white-space: nowrap; flex-shrink: 0;" title="Delete License">Delete${deleteDisabled ? '<span class="lock-icon-inline"></span>' : ''}</button>
            </div>
        </div>
    `;
    
    return row;
}

// Update statistics
function updateStats(licenses) {
    const totalLicenses = licenses.length;
    const activeLicenses = licenses.filter(l => {
        if (l.is_banned === 1 || l.is_active === 0) return false;
        if (l.is_unlimited === 1) return true;
        if (!l.expires_at) return false;
        return new Date(l.expires_at) > new Date();
    }).length;
    const expiredLicenses = licenses.filter(l => {
        if (l.is_unlimited === 1 || !l.expires_at) return false;
        return new Date(l.expires_at) <= new Date();
    }).length;
    const bannedLicenses = licenses.filter(l => l.is_banned === 1).length;
    
    // Update stats modules (only from _4-grid, not the generate panel)
    const gridContainer = document.querySelector('._4-grid');
    if (gridContainer) {
        const statsModules = gridContainer.querySelectorAll('.module');
        if (statsModules.length >= 4) {
            // Total Licenses
            if (statsModules[0]) {
                const numberEl = statsModules[0].querySelector('.number');
                const captionEl = statsModules[0].querySelector('.caption');
                if (numberEl) numberEl.textContent = totalLicenses;
                if (captionEl) captionEl.textContent = 'Total Licenses';
            }
            // Active Licenses
            if (statsModules[1]) {
                const numberEl = statsModules[1].querySelector('.number');
                const captionEl = statsModules[1].querySelector('.caption');
                if (numberEl) numberEl.textContent = activeLicenses;
                if (captionEl) captionEl.textContent = 'Active';
            }
            // Expired Licenses
            if (statsModules[2]) {
                const numberEl = statsModules[2].querySelector('.number');
                const captionEl = statsModules[2].querySelector('.caption');
                if (numberEl) numberEl.textContent = expiredLicenses;
                if (captionEl) captionEl.textContent = 'Expired';
            }
            // Banned Licenses
            if (statsModules[3]) {
                const numberEl = statsModules[3].querySelector('.number');
                const captionEl = statsModules[3].querySelector('.caption');
                if (numberEl) numberEl.textContent = bannedLicenses;
                if (captionEl) captionEl.textContent = 'Banned';
            }
        }
    }
}

// Remove HWID from license
async function resetHWID(licenseKey) {
    if (!confirm('Are you sure you want to remove HWID from this license?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/licenses/reset-hwid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ license_key: licenseKey })
        });

        const data = await readJsonResponse(response);

        if (response.ok) {
            showMessage('HWID has been removed', 'success');
            await loadLicenses();
        } else {
            showMessage(data.error || 'Error removing HWID', 'error');
        }
    } catch (error) {
        console.error('Error removing HWID:', error);
        showMessage('Error removing HWID', 'error');
    }
}

// Toggle ban
async function toggleBan(licenseKey, ban) {
    const action = ban ? 'ban' : 'unban';
    if (!confirm(`Are you sure you want to ${action} this license?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/licenses/ban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ license_key: licenseKey, ban: ban })
        });

        const data = await readJsonResponse(response);

        if (response.ok) {
            showMessage(ban ? 'License has been banned' : 'License has been unbanned', 'success');
            await loadLicenses();
        } else {
            showMessage(data.error || 'Error changing ban status', 'error');
        }
    } catch (error) {
        console.error('Error toggling ban:', error);
        showMessage('Error changing ban status', 'error');
    }
}

// Show extend dialog
function showExtendDialog(licenseKey) {
    const durationValue = prompt('Enter duration value:', '30');
    if (durationValue === null || durationValue === '') {
        return;
    }
    
    const durationUnit = prompt('Enter duration unit (seconds/minutes/hours/days):', 'days');
    if (durationUnit === null || durationUnit === '') {
        return;
    }

    const valueNum = parseInt(durationValue);
    if (isNaN(valueNum) || valueNum <= 0) {
        showMessage('Please enter a valid duration value', 'error');
        return;
    }

    extendSingleLicense(licenseKey, valueNum, durationUnit);
}

// Extend license
async function extendLicense(licenseKey, additionalDays) {
    try {
        const response = await fetch(`${API_URL}/licenses/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ license_key: licenseKey, additional_days: additionalDays })
        });

        const data = await readJsonResponse(response);

        if (response.ok) {
            showMessage(`License has been extended by ${additionalDays} days`, 'success');
            await loadLicenses();
        } else {
            showMessage(data.error || 'Error extending license', 'error');
        }
    } catch (error) {
        console.error('Error extending license:', error);
        showMessage('Error extending license', 'error');
    }
}

// Extend single license with duration
async function extendSingleLicense(licenseKey, durationValue, durationUnit) {
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                duration_value: durationValue,
                duration_unit: durationUnit
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showMessage(`License extended by ${durationValue} ${durationUnit}`, 'success');
            await loadLicenses();
        } else {
            showMessage(data.error || 'Failed to extend license', 'error');
        }
    } catch (error) {
        console.error('Error extending license:', error);
        showMessage('Error extending license', 'error');
    }
}

// Delete license
async function deleteLicense(licenseKey) {
    if (!confirm('Are you sure you want to delete this license? This action cannot be undone!')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await readJsonResponse(response);

        if (response.ok) {
            showMessage('License has been deleted', 'success');
            await loadLicenses();
        } else {
            showMessage(data.error || 'Error deleting license', 'error');
        }
    } catch (error) {
        console.error('Error deleting license:', error);
        showMessage('Error deleting license', 'error');
    }
}

// Filter licenses by status
function filterLicensesByStatus(status, tabName = null) {
    let filtered = allLicenses;
    const now = new Date();
    
    if (status === 'Active') {
        filtered = allLicenses.filter(l => {
            // Exclude banned licenses
            if (l.is_banned === 1) return false;
            
            // Exclude inactive licenses
            if (l.is_active === 0) return false;
            
            // Unlimited licenses are always active (if not banned and not inactive)
            if (l.is_unlimited === 1) return true;
            
            // Must have expires_at and not be expired
            if (!l.expires_at) return false;
            
            const expiresAt = new Date(l.expires_at);
            return expiresAt > now;
        });
    } else if (status === 'Not Activated') {
        filtered = allLicenses.filter(l => {
            // Exclude banned licenses
            if (l.is_banned === 1) return false;
            
            // Exclude inactive licenses
            if (l.is_active === 0) return false;
            
            // Not activated means: no expires_at set and not unlimited
            // This means the license hasn't been activated yet (no HWID lock, no expiration date set)
            return !l.expires_at && l.is_unlimited === 0;
        });
    } else if (status === 'Banned') {
        filtered = allLicenses.filter(l => {
            // Only show banned licenses
            return l.is_banned === 1;
        });
    } else if (status === 'Expired') {
        filtered = allLicenses.filter(l => {
            // Exclude banned licenses
            if (l.is_banned === 1) return false;
            
            // Exclude unlimited licenses
            if (l.is_unlimited === 1) return false;
            
            // Must have expires_at and be expired
            if (!l.expires_at) return false;
            
            const expiresAt = new Date(l.expires_at);
            return expiresAt <= now;
        });
    }
    
    renderLicensesTable(filtered, tabName || status);
}

// Show message
function showMessage(text, type) {
    const messageDiv = document.getElementById('generate-message');
    if (!messageDiv) return;
    
    messageDiv.textContent = text;
    messageDiv.style.color = type === 'success' ? '#28a745' : '#dc3545';
    messageDiv.style.fontWeight = '600';
    messageDiv.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
    messageDiv.style.border = `1px solid ${type === 'success' ? '#c3e6cb' : '#f5c6cb'}`;
    
    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.style.background = '';
        messageDiv.style.border = '';
    }, 5000);
}

// Open generate modal
function openGenerateModal() {
    const overlay = document.getElementById('generate-modal-overlay');
    if (overlay) {
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Close generate modal
function closeGenerateModal() {
    const overlay = document.getElementById('generate-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        // Reset form
        const form = document.getElementById('generate-license-form');
        if (form) {
            form.reset();
            document.getElementById('license-duration-unit').value = 'days';
            document.getElementById('license-quantity').value = '1';
            document.getElementById('license-duration').disabled = false;
        }
        const messageDiv = document.getElementById('generate-message');
        if (messageDiv) {
            messageDiv.textContent = '';
            messageDiv.style.background = '';
            messageDiv.style.border = '';
        }
    }
}

// Open pause modal
async function openPauseModal() {
    const overlay = document.getElementById('pause-modal-overlay');
    if (overlay) {
        // Load applications into select
        const select = document.getElementById('pause-app-select');
        if (select) {
            try {
                const response = await fetch(`${API_URL}/applications`);
                const apps = await response.json();
                select.innerHTML = '<option value="">All Applications</option>';
                apps.forEach(app => {
                    const option = document.createElement('option');
                    option.value = app.app_id;
                    option.textContent = app.name;
                    select.appendChild(option);
                });
            } catch (error) {
                console.error('Error loading applications:', error);
            }
        }
        
        // Check if licenses are paused and update modal accordingly
        await updatePauseModalState();
        
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Update pause modal state based on whether licenses are paused
async function updatePauseModalState() {
    const appId = document.getElementById('pause-app-select')?.value || '';
    const modalTitle = document.querySelector('#pause-modal-overlay .modal-header h3');
    const pauseButton = document.querySelector('#pause-modal-overlay .modal-actions button.modal-btn-primary');
    
    if (!modalTitle || !pauseButton) return;
    
    try {
        // Check if there are paused licenses
        let hasPaused = false;
        if (appId) {
            // Check for specific app
            const response = await fetch(`${API_URL}/licenses/${appId}`);
            if (response.ok) {
                const licenses = await response.json();
                hasPaused = licenses.some(license => license.is_paused === 1);
            }
        } else {
            // Check all licenses
            try {
                const appsResponse = await fetch(`${API_URL}/applications`);
                const apps = await appsResponse.json();
                if (apps && apps.length > 0) {
                    const promises = apps.map(app => 
                        fetch(`${API_URL}/licenses/${app.app_id}`).then(r => r.ok ? r.json() : [])
                    );
                    const results = await Promise.all(promises);
                    const allLicenses = results.flat();
                    hasPaused = allLicenses.some(license => license.is_paused === 1);
                }
            } catch (err) {
                console.error('Error loading apps:', err);
            }
        }
        
        if (hasPaused) {
            modalTitle.textContent = 'Unpause All Licenses';
            pauseButton.textContent = 'Unpause Licenses';
            pauseButton.setAttribute('onclick', 'confirmUnpauseAll()');
        } else {
            modalTitle.textContent = 'Pause All Active Licenses';
            pauseButton.textContent = 'Pause Licenses';
            pauseButton.setAttribute('onclick', 'confirmPauseAll()');
        }
    } catch (error) {
        console.error('Error checking pause state:', error);
        // Default to pause mode on error
        modalTitle.textContent = 'Pause All Active Licenses';
        pauseButton.textContent = 'Pause Licenses';
        pauseButton.setAttribute('onclick', 'confirmPauseAll()');
    }
}

// Close pause modal
function closePauseModal() {
    const overlay = document.getElementById('pause-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        const messageDiv = document.getElementById('pause-message');
        if (messageDiv) {
            messageDiv.textContent = '';
            messageDiv.style.background = '';
            messageDiv.style.border = '';
        }
    }
}

// Confirm pause all
async function confirmPauseAll() {
    const appId = document.getElementById('pause-app-select').value;
    const messageDiv = document.getElementById('pause-message');
    
    try {
        const url = appId 
            ? `${API_URL}/applications/${appId}/pause-all`
            : `${API_URL}/licenses/pause-all`;
        
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            if (messageDiv) {
                messageDiv.textContent = `Successfully paused ${data.count || 0} license(s)`;
                messageDiv.style.background = '#d4edda';
                messageDiv.style.color = '#155724';
                messageDiv.style.border = '1px solid #c3e6cb';
                messageDiv.style.padding = '12px';
                messageDiv.style.borderRadius = '5px';
                messageDiv.style.marginTop = '12px';
            }
            await loadLicenses();
            setTimeout(() => {
                closePauseModal();
            }, 2000);
        } else {
            if (messageDiv) {
                messageDiv.textContent = data.error || 'Failed to pause licenses';
                messageDiv.style.background = '#f8d7da';
                messageDiv.style.color = '#721c24';
                messageDiv.style.border = '1px solid #f5c6cb';
                messageDiv.style.padding = '12px';
                messageDiv.style.borderRadius = '5px';
                messageDiv.style.marginTop = '12px';
            }
        }
    } catch (error) {
        console.error('Error pausing licenses:', error);
        if (messageDiv) {
            messageDiv.textContent = 'Error pausing licenses';
            messageDiv.style.background = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.style.border = '1px solid #f5c6cb';
            messageDiv.style.padding = '12px';
            messageDiv.style.borderRadius = '5px';
            messageDiv.style.marginTop = '12px';
        }
    }
}

// Confirm unpause all
async function confirmUnpauseAll() {
    const appId = document.getElementById('pause-app-select').value;
    const messageDiv = document.getElementById('pause-message');
    
    try {
        const url = appId 
            ? `${API_URL}/applications/${appId}/unpause-all`
            : `${API_URL}/licenses/unpause-all`;
        
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            if (messageDiv) {
                messageDiv.textContent = `Successfully unpaused ${data.count || 0} license(s)`;
                messageDiv.style.background = '#d4edda';
                messageDiv.style.color = '#155724';
                messageDiv.style.border = '1px solid #c3e6cb';
                messageDiv.style.padding = '12px';
                messageDiv.style.borderRadius = '5px';
                messageDiv.style.marginTop = '12px';
            }
            await loadLicenses();
            setTimeout(() => {
                closePauseModal();
            }, 2000);
        } else {
            if (messageDiv) {
                messageDiv.textContent = data.error || 'Failed to unpause licenses';
                messageDiv.style.background = '#f8d7da';
                messageDiv.style.color = '#721c24';
                messageDiv.style.border = '1px solid #f5c6cb';
                messageDiv.style.padding = '12px';
                messageDiv.style.borderRadius = '5px';
                messageDiv.style.marginTop = '12px';
            }
        }
    } catch (error) {
        console.error('Error unpausing licenses:', error);
        if (messageDiv) {
            messageDiv.textContent = 'Error unpausing licenses';
            messageDiv.style.background = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.style.border = '1px solid #f5c6cb';
            messageDiv.style.padding = '12px';
            messageDiv.style.borderRadius = '5px';
            messageDiv.style.marginTop = '12px';
        }
    }
}

// Open extend modal
async function openExtendModal() {
    const overlay = document.getElementById('extend-modal-overlay');
    if (overlay) {
        // Load applications into select
        const select = document.getElementById('extend-app-select');
        if (select) {
            try {
                const response = await fetch(`${API_URL}/applications`);
                const apps = await response.json();
                select.innerHTML = '<option value="">All Applications</option>';
                apps.forEach(app => {
                    const option = document.createElement('option');
                    option.value = app.app_id;
                    option.textContent = app.name;
                    select.appendChild(option);
                });
            } catch (error) {
                console.error('Error loading applications:', error);
            }
        }
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Close extend modal
function closeExtendModal() {
    const overlay = document.getElementById('extend-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        const messageDiv = document.getElementById('extend-message');
        if (messageDiv) {
            messageDiv.textContent = '';
            messageDiv.style.background = '';
            messageDiv.style.border = '';
        }
    }
}

// Confirm extend all
async function confirmExtendAll() {
    const appId = document.getElementById('extend-app-select').value;
    const durationValue = parseInt(document.getElementById('extend-duration').value);
    const durationUnit = document.getElementById('extend-duration-unit').value;
    const messageDiv = document.getElementById('extend-message');
    
    if (!durationValue || durationValue <= 0) {
        if (messageDiv) {
            messageDiv.textContent = 'Please enter a valid duration';
            messageDiv.style.background = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.style.border = '1px solid #f5c6cb';
            messageDiv.style.padding = '12px';
            messageDiv.style.borderRadius = '5px';
            messageDiv.style.marginTop = '12px';
        }
        return;
    }
    
    try {
        const url = appId 
            ? `${API_URL}/applications/${appId}/extend-all`
            : `${API_URL}/licenses/extend-all`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                duration_value: durationValue,
                duration_unit: durationUnit
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            if (messageDiv) {
                messageDiv.textContent = `Successfully extended ${data.count || 0} license(s)`;
                messageDiv.style.background = '#d4edda';
                messageDiv.style.color = '#155724';
                messageDiv.style.border = '1px solid #c3e6cb';
                messageDiv.style.padding = '12px';
                messageDiv.style.borderRadius = '5px';
                messageDiv.style.marginTop = '12px';
            }
            await loadLicenses();
            setTimeout(() => {
                closeExtendModal();
            }, 2000);
        } else {
            if (messageDiv) {
                messageDiv.textContent = data.error || 'Failed to extend licenses';
                messageDiv.style.background = '#f8d7da';
                messageDiv.style.color = '#721c24';
                messageDiv.style.border = '1px solid #f5c6cb';
                messageDiv.style.padding = '12px';
                messageDiv.style.borderRadius = '5px';
                messageDiv.style.marginTop = '12px';
            }
        }
    } catch (error) {
        console.error('Error extending licenses:', error);
        if (messageDiv) {
            messageDiv.textContent = 'Error extending licenses';
            messageDiv.style.background = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.style.border = '1px solid #f5c6cb';
            messageDiv.style.padding = '12px';
            messageDiv.style.borderRadius = '5px';
            messageDiv.style.marginTop = '12px';
        }
    }
}

// Pause single license
async function pauseLicense(licenseKey) {
    if (!confirm('Are you sure you want to pause this license?')) return;
    
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}/pause`, {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showMessage('License paused successfully', 'success');
            await loadLicenses();
        } else {
            showMessage(data.error || 'Failed to pause license', 'error');
        }
    } catch (error) {
        console.error('Error pausing license:', error);
        showMessage('Error pausing license', 'error');
    }
}

// Unpause single license
async function unpauseLicense(licenseKey) {
    if (!confirm('Are you sure you want to unpause this license?')) return;
    
    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}/unpause`, {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showMessage('License unpaused successfully', 'success');
            await loadLicenses();
        } else {
            showMessage(data.error || 'Failed to unpause license', 'error');
        }
    } catch (error) {
        console.error('Error unpausing license:', error);
        showMessage('Error unpausing license', 'error');
    }
}

// Toggle unlimited checkbox
function setupUnlimitedToggle() {
    const durationUnit = document.getElementById('license-duration-unit');
    const durationInput = document.getElementById('license-duration');
    
    if (durationUnit && durationInput) {
        durationUnit.addEventListener('change', function() {
            if (this.value === 'unlimited') {
                durationInput.disabled = true;
                durationInput.removeAttribute('required');
                durationInput.value = '';
            } else {
                durationInput.disabled = false;
                durationInput.setAttribute('required', 'required');
            }
        });
        
        // Check initial state
        if (durationUnit.value === 'unlimited') {
            durationInput.disabled = true;
            durationInput.removeAttribute('required');
        }
    }
}

// Generate license
async function generateLicense(e) {
    e.preventDefault();
    
    const appId = document.getElementById('license-app-select').value;
    const durationUnit = document.getElementById('license-duration-unit').value;
    const isUnlimited = durationUnit === 'unlimited';
    const durationValue = parseInt(document.getElementById('license-duration').value);
    const quantity = parseInt(document.getElementById('license-quantity').value) || 1;
    
    if (!appId) {
        showMessage('Please select an application', 'error');
        return;
    }
    
    if (!isUnlimited && (!durationValue || durationValue <= 0)) {
        showMessage('Please enter a valid duration', 'error');
        return;
    }
    
    if (quantity < 1 || quantity > 100) {
        showMessage('Quantity must be between 1 and 100', 'error');
        return;
    }
    
    try {
        const requestBody = {
            app_id: appId,
            is_unlimited: isUnlimited,
            quantity: quantity
        };
        
        if (!isUnlimited) {
            requestBody.duration_value = durationValue;
            requestBody.duration_unit = durationUnit;
        }
        
        const response = await fetch(`${API_URL}/licenses/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(requestBody)
        });
        
        const data = await readJsonResponse(response);
        
        if (response.ok) {
            if (data.license_keys && data.license_keys.length > 0) {
                const keysList = data.license_keys.join(', ');
                showMessage(`Successfully generated ${data.license_keys.length} license(s)! Keys: ${keysList}`, 'success');
            } else if (data.license_key) {
                showMessage(`License generated successfully! Key: ${data.license_key}`, 'success');
            } else {
                showMessage('License(s) generated successfully!', 'success');
            }
            // Reset form
            document.getElementById('license-duration').value = '';
            document.getElementById('license-duration-unit').value = 'days';
            document.getElementById('license-quantity').value = '1';
            document.getElementById('license-duration').disabled = false;
            // Reload licenses
            await loadLicenses();
            // Close modal after 3 seconds (longer for multiple keys)
            setTimeout(() => {
                closeGenerateModal();
            }, 3000);
        } else {
            showMessage(data.error || 'Error generating license', 'error');
        }
    } catch (error) {
        console.error('Error generating license:', error);
        showMessage('Error generating license', 'error');
    }
}

// Initialize on page load
window.addEventListener('load', async () => {
    await resolveApiUrl();
    // Load user info and permissions first
    await loadUserInfo();
    
    // Check for app_id parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const appIdFromUrl = urlParams.get('app_id');
    if (appIdFromUrl) {
        currentAppId = appIdFromUrl;
        
        // Change Licenses nav link color to purple to indicate app filter
        const licensesNav = document.querySelector('.nav-link.w--current');
        if (licensesNav && licensesNav.textContent.includes('Licenses')) {
            const purpleColor = '#763ff9';
            licensesNav.style.setProperty('color', purpleColor, 'important');
            
            const navText = licensesNav.querySelector('div');
            if (navText) {
                navText.style.setProperty('color', purpleColor, 'important');
            }
            
            const navIcon = licensesNav.querySelector('.nav-icon');
            if (navIcon) {
                // Purple filter approximation for #763ff9
                navIcon.style.filter = 'brightness(0) saturate(100%) invert(22%) sepia(93%) saturate(4681%) hue-rotate(264deg) brightness(98%) contrast(102%)';
            }
        }
    }
    
    await loadApplications();
    await loadLicenses();
    
    // Setup unlimited toggle
    setupUnlimitedToggle();
    
    // Setup generate license form
    const generateForm = document.getElementById('generate-license-form');
    if (generateForm) {
        generateForm.addEventListener('submit', generateLicense);
    }
    
    // Setup open modal buttons
    const openModalBtn = document.getElementById('open-generate-modal-btn');
    if (openModalBtn) {
        openModalBtn.addEventListener('click', openGenerateModal);
    }
    
    const openPauseModalBtn = document.getElementById('open-pause-modal-btn');
    if (openPauseModalBtn) {
        openPauseModalBtn.addEventListener('click', openPauseModal);
    }
    
    const openExtendModalBtn = document.getElementById('open-extend-modal-btn');
    if (openExtendModalBtn) {
        openExtendModalBtn.addEventListener('click', openExtendModal);
    }
    
    // Add event listener to update modal state when app selection changes
    const pauseAppSelect = document.getElementById('pause-app-select');
    if (pauseAppSelect) {
        pauseAppSelect.addEventListener('change', updatePauseModalState);
    }
    
    // Close modal on overlay click
    const generateOverlay = document.getElementById('generate-modal-overlay');
    if (generateOverlay) {
        generateOverlay.addEventListener('click', (e) => {
            if (e.target === generateOverlay) {
                closeGenerateModal();
            }
        });
    }
    
    const pauseOverlay = document.getElementById('pause-modal-overlay');
    if (pauseOverlay) {
        pauseOverlay.addEventListener('click', (e) => {
            if (e.target === pauseOverlay) {
                closePauseModal();
            }
        });
    }
    
    const extendOverlay = document.getElementById('extend-modal-overlay');
    if (extendOverlay) {
        extendOverlay.addEventListener('click', (e) => {
            if (e.target === extendOverlay) {
                closeExtendModal();
            }
        });
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeGenerateModal();
            closePauseModal();
            closeExtendModal();
        }
    });
    
    // Setup tab filtering with color change
    const tabLinks = document.querySelectorAll('.w-tab-link');
    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            // Remove current class from all tabs
            tabLinks.forEach(tab => {
                tab.classList.remove('w--current');
            });
            
            // Add current class to clicked tab
            link.classList.add('w--current');
            
            const tabName = link.getAttribute('data-w-tab');
            if (tabName === 'All Orders') {
                renderLicensesTable(allLicenses, 'All Orders');
            } else if (tabName === 'Shipped') {
                filterLicensesByStatus('Active', 'Shipped');
            } else if (tabName === 'Processing') {
                filterLicensesByStatus('Not Activated', 'Processing');
            } else if (tabName === 'Cancelled') {
                filterLicensesByStatus('Banned', 'Cancelled');
            }
        });
    });
});

// Setup animated tab slider
function setupTabSlider() {
    const tabMenu = document.getElementById('tab-menu');
    const slider = document.getElementById('tab-slider');
    const currentTab = document.querySelector('.w-tab-link.w--current');
    
    if (!tabMenu || !slider || !currentTab) return;
    
    // Initialize slider position and colors
    updateTabSlider(currentTab);
    
    // Set initial colors after a short delay to ensure DOM is ready
    setTimeout(() => {
        updateTabSlider(currentTab);
    }, 100);
    
    // Watch for tab changes (Webflow's tab system)
    const observer = new MutationObserver(() => {
        const currentTab = document.querySelector('.w-tab-link.w--current');
        if (currentTab) {
            updateTabSlider(currentTab);
        }
    });
    
    // Observe changes to the tab menu
    observer.observe(tabMenu, {
        attributes: true,
        childList: false,
        subtree: true,
        attributeFilter: ['class']
    });
    
    // Update on window resize
    window.addEventListener('resize', () => {
        const currentTab = document.querySelector('.w-tab-link.w--current');
        if (currentTab) {
            updateTabSlider(currentTab);
        }
    });
}

// Update tab slider position
function updateTabSlider(activeTab) {
    const slider = document.getElementById('tab-slider');
    if (!slider || !activeTab) return;
    
    const tabMenu = activeTab.closest('.in-page-menu');
    if (!tabMenu) return;
    
    const tabRect = activeTab.getBoundingClientRect();
    const menuRect = tabMenu.getBoundingClientRect();
    
    // Calculate position relative to menu
    const left = tabRect.left - menuRect.left;
    const width = tabRect.width;
    
    // Update slider position and width
    slider.style.transform = `translateX(${left}px)`;
    slider.style.width = `${width}px`;
    
    // Force white color for active tab text and dark grey for inactive
    const allTabs = tabMenu.querySelectorAll('.in-page-menu-link');
    allTabs.forEach(tab => {
        const div = tab.querySelector('div');
        if (tab.classList.contains('w--current')) {
            // Active tab - white text
            tab.style.setProperty('color', '#ffffff', 'important');
            if (div) {
                div.style.setProperty('color', '#ffffff', 'important');
            }
        } else {
            // Inactive tab - dark grey text
            tab.style.setProperty('color', '#666666', 'important');
            if (div) {
                div.style.setProperty('color', '#666666', 'important');
            }
        }
    });
}

