// quant.js — クオンツ画面: 統計 / Kelly / 扇形図 / 生態系（unlockLevel でゲート）
import { kelly, stats, monteCarlo, returnsFromHistory } from '../../engine/quant.js';
import { drawFan, drawMarket } from '../charts.js';
import { $, $$, esc, fmt, pct, spct, setHTML, setText, show, debounce } from './dom.js';

const TABS = [
  { id: 'stats', need: 1, lv: 1 },
  { id: 'kelly', need: 2, lv: 3 },
  { id: 'fan', need: 3, lv: 5 },
  { id: 'eco', need: 4, lv: 7 },
];

export function init(app) {
  $('#q-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    app.ui.quantTab = b.dataset.tab;
    render(app);
  });
  app.ui.mcSchedule = debounce(() => { app.ui.mc = null; if (isFanVisible(app)) renderFan(app); }, 300);
}

function isFanVisible(app) {
  return app.ui.quantTab === 'fan' && app.quantLevel >= 3;
}

/** 采配が変わったら扇形図を 300 ms 後に再計算（表示中のときだけ）。 */
export function onDecisionsChanged(app) {
  if (isFanVisible(app)) app.ui.mcSchedule();
  else app.ui.mc = null;
}

export function render(app) {
  const cur = app.ui.quantTab;
  const lvQ = app.levels.quant;
  setText($('#q-lv'), `Lv${lvQ} · 解放 ${app.quantLevel}/4`);
  for (const t of TABS) {
    const b = $(`#tab-${t.id}`);
    const locked = app.quantLevel < t.need;
    b.setAttribute('aria-selected', cur === t.id ? 'true' : 'false');
    setHTML(b, `${t.id === 'stats' ? '統計' : t.id === 'kelly' ? 'Kelly' : t.id === 'fan' ? '扇形図' : '生態系'}${locked ? `<span class="lock">Lv${t.lv}</span>` : ''}`);
    show($(`#pane-${t.id}`), cur === t.id);
  }
  const tab = TABS.find((t) => t.id === cur) || TABS[0];
  const locked = app.quantLevel < tab.need;
  const lock = $('#q-lock');
  if (locked) {
    setHTML(lock, `<b>クオンツ Lv${tab.lv}で解放</b><span>いま Lv${lvQ}。損失の年 +30 XP、クオンツ系の本 +60、株を持つ年 +8。</span>`);
    show(lock, true);
    return;
  }
  show(lock, false);
  if (cur === 'stats') renderStats(app);
  else if (cur === 'kelly') renderKelly(app);
  else if (cur === 'fan') renderFan(app);
  else if (cur === 'eco') renderEco(app);
}

function tile(label, value, sub = '', cls = '') {
  return `<div class="tile"><div class="eyebrow">${esc(label)}</div><div class="v num ${cls}">${esc(value)}</div>${sub ? `<div class="s num">${esc(sub)}</div>` : ''}</div>`;
}

function renderStats(app) {
  const s = stats(app.state.history);
  const few = s.years < 3;
  setHTML($('#pane-stats'), `
    <div class="tiles">
      ${tile('CAGR', pct(s.cagr), `${s.years} 年`, s.cagr >= 0 ? 'pos' : 'neg')}
      ${tile('年率 vol', pct(s.vol))}
      ${tile('Sharpe', s.sharpe.toFixed(2), 'r = 1%')}
      ${tile('最大ドローダウン', pct(s.maxDrawdown), '', s.maxDrawdown > 0.3 ? 'neg' : '')}
      ${tile('最悪の年', s.worstYear ? spct(s.worstYear.ret) : '—', s.worstYear ? `${s.worstYear.year} 市場 ${spct(s.worstYear.marketReturn, 0)}` : '', 'neg')}
      ${tile('最良の年', s.bestYear ? spct(s.bestYear.ret) : '—', s.bestYear ? `${s.bestYear.year} 市場 ${spct(s.bestYear.marketReturn, 0)}` : '', 'pos')}
    </div>
    <p class="hint" style="margin-top:8px">${few ? 'まだ数年。統計は当てにならない。運を実力と混同するな。' : '純資産ベース。市場だけでなく、給与・家賃・あなたの采配も入っている。'}</p>`);
}

