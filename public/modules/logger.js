/**
 * Logger Module
 * Manages terminal output display, logging levels, and log clearance
 */

const logOutput = document.getElementById('logOutput');
const btnClearLog = document.getElementById('btnClearLog');

/**
 * Append a timestamped log entry to the terminal panel
 * @param {string} text - Message to log
 * @param {'info'|'success'|'warn'|'error'} type - Log entry style level
 */
export function appendLog(text, type = 'info') {
  if (!logOutput) return;
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

/**
 * Clear all lines in terminal log
 */
export function clearLog() {
  if (logOutput) {
    logOutput.innerHTML = '';
  }
}

if (btnClearLog) {
  btnClearLog.addEventListener('click', clearLog);
}

// Also wire the always-visible inline log clear button
const btnClearInlineLog = document.getElementById('btnClearInlineLog');
if (btnClearInlineLog) {
  btnClearInlineLog.addEventListener('click', clearLog);
}

