const { execSync } = require('child_process');

console.log('🚀 Running Render / Cloud Build Script...');
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

try {
  console.log('📦 Installing Playwright Chromium browser into local cache (PLAYWRIGHT_BROWSERS_PATH=0)...');
  execSync('npx playwright install --with-deps chromium', {
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: '0'
    }
  });
  console.log('✅ Playwright Chromium installed successfully!');
} catch (err) {
  console.warn('⚠️ --with-deps failed (likely non-root or standard container), retrying without system deps...');
  try {
    execSync('npx playwright install chromium', {
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: '0'
      }
    });
    console.log('✅ Playwright Chromium installed successfully!');
  } catch (fallbackErr) {
    console.error('❌ Failed to install Playwright browser:', fallbackErr.message);
    process.exit(1);
  }
}
