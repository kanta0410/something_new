// market.js — 反射的エージェントベース市場（Brock–Hommes 型）
//
// 参加者は「ファンダメンタリスト」(本源価値 f への回帰を期待) と「チャーティスト」(直近トレンドを外挿)。
// 両者のシェアは直近の成績で入れ替わる（ロジット切替）ため、内生的にバブルと暴落が発生する。
// 内部は月次 12 ステップ。対数価格 p、対数本源価値 f、乖離 x = p − f。
// 乱数は必ず渡された rng（rng.js）を使う。Math.random は使わない。
//
// 月次更新（DESIGN §6。定数は受入基準を満たすようキャリブレーション済み）:
//   f_{t+1} = f_t + (μ_f − σ_f²/2)/12 + σ_f/√12 · ε
//   x_t     = p_t − f_t
//   E_f     = −φ · x_t · F(x_t)
//             F = (1+phiAsym)·(1 + stretchK·max(0, x−stretchX0))            (x > 0: 割高側)
//               = 1 + stretchDown·stretchK·max(0, −x−stretchX0)              (x < 0: 割安側)
//   E_c     = g · Δp_t · (Δp_t < 0 ? 1 + gDown : 1)
//   p_{t+1} = p_t + (f_{t+1} − f_t)·passThrough + λ(w_f·E_f + w_c·E_c) + σ_n(1 + volLev·max(0,x_t)) ε_n
//   U_f     = m·U_f + (1−m)·(−x_t · Δp_{t+1})
//   U_c     = m·U_c + (1−m)·(Δp_t · Δp_{t+1})
//   w_c     = clamp(1 / (1 + exp(−β (U_c − U_f))), wcMin, wcMax)
//   配当利回り(年率) = divYield · exp(−x_t)
// 金利（月次、年率換算の係数を 1/12 スケール）:
//   r_{t+1} = r_t + (rateRevert/12)(rateMean − r_t) + (rateWc/12)(w_c − 0.5) + rateSigma/√12 · ε   clamp [rateMin, rateMax]
//   住宅ローン金利 = r + mortgageSpread、預金金利 = r × depositMult

/**
 * 市場モデルの既定パラメータ（DESIGN §6 を起点にキャリブレーション済み）。
 * @type {Readonly<Record<string, number>>}
 */
export const DEFAULT_PARAMS = Object.freeze({
  // 本源価値プロセス（年率）
  muF: 0.07,
  sigmaF: 0.10,
  // 価格ダイナミクス
  phi: 0.05,          // ファンダメンタリストの回帰強度
  phiAsym: 0.3,       // 割高側 (x>0) の回帰強度を (1+phiAsym) 倍（暴落を鋭くする非対称性）
  stretchK: 4.0,      // |x| > stretchX0 で回帰強度を 1 + stretchK·(|x|−stretchX0) 倍
  stretchX0: 0.2,     // 回帰強度が増し始める乖離
  stretchDown: 0.5,   // 割安側 (x<0) のストレッチ係数の割合（0 で割安側は線形 = 底は緩やかに回復）
  g: 0.8,            // チャーティストの外挿係数
  ecCap: 0.025,        // 外挿の飽和幅: E_c = g · ecCap · tanh(Δp / ecCap)（月 4% 超の変化は線形に外挿しない）
  gDown: 0.0,         // 下落トレンドの外挿を (1+gDown) 倍（パニック売り）
  lambda: 1.0,        // 市場の反応係数
  sigmaN: 0.025,      // 月次ノイズ
  volLev: 0.3,        // 割高時にノイズを増やす（σ_n · (1 + volLev·max(0,x))）
  passThrough: 0.9,   // 本源価値の変化が当月価格に反映される割合
  beta: 500,          // 切替の感応度
  memory: 0.8,        // 成績の記憶（1 に近いほど長期）
  wcMin: 0.05,
  wcMax: 0.85,
  divYield: 0.02,     // 乖離ゼロ時の配当利回り（年率）
  xClamp: 2.0,        // 安全弁: |x| をこの範囲に強制（通常は発動しない）
  // 暴落ジャンプ（反射性: 割高でチャーティストが多いほど崩壊確率が上がる）
  jumpBase: 0.010,    // 月次の基礎ジャンプ確率
  jumpX: 0.20,        // 乖離 x による追加確率: jumpX · max(0, x − jumpX0) · (0.5 + wc)
  jumpX0: 0.15,
  jumpMin: 0.15,      // ジャンプ幅（対数）の下限
  jumpMax: 0.32,      // ジャンプ幅（対数）の上限
  jumpFund: 0.65,      // ジャンプのうち本源価値にも反映される割合（暴落は実体経済の悪化を伴う）
  panicAdd: 0.09,     // ジャンプ直後に月次ジャンプ確率へ上乗せされる「パニック」
  panicDecay: 0.7,    // パニックの月次減衰
  bubbleX: 0.20,      // バブル判定の乖離しきい値
  // 金利（年率換算の係数。月次で 1/12 スケール）
  rate0: 0.015,
  rateMean: 0.02,
  rateRevert: 0.25,
  rateWc: 0.01,
  rateSigma: 0.004,
  rateMin: 0.001,
  rateMax: 0.08,
  mortgageSpread: 0.012,
  depositMult: 0.3,
  // 年次履歴の保持数
  seriesCap: 60,
});

