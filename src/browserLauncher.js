// Set Playwright browser cache inside project so it persists across Render build & runtime
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '0';

const { chromium } = require('playwright');
const { execSync } = require('child_process');

// Realistic Chrome user-agent (kept up to date with stable channel)
const STEALTH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * JS snippet injected into every new page to strip automation fingerprints that
 * Cloudflare / Turnstile checks for.
 */
const STEALTH_INIT_SCRIPT = `
// 1. Remove navigator.webdriver flag
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// 2. Restore chrome runtime object (removed in headless mode)
if (!window.chrome) {
  window.chrome = { runtime: {} };
}

// 3. Make permissions.query return a realistic result instead of 'denied'
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters);

// 4. Realistic plugins list
Object.defineProperty(navigator, 'plugins', {
  get: () => [1, 2, 3, 4, 5]
});

// 5. Realistic languages
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en']
});
`;

/**
 * Launch Chromium with stealth settings to avoid Cloudflare/Turnstile bot detection.
 * Also self-heals if the Chromium binary is missing on a cloud container (Render/Linux).
 * @param {object} options - Playwright launch options (merged/overridden on top of defaults)
 */
async function launchChromium(options = {}) {
  const launchOptions = {
    headless: true,
    ...options,
    args: [
      // ── Security sandbox (required on containers) ────────────────────────
      '--no-sandbox',
      '--disable-setuid-sandbox',

      // ── Memory / GPU (safe for headless) ────────────────────────────────
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',

      // ── Stealth: suppress automation flags ───────────────────────────────
      '--disable-blink-features=AutomationControlled',
      '--disable-automation',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--disable-extensions',
      '--disable-popup-blocking',
      '--password-store=basic',
      '--use-mock-keychain',

      // ── Stealth: realistic window & rendering ────────────────────────────
      '--window-size=1366,768',
      '--start-maximized',
      '--lang=en-US,en',

      // ── Pass-through any caller-supplied extra args ──────────────────────
      ...(options.args || [])
    ]
  };

  let browser;

  const tryLaunch = async () => {
    browser = await chromium.launch(launchOptions);

    // Inject stealth script into every new page/frame before any other JS runs
    browser._stealthInitScript = STEALTH_INIT_SCRIPT;
    browser._stealthUserAgent = STEALTH_USER_AGENT;

    return browser;
  };

  try {
    return await tryLaunch();
  } catch (err) {
    const isMissingBrowser = err.message && (
      err.message.includes("Executable doesn't exist") ||
      err.message.includes('playwright install') ||
      err.message.includes('chrome-headless-shell') ||
      err.message.includes('chromium')
    );

    if (isMissingBrowser) {
      console.log('[Browser Self-Heal] Chromium binary not found on container. Auto-installing now into local cache...');
      try {
        execSync('npx playwright install --with-deps chromium || npx playwright install chromium', {
          stdio: 'inherit',
          env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' }
        });
        console.log('[Browser Self-Heal] Chromium installed successfully! Retrying launch...');
        return await tryLaunch();
      } catch (installErr) {
        console.error('[Browser Self-Heal Failed]:', installErr.message);
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Create a new BrowserContext pre-configured with stealth user-agent and the
 * webdriver-removal init script.  Use this instead of browser.newContext() so
 * every page automatically gets the stealth treatment.
 *
 * @param {import('playwright').Browser} browser - from launchChromium()
 * @param {object} contextOptions - extra options forwarded to newContext()
 */
async function newStealthContext(browser, contextOptions = {}) {
  const context = await browser.newContext({
    userAgent: browser._stealthUserAgent || STEALTH_USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    ...contextOptions
  });

  // Strip automation fingerprints on every page before page scripts run
  await context.addInitScript(browser._stealthInitScript || STEALTH_INIT_SCRIPT);

  return context;
}

module.exports = { launchChromium, newStealthContext, STEALTH_USER_AGENT, STEALTH_INIT_SCRIPT };

