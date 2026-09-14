// 転生クオンツ — UI 本体。状態は engine/game.js、描画は charts.js / cityView.js。
import * as game from '../engine/game.js';
import { districtSummary, maxLtv } from '../engine/city.js';
import { ADVISORS, advise, buildSamplePrompt } from '../engine/council.js';
import { kelly, stats, monteCarlo, unlockLevel, returnsFromHistory } from '../engine/quant.js';
import { availableBooks } from '../engine/books.js';
import { SKILLS, skillLevels, nextLevelXp, level } from '../engine/skills.js';
import { computeScore, lifeSummary } from '../engine/score.js';
import { netWorth } from '../engine/life.js';
import { fitCanvas, drawNetWorth, drawMarket, drawFan, drawSparkline, drawRadar } from './charts.js';
import { drawCity, districtAt } from './cityView.js';
import { REAL_ACTIONS, recordRealAction, doneToday, currentStreak, ensureDaily, recentDays, ledgerText, todayKey } from '../engine/real.js';
import { play, setSoundEnabled } from './sound.js';
import { previewLifeTitles, awardStreakTitles, ensureTitles } from '../engine/titles.js';

const fmt = game.formatMoney;
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TIME_ROWS = [
  { id: 'reading', label: '読書', cap: '読書 XP。給与の伸び・副業単価・学び' },
  { id: 'scouting', label: '偵察', cap: '10 で 1 回の現地訪問。推定誤差が縮み、秘密が見つかる' },
  { id: 'networking', label: '人脈', cap: 'コミュ力 XP。買い付けが通りやすくなり、達成者に出会う' },
  { id: 'fun', label: '遊ぶ', cap: '楽しさ +0.6/pt、生活費 +1.2万/pt。楽しさは死亡率も下げる' },
  { id: 'hustle', label: '副業', cap: '現金。単価は読書とコミュ力で上がる' },
];
const QUANT_TABS = [
  { id: 'stats', label: '統計', need: 1, lv: 1 },
  { id: 'kelly', label: 'Kelly', need: 2, lv: 3 },
  { id: 'fan', label: '扇形図', need: 3, lv: 5 },
  { id: 'eco', label: '生態系', need: 4, lv: 7 },
];

let meta, state, decisions, lastReport = null;
const ui = { selected: null, hover: null, tab: 'stats', mc: null, mcKey: '', sample: undefined, blink: true, deep: {}, modal: null, revealed: 0, mode: 'daily', preset: 'guard', quick: false, quickRatio: 0.7, showAll: false, result: null };

const PRESETS = {
  guard: { name: '守る', desc: '読書 30・遊ぶ 30。貯蓄 50%、株 50%。基本形。', time: { reading: 30, scouting: 10, networking: 20, fun: 30, hustle: 10 }, savingsRate: 0.5, stockAlloc: 0.5 },
  attack: { name: '攻める', desc: '偵察 40・人脈 25。貯蓄 70%、株 70%。安い売り物に買い付けを出す。', time: { reading: 15, scouting: 40, networking: 25, fun: 10, hustle: 10 }, savingsRate: 0.7, stockAlloc: 0.7, quick: true },
  learn: { name: '学ぶ', desc: '読書 45。本を 2 冊読む。貯蓄 60%、株 60%。', time: { reading: 45, scouting: 10, networking: 25, fun: 15, hustle: 5 }, savingsRate: 0.6, stockAlloc: 0.6, books: 2 },
  play: { name: '遊ぶ', desc: '遊ぶ 50。楽しさは死亡率も下げる。貯蓄 30%、株 50%。', time: { reading: 10, scouting: 10, networking: 20, fun: 50, hustle: 10 }, savingsRate: 0.3, stockAlloc: 0.5 },
};

// ───────────────────────── 起動 ─────────────────────────
function boot() {
  meta = game.loadMeta();
  state = game.loadRun() || game.newGame(meta);
  decisions = game.defaultDecisions(state);
  ensureDaily(meta);
  setSoundEnabled(meta.sound !== false);
  ui.mode = meta.mode === 'full' ? 'full' : 'daily';
  ui.preset = meta.preset || 'guard';
  if (ui.preset !== 'custom') applyPreset(ui.preset, true);
  buildStaticControls();
  bindGlobal();
  render();
  if (!state.life.alive) openReborn();
  else if (!meta.tutorialDone) openHelp(true);
  resolveSample();
  if (!reducedMotion()) setInterval(() => { ui.blink = !ui.blink; drawCityNow(); }, 700);
}

function fail(e) {
  const b = $('err');
  b.hidden = false;
  b.textContent = `エラー: ${e && e.stack ? e.stack : e}`;
  console.error(e);
}

// ───────────────────────── 采配コントロール ─────────────────────────
function buildStaticControls() {
  const rows = $('time-rows');
  rows.innerHTML = '';
  for (const r of TIME_ROWS) {
    const input = el('input', { type: 'range', min: 0, max: 100, step: 5, id: `t-${r.id}` });
    input.addEventListener('input', () => setTime(r.id, Number(input.value)));
    rows.append(el('div', { class: 'time-row' },
      el('span', { class: 'lbl' }, r.label), input, el('span', { class: 'val num', id: `tv-${r.id}` }, '20'),
      el('span', { class: 'cap' }, r.cap)));
  }
  $('in-save').addEventListener('input', (e) => { decisions.savingsRate = Number(e.target.value) / 100; customized(); renderDecisions(); });
  $('in-stock').addEventListener('input', (e) => { decisions.stockAlloc = Number(e.target.value) / 100; customized(); renderDecisions(); });
  $('in-fire').addEventListener('change', (e) => { decisions.quitJob = e.target.checked; });
  $('btn-end').addEventListener('click', endYear);
  $('btn-city').addEventListener('click', () => { if (ui.mode !== 'full') setMode('full'); $('panel-city').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
  $('btn-mode').addEventListener('click', () => setMode(ui.mode === 'full' ? 'daily' : 'full'));
  $('btn-ledger').addEventListener('click', openLedger);
  $('btn-sound').addEventListener('click', () => { meta.sound = meta.sound === false; setSoundEnabled(meta.sound !== false); game.saveMeta(meta); renderSoundBtn(); if (meta.sound !== false) play('check'); });
  $('btn-books').addEventListener('click', openBooks);
  $('btn-hall').addEventListener('click', openHall);
  $('btn-help').addEventListener('click', () => openHelp(false));
  $('btn-reborn').addEventListener('click', confirmReborn);
  const city = $('cv-city');
  city.addEventListener('click', (e) => { const id = districtAt(city, e.clientX, e.clientY, state.city); if (id !== null) { ui.selected = id; renderCity(); } });
  city.addEventListener('mousemove', (e) => { const id = districtAt(city, e.clientX, e.clientY, state.city); if (id !== ui.hover) { ui.hover = id; drawCityNow(); } });
  city.addEventListener('mouseleave', () => { ui.hover = null; drawCityNow(); });
}

function setTime(id, value) {
  const t = decisions.time;
  const others = TIME_ROWS.map(r => r.id).filter(k => k !== id);
  const rest = 100 - value;
  const cur = others.reduce((s, k) => s + t[k], 0);
  if (cur > 0) for (const k of others) t[k] = t[k] * rest / cur;
  else for (const k of others) t[k] = rest / others.length;
  t[id] = value;
  customized();
  renderDecisions();
}

function customized() { ui.preset = 'custom'; meta.preset = 'custom'; markDirty(); }

function markDirty() { ui.mcKey = ''; if (ui.tab === 'fan') scheduleFan(); }

function bindGlobal() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) { if (ui.modal.dataset.locked !== '1') closeModal(); return; }
    if (e.key === 'Enter' && !ui.modal && !['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) endYear();
  });
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderCharts, 120); });
}

// ───────────────────────── 描画 ─────────────────────────
function render() {
  renderHeader();
  renderSoundBtn();
  $('daily').hidden = ui.mode !== 'daily';
  $('full').hidden = ui.mode !== 'full';
  $('btn-mode').textContent = ui.mode === 'full' ? '毎日モード' : 'フル画面';
  $('btn-city').hidden = ui.mode !== 'full';
  $('books-count').textContent = decisions.books.length ? `(${decisions.books.length})` : '';
  if (ui.mode === 'full') {
    renderDecisions();
    renderSkills();
    renderCharts();
    renderCity();
    renderProps();
    renderQuant();
    renderCouncil();
    renderLog();
  } else {
    renderDaily();
  }
}

function setMode(mode) {
  ui.mode = mode; meta.mode = mode; game.saveMeta(meta);
  render();
  if (mode === 'full') requestAnimationFrame(renderCharts);
  window.scrollTo({ top: 0 });
}

function renderSoundBtn() { const b = $('btn-sound'); const on = meta.sound !== false; b.textContent = on ? '音 ON' : '音 OFF'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }

