// decisions.js — 左カラム「今年の采配」: 時間配分、貯蓄率/株式比率、スキル、メーター、FIRE
import { SKILLS, level, nextLevelXp, levelThreshold } from '../../engine/skills.js';
import { computeIncome } from '../../engine/life.js';
import { $, esc, fmt, setText, setHTML, clamp } from './dom.js';

const TIME_KEYS = ['reading', 'scouting', 'networking', 'fun', 'hustle'];
const TIME_ROWS = [
  { id: 'reading', label: '読書', cap: '読書 XP +1/時間、学び +0.3/時間。本 1 冊に 10 必要' },
  { id: 'scouting', label: '偵察', cap: '地域知 XP +1/時間。10 ごとに偵察 1 回、推定誤差が縮み秘密が見つかる' },
  { id: 'networking', label: '人脈', cap: 'コミュ力 XP +1/時間、人脈 +0.5/時間。LTV と買い付け通過率が上がる' },
  { id: 'fun', label: '遊ぶ', cap: '楽しさ +0.6/時間。生活費 +1.2万/時間' },
  { id: 'hustle', label: '副業', cap: '副業収入 (0.4 + 0.08×(読書Lv+コミュ力Lv)) 万/時間' },
];
const METERS = [
  { id: 'fun', label: '楽しさ', cls: 'pos' },
  { id: 'energy', label: 'エネルギー', cls: 'acc' },
  { id: 'network', label: '人脈', cls: '' },
];

/**
 * key を value にし、他の 4 つを比例配分して合計 100 の整数にする。
 * @param {Record<string, number>} time
 */
export function rebalance(time, key, value) {
  const v = clamp(Math.round(Number(value) || 0), 0, 100);
  const others = TIME_KEYS.filter((k) => k !== key);
  const rest = 100 - v;
  const sum = others.reduce((s, k) => s + Math.max(0, Number(time[k]) || 0), 0);
  const raw = {};
  for (const k of others) raw[k] = sum > 0 ? (Math.max(0, Number(time[k]) || 0) * rest) / sum : rest / others.length;
  // 最大剰余法で整数化（合計 = rest）
  const floors = {};
  let used = 0;
  for (const k of others) { floors[k] = Math.floor(raw[k]); used += floors[k]; }
  const order = [...others].sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
  for (let i = 0; i < rest - used; i++) floors[order[i % order.length]] += 1;
  for (const k of others) time[k] = floors[k];
  time[key] = v;
  return time;
}

export function init(app) {
  const rows = $('#time-rows');
  rows.innerHTML = TIME_ROWS.map((r) => `
    <div class="time-row">
      <label class="lbl" for="t-${r.id}">${esc(r.label)}</label>
      <input type="range" id="t-${r.id}" data-key="${r.id}" min="0" max="100" step="1" value="20" aria-describedby="cap-${r.id}">
      <span class="num val" id="tv-${r.id}">20</span>
      <span class="cap" id="cap-${r.id}">${esc(r.cap)}</span>
    </div>`).join('');
  rows.addEventListener('input', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || !inp.dataset.key) return;
    rebalance(app.decisions.time, inp.dataset.key, inp.value);
    app.onDecisionsChanged('time');
  });

  $('#sl-savings').addEventListener('input', (e) => {
    app.decisions.savingsRate = clamp(Number(e.target.value) / 100, 0, 0.8);
    app.onDecisionsChanged('money');
  });
  $('#sl-stock').addEventListener('input', (e) => {
    app.decisions.stockAlloc = clamp(Number(e.target.value) / 100, 0, 1);
    app.onDecisionsChanged('money');
  });
  $('#ck-fire').addEventListener('change', (e) => {
    app.decisions.quitJob = !!e.target.checked;
    app.onDecisionsChanged('fire');
  });

  $('#skills').innerHTML = SKILLS.map((s) => `
    <li class="skill" title="${esc(s.desc)}\n${esc(s.howTo)}">
      <span>${esc(s.name)} <span class="lv num" id="sk-lv-${s.id}"></span></span>
      <span class="bar"><i id="sk-bar-${s.id}"></i></span>
      <span class="xp num" id="sk-xp-${s.id}"></span>
    </li>`).join('');
  $('#meters').innerHTML = METERS.map((m) => `
    <div class="meter">
      <span>${esc(m.label)}</span>
      <span class="bar ${m.cls}"><i id="mt-bar-${m.id}"></i></span>
      <span class="v num" id="mt-v-${m.id}"></span>
    </div>`).join('') + `
    <div class="meter"><span>学び</span><span class="hint">累積</span><span class="v num" id="mt-v-learning"></span></div>`;
}

