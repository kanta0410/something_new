// charts.js — Canvas 2D 手描きチャート（依存なし・ESM）
//
// すべての描画は CSS ピクセル座標で行い、fitCanvas() が devicePixelRatio を吸収する。
// ホバーは canvas ごとに 1 回だけリスナーを付け（WeakMap）、最後に渡されたデータで再描画する。
// 色・フォントは DESIGN.md §14 の単一テーマ。数値は IBM Plex Mono、ラベルは DotGothic16。

/** 藍のゲーム端末テーマ（DESIGN §14）。 */
export const THEME = Object.freeze({
  ground: '#0E1A2B',
  surface: '#15263D',
  surface2: '#1C3251',
  text: '#F1E9D2',
  accent: '#E4482C',
  gold: '#D9A441',
  positive: '#6FBFA3',
  muted: '#8F8CB8',
  rule: '#2A4266',
});

/** 数値用フォント。 */
export const FONT_NUM = '"IBM Plex Mono", ui-monospace, monospace';
/** ラベル用フォント。 */
export const FONT_LABEL = '"DotGothic16", sans-serif';

// ---------------------------------------------------------------------------
// 基本ユーティリティ
// ---------------------------------------------------------------------------

/**
 * canvas の backing store を clientWidth/Height × devicePixelRatio に合わせ、
 * CSS ピクセル座標で描けるように transform を設定した 2D コンテキストを返す。
 * @param {HTMLCanvasElement} canvas
 * @returns {{ctx:CanvasRenderingContext2D, w:number, h:number, dpr:number}} w/h は CSS ピクセル
 */
export function fitCanvas(canvas) {
  const dpr = Math.max(1, Math.min(4, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const w = canvas.clientWidth || canvas.width || 300;
  const h = canvas.clientHeight || canvas.height || 150;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

function niceNum(range, round) {
  if (!(range > 0)) return 1;
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/**
 * 「きれいな」目盛りを返す（1, 2, 5 × 10^k 刻み）。
 * @param {number} min
 * @param {number} max
 * @param {number} [count=5] 目安の目盛り数
 * @returns {{ticks:number[], step:number, min:number, max:number}} min/max は目盛りに丸めた範囲
 */
export function niceTicks(min, max, count = 5) {
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = min + 1;
  if (max <= min) max = min + (Math.abs(min) || 1);
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, count - 1), true);
  const dec = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) {
    const r = +v.toFixed(dec);
    ticks.push(Math.abs(r) < step * 1e-9 ? 0 : r);
  }
  return { ticks, step, min: lo, max: hi };
}

/**
 * 万円の値を「2,400万」「1.2億」の形式にする。
 * @param {number} v 万円
 * @returns {string}
 */
export function fmtMan(v) {
  if (!isFinite(v)) return '—';
  const neg = v < 0;
  const a = Math.abs(v);
  let s;
  if (a >= 1e4) {
    const oku = a / 1e4;
    s = (oku >= 100 ? Math.round(oku).toLocaleString('en-US') : oku.toFixed(1).replace(/\.0$/, '')) + '億';
  } else if (a >= 0.5) {
    s = Math.round(a).toLocaleString('en-US') + '万';
  } else {
    return '0';
  }
  return (neg ? '-' : '') + s;
}

/** 指数などの実数を表示用に整形。 */
function fmtNum(v, d) {
  if (!isFinite(v)) return '—';
  if (d == null) d = Math.abs(v) >= 1000 ? 0 : 1;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(v, d = 0, sign = false) {
  if (!isFinite(v)) return '—';
  const s = (v * 100).toFixed(d) + '%';
  return sign && v > 0 ? '+' + s : s;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 色に alpha を付ける（'#rrggbb' → 'rgba(...)'）。 */
export function alpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** 2 色を t で線形補間（RGB）。 */
export function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const k = Math.max(0, Math.min(1, t));
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const patternCache = new Map();

/**
 * 45° の斜線ハッチパターンを返す（dpr を考慮してくっきり描く）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} color
 * @param {number} a alpha
 * @param {number} [dpr]
 */
export function hatchPattern(ctx, color, a = 0.45, dpr = 1) {
  const key = `${color}|${a}|${dpr}`;
  let pat = patternCache.get(key);
  if (pat) return pat;
  const size = 6;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.strokeStyle = alpha(color, a);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-1, size + 1);
  g.lineTo(size + 1, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(size - 1, size + 1);
  g.lineTo(size + 1, size - 1);
  g.stroke();
  pat = ctx.createPattern(c, 'repeat');
  if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
    pat.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  }
  patternCache.set(key, pat);
  return pat;
}

function font(size, kind = 'num', weight = '') {
  return `${weight ? weight + ' ' : ''}${size}px ${kind === 'label' ? FONT_LABEL : FONT_NUM}`;
}

function paintBg(ctx, w, h, opts) {
  ctx.clearRect(0, 0, w, h);
  const bg = opts.bg === undefined ? THEME.surface : opts.bg;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  return bg || THEME.surface;
}

function placeholder(ctx, w, h, text) {
  ctx.save();
  ctx.font = font(13, 'label');
  ctx.fillStyle = THEME.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  ctx.restore();
}

function hline(ctx, x0, x1, y, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  const yy = width === 1 ? Math.round(y) + 0.5 : y;
  ctx.moveTo(x0, yy);
  ctx.lineTo(x1, yy);
  ctx.stroke();
}

function vline(ctx, x, y0, y1, color, width = 1, dash) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  const xx = width === 1 ? Math.round(x) + 0.5 : x;
  ctx.moveTo(xx, y0);
  ctx.lineTo(xx, y1);
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
}

function dot(ctx, x, y, r, color, ringColor, ring = 2) {
  if (ring > 0) {
    ctx.fillStyle = ringColor;
    ctx.beginPath();
    ctx.arc(x, y, r + ring, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function polyline(ctx, xs, ys, color, width = 2, dash) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    if (i === 0) ctx.moveTo(xs[i], ys[i]);
    else ctx.lineTo(xs[i], ys[i]);
  }
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
}

/** 上辺 hi[] と下辺 lo[] の間を塗る。 */
function band(ctx, xs, hiY, loY, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    if (i === 0) ctx.moveTo(xs[i], hiY[i]);
    else ctx.lineTo(xs[i], hiY[i]);
  }
  for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i], loY[i]);
  ctx.closePath();
  ctx.fill();
}