function renderHeader() {
  const st = game.status(state);
  $('h-life').textContent = `第${st.life}生`;
  $('h-age').textContent = `${st.age}歳 / ${st.year}`;
  $('h-nw').textContent = fmt(st.netWorth);
  $('h-nw').className = 'num ' + (st.netWorth < 0 ? 'neg' : 'gold');
  $('h-score').textContent = st.score.toLocaleString('ja-JP');
  for (const id of ['h-regime', 'mk-regime']) { const c = $(id); c.textContent = st.regime; c.className = `chip r-${st.regime}`; }
  $('h-seed').textContent = String(state.seed);
  $('q-lv').textContent = `クオンツ Lv${st.levels.quant}`;
  const fire = $('in-fire'), lab = $('fire-label');
  const can = st.passive > st.living && state.work.employed && !state.flags.fired;
  fire.disabled = !can; fire.checked = !!decisions.quitJob; lab.classList.toggle('off', !can);
  $('fire-hint').textContent = state.flags.fired ? `FIRE 済み。不労所得 ${fmt(st.passive)} / 生活費 ${fmt(st.living)}`
    : `不労所得 ${fmt(st.passive)} / 生活費 ${fmt(st.living)}。不労所得が生活費を超えると辞められる。`;
  $('btn-end').disabled = !state.life.alive;
}

function renderDecisions() {
  let sum = 0;
  for (const r of TIME_ROWS) { const v = decisions.time[r.id]; sum += v; $(`t-${r.id}`).value = Math.round(v); $(`tv-${r.id}`).textContent = Math.round(v); }
  $('time-sum').textContent = Math.round(sum);
  $('in-save').value = Math.round(decisions.savingsRate * 100); $('v-save').textContent = `${Math.round(decisions.savingsRate * 100)}%`;
  $('in-stock').value = Math.round(decisions.stockAlloc * 100); $('v-stock').textContent = `${Math.round(decisions.stockAlloc * 100)}%`;
  const liq = state.money.cash + state.money.stocks;
  $('hint-stock').textContent = `流動資産 ${fmt(liq)} のうち株式 ${fmt(liq * decisions.stockAlloc)} を目標にリバランス。${state.flags.lastCrash ? '暴落の翌年に買い増すと胆力 +40。' : ''}`;
  renderMeters();
  renderPending();
}

function renderSkills() {
  const box = $('skills'); box.innerHTML = '';
  for (const s of SKILLS) {
    const xp = state.skills[s.id]?.xp || 0, lv = level(xp), next = nextLevelXp(xp);
    const prev = lv >= 10 ? next : 40 * lv * lv;
    const frac = lv >= 10 ? 1 : Math.max(0, Math.min(1, (xp - prev) / Math.max(1, next - prev)));
    box.append(el('div', { class: 'skill', title: s.desc },
      el('span', {}, s.name, ' ', el('span', { class: 'lv num' }, `Lv${lv}`)),
      el('div', { class: 'bar' }, el('i', { style: `width:${frac * 100}%` })),
      el('span', { class: 'xp num' }, lv >= 10 ? 'MAX' : `${Math.round(xp)} / ${next}`)));
  }
}

function renderMeters() {
  const m = state.meters, box = $('meters'); box.innerHTML = '';
  const rows = [['楽しさ', m.fun, 'pos'], ['エネルギー', m.energy, 'acc'], ['人脈', m.network, '']];
  for (const [n, v, c] of rows) box.append(el('div', { class: 'meter' }, el('span', {}, n), el('div', { class: `bar ${c}` }, el('i', { style: `width:${Math.max(0, Math.min(100, v))}%` })), el('span', { class: 'v num' }, Math.round(v))));
  box.append(el('div', { class: 'meter' }, el('span', {}, '学び'), el('span', { class: 'muted', style: 'font-size:11px' }, '累積'), el('span', { class: 'v num' }, Math.round(m.learning))));
  box.append(el('div', { class: 'meter' }, el('span', {}, '自慢'), el('span', { class: 'muted', style: 'font-size:11px' }, `失敗 ${state.brag.failures.length} 件`), el('span', { class: 'v num gold' }, state.brag.points)));
}

function renderCharts() {
  try {
    drawNetWorth($('cv-nw'), state.history);
    const last = state.history[state.history.length - 1];
    const dbt = state.props.reduce((s, p) => s + p.loan, 0);
    $('nw-now').textContent = fmt(netWorth(state));
    $('nw-meta').innerHTML = `<span>現金 <b>${fmt(state.money.cash)}</b></span><span>株式 <b>${fmt(state.money.stocks)}</b></span><span>不動産純資産 <b>${fmt(state.props.reduce((s, p) => s + p.value - p.loan, 0))}</b></span><span>借入 <b>${fmt(dbt)}</b></span><span>今年の収入 <b>${fmt(last?.income || 0)}</b></span>`;
    const q = unlockLevel(state);
    drawMarket($('cv-mk'), state.market, { quantLevel: q, baseYear: game.START_YEAR });
    const yr = state.market.last;
    $('mk-meta').innerHTML = yr
      ? `<span>指数 <b>${state.market.index.toFixed(1)}</b></span><span>昨年 <b class="${yr.totalReturn < 0 ? 'neg' : 'pos'}">${(yr.totalReturn * 100).toFixed(1)}%</b></span><span>金利 <b>${(yr.rate * 100).toFixed(2)}%</b></span><span>住宅ローン <b>${(yr.mortgageRate * 100).toFixed(2)}%</b></span>${q >= 1 ? `<span>本源価値比 <b>${yr.x >= 0 ? '+' : ''}${(Math.expm1(yr.x) * 100).toFixed(0)}%</b></span>` : ''}${q >= 4 ? `<span>チャーティスト <b>${Math.round(yr.wc * 100)}%</b></span>` : ''}`
      : `<span>指数 <b>100.0</b></span><span>金利 <b>${(state.market.rate * 100).toFixed(2)}%</b></span><span class="muted">1 年進めると動き出す</span>`;
  } catch (e) { fail(e); }
  drawCityNow();
  if (ui.tab === 'fan' && ui.mc) drawFan($('cv-fan'), ui.mc, { currentAge: state.life.age, ages: ui.mc.ages });
  if (ui.tab === 'eco') drawMarket($('cv-eco'), state.market, { quantLevel: 4, baseYear: game.START_YEAR });
}

function drawCityNow() {
  const c = $('cv-city'); if (!c) return;
  try {
    drawCity(c, state.city, {
      selected: ui.selected, hover: ui.hover,
      ownedDistrictIds: new Set(state.props.map(p => p.districtId)),
      listingDistrictIds: new Set(state.city.listings.map(l => l.districtId)),
      scoutTargets: new Set(decisions.scoutTargets), blink: ui.blink, quantLevel: unlockLevel(state),
    });
  } catch (e) { fail(e); }
}

// ───────────────────────── 街 ─────────────────────────
function renderCity() {
  drawCityNow();
  const box = $('district'); box.innerHTML = '';
  if (ui.selected === null) { box.append(el('p', { class: 'empty' }, '地区をクリックすると詳細が出る。未偵察の地区は「?」。偵察先は最大 3 つ。')); return; }
  const s = districtSummary(state.city, ui.selected);
  const isTarget = decisions.scoutTargets.includes(s.id);
  const owned = state.props.filter(p => p.districtId === s.id).length;
  box.append(el('h3', {}, s.name, el('span', { class: 'kind' }, s.kind), owned ? el('span', { class: 'tag mine' }, `所有 ${owned}`) : null));
  const kv = el('dl', { class: 'kv' });
  const add = (k, v) => kv.append(el('dt', {}, k), el('dd', { class: 'num' }, v));
  add('推定相場', s.visits > 0 ? `${fmt(s.estimate)} ±${Math.round(s.estError * 100)}%` : '未偵察（誤差 ±30%）');
  add('推定利回り', s.visits > 0 ? pct(s.estYield, 1) : '?');
  add('推定家賃/年', s.visits > 0 ? fmt(s.estRent) : '?');
  add('訪問回数', `${s.visits} 回`);
  add('秘密', `${s.knownSecrets.length} 発見 / ${s.secretCount}`);
  box.append(kv);
  if (s.knownSecrets.length) box.append(el('ul', { class: 'secrets' }, s.knownSecrets.map(t => el('li', {}, t))));
  const btnT = el('button', { class: 'btn sm ' + (isTarget ? 'on' : ''), onclick: () => toggleScout(s.id) }, isTarget ? '偵察先から外す' : `偵察先に追加（${decisions.scoutTargets.length}/3）`);
  if (!isTarget && decisions.scoutTargets.length >= 3) btnT.disabled = true;
  box.append(el('div', {}, btnT, ' ', el('span', { class: 'hint' }, `偵察 ${Math.round(decisions.time.scouting)} → 今年 ${Math.round(decisions.time.scouting / 10)} 回訪問を偵察先に配分`)));
  const ul = el('ul', { class: 'listings' });
  if (!s.listings.length) ul.append(el('li', { class: 'list-empty' }, '今年この地区に売り物はない'));
  for (const l of s.listings) {
    const pending = decisions.offers.find(o => o.listingId === l.id);
    ul.append(el('li', {},
      el('span', { class: 'tag hot' }, '売出し'), el('span', { class: 'num' }, l.id),
      el('span', { class: 'ask num' }, fmt(l.ask), ' ', el('span', { class: 'ratio' }, s.visits > 0 ? `推定の ${Math.round(l.ask / s.estimate * 100)}%` : '')),
      pending ? el('span', { class: 'tag mine' }, `提出予定 ${Math.round(pending.bidRatio * 100)}%`) : null,
      el('button', { class: 'btn sm gold', onclick: () => openOffer(l.id) }, pending ? '条件を変える' : '買い付け')));
  }
  box.append(el('h3', { style: 'margin-top:4px' }, '売り物'), ul);
}

