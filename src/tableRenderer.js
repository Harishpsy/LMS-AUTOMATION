const { chromium } = require('playwright');
const { launchChromium } = require('./browserLauncher');
const fs = require('fs');
const path = require('path');

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await launchChromium({ headless: true });
  }
  return browserInstance;
}

/**
 * Render an HTML table into a clean, crisp PNG image
 * @param {string} tableHtml - HTML string containing the <table>
 * @param {string} outputPath - Path to save the PNG image
 */
async function renderTableToImage(tableHtml, outputPath) {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2 // 2x Retina resolution for ultra-crisp text on mobile/web
  });

  const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          margin: 0;
          padding: 24px;
          background-color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          display: inline-block;
        }
        table {
          border-collapse: collapse;
          width: auto;
          min-width: 400px;
          margin: 0 auto;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          border-radius: 6px;
          overflow: hidden;
        }
        th, td {
          border: 1px solid #d1d5db;
          padding: 10px 16px;
          text-align: left;
          font-size: 14px;
          color: #1f2937;
          line-height: 1.5;
        }
        th {
          background-color: #f3f4f6;
          font-weight: 600;
          color: #111827;
        }
        tr:nth-child(even) td {
          background-color: #f9fafb;
        }
      </style>
    </head>
    <body>
      ${tableHtml}
    </body>
    </html>
  `;

  await page.setContent(fullHtml, { waitUntil: 'load' });
  const tableHandle = await page.$('table');

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (tableHandle) {
    await tableHandle.screenshot({ path: outputPath });
  } else {
    const bodyHandle = await page.$('body');
    await bodyHandle.screenshot({ path: outputPath });
  }

  await page.close();
  return outputPath;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = { renderTableToImage, closeBrowser };
