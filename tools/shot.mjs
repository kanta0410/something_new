// dist/index.html を Chromium で開き、操作しながらスクリーンショットを撮る。ページエラーがあれば非 0 で終了。
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const candidates = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'];
const executablePath = candidates.find(p => existsSync(p));
const outDir = path.join(root, 'shots'); mkdirSync(outDir, { recursive: true });
const errors = [];
const INIT = () => { try { const m = JSON.parse(localStorage.getItem('isekai-quant:meta') || '{}'); m.unlockAll = true; m.bootSeen = true; localStorage.setItem('isekai-quant:meta', JSON.stringify(m)); } catch (_) {} };
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { errors.push(e.message); console.error('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION|Failed to load resource/.test(m.text())) { errors.push(m.text()); console.error('[console]', m.text()); } });
  await page.addInitScript(INIT); await page.goto(pathToFileURL(path.join(root, 'dist', 'index.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'app-tutorial.png') });
  if (await page.locator('#boot-go').count() && await page.locator('#boot-go').isVisible()) { await page.click('#boot-go'); await page.waitForTimeout(200); }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#btn-mode'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'app.png') });
  for (let i = 0; i < 5; i++) { await page.click('#btn-end'); await page.waitForTimeout(1500); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'app-after5.png') });
  const box = await page.locator('#cv-city').boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.4);
  await page.waitForTimeout(300);
  await page.locator('#panel-city').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, 'app-city.png') });
  const offerBtn = page.locator('.listings button').first();
  if (await offerBtn.count()) { await offerBtn.click(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(outDir, 'app-offer.png') }); await page.keyboard.press('Escape'); }
  await page.locator('#q-tabs .tab').nth(2).click(); await page.waitForTimeout(600);
  await page.locator('#q-pane').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, 'app-quant.png') });
  await page.click('#btn-reborn'); await page.waitForTimeout(200);
  await page.locator('.confirm button').first().click(); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'app-reborn.png') });
  const state = await page.evaluate(() => ({ life: JSON.parse(localStorage.getItem('isekai-quant:run') || '{}').life, meta: localStorage.getItem('isekai-quant:meta') }));
  console.log('state', JSON.stringify(state).slice(0, 300));
} finally { await browser.close(); }
if (errors.length) { console.error(`${errors.length} errors`); process.exit(1); }
console.log('ok, shots in', outDir);
