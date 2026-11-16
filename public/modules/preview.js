/**
 * Question Preview Module
 * Renders parsed quiz questions into interactive, rich preview cards with attached tables, explanations,
 * and comprehensive diagnostic inspection highlighting missing questions, options, answers, or solutions.
 */

const previewSection = document.getElementById('previewSection');
const questionsList = document.getElementById('questionsList');
const previewCountBadge = document.getElementById('previewCountBadge');
const previewHealthBadge = document.getElementById('previewHealthBadge');
const previewIssueBanner = document.getElementById('previewIssueBanner');
const previewIssueCountText = document.getElementById('previewIssueCountText');
const previewIssueSummaryDetails = document.getElementById('previewIssueSummaryDetails');
const countFilterAll = document.getElementById('countFilterAll');
const countFilterIssues = document.getElementById('countFilterIssues');
const countFilterClean = document.getElementById('countFilterClean');

let currentQuestions = [];
let activeFilter = 'all';

/**
 * Inspect a question object and detect missing fields/structural defects
 * @param {object} q 
 * @returns {Array<string>} list of human-readable issues
 */
function analyzeQuestionIssues(q) {
  const issues = [];

  // 1. Question Text
  if (!q.questionText || !q.questionText.trim()) {
    issues.push('Missing Question Text');
  }

  // 2. Options check
  if (!Array.isArray(q.options) || q.options.length === 0) {
    issues.push('No Options Provided (0 Options)');
  } else {
    if (q.options.length < 4) {
      issues.push(`Incomplete Options (Only ${q.options.length} options found, expected 4 or 5)`);
    }
    const emptyOpts = q.options.filter(o => !o.text || !String(o.text).trim());
    if (emptyOpts.length > 0) {
      issues.push(`Empty Option Text found (${emptyOpts.map(o => o.label || '?').join(', ')})`);
    }
  }

  // 3. Answer Key check
  if (!q.answerKey || !String(q.answerKey).trim()) {
    issues.push('Missing Correct Answer Key (No option selected)');
  } else if (Array.isArray(q.options) && q.options.length > 0) {
    const matched = q.options.some(opt => String(opt.label).trim().toUpperCase() === String(q.answerKey).trim().toUpperCase());
    if (!matched) {
      issues.push(`Answer Key "${q.answerKey}" does not match any existing option label`);
    }
  }

  // 4. Solution / Explanation check
  if (!q.explanationText || !q.explanationText.trim()) {
    const hasETable = Array.isArray(q.explanationTableImages) && q.explanationTableImages.length > 0;
    if (!hasETable) {
      issues.push('No Solution / Explanation Provided');
    }
  }

  return issues;
}

/**
 * Check whether the current parsed questions are 100% valid with 0 issues
 * @returns {{ isValid: boolean, totalQuestions: number, questionsWithIssues: number, totalIssues: number }}
 */
export function getQuestionsHealth() {
  if (!currentQuestions || currentQuestions.length === 0) {
    return { isValid: false, totalQuestions: 0, questionsWithIssues: 0, totalIssues: 0 };
  }
  let totalIssues = 0;
  let questionsWithIssues = 0;
  currentQuestions.forEach(q => {
    const issues = analyzeQuestionIssues(q);
    if (issues.length > 0) {
      totalIssues += issues.length;
      questionsWithIssues++;
    }
  });
  return {
    isValid: questionsWithIssues === 0,
    totalQuestions: currentQuestions.length,
    questionsWithIssues,
    totalIssues
  };
}

/**
 * Render parsed questions list into preview cards with diagnostic warnings
 * @param {Array} questions
 * @returns {{ isValid: boolean, totalQuestions: number, questionsWithIssues: number }}
 */
