const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  await page.goto('https://lms.careerscloud.in/courses/104/quiz/add', { waitUntil: 'networkidle' });

  // Inspect all dropdowns on Add Quiz page
  const dropdownDetails = await page.evaluate(() => {
    const dds = document.querySelectorAll('.ui.dropdown');
    return Array.from(dds).map(dd => {
      const name = dd.querySelector('input[type="hidden"]')?.name || dd.getAttribute('name');
      const placeholder = dd.querySelector('.default.text')?.innerText || '';
      const items = Array.from(dd.querySelectorAll('.menu .item')).map(it => ({
        text: it.innerText.trim()
      }));
      return { name, placeholder, itemsCount: items.length, sampleItems: items.slice(0, 10) };
    });
  });

  console.log('Add Quiz Dropdowns:', JSON.stringify(dropdownDetails, null, 2));

  await browser.close();
})();
