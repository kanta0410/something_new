// app.js — 転生クオンツ UI の入口。状態を持ち、render() で各パネルを更新する。
import * as game from '../engine/game.js';
import { advise } from '../engine/council.js';
import { $, $$, esc, fmt, setText, reducedMotion, debounce, sleep } from './panels/dom.js';
import * as decisionsPanel from './panels/decisions.js';
import * as center from './panels/center.js';
import * as city from './panels/city.js';
import * as quant from './panels/quant.js';
import * as council from './panels/council.js';
import * as offer from './panels/offer.js';
import * as books from './panels/books.js';
import * as reborn from './panels/reborn.js';

const app = {
  meta: null,
  state: null,
  decisions: null,
  status: null,
  levels: null,
  quantLevel: 0,
  advice: [],
  ui: {
    selected: null, hover: null, blink: true, quantTab: 'stats', mc: null, mcSchedule: null,
    deep: {}, sample: undefined, bragRevealed: 0, bragSkill: 'guts', helpSlide: 0, busy: false,
  },
  modals: [],
  render, onDecisionsChanged, openModal, closeModal, toast, reincarnate,
};

/* ───────── 描画 ───────── */

function refreshStatus() {
  app.status = game.status(app.state);
  app.levels = app.status.levels;
  app.quantLevel = app.status.quantLevel;
}

function render() {
  refreshStatus();
  renderHeader();
  decisionsPanel.render(app);
  center.render(app);
  city.render(app);
  quant.render(app);
  council.render(app);
  renderBar();
}

function renderHeader() {
  const s = app.status;
  setText($('#h-life'), `第${s.life}生`);
  setText($('#h-age'), s.age);
  setText($('#h-year'), s.year);
  setText($('#h-nw'), fmt(s.netWorth));
  $('#h-nw').className = `num ${s.netWorth < 0 ? 'neg' : ''}`;
  setText($('#h-score'), Math.round(s.score));
  const chip = $('#h-regime');
  setText(chip, s.regime);
  chip.className = `chip r-${s.regime}`;
  setText($('#h-seed'), app.state.seed);
  document.title = `転生クオンツ — 第${s.life}生 ${s.age}歳 / ${fmt(s.netWorth)}`;
}

function renderBar() {
  const alive = app.state.life.alive;
  const end = $('#btn-end');
  setText(end, alive ? '今年を終える ▶' : '転生する ▶');
  setText($('#books-count'), app.decisions.books.length ? `${app.decisions.books.length}/${game.MAX_BOOKS}` : '');
  $('#btn-reborn').disabled = !alive;
}

/** 采配が変わったとき: 軽い再描画だけ。 */
function onDecisionsChanged(what) {
  decisionsPanel.render(app);
  if (what === 'scout' || what === 'offers' || what === 'sells') { city.draw(app); city.renderDistrict(app); }
  city.renderLists(app);
  quant.onDecisionsChanged(app);
  renderBar();
}

function redrawCanvases() {
  center.redraw(app);
  city.draw(app);
  quant.redraw(app);
  reborn.drawRebornCanvases(app);
}

/* ───────── モーダル ───────── */

function openModal(id, focusSel) {
  const m = document.getElementById(id);
  if (!m) return;
  if (!app.modals.includes(id)) app.modals.push(id);
  m.hidden = false;
  const target = (focusSel && m.querySelector(focusSel)) || m.querySelector('.modal-body button:not(:disabled), .modal-foot button:not(:disabled), .modal-body input, .modal-x');
  if (target) try { target.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m || m.hidden) return;
  m.hidden = true;
  app.modals = app.modals.filter((x) => x !== id);
  if (id === 'm-help' && !app.meta.tutorialDone) {
    app.meta.tutorialDone = true;
    game.saveMeta(app.meta);
  }
}

function topModal() { return app.modals.length ? app.modals[app.modals.length - 1] : null; }

/* ───────── トースト ───────── */

