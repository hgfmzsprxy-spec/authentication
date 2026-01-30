// Dynamic API URL - works on Vercel and localhost
// Detect base path from current location
const getBasePath = () => {
    const pathname = window.location.pathname;
    // If pathname is like /authentication/settings.html, extract /authentication
    const match = pathname.match(/^(\/[^\/]+)/);
    return match ? match[1] : '';
};

const basePath = getBasePath();
let API_URL = `${window.location.origin}${basePath}/api`;

// Fallback to localhost for local development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    API_URL = 'http://localhost:3000/api';
}

function setSidebarProfile(user) {
    const userEmailEl = document.getElementById('user-email');
    const userAvatarEl = document.getElementById('user-avatar');
    if (userEmailEl) {
        userEmailEl.textContent = user.display_name || user.email || 'Unknown';
    }

    if (userAvatarEl) {
        if (user.avatar_url) {
            userAvatarEl.textContent = '';
            userAvatarEl.style.backgroundImage = `url(${user.avatar_url})`;
            userAvatarEl.style.backgroundSize = 'cover';
            userAvatarEl.style.backgroundPosition = 'center';
            userAvatarEl.style.backgroundRepeat = 'no-repeat';
        } else {
            const firstLetter = (user.email || 'U').charAt(0).toUpperCase();
            userAvatarEl.textContent = firstLetter;
            userAvatarEl.style.backgroundImage = '';
            userAvatarEl.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
    }
}

async function loadUserInfo() {
    try {
        const response = await fetch(`${API_URL}/auth/me`, {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.loggedIn && data.user) {
            setSidebarProfile(data.user);
        } else {
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        window.location.href = 'login.html';
    }
}

function syncSwitch(checkbox, switchEl) {
    if (!checkbox || !switchEl) return;
    if (checkbox.checked) {
        switchEl.classList.add('w--redirected-checked');
    } else {
        switchEl.classList.remove('w--redirected-checked');
    }
}

function initDarkModeToggle() {
    const darkModeCheckbox = document.getElementById('dark-mode-toggle');
    const darkModeSwitch = document.getElementById('dark-mode-switch');
    if (!darkModeCheckbox) return;

    const storedValue = localStorage.getItem('darkModeEnabled');
    const isEnabled = storedValue === 'true';
    darkModeCheckbox.checked = isEnabled;
    syncSwitch(darkModeCheckbox, darkModeSwitch);
    if (window.applyDarkMode) {
        window.applyDarkMode(isEnabled);
    }

    darkModeCheckbox.addEventListener('change', () => {
        syncSwitch(darkModeCheckbox, darkModeSwitch);
        const enabled = darkModeCheckbox.checked;
        if (window.setDarkMode) {
            window.setDarkMode(enabled);
        } else {
            localStorage.setItem('darkModeEnabled', String(enabled));
            if (window.applyDarkMode) {
                window.applyDarkMode(enabled);
            }
        }
    });
}

async function loadAccountSettings() {
    try {
        const response = await fetch(`${API_URL}/account`, {
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error('Failed to load account settings');
        }
        const data = await response.json();

        const displayNameInput = document.getElementById('display-name');
        const emailInput = document.getElementById('account-email');
        const announcementsCheckbox = document.getElementById('announcements-opt-in');
        const announcementsSwitch = document.getElementById('announcements-switch');
        const announcementsDivider = document.getElementById('announcements-divider');
        const announcementsWebhookRow = document.getElementById('announcements-webhook-row');
        const announcementsWebhookInput = document.getElementById('announcements-webhook-url');
        const avatarPreview = document.getElementById('avatar-preview');

        if (displayNameInput) displayNameInput.value = data.display_name || '';
        if (emailInput) emailInput.value = data.email || '';
        if (announcementsCheckbox) {
            announcementsCheckbox.checked = !!data.announcements_opt_in;
            syncSwitch(announcementsCheckbox, announcementsSwitch);
        }
        if (announcementsWebhookInput) {
            announcementsWebhookInput.value = data.announcements_webhook_url || '';
        }
        const showAnnouncementsDetails = announcementsCheckbox && announcementsCheckbox.checked;
        if (announcementsDivider) {
            announcementsDivider.style.display = showAnnouncementsDetails ? 'block' : 'none';
        }
        if (announcementsWebhookRow) {
            announcementsWebhookRow.style.display = showAnnouncementsDetails ? 'flex' : 'none';
        }
        if (avatarPreview) {
            avatarPreview.src = data.avatar_url || avatarPreview.src;
        }
    } catch (error) {
        console.error('Error loading account settings:', error);
    }
}

function showMessage(targetId, message, isSuccess) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.textContent = message;
    el.style.color = isSuccess ? '#00c853' : '#f44336';
    setTimeout(() => {
        el.textContent = '';
    }, 4000);
}

async function saveAccountSettings() {
    const displayNameInput = document.getElementById('display-name');
    const announcementsCheckbox = document.getElementById('announcements-opt-in');

    const announcementsWebhookInput = document.getElementById('announcements-webhook-url');
    const payload = {
        display_name: displayNameInput ? displayNameInput.value.trim() : '',
        announcements_opt_in: announcementsCheckbox ? announcementsCheckbox.checked : false,
        announcements_webhook_url: announcementsWebhookInput ? announcementsWebhookInput.value.trim() : ''
    };

    const response = await fetch(`${API_URL}/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error('Failed to save settings');
    }
}

async function saveAvatar(dataUrl) {
    const response = await fetch(`${API_URL}/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ avatar_url: dataUrl })
    });

    if (!response.ok) {
        throw new Error('Failed to save avatar');
    }
}