function setRange(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (document.activeElement === el && el.matches(':active')) return; // ドラッグ中は触らない
  const v = String(Math.round(value));
  if (el.value !== v) el.value = v;
}

export function render(app) {
  const { state, decisions, status } = app;
  const t = decisions.time;
  let total = 0;
  for (const k of TIME_KEYS) {
    const v = Math.round(Number(t[k]) || 0);
    total += v;
    setRange(`t-${k}`, v);
    setText($(`#tv-${k}`), v);
  }
  setText($('#time-total'), total);

  setRange('sl-savings', decisions.savingsRate * 100);
  setRange('sl-stock', decisions.stockAlloc * 100);
  setText($('#savings-val'), `${Math.round(decisions.savingsRate * 100)}%`);
  setText($('#stock-val'), `${Math.round(decisions.stockAlloc * 100)}%`);

  // 生きた見積もり
  try {
    const inc = computeIncome(state, decisions);
    const surplus = inc.net + inc.hustle - inc.living;
    if (surplus > 0) {
      const invest = surplus * decisions.savingsRate;
      setText($('#savings-live'), ` 余剰 ${fmt(surplus)} → 投資 ${fmt(invest)} / 遊興 ${fmt(surplus - invest)}`);
    } else {
      setText($('#savings-live'), ` 余剰なし（${fmt(surplus)}）: 現金から補填`);
    }
    const liq = Math.max(0, state.money.cash + state.money.stocks);
    setText($('#stock-live'), ` 目標 株 ${fmt(liq * decisions.stockAlloc)} / 現金 ${fmt(liq * (1 - decisions.stockAlloc))}`);
  } catch (_) { /* 表示だけ */ }

  for (const s of SKILLS) {
    const xp = Number(state.skills?.[s.id]?.xp) || 0;
    const lv = level(xp);
    const lo = levelThreshold(lv);
    const hi = nextLevelXp(xp);
    const p = lv >= 10 ? 1 : hi > lo ? clamp((xp - lo) / (hi - lo), 0, 1) : 0;
    setText($(`#sk-lv-${s.id}`), `Lv${lv}`);
    setText($(`#sk-xp-${s.id}`), lv >= 10 ? 'MAX' : `${Math.round(xp)}/${hi}`);
    const bar = $(`#sk-bar-${s.id}`);
    if (bar) bar.style.width = `${(p * 100).toFixed(1)}%`;
  }
  for (const m of METERS) {
    const v = clamp(Number(state.meters?.[m.id]) || 0, 0, 100);
    const bar = $(`#mt-bar-${m.id}`);
    if (bar) bar.style.width = `${v.toFixed(1)}%`;
    setText($(`#mt-v-${m.id}`), Math.round(v));
  }
  setText($('#mt-v-learning'), Math.round(Number(state.meters?.learning) || 0));

  // FIRE
  const ck = $('#ck-fire');
  const lbl = $('#fire-label');
  const fired = !!state.flags?.fired || !state.work?.employed;
  const can = !fired && status.passive > status.living;
  ck.disabled = !can;
  lbl.classList.toggle('off', !can);
  if (ck.checked !== !!decisions.quitJob) ck.checked = !!decisions.quitJob;
  const info = fired
    ? `退職済み。不労所得 ${fmt(status.passive)} / 生活費 ${fmt(status.living)}`
    : `不労所得 ${fmt(status.passive)} ${status.passive > status.living ? '>' : '<'} 生活費 ${fmt(status.living)}${can ? '' : ' — 不労所得が生活費を超えると可能'}`;
  setText($('#fire-info'), info);
}
