// dom.js — 小さな DOM / 書式ヘルパー（UI 全パネル共通）
import { formatMoney } from '../../engine/game.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML エスケープ。 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 万円 → '2,400万' / '1.2億'（engine の formatMoney をそのまま使う）。 */
export function fmt(v) {
  if (!Number.isFinite(Number(v))) return '—';
  return formatMoney(Number(v));
}

/** 0.123 → '12.3%'。 */
export function pct(v, d = 1) {
  if (!Number.isFinite(Number(v))) return '—';
  return (Number(v) * 100).toFixed(d) + '%';
}

/** 符号付き %。0.12 → '+12.0%'、−0.08 → '−8.0%'。 */
export function spct(v, d = 1) {
  if (!Number.isFinite(Number(v))) return '—';
  const n = Number(v) * 100;
  return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d) + '%';
}

/** 符号付き万円。 */
export function sfmt(v) {
  if (!Number.isFinite(Number(v))) return '—';
  return (Number(v) >= 0 ? '+' : '') + fmt(v);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** textContent を変わったときだけ更新。 */
export function setText(el, text) {
  if (!el) return;
  const t = String(text);
  if (el.textContent !== t) el.textContent = t;
}

/** innerHTML を変わったときだけ更新（軽いキャッシュ）。 */
export function setHTML(el, html) {
  if (!el) return;
  if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
}

export function show(el, on = true) { if (el) el.hidden = !on; }

/** 正負で色クラス。 */
export function signClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

export function reducedMotion() {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
