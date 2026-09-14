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
  const notes = recentNotes(meta, 14, today);
  if (notes.length) { lines.push('— 言語化メモ —'); for (const n of notes) lines.push(`${n.date} ${n.text}`); }
  return lines.join('\n');
}

/** 日替わりクエスト。6 行動のどれかを、具体的な現実の指示にする。 */
export const QUESTS = [
  { action: 'offer', text: '気になる物件 1 件に、半額で買い付けの連絡を入れる。断られたら自慢の材料。' },
  { action: 'offer', text: '売り出し中の物件に「◯円なら即決」と 1 本メールする。相場の 70% でいい。' },
  { action: 'offer', text: '不動産屋に「指値で通った事例を 1 つ教えてほしい」と聞く。それも申込のうち。' },
  { action: 'offer', text: '仕事でも私事でもいい。今日 1 つ、頼まれていない提案を出す。' },
  { action: 'scout', text: '自転車で知らない路地を 20 分。「売」の札と空き家を数える。' },
  { action: 'scout', text: '配達員か工事の人と 1 分話す。その地域で最近変わったことを聞く。' },
  { action: 'scout', text: '駅から徒歩 15 分圏の外側を 1 本歩く。家賃の掲示を 3 枚撮る。' },
  { action: 'read', text: '『バフェットからの手紙』を 20 分。今年の手紙の 1 段落を書き写す。' },
  { action: 'read', text: 'ソロスの本を 20 分。「反射性」を自分の言葉で 1 文にする。' },
  { action: 'read', text: '読みかけの本を 20 分。読んだ瞬間に実行できることを 1 つ選ぶ。' },
  { action: 'give', text: '誰かに自分の知識を 1 つ、下心なしで教える。返事は求めない。' },
  { action: 'give', text: '達成している人に「会いたい」と連絡する。それ自体がギブになる書き方で。' },
  { action: 'give', text: '過去に助けてくれた人に、近況を一行だけ送る。' },
  { action: 'verbalize', text: '今日の最大の支出を 1 つ選び、「それをやると何が得か」を 1 文で書く。' },
  { action: 'verbalize', text: '今の投資を 1 つ選び、「バフェットならどう見るか」を 3 行で書く。' },
  { action: 'verbalize', text: '「同じ習慣を惰性で続けていないか」を 1 つ挙げ、切るか続けるかを決める。' },
  { action: 'brag', text: '最近の失敗を 1 つ、誰かに笑い話として話す。オチまで付ける。' },
  { action: 'brag', text: '却下された申込・断られた提案を数える。今月の合計を誰かに言う。' },
];
export function dayIndex(today = todayKey()) { const [y, m, d] = today.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }
export function questFor(today = todayKey()) { return QUESTS[((dayIndex(today) % QUESTS.length) + QUESTS.length) % QUESTS.length]; }

/** 今日の言語化メモ（1 日 1 行、200 字まで） */
export function setNote(meta, text, today = todayKey()) {
  const d = ensureDaily(meta); d.notes = d.notes || {};
  const t = String(text || '').trim().slice(0, 200);
  if (t) d.notes[today] = t; else delete d.notes[today];
  const keys = Object.keys(d.notes).sort(); while (keys.length > 400) delete d.notes[keys.shift()];
  return t;
}
export function getNote(meta, today = todayKey()) { return (ensureDaily(meta).notes || {})[today] || ''; }
export function recentNotes(meta, n = 14, today = todayKey()) {
  const notes = ensureDaily(meta).notes || {};
  return Object.keys(notes).filter(k => k <= today).sort().reverse().slice(0, n).map(k => ({ date: k, text: notes[k] }));
}