/** 年齢軸の目盛り（ラベル同士が minPx 以上離れる最小の刻み）。 */
function ageTicks(a0, a1, plotW, minPx = 36) {
  const span = Math.max(1, a1 - a0);
  const steps = [1, 2, 5, 10, 20, 25, 50];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (plotW / (span / s) >= minPx) { step = s; break; }
  }
  const ticks = [];
  for (let a = Math.ceil(a0 / step) * step; a <= a1 + 1e-9; a += step) ticks.push(a);
  const px = (a) => plotW * (a - a0) / span;
  if (ticks.length === 0 || px(ticks[0]) >= minPx * 0.8) ticks.unshift(a0);
  return ticks;
}

/** 目盛りラベルの最大幅を測る。 */
function measureMax(ctx, labels, f) {
  ctx.font = f;
  let m = 0;
  for (const s of labels) m = Math.max(m, ctx.measureText(s).width);
  return m;
}

/**
 * ツールチップ描画。rows = [{ text }] (見出し) または [{ label, value, key:{color,kind,dash?} }]。
 * anchorX/Y を避けて canvas 内に収める。
 */
function drawTooltip(ctx, w, h, anchorX, anchorY, rows, bg) {
  const pad = 7;
  const rowH = 14;
  const keyW = rows.some((r) => r.key) ? 16 : 0;
  let labelW = 0;
  let valueW = 0;
  let textW = 0;
  for (const r of rows) {
    if (r.text != null) {
      ctx.font = r.font || font(10, 'label');
      textW = Math.max(textW, ctx.measureText(r.text).width);
    } else {
      ctx.font = font(10, 'label');
      labelW = Math.max(labelW, ctx.measureText(r.label).width);
      ctx.font = r.bold ? font(11, 'num', 'bold') : font(11, 'num');
      valueW = Math.max(valueW, ctx.measureText(r.value).width);
    }
  }
  const bw = Math.ceil(pad * 2 + Math.max(textW, keyW + labelW + 10 + valueW));
  const bh = pad * 2 + rows.length * rowH;
  let bx = anchorX + 12;
  if (bx + bw > w - 4) bx = anchorX - 12 - bw;
  if (bx < 4) bx = Math.max(4, Math.min(w - bw - 4, anchorX - bw / 2));
  let by = anchorY - bh / 2;
  by = Math.max(4, Math.min(h - bh - 4, by));
  ctx.save();
  ctx.fillStyle = alpha(THEME.surface2, 0.94);
  ctx.strokeStyle = THEME.rule;
  ctx.lineWidth = 1;
  roundRect(ctx, bx + 0.5, by + 0.5, bw, bh, 3);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = 'middle';
  let y = by + pad + rowH / 2;
  for (const r of rows) {
    if (r.text != null) {
      ctx.font = r.font || font(10, 'label');
      ctx.fillStyle = r.color || THEME.muted;
      ctx.textAlign = 'left';
      ctx.fillText(r.text, bx + pad, y);
    } else {
      const kx = bx + pad;
      if (r.key) {
        const k = r.key;
        if (k.kind === 'rect') {
          ctx.fillStyle = k.color;
          ctx.fillRect(kx, y - 4, 10, 8);
        } else if (k.kind === 'hatch') {
          ctx.fillStyle = alpha(k.color, 0.2);
          ctx.fillRect(kx, y - 4, 10, 8);
          ctx.fillStyle = hatchPattern(ctx, k.color, 0.7, dprOf(ctx));
          ctx.fillRect(kx, y - 4, 10, 8);
        } else {
          ctx.strokeStyle = k.color;
          ctx.lineWidth = 2;
          if (k.dash) ctx.setLineDash(k.dash);
          ctx.beginPath();
          ctx.moveTo(kx, y + 0.5);
          ctx.lineTo(kx + 10, y + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.font = font(10, 'label');
      ctx.fillStyle = THEME.muted;
      ctx.textAlign = 'left';
      ctx.fillText(r.label, bx + pad + keyW, y);
      ctx.font = r.bold ? font(11, 'num', 'bold') : font(11, 'num');
      ctx.fillStyle = r.color || THEME.text;
      ctx.textAlign = 'right';
      ctx.fillText(r.value, bx + bw - pad, y);
    }
    y += rowH;
  }
  ctx.restore();
}

function dprOf(ctx) {
  const t = ctx.getTransform ? ctx.getTransform() : null;
  return t ? t.a || 1 : 1;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** 凡例（横一列）。items = [{label, color, kind:'rect'|'line'|'hatch'|'band', dash?, alpha?}] */
function drawLegend(ctx, x, y, items, maxX) {
  ctx.save();
  ctx.font = font(10, 'label');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let cx = x;
  for (const it of items) {
    const tw = ctx.measureText(it.label).width;
    if (cx + 14 + tw > maxX + 1) break;
    if (it.kind === 'line') {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2;
      if (it.dash) ctx.setLineDash(it.dash);
      ctx.beginPath();
      ctx.moveTo(cx, y + 0.5);
      ctx.lineTo(cx + 10, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (it.kind === 'hatch') {
      ctx.fillStyle = alpha(it.color, 0.15);
      ctx.fillRect(cx, y - 4, 10, 8);
      ctx.fillStyle = hatchPattern(ctx, it.color, 0.7, dprOf(ctx));
      ctx.fillRect(cx, y - 4, 10, 8);
    } else if (it.kind === 'dot') {
      dot(ctx, cx + 5, y, 3, it.color, THEME.surface, 0);
    } else {
      ctx.fillStyle = it.alpha != null ? alpha(it.color, it.alpha) : it.color;
      ctx.fillRect(cx, y - 4, 10, 8);
    }
    ctx.fillStyle = THEME.muted;
    ctx.fillText(it.label, cx + 14, y);
    cx += 14 + tw + 10;
  }
  ctx.restore();
  return cx;
}

// ---------------------------------------------------------------------------
// ホバー管理（canvas ごとに 1 回だけリスナーを付ける）
// ---------------------------------------------------------------------------

/** @type {WeakMap<HTMLCanvasElement, {pos:{x:number,y:number}|null, redraw:(()=>void)|null}>} */
const hoverMap = new WeakMap();

function ensureHover(canvas) {
  let st = hoverMap.get(canvas);
  if (st) return st;
  st = { pos: null, redraw: null };
  hoverMap.set(canvas, st);
  if (typeof canvas.addEventListener !== 'function') return st;
  const toLocal = (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = r.width ? (canvas.clientWidth || r.width) / r.width : 1;
    const sy = r.height ? (canvas.clientHeight || r.height) / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };
  const onMove = (e) => {
    st.pos = toLocal(e);
    if (st.redraw) st.redraw();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onMove);
  canvas.addEventListener('pointerleave', () => {
    st.pos = null;
    if (st.redraw) st.redraw();
  });
  return st;
}

/** ホバー位置に最も近いデータ点の index。 */
function nearestIndex(xs, px) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - px);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 1. 純資産の積み上げ面
// ---------------------------------------------------------------------------

const NW_COMPONENTS = [
  { key: 'cash', label: '現金', color: THEME.muted },
  { key: 'stocks', label: '株式', color: THEME.positive },
  { key: 'reEquity', label: '不動産', color: THEME.gold },
];

/**
 * 純資産の積み上げ面グラフ。現金 / 株式 / 不動産純資産（Σ value − loan）を年ごとに積み上げ、
 * 負債（ローン残高）はゼロ線の下に藤色のハッチ帯で描く。純資産線は生成り 2px、最終点を強調。
 * ホバーで十字線とツールチップ（年 / 年齢 / 純資産 / 内訳）。
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{year:number, age:number, netWorth:number, cash:number, stocks:number, reEquity:number, debt:number}>} history YearRecord[]
 * @param {{bg?:string|null, legend?:boolean}} [opts] bg: 背景色（既定 surface、null で透明）
 */
export function drawNetWorth(canvas, history, opts = {}) {
  const st = ensureHover(canvas);
  st.redraw = () => renderNetWorth(canvas, history, opts, st.pos);
  st.redraw();
}

function renderNetWorth(canvas, history, opts, hover) {
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  const bg = paintBg(ctx, w, h, opts);
  const H = Array.isArray(history) ? history.filter((r) => r && typeof r === 'object') : [];
  if (H.length === 0) { placeholder(ctx, w, h, 'まだ歴史がない'); return; }
  const n = H.length;
  const ages = H.map((r, i) => (isFinite(r.age) ? r.age : 22 + i));
  const nw = H.map((r) => (isFinite(r.netWorth) ? r.netWorth : (r.cash || 0) + (r.stocks || 0) + (r.reEquity || 0)));
  const debt = H.map((r) => Math.max(0, r.debt || 0));

  // 積み上げ（正は上へ、負は下へ）
  const posTop = new Array(n).fill(0);
  const negBot = new Array(n).fill(0);
  const bands = NW_COMPONENTS.map((c) => ({ ...c, lo: new Array(n), hi: new Array(n), val: new Array(n) }));
  for (let i = 0; i < n; i++) {
    for (const b of bands) {
      const v = isFinite(H[i][b.key]) ? H[i][b.key] : 0;
      b.val[i] = v;
      if (v >= 0) { b.lo[i] = posTop[i]; posTop[i] += v; b.hi[i] = posTop[i]; }
      else { b.hi[i] = negBot[i]; negBot[i] += v; b.lo[i] = negBot[i]; }
    }
  }
  let yMax = 1;
  let yMin = 0;
  for (let i = 0; i < n; i++) {
    yMax = Math.max(yMax, posTop[i], nw[i]);
    yMin = Math.min(yMin, negBot[i], nw[i], -debt[i]);
  }
  const small = h < 200;
  const yt = niceTicks(yMin, yMax * 1.04, small ? 4 : 5);
  const yLabels = yt.ticks.map(fmtMan);
  const padL = Math.ceil(measureMax(ctx, yLabels, font(10)) + 10);
  const padT = opts.legend === false ? 10 : 24;
  const padB = 20;
  const padR = 12;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);
  const a0 = ages[0];
  const a1 = n > 1 ? ages[n - 1] : a0 + 1;
  const xOf = (age) => padL + (plotW * (age - a0)) / (a1 - a0);
  const yOf = (v) => padT + plotH * (1 - (v - yt.min) / (yt.max - yt.min));
  const xs = ages.map(xOf);

  // グリッド + y ラベル
  ctx.font = font(10);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let k = 0; k < yt.ticks.length; k++) {
    const y = yOf(yt.ticks[k]);
    hline(ctx, padL, w - padR, y, yt.ticks[k] === 0 ? alpha(THEME.muted, 0.45) : alpha(THEME.rule, 0.7));
    ctx.fillStyle = THEME.muted;
    ctx.fillText(yLabels[k], padL - 6, y);
  }
  // x 目盛り（年齢）
  const at = ageTicks(a0, a1, plotW);
  ctx.textAlign = 'center';
  for (const a of at) {
    const x = xOf(a);
    vline(ctx, x, padT, padT + plotH, alpha(THEME.rule, 0.35));
    ctx.fillStyle = THEME.muted;
    ctx.font = font(10);
    ctx.fillText(`${a}歳`, x, h - padB / 2);
  }

  // 負債帯（ゼロ線の下、ハッチ）
  if (debt.some((d) => d > 0)) {
    const zero = yOf(0);
    const zeros = xs.map(() => zero);
    const ys = debt.map((d) => yOf(-d));
    band(ctx, xs, zeros, ys, alpha(THEME.muted, 0.12));
    band(ctx, xs, zeros, ys, hatchPattern(ctx, THEME.muted, 0.5, dpr));
  }
  // 積み上げ帯
  for (const b of bands) {
    if (!b.val.some((v) => v !== 0)) continue;
    band(ctx, xs, b.hi.map(yOf), b.lo.map(yOf), alpha(b.color, 0.55));
  }
  // 帯の境界に 2px の面色の隙間
  ctx.strokeStyle = bg;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const b of bands) {
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < n; i++) {
      const thick = Math.abs(yOf(b.lo[i]) - yOf(b.hi[i])) > 0.5;
      const y = yOf(b.val[i] >= 0 ? b.hi[i] : b.lo[i]);
      if (thick) {
        if (!open) { ctx.moveTo(xs[i], y); open = true; } else ctx.lineTo(xs[i], y);
      } else open = false;
    }
    ctx.stroke();
  }
  // 純資産線
  const nwY = nw.map(yOf);
  polyline(ctx, xs, nwY, THEME.text, 2);

  // 最終点の強調
  const li = n - 1;
  dot(ctx, xs[li], nwY[li], 4, THEME.text, bg, 2);
  {
    const label = fmtMan(nw[li]);
    ctx.font = font(12, 'num', 'bold');
    const tw = ctx.measureText(label).width;
    let tx = xs[li] + 8;
    let align = 'left';
    if (tx + tw > w - 2) { tx = xs[li] - 8; align = 'right'; }
    let ty = nwY[li] - 12;
    if (ty < padT + 8) ty = nwY[li] + 14;
    const bx = align === 'left' ? tx - 3 : tx - tw - 3;
    ctx.fillStyle = alpha(bg, 0.85);
    ctx.fillRect(bx, ty - 8, tw + 6, 16);
    ctx.fillStyle = THEME.text;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx, ty);
  }

  // 凡例
  if (opts.legend !== false) {
    const items = bands.map((b) => ({ label: b.label, color: b.color, kind: 'rect', alpha: 0.7 }));
    items.push({ label: '負債', color: THEME.muted, kind: 'hatch' });
    drawLegend(ctx, padL, 11, items, w - padR);
  }

  // ホバー
  if (hover && hover.x >= padL - 4 && hover.x <= w - padR + 4 && hover.y >= 0 && hover.y <= h) {
    const i = nearestIndex(xs, hover.x);
    vline(ctx, xs[i], padT, padT + plotH, alpha(THEME.muted, 0.6));
    dot(ctx, xs[i], nwY[i], 3.5, THEME.text, bg, 2);
    const r = H[i];
    const rows = [
      { text: `${isFinite(r.year) ? r.year + '年 · ' : ''}${ages[i]}歳`, color: THEME.muted },
      { label: '純資産', value: fmtMan(nw[i]), bold: true, key: { color: THEME.text, kind: 'line' } },
    ];
    for (const b of bands) rows.push({ label: b.label, value: fmtMan(b.val[i]), key: { color: b.color, kind: 'rect' } });
    rows.push({ label: '負債', value: debt[i] > 0 ? '-' + fmtMan(debt[i]) : '0', key: { color: THEME.muted, kind: 'hatch' } });
    drawTooltip(ctx, w, h, xs[i], hover.y, rows, bg);
  }
}

