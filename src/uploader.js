const { chromium } = require('playwright');
const { launchChromium } = require('./browserLauncher');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { ensureAuthenticatedSession, ensureValidSession } = require('./auth');

const STORAGE_PATH = path.join(__dirname, '..', 'storageState.json');

/**
 * Build a centered <figure><img> HTML block for embedding table or chart images into CKEditor.
 * @param {string} src   - data URI or URL for the image
 * @param {string} alt   - alt text / filename label
 */
function buildImageFigure(src, alt = 'Image') {
  return `<figure style="margin: 14px auto; text-align: center;">` +
    `<img src="${src}" alt="${alt}" ` +
    `style="max-width: 680px; width: 100%; height: auto; display: block; margin: 0 auto; ` +
    `border-radius: 6px; box-shadow: 0 2px 10px rgba(0,0,0,0.18);" />` +
    `</figure>`;
}

/**
 * Wrap standalone <img> tags in a centered <figure> container so CKEditor styles them properly
 */
function wrapImagesInFigure(html) {
  if (!html) return '';
  return html.replace(/(?:<figure[^>]*>)?\s*(<img\s+[^>]*>)\s*(?:<\/figure>)?/gi, (match, imgTag) => {
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
    const src = srcMatch ? srcMatch[1] : '';
    const alt = altMatch ? altMatch[1] : 'Image';
    if (!src) return match;
    return buildImageFigure(src, alt);
  });
}

/**
 * Safely set CKEditor 5 HTML data on an editable element, waiting up to 30s for it to display/initialize
 */
async function setEditorData(page, editorIndex, htmlContent, timeoutMs = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const success = await page.evaluate(({ index, html }) => {
      const editables = document.querySelectorAll('.ck-content');
      if (editables && editables[index] && editables[index].ckeditorInstance) {
        editables[index].ckeditorInstance.setData(html || '');
        return true;
      }
      return false;
    }, { index: editorIndex, html: htmlContent });

    if (success) return true;
    await page.waitForTimeout(300);
  }
  console.warn(`[Wait Timeout] CKEditor at index ${editorIndex} was not ready within ${timeoutMs / 1000}s`);
  return false;
}

// Mapping for common topic aliases between document headings and LMS dropdown items
// (Topics fetched from: https://api1.careerscloud.in/api/admin/categories/topicslist)
// (Levels fetched from:  https://api1.careerscloud.in/api/admin/quiz/difficultyLevel)
const topicAliases = {
  'national': 'National Affairs',
  'national affairs': 'National Affairs',
  'govt schemes': 'Govt Schemes',
  'government schemes': 'Govt Schemes',
  'schemes': 'Govt Schemes',
  'international': 'International Affairs',
  'international affairs': 'International Affairs',
  'visits': 'Visits',
  'banking & finance': 'Banking & Finance',
  'banking and finance': 'Banking & Finance',
  'banking': 'Banking & Finance',
  'finance': 'Banking & Finance',
  'economy & business': 'Economy & Business',
  'economy and business': 'Economy & Business',
  'economy': 'Economy & Business',
  'business': 'Economy & Business',
  'appointments': 'Appointments & Resignations',
  'appointments & resignations': 'Appointments & Resignations',
  'appointments and resignations': 'Appointments & Resignations',
  'resignations': 'Appointments & Resignations',
  'awards': 'Awards & Recognition',
  'awards & recognition': 'Awards & Recognition',
  'awards and recognition': 'Awards & Recognition',
  'index': 'Index',
  'indices': 'Index',
  'indices & reports': 'Index',
  'index & reports': 'Index',
  'index and reports': 'Index',
  'reports': 'Index',
  'important days': 'Important Days',
  'days': 'Important Days',
  'app & web portal': 'APP & Web Portal',
  'portal': 'APP & Web Portal',
  'mous & agreements': 'MoUs & Agreements',
  'mous': 'MoUs & Agreements',
  'agreements': 'MoUs & Agreements',
  'committee & meeting': 'Committee & Meeting',
  'summits & conferences': 'Summits & Conferences',
  'summits': 'Summits & Conferences',
  'science & technology': 'Science & Technology',
  'science and technology': 'Science & Technology',
  'science': 'Science & Technology',
  'defence': 'Defence',
  'sports': 'Sports',
  'books & authors': 'Books & Authors',
  'books': 'Books & Authors',
  'obituary': 'Obituary',
  'environment': 'Environment',
  'current static banking': 'Current Banking',
  'current static gk': 'Current Static GK',
  'current gk': 'Current Static GK',
  'static gk': 'Current Static GK',
  'union budget': 'Union Budget',
  'budget': 'Union Budget'
};

