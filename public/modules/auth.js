/**
 * Authentication & Session Management Module
 * Handles LMS token validity checks, credentials entry modal, password toggles, and re-login
 */

import { appendLog } from './logger.js';
import { showError } from './error.js';
import { fetchCourseQuizzes } from './courseQuiz.js';

// Header status elements
const authStatusBadge = document.getElementById('authStatusBadge');
const authStatusDot = document.getElementById('authStatusDot');
const authStatusLabel = document.getElementById('authStatusLabel');
const btnRelogin = document.getElementById('btnRelogin');

// Credentials modal elements
const loginModal = document.getElementById('loginModal');
const btnOpenLoginModal = document.getElementById('btnOpenLoginModal');
const btnCloseLoginModal = document.getElementById('btnCloseLoginModal');
const btnCancelLoginModal = document.getElementById('btnCancelLoginModal');
const btnSubmitLogin = document.getElementById('btnSubmitLogin');
const loginBtnSpinner = document.getElementById('loginBtnSpinner');
const loginBtnText = document.getElementById('loginBtnText');
const modalEmailInput = document.getElementById('modalEmailInput');
const modalPasswordInput = document.getElementById('modalPasswordInput');
const modal2FAInput = document.getElementById('modal2FAInput');
const modal2FAHint = document.getElementById('modal2FAHint');
const modalRememberCheckbox = document.getElementById('modalRememberCheckbox');
const modalLoginAlert = document.getElementById('modalLoginAlert');
const btnTogglePasswordVisibility = document.getElementById('btnTogglePasswordVisibility');
const eyeShowSvg = document.getElementById('eyeShowSvg');
const eyeHideSvg = document.getElementById('eyeHideSvg');

/**
 * Check LMS session validity and update header status badge
 */
export async function checkAuthStatus() {
  if (!authStatusLabel) return;
  try {
    const res = await fetch('/api/auth-status');
    const data = await res.json();
    if (!data.exists) {
      if (authStatusBadge) authStatusBadge.className = 'auth-status-badge expired';
      if (authStatusDot) authStatusDot.className = 'status-dot dot-red';
      authStatusLabel.textContent = 'No Saved Session';
    } else if (data.isExpired) {
      if (authStatusBadge) authStatusBadge.className = 'auth-status-badge expired';
      if (authStatusDot) authStatusDot.className = 'status-dot dot-red';
      authStatusLabel.textContent = 'Session Expired';
    } else if (data.minutesRemaining < 30) {
      if (authStatusBadge) authStatusBadge.className = 'auth-status-badge expiring-soon';
      if (authStatusDot) authStatusDot.className = 'status-dot dot-yellow';
      authStatusLabel.textContent = `${data.user || 'LMS'} (${data.minutesRemaining}m left)`;
    } else {
      if (authStatusBadge) authStatusBadge.className = 'auth-status-badge';
      if (authStatusDot) authStatusDot.className = 'status-dot';
      const hours = Math.floor(data.minutesRemaining / 60);
      const mins = data.minutesRemaining % 60;
      const timeLeft = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      authStatusLabel.textContent = `${data.user || 'LMS'} (${timeLeft})`;
    }
  } catch (err) {
    if (authStatusLabel) authStatusLabel.textContent = 'Auth Check Offline';
  }
}

/**
 * Quick refresh LMS session token using existing credentials
 */
export async function triggerRelogin() {
  if (!btnRelogin) return;
  btnRelogin.disabled = true;
  const svg = btnRelogin.querySelector('svg');
  if (svg) svg.classList.add('spinning');
  const span = btnRelogin.querySelector('span');
  if (span) span.textContent = 'Logging in...';

  appendLog('🔐 Refreshing LMS session token using credentials...', 'info');

  try {
    const res = await fetch('/api/auth/login', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }
    appendLog(`✅ Authenticated successfully as ${data.info.user || 'LMS Admin'}! Session valid for 3 hours.`, 'success');
    await checkAuthStatus();
    fetchCourseQuizzes();
  } catch (err) {
    appendLog(`❌ Re-login failed: ${err.message}`, 'error');
    showError('LMS Login Error', err.message, 'Click the "Credentials" button in the header to enter your LMS email & password.');
  } finally {
    btnRelogin.disabled = false;
    if (svg) svg.classList.remove('spinning');
    if (span) span.textContent = 'Refresh';
  }
}

/**
 * Open the LMS Credentials Modal
 */
export async function openLoginModal() {
  if (!loginModal) return;
  loginModal.classList.remove('hidden');
  hideModalAlert();

  // Prefill credentials & check 2FA status
  try {
    const res = await fetch('/api/auth-config');
    const data = await res.json();
    if (data.email && modalEmailInput && !modalEmailInput.value) {
      modalEmailInput.value = data.email;
    }
    if (data.has2FASecret && modal2FAInput) {
      modal2FAInput.value = '';
      modal2FAInput.placeholder = '●●●●●●●● (2FA Secret Saved in .env — Auto Active)';
      if (modal2FAHint) {
        modal2FAHint.textContent = '🔒 2FA Secret Key is saved in .env. Automated TOTP generation is active. Leave blank to keep existing secret, or enter a new one to replace.';
      }
    } else if (modal2FAInput) {
      modal2FAInput.placeholder = 'Enter 2FA Secret Key (saved for auto-login) or 6-digit OTP';
      if (modal2FAHint) {
        modal2FAHint.textContent = '💡 Enter your 2FA Secret Key once to enable 100% automated zero-touch logins, or enter a real-time 6-digit OTP.';
      }
    }
  } catch (e) {}

  if (modalEmailInput && !modalEmailInput.value) {
    modalEmailInput.focus();
  } else if (modalPasswordInput) {
    modalPasswordInput.focus();
  }
}

