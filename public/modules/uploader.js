/**
 * Uploader Module
 * Manages automated quiz uploading to the LMS via SSE (Server-Sent Events) with live progress & stopwatch timer
 */

import { appendLog } from './logger.js';
import { showError, dismissGlobalError } from './error.js';
import { getCourseId, getSelectedQuizTarget } from './courseQuiz.js';
import { getQuestionsHealth } from './preview.js';

const btnStartUpload = document.getElementById('btnStartUpload');
const btnParse = document.getElementById('btnParse');
const btnParseUpload = document.getElementById('btnParseUpload');
const headlessToggle = document.getElementById('headlessToggle');

const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressText = document.getElementById('progressText');

const uploadTimerBadge = document.getElementById('uploadTimerBadge');
const uploadElapsedTime = document.getElementById('uploadElapsedTime');
const uploadEtaBadge = document.getElementById('uploadEtaBadge');
const uploadEtaTime = document.getElementById('uploadEtaTime');
const progressStatsFooter = document.getElementById('progressStatsFooter');
const progressSpeedVal = document.getElementById('progressSpeedVal');
const progressTotalTimeVal = document.getElementById('progressTotalTimeVal');

function formatSec(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function setWorkerState(state, speech, integrityText, integrityColor) {
  const ws = document.querySelector('.agent-workstation');
  const light = document.getElementById('agentStatusLight');
  const pill = document.getElementById('agentStatePill');
  const bubble = document.getElementById('agentSpeechBubble');
  const intVal = document.getElementById('agentIntegrityVal');
  if (ws) {
    if (state === 'working') ws.classList.add('active');
    else ws.classList.remove('active');
  }
  if (light) {
    if (state === 'working') {
      light.style.backgroundColor = '#f59e0b';
      light.style.boxShadow = '0 0 10px #f59e0b';
    } else if (state === 'verified') {
      light.style.backgroundColor = '#10b981';
      light.style.boxShadow = '0 0 10px #10b981';
    } else if (state === 'error') {
      light.style.backgroundColor = '#ef4444';
      light.style.boxShadow = '0 0 10px #ef4444';
    } else {
      light.style.backgroundColor = '#3b82f6';
      light.style.boxShadow = '0 0 8px #3b82f6';
    }
  }
  if (pill) {
    pill.className = `agent-state-pill ${state}`;
    pill.textContent = state.toUpperCase();
  }
  if (bubble && speech) bubble.textContent = `"${speech}"`;
  if (intVal && integrityText) {
    intVal.textContent = integrityText;
    if (integrityColor) intVal.style.color = integrityColor;
  }
}

/**
 * Initialize Uploader event listeners
 * @param {object} options
 * @param {function} options.getParsedData - Function returning current parsed quiz data
 */
export function initUploader({ getParsedData } = {}) {
  if (!btnStartUpload) return;

  btnStartUpload.addEventListener('click', async () => {
    const parsedData = typeof getParsedData === 'function' ? getParsedData() : null;
    if (!parsedData || !parsedData.questions || parsedData.questions.length === 0) {
      showError('Parsing Required', 'Please parse a document first before starting upload.');
      return;
    }

    // Strict 100% Valid Enforcement
    const health = getQuestionsHealth();
    if (!health.isValid) {
      showError(
        'Upload Blocked: Validation Required',
        `Cannot start automated upload. ${health.questionsWithIssues} question(s) contain errors or missing fields (options, correct answer key, or solution).`,
        `Total issues detected: ${health.totalIssues}. Please review and correct the questions before publishing to LMS.`
      );
      btnStartUpload.disabled = true;
      btnStartUpload.classList.add('btn-locked-invalid');
      return;
    }

    dismissGlobalError();

    const courseId = getCourseId();
    const selectedQuizTarget = getSelectedQuizTarget();
    const startFromQ = parseInt(document.getElementById('startFromQInput')?.value, 10) || 1;
    const workers = parseInt(document.getElementById('parallelWorkersSelect')?.value || '1', 10) || 1;

    const config = {
      quizData: parsedData,
      courseId,
      targetQuiz: selectedQuizTarget,
      startFromQ,
      headless: headlessToggle ? !headlessToggle.checked : true,
      workers
    };

    btnStartUpload.disabled = true;
    if (btnParse) btnParse.disabled = true;
    if (btnParseUpload) btnParseUpload.disabled = true;
    setWorkerState('working', '⚡ Uploading and injecting questions into LMS portal...', 'Uploading...', '#fbbf24');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar) {
      progressBar.classList.remove('is-error');
      progressBar.style.width = '0%';
    }
    const progInfo = document.querySelector('.progress-info');
    if (progInfo) progInfo.classList.remove('is-error');
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressText) progressText.textContent = `Connecting to Course ${courseId}...`;

    if (uploadTimerBadge) uploadTimerBadge.classList.remove('completed');
    if (uploadElapsedTime) uploadElapsedTime.textContent = '00:00';
    if (uploadEtaBadge) uploadEtaBadge.classList.add('hidden');
    if (progressStatsFooter) progressStatsFooter.classList.remove('hidden');
    if (progressSpeedVal) progressSpeedVal.textContent = '-- s/q';
    if (progressTotalTimeVal) progressTotalTimeVal.textContent = 'Calculating...';

    const uploadStartTime = Date.now();
    let uploadFinished = false;

    const timerInterval = setInterval(() => {
      if (uploadFinished) {
        clearInterval(timerInterval);
        return;
      }
      const elapsed = Math.floor((Date.now() - uploadStartTime) / 1000);
      if (uploadElapsedTime) uploadElapsedTime.textContent = formatSec(elapsed);
    }, 1000);

    appendLog(`Starting upload into Course ${courseId} (Target: ${selectedQuizTarget})...`, 'info');
    appendLog(`Mode: ${config.headless ? 'Headless (Background)' : 'Headful (Visible Chrome Window)'} | Workers: ${workers} (${workers > 1 ? workers + 'x Parallel' : 'Sequential'})`, 'info');

    const eventSource = new EventSource('/api/upload-stream');

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'log') {
          appendLog(data.message, data.level || 'info');
        } else if (data.type === 'pdf-gen-log' || data.type === 'info' || data.type === 'success' || data.type === 'warn') {
          appendLog(data.message, data.type === 'pdf-gen-error' ? 'error' : (data.level || (data.type !== 'pdf-gen-log' ? data.type : 'info')));
        } else if (data.type === 'pdf-gen-complete') {
          appendLog(`🎉 ${data.mode === 'monthly' ? 'Monthly Compilation' : 'Daily Quiz'} generation complete!`, 'success');
          data.files?.forEach(f => appendLog(`  📄 Created: ${f.name}`, 'success'));
          // Notify PDF Gen UI to refresh file list
          import('./pdfGenUI.js').then(m => m.loadPdfGenFiles()).catch(() => {});
        } else if (data.type === 'pdf-gen-error') {
          appendLog(`❌ Generation Error: ${data.message}`, 'error');
          showError('Doc Generation Failed', data.message);
        } else if (data.type === 'progress') {
          if (progressBar) progressBar.style.width = `${data.percent}%`;
          if (progressPercent) progressPercent.textContent = `${data.percent}%`;
          if (progressText) progressText.textContent = data.message || `Uploaded ${data.current} of ${data.total}`;

          if (data.elapsedSec !== undefined && uploadElapsedTime) {
            uploadElapsedTime.textContent = formatSec(data.elapsedSec);
          }
          if (data.etaSec !== undefined && uploadEtaBadge && uploadEtaTime) {
            uploadEtaBadge.classList.remove('hidden');
            uploadEtaTime.textContent = formatSec(data.etaSec);
          }
          if (data.avgPerQ && progressSpeedVal) {
            progressSpeedVal.textContent = `${data.avgPerQ} s/q`;
          }
          setWorkerState('working', `🚀 Uploading question ${data.current} of ${data.total} to LMS...`, `${data.percent}%`, '#60a5fa');
        } else if (data.type === 'complete') {
          uploadFinished = true;
          clearInterval(timerInterval);
          setWorkerState('verified', '🎉 All questions uploaded and published to LMS successfully!', '100% Published', '#10b981');

          const totalSec = data.totalDurationSec || Math.max(1, Math.round((Date.now() - uploadStartTime) / 1000));
          const formattedTotal = data.formattedDuration || (totalSec >= 60 ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s` : `${totalSec}s`);
          const totalCount = data.countUploaded || parsedData?.questions?.length || 0;
          const avgSpeed = data.avgSpeed || (totalSec / (totalCount || 1)).toFixed(1);

          if (uploadTimerBadge) uploadTimerBadge.classList.add('completed');
          if (uploadElapsedTime) uploadElapsedTime.textContent = formatSec(totalSec);
          if (uploadEtaBadge) uploadEtaBadge.classList.add('hidden');
          if (progressTotalTimeVal) progressTotalTimeVal.textContent = formattedTotal;
          if (progressSpeedVal) progressSpeedVal.textContent = `${avgSpeed} s/q`;

          appendLog(`🎉 ${data.message}`, 'success');
          appendLog(`⏱️ Total Execution Time: ${formattedTotal} | Avg Speed: ${avgSpeed}s / question`, 'success');
          if (data.url) appendLog(`🔗 View Quiz: ${data.url}`, 'success');
          if (progressText) progressText.textContent = `Upload Complete in ${formattedTotal}!`;

          eventSource.close();
          btnStartUpload.disabled = false;
          if (btnParse) btnParse.disabled = false;
          if (btnParseUpload) btnParseUpload.disabled = false;
        } else if (data.type === 'error') {
          uploadFinished = true;
          clearInterval(timerInterval);
          setWorkerState('error', `❌ Upload Stopped: ${data.message}`, 'Failed', '#ef4444');
          if (uploadEtaBadge) uploadEtaBadge.classList.add('hidden');
          if (progressTotalTimeVal) progressTotalTimeVal.textContent = 'Failed';
          showError('Automation Upload Failed', data.message, `Course ID: ${courseId}\nTarget Quiz: ${selectedQuizTarget}`);
          if (progressBar) progressBar.classList.add('is-error');
          if (progInfo) progInfo.classList.add('is-error');
          if (progressText) progressText.textContent = `❌ Upload Stopped: ${data.message}`;

          eventSource.close();
          btnStartUpload.disabled = false;
          if (btnParse) btnParse.disabled = false;
          if (btnParseUpload) btnParseUpload.disabled = false;
        }
      } catch (parseErr) {
        console.warn('SSE Parse error:', parseErr);
      }
    };

    eventSource.onerror = () => {
      uploadFinished = true;
      clearInterval(timerInterval);
      eventSource.close();
      btnStartUpload.disabled = false;
      if (btnParse) btnParse.disabled = false;
      if (btnParseUpload) btnParseUpload.disabled = false;
      if (!uploadFinished) {
        showError('Connection Dropped', 'Real-time progress connection was interrupted.', 'The upload may still be running in the background. Check terminal logs.');
      }
    };

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errMsg = data.error || `HTTP ${res.status}: Failed to initiate upload automation`;
        showError('Upload Launch Failed', errMsg, `Course: ${courseId}\nTarget Quiz: ${selectedQuizTarget}`);
        eventSource.close();
        btnStartUpload.disabled = false;
        if (btnParse) btnParse.disabled = false;
        if (btnParseUpload) btnParseUpload.disabled = false;
        if (progressBar) progressBar.classList.add('is-error');
        if (progInfo) progInfo.classList.add('is-error');
        if (progressText) progressText.textContent = `❌ Launch Failed: ${errMsg}`;
      }
    } catch (err) {
      showError('API Request Failed', `Could not reach upload server: ${err.message}`);
      eventSource.close();
      btnStartUpload.disabled = false;
      if (btnParse) btnParse.disabled = false;
      if (btnParseUpload) btnParseUpload.disabled = false;
      if (progressBar) progressBar.classList.add('is-error');
      if (progInfo) progInfo.classList.add('is-error');
      if (progressText) progressText.textContent = `❌ Network Error: ${err.message}`;
    }
  });
}

