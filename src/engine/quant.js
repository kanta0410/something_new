// quant.js — クオンツ: Kelly 基準、履歴統計、モンテカルロ扇形図、解放レベル。
// DESIGN.md §8 / API.md の契約に従う。副作用なし（state を mutate しない）。乱数は rng.js のみ。
import { createRng } from './rng.js';
import { cloneMarket, stepYear } from './market.js';
import { level } from './skills.js';

/** 事前分布（履歴が 5 年未満のとき混合）。 */
const PRIOR_MU = 0.06;
const PRIOR_SIGMA = 0.20;
const PRIOR_N = 5;
/** Kelly 表示クランプ。 */
const KELLY_MIN = -1;
const KELLY_MAX = 3;
/** Sharpe 用の無リスク金利。 */
const SHARPE_RATE = 0.01;

/** モンテカルロ近似の定数（DESIGN §3 / §7 の簡略版）。 */
const MC = {
  salaryGrowth: 0.03,      // 55 歳まで
  salaryDecline: 0.02,     // 55〜59 歳
  retireAge: 60,
  salaryCap: 2000,
  livingBase: 240,
  livingPerFunTime: 1.2,
  livingOldFactor: 1.2,    // 40 歳以上
  hustleBase: 0.4,
  hustlePerLevel: 0.08,
  propTrend: 0.01,
  propBeta: 0.3,
  propVol: 0.06,
  propRentFollow: 0.5,     // 家賃は価値成長の半分で追随
  propMaintenance: 0.01,
  propVacancy: 0.08,
  loanYears: 25,
  forcedSaleHaircut: 0.2,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function mean(xs) {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : 0;
}

/** 標本標準偏差（n−1）。n < 2 なら 0。 */
function sampleStd(xs, m = mean(xs)) {
  const n = xs.length;
  if (n < 2) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) { const d = xs[i] - m; s += d * d; }
  return Math.sqrt(s / (n - 1));
}

/**
 * Kelly 基準。年次リターン配列から μ̂・σ̂ を推定し、f* = (μ̂ − r)/σ̂² を返す。
 * 履歴が 5 年未満なら事前分布（μ=0.06, σ=0.20）と重み n/5 で線形混合する。
 * full / half は表示用に [−1, 3] へクランプ済み。
 * @param {number[]} returns 年次トータルリターン（0.08 = +8%）
 * @param {number} rate 無リスク金利
 * @returns {{ mu:number, sigma:number, full:number, half:number, n:number, prior:boolean }}
 */
export function kelly(returns, rate = 0) {
  const xs = Array.isArray(returns) ? returns.filter(Number.isFinite) : [];
  const n = xs.length;
  const muHat = n > 0 ? mean(xs) : PRIOR_MU;
  const sigmaHat = n > 1 ? sampleStd(xs, muHat) : PRIOR_SIGMA;
  const prior = n < PRIOR_N;
  const w = prior ? n / PRIOR_N : 1;
  const mu = w * muHat + (1 - w) * PRIOR_MU;
  const sigma = w * sigmaHat + (1 - w) * PRIOR_SIGMA;
  const variance = sigma * sigma;
  const excess = mu - (Number.isFinite(rate) ? rate : 0);
  let raw;
  if (variance < 1e-12) raw = excess > 0 ? Infinity : excess < 0 ? -Infinity : 0;
  else raw = excess / variance;
  const full = clamp(raw, KELLY_MIN, KELLY_MAX);
  const half = clamp(raw / 2, KELLY_MIN, KELLY_MAX);
  return { mu, sigma, full, half, n, prior };
}

/**
 * 履歴統計。純資産系列から CAGR・年率 vol（対数リターン）・Sharpe（r=1%）・最大ドローダウン・最悪/最良年。
 * 計算不能な値（純資産が非正、記録が 2 年未満）は 0 / null で返し、NaN は返さない。
 * @param {Array<{year:number, netWorth:number, marketReturn?:number}>} history
 * @returns {{ cagr:number, vol:number, sharpe:number, maxDrawdown:number,
 *   worstYear:null|{year:number, ret:number, marketReturn:number}, bestYear:null|{year:number, ret:number, marketReturn:number}, years:number }}
 */