/**
 * Select Semantic UI dropdown option by exact or fuzzy text, waiting for items from APIs
 * (e.g. /api/admin/categories/topicslist and /api/admin/quiz/difficultyLevel).
 */
async function selectDropdownOption(page, dropdownSelector, textToMatch, timeoutMs = 30000) {
  try {
    const dropdown = page.locator(dropdownSelector).first();
    await dropdown.waitFor({ state: 'visible', timeout: timeoutMs });
    await dropdown.scrollIntoViewIfNeeded();

    // 1. Wait for dropdown options to be fetched and populated from the backend API
    const isTopicDropdown = dropdownSelector.includes('subject_topic_id');
    const startTime = Date.now();
    let rawItems = dropdown.locator('.menu .item');
    let rawCount = await rawItems.count();

    while (rawCount === 0 && Date.now() - startTime < 15000) {
      // Sometimes clicking the dropdown triggers the initial load/render
      if (Date.now() - startTime > 3000) {
        await dropdown.click().catch(() => {});
      }
      await page.waitForTimeout(400);
      rawCount = await rawItems.count();
    }

    let searchTarget = (textToMatch || '').trim();
    const lower = searchTarget.toLowerCase();
    if (topicAliases[lower]) {
      searchTarget = topicAliases[lower];
    } else if (isTopicDropdown && !searchTarget) {
      searchTarget = 'National Affairs';
    }

    // Open dropdown menu
    await dropdown.click();
    await page.waitForTimeout(250);

    // If dropdown has a search input, try typing searchTarget
    const searchInput = dropdown.locator('input.search');
    const hasSearch = await searchInput.isVisible().catch(() => false);
    if (hasSearch && searchTarget) {
      await searchInput.fill(searchTarget);
      await page.waitForTimeout(300);
    }

    // Check items matching
    let allItems = dropdown.locator('.menu .item:not(.filtered)');
    let itemCount = await allItems.count();

    // If typing filtered out ALL items, clear the search field so all options reappear
    if (hasSearch && itemCount === 0) {
      await searchInput.fill('');
      await page.waitForTimeout(200);
      allItems = dropdown.locator('.menu .item:not(.filtered)');
      itemCount = await allItems.count();
    }

    // 1. Try exact match first (case-insensitive)
    for (let i = 0; i < itemCount; i++) {
      const item = allItems.nth(i);
      const itemText = (await item.innerText().catch(() => '')).trim();
      if (itemText.toLowerCase() === searchTarget.toLowerCase()) {
        await item.click();
        await page.waitForTimeout(250);
        await closeMenu(dropdown, page);
        return true;
      }
    }

    // 2. Try partial/contains match
    for (let i = 0; i < itemCount; i++) {
      const item = allItems.nth(i);
      const itemText = (await item.innerText().catch(() => '')).trim();
      if (itemText && (itemText.toLowerCase().includes(searchTarget.toLowerCase()) || searchTarget.toLowerCase().includes(itemText.toLowerCase()))) {
        await item.click();
        await page.waitForTimeout(250);
        await closeMenu(dropdown, page);
        return true;
      }
    }

    // 3. Mandatory field fallback: if it's Topics or Difficulty, select the 1st available item
    if (itemCount > 0) {
      if (isTopicDropdown) {
        console.warn(`[Dropdown Fallback] No exact match for "${searchTarget}" in topics. Selecting first available topic: National Affairs / item 0`);
      }
      await allItems.first().click();
      await page.waitForTimeout(250);
      await closeMenu(dropdown, page);
      return true;
    }

    await closeMenu(dropdown, page);
  } catch (err) {
    console.warn(`Dropdown selection warning for "${dropdownSelector}":`, err.message);
  }
  return false;
}

