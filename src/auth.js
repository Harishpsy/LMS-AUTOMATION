const { chromium } = require('playwright');
const { launchChromium, newStealthContext } = require('./browserLauncher');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const STORAGE_PATH = path.join(__dirname, '..', 'storageState.json');
const ENV_PATH = path.join(__dirname, '..', '.env');

/**
 * Decodes an RFC 4648 Base32 string into a Buffer
 */
function base32Decode(base32Str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = (base32Str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = alphabet.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generates a 6-digit RFC 6238 TOTP code using HMAC-SHA1 and 30-second time steps
 */
function generateTOTP(secret, timeStepSeconds = 30) {
  if (!secret) return null;
  const key = base32Decode(secret);
  if (key.length === 0) return null;

  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / timeStepSeconds);

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
               ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) |
               (hmac[offset + 3] & 0xff);

  const otp = (code % 1000000).toString().padStart(6, '0');
  return otp;
}

/**
 * Save credentials and optional 2FA secret to .env file and update running process.env
 */
function saveCredentialsToEnv(email, password, secret2FA) {
  try {
    let envContent = '';
    if (fs.existsSync(ENV_PATH)) {
      envContent = fs.readFileSync(ENV_PATH, 'utf8');
    }

    if (email) {
      if (/^LMS_EMAIL=.*/m.test(envContent)) {
        envContent = envContent.replace(/^LMS_EMAIL=.*/m, `LMS_EMAIL=${email}`);
      } else {
        envContent += `\nLMS_EMAIL=${email}`;
      }
      process.env.LMS_EMAIL = email;
    }

    if (password) {
      if (/^LMS_PASSWORD=.*/m.test(envContent)) {
        envContent = envContent.replace(/^LMS_PASSWORD=.*/m, `LMS_PASSWORD=${password}`);
      } else {
        envContent += `\nLMS_PASSWORD=${password}`;
      }
      process.env.LMS_PASSWORD = password;
    }

    if (secret2FA !== undefined && secret2FA !== null && secret2FA !== '') {
      const cleanSecret = secret2FA.toUpperCase().replace(/[\s=-]/g, '');
      if (/^LMS_2FA_SECRET=.*/m.test(envContent)) {
        envContent = envContent.replace(/^LMS_2FA_SECRET=.*/m, `LMS_2FA_SECRET=${cleanSecret}`);
      } else {
        envContent += `\nLMS_2FA_SECRET=${cleanSecret}`;
      }
      process.env.LMS_2FA_SECRET = cleanSecret;
    }

    fs.writeFileSync(ENV_PATH, envContent.trim() + '\n', 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to update .env:', err.message);
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
    return { exists: false, isExpired: true, minutesRemaining: 0, user: null, email: null, has2FASecret: !!process.env.LMS_2FA_SECRET };
  }

  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const userItem = data.origins?.[0]?.localStorage?.find(x => x.name === 'authorizedUserDetails');

    if (!userItem || !userItem.value) {
      return { exists: true, isExpired: true, minutesRemaining: 0, user: null, email: null, has2FASecret: !!process.env.LMS_2FA_SECRET };
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
      email,
      has2FASecret: !!process.env.LMS_2FA_SECRET
    };
  } catch (err) {
    return { exists: true, isExpired: true, minutesRemaining: 0, user: null, email: null, has2FASecret: !!process.env.LMS_2FA_SECRET, error: err.message };
  }
}

/**
 * Automatically detects and solves Google Authenticator (2FA / TOTP) prompt if shown
 */
