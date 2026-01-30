// Dynamic API URL - works on Vercel and localhost
// Always use absolute path to /api (no base path needed)
let API_URL = `${window.location.origin}/api`;

// Fallback to localhost for local development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    API_URL = 'http://localhost:3000/api';
}

// Tab switching
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    document.getElementById(`${tabName}-tab`).classList.add('active');
    event.target.classList.add('active');
}

// Load applications
async function loadApplications() {
    try {
        const response = await fetch(`${API_URL}/applications`);
        const apps = await response.json();
        
        const listDiv = document.getElementById('applications-list');
        
        if (apps.length === 0) {
            listDiv.innerHTML = '<div class="empty-state">Brak aplikacji. Utwórz pierwszą aplikację!</div>';
            return;
        }

        listDiv.innerHTML = apps.map(app => `
            <div class="app-card">
                <h3>${app.name}</h3>
                <p><strong>APP-ID:</strong></p>
                <div class="app-id">${app.app_id}</div>
                <p style="margin-top: 10px; color: #666; font-size: 0.9em;">
                    Utworzono: ${new Date(app.created_at).toLocaleString('pl-PL')}
                </p>
            </div>
        `).join('');

        // Update select dropdowns
        updateAppSelects(apps);
    } catch (error) {
        console.error('Error loading applications:', error);
        showMessage('Błąd podczas ładowania aplikacji', 'error');
    }
}

// Update application selects
function updateAppSelects(apps) {
    const selects = ['license-app-select', 'view-licenses-app-select'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        const currentValue = select.value;
        select.innerHTML = '<option value="">Wybierz aplikację</option>' +
            apps.map(app => `<option value="${app.app_id}">${app.name}</option>`).join('');
        if (currentValue) {
            select.value = currentValue;
        }
    });
}

// Create application
document.getElementById('create-app-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('app-name').value.trim();
    
    if (!name) {
        showMessage('Podaj nazwę aplikacji', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(`Aplikacja "${name}" utworzona pomyślnie! APP-ID: ${data.app_id}`, 'success');
            document.getElementById('app-name').value = '';
            loadApplications();
        } else {
            showMessage(data.error || 'Błąd podczas tworzenia aplikacji', 'error');
        }
    } catch (error) {
        console.error('Error creating application:', error);
        showMessage('Błąd podczas tworzenia aplikacji', 'error');
    }
});

// Toggle unlimited checkbox
document.getElementById('license-unlimited').addEventListener('change', function() {
    const durationInput = document.getElementById('license-duration');
    const durationUnit = document.getElementById('license-duration-unit');
    
    if (this.checked) {
        durationInput.disabled = true;
        durationUnit.disabled = true;
        durationInput.removeAttribute('required');
    } else {
        durationInput.disabled = false;
        durationUnit.disabled = false;
        durationInput.setAttribute('required', 'required');
    }
});