function toggleScout(id) {
  const i = decisions.scoutTargets.indexOf(id);
  if (i >= 0) decisions.scoutTargets.splice(i, 1); else if (decisions.scoutTargets.length < 3) decisions.scoutTargets.push(id);
  renderCity();
}

function renderProps() {
  const ul = $('props'); ul.innerHTML = '';
  $('props-count').textContent = state.props.length;
  if (!state.props.length) ul.append(el('li', { class: 'list-empty' }, 'まだ物件はない。街で買い付けを出そう。半額でもいい。'));
  const sorted = [...state.props].sort((a, b) => (a.lastCashflow ?? 0) - (b.lastCashflow ?? 0));
  for (const p of sorted.slice(0, 40)) {
    const selling = decisions.sells.includes(p.id);
    const cf = p.lastCashflow ?? (p.rent * 0.92 - 0.01 * p.value - p.loan * p.rate);
    ul.append(el('li', {},
      el('span', { class: `tag ${cf >= 0 ? 'asset' : 'liab'}` }, cf >= 0 ? '資産' : '負債'),
      el('span', { class: 'nm' }, p.name, ' ', el('span', { class: 'muted num', style: 'font-size:10px' }, `${p.boughtYear}年 ${fmt(p.buyPrice)}`)),
      el('span', { class: 'num muted' }, `時価 ${fmt(p.value)}`),
      el('span', { class: `cf num ${cf >= 0 ? 'pos' : 'neg'}` }, `${cf >= 0 ? '+' : ''}${fmt(cf)}/年`),
      el('button', { class: 'btn sm ' + (selling ? 'danger' : 'ghost'), onclick: () => { const i = decisions.sells.indexOf(p.id); if (i >= 0) decisions.sells.splice(i, 1); else decisions.sells.push(p.id); renderProps(); } }, selling ? '売却をやめる' : '売る')));
  }
  if (state.props.length > 40) ul.append(el('li', { class: 'list-empty' }, `…他 ${state.props.length - 40} 件`));
}

function renderPending() {
  const ul = $('pending'); if (!ul) return; ul.innerHTML = '';
  $('pending-count').textContent = `${decisions.offers.length} / ${game.MAX_OFFERS}`;
  if (!decisions.offers.length) ul.append(el('li', { class: 'list-empty' }, '今年の買い付けはまだ無い。行動すると事態が動く。'));
  for (const o of decisions.offers) {
    const l = state.city.listings.find(x => x.id === o.listingId); if (!l) continue;
    const d = state.city.districts[l.districtId];
    ul.append(el('li', {}, el('span', {}, d.name), el('span', { class: 'num' }, `${fmt(l.ask * o.bidRatio)}（${Math.round(o.bidRatio * 100)}%）`), el('span', { class: 'num muted' }, `LTV ${Math.round(o.ltv * 100)}%`),
      el('button', { class: 'btn sm ghost', onclick: () => { decisions.offers = decisions.offers.filter(x => x !== o); renderPending(); renderCity(); } }, '取り消す')));
  }
}

// ───────────────────────── 買い付けモーダル ─────────────────────────
function openOffer(listingId) {
  const l = state.city.listings.find(x => x.id === listingId); if (!l) return;
  const s = districtSummary(state.city, l.districtId);
  const existing = decisions.offers.find(o => o.listingId === listingId);
  const lv = skillLevels(state);
  const lastInc = state.history[state.history.length - 1]?.income || state.work.salary;
  const mortgage = state.market.last?.mortgageRate ?? (state.market.rate + 0.012);
  let bid = existing ? existing.bidRatio : 0.85, ltv = existing ? existing.ltv : 0.7;
  const body = el('div', { class: 'offer-grid' });
  const left = el('div'), right = el('div');
  body.append(left, right);
  const kv = el('dl', { class: 'kv' });
  const add = (k, v) => kv.append(el('dt', {}, k), el('dd', { class: 'num' }, v));
  add('地区', `${s.name}（${s.kind}）`);
  add('売出価格', fmt(l.ask));
  add('あなたの推定', s.visits > 0 ? `${fmt(s.estimate)} ±${Math.round(s.estError * 100)}%` : `${fmt(s.estimate)}（未偵察 ±30%）`);
  add('推定利回り', pct(s.estYield, 1));
  add('手元現金', fmt(state.money.cash));
  left.append(kv);
  const bidIn = el('input', { type: 'range', min: 40, max: 110, step: 1, class: 'accent' }); bidIn.value = Math.round(bid * 100);
  const ltvIn = el('input', { type: 'range', min: 0, max: 95, step: 5 });
  const bidV = el('span', { class: 'val num' }), ltvV = el('span', { class: 'val num' });
  left.append(el('div', { class: 'slider-row', style: 'margin-top:10px' }, el('span', {}, '提示額'), bidIn, bidV));
  const bidHint = el('p', { class: 'hint' });
  left.append(bidHint);
  left.append(el('div', { class: 'slider-row' }, el('span', {}, 'LTV'), ltvIn, ltvV));
  const ltvHint = el('p', { class: 'hint' });
  left.append(ltvHint);
  const prev = el('div', { class: 'preview' });
  right.append(prev);
  const submit = el('button', { class: 'btn primary' }, existing ? '条件を更新する' : 'この条件で出す');
  const update = () => {
    bid = Number(bidIn.value) / 100;
    const price = l.ask * bid;
    const cap = maxLtv({ commLevel: lv.comm, network: state.meters.network, income: lastInc, price });
    ltvIn.max = Math.round(cap * 100 / 5) * 5;
    if (Number(ltvIn.value) > Number(ltvIn.max)) ltvIn.value = ltvIn.max;
    ltv = Number(ltvIn.value) / 100;
    bidV.textContent = `${Math.round(bid * 100)}%`; ltvV.textContent = `${Math.round(ltv * 100)}%`;
    bidHint.textContent = `${fmt(price)} で提示。${bid <= 0.7 ? '70% 以下は胆力 +25 XP。半額でも常識外でもいい。行動すると事態が動く。' : '売主の本音は人それぞれ。15% は急いで手放したい。'}`;
    const loan = price * ltv, r = mortgage;
    const pay = loan > 0 ? loan * r / (1 - Math.pow(1 + r, -25)) : 0;
    const interest = loan * r, principal = pay - interest;
    const rent = s.estRent || s.estYield * s.estimate;
    const cf = rent * 0.92 - 0.01 * s.estimate - interest - principal;
    const cashNeeded = price * (1 - ltv) + price * game.CLOSING_COST;
    const ok = cashNeeded <= state.money.cash;
    ltvHint.textContent = `融資上限 ${Math.round(cap * 100)}%（コミュ力 Lv${lv.comm}、人脈 ${Math.round(state.meters.network)}、年収倍率 8 倍）。金利 ${(r * 100).toFixed(2)}%、25 年元利均等。`;
    prev.innerHTML = '';
    prev.append(
      el('div', { class: 'eyebrow' }, '必要な自己資金（頭金 + 諸費用 7%）'),
      el('div', { class: `big num ${ok ? '' : 'warn'}` }, fmt(cashNeeded), el('span', { class: 'muted', style: 'font-size:12px' }, ` / 手元 ${fmt(state.money.cash)}`)),
      el('div', { class: 'eyebrow', style: 'margin-top:8px' }, '借入'), el('div', { class: 'num' }, `${fmt(loan)}（年 ${fmt(pay)} 返済）`),
      el('div', { class: 'eyebrow', style: 'margin-top:8px' }, '推定キャッシュフロー / 年'),
      el('div', { class: `big num ${cf >= 0 ? 'pos' : 'neg'}` }, `${cf >= 0 ? '+' : ''}${fmt(cf)} `, el('span', { class: `tag ${cf >= 0 ? 'asset' : 'liab'}` }, cf >= 0 ? '資産' : '負債')),
      el('p', { class: 'hint' }, `家賃 ${fmt(rent)} × 0.92 − 維持 1% − 利息 ${fmt(interest)} − 元本 ${fmt(principal)}。${cf < 0 ? 'これはあなたの財布から金を奪う。バフェットが叱る。' : '寝ている間に金が入る。'}`),
      ok ? null : el('p', { class: 'warn', style: 'margin-top:6px' }, '自己資金が足りない。LTV を上げるか提示額を下げる。')
    );
    submit.disabled = !ok || (!existing && decisions.offers.length >= game.MAX_OFFERS);
  };
  bidIn.addEventListener('input', update); ltvIn.addEventListener('input', update);
  ltvIn.value = Math.round(ltv * 100);
  update();
  submit.addEventListener('click', () => {
    if (existing) { existing.bidRatio = bid; existing.ltv = ltv; }
    else decisions.offers.push({ listingId, bidRatio: bid, ltv });
    closeModal(); renderPending(); renderCity();
    toast('good', '買い付け予定', `${s.name} に ${Math.round(bid * 100)}% で提出する。年を終えると結果が出る。`);
  });
  openModal('買い付け', body, [submit], { wide: false });
}