// ---------------------------------------------------------------------------
// 2. 市場（指数・本源価値・チャート派比率）
// ---------------------------------------------------------------------------

/** 対数軸の目盛り（1, 2, 5 × 10^k）。範囲が狭ければ線形の nice ticks で補う。 */
function logTicks(lo, hi) {
  const out = [];
  const k0 = Math.floor(Math.log10(lo));
  const k1 = Math.ceil(Math.log10(hi));
  for (let k = k0; k <= k1; k++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** k;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  if (out.length > 7) return out.filter((v) => /^[15]/.test(String(v).replace(/^0\.0*/, '')));
  if (out.length >= 3) return out;
  return niceTicks(lo, hi, 4).ticks.filter((v) => v >= lo && v <= hi && v > 0);
}

/**
 * 市場チャート。指数（生成り、対数軸）、本源価値（金・破線、quantLevel ≥ 1）、
 * チャート派比率 wc のヒートストリップ（quantLevel ≥ 4）、暴落年の朱の帯。
 * 系列が 2 点未満なら「まだ歴史がない」。
 * @param {HTMLCanvasElement} canvas
 * @param {{series:{index:number[], fundamental:number[], wc:number[], x:number[]}, year?:number}} market MarketState
 * @param {{quantLevel?:number, baseYear?:number, crashes?:Iterable<number>, bg?:string|null}} [opts]
 *   baseYear: market.year=0 の西暦（既定 2026）。crashes: 暴落年の series index（省略時は年次リターン < −25% から推定）
 */
export function drawMarket(canvas, market, opts = {}) {
  const st = ensureHover(canvas);
  st.redraw = () => renderMarket(canvas, market, opts, st.pos);
  st.redraw();
}

function renderMarket(canvas, market, opts, hover) {
  const { ctx, w, h } = fitCanvas(canvas);
  const bg = paintBg(ctx, w, h, opts);
  const s = (market && market.series) || {};
  const idx = Array.isArray(s.index) ? s.index : [];
  const n = idx.length;
  if (n < 2) { placeholder(ctx, w, h, 'まだ歴史がない'); return; }
  const fund = Array.isArray(s.fundamental) ? s.fundamental : [];
  const wc = Array.isArray(s.wc) ? s.wc : [];
  const xdev = Array.isArray(s.x) ? s.x : [];
  const q = opts.quantLevel | 0;
  const showF = q >= 1 && fund.length === n;
  const showWc = q >= 4 && wc.length === n;
  const baseYear = isFinite(opts.baseYear) ? opts.baseYear : 2026;
  const elapsed = isFinite(market.year) ? market.year : n - 1;
  const yearOf = (i) => baseYear + elapsed - (n - 1) + i;

  const crash = new Array(n).fill(false);
  if (opts.crashes) {
    for (const i of opts.crashes) if (i >= 0 && i < n) crash[i] = true;
  } else {
    // 連続する年で指数が 25% 超下落した年を暴落とみなす
    for (let i = 1; i < n; i++) {
      if (idx[i - 1] > 0 && idx[i] / idx[i - 1] - 1 < -0.25) crash[i] = true;
    }
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (idx[i] > 0) { lo = Math.min(lo, idx[i]); hi = Math.max(hi, idx[i]); }
    if (showF && fund[i] > 0) { lo = Math.min(lo, fund[i]); hi = Math.max(hi, fund[i]); }
  }
  if (!isFinite(lo)) { lo = 50; hi = 200; }
  lo /= 1.06;
  hi *= 1.08;
  const ticks = logTicks(lo, hi);
  const tickLabels = ticks.map((v) => fmtNum(v, v < 10 ? 1 : 0));
  const padL = Math.ceil(measureMax(ctx, tickLabels, font(10)) + 10);
  const padT = 10;
  const strip = showWc ? 10 : 0;
  const padB = 20 + (showWc ? strip + 4 : 0);
  const padR = 12;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);
  const L0 = Math.log(lo);
  const L1 = Math.log(hi);
  const xOf = (i) => padL + (plotW * i) / (n - 1);
  const yOf = (v) => padT + plotH * (1 - (Math.log(Math.max(v, 1e-9)) - L0) / (L1 - L0));
  const xs = idx.map((_, i) => xOf(i));

  // 暴落年の帯
  for (let i = 1; i < n; i++) {
    if (!crash[i]) continue;
    ctx.fillStyle = alpha(THEME.accent, 0.16);
    ctx.fillRect(xs[i - 1], padT, xs[i] - xs[i - 1], plotH);
  }
  // グリッド
  ctx.font = font(10);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ticks.forEach((v, k) => {
    const y = yOf(v);
    hline(ctx, padL, w - padR, y, alpha(THEME.rule, 0.7));
    ctx.fillStyle = THEME.muted;
    ctx.fillText(tickLabels[k], padL - 6, y);
  });
  // x 目盛り（西暦）
  const yearTicks = ageTicks(yearOf(0), yearOf(n - 1), plotW, 44);
  ctx.textAlign = 'center';
  for (const y of yearTicks) {
    const i = y - yearOf(0);
    const x = xOf(i);
    vline(ctx, x, padT, padT + plotH, alpha(THEME.rule, 0.35));
    ctx.fillStyle = THEME.muted;
    ctx.fillText(String(y), x, h - 10);
  }
  // wc ストリップ
  if (showWc) {
    const sy = padT + plotH + 4;
    const cw = plotW / (n - 1);
    for (let i = 0; i < n; i++) {
      const x0 = Math.max(padL, xs[i] - cw / 2);
      const x1 = Math.min(w - padR, xs[i] + cw / 2);
      ctx.fillStyle = mix(THEME.surface2, THEME.accent, Math.max(0, Math.min(1, wc[i])));
      ctx.fillRect(x0, sy, x1 - x0 + 0.5, strip);
    }
    ctx.font = font(8, 'label');
    ctx.fillStyle = THEME.muted;
    ctx.textAlign = 'right';
    ctx.fillText('wc', padL - 6, sy + strip / 2);
  }
  // 本源価値
  if (showF) polyline(ctx, xs, fund.map(yOf), THEME.gold, 1.5, [4, 3]);
  // 指数
  const iy = idx.map(yOf);
  polyline(ctx, xs, iy, THEME.text, 2);
  dot(ctx, xs[n - 1], iy[n - 1], 3.5, THEME.text, bg, 2);
  {
    const label = fmtNum(idx[n - 1]);
    ctx.font = font(11, 'num', 'bold');
    const tw = ctx.measureText(label).width;
    let tx = xs[n - 1] - 8;
    let ty = iy[n - 1] - 11;
    if (ty < padT + 6) ty = iy[n - 1] + 13;
    ctx.fillStyle = alpha(bg, 0.85);
    ctx.fillRect(tx - tw - 3, ty - 7, tw + 6, 14);
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'right';
    ctx.fillText(label, tx, ty);
  }
  // 凡例
  const items = [{ label: '指数', color: THEME.text, kind: 'line' }];
  if (showF) items.push({ label: '本源価値', color: THEME.gold, kind: 'line', dash: [3, 2] });
  if (crash.some(Boolean)) items.push({ label: '暴落', color: THEME.accent, kind: 'rect', alpha: 0.45 });
  if (showWc) items.push({ label: 'チャート派 wc', color: THEME.accent, kind: 'rect', alpha: 0.8 });
  drawLegend(ctx, padL + 4, padT + 8, items, w - padR);

  // ホバー
  if (hover && hover.x >= padL - 4 && hover.x <= w - padR + 4 && hover.y >= 0 && hover.y <= h) {
    const i = nearestIndex(xs, hover.x);
    vline(ctx, xs[i], padT, padT + plotH + (showWc ? strip + 4 : 0), alpha(THEME.muted, 0.6));
    dot(ctx, xs[i], iy[i], 3.5, THEME.text, bg, 2);
    if (showF) dot(ctx, xs[i], yOf(fund[i]), 3, THEME.gold, bg, 2);
    const rows = [{ text: `${yearOf(i)}年${crash[i] ? '  暴落' : ''}`, color: crash[i] ? THEME.accent : THEME.muted }];
    rows.push({ label: '指数', value: fmtNum(idx[i]), bold: true, key: { color: THEME.text, kind: 'line' } });
    if (i > 0) {
      const ret = idx[i] / idx[i - 1] - 1;
      rows.push({ label: '年間', value: fmtPct(ret, 1, true), color: ret < 0 ? THEME.accent : THEME.text });
    }
    if (showF) {
      rows.push({ label: '本源価値', value: fmtNum(fund[i]), key: { color: THEME.gold, kind: 'line', dash: [3, 2] } });
      if (isFinite(xdev[i])) rows.push({ label: '乖離 x', value: (xdev[i] >= 0 ? '+' : '') + xdev[i].toFixed(2) });
    }
    if (showWc && isFinite(wc[i])) rows.push({ label: 'チャート派', value: fmtPct(wc[i], 0), key: { color: mix(THEME.surface2, THEME.accent, wc[i]), kind: 'rect' } });
    drawTooltip(ctx, w, h, xs[i], hover.y, rows, bg);
  }
}

