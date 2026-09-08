// books.js — 本棚（DESIGN §10）
// 読むと XP。同じ年に実行（買い付け or 株買い増し）を伴えば ×2、再読は ×0.5。
// state を mutate するのは readBook のみ（skills.xp、flags.booksRead、meters.learning）。

import { addXp, level, SKILL_IDS } from './skills.js';

/**
 * @typedef {Object} Book
 * @property {string} id
 * @property {string} title
 * @property {string} author
 * @property {string[]} tags 関係するスキル id（xp のキーと同じ、主が先頭）
 * @property {Record<string, number>} xp スキルごとの基礎 XP（合計 40）
 * @property {string} quote 一行の引用（≤ 50 字）
 * @property {string} [quoteNote] 引用の出典や注記。要約・意訳のときは「本書の教え」等と明記
 * @property {string} desc 一行紹介（≤ 40 字）
 * @property {number} cost 読むのに必要な読書時間（10）
 */

/** 1 冊あたりの基礎 XP 合計。 */
export const BOOK_XP = 40;
/** 読書の時間コスト。 */
export const BOOK_COST = 10;
/** 最初から読める冊数（BOOKS の先頭 N 冊）。 */
export const ALWAYS_AVAILABLE = 6;
/** reading がこのレベル以上なら全冊解放。 */
export const UNLOCK_ALL_LEVEL = 3;
/** 1 冊読むごとの学びメーター加算（DESIGN §5: 本 ×5）。 */
export const LEARNING_PER_BOOK = 5;

/**
 * 本棚。先頭 6 冊は常に読める。残りは「本との出会い」イベントか reading L3 で解放。
 * @type {ReadonlyArray<Book>}
 */
export const BOOKS = Object.freeze([
  {
    id: 'buffett_letters', title: 'バフェットからの手紙', author: 'ウォーレン・バフェット',
    tags: ['quant', 'reading'], xp: { quant: 25, reading: 15 },
    quote: '他人が貪欲なときに恐れ、他人が恐れているときに貪欲であれ。',
    quoteNote: '1986 年の株主への手紙より',
    desc: '本源価値と忍耐。市場の気分に値段を付けさせない。', cost: BOOK_COST,
  },
  {
    id: 'soros_alchemy', title: 'ソロスの錬金術', author: 'ジョージ・ソロス',
    tags: ['quant'], xp: { quant: 40 },
    quote: '市場は常に間違っている。私はそう仮定して参加する。',
    quoteNote: '本書の主張を要約',
    desc: '反射性。市場は現実を映すだけでなく、現実を作る。', cost: BOOK_COST,
  },
  {
    id: 'richdad', title: '金持ち父さん 貧乏父さん', author: 'ロバート・キヨサキ',
    tags: ['local', 'guts'], xp: { local: 25, guts: 15 },
    quote: '資産はポケットに金を入れ、負債はポケットから金を抜く。',
    quoteNote: '本書の定義を要約',
    desc: 'キャッシュフローの符号で資産と負債を見分ける。', cost: BOOK_COST,
  },
  {
    id: 'frieren', title: '葬送のフリーレン', author: '山田鐘人 / アベツカサ',
    tags: ['guts', 'reading'], xp: { guts: 30, reading: 10 },
    quote: 'なんで、もっと知ろうと思わなかったんだろう。',
    quoteNote: '第 1 話、フリーレンの台詞',
    desc: '千年を生きる魔法使いが、人を知る旅に出る。', cost: BOOK_COST,
  },
  {
    id: 'influence', title: '影響力の武器', author: 'ロバート・チャルディーニ',
    tags: ['comm'], xp: { comm: 40 },
    quote: '与えられたら返したくなる。返報性は最強の武器だ。',
    quoteNote: '本書の教え（返報性の原理）',
    desc: 'ギブが返ってくる理由。承諾の心理学。', cost: BOOK_COST,
  },
  {
    id: 'fooled', title: 'まぐれ', author: 'ナシーム・タレブ',
    tags: ['quant'], xp: { quant: 40 },
    quote: 'ほどほどの成功は実力で説明できる。大成功はまぐれだ。',
    quoteNote: '本書より意訳',
    desc: '運と実力を混同するな。生存者バイアスに気づけ。', cost: BOOK_COST,
  },
  // ── ここから解放が必要 ──
  {
    id: 'soros_bio', title: 'ソロス伝', author: 'マイケル・T・カウフマン',
    tags: ['guts'], xp: { guts: 40 },
    quote: '急所を狙え。確信があるなら、大きく張れ。',
    quoteNote: 'ポンド危機でのソロスの言葉（ドラッケンミラーの回想）',
    desc: '亡命者から投機の帝王へ。賭けの人生。', cost: BOOK_COST,
  },
  {
    id: 'carnegie', title: '人を動かす', author: 'デール・カーネギー',
    tags: ['comm'], xp: { comm: 40 },
    quote: '人を動かす唯一の方法は、その人の望むものについて語ることだ。',
    quoteNote: '本書より意訳',
    desc: '誠実な関心と、名前を覚えること。対人の基本。', cost: BOOK_COST,
  },
  {
    id: 'landlord', title: '大家さん入門', author: '街の大家たち（聞き書き）',
    tags: ['local'], xp: { local: 40 },
    quote: '家賃は月に一度入る。空室は毎日出ていく。',
    quoteNote: '本書の教え',
    desc: '物件の選び方、融資、管理。大家の一年。', cost: BOOK_COST,
  },
  {
    id: 'fortune', title: '天才数学者はこう賭ける', author: 'ウィリアム・パウンドストーン',
    tags: ['quant'], xp: { quant: 40 },
    quote: '賭け金の大きさこそが、勝つ者と破滅する者を分ける。',
    quoteNote: '本書の教え（ケリー基準）',
    desc: 'ケリー基準の物語。情報理論と競馬と株式。', cost: BOOK_COST,
  },
  {
    id: 'snowball', title: 'スノーボール', author: 'アリス・シュローダー',
    tags: ['reading'], xp: { reading: 40 },
    quote: '人生は雪玉だ。湿った雪と、とても長い坂を見つけろ。',
    quoteNote: 'バフェットの言葉として本書に',
    desc: 'バフェットの伝記。複利と時間の使い方。', cost: BOOK_COST,
  },
  {
    id: 'think_grow_rich', title: '思考は現実化する', author: 'ナポレオン・ヒル',
    tags: ['guts'], xp: { guts: 40 },
    quote: '心が思い描き、信じられることは、必ず実現できる。',
    quoteNote: '本書より意訳',
    desc: '燃えるような願望と、明確な目標。', cost: BOOK_COST,
  },
  {
    id: 'black_swan', title: 'ブラック・スワン', author: 'ナシーム・タレブ',
    tags: ['quant', 'guts'], xp: { quant: 25, guts: 15 },
    quote: '知らないことのほうが、知っていることより重要だ。',
    quoteNote: '本書より意訳',
    desc: 'ありえない出来事が世界を動かす。裾に備えろ。', cost: BOOK_COST,
  },
  {
    id: 'seven_habits', title: '7つの習慣', author: 'スティーブン・R・コヴィー',
    tags: ['reading', 'comm'], xp: { reading: 25, comm: 15 },
    quote: '終わりを思い描くことから始める。',
    quoteNote: '第 2 の習慣',
    desc: '主体性、目的、Win-Win。人格の土台。', cost: BOOK_COST,
  },
].map((b) => Object.freeze({ ...b, tags: Object.freeze([...b.tags]), xp: Object.freeze({ ...b.xp }) })));

