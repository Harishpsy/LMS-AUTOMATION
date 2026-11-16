const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });

  // Find all elements containing text "Quizzes"
  const elements = await page.locator('text=Quizzes').all();
  console.log('Total elements with text Quizzes:', elements.length);

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const box = await el.boundingBox();
    const tag = await el.evaluate(e => e.tagName);
    const parentTag = await el.evaluate(e => e.parentElement.tagName + ' class=' + e.parentElement.className);
    const outer = await el.evaluate(e => e.outerHTML);
    console.log(`Element ${i}: Tag=${tag}, Box=${JSON.stringify(box)}, Parent=${parentTag}`);
    console.log(`HTML: ${outer.substring(0, 150)}\n`);
  }

  await browser.close();
})();
