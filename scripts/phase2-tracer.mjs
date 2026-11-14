// Browser tracer for the persistent party, shaped inventories, and reusable room panel.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createServer } from 'node:net';

const capturePreview = process.argv.includes('--capture-preview');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));
if (!browserPath) throw new Error('Chrome or Edge not found; set CHROME_PATH to run the browser tracer.');
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function eventually(fn, message) {
  let lastError = '';
  for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value; } catch (error) { lastError = error.message; } await pause(100); }
  throw new Error(`${message}${lastError ? ` (${lastError})` : ''}`);
}
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'woundbound-tracer-'));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'test', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let viteOutput = '';
vite.stdout.on('data', chunk => { viteOutput += chunk.toString(); });
vite.stderr.on('data', chunk => { viteOutput += chunk.toString(); });
vite.on('error', error => { viteOutput += error.message; });
vite.on('exit', code => { viteOutput += ` [vite exit ${code}]`; });
let browser, socket;
try {
  await eventually(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok, `Vite did not start: ${viteOutput}`);
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const debugPort = await eventually(() => { const path = join(profile, 'DevToolsActivePort'); return existsSync(path) ? readFileSync(path, 'utf8').split('\n')[0] : null; }, 'Chrome DevTools did not start');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const value = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  const click = async selector => {
    const point = await value(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    if (!point) throw new Error(`Missing UI control: ${selector}`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await pause(80);
  };
  const point = async selector => value(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const drag = async (from, to, previewClass, rotate = false) => {
    const a = await point(from), b = await point(to);
    if (!a || !b) throw new Error(`Missing drag endpoint: ${from} → ${to}`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 10, y: a.y + 10, button: 'left', buttons: 1 });
    if (rotate) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 }); }
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...b, button: 'left', buttons: 1 });
    await pause(80);
    if (previewClass && !(await value(`Boolean(document.querySelector('.${previewClass}'))`))) throw new Error(`Missing ${previewClass} preview for ${from} → ${to}`);
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, button: 'left', clickCount: 1 });
    await pause(120);
  };
  const navigate = async scenario => { await call('Page.navigate', { url: `http://127.0.0.1:${port}/${scenario ? `?scenario=${scenario}` : ''}` }); await eventually(() => value('Boolean(document.querySelector(".persistent-layout"))'), 'Persistent game screen was not rendered'); };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await navigate(''); await call('Page.bringToFront');
  const initial = await value("(() => {const r=document.querySelector('.room-panel');return {heroes:document.querySelectorAll('.party-cards > .combatant.hero').length,cells:document.querySelectorAll('.party-cards .inventory-cell').length,room:r?.textContent,roomScroll:[r?.scrollHeight,r?.clientHeight],enemyCards:r?.querySelectorAll('.room-enemies .combatant').length,names:[...document.querySelectorAll('.party-cards h3')].map(e=>e.textContent),history:!!document.querySelector('.history')};})()");
  if (initial.heroes !== 4 || initial.cells !== 100 || !initial.room.includes('Схрон') || initial.room.includes('Следующая комната') || initial.enemyCards || initial.roomScroll[0] > initial.roomScroll[1] + 1 || !initial.names.every(name => name.length > 3) || !initial.history) throw new Error(`Persistent preparation layout is incomplete or scrolls its room panel: ${JSON.stringify(initial)}`);
  if (capturePreview) { const png = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); mkdirSync('docs/references', { recursive: true }); writeFileSync('docs/references/woundbound-single-screen-preview.png', Buffer.from(png.data, 'base64')); }
  const hoverPoint = await point('[data-action="item"][data-value="item-1"]');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint });
  await value("window.__hoverNode=document.querySelector('[data-action=item][data-value=item-1]'); true");
  await pause(750);
  if (!(await value("window.__hoverNode===document.querySelector('[data-action=item][data-value=item-1]') && window.__hoverNode.matches(':hover')"))) throw new Error('Hovered item node was replaced or lost hover during render ticks.');
  const cellHover = await point('[data-action="cell"][data-value="hero-1:0"]');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...cellHover });
  await value("window.__hoverCell=document.querySelector('[data-action=cell][data-value=\\\"hero-1:0\\\"]'); true");
  await pause(750);
  if (!(await value("window.__hoverCell===document.querySelector('[data-action=cell][data-value=\\\"hero-1:0\\\"]') && window.__hoverCell.matches(':hover')"))) throw new Error('Hovered cell node was replaced or lost hover during render ticks.');
  await drag('[data-action="item"][data-value="item-1"]', '[data-action="cell"][data-value="hero-1:0"]', 'drop-valid');
  if (!(await value("Boolean(document.querySelector('[data-combatant=hero-1] [data-piece=item-1]'))"))) throw new Error('Dragging an item from the stash did not equip it.');
  await drag('[data-action="cell"][data-value="hero-1:0"]', '[data-action="cell"][data-value="hero-2:2"]', 'drop-valid');
  if (!(await value("Boolean(document.querySelector('[data-combatant=hero-2] [data-piece=item-1]'))"))) throw new Error('Dragging an equipped item to another backpack failed.');
  await drag('[data-action="item"][data-value="whetstone-1"]', '[data-action="cell"][data-value="hero-1:0"]', 'drop-valid', true);
  if (!(await value("[0,5].every(n=>document.querySelector(`[data-action=cell][data-value=\\\"hero-1:${n}\\\"]`)?.dataset.dragItem==='whetstone-1')"))) throw new Error('Rotating with R during drag did not rotate the placed footprint.');
  await drag('[data-action="cell"][data-value="hero-4:1"]', '[data-action="cell"][data-value="hero-3:6"]', 'drop-valid');
  const movedL = await value("[5,6,10].every(n=>document.querySelector(`[data-action=cell][data-value=\\\"hero-3:${n}\\\"]`)?.dataset.dragItem==='item-4')");
  if (!movedL) throw new Error('Irregular item did not preserve its grabbed-cell offset.');
  await drag('[data-action="cell"][data-value="hero-3:6"]', '[data-action="cell"][data-value="hero-2:0"]', 'drop-invalid', true);
  if (!(await value("[5,6,10].every(n=>document.querySelector(`[data-action=cell][data-value=\\\"hero-3:${n}\\\"]`)?.dataset.dragItem==='item-4')"))) throw new Error('Invalid rotated drag changed item ownership or orientation.');
  await drag('[data-action="cell"][data-value="hero-2:2"]', '[data-drop-stash]', 'drop-stash');
  if (!(await value("Boolean(document.querySelector('[data-action=item][data-value=item-1]'))"))) throw new Error('Dragging an equipped item back to the stash failed.');
  await navigate('empty-backpack');
  const emptyBackpack = await value("(() => {const p=document.querySelector('.party-section'),b=document.querySelector('[data-combatant=hero-1] .battle-backpack'),g=b.querySelector('.readonly-grid').getBoundingClientRect(),l=b.querySelector('.muted').getBoundingClientRect();return {text:b.querySelector('.muted')?.textContent,gridBottom:g.bottom,labelTop:l.top,labelBottom:l.bottom,backpackBottom:b.getBoundingClientRect().bottom,partyScroll:[p.scrollHeight,p.clientHeight]}})()");
  if (emptyBackpack.text !== 'Нет предметов' || emptyBackpack.labelTop < emptyBackpack.gridBottom - 1 || emptyBackpack.labelBottom > emptyBackpack.backpackBottom + 1 || emptyBackpack.partyScroll[0] > emptyBackpack.partyScroll[1] + 1) throw new Error(`Empty backpack label overlaps its grid or exceeds the one-screen card: ${JSON.stringify(emptyBackpack)}`);
  await navigate('');
  if (await value('Boolean(document.querySelector("[data-action=swap]"))')) throw new Error('Manual formation control is still present.');
  await click('[data-action="restart"]');
  const modal = await value("(() => {const d=document.querySelector('[role=alertdialog]');return d?{active:!d.closest('[inert]'),roomBodyInert:!!document.querySelector('.room-body[inert]'),headerInert:!!document.querySelector('.screen-head[inert]'),cancel:!!d.querySelector('[data-action=cancel-reset]')}:null})()");
  if (!modal?.active || !modal.roomBodyInert || !modal.headerInert || !modal.cancel) throw new Error(`Nested reset confirmation left an interactive background or inactive dialog: ${JSON.stringify(modal)}`);
  await click('[data-action="cancel-reset"]');
  if (await value("Boolean(document.querySelector('[role=alertdialog]'))")) throw new Error('Reset confirmation did not close when cancelled.');
  await click('[data-action="restart"]');
  await click('[data-action="confirm-reset"]');
  await click('[data-action="cell"][data-value="hero-4:0"]');
  await click('[data-action="rotate"]');
  await click('[data-action="rotate"]');
  const rotatedL = await value("(() => {const p=document.querySelector('[data-combatant=hero-4] [data-piece=item-4]');return {glyph:!!p?.querySelector('.item-art'),bar:!!p?.querySelector('progress.cooldown'),oneGlyph:document.querySelectorAll('[data-combatant=hero-4] [data-piece=item-4] .item-art').length===1,oneBar:document.querySelectorAll('[data-combatant=hero-4] progress.cooldown').length===1,emptyAnchor:!document.querySelector('[data-action=cell][data-value=\\\"hero-4:0\\\"]').classList.contains('occupied')}})()");
  if (!rotatedL.glyph || !rotatedL.bar || !rotatedL.oneGlyph || !rotatedL.oneBar || !rotatedL.emptyAnchor) throw new Error(`Rotated L-shaped item lost or duplicated its glyph/cooldown: ${JSON.stringify(rotatedL)}`);
  await click('[data-action="item"][data-value="item-1"]');
  await click('[data-action="cell"][data-value="hero-1:0"]');
  await click('[data-action="item"][data-value="whetstone-1"]');
  await click('[data-action="rotate"]');
  await click('[data-action="cell"][data-value="hero-1:24"]');
  if (!(await value("document.querySelector('.message')?.textContent.includes('не помещается')"))) throw new Error('Rotated shape crossing the grid boundary was not rejected.');
  await click('[data-action="cell"][data-value="hero-1:5"]');
  const placement = await value("({message:document.querySelector('.message')?.textContent,adjacent:!!document.querySelector('.party-cards .inventory-cell[title*=\\\"Клинок: +2\\\"]'),shape:[...document.querySelectorAll('.party-cards .inventory-cell.occupied')].length})");
  if (!placement.message.includes('Предмет размещён') || !placement.adjacent || placement.shape < 2) throw new Error(`Rotation, placement, or adjacency feedback failed: ${JSON.stringify(placement)}`);
  const bars = await value("({count:document.querySelectorAll('.party-cards progress.cooldown').length,detached:!!document.querySelector('.equipped-list')})");
  if (bars.count < 5 || bars.detached) throw new Error(`Per-item bars are missing or rendered as a detached list: ${JSON.stringify(bars)}`);
  for (const [width, height] of [[1280, 720], [1600, 900], [375, 812]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(150);
    const layout = await value("(() => {const p=document.querySelector('.party-section'),r=document.querySelector('.room-panel'),b=document.querySelector('.room-body');return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,party:p.getBoundingClientRect().toJSON(),partyScroll:[p.scrollHeight,p.clientHeight],room:r.getBoundingClientRect().toJSON(),roomScroll:[r.scrollHeight,r.clientHeight],roomBodyScroll:[b.scrollHeight,b.clientHeight],grids:[...document.querySelectorAll('.party-cards .readonly-grid')].map(e=>({rect:e.getBoundingClientRect().toJSON(),css:getComputedStyle(e).width,cols:getComputedStyle(e).gridTemplateColumns})),cards:[...document.querySelectorAll('.party-cards .combatant')].map(c=>({height:c.clientHeight,scroll:c.scrollHeight,rows:getComputedStyle(c).gridTemplateRows,kids:[...c.children].map(e=>[e.className,Math.round(e.getBoundingClientRect().height)])})),cells:[...document.querySelectorAll('.party-cards .inventory-cell')].slice(0,25).map(e=>e.getBoundingClientRect().width)}})()");
    if (layout.documentWidth > width + 1 || (width >= 1000 && (layout.documentHeight > height + 1 || layout.partyScroll[0] > layout.partyScroll[1] + 1 || layout.roomScroll[0] > layout.roomScroll[1] + 1 || layout.roomBodyScroll[0] > layout.roomBodyScroll[1] + 1)) || layout.cells.some(cell => cell < 30)) throw new Error(`Responsive layout failed at ${width}×${height}: ${JSON.stringify(layout)}`);
    console.log(`Layout ${width}×${height}: ${JSON.stringify({ documentWidth: layout.documentWidth, documentHeight: layout.documentHeight, partyWidth: Math.round(layout.party.width), roomWidth: Math.round(layout.room.width), cellWidth: Math.round(layout.cells[0]) })}`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await click('[data-action="start"]');
  await eventually(() => value("Boolean(document.querySelector('.battlefield'))"), 'Room panel did not switch to combat.');
  const combat = await value("({heroes:document.querySelectorAll('.party-cards > .combatant.hero').length,cells:document.querySelectorAll('.party-cards .inventory-cell').length,editable:document.querySelectorAll('.party-cards .inventory-cell[data-action=cell]').length,roomEnemies:document.querySelectorAll('.battle-unit.foe').length,progress:document.querySelectorAll('.party-cards progress.cooldown').length,detached:!!document.querySelector('.equipped-list')})");
  if (combat.heroes !== 4 || combat.cells !== 100 || combat.editable || combat.roomEnemies !== 4 || !combat.progress || combat.detached) throw new Error(`Combat context did not preserve party or lock placement: ${JSON.stringify(combat)}`);
  await click('[data-action="restart"]');
  const combatModal = await value("(() => {const d=document.querySelector('[role=alertdialog]');return d?{active:!d.closest('[inert]'),roomBodyInert:!!document.querySelector('.room-body[inert]'),cancel:!!d.querySelector('[data-action=cancel-reset]')}:null})()");
  if (!combatModal?.active || !combatModal.roomBodyInert || !combatModal.cancel) throw new Error(`Combat reset confirmation did not isolate its background: ${JSON.stringify(combatModal)}`);
  await click('[data-action="cancel-reset"]');
  const combatPanel = await value("(() => {const b=document.querySelector('.room-body'),h=document.querySelector('.history').getBoundingClientRect(),r=b.getBoundingClientRect(),cards=[...document.querySelectorAll('.battle-unit.foe')];return {bodyScroll:[b.scrollHeight,b.clientHeight],bodyBottom:r.bottom,historyTop:h.top,enemies:cards.map(e=>{const x=e.getBoundingClientRect();return x.top>=r.top&&x.bottom<=r.bottom})}})()");
  if (combatPanel.bodyScroll[0] > combatPanel.bodyScroll[1] + 1 || combatPanel.enemies.length !== 4 || combatPanel.enemies.some(visible => !visible) || combatPanel.bodyBottom > combatPanel.historyTop + 1) throw new Error(`Enemies or event log overflow the single-screen combat panel: ${JSON.stringify(combatPanel)}`);
  if (capturePreview) { const png = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync('docs/references/woundbound-single-screen-combat-preview.png', Buffer.from(png.data, 'base64')); }
  const itemDetail = await value("(() => {const e=[...document.querySelectorAll('.party-cards .inventory-cell[title]')].find(e=>e.title.includes('Сейчас'));return e?.title ?? ''})()");
  const focusedItem = await value("(() => {const e=document.querySelector('.party-cards .inventory-cell[tabindex=\\\"0\\\"]');e?.focus();return {focused:document.activeElement===e,label:e?.getAttribute('aria-label')??'',preview:document.querySelector('.combat-item-preview')?.textContent??'',storeAction:!!document.querySelector('.combat-item-preview [data-action=store]')}})()");
  await pause(250);
  const focusPersistence = await value("({focused:document.activeElement?.dataset?.key?.startsWith('item-')??false,preview:document.querySelector('.combat-item-preview')?.textContent??''})");
  const inspectedPanel = await value("(() => {const b=document.querySelector('.room-body');return {scroll:[b.scrollHeight,b.clientHeight],preview:document.querySelector('.combat-item-preview').getBoundingClientRect().height}})()");
  if (!itemDetail || !itemDetail.includes('Кулдаун: осталось') || itemDetail.length < 60 || !focusedItem.focused || !focusedItem.label.includes('Кулдаун: осталось') || !focusedItem.preview.includes('Осталось на кулдауне') || focusedItem.storeAction || !focusPersistence.focused || !focusPersistence.preview.includes('Осталось на кулдауне') || inspectedPanel.scroll[0] > inspectedPanel.scroll[1] + 1 || inspectedPanel.preview < 1) throw new Error(`Combat item details are not visibly keyboard-accessible: ${JSON.stringify({itemDetail,focusedItem,focusPersistence,inspectedPanel})}`);
  await navigate('drop');
  await eventually(() => value("document.querySelector('.room-panel h2')?.textContent.includes('Победа')"), 'Result loot panel did not appear.');
  if (!(await value("document.querySelectorAll('.party-cards > .combatant.hero').length === 4 && document.querySelector('.room-panel').textContent.includes('добычу')"))) throw new Error('Result replaced the persistent party layout or omitted loot.');
  await click('[data-action="restart"]');
  const resultModal = await value("(() => {const d=document.querySelector('[role=alertdialog]');return d?{active:!d.closest('[inert]'),roomBodyInert:!!document.querySelector('.room-body[inert]'),cancel:!!d.querySelector('[data-action=cancel-reset]')}:null})()");
  if (!resultModal?.active || !resultModal.roomBodyInert || !resultModal.cancel) throw new Error(`Result reset confirmation did not isolate its background: ${JSON.stringify(resultModal)}`);
  await click('[data-action="cancel-reset"]');
  const loot = await value("Boolean(document.querySelector('[data-action=item][data-value=item-1]'))");
  if (loot) {
    await click('[data-action="item"][data-value="item-1"]');
    if (!(await value("document.querySelector('.item-preview')?.textContent.includes('Кровожадный клинок')"))) throw new Error('Selecting result loot did not show its item description.');
    await click('[data-action="rotate"]');
    if (!(await value("document.querySelector('.message')?.textContent.includes('Поворот')"))) throw new Error('Selected result loot did not expose rotation or success feedback.');
    await click('[data-action="cell"][data-value="hero-2:2"]');
  }
  await eventually(() => value("!document.querySelector('[data-action=item][data-value=item-1]')"), 'Loot could not be transferred into a hero backpack after battle.');
  console.log('Browser tracer passed: persistent party, automatic formation, reset dialog isolation, 5×5 rotated shapes, inline cooldowns and combat details, locked placement, room changes, result loot transfer, desktop/mobile fit.');
} finally {
  socket?.close(); browser?.kill(); vite.kill();
  const tempRoot = realpathSync(tmpdir());
  for (let i = 0; i < 10; i++) { try { if (!existsSync(profile)) break; const resolved = realpathSync(profile); if (!resolved.startsWith(`${tempRoot}${sep}woundbound-tracer-`)) throw new Error('Unexpected browser profile path'); rmSync(resolved, { recursive: true, force: true }); break; } catch { await pause(100); } }
}
