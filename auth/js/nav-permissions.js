(() => {
  // Dynamic API URL - works on Vercel and localhost
  // Always use absolute path to /api (no base path needed)
  let NAV_API_URL = window.API_URL || `${window.location.origin}/api`;
  
  // Fallback to localhost for local development
  if (!window.API_URL && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    NAV_API_URL = 'http://localhost:3000/api';
  }

  function applyNavPermissions(permissions) {
    const securityLink = document.querySelector('a[href="protection.html"]');
    const messagesLink = document.querySelector('a[href="messages.html"]');
  const licensesLink = document.querySelector('a[href="/"], a[href="/licenses"]');
    const resellersLink = document.querySelector('a[href="/resellers"]');
    const protectionGroup = document.querySelector('.nav-dropdown');

    const canViewSecurity = !!permissions?.security_logs?.view;
    const canViewMessages = !!permissions?.custom_messages?.view;
    const canViewLicenses = !!permissions?.licenses?.view;
    const canViewResellers = !!permissions?.resellers?.view;

    if (securityLink && !canViewSecurity) {
      securityLink.style.display = 'none';
    }
    if (messagesLink && !canViewMessages) {
      messagesLink.style.display = 'none';
    }
    if (licensesLink && !canViewLicenses) {
      licensesLink.style.display = 'none';
    }
    if (resellersLink && !canViewResellers) {
      resellersLink.style.display = 'none';
    }
    if (protectionGroup && !canViewSecurity && !canViewMessages) {
      protectionGroup.style.display = 'none';
    }
  }

  function showDeniedMessage() {
    const message = sessionStorage.getItem('navDeniedMessage');
    if (message) {
      sessionStorage.removeItem('navDeniedMessage');
      alert(message);
    }
  }

  function redirectNoAccess(message) {
    sessionStorage.setItem('navDeniedMessage', message);
    window.location.replace('dashboard.html');
  }

  function renderBanScreen(user) {
    const content = document.querySelector('.dashboard-content');
    if (!content) return;
    const reason = user.ban_reason ? user.ban_reason : 'No reason provided.';
    const untilText = user.banned_until ? new Date(user.banned_until).toLocaleString() : 'Indefinite';
    content.innerHTML = `
      <div style="max-width: 900px; margin: 40px auto; padding: 24px; border-radius: 12px; background: #ffe5e5; border: 1px solid #f5b5b5; color: #b71c1c;">
        <h3 style="margin: 0 0 8px 0;">Account Banned</h3>
        <div style="margin-bottom: 10px;">Your account has been banned by an administrator.</div>
        <div style="margin-bottom: 6px;"><strong>Reason:</strong> ${reason}</div>
        <div><strong>Ban expires:</strong> ${untilText}</div>
      </div>
    `;
  }

  function renderWarnScreen(user) {
    const content = document.querySelector('.dashboard-content');
    if (!content) return;
    const reason = user.warn_message ? user.warn_message : 'No reason provided.';
    content.innerHTML = `
      <div style="max-width: 900px; margin: 40px auto; padding: 24px; border-radius: 12px; background: #fff3cd; border: 1px solid #ffc107; color: #856404;">
        <h3 style="margin: 0 0 8px 0;">⚠️ Warning</h3>
        <div style="margin-bottom: 10px;">You have received a warning from an administrator.</div>
        <div style="margin-bottom: 16px;"><strong>Reason:</strong> ${reason}</div>
        <button onclick="confirmWarn()" style="padding: 10px 20px; background: #ffb731; color: white; border: none; border-radius: 5px; font-weight: 600; cursor: pointer; font-size: 1em;">I Understand</button>
      </div>
    `;
  }

  window.confirmWarn = async function() {
    try {
      const response = await fetch(`${NAV_API_URL}/auth/confirm-warn`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        // Reload page to remove warning
        window.location.reload();
      }
    } catch (error) {
      console.error('Error confirming warn:', error);
    }
  };

  async function checkBanStatus() {
    try {
      const response = await fetch(`${NAV_API_URL}/auth/me`, { credentials: 'include' });
      if (!response.ok) return false;
      const data = await response.json();
      if (!data.loggedIn || !data.user) return false;

      const path = window.location.pathname;
      if (path.includes('settings.html')) {
        return false;
      }
      
      // Check for ban first (ban takes priority)
      if (data.user.status === 'Banned') {
        renderBanScreen(data.user);
        return true;
      }
      
      // Check for unconfirmed warning
      if (data.user.warn_message && !data.user.warn_confirmed) {
        renderWarnScreen(data.user);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error loading user status:', error);
      return false;
    }
  }

  async function loadPermissions() {
    try {
      const isBanned = await checkBanStatus();
      if (isBanned) return;

      const response = await fetch(`${NAV_API_URL}/auth/permissions`, {
        credentials: 'include'
      });
      if (!response.ok) return;
      const data = await response.json();
      const permissions = data.permissions || {};
      applyNavPermissions(permissions);

      const path = window.location.pathname;

      // Apply permission locks for edit restrictions (user has view but not edit)
      if (path.includes('protection.html') && permissions?.security_logs?.view && !permissions?.security_logs?.edit) {
        applyEditRestriction('protection');
      }
      if (path.includes('messages.html') && permissions?.custom_messages?.view && !permissions?.custom_messages?.edit) {
        applyEditRestriction('messages');
      }

      // If user doesn't have view permission, show overlay instead of redirecting
      if (path.includes('protection.html') && !permissions?.security_logs?.view) {
        const content = document.querySelector('.dashboard-content');
        if (content) {
          lockElement(content, 'No Permissions, Lack of administrator Consent.');
          content.querySelectorAll('input, select, button, textarea, a').forEach(disableElement);
        }
        return;
      }
      if (path.includes('messages.html') && !permissions?.custom_messages?.view) {
        const content = document.querySelector('.dashboard-content');
        if (content) {
          lockElement(content, 'No Permissions, Lack of administrator Consent.');
          content.querySelectorAll('input, select, button, textarea, a').forEach(disableElement);
        }
        return;
      }
      if ((path.includes('index.html') || path.endsWith('/licenses')) && !permissions?.licenses?.view) {
        redirectNoAccess('Access denied: Licenses.');
        return;
      }
      if (path.includes('/resellers') && !permissions?.resellers?.view) {
        redirectNoAccess('Access denied: Resellers.');
        return;
      }
    } catch (error) {
      console.error('Error loading nav permissions:', error);
    }
  }

  // Function to apply edit restriction overlay
  function applyEditRestriction(pageType) {
    const card = document.querySelector('.table-module');
    if (card) {
      lockElement(card, 'No Permissions, Lack of administrator Consent.');
      card.querySelectorAll('input, select, button, textarea').forEach(disableElement);
    } else {
      // Retry after a short delay if element not found
      setTimeout(() => {
        const retryCard = document.querySelector('.table-module');
        if (retryCard) {
          lockElement(retryCard, 'No Permissions, Lack of administrator Consent.');
          retryCard.querySelectorAll('input, select, button, textarea').forEach(disableElement);
        }
      }, 500);
    }
  }

  document.addEventListener('DOMContentLoaded', loadPermissions);
  document.addEventListener('DOMContentLoaded', showDeniedMessage);
  
  // Also run on window load to ensure elements are ready
  window.addEventListener('load', function() {
    // Re-check permissions after all scripts load
    setTimeout(() => {
      loadPermissions();
    }, 100);
  });

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
    // For form elements, use disabled attribute
    if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'BUTTON' || element.tagName === 'TEXTAREA') {
      element.setAttribute('disabled', 'disabled');
    }
    element.setAttribute('aria-disabled', 'true');
    element.tabIndex = -1;
    // For links, prevent navigation
    if (element.tagName === 'A') {
      element.style.pointerEvents = 'none';
      element.style.opacity = '0.5';
      element.href = 'javascript:void(0)';
    }
  }
})();

