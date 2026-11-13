// Browser tracer: drive the real preparation UI, then observe its rendered combat log.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(path => path && existsSync(path));
if (!browserPath) throw new Error('Chrome or Edge not found; set CHROME_PATH to run the browser tracer.');

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function eventually(fn, message) {
  for (let i = 0; i < 100; i++) {
    try { const value = await fn(); if (value) return value; } catch { /* service may still be starting */ }
    await pause(100);
  }
  throw new Error(message);
}

const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'woundbound-tracer-'));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser;
let socket;
try {
  await eventually(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok, 'Vite did not start');
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const debugPort = await eventually(() => {
    const path = join(profile, 'DevToolsActivePort');
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n')[0] : null;
  }, 'Chrome DevTools did not start');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 960, height: 680, deviceScaleFactor: 1, mobile: false });
  // Phaser text uses canvas fillText. Capture the text actually drawn, rather than
  // reading or mutating the simulation, so the check exercises the real UI output.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__drawnText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.__drawnText.push(String(text));
      if (window.__drawnText.length > 5000) window.__drawnText.splice(0, 1000);
      return original.call(this, text, ...args);
    };
  ` });
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await eventually(async () => (await call('Runtime.evaluate', { expression: "window.__drawnText?.includes('ПОДГОТОВКА')", returnByValue: true })).result.value, 'Preparation screen was not rendered');
  await call('Page.bringToFront');
  const click = async (x, y) => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await click(700, 125); // Select the bloodthirsty blade from the stash.
  await click(350, 140); // Place it in the first cell.
  await eventually(async () => (await call('Runtime.evaluate', { expression: "window.__drawnText?.includes('Предмет размещён')", returnByValue: true })).result.value, 'The item was not placed through the UI');
  await click(390, 505); // Start the actual battle.
  await eventually(async () => (await call('Runtime.evaluate', { expression: "window.__drawnText?.some(x => x.includes('Кровожадный клинок →') && x.includes('урона'))", returnByValue: true })).result.value, 'The equipped blade did not render a target and damage in the combat log');
  console.log('Browser tracer passed: placed item acted against an actual target.');
} finally {
  socket?.close();
  browser?.kill();
  vite.kill();
  // Chrome may release its profile asynchronously, so a locked temp file is not fatal.
  for (let i = 0; i < 10; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await pause(100); }
  }
}
