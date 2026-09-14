// UI 経由のフル人生プレイテスト: 毎日モードで「攻める」を選び、死ぬまで年を進め、自慢→転生→2 生目を 5 年。ページエラーで非 0。
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'].find(p => existsSync(p));
mkdirSync(path.join(root, 'shots'), { recursive: true });
const errors = [];
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => { errors.push(e.message); console.error('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION|Failed to load resource/.test(m.text())) { errors.push(m.text()); console.error('[console]', m.text()); } });
  await page.goto(pathToFileURL(path.join(root, 'dist', 'index.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // 現実の行動を全部
  const rows = page.locator('.real-row'); const n = await rows.count();
  for (let i = 0; i < n; i++) { await rows.nth(i).click(); await page.waitForTimeout(80); }
  // 攻める
  await page.locator('.preset').nth(1).click(); await page.waitForTimeout(150);
  let years = 0, alive = true;
  while (alive && years < 90) {
    // 10 年ごとに方針を変える（学ぶ→攻める）
    if (years % 10 === 5) { await page.locator('.preset').nth(2).click(); await page.waitForTimeout(80); }
    if (years % 10 === 7) { await page.locator('.preset').nth(1).click(); await page.waitForTimeout(80); }
    await page.click('#btn-end'); await page.waitForTimeout(250);
    if (await page.locator('.alamo').count()) await page.waitForTimeout(1200);
    years++;
    alive = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('isekai-quant:run') || 'null'); return r ? r.life.alive : true; });
    if (years % 20 === 0) { const st = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('isekai-quant:run')); return { age: r.life.age, props: r.props.length, cash: Math.round(r.money.cash), stocks: Math.round(r.money.stocks), offers: r.flags.offersMade, acc: r.flags.offersAccepted }; }); console.log('progress', JSON.stringify(st)); }
  }
  await page.waitForTimeout(700);
  const dead = await page.evaluate(() => JSON.parse(localStorage.getItem('isekai-quant:run')).life);
  console.log('death', JSON.stringify(dead), 'years played', years);
  if (!(await page.locator('.modal .epitaph').count())) throw new Error('reborn modal not shown');
  await page.screenshot({ path: path.join(root, 'shots', 'playtest-death.png') });
  // 失敗を自慢する（最大 8 回押す）
  const brag = page.locator('.modal .btn.gold').first();
  for (let i = 0; i < 8; i++) { if (await brag.isDisabled()) break; await brag.click(); await page.waitForTimeout(40); }
  await page.locator('.modal .radios input').nth(3).check();
  await page.screenshot({ path: path.join(root, 'shots', 'playtest-brag.png') });
  await page.locator('.modal .btn.primary').click(); await page.waitForTimeout(500);
  const life2 = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('isekai-quant:run')); const m = JSON.parse(localStorage.getItem('isekai-quant:meta')); return { n: r.life.n, age: r.life.age, skills: Object.fromEntries(Object.entries(r.skills).map(([k, v]) => [k, Math.round(v.xp)])), hall: m.hallOfFame.length, best: m.bestScore, titles: (m.titles || []).map(t => t.name) }; });
  console.log('life2', JSON.stringify(life2));
  if (life2.n !== 2 || life2.hall !== 1) throw new Error('reincarnation state wrong');
  for (let i = 0; i < 5; i++) { await page.click('#btn-end'); await page.waitForTimeout(250); if (await page.locator('.alamo').count()) await page.waitForTimeout(1200); }
  // フル画面へ切り替えて描画確認
  await page.click('#btn-mode'); await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(root, 'shots', 'playtest-life2-full.png') });
  await page.click('#btn-hall'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, 'shots', 'playtest-hall.png') });
} finally { await browser.close(); }
if (errors.length) { console.error(`${errors.length} errors`); process.exit(1); }
console.log('playtest ok');