async function closeMenu(dropdown, page) {
  try {
    if (await dropdown.locator('.menu.visible').isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }
  } catch (e) {}
}

/**
 * Upload single question to LMS
 */
async function uploadSingleQuestion(page, courseId, quizId, q, index, total, workerId = null) {
  const addQuestionUrl = `https://lms.careerscloud.in/courses/${courseId}/quiz/view/${quizId}/question/add`;
  const workerTag = workerId ? `[Worker #${workerId}] ` : '';
  console.log(`\n⏳ ${workerTag}[${index + 1}/${total}] Uploading: "${q.questionText.substring(0, 55)}..."`);

  await page.goto(addQuestionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Give page time for Angular & APIs (topicslist, difficultyLevel) to populate
  await page.waitForTimeout(1500);

  const reLoggedSingle = await ensureAuthenticatedSession(page, page.context());
  if (reLoggedSingle) {
    await page.goto(addQuestionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
  }

  // Wait until editor container displays (up to 30s)
  await page.locator('.ck-content').first().waitFor({ state: 'visible', timeout: 30000 });

  // Wait for backend APIs (topicslist and difficultyLevel) to finish populating the dropdowns
  await page.waitForFunction(() => {
    const topicDD = document.querySelector('.ui.dropdown[name="subject_topic_id"]');
    return topicDD && topicDD.querySelectorAll('.menu .item').length > 0;
  }, { timeout: 15000 }).catch(() => {});

  // 1. Question Text — append tables/images that belong UNDER THE QUESTION
  let questionHtml = q.questionHtml || `<p>${q.questionText}</p>`;

  // Zone 1: tables that were found in the question body (before Answer line)
  const qTableImgs = q.questionTableImages || [];
  if (qTableImgs.length > 0) {
    // Strip raw <table> from questionHtml so the clean rendered table image takes its place
    questionHtml = questionHtml.replace(/<table[\s\S]*?<\/table>/gi, '');
    for (const imgPath of qTableImgs) {
      if (fs.existsSync(imgPath)) {
        const b64 = fs.readFileSync(imgPath).toString('base64');
        questionHtml += buildImageFigure(`data:image/png;base64,${b64}`, 'Table');
      }
    }
  }

  // Embedded docx images (pie charts, inline diagrams) in question context
  const qImgs = q.questionImages || q.embeddedImages || [];
  for (const img of qImgs) {
    if (img.path && fs.existsSync(img.path)) {
      const ext = (img.fileName || img.path).split('.').pop().toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      const b64 = fs.readFileSync(img.path).toString('base64');
      questionHtml += buildImageFigure(`data:image/${mime};base64,${b64}`, img.fileName || 'Chart');
    }
  }
  // Wrap any inline docx <img> tags in styled figure
  questionHtml = wrapImagesInFigure(questionHtml);
  await setEditorData(page, 0, questionHtml, 30000);

  // 2. Options (Choice 1 to 5)
  for (let optIdx = 0; optIdx < Math.min(q.options.length, 5); optIdx++) {
    const opt = q.options[optIdx];
    await setEditorData(page, optIdx + 1, `<p>${opt.text}</p>`, 30000);
  }

  // 3. Select Correct Option Radio Button (Wait up to 30s for element)
  let correctIndex = 0;
  if (/^[1-5]$/.test(String(q.answerKey).trim())) {
    correctIndex = parseInt(q.answerKey, 10) - 1;
  } else if (/^[A-E]$/i.test(String(q.answerKey).trim())) {
    correctIndex = q.answerKey.toUpperCase().charCodeAt(0) - 65;
  }
  const radioId = `correctChoice_${correctIndex}`;

  const labelSelector = `label[for="${radioId}"]`;
  const labelLocator = page.locator(labelSelector);
  await labelLocator.waitFor({ state: 'attached', timeout: 30000 }).catch(() => { });
  if (await labelLocator.count() > 0) {
    await labelLocator.click();
  } else {
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, radioId);
  }

  // 4. Solution / Explanation — append tables/images that belong UNDER THE SOLUTION
  let explanationHtml = q.explanationHtml || `<p>${q.explanationText || 'No explanation provided.'}</p>`;

  // Zone 2: tables that were found inside the explanation/solution section
  const expTableImgs = q.explanationTableImages || [];
  if (expTableImgs.length > 0) {
    // Strip raw <table> from explanationHtml so the clean rendered table image takes its place
    explanationHtml = explanationHtml.replace(/<table[\s\S]*?<\/table>/gi, '');
    for (const imgPath of expTableImgs) {
      if (fs.existsSync(imgPath)) {
        const b64 = fs.readFileSync(imgPath).toString('base64');
        explanationHtml += buildImageFigure(`data:image/png;base64,${b64}`, 'Table');
      }
    }
  }

  // Embedded docx images in explanation (pie charts, diagrams)
  if (q.explanationImages && q.explanationImages.length > 0) {
    for (const img of q.explanationImages) {
      if (img.path && fs.existsSync(img.path)) {
        const ext = (img.fileName || img.path).split('.').pop().toLowerCase();
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        const b64 = fs.readFileSync(img.path).toString('base64');
        explanationHtml += buildImageFigure(`data:image/${mime};base64,${b64}`, img.fileName || 'Chart');
      }
    }
  }
  // Wrap any inline docx <img> tags in styled figure
  explanationHtml = wrapImagesInFigure(explanationHtml);
  await setEditorData(page, 6, explanationHtml, 30000);


  // 5. Select Topic (Mandatory field in LMS, loaded via /categories/topicslist)
  const targetTopic = q.topic || 'National Affairs';
  await selectDropdownOption(page, '.ui.dropdown[name="subject_topic_id"]', targetTopic, 30000);

  // 6. Select Difficulty (Loaded via /quiz/difficultyLevel)
  const difficultyMap = {
    'easy': 'Easy',
    'moderate': 'Medium',
    'medium': 'Medium',
    'hard': 'Hard',
    'difficult': 'Hard'
  };
  const rawDiff = (q.difficulty || 'Easy').trim().toLowerCase();
  const difficultyText = difficultyMap[rawDiff] || 'Easy';
  await selectDropdownOption(page, '.ui.dropdown[name="quiz_difficulty_level_id"]', difficultyText, 30000);

  // Pre-Submit Safety Check: Ensure Topics is NOT "Select Topics"
  const isTopicFilled = await page.evaluate(() => {
    const dd = document.querySelector('.ui.dropdown[name="subject_topic_id"]');
    const txt = dd?.querySelector('.text')?.innerText?.trim();
    return txt && txt !== 'Select Topics';
  });

  if (!isTopicFilled) {
    console.warn(`[Auto-Fix] Topics was not selected before submit for Q${q.number}. Forcing selection...`);
    await selectDropdownOption(page, '.ui.dropdown[name="subject_topic_id"]', 'National Affairs', 15000);
  }

  // 7. Click Create Question — robust submission with poll-based navigation detection
  const createBtn = page.locator('button:has-text("Create question")');
  await createBtn.waitFor({ state: 'visible', timeout: 30000 });

  // Scroll the button into view so it's not obscured, then click it
  await createBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  // Start waiting for navigation BEFORE clicking (race condition prevention)
  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);

  await createBtn.click({ force: true });

  // Poll the URL every 500ms for up to 45s to detect navigation away from /add
  const navStart = Date.now();
  let navigated = false;
  while (Date.now() - navStart < 45000) {
    const currentUrl = page.url();
    if (!currentUrl.includes('/question/add') && !currentUrl.includes('/add')) {
      navigated = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  // Cancel nav promise if still pending
  navPromise.catch(() => {});

  if (!navigated) {
    // Take a diagnostic screenshot
    const workerSuffix = workerId ? `_w${workerId}` : '';
    const screenshotPath = path.join(__dirname, '..', `form_error_q${q.number || (index + 1)}${workerSuffix}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    // Try to read any form validation or error messages from the page
    const errorMessages = await page.evaluate(() => {
      const selectors = [
        '.ui.error.message', '.ui.negative.message', '.ui.warning.message',
        '.error.field label', '.toast-error', '.alert-danger',
        '[class*="error"]', '[class*="invalid"]'
      ];
      const msgs = [];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          const t = el.innerText ? el.innerText.trim() : '';
          if (t && t.length < 500 && !msgs.includes(t)) msgs.push(t);
        });
      }
      // Also check :invalid inputs
      document.querySelectorAll('input:invalid, select:invalid, textarea:invalid').forEach(el => {
        msgs.push(`Required field missing or invalid: ${el.name || el.id || el.className}`);
      });
      return msgs.join(' | ') || 'No error message found on page';
    }).catch(() => 'Unable to read page errors');

    // Also check if radio button actually got selected
    const radioState = await page.evaluate((radioId) => {
      const el = document.getElementById(radioId);
      return el ? `checked=${el.checked}` : 'radio not found';
    }, radioId).catch(() => 'unknown');

    throw new Error(
      `Form did not submit for Q${q.number} after 45s.\n` +
      `Page errors: ${errorMessages}\n` +
      `Radio state: ${radioState}\n` +
      `Diagnostic screenshot: ${screenshotPath}`
    );
  }

  console.log(`✅ ${workerTag}Q${q.number} uploaded successfully!`);
}

/**
 * Main automated upload workflow with multi-worker parallel execution support
 */
async function uploadQuizQuestions(quizData, options = {}, onProgress = () => { }) {
  const courseId = options.courseId || '104';
  let targetQuiz = options.targetQuiz || 'latest';
  const startFromQ = Math.max(1, parseInt(options.startFromQ, 10) || 1);
  const isHeadless = options.headless === true;
  const requestedWorkers = Math.max(1, Math.min(10, parseInt(options.workers || options.parallelWorkers, 10) || 1));

  onProgress({
    type: 'log',
    message: isHeadless
      ? '🔕 Running in Background (Headless) mode'
      : '👁️ Opening visible Chrome window on your screen...',
    level: isHeadless ? 'info' : 'success'
  });

  const launchOptions = {
    headless: isHeadless,
    slowMo: isHeadless ? 20 : 60,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  };

  if (!isHeadless) {
    launchOptions.args.push('--start-maximized');
  }

  onProgress({ type: 'log', message: 'Verifying LMS session token...', level: 'info' });
  await ensureValidSession((msg) => onProgress({ type: 'log', message: msg, level: 'info' }));

  // ─── Verification: Ensure all questions have 5 choices and selected correct answer ───
  const rawQuestions = quizData.questions || [];
  const validationErrors = [];
  rawQuestions.forEach((q, idx) => {
    const qNum = q.number || idx + 1;
    if (!q.options || q.options.length !== 5) {
      validationErrors.push(`Q#${qNum}: Has ${q.options ? q.options.length : 0}/5 choices`);
    }
    const cleanKey = String(q.answerKey || '').trim().toUpperCase();
    const hasValidKey = /^[1-5]$/.test(cleanKey) || /^[A-E]$/.test(cleanKey);
    if (!hasValidKey) {
      validationErrors.push(`Q#${qNum}: No valid correct answer selected (got "${q.answerKey}")`);
    }
  });

  if (validationErrors.length > 0) {
    const summary = validationErrors.slice(0, 3).join('; ') + (validationErrors.length > 3 ? ` (and ${validationErrors.length - 3} more)` : '');
    onProgress({
      type: 'log',
      message: `⚠️ Choice/Answer Notice: ${summary}`,
      level: 'warning'
    });
  } else {
    onProgress({
      type: 'log',
      message: `✅ Pre-upload Verified: All ${rawQuestions.length} questions have 5 choices and confirmed correct answers.`,
      level: 'success'
    });
  }

  const browser = await launchChromium(launchOptions);

  try {
    // ─── Step 1: Discover / Lock Target Quiz ID ─────────────────────────
    let quizId = null;

    if (/^\d+$/.test(String(targetQuiz).trim())) {
      quizId = String(targetQuiz).trim();
      onProgress({ type: 'log', message: `Targeting Quiz ID directly: ${quizId}`, level: 'info' });
    } else {
      onProgress({ type: 'log', message: `Connecting to Course ${courseId} to find quiz target...`, level: 'info' });
      onProgress({ type: 'progress', percent: 2, message: `Opening Course ${courseId}...` });

      const discoveryContext = await browser.newContext({
        storageState: fs.existsSync(STORAGE_PATH) ? STORAGE_PATH : undefined,
        viewport: isHeadless ? { width: 1280, height: 900 } : null
      });
      const discoveryPage = await discoveryContext.newPage();

      try {
        await discoveryPage.goto(`https://lms.careerscloud.in/courses/view/${courseId}`, { waitUntil: 'networkidle', timeout: 35000 });

        const reLogged = await ensureAuthenticatedSession(discoveryPage, discoveryContext, (msg) => onProgress({ type: 'log', message: msg, level: 'info' }));
        if (reLogged) {
          onProgress({ type: 'log', message: `Navigating back to Course ${courseId} after login...`, level: 'info' });
          await discoveryPage.goto(`https://lms.careerscloud.in/courses/view/${courseId}`, { waitUntil: 'networkidle', timeout: 35000 });
        }

        onProgress({ type: 'log', message: 'Clicking Quizzes tab in Course view...', level: 'info' });
        const quizzesTab = discoveryPage.locator('.ui.tabular.menu a.item', { hasText: 'Quizzes' }).first();
        await quizzesTab.waitFor({ state: 'visible', timeout: 30000 });
        await quizzesTab.click();

        await discoveryPage.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => { });

        let eyeButton;
        if (targetQuiz && targetQuiz !== 'latest') {
          onProgress({ type: 'log', message: `Searching for Quiz matching: "${targetQuiz}"...`, level: 'info' });
          const matchingRow = discoveryPage.locator('table tbody tr', { hasText: targetQuiz }).first();
          if (await matchingRow.count() > 0) {
            eyeButton = matchingRow.locator('a.view').first();
          }
        }

        if (!eyeButton || await eyeButton.count() === 0) {
          onProgress({ type: 'log', message: 'Selecting the first/latest quiz (clicking Eye icon)...', level: 'info' });
          eyeButton = discoveryPage.locator('table tbody tr:first-child a.view').first();
        }

        if (eyeButton) {
          await eyeButton.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { });
        }

        if (await eyeButton.count() === 0) {
          throw new Error('No quiz rows or Eye view icons found in Course ' + courseId);
        }

        const viewHref = await eyeButton.getAttribute('href');
        const idMatch = viewHref ? viewHref.match(/quiz\/view\/(\d+)/) : null;
        if (idMatch) {
          quizId = idMatch[1];
        } else {
          await Promise.all([
            discoveryPage.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
            eyeButton.click()
          ]);
          const urlMatch = discoveryPage.url().match(/quiz\/view\/(\d+)/);
          quizId = urlMatch ? urlMatch[1] : null;
        }
      } finally {
        await discoveryContext.close().catch(() => {});
      }
    }

    if (!quizId) {
      throw new Error(`Failed to resolve Quiz ID in Course ${courseId}`);
    }

    const quizUrl = `https://lms.careerscloud.in/courses/${courseId}/quiz/view/${quizId}`;
    onProgress({ type: 'log', message: `Target Quiz ID locked: ${quizId}. View URL: ${quizUrl}`, level: 'success' });

    // ─── Step 2: Prepare Shared Work Queue ─────────────────────────────
    const total = quizData.questions.length;
    const startIndex = startFromQ - 1;
    const totalToUpload = total - startIndex;

    if (totalToUpload <= 0) {
      onProgress({ type: 'log', message: `All ${total} questions already processed (startFromQ: ${startFromQ}). Nothing to upload!`, level: 'warn' });
      await browser.close().catch(() => {});
      return { success: true, quizId, quizUrl, totalUploaded: 0 };
    }

    if (startIndex > 0) {
      onProgress({
        type: 'log',
        message: `⏩ Resuming: Skipping first ${startIndex} questions. Starting from Q${startFromQ}!`,
        level: 'warn'
      });
    }

    const activeWorkers = Math.min(requestedWorkers, totalToUpload);

    if (activeWorkers > 1) {
      onProgress({
        type: 'log',
        message: `⚡ Parallel Execution Active: Running ${activeWorkers} concurrent browser workers for ${totalToUpload} questions!`,
        level: 'success'
      });
    } else {
      onProgress({
        type: 'log',
        message: `Running in Sequential Mode (1 worker) for ${totalToUpload} questions.`,
        level: 'info'
      });
    }

    // Build the atomic question queue
    const queue = [];
    for (let i = startIndex; i < total; i++) {
      queue.push({
        q: quizData.questions[i],
        index: i
      });
    }

    const uploadStartTime = Date.now();
    let completedCount = 0;
    const failedTasks = [];
    const maxRetries = 3;

    // ─── Step 3: Worker Function ───────────────────────────────────────
    const runWorker = async (workerId) => {
      // Stagger worker startups slightly to prevent burst requests to LMS
      if (workerId > 1) {
        await new Promise(r => setTimeout(r, (workerId - 1) * 1500));
      }

      const workerContext = await browser.newContext({
        storageState: fs.existsSync(STORAGE_PATH) ? STORAGE_PATH : undefined,
        viewport: isHeadless ? { width: 1280, height: 900 } : null
      });
      const workerPage = await workerContext.newPage();

      // Maximize window via CDP if single headful worker
      if (!isHeadless && activeWorkers === 1) {
        try {
          const session = await workerContext.newCDPSession(workerPage);
          const { windowId } = await session.send('Browser.getWindowForTarget');
          await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'maximized' }
          });
          await workerPage.bringToFront();
        } catch (e) { }
      }

      onProgress({
        type: 'log',
        message: `🟢 Worker #${workerId} online and ready`,
        level: 'info'
      });

      try {
        while (queue.length > 0) {
          const task = queue.shift();
          if (!task) break;

          const { q, index: i } = task;
          let questionUploaded = false;
          let lastError = null;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              onProgress({
                type: 'log',
                message: attempt === 1
                  ? `[Worker #${workerId}] Uploading [Q${i + 1}/${total}]: "${q.questionText.substring(0, 48)}..."`
                  : `🔄 [Worker #${workerId} Retry ${attempt}/${maxRetries}] Retrying Q${i + 1} after issue...`,
                level: attempt === 1 ? 'info' : 'warn'
              });

              await uploadSingleQuestion(workerPage, courseId, quizId, q, i, total, workerId);
              questionUploaded = true;
              break; // Uploaded successfully
            } catch (qErr) {
              lastError = qErr;
              console.warn(`[Worker #${workerId} Q${i + 1} Attempt ${attempt}/${maxRetries} Error]:`, qErr.message);

              if (attempt < maxRetries) {
                onProgress({
                  type: 'log',
                  message: `⚠️ [Worker #${workerId}] Q${i + 1} attempt ${attempt} warning: ${qErr.message.split('\n')[0]}. Auto-retrying...`,
                  level: 'warn'
                });
                await workerPage.waitForTimeout(1500);
              }
            }
          }

          if (!questionUploaded) {
            failedTasks.push({ q, index: i, error: lastError?.message });
            onProgress({
              type: 'log',
              message: `❌ [Worker #${workerId}] Q${i + 1} failed after ${maxRetries} attempts!`,
              level: 'error'
            });
          } else {
            completedCount++;
            const percent = Math.round((completedCount / totalToUpload) * 100);
            const elapsedSec = Math.max(1, Math.round((Date.now() - uploadStartTime) / 1000));
            const avgPerQ = elapsedSec / completedCount;
            const remainingQuestions = totalToUpload - completedCount;
            const etaSec = Math.round(avgPerQ * remainingQuestions);

            onProgress({
              type: 'progress',
              percent,
              current: completedCount,
              total: totalToUpload,
              elapsedSec,
              etaSec,
              avgPerQ: avgPerQ.toFixed(1),
              message: activeWorkers > 1
                ? `Worker #${workerId} finished Q${i + 1} (${completedCount}/${totalToUpload} done, ${percent}%)`
                : `Uploaded question ${i + 1} of ${total} (${percent}%)`
            });
          }
        }
      } finally {
        await workerContext.close().catch(() => {});
        onProgress({
          type: 'log',
          message: `🏁 Worker #${workerId} finished all assigned questions`,
          level: 'info'
        });
      }
    };

    // ─── Step 4: Run All Workers in Parallel ───────────────────────────
    const workerPromises = [];
    for (let w = 1; w <= activeWorkers; w++) {
      workerPromises.push(runWorker(w));
    }
    await Promise.all(workerPromises);

    if (failedTasks.length > 0) {
      throw new Error(`${failedTasks.length} questions failed to upload: ${failedTasks.map(f => 'Q' + (f.index + 1)).join(', ')}`);
    }

    // ─── Step 5: Summary & Final Verification ──────────────────────────
    const totalDurationMs = Date.now() - uploadStartTime;
    const totalDurationSec = Math.max(1, Math.round(totalDurationMs / 1000));
    const mins = Math.floor(totalDurationSec / 60);
    const secs = totalDurationSec % 60;
    const formattedDuration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const avgSpeed = (totalDurationSec / completedCount).toFixed(1);

    onProgress({
      type: 'complete',
      message: `🎉 All ${completedCount} questions uploaded successfully in ${formattedDuration}! (avg ${avgSpeed}s / question across ${activeWorkers} worker${activeWorkers > 1 ? 's' : ''})`,
      totalDurationSec,
      formattedDuration,
      avgSpeed,
      countUploaded: completedCount,
      url: quizUrl
    });

    try {
      const verifyContext = await browser.newContext({ storageState: STORAGE_PATH });
      const verifyPage = await verifyContext.newPage();
      await verifyPage.goto(quizUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await verifyPage.screenshot({ path: path.join(__dirname, '..', `published_quiz_${quizId}.png`), fullPage: true }).catch(() => {});
      await verifyContext.close().catch(() => {});
    } catch (e) {}

    return {
      success: true,
      quizId,
      quizUrl,
      totalUploaded: completedCount,
      workers: activeWorkers
    };

  } catch (error) {
    onProgress({ type: 'error', message: error.message });
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { uploadQuizQuestions, uploadSingleQuestion, selectDropdownOption, setEditorData };