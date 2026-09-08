// offer.js — 買い付けモーダル
import { districtSummary, maxLtv, LOAN_TERM } from '../../engine/city.js';
import { MAX_OFFERS, CLOSING_COST } from '../../engine/game.js';
import { $, esc, fmt, pct, sfmt, setHTML, setText, clamp } from './dom.js';

let cur = null; // { listingId, bidRatio, ltv }

function income(app) {
  const h = app.state.history;
  const last = h.length ? h[h.length - 1] : null;
  const v = last && Number.isFinite(last.income) && last.income > 0 ? last.income : app.state.work.salary;
  return Math.max(0, Number(v) || 0);
}

function compute(app) {
  const { state } = app;
  const listing = state.city.listings.find((l) => l.id === cur.listingId);
  if (!listing) return null;
  const s = districtSummary(state.city, listing.districtId);
  const price = listing.ask * cur.bidRatio;
  const cap = maxLtv({ commLevel: app.levels.comm, network: state.meters.network, income: income(app), price });
  const ltv = clamp(cur.ltv, 0, cap);
  const loan = price * ltv;
  const cashNeeded = price * (1 - ltv) + price * CLOSING_COST;
  const r = state.market.last?.mortgageRate ?? (state.market.rate + 0.012);
  const pay = loan > 0 ? (r > 0 ? (loan * r) / (1 - Math.pow(1 + r, -LOAN_TERM)) : loan / LOAN_TERM) : 0;
  const interest = loan * r;
  const principal = Math.max(0, pay - interest);
  const rent = s.estYield * s.estimate;
  const cf = rent * 0.92 - 0.01 * s.estimate - interest - principal;
  return { listing, s, price, cap, ltv, loan, cashNeeded, cash: state.money.cash, rate: r, interest, principal, rent, cf };
}

