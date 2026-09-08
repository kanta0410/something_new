// life.js — 人生モデル（DESIGN §3）: 収入、キャリア、死亡ハザード、破産、純資産
// 副作用があるのは advanceCareer のみ（state.work と state.flags.fired を mutate）。
// 乱数は必ず引数の rng（rng.js）を使う。Math.random 禁止。

import { skillLevels } from './skills.js';

/**
 * @typedef {Object} GameStateLike
 * @property {{ age: number, year?: number, alive?: boolean }} life
 * @property {{ cash: number, stocks: number, debt?: number }} money
 * @property {Array<{ value: number, loan: number, rate: number, rent: number }>} props
 * @property {{ fun?: number, energy?: number, network?: number }} meters
 * @property {Record<string, { xp: number }>} skills
 * @property {{ salary: number, employed: boolean, laidOff?: boolean, retired?: boolean }} work
 * @property {{ fired?: boolean }} [flags]
 */

/**
 * @typedef {Object} Decisions
 * @property {{ reading?: number, scouting?: number, networking?: number, fun?: number, hustle?: number }} [time]
 * @property {number} [savingsRate] 0..0.8
 * @property {boolean} [quitJob]
 */

/**
 * @typedef {Object} Income
 * @property {number} salary   今年の給与（無職なら 0）
 * @property {number} tax      税・社会保険
 * @property {number} net      手取り = salary − tax
 * @property {number} hustle   副業収入
 * @property {number} rent     家賃収入（総額 Σ prop.rent、管理費控除前）
 * @property {number} interest ローン利息 Σ prop.loan·prop.rate
 * @property {number} maintenance 維持費 Σ 0.01·prop.value
 * @property {number} mgmtFee  管理・空室費 rent × 0.08
 * @property {number} living   生活費
 * @property {number} savings  先取り投資（手取り × savingsRate）。cashDelta に含まれる。呼び出し側が現金→株に移す
 * @property {number} passive  不労所得 = rent − mgmtFee − interest − maintenance（FIRE 判定に使う）
 * @property {number} cashDelta 今年の現金増減 = net + hustle + passive − living（元本返済は含まない。city.stepProperty 側）
 */

/** 人生モデルの定数。バランス調整はここを触る。 */
export const LIFE_PARAMS = Object.freeze({
  startAge: 22,
  startSalary: 400,
  salaryCap: 2000,
  baseGrowth: 0.02,       // 給与成長の基礎
  growthPerLevel: 0.006,  // L(reading), L(comm) それぞれ
  peakAge: 55,            // この歳まで成長。以降は −lateDecline/年
  lateDecline: 0.02,
  retireAge: 60,          // 定年。給与 0
  taxBase: 0.15,          // t = taxBase + taxSlope × clamp((salary − taxFloor)/taxSpan, 0, 1)
  taxSlope: 0.15,
  taxFloor: 300,
  taxSpan: 1500,
  livingBase: 240,        // 生活費 = livingBase + fun時間 × livingPerFun
  livingPerFun: 1.2,
  livingBumpAge: 40,      // この歳以上で生活費 +livingAgeBump
  livingAgeBump: 0.2,
  hustleBase: 0.4,        // 副業 = hustle時間 × (hustleBase + hustlePerLevel × (L(reading)+L(comm)))
  hustlePerLevel: 0.08,
  rentNetFactor: 0.92,    // 家賃の管理・空室控除後（DESIGN §7 の rent·(1−0.08)）
  maintenanceRate: 0.01,  // 維持費 = value × 0.01
  maxSavingsRate: 0.8,
  layoffAge: 45,
  layoffProb: 0.03,
  rehireCut: 0.2,         // 再就職時の給与 −20%
  jobOfferCommLevel: 3,
  jobOfferProb: 0.1,
  jobOfferRaise: 0.15,
  hazardA: 0.0001,        // h = hazardA × exp(hazardB × (age − hazardAge0))
  hazardB: 0.1,
  hazardAge0: 20,
  hazardFunMult: 0.85,    // fun > 60
  hazardExhaustedMult: 1.2, // energy < 10 && age > 50
  hazardBrokeMult: 1.5,   // cash < 0（破産年）
  illnessBase: 0.02,      // 病気 = illnessBase + illnessPerYear × max(0, age − illnessAge0)
  illnessPerYear: 0.0005,
  illnessAge0: 40,
  illnessFatality: 0.15,  // 病気イベントのうち致死の割合
  maxAge: 100,            // これ以上は必ず natural
  fireSaleFactor: 0.8,    // 破産判定の強制売却（時価 −20%）
});