// ───────────────────────── 本棚 ─────────────────────────
function openBooks() {
  const books = availableBooks(state);
  const body = el('div');
  const list = el('div');
  const rebuild = () => {
    list.innerHTML = '';
    const budget = Math.round(decisions.time.reading);
    for (const b of books) {
      const on = decisions.books.includes(b.id);
      const read = (state.flags.booksRead || []).includes(b.id);
      const need = 10 * (decisions.books.length + 1);
      const can = on || (decisions.books.length < game.MAX_BOOKS && budget >= need);
      const why = on ? '' : decisions.books.length >= game.MAX_BOOKS ? '今年はもう 2 冊' : budget < need ? `読書時間 ${need} 必要（今 ${budget}）` : '';
      list.append(el('div', { class: 'book' },
        el('div', { class: 'ttl' }, b.title, el('span', { class: 'au' }, b.author), read ? el('span', { class: 'tag mine', style: 'margin-left:8px' }, '既読') : null),
        el('div', { class: 'desc' }, b.desc),
        el('q', {}, b.quote), b.quoteNote ? el('div', { class: 'qn' }, b.quoteNote) : el('div', { class: 'qn' }, ''),
        el('div', { class: 'act' },
          el('button', { class: 'btn sm ' + (on ? 'on' : 'gold'), disabled: can ? null : 'true', onclick: () => { const i = decisions.books.indexOf(b.id); if (i >= 0) decisions.books.splice(i, 1); else decisions.books.push(b.id); rebuild(); $('books-count').textContent = decisions.books.length ? `(${decisions.books.length})` : ''; } }, on ? '読む予定' : '読む'),
          el('span', { class: 'tags' }, Object.entries(b.xp).map(([k, v]) => `${SKILLS.find(s => s.id === k)?.name || k} +${v}`).join(' ')),
          why ? el('span', { class: 'why' }, why) : null)));
    }
  };
  rebuild();
  body.append(el('p', { class: 'hint', style: 'margin-bottom:8px' }, '本 1 冊 = 読書時間 10。同じ年に買い付けか株の買い増しをすると（学びと実行はセット）XP は 2 倍。読み直しは半分。'), list);
  openModal('本棚', body, [], { wide: true });
}

// ───────────────────────── クオンツ ─────────────────────────
function renderQuant() {
  const q = unlockLevel(state);
  const tabs = $('q-tabs'); tabs.innerHTML = '';
  for (const t of QUANT_TABS) {
    tabs.append(el('button', { class: 'tab', role: 'tab', 'aria-selected': ui.tab === t.id ? 'true' : 'false', onclick: () => { ui.tab = t.id; renderQuant(); } },
      t.label, q < t.need ? el('span', { class: 'lock' }, `Lv${t.lv}`) : null));
  }
  const pane = $('q-pane'); pane.innerHTML = '';
  const t = QUANT_TABS.find(x => x.id === ui.tab);
  if (ui.tab === 'stats') {
    const st = stats(state.history);
    const tiles = el('div', { class: 'tiles' });
    const tile = (l, v, c = '') => tiles.append(el('div', { class: 'tile' }, el('div', { class: `v num ${c}` }, v), el('div', { class: 's' }, l)));
    tile('純資産 CAGR', Number.isFinite(st.cagr) ? pct(st.cagr, 1) : '—', st.cagr >= 0 ? 'pos' : 'neg');
    tile('年率ボラ', Number.isFinite(st.vol) ? pct(st.vol, 1) : '—');
    tile('Sharpe', Number.isFinite(st.sharpe) ? st.sharpe.toFixed(2) : '—');
    tile('最大ドローダウン', pct(st.maxDrawdown || 0, 0), 'neg');
    tile('最悪の年', st.worstYear ? `${st.worstYear.year} ${pct(st.worstYear.ret, 0)}` : '—');
    tile('最良の年', st.bestYear ? `${st.bestYear.year} ${pct(st.bestYear.ret, 0)}` : '—');
    pane.append(tiles, el('p', { class: 'hint', style: 'margin-top:8px' }, '純資産の年次変化から計算。損失年はクオンツ XP +30（損失は授業料）。'));
  } else if (ui.tab === 'kelly') {
    const rets = returnsFromHistory(state.history);
    const k = kelly(rets, state.market.rate);
    const cur = decisions.stockAlloc;
    const verdict = cur > k.full * 1.15 && cur > k.half ? ['over', '過大ベット'] : cur < k.half * 0.6 ? ['under', '過小ベット'] : ['ok', '適正（半 Kelly 圏）'];
    const tiles = el('div', { class: 'tiles' });
    const tile = (l, v) => tiles.append(el('div', { class: 'tile' }, el('div', { class: 'v num' }, v), el('div', { class: 's' }, l)));
    tile(`μ̂（${k.n} 年${k.prior ? '、事前分布と混合' : ''}）`, pct(k.mu, 1)); tile('σ̂', pct(k.sigma, 1)); tile('金利 r', pct(state.market.rate, 2));
    tile('Kelly f* = (μ̂−r)/σ̂²', pct(k.full, 0)); tile('半 Kelly', pct(k.half, 0)); tile('あなたの株式比率', pct(cur, 0));
    pane.append(tiles, el('div', { class: 'kelly-row' }, el('span', { class: `verdict ${verdict[0]}` }, verdict[1]),
      el('span', {}, `推奨は半 Kelly ${pct(Math.max(0, Math.min(1, k.half)), 0)} 前後。フル Kelly は分散が大きすぎて実務では半分にする。`)));
  } else if (ui.tab === 'fan') {
    pane.append(el('canvas', { id: 'cv-fan', class: 'chart' }), el('div', { class: 'chart-meta', id: 'fan-meta' }, el('span', {}, '計算中…')));
    scheduleFan(true);
  } else if (ui.tab === 'eco') {
    pane.append(el('canvas', { id: 'cv-eco', class: 'chart' }));
    const yr = state.market.last;
    pane.append(el('div', { class: 'chart-meta' }, yr
      ? [el('span', {}, 'チャーティスト比率 ', el('b', { class: 'num' }, `${Math.round(yr.wc * 100)}%`)), el('span', {}, '本源価値比 ', el('b', { class: 'num' }, `${yr.x >= 0 ? '+' : ''}${(Math.expm1(yr.x) * 100).toFixed(0)}%`)), el('span', { class: 'muted' }, 'チャーティストが増えるほど反射的ループが強まり、乖離が大きいほど崩壊確率が上がる。')]
      : el('span', { class: 'muted' }, '1 年進めると生態系が見える')));
    requestAnimationFrame(() => drawMarket($('cv-eco'), state.market, { quantLevel: 4, baseYear: game.START_YEAR }));
  }
  if (q < t.need) pane.append(el('div', { class: 'lock-overlay' }, el('b', {}, `クオンツ Lv${t.lv} で解放`), el('span', {}, '株を持つ +8/年、損失年 +30、クオンツ本 +40。無知に気づいたら自分で自分を教育する。')));
}

let fanTimer = null;
function scheduleFan(now = false) {
  clearTimeout(fanTimer);
  fanTimer = setTimeout(() => {
    const cv = $('cv-fan'); if (!cv) return;
    const key = JSON.stringify([state.life.year, decisions.savingsRate, decisions.stockAlloc, decisions.time.fun, state.money.cash]);
    if (ui.mcKey !== key) { ui.mc = monteCarlo(state, decisions, { n: 300, years: game.MAX_AGE - state.life.age, seed: state.seed ^ state.life.year }); ui.mcKey = key; }
    drawFan(cv, ui.mc, { currentAge: state.life.age, ages: ui.mc.ages });
    const m = $('fan-meta'); if (m) {
      const i = ui.mc.p50.length - 1;
      m.innerHTML = `<span>${ui.mc.n} 本のシナリオ</span><span>100 歳時点 中央値 <b>${fmt(ui.mc.p50[i])}</b></span><span>p5 <b>${fmt(ui.mc.p5[i])}</b></span><span>p95 <b>${fmt(ui.mc.p95[i])}</b></span><span>破産確率 <b class="${ui.mc.ruinProb > 0.1 ? 'neg' : ''}">${pct(ui.mc.ruinProb, 1)}</b></span><span class="muted">今の采配を固定して市場モデルを回した分布</span>`;
    }
  }, now ? 30 : 300);
}