const SQRT12 = Math.sqrt(12);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function logit(w) { return Math.log(w / (1 - w)); }

/**
 * @typedef {Object} YearResult
 * @property {number} totalReturn    年次トータルリターン（価格 + 配当）。= priceReturn + dividendYield
 * @property {number} priceReturn    年次価格リターン（index_end / index_start − 1）
 * @property {number} dividendYield  年初指数に対する年間配当の比率
 * @property {number} x              年末の対数乖離 p − f（>0 で割高）
 * @property {number} wc             年末のチャーティスト比率
 * @property {number[]} monthly      月末の指数水準 12 個（monthly[11] === market.index）
 * @property {number} vol            年率化した月次対数リターンの標準偏差
 * @property {boolean} crash         totalReturn < −0.25
 * @property {boolean} bubble        x > 0.35
 * @property {number} rate           年末の短期金利
 * @property {number} mortgageRate   住宅ローン金利 = rate + mortgageSpread
 * @property {number} depositRate    預金金利 = rate × depositMult
 */

/**
 * @typedef {Object} MarketState
 * @property {number} p        対数価格
 * @property {number} f        対数本源価値
 * @property {number} pPrev    前月の対数価格（Δp 用）
 * @property {number} uf       ファンダメンタリストの累積成績
 * @property {number} uc       チャーティストの累積成績
 * @property {number} wc       チャーティスト比率
 * @property {number} rate     短期金利（年率）
 * @property {number} index    指数水準（開始 100）
 * @property {number} year     経過年数
 * @property {Record<string, number>} params
 * @property {YearResult|null} last
 * @property {{index:number[], fundamental:number[], wc:number[], x:number[]}} series 年次履歴（作成時の点を含む。直近 seriesCap 年）
 */

/**
 * 市場状態を作る。index=100、x=0 から開始。初期のチャーティスト比率は rng で 0.35〜0.65 に散らす。
 * @param {import('./rng.js').Rng|{next():number, normal():number}} rng
 * @param {Partial<typeof DEFAULT_PARAMS>} [params]
 * @returns {MarketState}
 */
export function createMarket(rng, params) {
  const P = { ...DEFAULT_PARAMS, ...(params || {}) };
  const wc0 = clamp(0.35 + 0.3 * rng.next(), P.wcMin, P.wcMax);
  const m = {
    p: 0,
    f: 0,
    pPrev: 0,
    uf: 0,
    uc: logit(wc0) / P.beta,
    wc: wc0,
    rate: clamp(P.rate0, P.rateMin, P.rateMax),
    panic: 0,
    index: 100,
    year: 0,
    params: P,
    last: null,
    series: { index: [100], fundamental: [100], wc: [wc0], x: [0] },
  };
  return m;
}

/**
 * 1 か月進める（mutates）。
 * @param {MarketState} market
 * @param {{next():number, normal():number}} rng
 * @returns {{logRet:number, dividend:number}} logRet = 当月の対数価格変化、dividend = 当月の配当（月初指数に対する比率 = 年率利回り/12）
 */
export function stepMonth(market, rng) {
  const P = market.params;
  const p = market.p, f = market.f;
  const x = p - f;
  const dpPrev = p - market.pPrev;

  // 当月配当（月初の乖離に基づく）
  const dividend = (P.divYield * Math.exp(-x)) / 12;

  // 期待形成
  const over = Math.max(0, Math.abs(x) - P.stretchX0);
  const force = x > 0
    ? (1 + P.phiAsym) * (1 + P.stretchK * over)
    : 1 + P.stretchDown * P.stretchK * over;
  const Ef = -P.phi * x * force;
  const dpSat = P.ecCap > 0 ? P.ecCap * Math.tanh(dpPrev / P.ecCap) : dpPrev;
  const Ec = P.g * dpSat * (dpPrev < 0 ? 1 + P.gDown : 1);

  // 本源価値
  const df = (P.muF - 0.5 * P.sigmaF * P.sigmaF) / 12 + (P.sigmaF / SQRT12) * rng.normal();
  let fNext = f + df;

  // 価格
  const wc = market.wc, wf = 1 - wc;
  const sigma = P.sigmaN * (1 + P.volLev * Math.max(0, x));
  let pNext = p + df * P.passThrough + P.lambda * (wf * Ef + wc * Ec) + sigma * rng.normal();

  // 暴落ジャンプ: 割高でチャーティスト比率が高いほど起きやすい（反射性の崩壊）
  const jumpProb = P.jumpBase + P.jumpX * Math.max(0, x - P.jumpX0) * (0.5 + wc) + (market.panic || 0);
  let jumped = false;
  if (rng.next() < jumpProb) {
    const size = P.jumpMin + (P.jumpMax - P.jumpMin) * rng.next();
    pNext -= size;
    fNext -= size * P.jumpFund;
    jumped = true;
    market.panic = (market.panic || 0) * P.panicDecay + P.panicAdd;
  } else {
    market.panic = (market.panic || 0) * P.panicDecay;
  }

  // 安全弁（通常は発動しない）
  const xNext = pNext - fNext;
  if (xNext > P.xClamp) pNext = fNext + P.xClamp;
  else if (xNext < -P.xClamp) pNext = fNext - P.xClamp;

  const dp = pNext - p;

  // 成績更新と切替
  const mem = P.memory;
  market.uf = mem * market.uf + (1 - mem) * (-x * dp);
  market.uc = mem * market.uc + (1 - mem) * (dpPrev * dp);
  const z = P.beta * (market.uc - market.uf);
  const wcRaw = z > 40 ? 1 : z < -40 ? 0 : 1 / (1 + Math.exp(-z));
  market.wc = clamp(wcRaw, P.wcMin, P.wcMax);

  // 金利（月次、年率係数を 1/12 スケール）
  const r = market.rate;
  const rNext = r + (P.rateRevert / 12) * (P.rateMean - r) + (P.rateWc / 12) * (market.wc - 0.5) + (P.rateSigma / SQRT12) * rng.normal();
  market.rate = clamp(rNext, P.rateMin, P.rateMax);

  market.pPrev = p;
  market.p = pNext;
  market.f = fNext;
  market.index = 100 * Math.exp(pNext);

  return { logRet: dp, dividend, jumped };
}

