// score.js — スコア、遺言、人生の要約（DESIGN §12, §13）
// 純粋関数のみ。state を mutate しない。

import { netWorth } from './life.js';
import { bookInfo } from './books.js';

/**
 * @typedef {Object} Score
 * @property {number} wealth   富  W = 1000·(1 − exp(−NW/30000))
 * @property {number} fun      楽  F = 1000·(1 − exp(−funTotal/2500))
 * @property {number} learning 学  L = 1000·(1 − exp(−learning/1500))
 * @property {number} network  縁  N = 1000·(1 − exp(−networkTotal/2500))
 * @property {number} brag     自慢 B = 1000·(1 − exp(−points/40))
 * @property {number} total
 */

/** スコア定数。 */
export const SCORE_PARAMS = Object.freeze({
  wealthScale: 30000,
  funScale: 2500,
  learningScale: 1500,
  networkScale: 2500,
  bragPerPoint: 20,
  cap: 1000,
});

/** 遺言の判定に使う要素の順（同点なら先勝ち）。 */
export const SCORE_COMPONENTS = Object.freeze(['wealth', 'fun', 'learning', 'network', 'brag']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const saturate = (v, scale) => Math.round(SCORE_PARAMS.cap * (1 - Math.exp(-Math.max(0, num(v)) / scale)));

/**
 * スコアを計算する。各要素は整数。富・楽・学・縁は 0..999、自慢は 20×点。
 * @param {any} state
 * @returns {Score}
 */
export function computeScore(state) {
  const P = SCORE_PARAMS;
  const m = state?.meters || {};
  const wealth = saturate(netWorth(state), P.wealthScale);
  const fun = saturate(m.funTotal, P.funScale);
  const learning = saturate(m.learning, P.learningScale);
  const network = saturate(m.networkTotal, P.networkScale);
  // 自慢: 最初は 25 点/pt、40 pt で 632、飽和 1000（買い付け連打だけでスコアが無限に伸びないように）
  const brag = Math.round(1000 * (1 - Math.exp(-Math.max(0, num(state?.brag?.points)) / 40)));
  return { wealth, fun, learning, network, brag, total: wealth + fun + learning + network + brag };
}

/**
 * スコアの最大要素。
 * @param {Score} score
 * @returns {'wealth'|'fun'|'learning'|'network'|'brag'}
 */
export function dominantComponent(score) {
  let best = SCORE_COMPONENTS[0];
  for (const k of SCORE_COMPONENTS) if (num(score?.[k]) > num(score?.[best])) best = k;
  return best;
}

/**
 * 遺言。死因 × 最大要素で 20 通り + 特例。すべて 12〜30 字。
 * @type {Record<string, Record<string, string>>}
 */
export const EPITAPHS = Object.freeze({
  bankrupt: Object.freeze({
    wealth: '金は消えた。学びは消えない。倍返しだ。',
    fun: '破産した。でも楽しかった。次も賭ける。',
    learning: '授業料は高かった。次は満点を取る。',
    network: '金は失った。人は残った。それで十分だ。',
    brag: '失敗の数だけ強くなる。転生して証明する。',
  }),
  voluntary: Object.freeze({
    wealth: '富は築いた。退屈になった。次へ行く。',
    fun: '笑って生きた。笑って転生する。',
    learning: '学び尽くした。次は実行の生だ。',
    network: '人に恵まれた。恩は次の生で返す。',
    brag: '恐れず賭けた。恐れず転生する。',
  }),
  illness: Object.freeze({
    wealth: '金は残した。次は体も残せ。',
    fun: '病に倒れたが、悔いはない。よく遊んだ。',
    learning: '知は残った。次の生で使え。',
    network: '病床は見舞いで埋まった。それが財産だ。',
    brag: '体は負けた。心は最後まで賭けていた。',
  }),
  natural: Object.freeze({
    wealth: '金は残した。次は笑え。',
    fun: '笑って生きた。金は次でいい。',
    learning: '学び続けた。実行は次の生で。',
    network: '人に恵まれた。それが一番の資産だった。',
    brag: '失敗を誇った。それが誇りだった。',
  }),
});

/** 何も賭けなかった人生（総合がごく低い）。 */
export const EPITAPH_IDLE = '何も賭けなかった。次は賭けろ。';
/** 死因不明のときの既定。 */
export const EPITAPH_DEFAULT = '人生はゲームだ。また賭けろ。';
/** 総合がこの値未満なら EPITAPH_IDLE。 */
export const IDLE_SCORE = 60;

/**
 * 遺言（12〜30 字）。死因と最大要素から選ぶ。
 * @param {any} state
 * @param {Score} [score] 省略時は computeScore(state)
 * @returns {string}
 */
export function epitaph(state, score) {
  const sc = score || computeScore(state);
  if (num(sc.total) < IDLE_SCORE) return EPITAPH_IDLE;
  const cause = state?.life?.deathCause;
  const table = EPITAPHS[cause];
  if (!table) return EPITAPH_DEFAULT;
  return table[dominantComponent(sc)] || EPITAPH_DEFAULT;
}

/**
 * 転生画面用の人生の要約。
 * @param {any} state
 * @param {Score} [score]
 * @returns {{
 *   age: number, years: number, netWorth: number, peakNetWorth: number,
 *   offersMade: number, offersAccepted: number, alamoCount: number, failures: string[],
 *   worstYearReturn: number, booksRead: number, bookTitles: string[], propertiesOwned: number,
 *   yearsFired: number, illnessCount: number, lives: number, deathCause: string|null, epitaph: string|null,
 *   events: number, score: Score
 * }}
 */
export function lifeSummary(state, score) {
  const sc = score || computeScore(state);
  const f = state?.flags || {};
  const hist = Array.isArray(state?.history) ? state.history : [];
  const nw = netWorth(state);
  const age = num(state?.life?.age);
  const years = hist.length > 0 ? Math.max(0, hist.length - 1) : Math.max(0, age - 22);
  let peak = Math.max(num(f.peakNetWorth), nw);
  for (const h of hist) peak = Math.max(peak, num(h?.netWorth));
  const readIds = Array.isArray(f.booksRead) ? f.booksRead : [];
  const titles = [];
  for (const id of new Set(readIds)) { const b = bookInfo(id); if (b) titles.push(b.title); }
  const log = Array.isArray(state?.log) ? state.log : [];
  return {
    age,
    years,
    netWorth: nw,
    peakNetWorth: peak,
    offersMade: num(f.offersMade),
    offersAccepted: num(f.offersAccepted),
    alamoCount: num(f.alamoCount),
    failures: [...(state?.brag?.failures ?? [])],
    worstYearReturn: num(f.worstYearReturn),
    booksRead: readIds.length,
    bookTitles: titles,
    propertiesOwned: Array.isArray(state?.props) ? state.props.length : 0,
    yearsFired: num(f.yearsFired),
    illnessCount: num(f.illnessCount),
    lives: num(state?.life?.n) || 1,
    deathCause: state?.life?.deathCause ?? null,
    epitaph: state?.life?.epitaph ?? null,
    events: log.filter((l) => l && (l.kind === 'epic' || l.kind === 'good' || l.kind === 'bad')).length,
    score: sc,
  };
}
