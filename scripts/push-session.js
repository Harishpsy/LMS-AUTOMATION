/**
 * push-session.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pushes your local LMS session token to your Render deployment so the cloud
 * server can operate without needing to log in through Cloudflare.
 *
 * Run this on your LOCAL machine whenever the Render session expires (~3 hrs):
 *
 *   node scripts/push-session.js
 *
 * Requirements:
 *   • .env must contain SESSION_PUSH_SECRET and RENDER_URL
 *   • Your local storageState.json must be valid (run npm run login if not)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const { getSessionInfo, loginWithCredentials } = require('../src/auth');

const STORAGE_PATH = path.join(__dirname, '..', 'storageState.json');

// ── Config ────────────────────────────────────────────────────────────────────
const RENDER_URL       = (process.env.RENDER_URL || '').replace(/\/$/, '');
const PUSH_SECRET      = process.env.SESSION_PUSH_SECRET || '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg)  { console.log(`[push-session] ${msg}`); }
function ok(msg)   { console.log(`[push-session] ✅ ${msg}`); }
function warn(msg) { console.warn(`[push-session] ⚠️  ${msg}`); }
function fail(msg) { console.error(`[push-session] ❌ ${msg}`); }

/** Simple HTTP/HTTPS POST that returns { status, body } */
function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end',  () => resolve({ status: res.statusCode, body: data }));
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Validate config
  if (!RENDER_URL) {
    fail('RENDER_URL is not set in .env');
    fail('Add: RENDER_URL=https://lms-automation-p6qi.onrender.com');
    process.exit(1);
  }
  if (!PUSH_SECRET) {
    fail('SESSION_PUSH_SECRET is not set in .env');
    fail('Add: SESSION_PUSH_SECRET=<any-random-string> (same value must be on Render)');
    process.exit(1);
  }

  log(`Target: ${RENDER_URL}`);

  // 2. Ensure local session is valid — login if needed
  let info = getSessionInfo();

  if (!info.exists || info.isExpired) {
    warn('Local session is missing or expired. Logging in locally first...');
    try {
      info = await loginWithCredentials({ headless: true, onLog: log });
      ok(`Local login success — session valid for ${info.minutesRemaining} minutes.`);
    } catch (err) {
      fail(`Local login failed: ${err.message}`);
      fail('Fix your local credentials in .env then retry.');
      process.exit(1);
    }
  } else {
    ok(`Local session is valid (${info.minutesRemaining} min remaining) — user: ${info.user}`);
  }

  // 3. Read storageState.json
  let storageState;
  try {
    storageState = JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8'));
  } catch (err) {
    fail(`Could not read storageState.json: ${err.message}`);
    process.exit(1);
  }

  // 4. Wake up the Render service (free tier spins down)
  log('Waking up Render service (may take ~30s on free tier)...');
  try {
    await postJson(`${RENDER_URL}/api/auth-status`, {});
  } catch (_) { /* ignore — service may still be spinning up */ }

  // 5. Push session to Render
  log('Pushing session token to Render...');
  let result;
  try {
    result = await postJson(
      `${RENDER_URL}/api/auth/push-session`,
      { storageState },
      { 'x-push-secret': PUSH_SECRET }
    );
  } catch (err) {
    fail(`Network error pushing session: ${err.message}`);
    process.exit(1);
  }

  // 6. Report result
  if (result.status === 200) {
    let parsed = {};
    try { parsed = JSON.parse(result.body); } catch (_) {}
    const remaining = parsed.info?.minutesRemaining || '?';
    const user      = parsed.info?.user || '';
    ok(`Session pushed successfully!`);
    ok(`Render session valid for ${remaining} minutes${user ? ` — ${user}` : ''}.`);
    log('');
    log('Your Render dashboard is ready. Next push needed in ~3 hours.');
  } else if (result.status === 401) {
    fail('Unauthorized — SESSION_PUSH_SECRET on Render does not match your local .env.');
    fail('Go to Render → Environment → check SESSION_PUSH_SECRET matches your .env.');
  } else if (result.status === 503) {
    fail('SESSION_PUSH_SECRET is not configured on Render.');
    fail('Go to Render → Environment → add SESSION_PUSH_SECRET=<your-secret>');
  } else {
    fail(`Render returned HTTP ${result.status}: ${result.body}`);
  }
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  process.exit(1);
});
