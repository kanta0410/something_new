// skills.js — スキル定義とレベル計算（DESIGN §4）
// 純粋関数のみ。state を mutate するのは addXp / applyTimeXp だけ（API.md の契約どおり）。

/** @typedef {'reading'|'comm'|'local'|'quant'|'guts'} SkillId */

/** 最大レベル。L10 = 4,000 XP。 */
export const MAX_LEVEL = 10;
/** level = floor(sqrt(xp / XP_UNIT))。 */
export const XP_UNIT = 40;
/** energy がこの値以上のとき XP 獲得に倍率がかかる。 */
export const ENERGY_XP_THRESHOLD = 50;
/** energy ≥ ENERGY_XP_THRESHOLD のときの XP 倍率。 */
export const ENERGY_XP_MULT = 1.5;

/**
 * 5 スキルのメタデータ。
 * - name: 表示名（漢字）
 * - desc: 効果の短い説明（DESIGN §4 の「効果」列）
 * - howTo: 上げ方の一行説明（DESIGN §4 の「上げ方」列）
 * @type {ReadonlyArray<{ id: SkillId, name: string, desc: string, howTo: string }>}
 */
export const SKILLS = Object.freeze([
  Object.freeze({
    id: 'reading',
    name: '読書',
    desc: '給与の伸び +0.6%/L、副業の単価 +0.08万/L、学びの倍率が上がる',
    howTo: '読書の時間 1 につき +1 XP。本を読むと +40/冊、同じ年に実行（買い付け・株買い増し）すれば ×2',
  }),
  Object.freeze({
    id: 'comm',
    name: 'コミュ力',
    desc: '買い付けが通りやすくなる（売主本音 θ −0.008/L）。融資 LTV 上限 +0.02/L。人脈が育ちやすい',
    howTo: '人脈づくりの時間 1 につき +1 XP。買い付けを出すたび +10',
  }),
  Object.freeze({
    id: 'local',
    name: '地域知',
    desc: '街の相場の推定誤差 −6%/L。偵察で秘密を見つける率 +4%/L',
    howTo: '偵察の時間 1 につき +1 XP。偵察で秘密を発見すると +25',
  }),
  Object.freeze({
    id: 'quant',
    name: 'クオンツ',
    desc: 'クオンツ画面の解放。L1 統計とドローダウン、L3 Kelly、L5 モンテカルロ扇形図、L7 市場生態系',
    howTo: '損失の年 +30。クオンツ系の本 +60。株を持っている年 +8',
  }),
  Object.freeze({
    id: 'guts',
    name: '胆力',
    desc: 'エネルギーの変換率が上がり、恐怖による判断ペナルティが消える',
    howTo: '売出価格の 7 割以下で買い付け +25。暴落の年に株を買い増し +40。自主転生 +100',
  }),
]);

/** スキル id の配列（順序は SKILLS と同じ）。 @type {ReadonlyArray<SkillId>} */
export const SKILL_IDS = Object.freeze(SKILLS.map((s) => s.id));

const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

/**
 * スキル id からメタデータを引く。
 * @param {string} id
 * @returns {{ id: SkillId, name: string, desc: string, howTo: string } | undefined}
 */
export function skillInfo(id) {
  return SKILL_BY_ID.get(id);
}

/**
 * XP → レベル。`min(10, floor(sqrt(xp / 40)))`。負数・NaN は 0。
 * @param {number} xp
 * @returns {number} 0..10
 */
export function level(xp) {
  const x = Number(xp);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(x / XP_UNIT)));
}

/**
 * レベル L に到達するのに必要な累積 XP（40·L²）。
 * @param {number} lv 0..10
 * @returns {number}
 */
export function levelThreshold(lv) {
  const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(Number(lv) || 0)));
  return XP_UNIT * l * l;
}

/**
 * 次のレベルに到達するための累積 XP（絶対値）。
 * すでに最大レベルなら L10 の閾値（4,000）を返す（=到達済み）。
 * 進捗バー: `(xp − levelThreshold(level(xp))) / (nextLevelXp(xp) − levelThreshold(level(xp)))`。
 * @param {number} xp
 * @returns {number}
 */
export function nextLevelXp(xp) {
  const lv = level(xp);
  return levelThreshold(Math.min(MAX_LEVEL, lv + 1));
}

/**
 * 次のレベルまでに残っている XP。最大レベルなら 0。
 * @param {number} xp
 * @returns {number}
 */
export function xpToNextLevel(xp) {
  if (level(xp) >= MAX_LEVEL) return 0;
  return Math.max(0, nextLevelXp(xp) - (Number(xp) || 0));
}

/**
 * XP を付与する（mutates `state.skills[skillId].xp`）。
 * energy ≥ 50 のとき ×1.5。付与量は整数に丸める（Math.round）。
 * amount が 0 以下・非数のときは何もせず 0 を返す。
 * @param {import('./life.js').GameStateLike} state
 * @param {SkillId} skillId
 * @param {number} amount 基礎 XP（倍率適用前）
 * @returns {number} 実際に付与した XP
 */
export function addXp(state, skillId, amount) {
  if (!SKILL_BY_ID.has(skillId)) throw new TypeError(`unknown skill: ${skillId}`);
  const base = Number(amount);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const energy = Number(state?.meters?.energy) || 0;
  const mult = energy >= ENERGY_XP_THRESHOLD ? ENERGY_XP_MULT : 1;
  const granted = Math.round(base * mult);
  if (granted <= 0) return 0;
  if (!state.skills) state.skills = {};
  if (!state.skills[skillId]) state.skills[skillId] = { xp: 0 };
  state.skills[skillId].xp = (Number(state.skills[skillId].xp) || 0) + granted;
  return granted;
}

/**
 * 時間配分による XP を付与する（mutates）。
 * reading 時間 ×1.0 → reading、networking ×1.0 → comm、scouting ×1.0 → local。
 * energy 倍率は addXp 経由で適用される。
 * @param {import('./life.js').GameStateLike} state
 * @param {{ time?: { reading?: number, networking?: number, scouting?: number } }} decisions
 * @returns {{ reading: number, comm: number, local: number }} 実付与 XP
 */
export function applyTimeXp(state, decisions) {
  const t = decisions?.time ?? {};
  return {
    reading: addXp(state, 'reading', Number(t.reading) || 0),
    comm: addXp(state, 'comm', Number(t.networking) || 0),
    local: addXp(state, 'local', Number(t.scouting) || 0),
  };
}

/**
 * 全スキルのレベルを返す。未定義のスキルは 0。
 * @param {import('./life.js').GameStateLike} state
 * @returns {{ reading: number, comm: number, local: number, quant: number, guts: number }}
 */
export function skillLevels(state) {
  const s = state?.skills ?? {};
  /** @type {any} */
  const out = {};
  for (const id of SKILL_IDS) out[id] = level(s[id]?.xp);
  return out;
}
