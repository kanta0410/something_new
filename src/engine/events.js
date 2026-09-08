// events.js — 年次イベント（DESIGN §9）
// rollEvents は state を読むだけ（乱数は引数の rng）。副作用はすべて GameEvent.apply に閉じ込め、
// applyEvents が順番に実行してログに残す。転職・リストラは life.advanceCareer が担当。

import { addXp, SKILLS, SKILL_IDS } from './skills.js';
import { lockedBooks } from './books.js';

/**
 * @typedef {'alamo'|'mentor'|'illness'|'joboffer'|'layoff'|'gift'|'giftReturn'|'book'|'secret'|'flood'|'station'|'courier'|'brag'|'misc'} EventKind
 * @typedef {'info'|'good'|'bad'|'epic'} Severity
 *
 * @typedef {Object} GameEvent
 * @property {string} id       1 年の中で一意
 * @property {EventKind} kind
 * @property {string} title
 * @property {string} text
 * @property {Severity} severity
 * @property {(state: any) => void} apply 副作用はここだけ
 * @property {Record<string, number>} [meterDelta] UI 表示用の増減（cash, energy, network, xp）
 * @property {boolean} [silent] true ならログに残さない（状態の後始末だけ）
 *
 * @typedef {Object} EventCtx
 * @property {{ crash?: boolean, totalReturn?: number } | null} [yearResult]
 * @property {Array<{ kind: string, districtId?: number, text: string, valuePct?: number }>} [cityEvents]
 * @property {{ net?: number } | null} [income]
 * @property {Array<{ listing?: { districtId?: number, ask?: number }, reaction?: string, bidRatio?: number }>} [rejectedOffers]
 * @property {number} [lossRate] 今年の純資産減少率（0..1）
 * @property {boolean} [lastCrash]
 */

/** バランス定数。 */
export const EVENT_PARAMS = Object.freeze({
  alamoEnergy: 40,
  mentorNetwork: 60,
  mentorChance: 0.25,
  mentorXp: 80,
  courierScouting: 20,
  illnessBase: 0.02,
  illnessPerYear: 0.0005,
  illnessAge0: 40,
  illnessCostMin: 100,
  illnessCostMax: 500,
  giftNetworking: 30,
  giftRate: 0.02,
  giftNetwork: 10,
  giftReturnChance: 0.25,
  giftReturnMult: 3,
  bookReading: 20,
  bookChance: 0.15,
  bragEnergy: 8,
  lossBragRate: 0.15,
  flavorChance: 0.045, // 1 件あたり。12 件で合計 0.54。1 年に最大 1 件
  logCap: 400,
});

const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

/** 出会い（達成者）の秘訣。いずれも架空の人物。 */
export const MENTOR_TIPS = Object.freeze([
  { who: '元区役所職員で今は32室の大家・佐伯さん', tip: '買い付けは月に3本。断られる回数を KPI にした' },
  { who: '町工場を畳んで倉庫業を始めた・堀内さん', tip: '契約書より先に、現地へ10回通った。地図は嘘をつかない' },
  { who: '看護師をしながら4棟建てた・志村さん', tip: '給料日に投資分を先に抜く。残りで暮らすと決めただけ' },
  { who: '暴落で二度破産した投資家・鴨川さん', tip: '三度目は暴落の前に現金を厚くした。恐怖は資産になる' },
  { who: '商店街の空き店舗を6軒直した・呉さん', tip: '誰も欲しがらない物件にだけ、値段の交渉権がある' },
  { who: '副業のブログを本業にした・南雲さん', tip: '読んだ本は翌日に一つ試す。試さない読書は娯楽だ' },
  { who: '人脈だけで融資枠を開けた・比嘉さん', tip: '頼み事の前に十回ギブする。帳簿はつけない' },
  { who: '数式で家賃を決める元クオンツ・真壁さん', tip: '期待値がプラスなら、負けた日も正しい。記録が証拠だ' },
]);

/** 配達員の話（偵察のボーナス）。 */
const COURIER_LINES = Object.freeze([
  '『あの辺、最近やたら測量してるよ』 次の偵察で秘密が見つかりやすい。',
  '『あの角の家、荷物の宛名が急に変わった』 次の偵察で秘密が見つかりやすい。',
  '『あそこ、朝は配達が楽なんだ。人が減ってる』 次の偵察で秘密が見つかりやすい。',
]);

/** ギブの使い道。 */
const GIFT_REASONS = Object.freeze([
  '後輩の引っ越しを手伝い、飯を奢った',
  '恩師の退職祝いに、皆で贈り物をした',
  '友人の起業に、無利子で少し貸した',
  '勉強会の会場代を黙って払った',
  '同僚の子の入学祝いを包んだ',
]);

