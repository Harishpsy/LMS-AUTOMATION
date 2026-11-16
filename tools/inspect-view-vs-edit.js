const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  // 1. Check if there is anything below on the edit page
  await page.goto('https://lms.careerscloud.in/courses/104/quiz/edit/22006', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'quiz_edit_bottom.png', fullPage: true });
  console.log('Saved quiz_edit_bottom.png');

  // 2. Check the quiz view page: https://lms.careerscloud.in/courses/104/quiz/view/22006
  console.log('Navigating to quiz view page...');
  await page.goto('https://lms.careerscloud.in/courses/104/quiz/view/22006', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'quiz_view_page.png', fullPage: true });
  console.log('Saved quiz_view_page.png');

  // Inspect links and buttons on quiz view page
  const viewActions = await page.$$eval('a, button, [role="button"]', els => els.map(e => ({
    text: e.innerText.trim(),
    tag: e.tagName,
    className: e.className,
    href: e.href || null
  })).filter(e => e.text.length > 0));
  console.log('Actions on quiz view page:', JSON.stringify(viewActions, null, 2));

  await browser.close();
})();
