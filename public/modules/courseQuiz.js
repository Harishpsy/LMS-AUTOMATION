/**
 * Course & Quiz Selection Module
 * Fetches courses/quizzes from the LMS portal and manages target selection
 */

import { appendLog } from './logger.js';
import { showError } from './error.js';

const courseIdInput = document.getElementById('courseIdInput');
const courseStatusLabel = document.getElementById('courseStatusLabel');
const quizTargetSelect = document.getElementById('quizTargetSelect');
const manualQuizTitleInput = document.getElementById('manualQuizTitleInput');
const btnRefreshQuizzes = document.getElementById('btnRefreshQuizzes');

/**
 * Fetch quizzes for the currently entered course ID from LMS
 */
export async function fetchCourseQuizzes() {
  if (!courseIdInput || !quizTargetSelect) return;
  const cId = courseIdInput.value.trim() || '104';

  if (btnRefreshQuizzes) {
    btnRefreshQuizzes.disabled = true;
    btnRefreshQuizzes.textContent = 'Fetching...';
  }
  appendLog(`Fetching quizzes list from Course ${cId}...`, 'info');

  try {
    const res = await fetch(`/api/quizzes?courseId=${cId}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      const errMsg = data.error || `HTTP ${res.status}: Failed to fetch quizzes from LMS`;
      showError('LMS Quiz Fetch Failed', errMsg, `Course ID: ${cId}\nStatus: ${res.status}\nHint: If session expired, click "Credentials" to sign in.`);
      throw new Error(errMsg);
    }

    quizTargetSelect.innerHTML = '<option value="latest">⚡ Latest Created Quiz (Click First Eye Icon)</option>';
    if (data.quizzes && data.quizzes.length > 0) {
      data.quizzes.forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.quizId;
        opt.textContent = `[ID: ${q.quizId}] ${q.title} (${q.status})`;
        quizTargetSelect.appendChild(opt);
      });
      appendLog(`Fetched ${data.quizzes.length} quiz(zes) from Course ${cId}.`, 'success');
    } else {
      appendLog(`No existing quizzes found in Course ${cId}.`, 'warn');
    }
  } catch (err) {
    appendLog(`Could not fetch quizzes: ${err.message}`, 'error');
  } finally {
    if (btnRefreshQuizzes) {
      btnRefreshQuizzes.disabled = false;
      btnRefreshQuizzes.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh`;
    }
  }
}

/**
 * Get currently selected Course ID
 * @returns {string}
 */
export function getCourseId() {
  return courseIdInput ? (courseIdInput.value.trim() || '104') : '104';
}

/**
 * Get target quiz identifier (manual input override or select dropdown)
 * @returns {string}
 */
export function getSelectedQuizTarget() {
  const manual = manualQuizTitleInput ? manualQuizTitleInput.value.trim() : '';
  if (manual) return manual;
  return quizTargetSelect ? quizTargetSelect.value : 'latest';
}

/**
 * Initialize Course & Quiz UI event listeners
 */
export function initCourseQuiz() {
  if (courseIdInput) {
    courseIdInput.addEventListener('input', () => {
      const cId = courseIdInput.value.trim() || '104';
      if (courseStatusLabel) {
        courseStatusLabel.textContent = `Course ${cId} Selected`;
      }
    });
  }

  if (btnRefreshQuizzes) {
    btnRefreshQuizzes.addEventListener('click', fetchCourseQuizzes);
  }
}