function renderKelly(app) {
  const { state, decisions } = app;
  const k = kelly(returnsFromHistory(state.history), state.market.rate);
  const alloc = decisions.stockAlloc;
  let verdict, cls, why;
  if (alloc > Math.max(0, k.full) + 1e-9) { verdict = '過大ベット'; cls = 'over'; why = 'フル Kelly を超えている。破滅の裾が太い。'; }
  else if (alloc < Math.max(0, k.half) * 0.5) { verdict = '過小ベット'; cls = 'under'; why = 'ハーフ Kelly の半分にも届かない。複利が遊んでいる。'; }
  else { verdict = '適正'; cls = 'ok'; why = 'ハーフ〜フル Kelly の範囲。増やすより続けろ。'; }
  setHTML($('#pane-kelly'), `
    <div class="tiles">
      ${tile('μ̂ 期待リターン', pct(k.mu), k.prior ? `履歴 ${k.n} 年 + 事前分布` : `履歴 ${k.n} 年`)}
      ${tile('σ̂ 年率 vol', pct(k.sigma))}
      ${tile('f* フル Kelly', pct(k.full, 0), `(μ̂ − r) / σ̂²、r = ${pct(state.market.rate, 1)}`, 'gold')}
      ${tile('ハーフ Kelly', pct(k.half, 0), '実務ではこちら')}
    </div>
    <div class="kelly-row">
      <span>いまの株式比率 <b class="num" style="font-size:16px">${esc(pct(alloc, 0))}</b></span>
      <span class="verdict ${cls}">${esc(verdict)}</span>
      <span class="hint">${esc(why)}</span>
    </div>
    <p class="hint" style="margin-top:6px">Kelly は「破産しない最速の複利」。推定誤差があるからフルは危険、ハーフが定石。上限 100% はレバレッジ無しの制約。</p>`);
}

function mcKey(app) {
  const d = app.decisions;
  return `${app.state.life.year}|${app.state.history.length}|${JSON.stringify(d.time)}|${d.savingsRate}|${d.stockAlloc}|${d.offers.length}|${d.sells.length}|${d.quitJob}`;
}

function ensureMc(app) {
  const key = mcKey(app);
  if (app.ui.mc && app.ui.mc.key === key) return app.ui.mc.data;
  const data = monteCarlo(app.state, app.decisions, { n: 300 });
  app.ui.mc = { key, data };
  return data;
}

function at(mc, age) {
  const ages = Array.isArray(mc.ages) && mc.ages.length ? mc.ages : mc.years;
  const i = ages.findIndex((a) => a >= age);
  return i < 0 ? null : { p5: mc.p5[i], p50: mc.p50[i], p95: mc.p95[i], age: ages[i] };
}

function renderFan(app) {
  const mc = ensureMc(app);
  drawFan($('#cv-fan'), mc, { currentAge: app.state.life.age, ages: mc.ages });
  const a60 = at(mc, 60);
  const aEnd = at(mc, 100);
  const parts = [
    `破産確率 <b class="num ${mc.ruinProb > 0.1 ? 'neg' : ''}">${esc(pct(mc.ruinProb))}</b>`,
    `経路 <b class="num">${mc.n}</b>`,
  ];
  if (a60) parts.push(`${a60.age}歳 中央値 <b class="num">${esc(fmt(a60.p50))}</b> <span class="muted num">(p5 ${esc(fmt(a60.p5))} / p95 ${esc(fmt(a60.p95))})</span>`);
  if (aEnd && (!a60 || aEnd.age !== a60.age)) parts.push(`${aEnd.age}歳 中央値 <b class="num">${esc(fmt(aEnd.p50))}</b>`);
  setHTML($('#fan-meta'), parts.map((p) => `<span>${p}</span>`).join('') + '<span class="hint">いまの采配を固定して市場モデルを回した分布。采配を変えると 0.3 秒後に更新。</span>');
}

function renderEco(app) {
  const { state } = app;
  drawMarket($('#cv-eco'), state.market, { quantLevel: 4, baseYear: 2026 });
  const wc = Number(state.market.wc) || 0;
  const x = (Number(state.market.p) || 0) - (Number(state.market.f) || 0);
  const who = wc > 0.65 ? 'チャーティストが支配。トレンドは自己強化するが、反転は速い。' : wc < 0.35 ? 'ファンダメンタリストが支配。価格は本源価値に引き戻される。' : '拮抗。どちらが儲けたかで来年のシェアが動く。';
  const val = x > 0.35 ? 'バブル圏。' : x > 0.1 ? '割高。' : x < -0.25 ? '底値圏。貪欲に。' : x < -0.1 ? '割安。' : 'ほぼ本源価値。';
  setHTML($('#eco-meta'), `
    <span>チャーティスト比率 wc <b class="num">${esc(pct(wc, 0))}</b></span>
    <span>乖離 x <b class="num">${esc((x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2))}</b> <span class="muted">(${esc(spct(Math.exp(x) - 1, 0))} vs 本源価値)</span></span>
    <span class="hint">${esc(who)} ${esc(val)}</span>`);
}

/** リサイズ時: 表示中のキャンバスだけ描き直す。 */
export function redraw(app) {
  if (app.quantLevel < 3) return;
  if (app.ui.quantTab === 'fan' && app.ui.mc) drawFan($('#cv-fan'), app.ui.mc.data, { currentAge: app.state.life.age, ages: app.ui.mc.data.ages });
  else if (app.ui.quantTab === 'eco' && app.quantLevel >= 4) drawMarket($('#cv-eco'), app.state.market, { quantLevel: 4, baseYear: 2026 });
}
