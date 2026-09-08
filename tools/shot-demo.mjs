// shot-demo.mjs — tools/demo-charts.html を headless Chromium で開いて shots/demo-charts.png に保存する。
// 使い方: node tools/shot-demo.mjs   （PW_CHROME=/path/to/chrome で実行ファイルを指定可）
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'shots');
const outPath = path.join(outDir, 'demo-charts.png');

/** Playwright のブラウザ置き場から chromium 実行ファイルを探す。 */
function findChrome() {
  if (process.env.PW_CHROME && existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(process.env.HOME || '', '.cache/ms-playwright')].filter(Boolean);
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = path.join(base, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const executablePath = findChrome();
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[console]', m.type(), m.text()); });
  const url = pathToFileURL(path.join(root, 'tools', 'demo-charts.html')).href + '?static=1';
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 10000 });
  // Web フォントが来れば再描画される。来なくても 3 秒で先へ。
  await page.evaluate(() => Promise.race([document.fonts && document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]));
  await page.waitForTimeout(150);
  // 純資産チャートにホバーしてツールチップを出す
  const box = await page.locator('#nw').boundingBox();
  if (box) await page.mouse.move(box.x + box.width * 0.47, box.y + box.height * 0.45);
  await page.waitForTimeout(100);
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: outPath, fullPage: true });
  const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  console.log('saved', outPath, `(page ${size.w}×${size.h}, chrome: ${executablePath || 'default'})`);
} finally {
  await browser.close();
}
