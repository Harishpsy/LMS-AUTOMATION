const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  console.log('Navigating to course 104...');
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });

  console.log('Clicking Quizzes tab...');
  await page.locator('.ui.tabular.menu a.item', { hasText: 'Quizzes' }).click();
  await page.waitForTimeout(2000);

  console.log('Clicking "+ Add Quiz" button...');
  const addQuizBtn = page.locator('button, a', { hasText: 'Add Quiz' }).first();
  await addQuizBtn.click();

  await page.waitForTimeout(3000);
  console.log('Current URL after clicking Add Quiz:', page.url());

  await page.screenshot({ path: 'add_quiz_modal_or_page.png', fullPage: true });
  console.log('Saved add_quiz_modal_or_page.png');

  // Inspect form fields / inputs in modal or page
  const formElements = await page.$$eval('input, textarea, select, .dropdown, button', els => els.map(el => ({
    tag: el.tagName,
    type: el.type || '',
    name: el.name || '',
    id: el.id || '',
    placeholder: el.placeholder || '',
    text: el.innerText ? el.innerText.trim() : '',
    className: el.className
  })).filter(e => e.id || e.name || e.placeholder || e.text));

  console.log('Form elements:', JSON.stringify(formElements.slice(0, 30), null, 2));

  await browser.close();
})();