const BOOK_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));

/**
 * id から本を引く。
 * @param {string} id
 * @returns {Book | undefined}
 */
export function bookInfo(id) {
  return BOOK_BY_ID.get(id);
}

/**
 * 今読める本。先頭 6 冊は常に。残りは `state.flags.unlockedBooks` に入っているか、
 * reading L3 以上なら全冊。
 * @param {any} state
 * @returns {Book[]}
 */
export function availableBooks(state) {
  const readingLv = level(state?.skills?.reading?.xp);
  if (readingLv >= UNLOCK_ALL_LEVEL) return [...BOOKS];
  const unlocked = new Set(state?.flags?.unlockedBooks ?? []);
  return BOOKS.filter((b, i) => i < ALWAYS_AVAILABLE || unlocked.has(b.id));
}

/**
 * まだ解放されていない本（「本との出会い」イベントの候補）。
 * reading レベルは見ない: 先頭 6 冊と unlockedBooks 以外。
 * @param {any} state
 * @returns {Book[]}
 */
export function lockedBooks(state) {
  const unlocked = new Set(state?.flags?.unlockedBooks ?? []);
  return BOOKS.filter((b, i) => i >= ALWAYS_AVAILABLE && !unlocked.has(b.id));
}

/**
 * 本を読む（mutates）。
 * - XP は addXp 経由（energy ≥ 50 で ×1.5 は skills.js 側）。
 * - executed なら ×2、再読なら ×0.5（両方なら ×1）。
 * - `state.flags.booksRead` に id を push、`state.meters.learning` += 5。
 * @param {any} state
 * @param {string} bookId
 * @param {boolean} executed 同じ年に買い付け or 株買い増しをしたか
 * @returns {{ xpGained: number, quote: string, title: string, reread: boolean, executed: boolean } | null}
 *   未知の本、または今は読めない（未解放の）本なら null
 */
export function readBook(state, bookId, executed) {
  const book = BOOK_BY_ID.get(bookId);
  if (!book || !state) return null;
  if (!availableBooks(state).some((b) => b.id === bookId)) return null;
  if (!state.flags) state.flags = {};
  if (!Array.isArray(state.flags.booksRead)) state.flags.booksRead = [];
  const reread = state.flags.booksRead.includes(bookId);
  const mult = (executed ? 2 : 1) * (reread ? 0.5 : 1);
  let xpGained = 0;
  for (const id of SKILL_IDS) {
    const base = book.xp[id];
    if (base > 0) xpGained += addXp(state, id, base * mult);
  }
  state.flags.booksRead.push(bookId);
  if (state.meters) state.meters.learning = (Number(state.meters.learning) || 0) + LEARNING_PER_BOOK;
  return { xpGained, quote: book.quote, title: book.title, reread, executed: !!executed };
}