/**
 * 1 年（12 か月）進める（mutates）。market.last と market.series を更新する。
 * @param {MarketState} market
 * @param {{next():number, normal():number}} rng
 * @returns {YearResult}
 */
export function stepYear(market, rng) {
  const P = market.params;
  const startIndex = market.index;
  const monthly = new Array(12);
  const logRets = new Array(12);
  let divAmount = 0;
  for (let i = 0; i < 12; i++) {
    const before = market.index;
    const r = stepMonth(market, rng);
    divAmount += before * r.dividend;
    logRets[i] = r.logRet;
    monthly[i] = market.index;
  }
  let mean = 0;
  for (let i = 0; i < 12; i++) mean += logRets[i];
  mean /= 12;
  let ss = 0;
  for (let i = 0; i < 12; i++) { const d = logRets[i] - mean; ss += d * d; }
  const vol = Math.sqrt(ss / 11) * SQRT12;

  const priceReturn = market.index / startIndex - 1;
  const dividendYield = divAmount / startIndex;
  const totalReturn = priceReturn + dividendYield;
  const x = market.p - market.f;
  const rate = market.rate;

  const result = {
    totalReturn,
    priceReturn,
    dividendYield,
    x,
    wc: market.wc,
    monthly,
    vol,
    crash: totalReturn < -0.25,
    bubble: x > P.bubbleX,
    rate,
    mortgageRate: rate + P.mortgageSpread,
    depositRate: rate * P.depositMult,
  };

  market.year += 1;
  market.last = result;
  const s = market.series;
  s.index.push(market.index);
  s.fundamental.push(100 * Math.exp(market.f));
  s.wc.push(market.wc);
  s.x.push(x);
  const cap = P.seriesCap;
  if (s.index.length > cap) {
    const drop = s.index.length - cap;
    s.index.splice(0, drop);
    s.fundamental.splice(0, drop);
    s.wc.splice(0, drop);
    s.x.splice(0, drop);
  }
  return result;
}

/**
 * 現在の局面ラベル。
 * 底値: x < −0.25 / 暴落: 直近年が crash / バブル: x > 0.35 / 過熱: wc > 0.65 かつ x > 0.15 /
 * 調整: 直近年のトータルリターン < −0.10 / それ以外: 平穏
 * @param {MarketState} market
 * @returns {'平穏'|'過熱'|'バブル'|'調整'|'暴落'|'底値'}
 */
export function regimeLabel(market) {
  const x = market.p - market.f;
  const last = market.last;
  if (x < -0.25) return '底値';
  if (last && last.crash) return '暴落';
  if (x > market.params.bubbleX) return 'バブル';
  if (market.wc > 0.6 && x > 0.10) return '過熱';
  if (last && last.totalReturn < -0.10) return '調整';
  return '平穏';
}

/**
 * 深いコピー（モンテカルロ用）。元の市場と独立に進められる。
 * @param {MarketState} market
 * @returns {MarketState}
 */
export function cloneMarket(market) {
  const last = market.last
    ? { ...market.last, monthly: market.last.monthly.slice() }
    : null;
  return {
    p: market.p,
    f: market.f,
    pPrev: market.pPrev,
    uf: market.uf,
    uc: market.uc,
    wc: market.wc,
    rate: market.rate,
    panic: market.panic || 0,
    index: market.index,
    year: market.year,
    params: { ...market.params },
    last,
    series: {
      index: market.series.index.slice(),
      fundamental: market.series.fundamental.slice(),
      wc: market.series.wc.slice(),
      x: market.series.x.slice(),
    },
  };
}
