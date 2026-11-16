const { chromium } = require('playwright');
const path = require('path');
const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();
  await page.goto('https://lms.careerscloud.in/courses/104/quiz/add', { waitUntil: 'networkidle' });

  const pathField = await page.evaluate(() => {
    const el = document.querySelector('[placeholder*="Path Settings"]') || document.querySelector('[name*="path"]');
    const parent = el ? el.closest('.field, .form-group, div') : null;
    return {
      tag: el ? el.tagName : null,
      outer: el ? el.outerHTML : null,
      parentHtml: parent ? parent.outerHTML.substring(0, 300) : null
    };
  });
  console.log('Path Field Info:', JSON.stringify(pathField, null, 2));

  // Let's also see what happens if we click it
  const pathInput = page.locator('[placeholder*="Path Settings"]').first();
  if (await pathInput.count() > 0) {
    await pathInput.click();
    await page.waitForTimeout(1000);
    const modalOrMenu = await page.$$eval('.modal, .ui.modal, .dropdown .menu, .ui.popup', els => els.map(e => ({
      className: e.className,
      text: e.innerText.trim().substring(0, 100)
    })).filter(e => e.text.length > 0));
    console.log('Popups/Modals after clicking Path Settings:', JSON.stringify(modalOrMenu, null, 2));
  }

  await browser.close();
})();
