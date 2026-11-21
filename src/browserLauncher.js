// Set Playwright browser cache inside project so it persists across Render build & runtime
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '0';

const { chromium } = require('playwright');
const { execSync } = require('child_process');

/**
 * Launch Chromium with automatic self-healing if missing on cloud container (Render/Linux)
 * @param {object} options
 */
async function launchChromium(options = {}) {
  const launchOptions = {
    headless: true,
    ...options,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      ...(options.args || [])
    ]
  };

  try {
    return await chromium.launch(launchOptions);
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
          env: {
            ...process.env,
            PLAYWRIGHT_BROWSERS_PATH: '0'
          }
        });
        console.log('[Browser Self-Heal] Chromium installed successfully! Retrying launch...');
        return await chromium.launch(launchOptions);
      } catch (installErr) {
        console.error('[Browser Self-Heal Failed]:', installErr.message);
        throw err;
      }
    }
    throw err;
  }
}

module.exports = { launchChromium };