export function renderQuestionsPreview(questions) {
  if (!questionsList) return { isValid: false };
  currentQuestions = Array.isArray(questions) ? questions : [];
  questionsList.innerHTML = '';

  if (previewCountBadge) {
    previewCountBadge.textContent = `${currentQuestions.length} Question${currentQuestions.length !== 1 ? 's' : ''}`;
  }

  let totalIssues = 0;
  let questionsWithIssues = 0;

  // Pre-analyze all questions
  const analyzed = currentQuestions.map(q => {
    const issues = analyzeQuestionIssues(q);
    if (issues.length > 0) {
      totalIssues += issues.length;
      questionsWithIssues++;
    }
    return { q, issues };
  });

  const isAllValid = questionsWithIssues === 0 && currentQuestions.length > 0;

  // Enable/Disable Start Automated Upload button based on 100% validity
  const btnStartUpload = document.getElementById('btnStartUpload');
  if (btnStartUpload) {
    if (isAllValid) {
      btnStartUpload.disabled = false;
      btnStartUpload.title = 'All questions are 100% valid! Ready to upload.';
      btnStartUpload.classList.remove('btn-locked-invalid');
    } else {
      btnStartUpload.disabled = true;
      btnStartUpload.title = `Upload locked: ${questionsWithIssues} question(s) contain issues. Resolve them to enable upload.`;
      btnStartUpload.classList.add('btn-locked-invalid');
    }
  }

  // Update Summary Banner & Health Badge
  if (countFilterAll) countFilterAll.textContent = currentQuestions.length;
  if (countFilterIssues) countFilterIssues.textContent = questionsWithIssues;
  if (countFilterClean) countFilterClean.textContent = currentQuestions.length - questionsWithIssues;

  if (previewHealthBadge) {
    previewHealthBadge.style.display = 'inline-flex';
    if (questionsWithIssues === 0) {
      previewHealthBadge.className = 'badge badge-health-pass';
      previewHealthBadge.innerHTML = '✅ 100% Valid';
    } else {
      previewHealthBadge.className = 'badge badge-health-warn';
      previewHealthBadge.innerHTML = `⚠️ ${questionsWithIssues} with issues`;
    }
  }

  if (previewIssueBanner) {
    if (questionsWithIssues > 0) {
      previewIssueBanner.classList.remove('hidden');
      if (previewIssueCountText) {
        previewIssueCountText.textContent = `${questionsWithIssues} of ${currentQuestions.length} Questions Have Formatting or Missing Content Issues`;
      }
      if (previewIssueSummaryDetails) {
        previewIssueSummaryDetails.textContent = `Found ${totalIssues} issue(s) across the document. Click "Only with Issues" below to review them before starting upload.`;
      }
    } else {
      previewIssueBanner.classList.add('hidden');
    }
  }

  setupFilterListeners();
  renderCards(analyzed);

  if (previewSection) {
    previewSection.classList.remove('hidden');
  }
}

function setupFilterListeners() {
  const filterBtns = document.querySelectorAll('.issue-filter-btn');
  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter || 'all';
      filterCards();
    };
  });
}

function filterCards() {
  const cards = questionsList.querySelectorAll('.q-card');
  cards.forEach(card => {
    const hasIssue = card.dataset.hasIssue === 'true';
    if (activeFilter === 'all') {
      card.style.display = '';
    } else if (activeFilter === 'issues') {
      card.style.display = hasIssue ? '' : 'none';
    } else if (activeFilter === 'clean') {
      card.style.display = !hasIssue ? '' : 'none';
    }
  });
}