// ───────────────────────── 賢人会議 ─────────────────────────
function currentAdvice() {
  if (lastReport?.advice?.length === 3) return lastReport.advice;
  try { return advise(state, { yearResult: state.market.last, quantLevel: unlockLevel(state) }); } catch (e) { fail(e); return []; }
}

function renderCouncil() {
  const box = $('advisors'); box.innerHTML = '';
  const advs = currentAdvice();
  for (const a of ADVISORS) {
    const adv = advs.find(x => x.id === a.id) || { text: '…', focus: '', stance: '' };
    const card = el('div', { class: 'advisor' },
      el('div', { class: 'mono-circle', style: `background:${a.color}` }, a.initial),
      el('div', { class: 'who' }, el('span', { class: 'nm' }, a.name), adv.focus ? el('span', { class: 'focus' }, adv.focus) : null, el('span', { class: 'stance' }, ({ bull: '強気', bear: '弱気', neutral: '中立', life: '人生' })[adv.stance] || '')),
      el('div', { class: 'speech' }, adv.text));
    const deep = ui.deep[a.id];
    if (deep) card.append(el('div', { class: `speech ${deep.err ? 'err' : 'deep'}` }, deep.text));
    if (ui.sample) card.append(el('button', { class: 'btn sm ghost ask', onclick: () => askDeep(a.id) }, deep?.loading ? '考え中…' : 'Claude に深く聞く'));
    box.append(card);
  }
}

async function resolveSample() {
  try {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    const s = await window.claude.use('sample');
    if (s) { ui.sample = s; renderCouncil(); }
  } catch (_) { /* 無ければ非表示のまま */ }
}

async function askDeep(id) {
  if (!ui.sample) return;
  ui.deep[id] = { loading: true, text: '考え中…' }; renderCouncil();
  try {
    const prompt = buildSamplePrompt(id, state, { yearResult: state.market.last, quantLevel: unlockLevel(state) });
    const r = await ui.sample(prompt, { modelTier: 'default' });
    ui.deep[id] = { text: (r && r.text) ? r.text.trim() : '…' };
  } catch (e) {
    const code = e && e.code;
    if (code === 'not_granted') { ui.sample = null; delete ui.deep[id]; }
    else ui.deep[id] = { err: true, text: code === 'rate_limited' ? '少し待ってからもう一度。' : `聞けなかった（${code || 'error'}）。` };
  }
  renderCouncil();
}

// ───────────────────────── ログ・トースト ─────────────────────────
function renderLog() {
  const ul = $('log'); ul.innerHTML = '';
  const items = state.log.slice(-60).reverse();
  for (const l of items) ul.append(el('li', {}, el('span', { class: 'y num' }, l.year), el('span', { class: `k-${l.kind}` }, l.text)));
}

function toast(kind, title, text) {
  const box = $('toasts');
  const t = el('div', { class: `toast ${kind}` }, el('span', { class: 't' }, title), text);
  box.append(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), 6000);
}

// ───────────────────────── 年送り ─────────────────────────
function endYear() {
  if (!state.life.alive || ui.modal) return;
  const nwBefore = netWorth(state);
  if (ui.mode === 'daily' && ui.quick) decisions.offers = quickOffersFor(ui.quickRatio);
  let report;
  try { report = game.endYear(state, decisions); } catch (e) { fail(e); return; }
  lastReport = report;
  decisions = game.defaultDecisions(state);
  if (ui.preset !== 'custom') applyPreset(ui.preset, true);
  ui.deep = {};
  ui.mcKey = '';
  ui.result = { report, nwBefore, nwAfter: netWorth(state), year: state.life.year - 1 };
  const alamo = report.events.some(e => e.kind === 'alamo');
  const after = () => {
    render();
    // トーストは重要度順に最大 4 件: 買い付け結果 → 退職金 → epic → bad → good
    const queue = [];
    for (const o of report.offers) queue.push([o.accepted ? 'epic' : 'bad', o.accepted ? '買い付け成立' : '買い付け却下', `${o.districtName}: ${o.reaction}`]);
    if (report.severance) queue.push(['good', '退職金', `${fmt(report.severance)} が振り込まれた。さて、どうする？`]);
    for (const sev of ['epic', 'bad', 'good']) for (const e of report.events) if (e.severity === sev && e.kind !== 'alamo') queue.push([sev, e.title, e.text]);
    $('toasts').innerHTML = '';
    for (const [k, t, x] of queue.slice(0, ui.mode === 'daily' ? 2 : 4)) toast(k, t, x);
    if (report.offers.some(o => o.accepted)) play('win'); else if (report.yearResult.totalReturn < -0.1) play('lose'); else play('tick');
    game.saveRun(state);
    if (ui.mode === 'daily') { const r = $('d-result'); if (r) r.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }); }
    if (report.death) setTimeout(openReborn, 400);
  };
  if (alamo) showAlamo(after); else after();
}

function showAlamo(done) {
  const root = $('alamo-root');
  const ov = el('div', { class: 'alamo', role: 'alert' }, el('div', { class: 'big' }, 'REMEMBER THE ALAMO'), el('div', { class: 'small' }, '最悪の時が最高の時。エネルギー +40。売主は投げ売りを始めた。'));
  if (reducedMotion()) ov.style.animation = 'none';
  root.append(ov);
  play('alamo');
  setTimeout(() => { ov.remove(); done(); }, 1200);
}

// ───────────────────────── モーダル基盤 ─────────────────────────
function openModal(title, body, footButtons = [], opts = {}) {
  closeModal();
  const box = el('div', { class: 'modal-box' + (opts.wide ? ' wide' : '') },
    el('div', { class: 'modal-head' }, el('h2', {}, title), opts.noClose ? null : el('button', { class: 'modal-x', 'aria-label': '閉じる', onclick: closeModal }, '×')),
    el('div', { class: 'modal-body' }, body),
    footButtons.length || opts.foot ? el('div', { class: 'modal-foot' }, opts.foot || null, el('span', { class: 'spacer' }), ...footButtons) : null);
  const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, el('div', { class: 'modal-backdrop', onclick: () => { if (!opts.noClose) closeModal(); } }), box);
  if (opts.noClose) m.dataset.locked = '1';
  $('modal-root').append(m);
  ui.modal = m;
  const first = box.querySelector('button, input, [tabindex]'); if (first) first.focus();
  return m;
}
function closeModal() { if (ui.modal) { ui.modal.remove(); ui.modal = null; } }

// ───────────────────────── 転生 ─────────────────────────
function confirmReborn() {
  const wrap = $('reborn-wrap');
  wrap.innerHTML = '';
  wrap.append(el('span', { class: 'confirm' }, el('span', { class: 'q' }, '本当に？ 恐れずに次へ。胆力 +100'),
    el('button', { class: 'btn danger sm', onclick: () => { game.endLife(state, 'voluntary'); game.saveRun(state); restoreRebornBtn(); render(); openReborn(); } }, '転生する'),
    el('button', { class: 'btn sm ghost', onclick: restoreRebornBtn }, 'やめる')));
}
function restoreRebornBtn() { const wrap = $('reborn-wrap'); wrap.innerHTML = ''; wrap.append(el('button', { class: 'btn danger', id: 'btn-reborn', onclick: confirmReborn }, '転生する')); }

