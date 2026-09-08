// cityView.js — 6×6 の街キャンバス（依存なし・ESM）
//
// 推定利回りで塗り、未偵察はフォグ（斜線ハッチ + '?'）、所有は金の四角、売出しは朱の点（点滅）、
// 偵察先は青磁の破線枠、選択は朱 2px 枠、ホバーは発光。下端に凡例行。
// レイアウトは cityLayout() で一元化し、districtAt() がそれを使ってヒットテストする。

import { fitCanvas, THEME, FONT_NUM, FONT_LABEL, alpha, hatchPattern } from './charts.js';

const COLS = 6;
const ROWS = 6;
/** DESIGN §7 の利回り範囲。色の正規化に使う。 */
const YIELD_LO = 0.035;
const YIELD_HI = 0.13;
/** 種別 → 1 文字グリフ。 */
const GLYPH = { 駅前: '駅', 住宅: '住', 郊外: '郊', 湾岸: '湾', 山手: '山', 工業: '工' };
const EMPTY = new Set();

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 2 色を t で補間し alpha を付ける。 */
function mixA(hexA, hexB, t, a) {
  const p = hexToRgb(hexA);
  const q = hexToRgb(hexB);
  const k = clamp(t, 0, 1);
  const c = p.map((x, i) => Math.round(x + (q[i] - x) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/**
 * 推定利回り。district.estYield があればそれ、なければ yieldRate。
 * （地区の value/estimate は価格。家賃は観測できる前提で yieldRate を「推定利回り」とみなす）
 * @param {object} d
 * @returns {number}
 */
function estYield(d) {
  if (isFinite(d.estYield)) return d.estYield;
  if (isFinite(d.yieldRate)) return d.yieldRate;
  return YIELD_LO;
}

/** 利回り → 0..1。 */
function yieldT(y) { return clamp((y - YIELD_LO) / (YIELD_HI - YIELD_LO), 0, 1); }

/** 利回りタイルの塗り（藤 → 青磁、暗 → 明の単系列）。 */
function tileFill(t) { return mixA(THEME.muted, THEME.positive, t, 0.26 + 0.5 * t); }

/** 万円の短い表記（タイル内用）。「4200万」「1.2億」。 */
function fmtShort(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e4) {
    const oku = a / 1e4;
    return (oku >= 10 ? Math.round(oku) : oku.toFixed(1).replace(/\.0$/, '')) + '億';
  }
  return Math.round(a) + '万';
}

/**
 * レイアウト（drawCity と districtAt で共有）。
 * @param {number} w CSS px
 * @param {number} h CSS px
 * @returns {{size:number, ox:number, oy:number, legendH:number, legendY:number}}
 */
export function cityLayout(w, h) {
  const legendH = h >= 200 ? 22 : 18;
  const pad = 4;
  const gridW = w - pad * 2;
  const gridH = h - pad * 2 - legendH;
  const size = Math.max(6, Math.floor(Math.min(gridW / COLS, gridH / ROWS)));
  const ox = Math.floor((w - size * COLS) / 2);
  const oy = Math.floor(pad + Math.max(0, (gridH - size * ROWS) / 2));
  return { size, ox, oy, legendH, legendY: h - legendH / 2 };
}

/** 文字列を maxW に収まるまで末尾から削る（省略記号なし、ピクセル風）。 */
function fitText(ctx, s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '‥').width > maxW) t = t.slice(0, -1);
  return t + '‥';
}

/**
 * 街を描く。
 * @param {HTMLCanvasElement} canvas
 * @param {{districts:Array<{id:number,x:number,y:number,name:string,kind:string,value:number,yieldRate:number,visits:number,estimate:number,estError:number,knownSecrets:string[],owned:number,estYield?:number}>}} city CityState
 * @param {{selected?:number|null, hover?:number|null, ownedDistrictIds?:Set<number>, listingDistrictIds?:Set<number>, scoutTargets?:Set<number>, blink?:boolean, quantLevel?:number, bg?:string|null}} [opts]
 *   blink=false で売出し点を薄くする（点滅の OFF 相）。quantLevel ≥ 2 で偵察済みタイルに利回り % を併記。
 */
