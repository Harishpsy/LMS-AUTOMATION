const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, '..', 'storageState.json');

async function loginInteractive() {
  console.log('========================================================');
  console.log('🚀 Launching Chrome for LMS Login Session Capture...');
  console.log('👉 Please enter your Username & Password in the browser window.');
  console.log('👉 Once logged in, this script will automatically save your session!');
  console.log('========================================================\n');

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--start-maximized']
    });
  } catch (err) {
    browser = await chromium.launch({ headless: false });
  }

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto('https://lms.careerscloud.in/');

  // Wait until user is logged in (i.e. URL changes away from login page or contains /courses or dashboard)
  console.log('Waiting for successful login...');

  // Wait for either navigation to /courses or cookie/token set
  await page.waitForFunction(() => {
    return window.location.pathname.includes('/courses') || 
           window.location.pathname.includes('/dashboard') ||
           window.location.pathname.includes('/view/') ||
           document.querySelector('.admin-profile, .user-profile, .sidebar, [href*="logout"]');
  }, { timeout: 300000 }); // 5 minutes timeout

  console.log('✅ Login detected! Saving session state...');
  await page.waitForTimeout(3000); // Allow cookies/localStorage to settle

  await context.storageState({ path: STORAGE_PATH });
  console.log(`🎉 Session successfully saved to: ${STORAGE_PATH}`);
  console.log('Future runs will now use this saved session automatically!\n');

  // Now navigate to course 104 to inspect layout
  console.log('Navigating to course 104...');
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(__dirname, '..', 'course_104_view.png') });
  console.log('📸 Screenshot saved to course_104_view.png');

  console.log('\nYou can now close the browser or continue.');
  await browser.close();
}

if (require.main === module) {
  loginInteractive().catch(err => {
    console.error('Login script error:', err.message);
  });
}

module.exports = { loginInteractive, STORAGE_PATH };