const P = LIFE_PARAMS;

/** @param {unknown} v @returns {number} 非数は 0 */
function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** @param {number} x @param {number} lo @param {number} hi */
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** @param {{ employed?: boolean } | undefined} work 未指定は雇用中とみなす */
function isEmployed(work) {
  return !!work && work.employed !== false;
}

/** @param {number} x 万円 → 表示用整数 */
function fmt(x) {
  return String(Math.round(x));
}

/**
 * 税・社会保険率。t = 0.15 + 0.15 × clamp((salary − 300)/1500, 0, 1)。
 * @param {number} salary 万円
 * @returns {number} 0.15..0.30
 */
export function taxRate(salary) {
  const s = num(salary);
  return P.taxBase + P.taxSlope * clamp((s - P.taxFloor) / P.taxSpan, 0, 1);
}

/**
 * 今年の収支を計算する（純粋関数。state は mutate しない）。
 * - salary は雇用中のときだけ計上（リストラ年・定年後・FIRE 後は 0）。
 * - rent は総額。passive/cashDelta には管理費 8% を控除した額を使う。
 * - savings は cashDelta に含まれている。呼び出し側が現金→株へ移す（残りが生活費を下回れば現金から補填される形）。
 * - 元本返済は含まない（city.stepProperty の principal を呼び出し側で現金から引く）。
 * @param {GameStateLike} state
 * @param {Decisions} [decisions]
 * @returns {Income}
 */
export function computeIncome(state, decisions = {}) {
  const work = state?.work ?? {};
  const age = num(state?.life?.age);
  const time = decisions?.time ?? {};
  const L = skillLevels(state);

  const salary = isEmployed(work) ? Math.max(0, num(work.salary)) : 0;
  const tax = salary * taxRate(salary);
  const net = salary - tax;

  const hustle = Math.max(0, num(time.hustle)) * (P.hustleBase + P.hustlePerLevel * (L.reading + L.comm));

  let rent = 0;
  let interest = 0;
  let maintenance = 0;
  for (const p of state?.props ?? []) {
    rent += num(p.rent);
    interest += num(p.loan) * num(p.rate);
    maintenance += P.maintenanceRate * num(p.value);
  }
  const mgmtFee = rent * (1 - P.rentNetFactor);

  let living = P.livingBase + Math.max(0, num(time.fun)) * P.livingPerFun;
  if (age >= P.livingBumpAge) living *= 1 + P.livingAgeBump;

  const savingsRate = clamp(num(decisions?.savingsRate), 0, P.maxSavingsRate);
  const savings = net * savingsRate;

  const passive = rent - mgmtFee - interest - maintenance;
  const cashDelta = net + hustle + passive - living;

  return { salary, tax, net, hustle, rent, interest, maintenance, mgmtFee, living, savings, passive, cashDelta };
}