export function drawCity(canvas, city, opts = {}) {
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const bg = opts.bg === undefined ? THEME.surface : opts.bg;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  const L = cityLayout(w, h);
  const s = L.size;
  const ds = city && Array.isArray(city.districts) ? city.districts : [];
  const owned = opts.ownedDistrictIds || EMPTY;
  const listing = opts.listingDistrictIds || EMPTY;
  const scouts = opts.scoutTargets || EMPTY;
  const blink = opts.blink !== false;
  const q = opts.quantLevel | 0;
  const sel = opts.selected;
  const hov = opts.hover;

  const fName = clamp(Math.round(s / 5), 8, 11);
  const fNum = clamp(Math.round(s / 4.8), 8, 12);
  const fGlyph = clamp(Math.round(s / 5.2), 8, 11);
  const showYield = q >= 2 && s >= 48;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  // 盤面（タイルの隙間になる暗い板）
  ctx.fillStyle = THEME.ground;
  ctx.fillRect(L.ox - 1, L.oy - 1, s * COLS + 2, s * ROWS + 2);

  ctx.textBaseline = 'middle';
  let hovTile = null;
  for (const d of ds) {
    if (!d || !isFinite(d.x) || !isFinite(d.y)) continue;
    if (d.x < 0 || d.x >= COLS || d.y < 0 || d.y >= ROWS) continue;
    const x = L.ox + d.x * s;
    const y = L.oy + d.y * s;
    const fog = !(d.visits > 0);
    const t = yieldT(estYield(d));
    const ix = x + 1;
    const iy = y + 1;
    const is = s - 2;

    // 塗り
    if (fog) {
      ctx.fillStyle = mixA(THEME.ground, THEME.surface, 0.5, 1);
      ctx.fillRect(ix, iy, is, is);
      ctx.fillStyle = hatchPattern(ctx, THEME.muted, 0.28, dpr);
      ctx.fillRect(ix, iy, is, is);
    } else {
      ctx.fillStyle = tileFill(t);
      ctx.fillRect(ix, iy, is, is);
    }

    // 種別グリフ（左上、藤）
    ctx.font = `${fGlyph}px ${FONT_LABEL}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = fog ? alpha(THEME.muted, 0.8) : alpha(THEME.text, 0.7);
    const glyph = GLYPH[d.kind] || (d.kind ? String(d.kind)[0] : '');
    ctx.fillText(glyph, x + 4, y + 3 + fGlyph / 2);

    // 中央: 推定額（偵察済み）/ '?'（フォグ）
    if (fog) {
      ctx.font = `${clamp(Math.round(s / 3), 12, 20)}px ${FONT_LABEL}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = alpha(THEME.muted, 0.85);
      ctx.fillText('?', x + s / 2, y + s / 2 - (s >= 40 ? 2 : 0));
    } else {
      ctx.font = `bold ${fNum}px ${FONT_NUM}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = THEME.text;
      const cy = showYield ? y + s / 2 - 5 : y + s / 2 - (s >= 40 ? 1 : 0);
      ctx.fillText(fitText(ctx, fmtShort(d.estimate), is - 4), x + s / 2, cy);
      if (showYield) {
        ctx.font = `${Math.max(8, fNum - 2)}px ${FONT_NUM}`;
        ctx.fillStyle = alpha(THEME.text, 0.75);
        ctx.fillText((estYield(d) * 100).toFixed(1) + '%', x + s / 2, cy + fNum + 1);
      }
    }

    // 地区名（下端）
    if (s >= 30 && d.name) {
      ctx.font = `${fName}px ${FONT_LABEL}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = fog ? alpha(THEME.muted, 0.9) : alpha(THEME.text, 0.85);
      ctx.fillText(fitText(ctx, String(d.name), is - 6), x + s / 2, y + s - 4 - fName / 2);
    }

    // マーカー（右上）: 売出し点、所有の金四角
    let mx = x + s - 4;
    if (listing.has(d.id)) {
      ctx.fillStyle = alpha(THEME.accent, blink ? 1 : 0.35);
      ctx.beginPath();
      ctx.arc(mx - 4, y + 7, 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (blink) {
        ctx.strokeStyle = alpha(THEME.accent, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mx - 4, y + 7, 5.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      mx -= 11;
    }
    if (owned.has(d.id) || d.owned > 0) {
      ctx.fillStyle = THEME.gold;
      ctx.fillRect(mx - 8, y + 3, 8, 8);
      ctx.strokeStyle = THEME.ground;
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - 7.5, y + 3.5, 7, 7);
    }

    // 偵察先: 青磁の破線枠
    if (scouts.has(d.id)) {
      ctx.strokeStyle = THEME.positive;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 3.25, y + 3.25, s - 6.5, s - 6.5);
      ctx.setLineDash([]);
    }
    // 選択: 朱 2px
    if (sel != null && sel === d.id) {
      ctx.strokeStyle = THEME.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    }
    if (hov != null && hov === d.id) hovTile = { x, y };
  }

  // ホバー発光（最後に描いて隣に重ねる）
  if (hovTile) {
    ctx.save();
    ctx.shadowColor = alpha(THEME.text, 0.7);
    ctx.shadowBlur = 10;
    ctx.strokeStyle = alpha(THEME.text, 0.9);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(hovTile.x + 0.75, hovTile.y + 0.75, s - 1.5, s - 1.5);
    ctx.restore();
  }

  // 凡例
  drawLegendRow(ctx, L, w, dpr);
  ctx.restore();
}

