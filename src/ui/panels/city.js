// city.js — 街キャンバス、地区詳細、所有物件、今年の買い付け、売出し一覧モーダル
import { drawCity, districtAt } from '../cityView.js';
import { districtSummary } from '../../engine/city.js';
import { MAX_SCOUT_TARGETS, MAX_OFFERS } from '../../engine/game.js';
import { $, esc, fmt, pct, sfmt, setHTML, setText, reducedMotion } from './dom.js';
import * as offer from './offer.js';

function cv() { return $('#cv-city'); }

export function init(app) {
  const c = cv();
  c.addEventListener('pointermove', (e) => {
    const id = districtAt(c, e.clientX, e.clientY, app.state.city);
    if (id !== app.ui.hover) { app.ui.hover = id; draw(app); }
  });
  c.addEventListener('pointerleave', () => { if (app.ui.hover != null) { app.ui.hover = null; draw(app); } });
  c.addEventListener('click', (e) => {
    const id = districtAt(c, e.clientX, e.clientY, app.state.city);
    if (id == null) return;
    app.ui.selected = id;
    renderDistrict(app);
    draw(app);
  });
  c.addEventListener('keydown', (e) => {
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (map[e.key]) {
      e.preventDefault();
      const cur = app.state.city.districts[app.ui.selected ?? 0] || app.state.city.districts[0];
      const nx = Math.min(5, Math.max(0, cur.x + map[e.key][0]));
      const ny = Math.min(5, Math.max(0, cur.y + map[e.key][1]));
      const d = app.state.city.districts.find((k) => k.x === nx && k.y === ny);
      if (d) { app.ui.selected = d.id; renderDistrict(app); draw(app); }
    } else if ((e.key === 'Enter' || e.key === ' ') && app.ui.selected != null) {
      e.preventDefault();
      e.stopPropagation();
      toggleScout(app, app.ui.selected);
    }
  });

  $('#district').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'scout') toggleScout(app, Number(b.dataset.id));
    else if (b.dataset.act === 'offer') offer.open(app, b.dataset.listing);
    else if (b.dataset.act === 'cancel') cancelOffer(app, b.dataset.listing);
  });
  $('#props').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sell]');
    if (!b) return;
    const id = b.dataset.sell;
    const i = app.decisions.sells.indexOf(id);
    if (i >= 0) app.decisions.sells.splice(i, 1); else app.decisions.sells.push(id);
    app.onDecisionsChanged('sells');
  });
  $('#offers').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'cancel') cancelOffer(app, b.dataset.listing);
    else if (b.dataset.act === 'edit') offer.open(app, b.dataset.listing);
  });
  $('#listings-body').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'offer') offer.open(app, b.dataset.listing);
    else if (b.dataset.act === 'cancel') { cancelOffer(app, b.dataset.listing); renderListingsModal(app); }
    else if (b.dataset.act === 'select') {
      app.ui.selected = Number(b.dataset.id);
      app.closeModal('m-listings');
      renderDistrict(app); draw(app);
      $('#sec-city').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  });

  // 売出し点の点滅（reduced motion では止める）
  setInterval(() => {
    if (reducedMotion() || document.hidden) return;
    if (!app.state || app.state.city.listings.length === 0) return;
    app.ui.blink = !app.ui.blink;
    draw(app);
  }, 900);
}

export function toggleScout(app, id) {
  const t = app.decisions.scoutTargets;
  const i = t.indexOf(id);
  if (i >= 0) t.splice(i, 1);
  else if (t.length < MAX_SCOUT_TARGETS) t.push(id);
  else { app.toast(`偵察先は ${MAX_SCOUT_TARGETS} つまで。どれかを外してから。`, 'bad', '偵察'); return; }
  app.onDecisionsChanged('scout');
}

export function cancelOffer(app, listingId) {
  const i = app.decisions.offers.findIndex((o) => o.listingId === listingId);
  if (i >= 0) app.decisions.offers.splice(i, 1);
  app.onDecisionsChanged('offers');
}

