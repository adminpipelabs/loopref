/**
 * Takes admin panel screenshot using Chrome CDP (DevTools Protocol)
 * Run: node capture-admin.js
 */
const { execSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Helper: wait ms
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Use Chrome headless with remote debugging to interact with the page
async function captureAdminLoggedIn() {
  const debugPort = 9222;

  // Start Chrome with remote debugging
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1280,800',
    '--no-sandbox',
    'about:blank'
  ], { stdio: 'ignore' });

  await wait(2000);

  // Get the WebSocket URL
  const wsUrl = await new Promise((resolve, reject) => {
    // Use /json/list to get existing pages
    http.get(`http://localhost:${debugPort}/json/list`, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const list = JSON.parse(data);
        const info = list.find(t => t.type === 'page') || list[0];
        resolve(info.webSocketDebuggerUrl);
      });
    }).on('error', reject);
  });

  // Connect via WebSocket and control Chrome
  const WebSocket = require('ws');
  const ws = new WebSocket(wsUrl);

  let msgId = 1;
  const pending = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = msgId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise(r => ws.on('open', r));

  // Navigate to admin
  await send('Page.navigate', { url: 'http://localhost:3000/admin/' });
  await wait(2000);

  // Inject sessionStorage key and directly show dashboard
  await send('Runtime.evaluate', {
    expression: `(function() {
      sessionStorage.setItem('lr_admin_key', 'loopref2026');
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      if (typeof loadVenues === 'function') loadVenues();
    })();`
  });
  await wait(3000);

  // Take screenshot
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '05-admin-loggedin.png'), Buffer.from(data, 'base64'));
  console.log('Admin logged-in screenshot saved');

  // Scroll down to see venue list
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, 400);` });
  await wait(500);
  const { data: data2 } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '05b-admin-venues.png'), Buffer.from(data2, 'base64'));
  console.log('Admin venues screenshot saved');

  ws.close();
  chrome.kill();
}

captureAdminLoggedIn().catch(e => {
  console.error(e.message);
  process.exit(1);
});
