// Browser tracer: drive the real preparation UI, then observe its rendered combat log.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
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
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'test', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: 'ignore' });
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
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await eventually(async () => (await call('Runtime.evaluate', { expression: "Boolean(document.querySelector('[data-action=start]'))", returnByValue: true })).result.value, 'Preparation screen was not rendered');
  await call('Page.bringToFront');
  const click = async selector => {
    const expression = `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; element.scrollIntoView({block:'center'}); const r = element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`;
    const point = (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    if (!point) throw new Error(`Missing UI control: ${selector}`);
    const { x, y } = point;
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await pause(30);
  };
  await click('[data-action="item"][data-value="item-1"]');
  await click('[data-action="hero"][data-value="hero-2"]');
  await click('[data-action="cell"][data-value="0"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.message')?.textContent.includes('не помещается')", returnByValue: true })).result.value, 'Invalid occupied-cell move was not rejected');
  await click('[data-action="hero"][data-value="hero-1"]');
  await click('[data-action="cell"][data-value="0"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.message')?.textContent.includes('Предмет размещён')", returnByValue: true })).result.value, 'The item was not placed through the UI');
  await click('[data-action="item"][data-value="whetstone-1"]');
  await click('[data-action="cell"][data-value="1"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.bonuses')?.textContent.includes('+2 урона')", returnByValue: true })).result.value, 'Adjacency bonus was not displayed');
  await click('[data-action="swap"]');
  await click('[data-action="hero"][data-value="hero-4"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('[data-action=hero][data-value=hero-1]')?.textContent.includes('4')", returnByValue: true })).result.value, 'Formation swap did not update the real hero position');
  await click('[data-action="swap"]');
  await click('[data-action="hero"][data-value="hero-1"]');
  await click('[data-action="start"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('#history-list')?.textContent.includes('Кровожадный клинок →')", returnByValue: true })).result.value, 'The equipped blade did not render a target and damage in the combat log');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "Boolean(document.querySelector('.combatant progress.health') && document.querySelector('.equipped progress.cooldown'))", returnByValue: true })).result.value, 'Health and individual cooldown bars are missing');
  if (!(await call('Runtime.evaluate', { expression: "document.querySelector('.battle-grid section .combatant')?.querySelectorAll('.equipped progress.cooldown').length === 2", returnByValue: true })).result.value) throw new Error('Multiple equipped items do not have separate cooldown bars');
  await click('[data-action="restart"]');
  const beforeConfirmation = (await call('Runtime.evaluate', { expression: "JSON.stringify([...document.querySelectorAll('.battle-grid progress')].map(p=>p.value))", returnByValue: true })).result.value;
  await pause(2000);
  const duringConfirmation = (await call('Runtime.evaluate', { expression: "JSON.stringify([...document.querySelectorAll('.battle-grid progress')].map(p=>p.value))", returnByValue: true })).result.value;
  if (beforeConfirmation !== duringConfirmation) throw new Error('Combat advanced during restart confirmation');
  await click('[data-action="cancel-reset"]');
  if (!(await call('Runtime.evaluate', { expression: "Boolean(document.querySelector('.combatant'))", returnByValue: true })).result.value) throw new Error('Cancel reset did not preserve the battle');
  await click('[data-action="restart"]');
  await click('[data-action="confirm-reset"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "Boolean(document.querySelector('[data-action=start]'))", returnByValue: true })).result.value, 'Confirmed reset did not restore preparation');
  for (const [width, height, dpr] of [[1280, 720, 1], [375, 812, 1], [375, 812, 2]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    const metrics = (await call('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('.cell').getBoundingClientRect(); const c = document.querySelector('canvas').getBoundingClientRect(); return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,bodyFont:getComputedStyle(document.body).fontSize,cellFont:getComputedStyle(document.querySelector('.cell')).fontSize,cellWidth:b.width,cellHeight:b.height,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,canvasCss:[c.width,c.height],canvasBacking:[document.querySelector('canvas').width,document.querySelector('canvas').height]}; })()`, returnByValue: true })).result.value;
    if (metrics.horizontalOverflow || metrics.cellWidth < 44 || metrics.cellHeight < 44 || parseFloat(metrics.cellFont) < 14) throw new Error(`Responsive check failed: ${JSON.stringify(metrics)}`);
    console.log(`Browser metrics: ${JSON.stringify(metrics)}`);
  }
  await call('Runtime.evaluate', { expression: "document.querySelector('[data-action=item][data-value=mercy-1]').focus()" });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await eventually(async () => (await call('Runtime.evaluate', { expression: "Boolean(document.querySelector('[data-action=item][data-value=mercy-1].selected'))", returnByValue: true })).result.value, 'Keyboard selection did not select the item');
  await click('[data-action="cell"][data-value="0"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.message')?.textContent.includes('Предмет размещён')", returnByValue: true })).result.value, 'Narrow-viewport cell click failed');
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const touch = async selector => {
    const expression = `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`;
    const point = (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    if (!point) throw new Error(`Missing touch control: ${selector}`);
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(30);
  };
  await touch('[data-action="item"][data-value="heart-1"]');
  await touch('[data-action="cell"][data-value="1"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('[data-action=cell][data-value=\"1\"]')?.textContent.includes('Латунное сердце')", returnByValue: true })).result.value, 'Touch placement failed');
  await call('Emulation.setTouchEmulationEnabled', { enabled: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=winding` });
  await eventually(async () => (await call('Runtime.evaluate', { expression: "Boolean(document.querySelector('[data-action=wind]'))", returnByValue: true })).result.value, 'Stopped doll fixture did not appear');
  await call('Page.bringToFront');
  await click('[data-action="restart"]');
  const stoppedWind = (await call('Runtime.evaluate', { expression: "document.querySelector('.combatant.stopped progress.wind')?.value", returnByValue: true })).result.value;
  await click('[data-action="wind"][data-value="hero-1"]');
  await pause(100);
  const blockedWind = (await call('Runtime.evaluate', { expression: "document.querySelector('.combatant.stopped progress.wind')?.value", returnByValue: true })).result.value;
  if (stoppedWind !== blockedWind) throw new Error('Winding was accepted under the reset confirmation');
  await click('[data-action="cancel-reset"]');
  for (let i = 0; i < 20; i++) await click('[data-action="wind"][data-value="hero-1"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.combatant.active')?.textContent.includes('Кукла работает')", returnByValue: true })).result.value, 'Twenty browser clicks did not activate the doll');
  const otherTarget = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const otherSocket = new WebSocket(otherTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { otherSocket.onopen = resolve; otherSocket.onerror = reject; });
  const focusOther = new Promise((resolve, reject) => {
    otherSocket.onmessage = event => { const reply = JSON.parse(event.data); if (reply.id === 1) reply.error ? reject(new Error(reply.error.message)) : resolve(); };
    otherSocket.send(JSON.stringify({ id: 1, method: 'Page.bringToFront' }));
  });
  await focusOther;
  await pause(200);
  const hidden = (await call('Runtime.evaluate', { expression: 'document.hidden', returnByValue: true })).result.value;
  if (hidden) {
    const windBefore = (await call('Runtime.evaluate', { expression: "document.querySelector('.combatant.active progress.wind')?.value", returnByValue: true })).result.value;
    await pause(3500);
    await call('Page.bringToFront');
    await pause(200);
    const windAfter = (await call('Runtime.evaluate', { expression: "document.querySelector('.combatant.active progress.wind')?.value", returnByValue: true })).result.value;
    if (typeof windBefore !== 'number' || typeof windAfter !== 'number' || windBefore - windAfter > 3) throw new Error(`Combat caught up while hidden: wind ${windBefore} -> ${windAfter}`);
    console.log(`Visibility pause passed: wind ${windBefore} -> ${windAfter} after 3.5s hidden.`);
  } else {
    console.log('Visibility pause not verified: browser did not report the background tab as hidden.');
    await call('Page.bringToFront');
  }
  otherSocket.close();
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=drop` });
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.outcome')?.textContent.includes('Победа')", returnByValue: true })).result.value, 'Controlled victory did not appear');
  await click('[data-action="manage"]');
  await click('[data-action="hero"][data-value="hero-2"]');
  await click('[data-action="item"][data-value="item-1"]');
  await click('[data-action="cell"][data-value="1"]');
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.message')?.textContent.includes('Предмет размещён') && !document.querySelector('[data-action=item][data-value=\"item-1\"]')", returnByValue: true })).result.value, 'Dropped item did not move to a surviving hero');
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=defeat` });
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelector('.outcome')?.textContent.includes('Поражение')", returnByValue: true })).result.value, 'Controlled defeat did not appear');
  if ((await call('Runtime.evaluate', { expression: "Boolean(document.querySelector('[data-action=manage]'))", returnByValue: true })).result.value) throw new Error('Defeat incorrectly allowed distribution');
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=log` });
  await eventually(async () => (await call('Runtime.evaluate', { expression: "document.querySelectorAll('#history-list [data-sequence]').length === 50", returnByValue: true })).result.value, 'Full log fixture did not appear');
  await call('Runtime.evaluate', { expression: "(() => { const h=document.querySelector('#history-list'); h.scrollTop=h.children[30].offsetTop + 10; })()" });
  await pause(200);
  const anchorExpression = "(() => { const h=document.querySelector('#history-list'); return [...h.children].find(e => e.offsetTop + e.offsetHeight > h.scrollTop)?.dataset.sequence; })()";
  const anchorBefore = (await call('Runtime.evaluate', { expression: anchorExpression, returnByValue: true })).result.value;
  await pause(1200);
  const anchorAfter = (await call('Runtime.evaluate', { expression: anchorExpression, returnByValue: true })).result.value;
  if (!anchorBefore || anchorBefore !== anchorAfter) throw new Error(`History viewport shifted while old events expired: ${anchorBefore} -> ${anchorAfter}`);
  console.log('Browser tracer passed: placement, rejection, swap, action, bars, reset pause, responsive layout, winding, defeat, transfer and stable log.');
} finally {
  socket?.close();
  browser?.kill();
  vite.kill();
  // Chrome may release its profile asynchronously, so a locked temp file is not fatal.
  const tempRoot = realpathSync(tmpdir());
  for (let i = 0; i < 10; i++) {
    try {
      if (!existsSync(profile)) break;
      const resolvedProfile = realpathSync(profile);
      if (!resolvedProfile.startsWith(`${tempRoot}${sep}woundbound-tracer-`)) throw new Error('Unexpected browser profile path');
      rmSync(resolvedProfile, { recursive: true, force: true });
      break;
    } catch { await pause(100); }
  }
}
