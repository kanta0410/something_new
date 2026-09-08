// shot.mjs — dist/index.html を headless Chromium で開き、5 年進めてスクリーンショットを撮る。
// 使い方: npm run build && node tools/shot.mjs   （PW_CHROME=/path/to/chrome で実行ファイルを指定可）
// 出力: shots/app.png（起動直後）, shots/app-after5.png（5 年後）, shots/app-city.png（街の地区詳細）
// pageerror があれば exit 1。
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'shots');
const dist = path.join(root, 'dist', 'index.html');

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

if (!existsSync(dist)) {
  console.error('dist/index.html がない。先に npm run build');
  process.exit(1);
}

const executablePath = findChrome();
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
let pageErrors = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { pageErrors++; console.error('[pageerror]', e.message, e.stack || ''); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[console.${m.type()}]`, m.text()); });
  await page.goto(pathToFileURL(dist).href, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'app.png') });
  console.log('saved shots/app.png');

  // チュートリアルを閉じる
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const endBtn = page.locator('#btn-end');
  for (let i = 0; i < 5; i++) {
    // アラモ演出中や転生モーダル中はクリックが届かないので待つ / 処理する
    await page.waitForSelector('#alamo', { state: 'hidden', timeout: 5000 }).catch(() => {});
    if (await page.locator('#m-reborn').isVisible()) {
      console.log(`  (life ended before year ${i + 1}; reincarnating)`);
      await page.locator('#reborn-go').click();
      await page.waitForTimeout(300);
    }
    await endBtn.click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('#alamo', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'app-after5.png') });
  console.log('saved shots/app-after5.png');

  // 街の中央タイルを押して地区詳細を出す
  const cityCv = page.locator('#cv-city');
  await cityCv.scrollIntoViewIfNeeded();
  const box = await cityCv.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.47);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(outDir, 'app-city.png') });
  console.log('saved shots/app-city.png');

  const info = await page.evaluate(() => {
    const a = window.__app;
    return a ? { life: a.state.life, nw: Math.round(a.status.netWorth), modals: a.modals, selected: a.ui.selected, logs: a.state.log.length } : null;
  });
  console.log('state', JSON.stringify(info));
} finally {
  await browser.close();
}
if (pageErrors > 0) {
  console.error(`${pageErrors} pageerror(s)`);
  process.exit(1);
}
