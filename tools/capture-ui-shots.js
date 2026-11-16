const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Click Parse Document
  await page.click('#btnParse');
  await page.waitForTimeout(1500);

  const artifactDir = 'C:/Users/Lenovo Desktop 03/.gemini/antigravity-ide/brain/d5c79af3-b032-49c9-91c8-3728a32d6fa7';
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  // 1. Hero viewport shot (Header, controls, settings, logs)
  await page.screenshot({ path: path.join(artifactDir, 'dashboard_hero.png') });
  await page.screenshot({ path: path.join(__dirname, 'dashboard_hero.png') });

  // 2. Question preview cards closeup
  const previewHandle = await page.locator('#previewSection');
  await previewHandle.screenshot({ path: path.join(artifactDir, 'questions_preview_cards.png') });
  await previewHandle.screenshot({ path: path.join(__dirname, 'questions_preview_cards.png') });

  console.log('Screenshots generated successfully in artifact dir and workspace!');
  await browser.close();
})();