function renderCards(analyzedList) {
  questionsList.innerHTML = '';

  analyzedList.forEach(({ q, issues }) => {
    const hasIssue = issues.length > 0;
    const card = document.createElement('div');
    card.className = `q-card ${hasIssue ? 'has-issue-card' : ''}`;
    card.dataset.hasIssue = hasIssue ? 'true' : 'false';

    // Issue notice box if any issue exists
    let issuesBoxHtml = '';
    if (hasIssue) {
      issuesBoxHtml = `
        <div class="q-issue-box">
          <div class="q-issue-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <strong>Detected Issues (${issues.length}):</strong>
          </div>
          <ul class="q-issue-list">
            ${issues.map(iss => `<li>${iss}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    let optionsHtml = '';
    if (Array.isArray(q.options) && q.options.length > 0) {
      q.options.forEach(opt => {
        const isCorrect = String(opt.label).trim().toUpperCase() === String(q.answerKey || '').trim().toUpperCase();
        const isEmptyText = !opt.text || !String(opt.text).trim();
        optionsHtml += `
          <div class="opt-item ${isCorrect ? 'is-correct' : ''} ${isEmptyText ? 'is-empty-opt' : ''}">
            <span class="opt-badge">${opt.label})</span>
            <span class="opt-text">${isEmptyText ? '<em class="text-danger">[Empty Option Text]</em>' : opt.text}</span>
            ${isCorrect ? '<span class="correct-tag">✓ Correct</span>' : ''}
          </div>
        `;
      });
    } else {
      optionsHtml = `
        <div class="empty-options-warning">
          ⚠️ No options were parsed for this question.
        </div>
      `;
    }

    const hasQTable = q.questionTableImages && q.questionTableImages.length > 0;
    const hasETable = q.explanationTableImages && q.explanationTableImages.length > 0;
    const hasTable = hasQTable || hasETable || q.hasTable;

    let questionAssetHtml = '';
    if (hasQTable) {
      questionAssetHtml = `
        <div class="q-attached-asset question-asset">
          <div class="asset-header">📊 Table / Chart under Question (${q.questionTableImages.length})</div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${q.questionTableImages.map(img => `<img src="/api/view-asset?path=${encodeURIComponent(img)}" class="preview-asset-img" alt="Question Table" onclick="window.open(this.src)" title="Click to view full size" />`).join('')}
          </div>
        </div>
      `;
    }

    let explanationAssetHtml = '';
    if (hasETable) {
      explanationAssetHtml = `
        <div class="q-attached-asset explanation-asset">
          <div class="asset-header">📊 Table / Chart under Solution (${q.explanationTableImages.length})</div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${q.explanationTableImages.map(img => `<img src="/api/view-asset?path=${encodeURIComponent(img)}" class="preview-asset-img" alt="Solution Table" onclick="window.open(this.src)" title="Click to view full size" />`).join('')}
          </div>
        </div>
      `;
    }

    const hasExplanation = q.explanationText && q.explanationText.trim().length > 0;

    card.innerHTML = `
      <div class="q-header">
        <div class="q-num-title">
          <span class="q-num-pill">#${q.number}</span>
          ${q.questionText ? q.questionText : '<span class="text-danger">⚠️ [Missing Question Text]</span>'}
        </div>
        <div class="q-meta-badges">
          ${hasIssue ? '<span class="pill pill-issue">⚠️ Has Issues</span>' : '<span class="pill pill-valid">✅ Valid</span>'}
          ${hasTable ? '<span class="pill pill-table">📊 Has Table</span>' : ''}
          <span class="pill">${q.topic || 'General'}</span>
          <span class="pill">${q.difficulty || 'Easy'}</span>
        </div>
      </div>

      ${issuesBoxHtml}
      ${questionAssetHtml}

      <div class="q-options-grid">
        ${optionsHtml}
      </div>

      <div class="q-explanation ${!hasExplanation && !hasETable ? 'explanation-missing' : ''}">
        <strong>Solution / Explanation:</strong> 
        ${hasExplanation ? q.explanationText : '<span class="text-danger">⚠️ [No Explanation Provided]</span>'}
      </div>
      ${explanationAssetHtml}
    `;

    questionsList.appendChild(card);
  });
}

/**
 * Clear the preview section and hide it
 */
export function clearQuestionsPreview() {
  currentQuestions = [];
  if (questionsList) questionsList.innerHTML = '';
  if (previewSection) previewSection.classList.add('hidden');
  if (previewIssueBanner) previewIssueBanner.classList.add('hidden');
  if (previewHealthBadge) previewHealthBadge.style.display = 'none';
}

