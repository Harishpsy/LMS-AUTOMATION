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
const verificationAgentCard = document.getElementById('verificationAgentCard');
const countFilterAll = document.getElementById('countFilterAll');
const countFilterIssues = document.getElementById('countFilterIssues');
const countFilterClean = document.getElementById('countFilterClean');

let currentQuestions = [];
let currentVerification = null;
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

  // 2. Choices Count Check (Strictly 5 choices required: 1 to 5 / A to E)
  if (!Array.isArray(q.options) || q.options.length === 0) {
    issues.push('Missing Choices: 0 options found (Exactly 5 choices required: 1 to 5 / A to E)');
  } else if (q.options.length !== 5) {
    if (q.options.length < 5) {
      issues.push(`Incomplete Choices: Found only ${q.options.length} choices (Expected exactly 5 choices)`);
    } else {
      issues.push(`Excess Choices: Found ${q.options.length} choices (Expected exactly 5 choices)`);
    }
  }

  // Check for any empty choice text
  if (Array.isArray(q.options) && q.options.length > 0) {
    const emptyOpts = q.options.filter(o => !o.text || !String(o.text).trim());
    if (emptyOpts.length > 0) {
      issues.push(`Empty Choice Text: Choice ${emptyOpts.map(o => o.label || '?').join(', ')} is blank`);
    }
  }

  // 3. Correct Answer Selected Check
  if (!q.answerKey || !String(q.answerKey).trim()) {
    issues.push('Missing Correct Answer: No correct choice selected');
  } else if (Array.isArray(q.options) && q.options.length > 0) {
    const cleanKey = String(q.answerKey).trim().toUpperCase();
    const matched = q.options.some(opt => {
      const optLabel = String(opt.label || '').trim().toUpperCase();
      return optLabel === cleanKey ||
        (optLabel === '1' && cleanKey === 'A') || (optLabel === '2' && cleanKey === 'B') ||
        (optLabel === '3' && cleanKey === 'C') || (optLabel === '4' && cleanKey === 'D') ||
        (optLabel === '5' && cleanKey === 'E') ||
        (optLabel === 'A' && cleanKey === '1') || (optLabel === 'B' && cleanKey === '2') ||
        (optLabel === 'C' && cleanKey === '3') || (optLabel === 'D' && cleanKey === '4') ||
        (optLabel === 'E' && cleanKey === '5');
    });
    if (!matched) {
      issues.push(`Invalid Correct Answer: Answer Key "${q.answerKey}" does not match any of the 5 choices`);
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
 * Renders the Verification Agent Audit Panel comparing parsed questions against raw DOCX source
 * @param {object|null} verification 
 */
function renderVerificationBanner(verification) {
  if (!verificationAgentCard) return;
  if (!verification) {
    verificationAgentCard.classList.add('hidden');
    verificationAgentCard.innerHTML = '';
    return;
  }

  const isVerified = verification.verified === true;
  const score = verification.score !== undefined ? verification.score : (isVerified ? 100 : 0);
  const totalQ = verification.totalQuestions || 0;
  const matchedQ = verification.matchedQuestions !== undefined ? verification.matchedQuestions : totalQ;
  const anomalies = Array.isArray(verification.anomalies) ? verification.anomalies : [];
  const checks = verification.checks || {};

  const qCountPassed = checks.questionCount ? checks.questionCount.passed : isVerified;
  const promptsPassed = checks.prompts ? checks.prompts.passed : isVerified;
  const optionsPassed = checks.options ? checks.options.passed : isVerified;
  const answersPassed = checks.answers ? checks.answers.passed : isVerified;
  const explPassed = checks.explanations ? checks.explanations.passed : isVerified;

  let anomalyHtml = '';
  if (anomalies.length > 0) {
    anomalyHtml = `
      <div class="agent-anomaly-box">
        <div class="agent-anomaly-title">
          <strong>⚠️ Discrepancy Warnings Detected by Verification Agent (${anomalies.length}):</strong>
        </div>
        <ul class="agent-anomaly-list">
          ${anomalies.slice(0, 10).map(a => `<li>${a.message || JSON.stringify(a)}</li>`).join('')}
          ${anomalies.length > 10 ? `<li><em>...and ${anomalies.length - 10} more items</em></li>` : ''}
        </ul>
      </div>
    `;
  }

  verificationAgentCard.innerHTML = `
    <div class="agent-card-inner ${isVerified ? 'verified-pass' : 'verified-warn'}">
      <div class="agent-card-header">
        <div class="agent-title-group">
          <div class="agent-avatar-icon">${isVerified ? '🛡️' : '⚠️'}</div>
          <div>
            <div class="agent-main-title">Document Content Verification Agent</div>
            <div class="agent-subtitle">Automated full-content audit comparing parsed data against raw DOCX source document</div>
          </div>
        </div>
        <div class="agent-score-container">
          <span class="agent-score-badge ${isVerified ? 'score-100' : 'score-warn'}">
            ${isVerified ? '✓ 100% Match Verified' : `${score}% Document Match`}
          </span>
        </div>
      </div>

      <div class="agent-metrics-grid">
        <div class="metric-card ${qCountPassed ? 'metric-pass' : 'metric-warn'}">
          <div class="metric-label">Question Count</div>
          <div class="metric-value">${totalQ} / ${verification.sourceQuestionsCount || totalQ}</div>
          <div class="metric-status">${qCountPassed ? '✓ 100% Matched' : '⚠️ Count Mismatch'}</div>
        </div>

        <div class="metric-card ${promptsPassed ? 'metric-pass' : 'metric-warn'}">
          <div class="metric-label">Question Prompts</div>
          <div class="metric-value">${checks.prompts ? checks.prompts.matched : totalQ} / ${totalQ}</div>
          <div class="metric-status">${promptsPassed ? '✓ Content Preserved' : '⚠️ Discrepancy Found'}</div>
        </div>

        <div class="metric-card ${optionsPassed ? 'metric-pass' : 'metric-warn'}">
          <div class="metric-label">Choices (Strict 5)</div>
          <div class="metric-value">${checks.options && checks.options.allHave5Choices ? '5 / 5 Each' : 'Issues Found'}</div>
          <div class="metric-status">${optionsPassed ? '✓ All 5 Choices Match' : '⚠️ Choice Count Incomplete'}</div>
        </div>

        <div class="metric-card ${answersPassed ? 'metric-pass' : 'metric-warn'}">
          <div class="metric-label">Correct Answers</div>
          <div class="metric-value">${checks.answers ? checks.answers.matched : totalQ} / ${totalQ}</div>
          <div class="metric-status">${answersPassed ? '✓ Keys & Text Match' : '⚠️ Unmatched Keys'}</div>
        </div>

        <div class="metric-card ${explPassed ? 'metric-pass' : 'metric-warn'}">
          <div class="metric-label">Solutions & Lists</div>
          <div class="metric-value">${checks.explanations ? checks.explanations.matched : totalQ} / ${totalQ}</div>
          <div class="metric-status">${explPassed ? '✓ Sub-items Intact' : '⚠️ Truncated / Missing'}</div>
        </div>
      </div>

      ${anomalyHtml}
    </div>
  `;

  verificationAgentCard.classList.remove('hidden');
}

/**
 * Render parsed questions list into preview cards with diagnostic warnings
 * @param {Array} questions
 * @param {object|null} verification
 * @returns {{ isValid: boolean, totalQuestions: number, questionsWithIssues: number }}
 */
export function renderQuestionsPreview(questions, verification = null) {
  if (!questionsList) return { isValid: false };
  currentQuestions = Array.isArray(questions) ? questions : [];
  currentVerification = verification;
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
  renderVerificationBanner(verification);
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
    const cleanKey = String(q.answerKey || '').trim().toUpperCase();
    const hasCorrectChoice = cleanKey && Array.isArray(q.options) && q.options.some(opt => {
      const optLabel = String(opt.label || '').trim().toUpperCase();
      return optLabel === cleanKey ||
        (optLabel === '1' && cleanKey === 'A') || (optLabel === '2' && cleanKey === 'B') ||
        (optLabel === '3' && cleanKey === 'C') || (optLabel === '4' && cleanKey === 'D') ||
        (optLabel === '5' && cleanKey === 'E') ||
        (optLabel === 'A' && cleanKey === '1') || (optLabel === 'B' && cleanKey === '2') ||
        (optLabel === 'C' && cleanKey === '3') || (optLabel === 'D' && cleanKey === '4') ||
        (optLabel === 'E' && cleanKey === '5');
    });

    let vDetail = null;
    if (currentVerification && Array.isArray(currentVerification.questionDetails)) {
      vDetail = currentVerification.questionDetails.find(d => d.qNum === q.number) || currentVerification.questionDetails[q.number - 1];
    }

    // Format question content preserving paragraphs and statements (A, B, C, D)
    let formattedQuestion = '';
    let rawContent = q.questionHtml || q.questionText || '';
    rawContent = rawContent.replace(/<table[\s\S]*?<\/table>/gi, '').trim();

    // Inject #q.number right at the front of the question text so it flows in a straight line
    const numTag = `<span class="q-num-inline">#${q.number}</span>`;
    if (/<p[\s>]/i.test(rawContent)) {
      formattedQuestion = rawContent.replace(/^(\s*<p[^>]*>)/i, `$1${numTag} `);
    } else if (rawContent) {
      formattedQuestion = `<p>${numTag} ${rawContent}</p>`;
    } else {
      formattedQuestion = `<p>${numTag} <span class="text-danger">⚠️ [Missing Question Text]</span></p>`;
    }

    // Ensure inline statements like "। A)" or ". B)" break cleanly onto new lines if not already separated
    formattedQuestion = formattedQuestion.replace(/([।\.\?\:]\s*)([A-E]\s*[\)\]])/g, '$1<br/><strong class="statement-prefix">$2</strong> ');

    card.innerHTML = `
      <div class="q-header-bar">
        <div class="q-meta-badges">
          ${vDetail ? (vDetail.verified ? '<span class="pill pill-agent-verified" title="100% verified against raw DOCX source document (prompt, 5 choices, answer key, explanation)">🛡️ DOCX 100% Match</span>' : '<span class="pill pill-issue" title="Verification discrepancy found against source">🛡️ DOCX Mismatch</span>') : ''}
          ${hasIssue ? '<span class="pill pill-issue">⚠️ Has Issues</span>' : '<span class="pill pill-valid">✅ Valid</span>'}
          ${q.options && q.options.length === 5 ? '<span class="pill pill-choices">5 Choices ✓</span>' : `<span class="pill pill-issue">${q.options ? q.options.length : 0}/5 Choices</span>`}
          ${hasCorrectChoice ? `<span class="pill pill-answer">Ans: Choice ${q.answerKey} ✓</span>` : '<span class="pill pill-issue">⚠️ No Answer Selected</span>'}
          ${hasTable ? '<span class="pill pill-table">📊 Has Table</span>' : ''}
          <span class="pill">${q.topic || 'General'}</span>
          <span class="pill">${q.difficulty || 'Easy'}</span>
        </div>
      </div>

      <div class="q-body-text">
        ${formattedQuestion}
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
  currentVerification = null;
  if (questionsList) questionsList.innerHTML = '';
  if (previewSection) previewSection.classList.add('hidden');
  if (previewIssueBanner) previewIssueBanner.classList.add('hidden');
  if (verificationAgentCard) {
    verificationAgentCard.classList.add('hidden');
    verificationAgentCard.innerHTML = '';
  }
  if (previewHealthBadge) previewHealthBadge.style.display = 'none';
}