// ---------------------------------------------------------------------------
// 3. モンテカルロ扇形図
// ---------------------------------------------------------------------------

/**
 * モンテカルロの分位扇形図。p5–p95 は藤の薄い帯、p25–p75 は濃い帯、p50 は金の線。
 * 現在年齢のマーカー、破産確率の注記。値域が 100 倍を超えるときは asinh（対数的）スケール。
 * @param {HTMLCanvasElement} canvas
 * @param {{years:number[], p5:number[], p25:number[], p50:number[], p75:number[], p95:number[], ruinProb:number, n?:number}} mc monteCarlo() の出力
 * @param {{currentAge?:number, ages?:number[], bg?:string|null}} [opts]
 *   years[] の解釈: 値が 15 以上なら年齢、1000 以上なら西暦（先頭 = 現在年）、それ以外は現在年齢からの経過年。ages[] で明示も可。
 */
export function drawFan(canvas, mc, opts = {}) {
  const st = ensureHover(canvas);
  st.redraw = () => renderFan(canvas, mc, opts, st.pos);
  st.redraw();
}

function renderFan(canvas, mc, opts, hover) {
  const { ctx, w, h } = fitCanvas(canvas);
  const bg = paintBg(ctx, w, h, opts);
  const years = mc && Array.isArray(mc.years) ? mc.years : [];
  const n = years.length;
  const Q = ['p5', 'p25', 'p50', 'p75', 'p95'];
  const ok = n >= 2 && Q.every((k) => Array.isArray(mc[k]) && mc[k].length === n);
  if (!ok) { placeholder(ctx, w, h, 'まだ未来が見えない'); return; }
  const curAge = isFinite(opts.currentAge) ? opts.currentAge : isFinite(opts.age) ? opts.age : 22;
  let ages;
  if (Array.isArray(opts.ages) && opts.ages.length === n) ages = opts.ages;
  else if (years[0] >= 1000) ages = years.map((y) => curAge + (y - years[0]));
  else if (years[0] >= 15) ages = years.slice();
  else ages = years.map((y) => curAge + y);

  let vMin = 0;
  let vMax = 1;
  let minPos = Infinity;
  for (const k of Q) for (const v of mc[k]) {
    if (!isFinite(v)) continue;
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
    if (v > 0) minPos = Math.min(minPos, v);
  }
  const useAsinh = isFinite(minPos) && vMax / minPos > 100;
  const C = 1000;
  const tf = useAsinh ? (v) => Math.asinh(v / C) : (v) => v;
  let ticks;
  let tMin;
  let tMax;
  if (useAsinh) {
    const cands = [0];
    for (let k = 3; k <= 9; k++) for (const m of [1, 3]) { cands.push(m * 10 ** k); cands.push(-m * 10 ** k); }
    ticks = cands.filter((v) => v >= vMin && v <= vMax * 1.05).sort((a, b) => a - b);
    if (ticks.length > 7) ticks = ticks.filter((v) => v === 0 || /^1/.test(String(Math.abs(v))));
    tMin = tf(vMin);
    tMax = tf(vMax * 1.05);
  } else {
    const nt = niceTicks(vMin, vMax * 1.05, h < 200 ? 4 : 5);
    ticks = nt.ticks;
    tMin = nt.min;
    tMax = nt.max;
  }
  const tickLabels = ticks.map(fmtMan);
  const padL = Math.ceil(measureMax(ctx, tickLabels, font(10)) + 10);
  const padT = 24;
  const padB = 20;
  const padR = 12;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);
  const a0 = Math.min(curAge, ages[0]);
  const a1 = Math.max(ages[n - 1], a0 + 1);
  const xOf = (age) => padL + (plotW * (age - a0)) / (a1 - a0);
  const yOf = (v) => padT + plotH * (1 - (tf(v) - tMin) / (tMax - tMin));
  const xs = ages.map(xOf);

  ctx.font = font(10);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ticks.forEach((v, k) => {
    const y = yOf(v);
    hline(ctx, padL, w - padR, y, v === 0 ? alpha(THEME.muted, 0.45) : alpha(THEME.rule, 0.7));
    ctx.fillStyle = THEME.muted;
    ctx.fillText(tickLabels[k], padL - 6, y);
  });
  const at = ageTicks(a0, a1, plotW);
  ctx.textAlign = 'center';
  for (const a of at) {
    const x = xOf(a);
    vline(ctx, x, padT, padT + plotH, alpha(THEME.rule, 0.35));
    ctx.fillStyle = THEME.muted;
    ctx.fillText(`${a}歳`, x, h - padB / 2);
  }

  band(ctx, xs, mc.p95.map(yOf), mc.p5.map(yOf), alpha(THEME.muted, 0.18));
  band(ctx, xs, mc.p75.map(yOf), mc.p25.map(yOf), alpha(THEME.muted, 0.32));
  const p50y = mc.p50.map(yOf);
  polyline(ctx, xs, p50y, THEME.gold, 2);

  // 現在年齢マーカー
  if (curAge >= a0 && curAge <= a1) {
    const x = xOf(curAge);
    vline(ctx, x, padT, padT + plotH, alpha(THEME.text, 0.5), 1, [3, 3]);
    ctx.font = font(9, 'label');
    ctx.fillStyle = THEME.muted;
    ctx.textAlign = 'left';
    ctx.fillText(`今 ${curAge}歳`, x + 4, padT + plotH - 8);
  }
  // 終端ラベル（中央値は必ず、p95/p5 は重ならなければ）
  {
    const li = n - 1;
    const ends = [
      { v: mc.p50[li], y: p50y[li], bold: true, color: THEME.text },
      { v: mc.p95[li], y: yOf(mc.p95[li]), color: THEME.muted },
      { v: mc.p5[li], y: yOf(mc.p5[li]), color: THEME.muted },
    ];
    const placed = [];
    ctx.textAlign = 'right';
    for (const e of ends) {
      if (placed.some((p) => Math.abs(p - e.y) < 13)) continue;
      ctx.font = e.bold ? font(11, 'num', 'bold') : font(10);
      const label = fmtMan(e.v);
      const tw = ctx.measureText(label).width;
      const ty = Math.max(padT + 7, Math.min(padT + plotH - 7, e.y));
      ctx.fillStyle = alpha(bg, 0.8);
      ctx.fillRect(xs[li] - 4 - tw - 3, ty - 7, tw + 6, 14);
      ctx.fillStyle = e.color;
      ctx.fillText(label, xs[li] - 4, ty);
      placed.push(ty);
    }
  }
  // 凡例 + 破産確率
  const items = [
    { label: 'p5–p95', color: THEME.muted, kind: 'rect', alpha: 0.25 },
    { label: 'p25–p75', color: THEME.muted, kind: 'rect', alpha: 0.5 },
    { label: '中央値', color: THEME.gold, kind: 'line' },
  ];
  const legendEnd = drawLegend(ctx, padL, 11, items, w - padR);
  if (isFinite(mc.ruinProb)) {
    const rp = mc.ruinProb;
    const txt = `破産確率 ${fmtPct(rp, rp < 0.1 ? 1 : 0)}`;
    ctx.font = font(10, 'label');
    const tw = ctx.measureText(txt).width;
    const nTxt = isFinite(mc.n) ? `  n=${mc.n}` : '';
    ctx.font = font(9);
    const nw = ctx.measureText(nTxt).width;
    if (legendEnd + tw + nw < w - padR) {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.muted;
      ctx.fillText(nTxt, w - padR, 11);
      ctx.font = font(10, 'label');
      ctx.fillStyle = rp >= 0.1 ? THEME.accent : THEME.text;
      ctx.fillText(txt, w - padR - nw, 11);
    } else {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.font = font(10, 'label');
      ctx.fillStyle = rp >= 0.1 ? THEME.accent : THEME.text;
      ctx.fillText(txt, w - padR, padT + 8);
    }
  }
  // ホバー
  if (hover && hover.x >= padL - 4 && hover.x <= w - padR + 4 && hover.y >= 0 && hover.y <= h) {
    const i = nearestIndex(xs, hover.x);
    vline(ctx, xs[i], padT, padT + plotH, alpha(THEME.muted, 0.6));
    dot(ctx, xs[i], p50y[i], 3.5, THEME.gold, bg, 2);
    const rows = [{ text: `${ages[i]}歳`, color: THEME.muted }];
    rows.push({ label: 'p95', value: fmtMan(mc.p95[i]) });
    rows.push({ label: 'p75', value: fmtMan(mc.p75[i]) });
    rows.push({ label: '中央値', value: fmtMan(mc.p50[i]), bold: true, key: { color: THEME.gold, kind: 'line' } });
    rows.push({ label: 'p25', value: fmtMan(mc.p25[i]) });
    rows.push({ label: 'p5', value: fmtMan(mc.p5[i]), color: mc.p5[i] < 0 ? THEME.accent : THEME.text });
    drawTooltip(ctx, w, h, xs[i], hover.y, rows, bg);
  }
}

