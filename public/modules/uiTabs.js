/**
 * UI Tabs & Controls Module
 * Handles tab switching (Workspace Folder vs Local Upload) and browser execution mode toggles
 */

import { loadFiles } from './fileManager.js';

/**
 * Switch active source tab between workspace folder and local computer upload
 * @param {'folder'|'upload'} tab
 */
export function switchTab(tab) {
  const tabFolder = document.getElementById('tabFolder');
  const tabUpload = document.getElementById('tabUpload');
  const panelFolder = document.getElementById('panelFolder');
  const panelUpload = document.getElementById('panelUpload');

  if (tabFolder) tabFolder.classList.toggle('active', tab === 'folder');
  if (tabUpload) tabUpload.classList.toggle('active', tab === 'upload');
  if (panelFolder) panelFolder.classList.toggle('hidden', tab !== 'folder');
  if (panelUpload) panelUpload.classList.toggle('hidden', tab !== 'upload');

  if (tab === 'folder') {
    loadFiles();
  }
}

/**
 * Update label and hint when headless / headful checkbox changes
 * @param {HTMLInputElement} checkbox
 */
export function updateToggleLabel(checkbox) {
  const label = document.getElementById('toggleModeLabel');
  const hint = document.getElementById('toggleModeHint');
  if (!label || !hint) return;

  if (checkbox.checked) {
    label.style.color = 'var(--accent-green)';
    label.textContent = '👁️ Headful — Chrome window will open & be visible';
    hint.textContent = 'Toggle OFF to run silently in the background';
  } else {
    label.style.color = 'var(--text-muted)';
    label.textContent = '🔕 Headless — Running silently in the background';
    hint.textContent = 'Toggle ON to watch the browser as it works';
  }
}

// Expose to window for inline HTML onclick/onchange handlers
window.switchTab = switchTab;
window.updateToggleLabel = updateToggleLabel;

