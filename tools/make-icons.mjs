// アイコン PNG を Chromium で描いて public/ に置く（一度だけ実行してコミットする）。
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p));
const html = (size) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0E1A2B"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:#0E1A2B;position:relative;overflow:hidden">
<div style="position:absolute;inset:${size * 0.06}px;border:${Math.max(2, size * 0.012)}px solid #2A4266"></div>
<div style="position:absolute;left:0;right:0;top:${size * 0.62}px;height:${size * 0.02}px;background:#D9A441;opacity:.9"></div>
<div style="font-family:'Hiragino Mincho ProN','Noto Serif CJK JP','Noto Serif JP',serif;font-weight:700;font-size:${size * 0.56}px;line-height:1;color:#E4482C;letter-spacing:-0.02em;text-shadow:0 ${size * 0.02}px 0 #0E1A2B">転</div>
</div></body>`;
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html(size)); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(root, 'public', `icon-${size}.png`), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log('icons written');
