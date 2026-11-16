const { chromium } = require('playwright');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();

  await page.goto('https://lms.careerscloud.in/courses/104/quiz/view/22006/question/add', { waitUntil: 'networkidle' });

  // Test CKEditor API access
  const editorTest = await page.evaluate(() => {
    const editables = document.querySelectorAll('.ck-content');
    const results = [];
    editables.forEach((el, idx) => {
      // Check if ckeditorInstance is attached
      const hasInstance = !!el.ckeditorInstance;
      results.push({
        index: idx,
        hasInstance,
        currentData: hasInstance ? el.ckeditorInstance.getData() : el.innerHTML
      });
    });
    return results;
  });

  console.log('CKEditor inspection test:', JSON.stringify(editorTest, null, 2));

  // Try setting data in the first editor (Question)
  const setDataResult = await page.evaluate(() => {
    const firstEditor = document.querySelector('.ck-content');
    if (firstEditor && firstEditor.ckeditorInstance) {
      firstEditor.ckeditorInstance.setData('<p><strong>Test Question</strong> with <em>formatted</em> text.</p>');
      return { success: true, data: firstEditor.ckeditorInstance.getData() };
    }
    return { success: false };
  });

  console.log('Set data test result:', setDataResult);

  await browser.close();
})();