export function open(app, listingId) {
  const existing = app.decisions.offers.find((o) => o.listingId === listingId);
  const listing = app.state.city.listings.find((l) => l.id === listingId);
  if (!listing) { app.toast('その売出しはもう無い。', 'bad', '買い付け'); return; }
  cur = existing ? { ...existing } : { listingId, bidRatio: 0.85, ltv: 0.7 };
  const c = compute(app);
  cur.ltv = clamp(cur.ltv, 0, c.cap);
  const s = c.s;
  setHTML($('#offer-body'), `
    <div class="offer-grid">
      <div>
        <h3 style="font-size:16px">${esc(s.name)} <span class="chip">${esc(s.kind)}</span> <span class="num muted">${esc(listing.id)}</span></h3>
        <dl class="kv" style="margin-top:8px">
          <dt>売出価格</dt><dd class="num">${esc(fmt(listing.ask))}</dd>
          <dt>あなたの推定</dt><dd class="num">${esc(fmt(s.estimate))} <span class="muted">± ${esc(pct(s.estError, 0))}</span></dd>
          <dt>推定利回り</dt><dd class="num">${esc(pct(s.estYield))} <span class="muted">（家賃 ${esc(fmt(c.rent))}/年）</span></dd>
          <dt>偵察</dt><dd class="num">${s.visits} 回</dd>
          <dt>ローン金利</dt><dd class="num">${esc(pct(c.rate, 2))} <span class="muted">変動・${LOAN_TERM} 年元利均等</span></dd>
        </dl>
        ${s.knownSecrets.length ? `<ul class="secrets" style="margin-top:8px">${s.knownSecrets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="hint" style="margin-top:8px">噂はまだ聞けていない。</p>'}
      </div>
      <div>
        <div class="slider-row">
          <label for="of-bid">提示率</label>
          <input type="range" id="of-bid" class="accent" min="0.4" max="1.1" step="0.01" value="${cur.bidRatio}">
          <span class="num val" id="of-bid-val"></span>
        </div>
        <p class="hint" id="of-bid-hint"></p>
        <div class="slider-row">
          <label for="of-ltv">LTV</label>
          <input type="range" id="of-ltv" min="0" max="${c.cap.toFixed(2)}" step="0.05" value="${cur.ltv}">
          <span class="num val" id="of-ltv-val"></span>
        </div>
        <p class="hint" id="of-ltv-hint"></p>
        <div class="preview" style="margin-top:10px">
          <div class="eyebrow">提示額</div>
          <div class="big num" id="of-price"></div>
          <dl class="kv" style="margin-top:6px">
            <dt>借入</dt><dd class="num" id="of-loan"></dd>
            <dt>必要自己資金</dt><dd class="num" id="of-cash"></dd>
            <dt>手元現金</dt><dd class="num" id="of-have"></dd>
            <dt>想定年間 CF</dt><dd class="num" id="of-cf"></dd>
          </dl>
          <p class="hint" id="of-cf-note"></p>
        </div>
      </div>
    </div>`);
  setHTML($('#offer-foot'), `
    <span id="of-warn" class="hint"></span>
    <span class="spacer"></span>
    <button class="btn" data-close>やめる</button>
    <button class="btn primary" id="of-submit">この条件で出す</button>`);
  update(app);
  app.openModal('m-offer', '#of-submit');
}

function update(app) {
  const c = compute(app);
  if (!c) return;
  setText($('#of-bid-val'), `${Math.round(cur.bidRatio * 100)}%`);
  const bidHint = $('#of-bid-hint');
  const parts = [`提示額 ${fmt(c.price)}（推定相場の ${pct(c.price / c.s.estimate, 0)}）`];
  if (cur.bidRatio <= 0.7) parts.push('胆力 +25 XP', '行動すると事態が動く');
  else if (cur.bidRatio < 0.85) parts.push('投げ売りの売主なら通る');
  setText(bidHint, parts.join(' · '));
  bidHint.className = cur.bidRatio <= 0.7 ? 'hint gold' : 'hint';

  const ltvEl = $('#of-ltv');
  ltvEl.max = c.cap.toFixed(2);
  if (Math.abs(Number(ltvEl.value) - c.ltv) > 1e-6) ltvEl.value = c.ltv;
  setText($('#of-ltv-val'), `${Math.round(c.ltv * 100)}%`);
  setText($('#of-ltv-hint'), `融資上限 LTV ${Math.round(c.cap * 100)}%（コミュ力 Lv${app.levels.comm}${app.state.meters.network > 60 ? '、人脈 60 超' : ''}、年収の 8 倍まで）`);

  setText($('#of-price'), fmt(c.price));
  setText($('#of-loan'), `${fmt(c.loan)} （利息 ${fmt(c.interest)} + 元本 ${fmt(c.principal)} /年）`);
  const cashEl = $('#of-cash');
  setText(cashEl, `${fmt(c.cashNeeded)} （頭金 + 諸費用 ${Math.round(CLOSING_COST * 100)}%）`);
  const enough = c.cash >= c.cashNeeded;
  cashEl.className = `num ${enough ? '' : 'warn'}`;
  setText($('#of-have'), fmt(c.cash));
  const cfEl = $('#of-cf');
  setText(cfEl, `${sfmt(c.cf)} → ${c.cf >= 0 ? '資産' : '負債'}`);
  cfEl.className = `num ${c.cf >= 0 ? 'ok' : 'warn'}`;
  setText($('#of-cf-note'), `家賃 ${fmt(c.rent)}×0.92 − 維持 ${fmt(0.01 * c.s.estimate)} − 利息 − 元本。${c.cf >= 0 ? 'ポケットに金が入る。' : 'ポケットから金が出る。バフェットに叱られる。'}`);

  const warn = $('#of-warn');
  const replacing = app.decisions.offers.some((o) => o.listingId === cur.listingId);
  const fullSlots = !replacing && app.decisions.offers.length >= MAX_OFFERS;
  let w = '';
  if (fullSlots) w = `買い付けは年 ${MAX_OFFERS} 件まで。どれかを取り消してから。`;
  else if (!enough) w = `自己資金不足: 必要 ${fmt(c.cashNeeded)} > 手元 ${fmt(c.cash)}。提出しても見送られる。`;
  setText(warn, w);
  warn.className = `hint ${w ? 'warn' : ''}`;
  $('#of-submit').disabled = fullSlots;
}

export function init(app) {
  $('#offer-body').addEventListener('input', (e) => {
    if (!cur) return;
    if (e.target.id === 'of-bid') cur.bidRatio = clamp(Number(e.target.value), 0.4, 1.1);
    else if (e.target.id === 'of-ltv') cur.ltv = clamp(Number(e.target.value), 0, 0.95);
    else return;
    update(app);
  });
  $('#offer-foot').addEventListener('click', (e) => {
    if (!e.target.closest('#of-submit') || !cur) return;
    const c = compute(app);
    if (!c) return;
    const o = { listingId: cur.listingId, bidRatio: Math.round(cur.bidRatio * 100) / 100, ltv: Math.round(c.ltv * 100) / 100 };
    const i = app.decisions.offers.findIndex((x) => x.listingId === o.listingId);
    if (i >= 0) app.decisions.offers[i] = o;
    else if (app.decisions.offers.length < MAX_OFFERS) app.decisions.offers.push(o);
    else return;
    app.closeModal('m-offer');
    app.toast(`${c.s.name}に ${fmt(c.price)}（${Math.round(o.bidRatio * 100)}%）で買い付けを予定。年を終えると結果が出る。`, 'info', '買い付け');
    app.onDecisionsChanged('offers');
  });
}
