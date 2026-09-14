// 称号: 人生の終わり（または現実の連続日数）で授与。meta.titles に { id, life, year } を積む。
import { level } from './skills.js';
import { netWorth } from './life.js';

export const TITLES = [
  { id: 'half', name: '半額の男', desc: '売出しの 50% 以下で買い付けを成立させた', test: (s) => (s.flags.bestBidRatio ?? 1) <= 0.5 },
  { id: 'hundred', name: '百戦錬磨', desc: '買い付けを 100 本出した', test: (s) => s.flags.offersMade >= 100 },
  { id: 'alamo', name: 'アラモの生き残り', desc: '暴落を 3 回くぐり抜け、破産しなかった', test: (s) => s.flags.alamoCount >= 3 && s.life.deathCause !== 'bankrupt' },
  { id: 'fire', name: '不労の人', desc: '不労所得が生活費を超え、会社を辞めた', test: (s) => !!s.flags.fired },
  { id: 'oku', name: '億り人', desc: '純資産が 1 億に到達した', test: (s) => (s.flags.peakNetWorth || 0) >= 10000 },
  { id: 'juoku', name: '十億の人', desc: '純資産が 10 億に到達した', test: (s) => (s.flags.peakNetWorth || 0) >= 100000 },
  { id: 'bookworm', name: '本の虫', desc: '本を 10 冊読んだ', test: (s) => (s.flags.booksRead || []).length >= 10 },
  { id: 'giver', name: 'ギバー', desc: '人脈を平均 80 以上で 50 年保った', test: (s) => (s.meters.networkTotal || 0) >= 4000 },
  { id: 'quant', name: 'クオンツ', desc: 'クオンツ Lv7 で市場の生態系を見た', test: (s) => level(s.skills.quant?.xp || 0) >= 7 },
  { id: 'brave', name: '早すぎた転生', desc: '30 歳になる前に自ら転生を選んだ', test: (s) => s.life.deathCause === 'voluntary' && s.life.age < 30 },
  { id: 'tuition', name: '授業料を払った男', desc: '破産した。それは授業料だ', test: (s) => s.life.deathCause === 'bankrupt' },
  { id: 'elder', name: '長寿', desc: '90 歳まで生きた', test: (s) => s.life.age >= 90 },
  { id: 'smile', name: '笑って死んだ', desc: '楽しさスコア 950 以上', test: (s, score) => (score?.fun || 0) >= 950 },
  { id: 'brag', name: '失敗の語り部', desc: '自慢ポイント 100 以上', test: (s) => (s.brag.points || 0) >= 100 },
  { id: 'landlord', name: '大家', desc: '物件を同時に 10 件所有した', test: (s) => (s.flags.peakProps || s.props.length) >= 10 },
];

export const STREAK_TITLES = [
  { id: 'streak7', name: '七日の男', desc: '現実で 7 日連続で動いた', streak: 7 },
  { id: 'streak30', name: '三十日の男', desc: '現実で 30 日連続で動いた', streak: 30 },
  { id: 'streak100', name: '百日の男', desc: '現実で 100 日連続で動いた', streak: 100 },
];

export function ensureTitles(meta) { if (!Array.isArray(meta.titles)) meta.titles = []; return meta.titles; }
export function hasTitle(meta, id) { return ensureTitles(meta).some(t => t.id === id); }

/** 人生の終わりに授与。新規に得た称号の配列を返す（meta を mutate）。 */
export function awardLifeTitles(meta, state, score) {
  const got = [];
  for (const t of TITLES) {
    if (hasTitle(meta, t.id)) continue;
    let ok = false;
    try { ok = !!t.test(state, score); } catch (_) { ok = false; }
    if (ok) { const rec = { id: t.id, name: t.name, desc: t.desc, life: state.life.n, year: state.life.year }; meta.titles.push(rec); got.push(rec); }
  }
  return got;
}

/** 授与せずに、いま得られる称号を列挙（転生画面のプレビュー用） */
export function previewLifeTitles(meta, state, score) {
  const out = [];
  for (const t of TITLES) { if (hasTitle(meta, t.id)) continue; let ok = false; try { ok = !!t.test(state, score); } catch (_) { ok = false; } if (ok) out.push({ id: t.id, name: t.name, desc: t.desc }); }
  return out;
}

/** 連続日数の称号。新規分を返す。 */
export function awardStreakTitles(meta, streak, life) {
  const got = [];
  for (const t of STREAK_TITLES) {
    if (streak >= t.streak && !hasTitle(meta, t.id)) { const rec = { id: t.id, name: t.name, desc: t.desc, life, year: null }; ensureTitles(meta).push(rec); got.push(rec); }
  }
  return got;
}

/** 人生中に追跡する最高値（game.js から毎年呼ぶ） */
export function trackPeaks(state, acceptedBidRatios = []) {
  const f = state.flags;
  f.peakNetWorth = Math.max(f.peakNetWorth || 0, netWorth(state));
  f.peakNetwork = Math.max(f.peakNetwork || 0, state.meters.network);
  f.peakProps = Math.max(f.peakProps || 0, state.props.length);
  for (const r of acceptedBidRatios) f.bestBidRatio = Math.min(f.bestBidRatio ?? 1, r);
}