// Generate license
document.getElementById('generate-license-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const appId = document.getElementById('license-app-select').value;
    const isUnlimited = document.getElementById('license-unlimited').checked;
    const durationValue = parseInt(document.getElementById('license-duration').value);
    const durationUnit = document.getElementById('license-duration-unit').value;

    if (!appId) {
        showMessage('Wybierz aplikację', 'error');
        return;
    }

    if (!isUnlimited && (!durationValue || durationValue <= 0)) {
        showMessage('Podaj poprawną wartość czasu trwania', 'error');
        return;
    }

    try {
        const requestBody = {
            app_id: appId,
            is_unlimited: isUnlimited
        };

        if (!isUnlimited) {
            requestBody.duration_value = durationValue;
            requestBody.duration_unit = durationUnit;
        }

        const response = await fetch(`${API_URL}/licenses/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Klucz licencyjny wygenerowany pomyślnie!', 'success');
            document.getElementById('license-duration').value = '';
            document.getElementById('license-unlimited').checked = false;
            document.getElementById('license-duration').disabled = false;
            document.getElementById('license-duration-unit').disabled = false;
            loadLicenses();
        } else {
            showMessage(data.error || 'Błąd podczas generowania klucza', 'error');
        }
    } catch (error) {
        console.error('Error generating license:', error);
        showMessage('Błąd podczas generowania klucza', 'error');
    }
});

// Load licenses
async function loadLicenses() {
    const appId = document.getElementById('view-licenses-app-select').value;
    
    if (!appId) {
        document.getElementById('licenses-list').innerHTML = '<div class="empty-state">Wybierz aplikację, aby zobaczyć klucze</div>';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/licenses/${appId}`);
        const licenses = await response.json();
        
        const listDiv = document.getElementById('licenses-list');
        
        if (licenses.length === 0) {
            listDiv.innerHTML = '<div class="empty-state">Brak kluczy dla tej aplikacji</div>';
            return;
        }

        listDiv.innerHTML = licenses.map(license => {
            const isUnlimited = license.is_unlimited === 1;
            const expiresAt = license.expires_at ? new Date(license.expires_at) : null;
            const isActivated = expiresAt !== null || isUnlimited;
            const now = new Date();
            const isExpired = !isUnlimited && expiresAt && now > expiresAt;
            const isBanned = license.is_banned === 1;
            const isInactive = license.is_active === 0;
            
            let daysRemaining = null;
            if (!isUnlimited && expiresAt) {
                daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
            }
            
            // Determine status
            let status = 'Not Activated';
            let statusClass = 'status-inactive';
            if (isBanned) {
                status = 'Banned';
                statusClass = 'status-banned';
            } else if (isInactive) {
                status = 'Inactive';
                statusClass = 'status-inactive';
            } else if (!isActivated) {
                status = 'Not Activated';
                statusClass = 'status-inactive';
            } else if (isUnlimited) {
                status = 'Unlimited';
                statusClass = 'status-unlimited';
            } else if (isExpired) {
                status = 'Expired';
                statusClass = 'status-expired';
            } else {
                status = 'Active';
                statusClass = 'status-active';
            }

            const lockedHwid = license.locked_hwid || license.current_hwid || 'Not locked';
            
            // Format duration display
            let durationDisplay = 'Unlimited';
            if (!isUnlimited && license.duration_value) {
                const unitNames = {
                    'seconds': 'sekund',
                    'minutes': 'minut',
                    'hours': 'godzin',
                    'days': 'dni'
                };
                durationDisplay = `${license.duration_value} ${unitNames[license.duration_unit] || 'dni'}`;
            }
            
            const expiredWithin = isUnlimited ? 
                'Never' : 
                (isExpired ? 
                    `${Math.abs(daysRemaining)} dni temu` : 
                    `${daysRemaining} dni`);

            return `
                <div class="license-card">
                    <div class="license-header">
                        <h3>${license.app_name}</h3>
                        <span class="status-badge ${statusClass}">${status}</span>
                    </div>
                    
                    <div class="license-key-section">
                        <p><strong>Klucz licencyjny:</strong></p>
                        <div class="license-key">${license.license_key}</div>
                    </div>
                    
                    <div class="license-details">
                        <div class="detail-row">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value ${statusClass}">${status}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">License Duration:</span>
                            <span class="detail-value">${durationDisplay}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Locked HWID:</span>
                            <span class="detail-value hwid-value">${lockedHwid}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Expired Within:</span>
                            <span class="detail-value ${isExpired ? 'status-expired' : ''}">${expiredWithin}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Utworzono:</span>
                            <span class="detail-value">${new Date(license.created_at).toLocaleString('pl-PL')}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status aktywacji:</span>
                            <span class="detail-value ${isActivated ? 'status-active' : 'status-inactive'}">
                                ${isActivated ? 'Aktywowana' : 'Nieaktywowana'}
                            </span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Wygasa:</span>
                            <span class="detail-value">${isUnlimited ? 'Never' : (expiresAt ? expiresAt.toLocaleString('pl-PL') : 'Po aktywacji')}</span>
                        </div>
                        ${license.last_check ? `
                        <div class="detail-row">
                            <span class="detail-label">Ostatnie sprawdzenie:</span>
                            <span class="detail-value">${new Date(license.last_check).toLocaleString('pl-PL')}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    <div class="license-actions">
                        <button class="action-btn btn-reset" onclick="resetHWID('${license.license_key}')" title="Reset HWID">
                            🔓 Reset HWID
                        </button>
                        <button class="action-btn ${isBanned ? 'btn-unban' : 'btn-ban'}" 
                                onclick="toggleBan('${license.license_key}', ${!isBanned})" 
                                title="${isBanned ? 'Odbanuj' : 'Zbanuj'}">
                            ${isBanned ? '✅ Unban' : '🚫 Ban'}
                        </button>
                        <button class="action-btn btn-extend" onclick="showExtendDialog('${license.license_key}')" title="Przedłuż licencję">
                            ⏰ Extend License
                        </button>
                        <button class="action-btn btn-delete" onclick="deleteLicense('${license.license_key}')" title="Usuń licencję">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading licenses:', error);
        showMessage('Błąd podczas ładowania kluczy', 'error');
    }
}

// Show message
function showMessage(text, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = text;
    
    const container = document.querySelector('.tab-content.active');
    container.insertBefore(messageDiv, container.firstChild);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 5000);
}

// Reset HWID
async function resetHWID(licenseKey) {
    if (!confirm('Czy na pewno chcesz zresetować HWID dla tej licencji?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/licenses/reset-hwid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: licenseKey })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('HWID został zresetowany', 'success');
            loadLicenses();
        } else {
            showMessage(data.error || 'Błąd podczas resetowania HWID', 'error');
        }
    } catch (error) {
        console.error('Error resetting HWID:', error);
        showMessage('Błąd podczas resetowania HWID', 'error');
    }
}

// Toggle ban
async function toggleBan(licenseKey, ban) {
    const action = ban ? 'zbanować' : 'odbanować';
    if (!confirm(`Czy na pewno chcesz ${action} tę licencję?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/licenses/ban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: licenseKey, ban: ban })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(ban ? 'Licencja została zbanowana' : 'Licencja została odbanowana', 'success');
            loadLicenses();
        } else {
            showMessage(data.error || 'Błąd podczas zmiany statusu bana', 'error');
        }
    } catch (error) {
        console.error('Error toggling ban:', error);
        showMessage('Błąd podczas zmiany statusu bana', 'error');
    }
}

// Show extend dialog
function showExtendDialog(licenseKey) {
    const days = prompt('O ile dni chcesz przedłużyć licencję?', '30');
    if (days === null || days === '') {
        return;
    }

    const daysNum = parseInt(days);
    if (isNaN(daysNum) || daysNum <= 0) {
        showMessage('Podaj poprawną liczbę dni', 'error');
        return;
    }

    extendLicense(licenseKey, daysNum);
}

// Extend license
async function extendLicense(licenseKey, additionalDays) {
    try {
        const response = await fetch(`${API_URL}/licenses/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: licenseKey, additional_days: additionalDays })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(`Licencja została przedłużona o ${additionalDays} dni`, 'success');
            loadLicenses();
        } else {
            showMessage(data.error || 'Błąd podczas przedłużania licencji', 'error');
        }
    } catch (error) {
        console.error('Error extending license:', error);
        showMessage('Błąd podczas przedłużania licencji', 'error');
    }
}

// Delete license
async function deleteLicense(licenseKey) {
    if (!confirm('Czy na pewno chcesz usunąć tę licencję? Ta operacja jest nieodwracalna!')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/licenses/${licenseKey}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Licencja została usunięta', 'success');
            loadLicenses();
        } else {
            showMessage(data.error || 'Błąd podczas usuwania licencji', 'error');
        }
    } catch (error) {
        console.error('Error deleting license:', error);
        showMessage('Błąd podczas usuwania licencji', 'error');
    }
}

// Initialize on load
window.addEventListener('load', () => {
    loadApplications();
});