function drawLegendRow(ctx, L, w, dpr) {
  const y = L.legendY;
  const f = L.legendH >= 22 ? 10 : 9;
  ctx.font = `${f}px ${FONT_LABEL}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const maxX = L.ox + L.size * COLS;
  let cx = L.ox;
  const gap = 10;
  const place = (swW, label, draw) => {
    const tw = ctx.measureText(label).width;
    if (cx + swW + 4 + tw > maxX + 1) return false;
    draw(cx);
    ctx.fillStyle = THEME.muted;
    ctx.font = `${f}px ${FONT_LABEL}`;
    ctx.fillText(label, cx + swW + 4, y);
    cx += swW + 4 + tw + gap;
    return true;
  };
  // フォグ
  place(12, '未偵察', (x) => {
    ctx.fillStyle = mixA(THEME.ground, THEME.surface, 0.5, 1);
    ctx.fillRect(x, y - 5, 12, 10);
    ctx.fillStyle = hatchPattern(ctx, THEME.muted, 0.5, dpr);
    ctx.fillRect(x, y - 5, 12, 10);
  });
  // 利回り グラデ
  place(40, '利回り 低→高', (x) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = tileFill(i / (n - 1));
      ctx.fillRect(x + (40 * i) / n, y - 5, 40 / n + 0.5, 10);
    }
  });
  // 所有
  place(10, '所有', (x) => {
    ctx.fillStyle = THEME.gold;
    ctx.fillRect(x + 1, y - 4, 8, 8);
  });
  // 売出し
  place(10, '売出し', (x) => {
    ctx.fillStyle = THEME.accent;
    ctx.beginPath();
    ctx.arc(x + 5, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
  // 偵察先
  place(12, '偵察先', (x) => {
    ctx.strokeStyle = THEME.positive;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(x + 0.75, y - 4.25, 10.5, 8.5);
    ctx.setLineDash([]);
  });
}

/**
 * クライアント座標 → 地区 id。drawCity と同じレイアウトを使う（dpr・CSS 拡縮に依存しない）。
 * @param {HTMLCanvasElement} canvas
 * @param {number} clientX
 * @param {number} clientY
 * @param {{districts:Array<{id:number,x:number,y:number}>}} city
 * @returns {number|null}
 */
export function districtAt(canvas, clientX, clientY, city) {
  if (!canvas || !city || !Array.isArray(city.districts)) return null;
  const r = canvas.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  const w = canvas.clientWidth || r.width;
  const h = canvas.clientHeight || r.height;
  const px = (clientX - r.left) * (w / r.width);
  const py = (clientY - r.top) * (h / r.height);
  const L = cityLayout(w, h);
  const col = Math.floor((px - L.ox) / L.size);
  const row = Math.floor((py - L.oy) / L.size);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  const d = city.districts.find((k) => k && k.x === col && k.y === row);
  return d ? d.id : null;
}
