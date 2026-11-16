const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STORAGE_PATH = path.join(__dirname, '..', 'storageState.json');
const ENV_PATH = path.join(__dirname, '..', '.env');

/**
 * Save credentials to .env file and update running process.env
 */
function saveCredentialsToEnv(email, password) {
  try {
    let envContent = '';
    if (fs.existsSync(ENV_PATH)) {
      envContent = fs.readFileSync(ENV_PATH, 'utf8');
    }

    if (/^LMS_EMAIL=.*/m.test(envContent)) {
      envContent = envContent.replace(/^LMS_EMAIL=.*/m, `LMS_EMAIL=${email}`);
    } else {
      envContent += `\nLMS_EMAIL=${email}`;
    }

    if (/^LMS_PASSWORD=.*/m.test(envContent)) {
      envContent = envContent.replace(/^LMS_PASSWORD=.*/m, `LMS_PASSWORD=${password}`);
    } else {
      envContent += `\nLMS_PASSWORD=${password}`;
    }

    fs.writeFileSync(ENV_PATH, envContent.trim() + '\n', 'utf8');
    process.env.LMS_EMAIL = email;
    process.env.LMS_PASSWORD = password;
    return true;
  } catch (err) {
    console.error('Failed to update .env:', err.message);
    process.env.LMS_EMAIL = email;
    process.env.LMS_PASSWORD = password;
    return false;
  }
}

/**
 * Deletes saved storageState.json to log out
 */
function clearSavedSession() {
  if (fs.existsSync(STORAGE_PATH)) {
    try {
      fs.unlinkSync(STORAGE_PATH);
    } catch (e) {
      console.warn('Could not delete storageState:', e.message);
    }
  }
}

/**
 * Inspect storageState.json and calculate whether session/token is valid or expired.
 */
function getSessionInfo() {
  if (!fs.existsSync(STORAGE_PATH)) {
    return { exists: false, isExpired: true, minutesRemaining: 0, user: null, email: null };
  }

  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const userItem = data.origins?.[0]?.localStorage?.find(x => x.name === 'authorizedUserDetails');

    if (!userItem || !userItem.value) {
      return { exists: true, isExpired: true, minutesRemaining: 0, user: null, email: null };
    }

    const details = JSON.parse(userItem.value);
    const expiresAt = details.access_token_expires_at || 0;
    const now = Date.now();
    // Consider expired if within 2 minutes of expiry
    const isExpired = !expiresAt || now >= (expiresAt - 2 * 60 * 1000);
    const minutesRemaining = Math.max(0, Math.floor((expiresAt - now) / 60000));

    const firstName = details.user?.first_name || '';
    const lastName = details.user?.last_name || '';
    const userName = `${firstName} ${lastName}`.trim() || 'LMS Admin';
    const email = details.user?.email_id || process.env.LMS_EMAIL || '';

    return {
      exists: true,
      isExpired,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      minutesRemaining,
      user: userName,
      email
    };
  } catch (err) {
    return { exists: true, isExpired: true, minutesRemaining: 0, user: null, email: null, error: err.message };
  }
}

/**
 * Log in to LMS using provided credentials or falling back to process.env.
 * Saves session token to storageState.json upon success.
 */
async function loginWithCredentials({
  headless = true,
  onLog = console.log,
  email: customEmail,
  password: customPassword,
  saveToEnv = true
} = {}) {
  const email = (customEmail || process.env.LMS_EMAIL || '').trim();
  const password = (customPassword || process.env.LMS_PASSWORD || '').trim();

  if (!email || !password) {
    throw new Error('Email and password are required to log in.');
  }

  onLog(`🔐 Logging in to CareersCloud LMS as ${email}...`);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await page.goto('https://lms.careerscloud.in/', { waitUntil: 'networkidle', timeout: 35000 });

    const emailInput = page.locator('#admin-email');
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });

    await page.fill('#admin-email', email);
    await page.fill('#admin-password', password);
    await page.click('button[type="submit"], button.loginbbt');

    // Wait for redirect away from login page or detect error
    try {
      await page.waitForFunction(() => {
        return !document.querySelector('#admin-email') &&
               (window.location.pathname.includes('/courses') ||
                window.location.pathname.includes('/media-library') ||
                window.location.pathname.includes('/dashboard') ||
                window.location.pathname.includes('/view'));
      }, { timeout: 20000 });
    } catch (e) {
      // Check if error message is displayed on login page
      const errorMsg = await page.evaluate(() => {
        const errEl = document.querySelector('.error-message, .alert-danger, .toast-error, .ui.error.message, .text-danger, .ant-alert-message');
        if (errEl && errEl.innerText) return errEl.innerText.trim();
        if (document.querySelector('#admin-email')) return 'Invalid Email or Password. Please verify and try again.';
        return null;
      });

      if (errorMsg) {
        throw new Error(errorMsg);
      }
    }

    // Allow cookies & tokens to settle
    await page.waitForTimeout(2000);
    await context.storageState({ path: STORAGE_PATH });

    // Validate that session details were captured
    const info = getSessionInfo();
    if (info.isExpired || !info.user) {
      throw new Error('Authentication finished but valid session token was not detected. Please verify credentials.');
    }

    // Persist credentials
    if (saveToEnv) {
      saveCredentialsToEnv(email, password);
    } else {
      process.env.LMS_EMAIL = email;
      process.env.LMS_PASSWORD = password;
    }

    onLog(`✅ New session token saved for ${info.user} successfully!`);
    await browser.close();
    return info;
  } catch (err) {
    await browser.close();
    throw new Error(`Failed to log in to LMS: ${err.message}`);
  }
}