/**
 * キャリアを 1 年進める（mutates `state.work`、FIRE 時は `state.flags.fired`）。
 *
 * 呼び出しタイミング: 今年の computeIncome の後、`life.age++` の前に 1 回。
 * `state.life.age` は「今年の年齢」、この関数は「来年の給与・雇用状態」を決める。
 *
 * 順序:
 *  1. FIRE 済み → 何もしない
 *  2. decisions.quitJob && employed: passive > living なら退職（salary 0, employed false, flags.fired true）。満たさなければ見送りログ
 *  3. 定年: 来年 60 歳以上 → salary 0, employed false, work.retired true
 *  4. リストラ中（work.laidOff）→ 再就職。給与 −20%
 *  5. 雇用中で age ≥ 45: 3% でリストラ（employed false, work.laidOff true。来年は無収入）
 *  6. 給与成長: 来年 55 歳以下は ×(1 + 0.02 + 0.006·L(reading) + 0.006·L(comm))、56〜59 歳は ×0.98
 *  7. 転職オファー: L(comm) ≥ 3 で 10% → +15%。上限 2,000 万
 *
 * 追加フィールド（GameState 拡張、無くても動く）: `work.laidOff: boolean`, `work.retired: boolean`。
 *
 * @param {GameStateLike} state
 * @param {Decisions} [decisions]
 * @param {{ chance: (p: number) => boolean }} rng rng.js の乱数器
 * @returns {{ events: string[], kinds: Array<'fire'|'quitDenied'|'retire'|'rehire'|'layoff'|'joboffer'> }}
 *   events: 日本語ログ行。kinds: 同じ順序で並んだ種別（events.js 側の二重発火を避けるために使える）
 */
export function advanceCareer(state, decisions = {}, rng) {
  /** @type {string[]} */
  const events = [];
  /** @type {Array<'fire'|'quitDenied'|'retire'|'rehire'|'layoff'|'joboffer'>} */
  const kinds = [];
  const push = (/** @type {any} */ kind, /** @type {string} */ text) => {
    kinds.push(kind);
    events.push(text);
  };

  if (!state.work) state.work = { salary: 0, employed: false, hustleIncome: 0, passiveIncome: 0 };
  if (!state.flags) state.flags = {};
  const work = state.work;
  const age = num(state.life?.age);
  const nextAge = age + 1;
  const L = skillLevels(state);

  // 1. FIRE 済み
  if (state.flags.fired) return { events, kinds };

  // 2. FIRE 判定
  if (decisions?.quitJob && isEmployed(work)) {
    const inc = computeIncome(state, decisions);
    if (inc.passive > inc.living) {
      work.employed = false;
      work.salary = 0;
      work.laidOff = false;
      state.flags.fired = true;
      push('fire', `FIRE 達成。不労所得 ${fmt(inc.passive)}万 > 生活費 ${fmt(inc.living)}万。会社を辞めた。もう給料はいらない。`);
      return { events, kinds };
    }
    push('quitDenied', `退職は見送り。不労所得 ${fmt(inc.passive)}万 < 生活費 ${fmt(inc.living)}万。まだ資産に働かせ足りない。`);
  }

  // 3. 定年
  if (nextAge >= P.retireAge) {
    if (!work.retired) {
      push('retire', `定年退職。${P.retireAge}歳、給与はここまで。ここからは資産が働く番だ。`);
    }
    work.employed = false;
    work.salary = 0;
    work.laidOff = false;
    work.retired = true;
    return { events, kinds };
  }

  // 4. リストラからの再就職
  if (!isEmployed(work)) {
    if (work.laidOff) {
      work.salary = Math.max(0, num(work.salary)) * (1 - P.rehireCut);
      work.employed = true;
      work.laidOff = false;
      push('rehire', `再就職。給与は ${fmt(work.salary)}万（−${Math.round(P.rehireCut * 100)}%）から再出発。`);
    }
    return { events, kinds };
  }

  // 5. リストラ判定
  if (age >= P.layoffAge && rng.chance(P.layoffProb)) {
    work.employed = false;
    work.laidOff = true;
    push('layoff', `リストラ。${age}歳で会社を追われた。来年は無収入。アラモを忘れるな。`);
    return { events, kinds };
  }

  // 6. 給与成長
  let salary = Math.max(0, num(work.salary));
  if (nextAge <= P.peakAge) {
    salary *= 1 + P.baseGrowth + P.growthPerLevel * (L.reading + L.comm);
  } else {
    salary *= 1 - P.lateDecline;
  }

  // 7. 転職オファー
  if (L.comm >= P.jobOfferCommLevel && rng.chance(P.jobOfferProb)) {
    salary *= 1 + P.jobOfferRaise;
    salary = Math.min(P.salaryCap, salary);
    push('joboffer', `転職オファー。人脈が効いた。給与 +${Math.round(P.jobOfferRaise * 100)}% → ${fmt(salary)}万。`);
  }

  work.salary = Math.min(P.salaryCap, salary);
  return { events, kinds };
}

