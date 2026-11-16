const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  console.log('Navigating to course 104...');
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });

  // Locate the course tabs specifically
  const tabs = await page.$$eval('.tab, [role="tab"], button, div', els => {
    return els
      .filter(el => ['Paths', 'Articles', 'Quizzes', 'Mock Test', 'Doubt', "FAQ's"].includes(el.innerText && el.innerText.trim()))
      .map(el => ({
        text: el.innerText.trim(),
        tagName: el.tagName,
        className: el.className,
        outerHTML: el.outerHTML.substring(0, 150)
      }));
  });

  console.log('Found course tabs:', JSON.stringify(tabs, null, 2));

  await browser.close();
})().catch(err => console.error('Error:', err));
