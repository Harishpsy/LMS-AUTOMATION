const { chromium } = require('playwright');
require('dotenv').config();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to login page...');
  await page.goto('https://lms.careerscloud.in/', { waitUntil: 'networkidle' });

  console.log('Filling credentials...');
  await page.fill('#admin-email', process.env.LMS_EMAIL);
  await page.fill('#admin-password', process.env.LMS_PASSWORD);

  console.log('Clicking Sign In...');
  await page.click('button[type="submit"]');

  // Wait for URL change or response
  await page.waitForTimeout(5000);
  console.log('URL after login attempt:', page.url());

  // Check if any error message appeared
  const errorAlert = await page.$('.toast, .alert, .error, [role="alert"]');
  if (errorAlert) {
    console.log('Alert text:', await errorAlert.innerText());
  }

  // Save session state
  await context.storageState({ path: 'storageState.json' });
  console.log('Saved storageState.json');

  // Navigate to course 104
  console.log('Navigating to course 104...');
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });
  console.log('Current URL at course 104:', page.url());

  await page.screenshot({ path: 'course_104_view.png', fullPage: true });
  console.log('Saved course_104_view.png');

  await browser.close();
})().catch(err => {
  console.error('Error during login execution:', err);
});
