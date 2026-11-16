const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  // 1. Inspect Single Question Add Form
  console.log('Navigating to Single Question Add form...');
  await page.goto('https://lms.careerscloud.in/courses/104/quiz/view/22006/question/add', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'single_question_add_form.png', fullPage: true });
  console.log('Saved single_question_add_form.png');

  const singleInputs = await page.$$eval('input, textarea, select, .dropdown, button', els => els.map(e => ({
    tag: e.tagName,
    type: e.type || '',
    name: e.name || '',
    id: e.id || '',
    placeholder: e.placeholder || '',
    text: e.innerText ? e.innerText.trim().substring(0, 50) : '',
    className: e.className
  })).filter(e => e.id || e.name || e.placeholder || e.text));
  console.log('--- Single Question Form elements count:', singleInputs.length);

  // 2. Inspect Group Question Add Form
  console.log('\nNavigating to Group Question Add form...');
  await page.goto('https://lms.careerscloud.in/courses/104/quiz/view/22006/question/group/add', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'group_question_add_form.png', fullPage: true });
  console.log('Saved group_question_add_form.png');

  const groupInputs = await page.$$eval('input, textarea, select, .dropdown, button', els => els.map(e => ({
    tag: e.tagName,
    type: e.type || '',
    name: e.name || '',
    id: e.id || '',
    placeholder: e.placeholder || '',
    text: e.innerText ? e.innerText.trim().substring(0, 50) : '',
    className: e.className
  })).filter(e => e.id || e.name || e.placeholder || e.text));
  console.log('--- Group Question Form elements count:', groupInputs.length);

  await browser.close();
})();
