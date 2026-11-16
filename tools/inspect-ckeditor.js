const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  await page.goto('https://lms.careerscloud.in/courses/104/quiz/view/22006/question/add', { waitUntil: 'networkidle' });

  // Inspect all CKEditor content areas
  const ckEditors = await page.$$eval('.ck-content', els => els.map((el, i) => ({
    index: i,
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    className: el.className
  })));
  console.log('CKEditor instances:', JSON.stringify(ckEditors, null, 2));

  // Inspect radio buttons for choices
  const radios = await page.$$eval('input[type="radio"]', els => els.map((el, i) => ({
    index: i,
    name: el.name,
    id: el.id,
    value: el.value,
    checked: el.checked
  })));
  console.log('Radio buttons:', JSON.stringify(radios, null, 2));

  // Inspect dropdowns on right side (Topics, Difficulty)
  const dropdowns = await page.$$eval('.ui.dropdown, select', els => els.map((el, i) => ({
    index: i,
    tag: el.tagName,
    name: el.getAttribute('name'),
    className: el.className,
    text: el.innerText ? el.innerText.trim().substring(0, 50) : ''
  })));
  console.log('Dropdowns:', JSON.stringify(dropdowns, null, 2));

  await browser.close();
})();