function openReborn() {
  const score = computeScore(state);
  const sum = lifeSummary(state, score);
  const causeText = { natural: '天寿', illness: '病', bankrupt: '破産', voluntary: '自らの意志' }[state.life.deathCause] || '';
  ui.revealed = 0;
  const body = el('div');
  const grid = el('div', { class: 'reborn-grid' });
  const left = el('div'), right = el('div');
  grid.append(left, right);
  left.append(el('div', { class: 'eyebrow' }, '純資産の軌跡'), el('canvas', { id: 'cv-spark' }));
  const kv = el('dl', { class: 'kv', style: 'margin-top:8px' });
  const add = (k, v) => kv.append(el('dt', {}, k), el('dd', { class: 'num' }, v));
  add('享年', `${sum.age} 歳（${causeText}）`); add('純資産', fmt(sum.netWorth)); add('最高純資産', fmt(sum.peakNetWorth));
  add('買い付け', `${sum.offersMade} 本 / 成立 ${sum.offersAccepted}`); add('物件', `${sum.propertiesOwned ?? state.props.length} 件`); add('アラモ', `${sum.alamoCount} 回`); add('読んだ本', `${Array.isArray(sum.booksRead) ? sum.booksRead.length : (sum.booksRead ?? 0)} 冊`);
  left.append(kv);
  right.append(el('div', { class: 'eyebrow' }, 'スコア'), el('canvas', { id: 'cv-radar' }));
  const row = el('div', { class: 'score-row' });
  for (const [l, v, c] of [['富', score.wealth], ['楽', score.fun], ['学', score.learning], ['縁', score.network], ['自慢', score.brag], ['総合', score.total, 'tot']]) row.append(el('div', { class: c || '' }, el('div', { class: 'l' }, l), el('div', { class: 'v num' }, v)));
  right.append(row);
  body.append(grid, el('div', { class: 'epitaph' }, state.life.epitaph || '—'));
  const newTitles = previewLifeTitles(meta, state, score);
  if (newTitles.length) body.append(el('div', { class: 'titles' }, el('span', { class: 'eyebrow' }, '新しい称号'), ...newTitles.map(t => el('span', { class: 'title-chip', title: t.desc }, t.name))));
  // 失敗を自慢する
  const failures = state.brag.failures || [];
  const list = el('ul', { class: 'failures' });
  const count = el('span', { class: 'brag-count num' }, `自慢ポイント ${state.brag.points}`);
  const bragBtn = el('button', { class: 'btn gold', onclick: () => { if (ui.revealed < failures.length) { list.prepend(el('li', {}, failures[ui.revealed])); ui.revealed++; } if (ui.revealed >= failures.length) { bragBtn.disabled = true; bragBtn.textContent = failures.length ? '全部自慢した' : '自慢する失敗がない。次はもっと賭けろ'; } } }, `失敗を自慢する（${failures.length} 件）`);
  if (!failures.length) { bragBtn.disabled = true; bragBtn.textContent = '自慢する失敗がない。次はもっと賭けろ'; }
  body.append(el('div', { style: 'margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, bragBtn, count), list);
  // ボーナス先
  const radios = el('div', { class: 'radios', style: 'margin-top:12px' });
  let chosen = 'guts';
  for (const s of SKILLS) radios.append(el('label', {}, el('input', { type: 'radio', name: 'brag-skill', value: s.id, checked: s.id === 'guts' ? 'true' : null, onchange: () => { chosen = s.id; } }), `${s.name} Lv${level(state.skills[s.id]?.xp || 0)}`));
  body.append(el('div', { class: 'eyebrow', style: 'margin-top:12px' }, `自慢ポイント × 30 = ${state.brag.points * 30} XP を注ぐスキル`), radios,
    el('p', { class: 'hint', style: 'margin-top:8px' }, 'スキル XP は全部持ち越す。次の人生は 22 歳、現金 300 万、新しい街、新しい市場。'));
  const go = el('button', { class: 'btn primary', onclick: () => {
    const r = game.reincarnate(state, meta, { skillForBrag: chosen });
    meta = r.meta; state = r.state; decisions = game.defaultDecisions(state); lastReport = null; ui.selected = null; ui.deep = {}; ui.mcKey = '';
    closeModal(); render(); game.saveRun(state); play('reborn');
    toast('epic', `第${state.life.n}生`, `転生した。${SKILLS.find(s => s.id === r.bragSkill)?.name} に +${r.bragBonus} XP。スコア ${r.score.total} は殿堂に刻まれた。${r.titles?.length ? `称号: ${r.titles.map(t => t.name).join('・')}` : ''}`);
  } }, '転生する ▶');
  const copyBtn = el('button', { class: 'btn gold', onclick: () => copyText(shareText(score, sum), copyBtn) }, '結果をコピー');
  openModal(`第${state.life.n}生、享年 ${sum.age} 歳`, body, [copyBtn, go], { noClose: true, wide: true });
  requestAnimationFrame(() => {
    try {
      drawSparkline($('cv-spark'), state.history.map(h => h.netWorth), { color: '#D9A441', baseline: 0 });
      drawRadar($('cv-radar'), score);
    } catch (e) { fail(e); }
  });
}

// ───────────────────────── 殿堂 ─────────────────────────
function openHall() {
  const body = el('div');
  body.append(el('div', { class: 'hall-stats' },
    el('div', {}, el('span', { class: 'eyebrow' }, '人生'), el('span', { class: 'v num' }, meta.lives)),
    el('div', {}, el('span', { class: 'eyebrow' }, '最高スコア'), el('span', { class: 'v num gold' }, meta.bestScore)),
    el('div', {}, el('span', { class: 'eyebrow' }, '自慢ポイント累計'), el('span', { class: 'v num' }, meta.bragPoints)),
    el('div', {}, el('span', { class: 'eyebrow' }, '持ち越しスキル'), el('span', { class: 'v num', style: 'font-size:13px' }, SKILLS.map(s => `${s.name}${level(meta.skills[s.id] || 0)}`).join(' ')))));
  const titles = ensureTitles(meta);
  body.append(el('div', { class: 'eyebrow', style: 'margin-bottom:4px' }, `称号 ${titles.length}`), el('div', { class: 'titles', style: 'margin-bottom:12px' }, titles.length ? titles.map(t => el('span', { class: 'title-chip', title: `${t.desc}（第${t.life}生）` }, t.name)) : el('span', { class: 'muted', style: 'font-size:12px' }, 'まだ無い。半額で買え。7 日続けろ。')));
  if (!meta.hallOfFame.length) body.append(el('p', { class: 'list-empty' }, 'まだ誰もいない。最初の人生を生き切れ。'));
  else {
    const t = el('table', { class: 'table' });
    t.append(el('thead', {}, el('tr', {}, ...['生', '享年', 'スコア', '純資産', '死因', '遺言'].map(h => el('th', {}, h)))));
    const tb = el('tbody');
    for (const h of meta.hallOfFame) tb.append(el('tr', {}, el('td', { class: 'num' }, `第${h.life}生`), el('td', { class: 'num' }, h.age), el('td', { class: 'num gold' }, h.score), el('td', { class: 'num' }, fmt(h.netWorth)), el('td', {}, ({ natural: '天寿', illness: '病', bankrupt: '破産', voluntary: '自主' })[h.cause] || ''), el('td', { class: 'ep' }, h.epitaph)));
    t.append(tb);
    body.append(el('div', { class: 'table-wrap' }, t));
  }
  openModal('殿堂', body, [], { wide: true });
}

// ───────────────────────── 遊び方 ─────────────────────────
function openHelp(first) {
  const slides = [
    el('div', { class: 'slide' }, el('h3', {}, '人生はゲーム。死は終わりではない。'), el('ul', {},
      el('li', {}, '1 ターン = 1 年。22 歳、現金 300 万から始まる。時間 100 とお金の配分を決めて「今年を終える」。'),
      el('li', {}, '死ぬか、破産するか、自分で転生を選ぶまで続く。スキル XP は次の人生に全部持ち越す。'),
      el('li', {}, '失敗は自慢ポイントになり、転生時に XP へ変わる。却下された買い付けも、損失も、破産も。'),
      el('li', {}, '暴落の年は「アラモの時」。エネルギー +40、売主は投げ売りを始める。最悪の時が最高の時。'),
      el('li', {}, 'スコア = 富 + 楽 + 学 + 縁 + 自慢。金だけでは勝てない。'))),
    el('div', { class: 'slide' }, el('h3', {}, '価値観がそのままルール'), el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('tbody', {}, ...[
        ['とにかく買い付けを出す', '売主の本音は人それぞれ。15% は急いで手放したい。半額でも通ることがある'],
        ['現地を見る', '偵察で推定誤差が縮み、配達員や工事のおっちゃんが秘密を教えてくれる'],
        ['資産と負債を区別する', '物件はキャッシュフローの符号で「資産」「負債」。負債はバフェットが叱る'],
        ['給料は貯めない', '貯蓄率 = 余剰のうち投資に回す割合。残りは楽しさに変わる。現金は年 0.5% しか増えない'],
        ['無知に気づいたら自己教育', 'クオンツ Lv で統計、Kelly、モンテカルロ扇形図、市場の生態系が見えるようになる'],
        ['ロールモデル思考', '賢人会議が毎年助言する。Artifact 上では Claude が同じ人格で深く答える'],
      ].map(([a, b]) => el('tr', {}, el('td', {}, a), el('td', { class: 'muted' }, b))))))),
    el('div', { class: 'slide' }, el('h3', {}, '操作'), el('ul', {},
      el('li', {}, el('kbd', {}, 'Enter'), ' で年送り、', el('kbd', {}, 'Esc'), ' でモーダルを閉じる。'),
      el('li', {}, '街の地区をクリック → 偵察先に追加（最大 3）→ 売り物に「買い付け」→ 提示額と LTV を決める。年を終えると結果が出る。'),
      el('li', {}, '本棚は読書時間 10 につき 1 冊。同じ年に買い付けか株の買い増しをすると XP 2 倍。'),
      el('li', {}, '不労所得が生活費を超えたら FIRE。会社を辞めて時間が増える。'),
      el('li', {}, '保存は自動（この端末のブラウザ）。「転生する」で恐怖を捨てた者は胆力 +100。'))),
  ];
  let i = 0;
  const body = el('div'); const dots = el('div', { class: 'dots' });
  const show = () => { body.innerHTML = ''; body.append(slides[i]); dots.innerHTML = ''; slides.forEach((_, j) => dots.append(el('i', { class: j === i ? 'on' : '' }))); prev.disabled = i === 0; next.textContent = i === slides.length - 1 ? (first ? '始める ▶' : '閉じる') : '次へ'; };
  const prev = el('button', { class: 'btn', onclick: () => { i = Math.max(0, i - 1); show(); } }, '前へ');
  const next = el('button', { class: 'btn primary', onclick: () => { if (i < slides.length - 1) { i++; show(); } else { closeModal(); if (!meta.tutorialDone) { meta.tutorialDone = true; game.saveMeta(meta); } } } }, '次へ');
  show();
  openModal('遊び方', body, [prev, next], { foot: dots, wide: true });
  if (first && !meta.tutorialDone) { meta.tutorialDone = true; game.saveMeta(meta); }
}

// ───────────────────────── 毎日モード ─────────────────────────
function applyPreset(id, silent = false) {
  const p = PRESETS[id]; if (!p) return;
  ui.preset = id; meta.preset = id;
  decisions.time = { ...p.time };
  decisions.savingsRate = p.savingsRate; decisions.stockAlloc = p.stockAlloc;
  decisions.books = [];
  if (p.books) {
    const read = new Set(state.flags.booksRead || []);
    decisions.books = availableBooks(state).filter(b => !read.has(b.id)).slice(0, p.books).map(b => b.id);
    if (decisions.books.length < p.books) decisions.books = availableBooks(state).slice(0, p.books).map(b => b.id);
  }
  ui.quick = !!p.quick;
  if (p.quick) {
    // 偵察先は安い売り物がある地区を優先
    const cheap = [...state.city.listings].sort((a, b) => a.ask - b.ask).map(l => l.districtId);
    decisions.scoutTargets = [...new Set(cheap)].slice(0, 3);
  }
  markDirty();
  if (!silent) { game.saveMeta(meta); render(); }
}

function quickOffersFor(ratio) {
  const lv = skillLevels(state);
  const income = state.history[state.history.length - 1]?.income || state.work.salary;
  const out = [];
  for (const l of [...state.city.listings].sort((a, b) => a.ask - b.ask)) {
    const price = l.ask * ratio;
    const cap = maxLtv({ commLevel: lv.comm, network: state.meters.network, income, price });
    const need = price * (1 - cap) + price * game.CLOSING_COST;
    if (need <= state.money.cash * 0.95) { out.push({ listingId: l.id, bidRatio: ratio, ltv: cap }); if (out.length >= game.MAX_OFFERS) break; }
  }
  return out;
}

function renderDaily() {
  const today = todayKey();
  const streak = currentStreak(meta, today);
  const done = doneToday(meta, today);
  const st = game.status(state);
  // 上段
  const top = $('d-top'); top.innerHTML = '';
  top.append(el('span', { class: 'streak num' }, `${streak} 日`, el('small', {}, `連続で現実に動いた日${ensureDaily(meta).bestStreak > streak ? `（最長 ${ensureDaily(meta).bestStreak}）` : ''}`)),
    el('span', { class: 'num' }, `第${st.life}生 · ${st.age}歳 · ${fmt(st.netWorth)}`),
    el('span', { class: 'today num' }, today));
  // 今日の現実
  const real = $('d-real'); real.innerHTML = '';
  real.append(el('h2', {}, '今日の現実', el('span', { class: 'cnt num' }, `${done.length} / ${REAL_ACTIONS.length}`), el('span', { class: 'eyebrow' }, 'Real world')));
  for (const a of REAL_ACTIONS) {
    const isDone = done.includes(a.id);
    real.append(el('button', { class: 'real-row' + (isDone ? ' done' : ''), disabled: isDone ? 'true' : null, onclick: () => onRealAction(a) },
      el('span', { class: 'box' }, isDone ? '✓' : ''), el('span', { class: 'lbl' }, a.label), el('span', { class: 'eff' }, a.effect)));
  }
  real.append(el('p', { class: 'hint', style: 'margin-top:8px' }, done.length === REAL_ACTIONS.length ? 'フルコンボ。エネルギー +20。今日は勝ちだ。' : '押した瞬間にゲームへ反映される。1 日 1 回ずつ。6 つ全部でエネルギー +20。嘘をつくと自分が損をするだけ。'));
  // 今年の方針
  const plan = $('d-plan'); plan.innerHTML = '';
  plan.append(el('h2', {}, '今年の方針', el('span', { class: 'cnt num' }, `${state.life.year}年`), el('span', { class: 'eyebrow' }, 'Plan')));
  const grid = el('div', { class: 'presets' });
  for (const [id, p] of Object.entries(PRESETS)) grid.append(el('button', { class: 'preset' + (ui.preset === id ? ' on' : ''), onclick: () => applyPreset(id) }, el('b', {}, p.name), el('span', {}, p.desc)));
  plan.append(grid);
  const counts = { 0.7: quickOffersFor(0.7).length, 0.5: quickOffersFor(0.5).length };
  if (ui.quick && counts[ui.quickRatio] === 0 && counts[0.5] > 0 && ui.quickRatio !== 0.5) ui.quickRatio = 0.5; // 70% で届かなければ半額で出す
  const seg = el('span', { class: 'seg' }, ...[0.7, 0.5].map(r => el('button', { 'aria-pressed': ui.quickRatio === r ? 'true' : 'false', onclick: () => { ui.quickRatio = r; renderDaily(); } }, `${Math.round(r * 100)}%（${counts[r]}）`)));
  const qo = ui.quick ? quickOffersFor(ui.quickRatio) : [];
  plan.append(el('div', { class: 'quick' },
    el('button', { class: 'btn sm ' + (ui.quick ? 'on' : ''), onclick: () => { ui.quick = !ui.quick; if (ui.preset !== 'custom' && !!PRESETS[ui.preset].quick !== ui.quick) customized(); renderDaily(); } }, ui.quick ? `安い売り物 ${qo.length} 本に買い付けを出す` : '安い売り物 3 本に買い付けを出す'),
    seg,
    el('span', { class: 'hint' }, ui.quick ? (qo.length ? `${Math.round(ui.quickRatio * 100)}% で届く売り物が ${qo.length} 件。半額でも常識外でもいい。却下されても学びと自慢になる。` : '今の現金では半額でも届かない。数年貯めるか、フル画面で株を取り崩す。') : '「行動すると事態が動く」を 1 タップで。'),
    el('button', { class: 'btn sm ghost', onclick: () => setMode('full') }, '詳細（フル画面）')));
  const t = decisions.time;
  plan.append(el('p', { class: 'hint', style: 'margin-top:8px' }, `時間: 読書 ${Math.round(t.reading)} · 偵察 ${Math.round(t.scouting)} · 人脈 ${Math.round(t.networking)} · 遊ぶ ${Math.round(t.fun)} · 副業 ${Math.round(t.hustle)} ／ 貯蓄率 ${Math.round(decisions.savingsRate * 100)}% ／ 株式 ${Math.round(decisions.stockAlloc * 100)}%${decisions.books.length ? ` ／ 本 ${decisions.books.length} 冊` : ''}${ui.preset === 'custom' ? ' ／ 手動調整あり' : ''}`));
  // 賢人
  const council = $('d-council'); council.innerHTML = '';
  const advs = currentAdvice();
  const dayIdx = (Math.floor(Date.now() / 86400000) + state.life.year) % ADVISORS.length;
  const show = ui.showAll ? ADVISORS : [ADVISORS[dayIdx]];
  council.append(el('h2', {}, ui.showAll ? '賢人会議' : '今日の賢人', el('span', { class: 'eyebrow' }, 'Council')));
  for (const a of show) {
    const adv = advs.find(x => x.id === a.id) || { text: '…' };
    const row = el('div', { class: 'd-council' }, el('div', { class: 'mono-circle', style: `background:${a.color}` }, a.initial),
      el('div', {}, el('div', { class: 'who' }, el('span', { class: 'nm' }, a.name), adv.focus ? el('span', { class: 'focus' }, adv.focus) : null), el('div', { class: 'speech' }, adv.text)));
    const deep = ui.deep[a.id];
    if (deep) row.lastChild.append(el('div', { class: `speech ${deep.err ? 'err' : 'deep'}` }, deep.text));
    if (ui.sample) row.lastChild.append(el('button', { class: 'btn sm ghost', style: 'margin-top:6px', onclick: () => askDeep(a.id) }, deep?.loading ? '考え中…' : 'Claude に深く聞く'));
    council.append(row);
  }
  council.append(el('button', { class: 'btn sm ghost', style: 'margin-top:8px', onclick: () => { ui.showAll = !ui.showAll; renderDaily(); } }, ui.showAll ? '一人だけにする' : '3 人とも聞く'));
  // 下部の副操作（モバイルではバーから隠れる分）
  const foot = $('d-foot'); foot.innerHTML = '';
  foot.append(el('button', { class: 'btn sm', onclick: openBooks }, `本棚${decisions.books.length ? ` (${decisions.books.length})` : ''}`),
    el('button', { class: 'btn sm', onclick: openHall }, '殿堂'),
    el('button', { class: 'btn sm', onclick: () => openHelp(false) }, '遊び方'),
    el('button', { class: 'btn sm ghost', onclick: () => $('btn-sound').click() }, meta.sound === false ? '音 OFF' : '音 ON'),
    el('button', { class: 'btn sm danger', onclick: () => { confirmReborn(); $('reborn-wrap').scrollIntoView({ block: 'nearest' }); } }, '転生する'));
  // 結果
  const res = $('d-result');
  if (ui.result && ui.result.report) {
    const { report, nwBefore, nwAfter, year } = ui.result;
    const delta = nwAfter - nwBefore;
    res.hidden = false; res.innerHTML = '';
    res.append(el('h2', {}, `${year}年の結果`, el('span', { class: 'eyebrow' }, 'Result')));
    res.append(el('div', { class: `delta num ${delta >= 0 ? 'pos' : 'neg'}` }, `${delta >= 0 ? '+' : ''}${fmt(delta)}`, el('small', {}, `純資産 ${fmt(nwBefore)} → ${fmt(nwAfter)}`)));
    const ul = el('ul');
    const yr = report.yearResult;
    ul.append(el('li', {}, `市場 ${yr.totalReturn >= 0 ? '+' : ''}${(yr.totalReturn * 100).toFixed(1)}%${yr.crash ? '（アラモの時）' : ''}、金利 ${(yr.rate * 100).toFixed(2)}%`));
    if (report.offers.length) ul.append(el('li', {}, `買い付け ${report.offers.length} 本 → 成立 ${report.offers.filter(o => o.accepted).length}。${report.offers.map(o => `${o.districtName} ${Math.round((o.bidRatio || 0) * 100)}% ${o.accepted ? '成立' : '却下'}`).join(' / ')}`));
    if (report.income) ul.append(el('li', {}, `収入 ${fmt(report.income.net + report.income.hustle + (report.income.pension || 0))}、生活費 ${fmt(report.income.living)}、不労所得 ${fmt(report.income.passive || 0)}`));
    for (const e of report.events.filter(e => ['epic', 'bad', 'good'].includes(e.severity)).slice(0, 3)) ul.append(el('li', { class: e.severity === 'bad' ? 'neg' : e.severity === 'epic' ? 'gold' : 'pos' }, `${e.title}: ${e.text}`));
    for (const b of report.books || []) ul.append(el('li', { class: 'gold' }, `読了『${b.title || b.id}』${b.quote ? `「${b.quote}」` : ''}`));
    res.append(ul);
    res.append(el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' },
      el('button', { class: 'btn primary', onclick: endYear, disabled: state.life.alive ? null : 'true' }, 'もう 1 年 ▶'),
      el('button', { class: 'btn ghost', onclick: () => setMode('full') }, 'フル画面で見る')));
  } else {
    res.hidden = false; res.innerHTML = '';
    res.append(el('div', { class: 'big-end' }, el('button', { class: 'btn primary', onclick: endYear, disabled: state.life.alive ? null : 'true' }, '今年を終える ▶')),
      el('p', { class: 'hint', style: 'text-align:center;margin-top:8px' }, '今日の現実にチェックを入れてから、1 年進める。それだけ。'));
  }
}

