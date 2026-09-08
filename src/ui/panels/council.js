// council.js — 賢人会議（3 カード + 「深く聞く」）とログ
import { ADVISORS, buildSamplePrompt } from '../../engine/council.js';
import { $, esc, setHTML } from './dom.js';

const STANCE = { bull: '強気', bear: '弱気', neutral: '中立', life: '人生' };

export function init(app) {
  $('#council').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ask]');
    if (b) deepAsk(app, b.dataset.ask);
  });
}

/** window.claude.use('sample') を遅延で 1 回だけ解決する（描画を止めない）。 */
export function resolveSample(app) {
  if (app.ui.sample !== undefined) return;
  app.ui.sample = null;
  setTimeout(async () => {
    try {
      const use = typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function' ? window.claude.use.bind(window.claude) : null;
      if (!use) return;
      const s = await use('sample');
      if (!s) return;
      const fn = typeof s === 'function' ? s : typeof s.sample === 'function' ? s.sample.bind(s) : null;
      if (!fn) return;
      app.ui.sample = fn;
      render(app);
    } catch (_) { /* 無ければ非表示のまま */ }
  }, 0);
}

async function deepAsk(app, id) {
  const fn = app.ui.sample;
  if (!fn) return;
  const d = app.ui.deep;
  if (d[id]?.status === 'loading') return;
  d[id] = { status: 'loading', text: '' };
  render(app);
  try {
    const prompt = buildSamplePrompt(id, app.state, { yearResult: app.state.market.last, quantLevel: app.quantLevel });
    const res = await fn(prompt, { modelTier: 'default' });
    const text = (res && typeof res === 'object' ? res.text : typeof res === 'string' ? res : '') || '';
    d[id] = { status: 'done', text: String(text).trim() || '（沈黙）' };
  } catch (err) {
    const code = err && (err.code || err.name);
    if (code === 'rate_limited') d[id] = { status: 'error', text: '少し待ってからもう一度' };
    else if (code === 'not_granted') { app.ui.sample = null; d[id] = { status: 'idle', text: '' }; }
    else d[id] = { status: 'error', text: `聞けなかった: ${String(err && err.message ? err.message : err).slice(0, 60)}` };
  }
  render(app);
}

export function render(app) {
  const advice = Array.isArray(app.advice) ? app.advice : [];
  const canAsk = typeof app.ui.sample === 'function';
  setHTML($('#council'), ADVISORS.map((a) => {
    const v = advice.find((x) => x.id === a.id);
    const deep = app.ui.deep[a.id];
    let extra = '';
    if (deep && deep.status === 'loading') extra = '<p class="speech err">考え中…</p>';
    else if (deep && deep.status === 'done') extra = `<p class="speech deep">${esc(deep.text)}</p>`;
    else if (deep && deep.status === 'error') extra = `<p class="speech err">${esc(deep.text)}</p>`;
    return `
      <article class="advisor" aria-label="${esc(a.name)}">
        <div class="mono-circle" style="background:${esc(a.color)}" aria-hidden="true">${esc(a.initial)}</div>
        <div class="who">
          <span class="nm">${esc(a.name)}</span>
          ${v ? `<span class="focus">${esc(v.focus)}</span><span class="stance">${esc(STANCE[v.stance] || v.stance || '')}</span>` : ''}
        </div>
        <p class="speech">${esc(v ? v.text : '……（今年はまだ何も言っていない）')}</p>
        ${extra}
        ${canAsk ? `<button class="btn sm ask" data-ask="${esc(a.id)}" ${deep && deep.status === 'loading' ? 'disabled' : ''}>深く聞く</button>` : ''}
      </article>`;
  }).join(''));
  renderLog(app);
}

export function renderLog(app) {
  const log = Array.isArray(app.state.log) ? app.state.log : [];
  const items = log.slice(-60).reverse();
  setHTML($('#log'), items.length
    ? items.map((l) => `<li class="k-${esc(l.kind || 'info')}"><span class="y num">${esc(l.year)}</span><span>${esc(l.text)}</span></li>`).join('')
    : '<li class="list-empty">まだ何も起きていない。</li>');
}
