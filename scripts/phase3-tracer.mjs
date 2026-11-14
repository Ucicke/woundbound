// Exercise the full route with real browser controls and accelerated test-mode combat.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createServer } from 'node:net';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const capturePreview = process.argv.includes('--capture-preview');
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));
if (!browserPath) throw new Error('Chrome or Edge not found.');
async function eventually(fn, message) {
  let last = '';
  for (let i = 0; i < 100; i++) { try { const result = await fn(); if (result) return result; } catch (error) { last = error.message; } await pause(100); }
  throw new Error(`${message}${last ? ` (${last})` : ''}`);
}
const server = createServer();
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const profile = mkdtempSync(join(tmpdir(), 'woundbound-run-tracer-'));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'test', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: process.cwd(), windowsHide: true, stdio: 'ignore' });
let browser, socket;
try {
  await eventually(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok, 'Vite did not start');
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const debugPort = await eventually(() => { const path = join(profile, 'DevToolsActivePort'); return existsSync(path) ? readFileSync(path, 'utf8').split('\n')[0] : null; }, 'Chrome did not start');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data), callback = pending.get(message.id); if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const value = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  const click = async selector => {
    const point = await value(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (!point) throw new Error(`Missing control: ${selector}`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await pause(100);
  };
  const drag = async (from, to) => {
    const point = async selector => value(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const a = await point(from), b = await point(to); if (!a || !b) throw new Error('Missing reward drag endpoint');
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 12, y: a.y + 12, button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...b, button: 'left', buttons: 1 });
    await pause(80);
    if (!(await value('Boolean(document.querySelector(".drop-valid"))'))) throw new Error('Reward drag did not preview a valid placement');
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, button: 'left', clickCount: 1 }); await pause(120);
  };
  const navigate = async scenario => { await call('Page.navigate', { url: `http://127.0.0.1:${port}/?scenario=${scenario}` }); await eventually(() => value('Boolean(document.querySelector(".persistent-layout"))'), 'Game did not load'); };
  const capture = async name => { if (!capturePreview) return; const png = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); mkdirSync('docs/references', { recursive: true }); writeFileSync(`docs/references/woundbound-run-${name}.png`, Buffer.from(png.data, 'base64')); };
  const assertShell = async room => {
    const result = await value(`(() => ({room:document.querySelector('.eyebrow')?.textContent,heroes:document.querySelectorAll('.party-cards > .combatant.hero').length,cells:document.querySelectorAll('.party-cards .inventory-cell').length,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}))()`);
    if (!result.room.includes(`КОМНАТА ${room}/10`) || result.heroes !== 4 || result.cells !== 100 || result.width > 1281 || result.height > 721) throw new Error(`Persistent shell or room counter failed: ${JSON.stringify(result)}`);
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await navigate('full-run'); await call('Page.bringToFront');
  await assertShell(1); await click('[data-action="start"]');
  await eventually(() => value('document.querySelectorAll("[data-action=claim]").length === 3'), 'Opening battle did not offer three rewards');
  const rewardLayout = await value("(() => {const b=document.querySelector('.room-body').getBoundingClientRect();return [...document.querySelectorAll('[data-action=claim]')].map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent,top:r.top,bottom:r.bottom,visible:r.top>=b.top&&r.bottom<=b.bottom}})})()");
  if (rewardLayout.length !== 3 || rewardLayout.some(item => !item.visible)) throw new Error(`Battle reward choices are not visible in the room panel: ${JSON.stringify(rewardLayout)}`);
  const rewardPoint = await value("(() => {const r=document.querySelector('[data-action=claim]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rewardPoint });
  await value("window.__hoverReward=document.querySelector('[data-action=claim]'); true");
  await pause(750);
  if (!(await value("window.__hoverReward===document.querySelector('[data-action=claim]') && window.__hoverReward.matches(':hover')"))) throw new Error('Reward hover flickered during recurring renders');
  await capture('battle-reward');
  await drag('[data-action="claim"]', '[data-action="cell"][data-value="hero-1:0"]');
  if (!(await value("Boolean(document.querySelector('[data-combatant=hero-1] [data-piece^=reward-1-]'))"))) throw new Error('Dragging reward directly into the backpack failed');
  await eventually(() => value('Boolean(document.querySelector("[data-action=route]"))'), 'Opening reward did not complete');
  await click('[data-action="route"]'); await click('[data-action="room"][data-value="cache"]');
  await assertShell(2);
  if ((await value('document.querySelectorAll("[data-action=claim]").length')) !== 3) throw new Error('Cache did not offer three rewards');
  await capture('cache');
  await click('[data-action="claim"]');
  if (await value('Boolean(document.querySelector("[data-action=claim]"))')) throw new Error('Reward could be claimed more than once');
  await click('[data-action="route"]'); await click('[data-action="room"][data-value="workshop"]');
  await assertShell(3); await click('[data-action="workshop-wind"]'); await click('[data-action="calm"]');
  const repaired = await value("({doll:document.querySelector('[data-combatant=hero-4] .state')?.textContent,calmed:!!document.querySelector('[data-combatant=hero-4] [title*=успокоен]')})");
  if (!repaired.doll.includes('работает') || !repaired.calmed) throw new Error(`Workshop effects missing: ${JSON.stringify(repaired)}`);
  await capture('workshop');
  await click('[data-action="leave-workshop"]');
  for (let room = 4; room <= 10; room++) {
    await click('[data-action="route"]');
    await click(room === 10 ? '[data-action="room"][data-value="boss"]' : room === 5 ? '[data-action="room"][data-value="event"]' : '[data-action="room"][data-value="battle-0"]');
    await assertShell(room);
    if (room === 5) { await capture('event'); await click('[data-action="event-choice"][data-value="repair"]'); await eventually(() => value('Boolean(document.querySelector("[data-action=route]"))'), 'Infirmary did not resolve'); continue; }
    if (await value('Boolean(document.querySelector("[data-action=start]"))')) throw new Error(`Room ${room} inserted an extra preparation step`);
    await eventually(() => value(room === 10 ? "document.querySelector('.room-panel h2')?.textContent.includes('Победа в забеге')" : 'document.querySelectorAll("[data-action=claim]").length === 3'), `Battle in room ${room} did not finish`);
    if (room !== 10) { await click('[data-action="claim"]'); await eventually(() => value('Boolean(document.querySelector("[data-action=route]"))'), `Reward in room ${room} did not complete`); }
  }
  if (!(await value("document.querySelector('[data-combatant=hero-4] .state')?.textContent.includes('работает')"))) throw new Error('Doll state did not persist across rooms');
  await capture('victory');
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }); await pause(150);
  if (await value('document.documentElement.scrollWidth > innerWidth + 1')) throw new Error('Mobile layout overflows horizontally');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await click('[data-action="restart"]'); await click('[data-action="confirm-reset"]'); await assertShell(1);
  await navigate('defeat');
  await eventually(() => value("document.querySelector('.room-panel h2')?.textContent.includes('Поражение')"), 'Permanent party defeat was not shown');
  console.log('Phase 3 browser tracer passed: ten-room route, combat, cache, workshop, event, boss victory, permanent defeat, reset and desktop/mobile shell.');
} finally {
  socket?.close(); browser?.kill(); vite.kill();
  const tempRoot = realpathSync(tmpdir());
  for (let i = 0; i < 10; i++) { try { if (!existsSync(profile)) break; const resolved = realpathSync(profile); if (!resolved.startsWith(`${tempRoot}${sep}woundbound-run-tracer-`)) throw new Error('Unexpected browser profile path'); rmSync(resolved, { recursive: true, force: true }); break; } catch { await pause(100); } }
}
