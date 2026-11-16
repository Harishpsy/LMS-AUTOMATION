/**
 * Error & Alert Module
 * Manages top-level error banners, technical details modal, and unhandled exceptions
 */

import { appendLog } from './logger.js';

const globalErrorBanner = document.getElementById('globalErrorBanner');
const globalErrorTitle = document.getElementById('globalErrorTitle');
const globalErrorMessage = document.getElementById('globalErrorMessage');
const globalErrorDetails = document.getElementById('globalErrorDetails');
const globalErrorTime = document.getElementById('globalErrorTime');
const btnToggleErrorDetails = document.getElementById('btnToggleErrorDetails');

let currentErrorPayload = null;

/**
 * Display a prominent error banner at the top of the dashboard
 * @param {string} title   - Short title of the error
 * @param {string} message - User-friendly message explaining the issue
 * @param {string|object} details - Technical details, stack trace, or response info
 */
export function showError(title, message, details = null) {
  currentErrorPayload = {
    title: title || 'Error Occurred',
    message: message || 'An unexpected error occurred.',
    details: details ? (typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)) : null,
    time: new Date().toLocaleTimeString()
  };

  if (globalErrorTitle) globalErrorTitle.textContent = currentErrorPayload.title;
  if (globalErrorMessage) globalErrorMessage.textContent = currentErrorPayload.message;
  if (globalErrorTime) globalErrorTime.textContent = currentErrorPayload.time;

  if (currentErrorPayload.details) {
    if (globalErrorDetails) {
      globalErrorDetails.textContent = currentErrorPayload.details;
      globalErrorDetails.classList.add('hidden');
    }
    if (btnToggleErrorDetails) {
      btnToggleErrorDetails.classList.remove('hidden');
      btnToggleErrorDetails.textContent = 'View Details';
    }
  } else {
    if (globalErrorDetails) globalErrorDetails.classList.add('hidden');
    if (btnToggleErrorDetails) btnToggleErrorDetails.classList.add('hidden');
  }

  if (globalErrorBanner) {
    globalErrorBanner.classList.remove('hidden');
    globalErrorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  appendLog(`❌ [${currentErrorPayload.title}] ${currentErrorPayload.message}`, 'error');
}

/**
 * Dismiss the top global error alert
 */
export function dismissGlobalError() {
  if (globalErrorBanner) {
    globalErrorBanner.classList.add('hidden');
  }
}

/**
 * Toggle the visibility of the technical details section in the error banner
 */
export function toggleErrorDetails() {
  if (!globalErrorDetails) return;
  const isHidden = globalErrorDetails.classList.contains('hidden');
  if (isHidden) {
    globalErrorDetails.classList.remove('hidden');
    if (btnToggleErrorDetails) btnToggleErrorDetails.textContent = 'Hide Details';
  } else {
    globalErrorDetails.classList.add('hidden');
    if (btnToggleErrorDetails) btnToggleErrorDetails.textContent = 'View Details';
  }
}

/**
 * Copy error description and technical details to clipboard
 */
export function copyErrorDetails() {
  if (!currentErrorPayload) return;
  const text = `[${currentErrorPayload.time}] ${currentErrorPayload.title}\nMessage: ${currentErrorPayload.message}` +
    (currentErrorPayload.details ? `\nDetails:\n${currentErrorPayload.details}` : '');

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btnCopyError');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
  }).catch(() => {});
}

// Global unhandled error & promise rejection listeners
window.addEventListener('error', (e) => {
  showError('Dashboard UI Error', e.message, e.filename ? `${e.filename}:${e.lineno}` : null);
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason?.message || String(e.reason);
  showError('Unhandled Operation Error', reason);
});

// Expose on window for inline HTML onclick handlers
window.showError = showError;
window.dismissGlobalError = dismissGlobalError;
window.toggleErrorDetails = toggleErrorDetails;
window.copyErrorDetails = copyErrorDetails;

