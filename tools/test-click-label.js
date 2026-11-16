const { chromium } = require('playwright');
const path = require('path');
const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();
  await page.goto('https://lms.careerscloud.in/courses/104/quiz/view/22006/question/add', { waitUntil: 'networkidle' });

  console.log('Clicking label for choice 4 (correctChoice_3)...');
  await page.click('label[for="correctChoice_3"]');
  const isChecked = await page.isChecked('#correctChoice_3');
  console.log('Result isChecked:', isChecked);

  await browser.close();
})();