async function deleteAccount() {
    const response = await fetch(`${API_URL}/account/delete`, {
        method: 'POST',
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error('Failed to delete account');
    }
}

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

function toggleProtectionMenu(event) {
    event.preventDefault();
    const submenu = document.getElementById('protection-submenu');
    const arrow = event.currentTarget.querySelector('.dropdown-arrow');
    if (submenu.style.display === 'none') {
        submenu.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
    } else {
        submenu.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadUserInfo();
    await loadAccountSettings();
    initDarkModeToggle();

    const announcementsCheckbox = document.getElementById('announcements-opt-in');
    const announcementsSwitch = document.getElementById('announcements-switch');
    const announcementsDivider = document.getElementById('announcements-divider');
    const announcementsWebhookRow = document.getElementById('announcements-webhook-row');
    const announcementsWebhookInput = document.getElementById('announcements-webhook-url');
    if (announcementsCheckbox) {
        announcementsCheckbox.addEventListener('change', async () => {
            syncSwitch(announcementsCheckbox, announcementsSwitch);
            if (announcementsDivider) {
                announcementsDivider.style.display = announcementsCheckbox.checked ? 'block' : 'none';
            }
            if (announcementsWebhookRow) {
                announcementsWebhookRow.style.display = announcementsCheckbox.checked ? 'flex' : 'none';
            }
            try {
                await saveAccountSettings();
                await loadUserInfo();
            } catch (error) {
                console.error('Error saving notifications:', error);
            }
        });
    }

    let webhookTimer = null;
    if (announcementsWebhookInput) {
        announcementsWebhookInput.addEventListener('input', () => {
            if (webhookTimer) {
                clearTimeout(webhookTimer);
            }
            webhookTimer = setTimeout(async () => {
                try {
                    await saveAccountSettings();
                    await loadUserInfo();
                } catch (error) {
                    console.error('Error saving webhook URL:', error);
                }
            }, 500);
        });
    }

    const uploadBtn = document.getElementById('upload-avatar-btn');
    const avatarInput = document.getElementById('avatar-input');
    const avatarPreview = document.getElementById('avatar-preview');

    if (uploadBtn && avatarInput) {
        uploadBtn.addEventListener('click', () => avatarInput.click());
    }

    if (avatarInput) {
        avatarInput.addEventListener('change', () => {
            const file = avatarInput.files && avatarInput.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showMessage('avatar-message', 'Please select an image file', false);
                return;
            }
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const dataUrl = reader.result;
                    if (avatarPreview) avatarPreview.src = dataUrl;
                    await saveAvatar(dataUrl);
                    const email = document.getElementById('user-email')?.textContent || '';
                    const displayName = document.getElementById('display-name')?.value || '';
                    setSidebarProfile({ email, display_name: displayName, avatar_url: dataUrl });
                    showMessage('avatar-message', '', true);
                } catch (error) {
                    console.error('Error saving avatar:', error);
                    showMessage('avatar-message', 'Error saving avatar', false);
                }
            };
            reader.readAsDataURL(file);
        });
    }

    const displayNameInput = document.getElementById('display-name');
    let displayNameTimer = null;
    if (displayNameInput) {
        displayNameInput.addEventListener('input', () => {
            if (displayNameTimer) {
                clearTimeout(displayNameTimer);
            }
            displayNameTimer = setTimeout(async () => {
                try {
                    await saveAccountSettings();
                    await loadUserInfo();
                    showMessage('general-message', 'Display name saved successfully!', true);
                } catch (error) {
                    console.error('Error saving display name:', error);
                    showMessage('general-message', 'Error saving display name', false);
                }
            }, 500);
        });
    }

    const deleteBtn = document.getElementById('delete-account-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                return;
            }
            try {
                await deleteAccount();
                showMessage('delete-message', 'Account deleted successfully.', true);
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1200);
            } catch (error) {
                console.error('Error deleting account:', error);
                showMessage('delete-message', 'Error deleting account', false);
            }
        });
    }
});