/**
 * Proactively verifies if storageState has an active token. If expired, automatically re-logs in.
 */
async function ensureValidSession(onLog = console.log) {
  const info = getSessionInfo();
  if (!info.exists || info.isExpired) {
    onLog(`⚠️ Session token is ${info.exists ? 'expired' : 'missing'}. Refreshing session now...`);
    return await loginWithCredentials({ headless: true, onLog });
  }
  return info;
}

/**
 * Checks if current page is showing the login form or expired toast and re-authenticates automatically.
 */
async function ensureAuthenticatedSession(page, context, onLog = console.log) {
  const isLoginPage = await page.evaluate(() => {
    return !!(
      document.querySelector('#admin-email') ||
      document.querySelector('button.loginbbt') ||
      document.body.innerText.includes('Enter your CareersCloud credentials to continue') ||
      document.body.innerText.includes('Token has expired') ||
      document.body.innerText.includes('Session expired')
    );
  });

  if (!isLoginPage) {
    return false; // Already authenticated
  }

  onLog('🔒 LMS session expired or login form detected. Re-authenticating automatically...');
  const email = process.env.LMS_EMAIL;
  const password = process.env.LMS_PASSWORD;

  if (!email || !password) {
    throw new Error('LMS Session Expired and no credentials found. Please log in via the dashboard.');
  }

  if (await page.locator('#admin-email').count() === 0) {
    await page.goto('https://lms.careerscloud.in/', { waitUntil: 'networkidle' });
  }

  await page.fill('#admin-email', email);
  await page.fill('#admin-password', password);
  await page.click('button[type="submit"], button.loginbbt');

  await page.waitForTimeout(3000);
  await page.waitForFunction(() => {
    return !document.querySelector('#admin-email') && !document.querySelector('button.loginbbt');
  }, { timeout: 20000 });

  if (context) {
    await context.storageState({ path: STORAGE_PATH });
    onLog('✅ Session refreshed & saved to storageState.json successfully!');
  }

  return true;
}

/**
 * Ensures authenticated browser context.
 */
async function getAuthenticatedPage(options = { headless: false }) {
  // Proactively refresh token if expired
  await ensureValidSession();

  const browser = await chromium.launch({
    headless: options.headless !== undefined ? options.headless : false,
    slowMo: 100
  });

  let context;

  if (fs.existsSync(STORAGE_PATH)) {
    try {
      context = await browser.newContext({ storageState: STORAGE_PATH });
      const page = await context.newPage();
      await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'domcontentloaded' });

      const reLogged = await ensureAuthenticatedSession(page, context);
      if (reLogged) {
        await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });
      }

      console.log('✅ Authenticated session ready');
      return { browser, context, page };
    } catch (e) {
      console.log('Session verification note:', e.message);
    }
  }

  // Attempt automated login if credentials exist in .env
  await loginWithCredentials({ headless: options.headless, onLog: console.log });
  context = await browser.newContext({ storageState: STORAGE_PATH });
  const page = await context.newPage();
  await page.goto('https://lms.careerscloud.in/courses/view/104', { waitUntil: 'networkidle' });
  return { browser, context, page };
}

module.exports = {
  getSessionInfo,
  loginWithCredentials,
  saveCredentialsToEnv,
  clearSavedSession,
  ensureValidSession,
  ensureAuthenticatedSession,
  getAuthenticatedPage,
  STORAGE_PATH
};
