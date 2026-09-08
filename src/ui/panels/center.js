// center.js — 資産推移と市場のチャート
import { drawNetWorth, drawMarket } from '../charts.js';
import { $, fmt, pct, spct, setText, setHTML, signClass, esc } from './dom.js';

export function render(app) {
  const { state, status } = app;
  drawNetWorth($('#cv-nw'), state.history);
  setText($('#nw-now'), fmt(status.netWorth));

  drawMarket($('#cv-mk'), state.market, { quantLevel: app.quantLevel, baseYear: 2026 });
  const chip = $('#mk-regime');
  setText(chip, status.regime);
  chip.className = `chip r-${status.regime}`;
  const last = state.market.last;
  const ret = $('#mk-ret');
  if (last) {
    setText(ret, `昨年 ${spct(last.totalReturn)}`);
    ret.className = `num ${signClass(last.totalReturn)}`;
  } else {
    setText(ret, 'まだ 1 年目');
    ret.className = 'num muted';
  }
  const rate = Number(state.market.rate) || 0;
  const mort = last ? last.mortgageRate : rate + 0.012;
  const dep = last ? last.depositRate : rate * 0.3;
  const parts = [
    `金利 <b class="num">${esc(pct(rate, 2))}</b>`,
    `住宅ローン <b class="num">${esc(pct(mort, 2))}</b>`,
    `預金 <b class="num">${esc(pct(dep, 2))}</b>`,
  ];
  if (last) {
    parts.push(`配当 <b class="num">${esc(pct(last.dividendYield, 2))}</b>`);
    parts.push(`年率 vol <b class="num">${esc(pct(last.vol, 0))}</b>`);
  }
  if (app.quantLevel >= 1) parts.push(`乖離 x <b class="num">${esc((state.market.p - state.market.f).toFixed(2))}</b>`);
  setHTML($('#mk-meta'), parts.map((p) => `<span>${p}</span>`).join(''));
}

export function redraw(app) {
  drawNetWorth($('#cv-nw'), app.state.history);
  drawMarket($('#cv-mk'), app.state.market, { quantLevel: app.quantLevel, baseYear: 2026 });
}