/**
 * Close the LMS Credentials Modal
 */
export function closeLoginModal() {
  if (!loginModal) return;
  loginModal.classList.add('hidden');
  hideModalAlert();
}

function showModalAlert(message, type = 'error') {
  if (!modalLoginAlert) return;
  modalLoginAlert.className = `modal-alert ${type}`;
  modalLoginAlert.textContent = message;
  modalLoginAlert.classList.remove('hidden');
}

function hideModalAlert() {
  if (!modalLoginAlert) return;
  modalLoginAlert.classList.add('hidden');
  modalLoginAlert.textContent = '';
}

function togglePasswordVisibility() {
  if (!modalPasswordInput) return;
  const isPwd = modalPasswordInput.type === 'password';
  modalPasswordInput.type = isPwd ? 'text' : 'password';
  if (eyeShowSvg) eyeShowSvg.classList.toggle('hidden', isPwd);
  if (eyeHideSvg) eyeHideSvg.classList.toggle('hidden', !isPwd);
}

/**
 * Submit login form with email & password entered in frontend
 */
export async function submitLmsLogin() {
  const email = modalEmailInput ? modalEmailInput.value.trim() : '';
  const password = modalPasswordInput ? modalPasswordInput.value.trim() : '';
  const otpOrSecret = modal2FAInput ? modal2FAInput.value.trim() : '';
  const remember = modalRememberCheckbox ? modalRememberCheckbox.checked : true;

  if (!email || !password) {
    showModalAlert('Please enter both Email and Password.', 'error');
    return;
  }

  hideModalAlert();
  if (btnSubmitLogin) btnSubmitLogin.disabled = true;
  if (btnCancelLoginModal) btnCancelLoginModal.disabled = true;
  if (loginBtnSpinner) loginBtnSpinner.classList.remove('hidden');
  if (loginBtnText) loginBtnText.textContent = 'Connecting to LMS...';

  appendLog(`🔐 Attempting frontend LMS login for: ${email}...`, 'info');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, otpOrSecret, saveToEnv: remember })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Authentication failed. Please verify credentials.');
    }

    const userName = data.info?.user || 'LMS Admin';
    showModalAlert(`✅ Successfully logged in as ${userName}!`, 'success');
    appendLog(`✅ Authenticated successfully as ${userName}! Session refreshed.`, 'success');

    await checkAuthStatus();
    fetchCourseQuizzes();

    setTimeout(() => {
      closeLoginModal();
      if (modalPasswordInput) modalPasswordInput.value = '';
      if (modal2FAInput) modal2FAInput.value = '';
    }, 900);

  } catch (err) {
    showModalAlert(err.message, 'error');
    appendLog(`❌ Frontend login error: ${err.message}`, 'error');
  } finally {
    if (btnSubmitLogin) btnSubmitLogin.disabled = false;
    if (btnCancelLoginModal) btnCancelLoginModal.disabled = false;
    if (loginBtnSpinner) loginBtnSpinner.classList.add('hidden');
    if (loginBtnText) loginBtnText.textContent = 'Sign In & Save';
  }
}

/**
 * Initialize all authentication event listeners and periodic refresh
 */
export function initAuth() {
  if (btnRelogin) {
    btnRelogin.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerRelogin();
    });
  }

  if (btnOpenLoginModal) {
    btnOpenLoginModal.addEventListener('click', (e) => {
      e.stopPropagation();
      openLoginModal();
    });
  }

  if (btnCloseLoginModal) {
    btnCloseLoginModal.addEventListener('click', closeLoginModal);
  }

  if (btnCancelLoginModal) {
    btnCancelLoginModal.addEventListener('click', closeLoginModal);
  }

  if (loginModal) {
    loginModal.addEventListener('click', (e) => {
      if (e.target === loginModal) closeLoginModal();
    });
  }

  if (btnTogglePasswordVisibility) {
    btnTogglePasswordVisibility.addEventListener('click', togglePasswordVisibility);
  }

  if (btnSubmitLogin) {
    btnSubmitLogin.addEventListener('click', submitLmsLogin);
  }

  [modalEmailInput, modalPasswordInput, modal2FAInput].forEach(inp => {
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitLmsLogin();
        }
      });
    }
  });

  if (authStatusBadge) {
    authStatusBadge.addEventListener('click', (e) => {
      if (e.target.closest('#btnRelogin')) return;
      openLoginModal();
    });
    authStatusBadge.style.cursor = 'pointer';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLoginModal();
    }
  });

  // Periodic auth status check every 60s
  setInterval(checkAuthStatus, 60000);
}

// Expose on window for convenience
window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;

