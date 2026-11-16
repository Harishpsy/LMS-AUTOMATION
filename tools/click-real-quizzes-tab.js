const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  console.log('Navigating to course 104...');
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });

  console.log('Clicking tabular Quizzes menu item...');
  const quizzesTab = page.locator('.ui.tabular.menu a.item', { hasText: 'Quizzes' });
  await quizzesTab.click();

  await page.waitForTimeout(3000);
  console.log('URL after clicking tab:', page.url());

  await page.screenshot({ path: 'course_104_quizzes_view.png', fullPage: true });
  console.log('Saved course_104_quizzes_view.png');

  // Find buttons/actions on this view
  const buttons = await page.$$eval('button, a.button, .ui.button, .btn', els => els.map(b => ({
    text: b.innerText.trim(),
    className: b.className,
    id: b.id
  })).filter(b => b.text.length > 0));

  console.log('Buttons found in view:', JSON.stringify(buttons, null, 2));

  await browser.close();
})();
