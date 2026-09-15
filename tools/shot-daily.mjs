// 毎日モードの操作スクリーンショット（PC とモバイル）。
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'].find(p => existsSync(p));
const outDir = path.join(root, 'shots'); mkdirSync(outDir, { recursive: true });
const errors = [];
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
async function drive(page, tag) {
  page.on('pageerror', (e) => { errors.push(e.message); console.error('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION|Failed to load resource/.test(m.text())) { errors.push(m.text()); console.error('[console]', m.text()); } });
  await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1200);
  await page.waitForSelector('#boot-go', { state: 'visible', timeout: 6000 }).then(async () => { await page.screenshot({ path: path.join(outDir, `daily-${tag}-boot.png`) }); await page.click('#boot-go'); }).catch(() => {}); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `daily-${tag}-1.png`), fullPage: tag === 'mobile' });
  const rows = page.locator('.real-row');
  for (let i = 0; i < 3; i++) { await rows.nth(i).click(); await page.waitForTimeout(150); }
  await page.locator('.preset').nth(1).click(); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `daily-${tag}-2.png`), fullPage: tag === 'mobile' });
  await page.locator('#d-result .btn.primary').click(); await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(outDir, `daily-${tag}-3.png`), fullPage: tag === 'mobile' });
  await page.locator('#btn-ledger').click(); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `daily-${tag}-ledger.png`) });
  await page.keyboard.press('Escape');
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('isekai-quant:meta') || '{}'));
  console.log(tag, 'streak', meta.daily?.streak, 'days', Object.keys(meta.daily?.days || {}).length, 'mode', meta.mode, 'preset', meta.preset);
}
try {
  const pc = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); await drive(pc, 'pc'); await pc.close();
  const mb = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await drive(mb, 'mobile'); await mb.close();
} finally { await browser.close(); }
if (errors.length) { console.error(`${errors.length} errors`); process.exit(1); }
console.log('ok');
