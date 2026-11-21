const ngrok = require('@ngrok/ngrok');
const { exec } = require('child_process');

const AUTHTOKEN = process.env.NGROK_AUTHTOKEN || '3MNCcPs8nLxg52DPrX3w4AQP7E8_21GSR7vsWH8AenrLAMu5y';
const DOMAIN = process.env.NGROK_DOMAIN || 'woozy-coil-flaring.ngrok-free.dev';
const PORT = parseInt(process.env.PORT || '3001', 10);

(async () => {
  try {
    console.log('================================================================');
    console.log('     CAREERSCLOUD LMS - PERMANENT PUBLIC TUNNEL (NGROK)');
    console.log('================================================================\n');
    console.log(`Forwarding http://localhost:${PORT} to your permanent static domain...`);

    const listener = await ngrok.forward({
      addr: PORT,
      authtoken: AUTHTOKEN,
      domain: DOMAIN
    });

    const url = listener.url();
    console.log('\n================================================================');
    console.log('🎉 PERMANENT URL IS ONLINE & READY:');
    console.log(`👉 ${url}`);
    console.log('================================================================');
    console.log('This URL NEVER changes across restarts! Bookmark it and share it with your team.\n');
    console.log('Keep this window OPEN while you or your team are using the dashboard.');
    console.log('Press Ctrl + C to stop the tunnel.\n');

    // Copy to clipboard on Windows
    try {
      exec(`powershell -NoProfile -Command "Set-Clipboard -Value '${url}'"`);
      console.log('✓ Link copied to your clipboard!');
    } catch (e) {}

    // Auto-open browser
    try {
      exec(`start ${url}`);
    } catch (e) {}

    // Keep process alive indefinitely with active timer handle
    setInterval(() => {}, 1000 * 60 * 60);

  } catch (err) {
    console.error('\n❌ Tunnel Error:', err.message);
    if (err.message.includes('authtoken')) {
      console.error('Please verify your ngrok authtoken.');
    }
    process.exit(1);
  }
})();