function toast(text, kind = 'info', title = '') {
  const box = $('#toasts');
  while (box.children.length >= 4) box.removeChild(box.firstChild);
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${title ? `<span class="t">${esc(title)}</span>` : ''}${esc(text)}`;
  box.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
}

/* ───────── 年送り ───────── */

async function showAlamo() {
  const el = $('#alamo');
  el.hidden = false;
  await sleep(1200);
  el.hidden = true;
}

async function endYear() {
  if (app.ui.busy) return;
  if (!app.state.life.alive) { reborn.openReborn(app); return; }
  app.ui.busy = true;
  $('#btn-end').disabled = true;
  try {
    const report = game.endYear(app.state, app.decisions);
    if (report.events.some((e) => e.kind === 'alamo')) await showAlamo();
    app.decisions = game.defaultDecisions(app.state);
    app.advice = report.advice || [];
    app.ui.deep = {};
    app.ui.mc = null;
    if (app.ui.selected != null && !app.state.city.districts[app.ui.selected]) app.ui.selected = null;
    render();
    for (const e of report.events) {
      if (e.severity === 'good' || e.severity === 'bad' || e.severity === 'epic') toast(e.text, e.severity, e.title);
    }
    for (const o of report.offers) {
      const name = o.districtName || '';
      if (o.skipped) toast(`${name}: ${o.reaction}`, 'bad', '買い付け');
      else if (o.accepted) toast(`${name}を ${fmt(o.price)} で取得。${o.reaction}`, 'epic', '買い付け通過');
      else toast(`${name}への買い付けは却下。${o.reaction}`, 'bad', '買い付け却下');
    }
    game.saveRun(app.state);
    if (report.death) reborn.openReborn(app);
  } finally {
    app.ui.busy = false;
    $('#btn-end').disabled = false;
  }
}

/* ───────── 転生 ───────── */

function reincarnate(skillForBrag) {
  const res = game.reincarnate(app.state, app.meta, { skillForBrag });
  app.meta = res.meta;
  app.state = res.state;
  app.decisions = game.defaultDecisions(app.state);
  app.advice = safeAdvice();
  app.ui.selected = null; app.ui.hover = null; app.ui.mc = null; app.ui.deep = {};
  closeModal('m-reborn');
  closeModal('m-hall');
  render();
  game.saveRun(app.state);
  toast(`第${app.state.life.n}生、開始。${res.bragBonus > 0 ? `自慢ポイント ${res.bragBonus / 30} × 30 XP を${game.SKILLS.find((s) => s.id === res.bragSkill)?.name || ''}へ。` : ''}`, 'epic', '転生');
}

function voluntaryReborn() {
  if (!app.state.life.alive) { reborn.openReborn(app); return; }
  game.endLife(app.state, 'voluntary');
  game.saveRun(app.state);
  render();
  reborn.openReborn(app);
}

function safeAdvice() {
  try { return advise(app.state, { yearResult: app.state.market.last, quantLevel: app.quantLevel }); } catch (_) { return []; }
}

/* ───────── 入力 ───────── */

function bindGlobal() {
  $('#btn-end').addEventListener('click', endYear);
  $('#btn-city').addEventListener('click', () => { city.renderListingsModal(app); openModal('m-listings'); });
  $('#btn-books').addEventListener('click', () => books.open(app));
  $('#btn-hall').addEventListener('click', () => reborn.openHall(app));
  $('#btn-help').addEventListener('click', () => reborn.openHelp(app));
  const confirmBox = $('#reborn-confirm');
  $('#btn-reborn').addEventListener('click', () => { confirmBox.hidden = false; $('#btn-reborn').hidden = true; $('#btn-reborn-no').focus(); });
  $('#btn-reborn-no').addEventListener('click', () => { confirmBox.hidden = true; $('#btn-reborn').hidden = false; $('#btn-reborn').focus(); });
  $('#btn-reborn-yes').addEventListener('click', () => { confirmBox.hidden = true; $('#btn-reborn').hidden = false; voluntaryReborn(); });

  for (const m of $$('.modal')) {
    m.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal(m.id);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const t = topModal();
      if (t) { e.preventDefault(); closeModal(t); }
      else if (!confirmBox.hidden) { confirmBox.hidden = true; $('#btn-reborn').hidden = false; }
      return;
    }
    if (e.key === 'Enter' && !topModal() && !e.isComposing) {
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'checkbox', 'radio'].includes(t.type))) return;
      if (t && t.id === 'cv-city') return;
      e.preventDefault();
      endYear();
    }
  });
  window.addEventListener('resize', debounce(redrawCanvases, 150));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawCanvases()).catch(() => {});
}

/* ───────── 起動 ───────── */

function init() {
  app.meta = game.loadMeta();
  app.state = game.loadRun() || game.newGame(app.meta);
  app.decisions = game.defaultDecisions(app.state);
  refreshStatus();
  app.advice = safeAdvice();

  decisionsPanel.init(app);
  city.init(app);
  quant.init(app);
  council.init(app);
  offer.init(app);
  books.init(app);
  reborn.init(app);
  bindGlobal();
  render();
  council.resolveSample(app);

  if (!app.state.life.alive) reborn.openReborn(app);
  if (!app.meta.tutorialDone) reborn.openHelp(app);
  window.__app = app;
}

try {
  init();
} catch (err) {
  const b = document.getElementById('error-banner');
  if (b) {
    b.hidden = false;
    b.textContent = `起動に失敗した: ${err && err.message ? err.message : err}\n${err && err.stack ? err.stack : ''}`;
  }
  console.error(err);
}