export function stats(history) {
  const h = Array.isArray(history) ? history : [];
  const years = h.length;
  const nw = new Float64Array(years);
  for (let i = 0; i < years; i++) nw[i] = Number(h[i]?.netWorth) || 0;

  const logs = [];
  let worstYear = null;
  let bestYear = null;
  for (let t = 1; t < years; t++) {
    const a = nw[t - 1];
    const b = nw[t];
    if (a <= 0) continue;                      // 前年非正 → リターン未定義
    const ret = b / a - 1;
    if (b > 0) logs.push(Math.log(b / a));
    const rec = { year: h[t].year, ret, marketReturn: Number(h[t].marketReturn) || 0 };
    if (worstYear === null || ret < worstYear.ret) worstYear = rec;
    if (bestYear === null || ret > bestYear.ret) bestYear = rec;
  }

  let cagr = 0;
  if (years >= 2 && nw[0] > 0 && nw[years - 1] > 0) {
    cagr = Math.pow(nw[years - 1] / nw[0], 1 / (years - 1)) - 1;
  }
  const vol = logs.length >= 2 ? sampleStd(logs) : 0;
  const sharpe = vol > 0 ? (mean(logs) - SHARPE_RATE) / vol : 0;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (let i = 0; i < years; i++) {
    if (nw[i] > peak) peak = nw[i];
    if (peak > 0) {
      const dd = (peak - nw[i]) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  return { cagr, vol, sharpe, maxDrawdown, worstYear, bestYear, years };
}

/**
 * 履歴から市場リターン配列を抜き出す（kelly の入力用）。
 * @param {Array<{marketReturn?:number}>} history
 * @returns {number[]}
 */
export function returnsFromHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const r of history) {
    const v = r?.marketReturn;
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function withCommas(intValue) {
  return String(intValue).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 万円の表示。2400 → '2,400万'、12000 → '1.2億'、1,234,567 → '123億'、負は '−' 前置。
 * @param {number} v 万円
 * @returns {string}
 */
export function formatMoney(v) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const man = Math.round(abs);
  let s;
  if (man < 10000) {
    s = withCommas(man) + '万';
  } else {
    const oku = abs / 10000;
    if (oku >= 100) s = withCommas(Math.round(oku)) + '億';
    else s = oku.toFixed(1).replace(/\.0$/, '') + '億';
  }
  return (v < 0 && man > 0 ? '−' : '') + s;
}

/**
 * 分位（線形補間）。sorted は昇順ソート済み。
 * @param {Float64Array} sorted
 * @param {number} q 0..1
 */
function quantile(sorted, q) {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * モンテカルロ扇形図。現在の采配を固定し、市場モデルを経路ごとに新規 RNG（createRng(seed+i)）で回して
 * 純資産の分位と破産確率を返す。
 * 近似: 給与は 55 歳まで +3%/年、59 歳まで −2%/年、60 歳以降 0（上限 2,000万）。手取り = 給与×(1−t)、
 * t = 0.15 + 0.15·clamp((給与−300)/1500, 0, 1)。副業は現在のスキルで一定。生活費 = (240 + 1.2·fun時間)×(40 歳以上 1.2)。
 * 先取り貯蓄 = 手取り × savingsRate を stockAlloc で株・現金に配分。株は市場 totalReturn、現金は預金金利で複利。
 * 物件は log value += 0.01 + 0.3·(ret−0.05) + 0.06ε、家賃は半分で追随、ローンは 25 年元利均等（変動金利）、
 * CF = rent·0.92 − 0.01·value − 利息 − 元本。破産 = 現金+株 + Σ(0.8·value − loan) < 0（強制売却 −20% 後の純資産 < 0）。
 * 破産した経路はその時点の純資産で固定される。
 * @param {object} state GameState
 * @param {object} decisions Decisions
 * @param {{ n?:number, years?:number, seed?:number }} [opts]
 * @returns {{ years:number[], ages:number[], p5:number[], p25:number[], p50:number[], p75:number[], p95:number[], ruinProb:number, n:number }}
 */
export function monteCarlo(state, decisions = {}, opts = {}) {
  const n = Math.max(1, Math.floor(opts.n ?? 400));
  const age0 = state?.life?.age ?? 22;
  const year0 = state?.life?.year ?? 2026;
  const Y = Math.max(1, Math.floor(opts.years ?? (100 - age0)));
  const seed = (opts.seed ?? ((state?.seed ?? 1) + 1000003)) >>> 0;

  const d = decisions || {};
  const savingsRate = clamp(Number(d.savingsRate) || 0, 0, 1);
  const stockAlloc = clamp(Number(d.stockAlloc) || 0, 0, 1);
  const funTime = Math.max(0, Number(d.time?.fun) || 0);
  const hustleTime = Math.max(0, Number(d.time?.hustle) || 0);
  const employed = state?.work?.employed !== false && !d.quitJob;
  const readingL = level(state?.skills?.reading?.xp ?? 0);
  const commL = level(state?.skills?.comm?.xp ?? 0);
  const hustle = hustleTime * (MC.hustleBase + MC.hustlePerLevel * readingL + MC.hustlePerLevel * commL);

  // 年次の確定的キャッシュフロー（給与経路）を事前計算。
  const toCash = new Float64Array(Y);
  const toStocks = new Float64Array(Y);
  let salary = employed ? Math.max(0, Number(state?.work?.salary) || 0) : 0;
  for (let k = 0; k < Y; k++) {
    const age = age0 + k;
    if (k > 0) {
      if (age >= MC.retireAge) salary = 0;
      else if (age >= 55) salary *= 1 - MC.salaryDecline;
      else salary *= 1 + MC.salaryGrowth;
      salary = Math.min(salary, MC.salaryCap);
    }
    const tax = 0.15 + 0.15 * clamp((salary - 300) / 1500, 0, 1);
    const net = salary * (1 - tax) + hustle;
    const living = (MC.livingBase + MC.livingPerFunTime * funTime) * (age >= 40 ? MC.livingOldFactor : 1);
    const savings = net * savingsRate;
    toStocks[k] = savings * stockAlloc;
    toCash[k] = savings * (1 - stockAlloc) + (net - savings - living);
  }

  // 物件の初期値。
  const props = Array.isArray(state?.props) ? state.props : [];
  const P = props.length;
  const value0 = new Float64Array(P);
  const loan0 = new Float64Array(P);
  const rent0 = new Float64Array(P);
  const rate0 = new Float64Array(P);
  const bought = new Float64Array(P);
  for (let j = 0; j < P; j++) {
    const p = props[j];
    value0[j] = Math.max(0, Number(p.value) || 0);
    loan0[j] = Math.max(0, Number(p.loan) || 0);
    rent0[j] = Number.isFinite(p.rent) ? p.rent : value0[j] * 0.05;
    rate0[j] = Number.isFinite(p.rate) ? p.rate : 0.03;
    bought[j] = Number.isFinite(p.boughtYear) ? p.boughtYear : year0;
  }

  const cash0 = Number(state?.money?.cash) || 0;
  const stocks0 = Number(state?.money?.stocks) || 0;
  const market0 = state?.market;

  const nw = new Float64Array(Y * n);   // 年メジャー: nw[k*n + i]
  let ruined = 0;

  for (let i = 0; i < n; i++) {
    const rng = createRng((seed + i) >>> 0);
    const m = cloneMarket(market0);
    let cash = cash0;
    let stocks = stocks0;
    const val = value0.slice();
    const loan = loan0.slice();
    const rent = rent0.slice();
    let dead = false;
    let last = 0;

    for (let k = 0; k < Y; k++) {
      if (dead) { nw[k * n + i] = last; continue; }
      const yr = stepYear(m, rng);
      const ret = Number(yr.totalReturn) || 0;
      const dep = Number.isFinite(yr.depositRate) ? yr.depositRate : (Number(m.rate) || 0.02) * 0.3;
      const mort = Number.isFinite(yr.mortgageRate) ? yr.mortgageRate : (Number(m.rate) || 0.02) + 0.012;

      stocks *= 1 + ret;
      cash *= 1 + dep;
      cash += toCash[k];
      stocks += toStocks[k];

      let equity = 0;
      let forced = 0;
      for (let j = 0; j < P; j++) {
        const g = MC.propTrend + MC.propBeta * (ret - 0.05) + MC.propVol * rng.normal();
        const v = val[j] * Math.exp(g);
        val[j] = v;
        rent[j] *= Math.exp(MC.propRentFollow * g);
        let interest = 0;
        let principal = 0;
        const L = loan[j];
        if (L > 0) {
          const r = mort > 0 ? mort : rate0[j];
          const remaining = Math.max(1, MC.loanYears - (year0 + k - bought[j]));
          const pay = r > 1e-9 ? (L * r) / (1 - Math.pow(1 + r, -remaining)) : L / remaining;
          interest = L * r;
          principal = Math.min(L, Math.max(0, pay - interest));
          loan[j] = L - principal;
        }
        cash += rent[j] * (1 - MC.propVacancy) - MC.propMaintenance * v - interest - principal;
        equity += v - loan[j];
        forced += v * (1 - MC.forcedSaleHaircut) - loan[j];
      }

      const w = cash + stocks + equity;
      nw[k * n + i] = w;
      last = w;
      if (cash + stocks + forced < 0) { dead = true; ruined++; }
    }
  }

  const years = new Array(Y);
  const ages = new Array(Y);
  const p5 = new Array(Y);
  const p25 = new Array(Y);
  const p50 = new Array(Y);
  const p75 = new Array(Y);
  const p95 = new Array(Y);
  for (let k = 0; k < Y; k++) {
    years[k] = year0 + k;
    ages[k] = age0 + k;
    const col = nw.subarray(k * n, (k + 1) * n);
    col.sort();
    p5[k] = quantile(col, 0.05);
    p25[k] = quantile(col, 0.25);
    p50[k] = quantile(col, 0.5);
    p75[k] = quantile(col, 0.75);
    p95[k] = quantile(col, 0.95);
  }

  return { years, ages, p5, p25, p50, p75, p95, ruinProb: ruined / n, n };
}

/**
 * quant スキルのレベルをダッシュボード解放段階 0..4 に写像。
 * L0→0（純資産グラフ）/ L1-2→1（統計）/ L3-4→2（Kelly）/ L5-6→3（扇形図）/ L7+→4（市場生態系）。
 * @param {object} state GameState
 * @returns {0|1|2|3|4}
 */
export function unlockLevel(state) {
  const L = level(state?.skills?.quant?.xp ?? 0);
  if (L <= 0) return 0;
  if (L <= 2) return 1;
  if (L <= 4) return 2;
  if (L <= 6) return 3;
  return 4;
}
