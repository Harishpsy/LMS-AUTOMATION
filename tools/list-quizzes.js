const { chromium } = require('playwright');
const path = require('path');
const STORAGE_PATH = path.join(__dirname, 'storageState.json');

async function getCourseQuizzes() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });
  await page.locator('.ui.tabular.menu a.item', { hasText: 'Quizzes' }).click();
  await page.waitForTimeout(2000);

  const quizzes = await page.$$eval('table tbody tr', rows => rows.map(r => {
    const titleEl = r.querySelector('strong, b, .title') || r.querySelector('td:nth-child(2)');
    const viewLink = r.querySelector('a.view');
    const statusEl = r.querySelector('.grid-status-chip, .activatebbt');
    const rawText = titleEl ? titleEl.innerText : '';
    const title = rawText.split('\n')[0].trim();
    return {
      title,
      viewUrl: viewLink ? viewLink.href : null,
      quizId: viewLink && viewLink.href ? viewLink.href.split('/').pop() : null,
      status: statusEl ? statusEl.innerText.trim() : ''
    };
  }));

  await browser.close();
  return quizzes;
}

if (require.main === module) {
  getCourseQuizzes().then(q => console.log('Quizzes:', JSON.stringify(q, null, 2)))
    .catch(err => console.error(err));
}

module.exports = { getCourseQuizzes };