function onRealAction(a) {
  const r = recordRealAction(meta, state, a.id);
  if (!r.applied) return;
  game.saveMeta(meta); game.saveRun(state);
  play('check');
  toast('good', a.short, a.effect);
  if (r.combo) { toast('epic', 'フルコンボ', 'エネルギー +20。今日は勝ちだ。'); play('win'); }
  const st = awardStreakTitles(meta, r.streak, state.life.n);
  if (st.length) { game.saveMeta(meta); for (const t of st) toast('epic', `称号「${t.name}」`, t.desc); }
  if (r.milestone) streakFlash(r.milestone);
  else if (r.streak > 1 && doneToday(meta).length === 1) toast('epic', `連続 ${r.streak} 日`, '続けた者が勝つ。');
  renderHeader(); renderDaily();
}

function streakFlash(n) {
  const root = $('alamo-root');
  const ov = el('div', { class: 'streak-flash', role: 'alert' }, el('div', { class: 'big' }, `${n} DAYS`), el('div', { class: 'small' }, n >= 100 ? '百日。もう習慣ではなく人格だ。' : n >= 30 ? '三十日。同じ投資・同じ習慣を惰性で続けていないか、今日だけ自問しろ。' : '七日。恐怖を捨てた分だけ楽しめ。'));
  if (reducedMotion()) ov.style.animation = 'none';
  root.append(ov); play('streak');
  setTimeout(() => ov.remove(), 1600);
}

