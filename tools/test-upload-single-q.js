const { chromium } = require('playwright');
const path = require('path');
const { parseQuizDocx } = require('./src/parser');
const STORAGE_PATH = path.join(__dirname, 'storageState.json');

async function setEditorData(page, editorIndex, htmlContent) {
  return await page.evaluate(({ index, html }) => {
    const editables = document.querySelectorAll('.ck-content');
    if (editables && editables[index] && editables[index].ckeditorInstance) {
      editables[index].ckeditorInstance.setData(html || '');
      return true;
    }
    return false;
  }, { index: editorIndex, html: htmlContent });
}

async function selectDropdownOption(page, dropdownSelector, textToMatch) {
  try {
    const dropdown = page.locator(dropdownSelector).first();
    await dropdown.click();
    await page.waitForTimeout(300);

    const option = dropdown.locator('.menu .item', { hasText: textToMatch }).first();
    if (await option.count() > 0) {
      await option.click();
      await page.waitForTimeout(200);
      return true;
    } else {
      const firstItem = dropdown.locator('.menu .item').first();
      if (await firstItem.count() > 0) {
        await firstItem.click();
        await page.waitForTimeout(200);
        return true;
      }
    }
  } catch (err) {
    console.warn(`Dropdown selection warning:`, err.message);
  }
  return false;
}

(async () => {
  const quizId = '22006'; // Target quiz from user
  console.log(`Testing single question upload to Quiz ID: ${quizId}`);

  // 1. Parse sample question 1
  const docxPath = path.join(__dirname, 'Quiz Document', 'Daily Quiz - 23rd Oct.docx');
  const parsed = await parseQuizDocx(docxPath);
  const q = parsed.questions[0]; // Question 1

  console.log('Question 1 to upload:', q.questionText);
  console.log('Options count:', q.options.length);
  console.log('Correct Answer Key:', q.answerKey, '-', q.answerText);

  // 2. Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  // 3. Open Add Question Form
  const addQuestionUrl = `https://lms.careerscloud.in/courses/104/quiz/view/${quizId}/question/add`;
  console.log('Navigating to:', addQuestionUrl);
  await page.goto(addQuestionUrl, { waitUntil: 'networkidle' });

  // 4. Fill Question text
  console.log('Setting Question text in CKEditor 0...');
  await setEditorData(page, 0, `<p>${q.questionText}</p>`);

  // 5. Fill Options
  console.log('Setting Options 1 to 5 in CKEditors 1..5...');
  for (let optIdx = 0; optIdx < Math.min(q.options.length, 5); optIdx++) {
    const opt = q.options[optIdx];
    await setEditorData(page, optIdx + 1, `<p>${opt.text}</p>`);
  }

  // 6. Select Correct Radio Button
  const correctChoiceIndex = parseInt(q.answerKey, 10) - 1; // 4 - 1 = 3 -> correctChoice_3
  const radioSelector = `#correctChoice_${correctChoiceIndex}`;
  console.log(`Checking radio button: ${radioSelector}...`);
  await page.check(radioSelector);

  // 7. Fill Explanation
  console.log('Setting Explanation in CKEditor 6...');
  await setEditorData(page, 6, q.explanationHtml || `<p>${q.explanationText}</p>`);

  // 8. Select Topic & Difficulty
  console.log(`Selecting Topic: "${q.topic}"...`);
  await selectDropdownOption(page, '.ui.dropdown[name="subject_topic_id"]', q.topic);

  console.log(`Selecting Difficulty: "${q.difficulty}"...`);
  await selectDropdownOption(page, '.ui.dropdown[name="quiz_difficulty_level_id"]', q.difficulty);

  await page.screenshot({ path: 'test_question_filled.png', fullPage: true });
  console.log('📸 Screenshot of filled question saved: test_question_filled.png');

  // 9. Click Create question
  console.log('Submitting question...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    page.click('button:has-text("Create question")')
  ]);

  console.log('URL after submission:', page.url());
  await page.screenshot({ path: 'test_after_question_created.png', fullPage: true });
  console.log('📸 Screenshot after question creation saved: test_after_question_created.png');

  await browser.close();
  console.log('🎉 Test completed successfully!');
})().catch(err => console.error('Error during test:', err));
