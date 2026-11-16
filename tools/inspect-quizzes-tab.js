const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  console.log('Navigating to course 104...');
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });

  console.log('Looking for Quizzes tab...');
  // The tab says "Quizzes"
  const quizzesTab = await page.getByRole('tab', { name: /Quizzes/i }).or(page.locator('text=Quizzes')).first();
  await quizzesTab.click();
  console.log('Clicked Quizzes tab');

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'course_104_quizzes_tab.png', fullPage: true });
  console.log('Saved course_104_quizzes_tab.png');

  // Inspect all visible buttons or action links on this tab
  const actions = await page.$$eval('button, a, [role="button"]', els => els.map(el => ({
    text: el.innerText.trim(),
    tag: el.tagName,
    id: el.id,
    className: el.className,
    href: el.href || null
  })).filter(a => a.text.length > 0));

  console.log('Visible buttons/actions:', JSON.stringify(actions.filter(a =>
    a.text.toLowerCase().includes('quiz') ||
    a.text.toLowerCase().includes('create') ||
    a.text.toLowerCase().includes('add') ||
    a.text.toLowerCase().includes('new')
  ), null, 2));

  await browser.close();
})().catch(err => console.error('Error:', err));