/**
 * 哲学に紐づく小話。それぞれ ≤ 8%/年、1 年に最大 1 件。
 * cond は省略可（state を見て出すか決める）。
 */
export const FLAVOR_EVENTS = Object.freeze([
  { id: 'coworker_savings', title: '昼休みの会話', text: '同僚が『貯金が一番安全』と言った。あなたは黙って買い付けを出した。' },
  { id: 'cycling_alley', title: '週末のサイクリング', text: '自転車で知らない路地に入った。角の空き家に『売』の札が下がっていた。' },
  { id: 'agent_laugh', title: '不動産屋の苦笑', text: '『半額なんて失礼ですよ』と不動産屋が笑った。翌週、別の売主がそれで売ったと聞いた。' },
  { id: 'old_landlord', title: '駅前の居酒屋', text: '大家歴30年の老人が言った。『儲けは買った瞬間に決まる。売る時じゃない』' },
  { id: 'crypto_brag', title: '同僚の自慢', text: '同僚が仮想通貨で3倍にしたと自慢した。あなたは自分のシャープレシオを計算し直した。' },
  { id: 'mom_call', title: '母からの電話', text: '『そろそろ落ち着いたら？』 あなたは『落ち着くのは転生してから』と笑った。' },
  { id: 'library', title: '図書館', text: '返却期限を3回延長した本を読み終え、その足でまた借りた。' },
  { id: 'himmel_neighbor', title: 'ヒンメルならこうした', text: '困っている隣人の引っ越しを手伝った。見返りは求めなかった。' },
  { id: 'news_timing', title: 'ニュース', text: '『今は買い時ではない』と専門家が言った。10年前も同じことを言っていた。' },
  { id: 'classmate_luck', title: '同窓会', text: '『お前は運がいい』と同級生が言った。断られた買い付けの数を教えたら黙った。' },
  { id: 'coffee_worker', title: '缶コーヒー', text: '工事現場のおっちゃんに差し入れをした。『あの角、来年変わるよ』と教えてくれた。' },
  { id: 'night_montecarlo', title: '深夜の画面', text: 'モンテカルロの扇が広がる。破産の裾を見て、ローンを1割減らした。' },
]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function fmtMoney(v) {
  const a = Math.abs(Math.round(v));
  if (a >= 10000) return (a / 10000).toFixed(a >= 100000 ? 0 : 1).replace(/\.0$/, '') + '億';
  return a.toLocaleString('ja-JP') + '万';
}

function ensureFlags(state) {
  if (!state.flags) state.flags = {};
  return state.flags;
}

function bumpEnergy(state, delta) {
  if (!state.meters) state.meters = {};
  state.meters.energy = clamp(num(state.meters.energy) + delta, 0, 100);
}

function districtName(state, districtId) {
  const d = state?.city?.districts?.[districtId];
  return d?.name || (districtId != null ? `地区${districtId}` : '街');
}

/** いちばん XP が低いスキル id（同点なら SKILL_IDS の順）。 */
function lowestSkill(state) {
  let best = SKILL_IDS[0];
  let bestXp = Infinity;
  for (const id of SKILL_IDS) {
    const xp = num(state?.skills?.[id]?.xp);
    if (xp < bestXp) { bestXp = xp; best = id; }
  }
  return best;
}

/**
 * 病気（非致死）の年間確率。致死側は life.rollDeath が扱う。
 * @param {number} age
 */
export function illnessChance(age) {
  const P = EVENT_PARAMS;
  return clamp(P.illnessBase + P.illnessPerYear * Math.max(0, num(age) - P.illnessAge0), 0, 1);
}

function cityKind(kind) {
  const k = String(kind || '');
  if (/flood|浸水/.test(k)) return 'flood';
  if (/station|新駅/.test(k)) return 'station';
  return 'secret';
}

/**
 * 今年のイベントを判定して返す。state は読むだけ。乱数の消費順は固定（決定性）。
 * @param {any} state
 * @param {{ time?: { reading?: number, scouting?: number, networking?: number } }} decisions
 * @param {EventCtx} ctx
 * @param {{ next(): number, int(lo: number, hi: number): number, pick<T>(a: T[]): T, chance(p: number): boolean }} rng
 * @returns {GameEvent[]}
 */
export function rollEvents(state, decisions, ctx, rng) {
  const P = EVENT_PARAMS;
  /** @type {GameEvent[]} */
  const out = [];
  const c = ctx || {};
  const t = decisions?.time || {};
  const year = num(state?.life?.year);
  const age = num(state?.life?.age);
  const flags = state?.flags || {};
  const meters = state?.meters || {};

  // 1. アラモの時（暴落年）
  if (c.yearResult?.crash) {
    out.push({
      id: 'alamo', kind: 'alamo', severity: 'epic',
      title: 'アラモの時',
      text: `市場が${Math.round(-num(c.yearResult.totalReturn) * 100)}%崩れた。アラモを忘れるな。最悪の時が最高の時だ。売主は投げ売りを始める。エネルギー +${P.alamoEnergy}。`,
      meterDelta: { energy: P.alamoEnergy },
      apply(s) {
        bumpEnergy(s, P.alamoEnergy);
        const f = ensureFlags(s);
        f.alamoCount = num(f.alamoCount) + 1;
      },
    });
  }

  // 2. 街の出来事（city.js がすでに適用済み。ログと演出のため変換）
  (c.cityEvents || []).forEach((ce, i) => {
    const pct = ce.valuePct == null ? null : num(ce.valuePct);
    const severity = pct == null || pct === 0 ? 'info' : pct > 0 ? 'good' : 'bad';
    const already = typeof ce.text === 'string' && ce.text.includes('相場');
    const tail = pct && !already ? ` 相場 ${pct > 0 ? '+' : '−'}${Math.round(Math.abs(pct) * (Math.abs(pct) <= 1 ? 100 : 1))}%。` : '';
    out.push({
      id: `city:${i}`, kind: cityKind(ce.kind), severity,
      title: districtName(state, ce.districtId),
      text: `${ce.text || '何かが起きた。'}${tail}`,
      apply() { /* city.js 側で適用済み */ },
    });
  });

  // 3. 失敗を自慢する（却下された買い付け）
  const rejected = c.rejectedOffers || [];
  if (rejected.length > 0) {
    const n = rejected.length;
    const lines = rejected.map((r) => {
      const dn = districtName(state, r.listing?.districtId);
      const pct = Math.round(num(r.bidRatio || 1) * 100);
      return `${year}年 ${dn}に売出しの${pct}%で買い付け → 却下${r.reaction ? `（${r.reaction}）` : ''}`;
    });
    out.push({
      id: 'brag:rejected', kind: 'brag', severity: 'good',
      title: '失敗を自慢する',
      text: `買い付け${n}件が却下された。自慢ポイント +${n}、エネルギー +${P.bragEnergy * n}。断られた数だけ、次は通る。`,
      meterDelta: { energy: P.bragEnergy * n, brag: n },
      apply(s) {
        if (!s.brag) s.brag = { failures: [], points: 0 };
        for (const l of lines) s.brag.failures.push(l);
        s.brag.points = num(s.brag.points) + n;
        bumpEnergy(s, P.bragEnergy * n);
      },
    });
  }
  const lossRate = num(c.lossRate);
  if (lossRate > P.lossBragRate) {
    const pct = Math.round(lossRate * 100);
    out.push({
      id: 'brag:loss', kind: 'brag', severity: 'bad',
      title: '損失を自慢する',
      text: `純資産が${pct}%減った。自慢ポイント +1、エネルギー +${P.bragEnergy}。損は授業料。記録して次に活かす。`,
      meterDelta: { energy: P.bragEnergy, brag: 1 },
      apply(s) {
        if (!s.brag) s.brag = { failures: [], points: 0 };
        s.brag.failures.push(`${year}年 純資産が${pct}%減った`);
        s.brag.points = num(s.brag.points) + 1;
        bumpEnergy(s, P.bragEnergy);
      },
    });
  }

  // 4. 出会い（達成者）
  if (num(meters.network) >= P.mentorNetwork && rng.chance(P.mentorChance)) {
    const m = rng.pick(MENTOR_TIPS);
    const skill = lowestSkill(state);
    out.push({
      id: 'mentor', kind: 'mentor', severity: 'good',
      title: '達成者との出会い',
      text: `${m.who}に会った。秘訣を聞いた。『${m.tip}』 ${SKILL_NAME[skill]}に +${P.mentorXp} XP。`,
      meterDelta: { xp: P.mentorXp },
      skill,
      apply(s) { addXp(s, skill, P.mentorXp); },
    });
  }

  // 5. 配達員の話
  if (num(t.scouting) >= P.courierScouting) {
    out.push({
      id: 'courier', kind: 'courier', severity: 'info',
      title: '配達員の話',
      text: rng.pick(COURIER_LINES),
      apply(s) { ensureFlags(s).scoutBonus = true; },
    });
  }

  // 6. 病気（非致死）
  if (rng.chance(illnessChance(age))) {
    const cost = rng.int(P.illnessCostMin, P.illnessCostMax);
    out.push({
      id: 'illness', kind: 'illness', severity: 'bad',
      title: '病気',
      text: `${age}歳、体を壊した。医療費${fmtMoney(cost)}。時間は失ったが、命は残った。体も資産だ。`,
      meterDelta: { cash: -cost },
      apply(s) {
        if (!s.money) s.money = { cash: 0, stocks: 0, debt: 0 };
        s.money.cash = num(s.money.cash) - cost;
        const f = ensureFlags(s);
        f.illnessCount = num(f.illnessCount) + 1;
      },
    });
  }

  // 7. 返礼（保留中のギブが今年に到達）
  const pending = flags.giftPending;
  let giftResolved = false;
  if (pending && num(pending.year) <= year) {
    giftResolved = true;
    if (rng.chance(P.giftReturnChance)) {
      const back = Math.round(num(pending.amount) * P.giftReturnMult);
      out.push({
        id: 'giftReturn', kind: 'giftReturn', severity: 'good',
        title: '返礼',
        text: `昔ギブした相手から返礼が来た。${fmtMoney(back)}。下心のないギブは、忘れた頃に返ってくる。`,
        meterDelta: { cash: back },
        apply(s) {
          if (!s.money) s.money = { cash: 0, stocks: 0, debt: 0 };
          s.money.cash = num(s.money.cash) + back;
          ensureFlags(s).giftPending = null;
        },
      });
    } else {
      out.push({
        id: 'giftReturn:none', kind: 'giftReturn', severity: 'info', silent: true,
        title: '', text: '',
        apply(s) { ensureFlags(s).giftPending = null; },
      });
    }
  }

  // 8. ギブ（保留中のギブがなければ）
  if (num(t.networking) >= P.giftNetworking && (!pending || giftResolved)) {
    const amount = Math.max(1, Math.round(num(c.income?.net) * P.giftRate));
    const dueYear = year + 1 + rng.int(0, 2);
    const reason = rng.pick(GIFT_REASONS);
    out.push({
      id: 'gift', kind: 'gift', severity: 'info',
      title: 'ギブ',
      text: `${reason}。${fmtMoney(amount)}、見返りは求めない。人脈 +${P.giftNetwork}。`,
      meterDelta: { cash: -amount, network: P.giftNetwork },
      apply(s) {
        if (!s.money) s.money = { cash: 0, stocks: 0, debt: 0 };
        s.money.cash = num(s.money.cash) - amount;
        if (!s.meters) s.meters = {};
        s.meters.network = clamp(num(s.meters.network) + P.giftNetwork, 0, 100);
        ensureFlags(s).giftPending = { year: dueYear, amount };
      },
    });
  }

  // 9. 本との出会い
  if (num(t.reading) >= P.bookReading && rng.chance(P.bookChance)) {
    const locked = lockedBooks(state);
    if (locked.length > 0) {
      const book = rng.pick(locked);
      out.push({
        id: `book:${book.id}`, kind: 'book', severity: 'info',
        title: '本との出会い',
        text: `古本屋で『${book.title}』を見つけた。本棚に加わった。${book.desc}`,
        bookId: book.id,
        apply(s) {
          const f = ensureFlags(s);
          if (!Array.isArray(f.unlockedBooks)) f.unlockedBooks = [];
          if (!f.unlockedBooks.includes(book.id)) f.unlockedBooks.push(book.id);
        },
      });
    }
  }

  // 10. 小話（1 年に最大 1 件）
  {
    const u = rng.next();
    let acc = 0;
    for (const fe of FLAVOR_EVENTS) {
      acc += P.flavorChance;
      if (u < acc) {
        out.push({
          id: `flavor:${fe.id}`, kind: 'misc', severity: 'info',
          title: fe.title, text: fe.text,
          apply() { /* 演出のみ */ },
        });
        break;
      }
    }
  }

  return out;
}

/**
 * イベントを順に適用し、ログに残す（mutates）。silent なイベントはログに残さない。
 * @param {any} state
 * @param {GameEvent[]} events
 */
export function applyEvents(state, events) {
  if (!state || !Array.isArray(events)) return;
  if (!Array.isArray(state.log)) state.log = [];
  const year = num(state.life?.year);
  for (const e of events) {
    if (!e) continue;
    if (typeof e.apply === 'function') e.apply(state);
    if (e.silent) continue;
    const kind = ['info', 'good', 'bad', 'epic'].includes(e.severity) ? e.severity : 'info';
    state.log.push({ year, kind, text: `${e.title}: ${e.text}` });
  }
  const cap = EVENT_PARAMS.logCap;
  if (state.log.length > cap) state.log.splice(0, state.log.length - cap);
}
