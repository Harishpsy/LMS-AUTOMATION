const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  console.log('Navigating to course 104...');
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });

  // Click Quizzes tab
  await page.locator('.ui.tabular.menu a.item', { hasText: 'Quizzes' }).click();
  await page.waitForTimeout(2000);

  // Find the edit button (pencil icon) in the table
  const editButtons = await page.$$eval('table tbody tr', rows => {
    return rows.map(r => {
      const titleEl = r.querySelector('strong, b, .title, td:nth-child(2)');
      const links = Array.from(r.querySelectorAll('a, button')).map(a => ({
        tag: a.tagName,
        href: a.href || null,
        className: a.className,
        innerHTML: a.innerHTML.substring(0, 100)
      }));
      return {
        title: titleEl ? titleEl.innerText.trim() : '',
        actions: links
      };
    });
  });

  console.log('Table rows and actions:', JSON.stringify(editButtons, null, 2));

  // Click the first edit button (the pencil icon for quiz 1)
  const firstEditBtn = page.locator('table tbody tr:first-child a[href*="edit"], table tbody tr:first-child .fa-pencil, table tbody tr:first-child .pencil, table tbody tr:first-child i.edit').first();
  // Or find by icon inside the first row
  const row1Actions = page.locator('table tbody tr:first-child td a');
  const count = await row1Actions.count();
  console.log('Action links in first row:', count);

  for (let i = 0; i < count; i++) {
    const href = await row1Actions.nth(i).getAttribute('href');
    const html = await row1Actions.nth(i).innerHTML();
    console.log(`Action ${i}: href=${href}, html=${html}`);
  }

  // Navigate to the edit url directly if found
  const editLink = await page.locator('table tbody tr:first-child a[href*="edit"], table tbody tr:first-child a:has(i.pencil), table tbody tr:first-child a:has(i.edit)').first();
  if (await editLink.count() > 0) {
    const editUrl = await editLink.getAttribute('href');
    console.log('Edit URL found:', editUrl);
    await editLink.click();
    await page.waitForTimeout(3000);
    console.log('Current URL after clicking Edit:', page.url());
    await page.screenshot({ path: 'quiz_edit_page.png', fullPage: true });
    console.log('Saved quiz_edit_page.png');
  }

  await browser.close();
})();
