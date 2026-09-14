// 現実の行動 → ゲームへの反映。毎日モードの中核。純関数＋ meta への記録。
import { addXp } from './skills.js';

/** 現実で取れる行動。id は保存に使うので変えない。 */
export const REAL_ACTIONS = [
  { id: 'offer', label: '買い付け・申込・提案を 1 本出した', short: '買い付け', effect: '胆力 +25、エネルギー +8', apply: (s) => { addXp(s, 'guts', 25); s.meters.energy = Math.min(100, s.meters.energy + 8); } },
  { id: 'scout', label: '現地を見た／自転車で街を回った', short: '偵察', effect: '地域知 +20、エネルギー +3', apply: (s) => { addXp(s, 'local', 20); s.meters.energy = Math.min(100, s.meters.energy + 3); } },
  { id: 'read', label: '本を 20 分以上読んだ', short: '読書', effect: '読書 +15、学び +2', apply: (s) => { addXp(s, 'reading', 15); s.meters.learning += 2; } },
  { id: 'give', label: '見返りなしで誰かに与えた（知識・時間・金）', short: 'ギブ', effect: 'コミュ力 +10、人脈 +5', apply: (s) => { addXp(s, 'comm', 10); s.meters.network = Math.min(100, s.meters.network + 5); } },
  { id: 'verbalize', label: '「それをやると何が得か」を言語化した', short: '言語化', effect: 'クオンツ +10、学び +3', apply: (s) => { addXp(s, 'quant', 10); s.meters.learning += 3; } },
  { id: 'brag', label: '失敗を一つ、誰かに自慢した', short: '自慢', effect: '自慢ポイント +1、エネルギー +8', apply: (s) => { s.brag.points += 1; s.brag.failures.push(`現実 ${s.life.year}年 失敗を自慢した`); s.meters.energy = Math.min(100, s.meters.energy + 8); } },
];
export const FULL_COMBO_ENERGY = 20;

/** ローカル日付 YYYY-MM-DD */
export function todayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + n));
}

export function defaultDaily() {
  return { streak: 0, bestStreak: 0, lastDate: null, days: {}, totals: {}, comboDays: 0 };
}

/** meta.daily を保証して返す */
export function ensureDaily(meta) {
  if (!meta.daily) meta.daily = defaultDaily();
  const d = meta.daily;
  d.days = d.days || {}; d.totals = d.totals || {};
  d.streak = d.streak || 0; d.bestStreak = d.bestStreak || 0; d.comboDays = d.comboDays || 0;
  return d;
}

/** 今日の連続日数を再計算（昨日まで続いていれば維持、途切れていれば 0）。表示用。 */
export function currentStreak(meta, today = todayKey()) {
  const d = ensureDaily(meta);
  if (!d.lastDate) return 0;
  if (d.lastDate === today || d.lastDate === addDays(today, -1)) return d.streak;
  return 0;
}

/**
 * 現実の行動を記録し、ゲーム状態へ反映する。同じ日に同じ行動は 1 回だけ。
 * @returns {{ applied: boolean, streak: number, combo: boolean, milestone: number|null }}
 */
export function recordRealAction(meta, state, actionId, today = todayKey()) {
  const act = REAL_ACTIONS.find(a => a.id === actionId);
  const d = ensureDaily(meta);
  if (!act) return { applied: false, streak: currentStreak(meta, today), combo: false, milestone: null };
  const list = d.days[today] || (d.days[today] = []);
  if (list.includes(actionId)) return { applied: false, streak: currentStreak(meta, today), combo: false, milestone: null };
  list.push(actionId);
  d.totals[actionId] = (d.totals[actionId] || 0) + 1;
  if (state && state.life.alive) act.apply(state);
  // ストリーク
  if (d.lastDate !== today) {
    d.streak = d.lastDate === addDays(today, -1) ? d.streak + 1 : 1;
    d.lastDate = today;
    d.bestStreak = Math.max(d.bestStreak, d.streak);
  }
  let combo = false;
  if (list.length === REAL_ACTIONS.length) {
    combo = true; d.comboDays += 1;
    if (state && state.life.alive) state.meters.energy = Math.min(100, state.meters.energy + FULL_COMBO_ENERGY);
  }
  const milestone = [7, 30, 100, 365].includes(d.streak) && list.length === 1 ? d.streak : null;
  // 古い日は 400 日で刈る
  const keys = Object.keys(d.days).sort();
  while (keys.length > 400) delete d.days[keys.shift()];
  return { applied: true, streak: d.streak, combo, milestone };
}

/** 今日チェック済みの行動 id */
export function doneToday(meta, today = todayKey()) {
  return (ensureDaily(meta).days[today] || []).slice();
}

/** 直近 n 日の達成状況（古い→新しい） */
export function recentDays(meta, n = 28, today = todayKey()) {
  const d = ensureDaily(meta);
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const k = addDays(today, -i); out.push({ date: k, count: (d.days[k] || []).length }); }
  return out;
}

/** 実績台帳のテキスト（コピー用） */
export function ledgerText(meta, today = todayKey()) {
  const d = ensureDaily(meta);
  const days = Object.keys(d.days).length;
  const lines = [`転生クオンツ 実績台帳 ${today}`, `行動した日数 ${days} / 連続 ${currentStreak(meta, today)} 日（最長 ${d.bestStreak}）/ フルコンボ ${d.comboDays} 日`];
  for (const a of REAL_ACTIONS) lines.push(`${a.short}: ${d.totals[a.id] || 0} 回`);
  return lines.join('\n');
}