/**
 * 年間死亡ハザード（Gompertz–Makeham）。
 * `h = 0.0001 × exp(0.1 × (age − 20))` × 修正（fun > 60: ×0.85、energy < 10 かつ age > 50: ×1.2、破産年（cash < 0）: ×1.5）。
 * 22歳 ≈ 0.00012 / 50歳 ≈ 0.002 / 70歳 ≈ 0.015 / 85歳 ≈ 0.066。
 * @param {GameStateLike} state
 * @returns {number} 0..1
 */
export function hazard(state) {
  const age = num(state?.life?.age);
  const m = state?.meters ?? {};
  let h = P.hazardA * Math.exp(P.hazardB * (age - P.hazardAge0));
  if (num(m.fun) > 60) h *= P.hazardFunMult;
  if (num(m.energy) < 10 && age > 50) h *= P.hazardExhaustedMult;
  if (num(state?.money?.cash) < 0) h *= P.hazardBrokeMult;
  return clamp(h, 0, 1);
}

/**
 * 病気イベントの年間確率。`0.02 + 0.0005 × max(0, age − 40)`。
 * 非致死の病気（医療費、時間 −30）は events.js が扱う。致死分は rollDeath。
 * @param {GameStateLike} state
 * @returns {number}
 */
export function illnessChance(state) {
  const age = num(state?.life?.age);
  return clamp(P.illnessBase + P.illnessPerYear * Math.max(0, age - P.illnessAge0), 0, 1);
}

/**
 * 今年の死亡判定。
 * - age ≥ 100 → 'natural'（上限）
 * - hazard(state) で 'natural'
 * - illnessChance(state) × 0.15（致死率）で 'illness'
 * @param {GameStateLike} state
 * @param {{ chance: (p: number) => boolean }} rng
 * @returns {null | 'natural' | 'illness'}
 */
export function rollDeath(state, rng) {
  const age = num(state?.life?.age);
  if (age >= P.maxAge) return 'natural';
  if (rng.chance(hazard(state))) return 'natural';
  if (rng.chance(illnessChance(state) * P.illnessFatality)) return 'illness';
  return null;
}

/**
 * 破産判定。現金 < 0 かつ、物件を強制売却（時価 −20%、ローン完済）しても純資産 < 0。
 * @param {GameStateLike} state
 * @returns {boolean}
 */
export function checkBankruptcy(state) {
  const cash = num(state?.money?.cash);
  if (cash >= 0) return false;
  let total = cash + num(state?.money?.stocks);
  for (const p of state?.props ?? []) total += num(p.value) * P.fireSaleFactor - num(p.loan);
  return total < 0;
}

/**
 * 純資産 = cash + stocks + Σ(prop.value − prop.loan)。
 * @param {GameStateLike} state
 * @returns {number}
 */
export function netWorth(state) {
  let total = num(state?.money?.cash) + num(state?.money?.stocks);
  for (const p of state?.props ?? []) total += num(p.value) - num(p.loan);
  return total;
}

/**
 * 流動資産 = cash + stocks。
 * @param {GameStateLike} state
 * @returns {number}
 */
export function liquid(state) {
  return num(state?.money?.cash) + num(state?.money?.stocks);
}