async function handleTwoFactorAuthentication(page, { otpCode, secretKey, onLog = console.log } = {}) {
  // Check if 2FA verification screen or setup screen is displayed
  const is2FAPage = await page.evaluate(() => {
    return !!(
      document.querySelector('.totp-digit-input') ||
      document.body.innerText.includes('Two-factor authentication') ||
      document.body.innerText.includes('Enter the code from your authenticator app') ||
      document.body.innerText.includes('Authenticator code') ||
      document.body.innerText.includes('Can\'t scan it? Enter this setup key manually:')
    );
  });

  if (!is2FAPage) {
    return false; // Not a 2FA page
  }

  onLog('📱 Google Authenticator (2FA) verification screen detected.');

  // Check if it's the initial 2FA setup screen with a manual setup key
  let secret = (secretKey || process.env.LMS_2FA_SECRET || '').trim();
  const setupKeyFound = await page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/Enter this setup key manually:\s*([A-Z0-9\s]{16,40})/i) ||
                  text.match(/setup key manually:[\s\S]*?([A-Z2-7\s]{16,40})/i);
    if (match && match[1]) {
      return match[1].replace(/\s+/g, '');
    }
    const codeEl = document.querySelector('.setup-key, code, strong.key, [data-setup-key]');
    if (codeEl && /^[A-Z2-7]{16,40}$/i.test(codeEl.innerText.trim().replace(/\s+/g, ''))) {
      return codeEl.innerText.trim().replace(/\s+/g, '');
    }
    return null;
  });

  if (setupKeyFound) {
    onLog(`🔑 Auto-extracted 2FA setup secret key from page: ${setupKeyFound.slice(0, 4)}••••${setupKeyFound.slice(-4)}`);
    secret = setupKeyFound;
    process.env.LMS_2FA_SECRET = secret;
    saveCredentialsToEnv(process.env.LMS_EMAIL, process.env.LMS_PASSWORD, secret);
  }

  // Determine the 6-digit OTP code: either passed directly or computed from secret
  let otp = (otpCode || '').trim();
  if (!otp || !/^\d{6}$/.test(otp)) {
    if (secret) {
      otp = generateTOTP(secret);
      onLog(`⚡ Generated active RFC 6238 TOTP code: ${otp.slice(0, 3)}***`);
    } else {
      throw new Error('Google Authenticator (2FA) is required. Please provide your 2FA Secret Key or current 6-digit OTP in the credentials modal.');
    }
  }

  // Type the 6 digits into the .totp-digit-input inputs
  const digitInputs = page.locator('.totp-digit-input');
  const count = await digitInputs.count();
  if (count === 6) {
    for (let i = 0; i < 6; i++) {
      await digitInputs.nth(i).click();
      await digitInputs.nth(i).fill(otp[i]);
    }
  } else if (count > 0) {
    await digitInputs.first().fill(otp);
  } else {
    const fallbackInput = page.locator('input[type="text"]:visible, input[name*="otp"], input[name*="code"]');
    if (await fallbackInput.count() > 0) {
      await fallbackInput.first().fill(otp);
    }
  }

  await page.waitForTimeout(400);

  // Click "VERIFY AND SIGN IN"
  const verifyBtn = page.locator('button:has-text("VERIFY AND SIGN IN"), button.loginbbt, button[type="submit"]:has-text("VERIFY")').first();
  await verifyBtn.click();

  // Wait for navigation / redirect away or error
  try {
    await page.waitForFunction(() => {
      return !document.querySelector('.totp-digit-input') &&
             !document.body.innerText.includes('Enter the code from your authenticator app') &&
             (window.location.pathname.includes('/courses') ||
              window.location.pathname.includes('/dashboard') ||
              window.location.pathname.includes('/media-library') ||
              window.location.pathname.includes('/view'));
    }, { timeout: 15000 });
    onLog('✅ 2FA verification passed successfully!');
    return true;
  } catch (e) {
    const errMsg = await page.evaluate(() => {
      const el = document.querySelector('.error-message, .alert-danger, .toast-error, .text-danger, .ant-alert-message');
      return el ? el.innerText.trim() : null;
    });
    if (errMsg) {
      throw new Error(`2FA Verification Failed: ${errMsg}`);
    }
    const still2FA = await page.evaluate(() => !!document.querySelector('.totp-digit-input'));
    if (still2FA) {
      throw new Error('2FA verification timed out or code was rejected. Please ensure system clock is synchronized or verify 2FA secret/code.');
    }
    return true;
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
  otpOrSecret,
  secret2FA,
  saveToEnv = true
} = {}) {
  if (process.env.RENDER === 'true' && process.env.ALLOW_CLOUD_LOGIN !== 'true') {
    throw new Error('Session expired or missing on Render. Run "node scripts/push-session.js" on your local machine to refresh the Render session.');
  }

  const email = (customEmail || process.env.LMS_EMAIL || '').trim();
  const password = (customPassword || process.env.LMS_PASSWORD || '').trim();

  let otpCode = null;
  let secretKey = (secret2FA || process.env.LMS_2FA_SECRET || '').trim();

  if (otpOrSecret) {
    const trimmed = otpOrSecret.trim().replace(/\s+/g, '');
    if (/^\d{6}$/.test(trimmed)) {
      otpCode = trimmed;
    } else if (/^[A-Za-z0-9]{16,40}$/.test(trimmed)) {
      secretKey = trimmed.toUpperCase();
    }
  }

  if (!email || !password) {
    throw new Error('Email and password are required to log in.');
  }

  onLog(`🔐 Logging in to CareersCloud LMS as ${email}...`);

  const browser = await launchChromium({ headless });
  const context = await newStealthContext(browser, { viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  try {
    // Initial load — use domcontentloaded first so we can detect Cloudflare quickly
    await page.goto('https://lms.careerscloud.in/', { waitUntil: 'domcontentloaded', timeout: 35000 });

    // ── Cloudflare / Turnstile challenge handler ───────────────────────────
    // If Cloudflare intercepts (title "Just a moment..."), wait up to 20 s for it
    // to auto-solve (it often does once the browser looks legitimate).
    const cfCheckStart = Date.now();
    while (Date.now() - cfCheckStart < 20000) {
      const title = await page.title().catch(() => '');
      const url = page.url();
      if (title.includes('Just a moment') || title.includes('Attention Required') ||
          url.includes('challenges.cloudflare.com')) {
        onLog('⏳ Cloudflare challenge detected — waiting for auto-resolution...');
        await page.waitForTimeout(2000);
        // Wait for the challenge iframe / spinner to disappear
        const resolved = await page.waitForFunction(() => {
          const t = document.title;
          return !t.includes('Just a moment') && !t.includes('Attention Required');
        }, { timeout: 15000 }).then(() => true).catch(() => false);
        if (!resolved) {
          throw new Error('Cloudflare Bot Protection / Turnstile triggered ("Just a moment..."). The challenge could not be auto-resolved. Please ensure this machine\'s IP is whitelisted in Cloudflare WAF (Security → WAF → IP Access Rules).');
        }
        onLog('✅ Cloudflare challenge resolved automatically.');
        // After CF clears, wait for the actual page to settle
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        break;
      } else {
        break; // No Cloudflare challenge — proceed normally
      }
    }

    const emailInput = page.locator('#admin-email');
    try {
      await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    } catch (waitErr) {
      const pageTitle = await page.title().catch(() => 'unknown');
      const currentUrl = page.url();
      const bodySnippet = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : '').catch(() => '');

      if (bodySnippet.includes('Verify you are human') || bodySnippet.includes('Cloudflare') ||
          pageTitle.includes('Just a moment') || pageTitle.includes('Attention Required')) {
        throw new Error(`Cloudflare Bot Protection / Turnstile triggered ("${pageTitle}"). Please whitelist this machine's public IP in Cloudflare WAF → Security → IP Access Rules.`);
      }
      throw new Error(`Could not find login form on ${currentUrl} (Page Title: "${pageTitle}"). Error: ${waitErr.message}`);
    }

    await page.fill('#admin-email', email);
    await page.fill('#admin-password', password);
    await page.click('button[type="submit"], button.loginbbt');

    // Wait for redirect away from login page or detect 2FA screen or error
    try {
      await page.waitForFunction(() => {
        return !!document.querySelector('.totp-digit-input') ||
               document.body.innerText.includes('Two-factor authentication') ||
               document.body.innerText.includes('Can\'t scan it? Enter this setup key manually:') ||
               (!document.querySelector('#admin-email') &&
                (window.location.pathname.includes('/courses') ||
                 window.location.pathname.includes('/media-library') ||
                 window.location.pathname.includes('/dashboard') ||
                 window.location.pathname.includes('/view')));
      }, { timeout: 25000 });
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

    // Solve 2FA if 2FA verification screen or setup screen is displayed
    await handleTwoFactorAuthentication(page, { otpCode, secretKey, onLog });

    // Allow cookies & tokens to settle
    await page.waitForTimeout(2000);
    await context.storageState({ path: STORAGE_PATH });

    // Validate that session details were captured
    const info = getSessionInfo();
    if (info.isExpired || !info.user) {
      throw new Error('Authentication finished but valid session token was not detected. Please verify credentials.');
    }

    // Persist credentials & 2FA secret
    if (saveToEnv) {
      saveCredentialsToEnv(email, password, secretKey);
    } else {
      process.env.LMS_EMAIL = email;
      process.env.LMS_PASSWORD = password;
      if (secretKey) process.env.LMS_2FA_SECRET = secretKey;
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
    if (process.env.RENDER === 'true' && process.env.ALLOW_CLOUD_LOGIN !== 'true') {
      throw new Error(`Session token is ${info.exists ? 'expired' : 'missing'} on Render. Run "node scripts/push-session.js" on your local machine to push a fresh session.`);
    }
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

  await page.waitForTimeout(2000);
  await handleTwoFactorAuthentication(page, { secretKey: process.env.LMS_2FA_SECRET, onLog });

  await page.waitForFunction(() => {
    return !document.querySelector('#admin-email') &&
           !document.querySelector('button.loginbbt') &&
           !document.querySelector('.totp-digit-input');
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

  const browser = await launchChromium({
    headless: options.headless !== undefined ? options.headless : false,
    slowMo: 100
  });

  let context;

  if (fs.existsSync(STORAGE_PATH)) {
    try {
      context = await newStealthContext(browser, { storageState: STORAGE_PATH });
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
  context = await newStealthContext(browser, { storageState: STORAGE_PATH });
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
  generateTOTP,
  base32Decode,
  handleTwoFactorAuthentication,
  STORAGE_PATH
};