// ---------------------------------------------------------------------------
// 4. スパークライン
// ---------------------------------------------------------------------------

/**
 * 小さな折れ線 + 終端の点。軸なし。
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} values
 * @param {{color?:string, bg?:string|null, baseline?:number}} [opts] bg 既定は透明。baseline を渡すとその値に破線。
 */
export function drawSparkline(canvas, values, opts = {}) {
  const { ctx, w, h } = fitCanvas(canvas);
  const bg = paintBg(ctx, w, h, { bg: opts.bg === undefined ? null : opts.bg });
  const v = (Array.isArray(values) ? values : []).filter((x) => isFinite(x));
  const color = opts.color || THEME.positive;
  const pad = 4;
  if (v.length === 0) return;
  let min = Math.min(...v);
  let max = Math.max(...v);
  if (isFinite(opts.baseline)) { min = Math.min(min, opts.baseline); max = Math.max(max, opts.baseline); }
  if (max === min) { max += 1; min -= 1; }
  const xOf = (i) => (v.length === 1 ? w / 2 : pad + ((w - pad * 2) * i) / (v.length - 1));
  const yOf = (x) => pad + (h - pad * 2) * (1 - (x - min) / (max - min));
  if (isFinite(opts.baseline)) hline(ctx, 0, w, yOf(opts.baseline), alpha(THEME.muted, 0.5));
  if (v.length > 1) polyline(ctx, v.map((_, i) => xOf(i)), v.map(yOf), color, 2);
  dot(ctx, xOf(v.length - 1), yOf(v[v.length - 1]), 3, color, bg, 2);
}