function openLedger() {
  const d = ensureDaily(meta); const today = todayKey();
  const body = el('div');
  body.append(el('div', { class: 'hall-stats' },
    el('div', {}, el('span', { class: 'eyebrow' }, '連続'), el('span', { class: 'v num gold' }, `${currentStreak(meta, today)} 日`)),
    el('div', {}, el('span', { class: 'eyebrow' }, '最長'), el('span', { class: 'v num' }, `${d.bestStreak} 日`)),
    el('div', {}, el('span', { class: 'eyebrow' }, '行動した日'), el('span', { class: 'v num' }, Object.keys(d.days).length)),
    el('div', {}, el('span', { class: 'eyebrow' }, 'フルコンボ'), el('span', { class: 'v num' }, d.comboDays))));
  const heat = el('div', { class: 'heat' });
  for (const day of recentDays(meta, 28, today)) heat.append(el('i', { class: (day.count >= 5 ? 'l3' : day.count >= 3 ? 'l2' : day.count >= 1 ? 'l1' : '') + (day.date === today ? ' today' : ''), title: `${day.date}: ${day.count}` }));
  body.append(el('div', { class: 'eyebrow' }, '直近 28 日'), heat);
  const t = el('table', { class: 'table' });
  t.append(el('thead', {}, el('tr', {}, el('th', {}, '行動'), el('th', {}, '回数'), el('th', {}, 'ゲームへの効果'))));
  const tb = el('tbody');
  for (const a of REAL_ACTIONS) tb.append(el('tr', {}, el('td', {}, a.label), el('td', { class: 'num' }, d.totals[a.id] || 0), el('td', { class: 'muted' }, a.effect)));
  t.append(tb); body.append(el('div', { class: 'table-wrap' }, t));
  body.append(el('p', { class: 'hint', style: 'margin-top:10px' }, 'これが実社会での検証記録。買い付けの本数、現地を見た回数、与えた回数。数字が出ていない価値観は、まだ行動になっていない。'));
  const copyBtn = el('button', { class: 'btn gold', onclick: () => copyText(ledgerText(meta, today), copyBtn) }, '台帳をコピー');
  openModal('実績台帳', body, [copyBtn], { wide: true });
}

function shareText(score, sum) {
  const cause = { natural: '天寿', illness: '病', bankrupt: '破産', voluntary: '自主転生' }[state.life.deathCause] || '';
  return [`転生クオンツ 第${state.life.n}生｜享年 ${sum.age}歳（${cause}）｜純資産 ${fmt(sum.netWorth)}`,
    `スコア ${score.total}（富 ${score.wealth} 楽 ${score.fun} 学 ${score.learning} 縁 ${score.network} 自慢 ${score.brag}）`,
    `買い付け ${sum.offersMade} 本／成立 ${sum.offersAccepted}｜アラモ ${sum.alamoCount} 回｜遺言「${state.life.epitaph || ''}」`,
    `称号 ${[...ensureTitles(meta).map(t => t.name), ...previewLifeTitles(meta, state, score).map(t => t.name)].join('・') || 'なし'}`,
    `現実の連続行動 ${currentStreak(meta)} 日｜seed ${state.seed}`].join('\n');
}

function copyText(text, btn) {
  const ok = () => { if (btn) { const t = btn.textContent; btn.textContent = 'コピーした'; setTimeout(() => { btn.textContent = t; }, 1500); } };
  const fallback = () => {
    const ta = el('textarea', { readonly: 'true', style: 'width:100%;height:120px;background:var(--surface2);color:var(--text);border:1px solid var(--rule);font-family:var(--font-num);font-size:12px;padding:8px' });
    ta.value = text; const wrap = el('div', {}, el('p', { class: 'hint', style: 'margin-bottom:6px' }, 'クリップボードに書けなかった。全選択してコピーしてほしい。'), ta);
    (ui.modal ? ui.modal.querySelector('.modal-body') : document.body).append(wrap); ta.focus(); ta.select();
  };
  try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (_) { fallback(); }
}

// ───────────────────────── 起動 ─────────────────────────
try { boot(); } catch (e) { fail(e); }
