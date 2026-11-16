const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://lms.careerscloud.in/');
  await page.waitForLoadState('networkidle');

  const inputs = await page.$$eval('input', els => els.map(el => ({
    name: el.name,
    id: el.id,
    type: el.type,
    placeholder: el.placeholder,
    className: el.className
  })));
  console.log('Inputs:', JSON.stringify(inputs, null, 2));

  const buttons = await page.$$eval('button', els => els.map(el => ({
    text: el.innerText.trim(),
    type: el.type,
    id: el.id
  })));
  console.log('Buttons:', JSON.stringify(buttons, null, 2));

  await browser.close();
})();