// ---------------------------------------------------------------------------
// 5. レーダー（富 / 楽 / 学 / 縁）
// ---------------------------------------------------------------------------

const RADAR_AXES = [
  { key: 'wealth', label: '富' },
  { key: 'fun', label: '楽' },
  { key: 'learning', label: '学' },
  { key: 'network', label: '縁' },
];

/**
 * 4 軸レーダー（富 / 楽 / 学 / 縁、各 0–1000）。青磁の半透明で塗る。
 * @param {HTMLCanvasElement} canvas
 * @param {{wealth:number, fun:number, learning:number, network:number, total?:number}} score computeScore() の出力
 * @param {{bg?:string|null, max?:number}} [opts]
 */
export function drawRadar(canvas, score, opts = {}) {
  const { ctx, w, h } = fitCanvas(canvas);
  const bg = paintBg(ctx, w, h, opts);
  const max = opts.max || 1000;
  const sc = score || {};
  const vals = RADAR_AXES.map((a) => Math.max(0, Math.min(1, (isFinite(sc[a.key]) ? sc[a.key] : 0) / max)));
  const cx = w / 2;
  const cy = h / 2 + 2;
  ctx.font = font(10);
  const labelRoom = 40;
  const R = Math.max(20, Math.min(w / 2 - labelRoom - 6, h / 2 - 26));
  const pt = (k, r) => {
    const ang = -Math.PI / 2 + (k * Math.PI) / 2;
    return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
  };
  // グリッド（同心のひし形）
  for (const f of [0.25, 0.5, 0.75, 1]) {
    ctx.strokeStyle = f === 1 ? alpha(THEME.muted, 0.5) : alpha(THEME.rule, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const [x, y] = pt(k, R * f);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  for (let k = 0; k < 4; k++) {
    const [x, y] = pt(k, R);
    ctx.strokeStyle = alpha(THEME.rule, 0.9);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  // データ
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const [x, y] = pt(k, R * vals[k]);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = alpha(THEME.positive, 0.28);
  ctx.fill();
  ctx.strokeStyle = THEME.positive;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  for (let k = 0; k < 4; k++) {
    const [x, y] = pt(k, R * vals[k]);
    dot(ctx, x, y, 3, THEME.positive, bg, 2);
  }
  // ラベル + 値
  ctx.textBaseline = 'middle';
  const anchors = [
    { x: cx, y: cy - R - 12, align: 'center' },
    { x: cx + R + 8, y: cy, align: 'left' },
    { x: cx, y: cy + R + 12, align: 'center' },
    { x: cx - R - 8, y: cy, align: 'right' },
  ];
  for (let k = 0; k < 4; k++) {
    const a = anchors[k];
    const label = RADAR_AXES[k].label;
    const val = String(Math.round(isFinite(sc[RADAR_AXES[k].key]) ? sc[RADAR_AXES[k].key] : 0));
    ctx.font = font(12, 'label');
    const lw = ctx.measureText(label).width;
    ctx.font = font(10);
    const vw = ctx.measureText(val).width;
    const total = lw + 4 + vw;
    let x0 = a.align === 'center' ? a.x - total / 2 : a.align === 'left' ? a.x : a.x - total;
    x0 = Math.max(2, Math.min(w - total - 2, x0));
    ctx.textAlign = 'left';
    ctx.font = font(12, 'label');
    ctx.fillStyle = THEME.text;
    ctx.fillText(label, x0, a.y);
    ctx.font = font(10);
    ctx.fillStyle = THEME.muted;
    ctx.fillText(val, x0 + lw + 4, a.y + 1);
  }
}