export function draw(app) {
  const { state } = app;
  const owned = new Set(state.props.map((p) => p.districtId));
  const listing = new Set(state.city.listings.map((l) => l.districtId));
  drawCity(cv(), state.city, {
    selected: app.ui.selected,
    hover: app.ui.hover,
    ownedDistrictIds: owned,
    listingDistrictIds: listing,
    scoutTargets: new Set(app.decisions.scoutTargets),
    blink: app.ui.blink,
    quantLevel: app.quantLevel,
  });
}

export function renderDistrict(app) {
  const el = $('#district');
  const id = app.ui.selected;
  if (id == null) {
    setHTML(el, '<p class="empty">地区を選ぶと、推定相場・利回り・噂・売出しが見える。偵察先は 3 つまで。</p>');
    return;
  }
  const s = districtSummary(app.state.city, id);
  if (!s) { setHTML(el, '<p class="empty">この地区は見つからない。</p>'); return; }
  const isTarget = app.decisions.scoutTargets.includes(id);
  const full = !isTarget && app.decisions.scoutTargets.length >= MAX_SCOUT_TARGETS;
  const pending = new Set(app.decisions.offers.map((o) => o.listingId));
  const secrets = s.knownSecrets.length
    ? `<ul class="secrets">${s.knownSecrets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : `<p class="hint">${s.visits > 0 ? 'まだ噂は聞けていない。もう一度回ると出るかもしれない。' : '未偵察。推定はかなり粗い。偵察先に加えて自転車で回ろう。'}</p>`;
  const listings = s.listings.length
    ? `<ul class="listings">${s.listings.map((l) => `
        <li>
          <span class="num muted">${esc(l.id)}</span>
          ${pending.has(l.id) ? '<span class="tag hot">提出予定</span>' : ''}
          <span class="ask num">${esc(fmt(l.ask))} <span class="ratio">推定比 ${esc(pct(l.askRatio, 0))}</span></span>
          ${pending.has(l.id)
            ? `<button class="btn sm" data-act="offer" data-listing="${esc(l.id)}">条件を変える</button><button class="btn sm ghost" data-act="cancel" data-listing="${esc(l.id)}">取り消す</button>`
            : `<button class="btn sm gold" data-act="offer" data-listing="${esc(l.id)}">買い付け</button>`}
        </li>`).join('')}</ul>`
    : '<p class="list-empty">今年この地区に売出しはない。</p>';
  setHTML(el, `
    <h3>${esc(s.name)} <span class="kind">${esc(s.kind)}</span>${s.owned > 0 ? '<span class="tag mine">所有</span>' : ''}${isTarget ? '<span class="tag asset">偵察先</span>' : ''}</h3>
    <dl class="kv">
      <dt>推定相場</dt><dd class="num">${esc(fmt(s.estimate))} <span class="muted">± ${esc(pct(s.estError, 0))}</span></dd>
      <dt>推定利回り</dt><dd class="num">${esc(pct(s.estYield))} <span class="muted">（家賃 ${esc(fmt(s.estRent))}/年）</span></dd>
      <dt>偵察</dt><dd class="num">${s.visits} 回</dd>
      <dt>所有</dt><dd class="num">${s.owned} 件</dd>
    </dl>
    <div>
      <h4 class="eyebrow">現地の話</h4>
      ${secrets}
    </div>
    <div>
      <button class="btn sm ${isTarget ? 'on' : ''}" data-act="scout" data-id="${id}" ${full ? 'disabled' : ''}>${isTarget ? '偵察先から外す' : '偵察先に追加'}</button>
      <span class="hint num">${app.decisions.scoutTargets.length}/${MAX_SCOUT_TARGETS}${full ? ' — いっぱい' : ''}</span>
    </div>
    <div>
      <h4 class="eyebrow">売出し</h4>
      ${listings}
    </div>`);
}

export function renderLists(app) {
  const { state, decisions } = app;
  const sells = new Set(decisions.sells);
  setText($('#props-count'), state.props.length ? `${state.props.length} 件` : '');
  setHTML($('#props'), state.props.length
    ? state.props.map((p) => `
      <li>
        <span class="nm">${esc(p.name)} <span class="tag ${p.isAsset ? 'asset' : 'liab'}">${p.isAsset ? '資産' : '負債'}</span></span>
        <span class="num muted">時価 ${esc(fmt(p.value))} / 残債 ${esc(fmt(p.loan))}</span>
        <span class="cf num ${p.lastCashflow >= 0 ? 'pos' : 'neg'}">CF ${esc(sfmt(p.lastCashflow))}</span>
        <button class="btn sm ${sells.has(p.id) ? 'danger' : ''}" data-sell="${esc(p.id)}">${sells.has(p.id) ? '売却を取り消す' : '売る'}</button>
      </li>`).join('')
    : '<li class="list-empty">まだ物件はない。半額でもいい、買い付けを出せ。</li>');

  setText($('#offers-count'), `${decisions.offers.length}/${MAX_OFFERS}`);
  setHTML($('#offers'), decisions.offers.length
    ? decisions.offers.map((o) => {
      const l = state.city.listings.find((x) => x.id === o.listingId);
      const d = l ? state.city.districts[l.districtId] : null;
      const bid = l ? l.ask * o.bidRatio : 0;
      return `<li>
        <span class="nm">${esc(d ? d.name : o.listingId)} <span class="num muted">${esc(o.listingId)}</span></span>
        <span class="num">${esc(fmt(bid))} <span class="muted">(${Math.round(o.bidRatio * 100)}% / LTV ${Math.round(o.ltv * 100)}%)</span></span>
        <button class="btn sm" data-act="edit" data-listing="${esc(o.listingId)}">変更</button>
        <button class="btn sm ghost" data-act="cancel" data-listing="${esc(o.listingId)}">取り消す</button>
      </li>`;
    }).join('')
    : '<li class="list-empty">今年の買い付けはまだない。行動すると事態が動く。</li>');
}

export function render(app) {
  draw(app);
  renderDistrict(app);
  renderLists(app);
}

/** 「街と買い付け」モーダル: 全売出しを推定比の安い順に。 */
export function renderListingsModal(app) {
  const { state, decisions } = app;
  const pending = new Set(decisions.offers.map((o) => o.listingId));
  const rows = state.city.listings.map((l) => {
    const d = state.city.districts[l.districtId];
    const s = districtSummary(state.city, l.districtId);
    return { l, d, s, ratio: s && s.estimate > 0 ? l.ask / s.estimate : 1 };
  }).sort((a, b) => a.ratio - b.ratio);
  const body = rows.length ? `
    <p class="hint">売主の本音は見えない。15% は投げ売り（暴落の翌年はもっと）。安く出して断られても学びと自慢ポイントになる。</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>地区</th><th>種別</th><th>売出価格</th><th>推定相場</th><th>推定比</th><th>利回り</th><th>偵察</th><th></th></tr></thead>
      <tbody>${rows.map(({ l, d, s, ratio }) => `
        <tr>
          <td><button class="btn sm ghost" data-act="select" data-id="${d.id}">${esc(d.name)}</button></td>
          <td class="muted">${esc(d.kind)}</td>
          <td class="num">${esc(fmt(l.ask))}</td>
          <td class="num">${esc(fmt(s.estimate))} <span class="muted">±${esc(pct(s.estError, 0))}</span></td>
          <td class="num ${ratio < 0.95 ? 'pos' : ratio > 1.15 ? 'neg' : ''}">${esc(pct(ratio, 0))}</td>
          <td class="num">${esc(pct(s.estYield))}</td>
          <td class="num muted">${s.visits}回</td>
          <td>${pending.has(l.id)
            ? `<span class="tag hot">提出予定</span> <button class="btn sm" data-act="offer" data-listing="${esc(l.id)}">変更</button> <button class="btn sm ghost" data-act="cancel" data-listing="${esc(l.id)}">取り消す</button>`
            : `<button class="btn sm gold" data-act="offer" data-listing="${esc(l.id)}">買い付け</button>`}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : '<p class="list-empty">今年の売出しはない。</p>';
  setHTML($('#listings-body'), body);
}
