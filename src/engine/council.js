/**
 * @file council.js — 賢人会議（バフェット／ソロス／ヒンメル）
 *
 * 毎年、GameState から 3 人分の助言を生成する。DESIGN.md §11 / API.md 準拠。
 * - 乱数は使わない。同じ状態・同じ年なら必ず同じ台詞になる。
 * - 各賢人はルール表（条件 → 台詞）を持ち、優先度の高い（より具体的な）ルールが勝つ。
 *   同じ優先度が複数当たった場合は (life.year + 賢人の添字) で決定的に選ぶ。
 * - Artifact 上の「深く聞く」用に、同じペルソナで Claude に渡すプロンプトも組み立てる。
 *
 * @typedef {Object} Advice
 * @property {'buffett'|'soros'|'himmel'} id
 * @property {string} name
 * @property {string} text   60〜120 字の日本語
 * @property {'bull'|'bear'|'neutral'|'life'} stance
 * @property {string} focus  UI バッジ用の短いラベル（例: '割高' '負債物件' '人脈'）
 * @property {string} rule   発火したルール id（デバッグ・テスト用）
 *
 * @typedef {Object} Rule
 * @property {string} id
 * @property {'buffett'|'soros'|'himmel'} adv
 * @property {number} pri            優先度。大きいほど具体的で、先に評価される
 * @property {(v: View) => boolean} when
 * @property {(v: View) => string} text
 * @property {'bull'|'bear'|'neutral'|'life'} stance
 * @property {string} focus
 */
import { level } from './skills.js';

/** 賢人のメタデータ（UI の色・イニシャルを含む）。 */
export const ADVISORS = [
  { id: 'buffett', name: 'バフェット', initial: 'B', color: '#D9A441' },
  { id: 'soros', name: 'ソロス', initial: 'S', color: '#E4482C' },
  { id: 'himmel', name: 'ヒンメル', initial: 'H', color: '#6FBFA3' },
];

// ---------------------------------------------------------------------------
// 書式ヘルパー
// ---------------------------------------------------------------------------

/**
 * 万円単位の金額を表示用に整形する。2400 → '2,400万'、12000 → '1.2億'、30000 → '3億'。
 * @param {number} n 万円
 * @returns {string}
 */
export function fmtMoney(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0万';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a < 10000) return `${sign}${Math.round(a).toLocaleString('en-US')}万`;
  const oku = a / 10000;
  if (oku >= 100) return `${sign}${Math.round(oku).toLocaleString('en-US')}億`;
  return `${sign}${oku.toFixed(1).replace(/\.0$/, '')}億`;
}

/** 有限数なら v、そうでなければ d。 */
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** 0.123 → '12'（digits 桁）。 */
const pct = (r, digits = 0) => (num(r, 0) * 100).toFixed(digits);
/** 符号付き。0.12 → '+12'、−0.08 → '−8'。 */
const spct = (r, digits = 0) => {
  const s = (num(r, 0) * 100).toFixed(digits);
  return s.startsWith('-') ? s.replace('-', '−') : `+${s}`;
};
/** 配列の末尾から k 番目（k=1 が最後）。 */
const tail = (arr, k = 1) => (Array.isArray(arr) && arr.length >= k ? arr[arr.length - k] : undefined);
/** 整数丸め（表示用）。 */
const r0 = (v) => Math.round(num(v, 0));

// ---------------------------------------------------------------------------
// 状態の読み取り（View）
// ---------------------------------------------------------------------------

/**
 * 市場の局面ラベル。market.js の regimeLabel と同じ語彙。
 * @param {{x:number, wc:number, crash:boolean, lastReturn:number}} m
 */
function regimeOf(m) {
  if (m.x < -0.25) return '底値';
  if (m.crash) return '暴落';
  if (m.x > 0.35) return 'バブル';
  if (m.wc > 0.65 && m.x > 0.15) return '過熱';
  if (m.lastReturn < -0.10) return '調整';
  return '平穏';
}

/**
 * 直近 n 年の市場リターン（古い順）。history を優先し、無ければ series.index から復元する。
 * @param {Array} history
 * @param {{index?:number[]}} series
 * @param {number} n
 * @returns {number[]}
 */
function recentReturns(history, series, n) {
  const fromHist = history
    .map((h) => h && h.marketReturn)
    .filter((r) => typeof r === 'number' && Number.isFinite(r));
  if (fromHist.length) return fromHist.slice(-n);
  const idx = Array.isArray(series && series.index) ? series.index : [];
  const out = [];
  for (let i = Math.max(1, idx.length - n); i < idx.length; i++) {
    if (idx[i - 1] > 0) out.push(idx[i] / idx[i - 1] - 1);
  }
  return out;
}

/**
 * ルール評価に使う、正規化された読み取り専用ビュー。
 * すべての値が存在し有限であることを保証するので、ルール側では防御コードを書かない。
 * @param {import('./game.js').GameState|Object} state
 * @param {{yearResult?:Object|null, quantLevel?:number}} [ctx]
 * @returns {View}
 */
function buildView(state, ctx = {}) {
  const s = state || {};
  const life = s.life || {};
  const money = s.money || {};
  const props = Array.isArray(s.props) ? s.props : [];
  const meters = s.meters || {};
  const skills = s.skills || {};
  const policy = s.policy || {};
  const time = policy.time || {};
  const work = s.work || {};
  const flags = s.flags || {};
  const brag = s.brag || {};
  const history = Array.isArray(s.history) ? s.history : [];
  const market = s.market || {};
  const series = market.series || {};
  const yr = ctx.yearResult || market.last || null;

  // --- 市場 ---
  const x = num(yr && yr.x, num(tail(series.x), num(market.p, 0) - num(market.f, 0)));
  const wc = num(yr && yr.wc, num(market.wc, num(tail(series.wc), 0.5)));
  const wcPrev = num(tail(series.wc, 2), wc);
  const returns = recentReturns(history, series, 3);
  const lastReturn = num(yr && yr.totalReturn, num(tail(returns), 0));
  const rate = num(yr && yr.rate, num(market.rate, 0.02));
  const mortgageRate = num(yr && yr.mortgageRate, rate + 0.012);
  const dividendYield = num(yr && yr.dividendYield, 0.02 * Math.exp(-x));
  const crash = yr ? !!yr.crash : lastReturn < -0.25;
  const bubble = yr ? !!yr.bubble : x > 0.35;
  const premium = Math.exp(x) - 1; // 本源価値に対する割高率（+なら割高）

  // --- 資産・負債 ---
  const cash = num(money.cash, 0);
  const stocks = num(money.stocks, 0);
  const liquid = Math.max(0, cash) + Math.max(0, stocks);
  const stockShare = liquid > 0 ? Math.max(0, stocks) / liquid : 0;
  const cashShare = liquid > 0 ? Math.max(0, cash) / liquid : 0;
  const propViews = props.map((p, i) => {
    const cf = num(p && p.lastCashflow, 0);
    const isAsset = p && typeof p.isAsset === 'boolean' ? p.isAsset : cf >= 0;
    return {
      name: (p && p.name) || `物件${i + 1}`,
      cf,
      isAsset,
      value: num(p && p.value, 0),
      loan: num(p && p.loan, 0),
      rent: num(p && p.rent, 0),
    };
  });
  const assets = propViews.filter((p) => p.isAsset);
  const liabilities = propViews.filter((p) => !p.isAsset).sort((a, b) => a.cf - b.cf);
  const worst = liabilities[0] || null;
  const sumNegCf = liabilities.reduce((a, p) => a + Math.min(0, p.cf), 0);
  const sumPosCf = assets.reduce((a, p) => a + Math.max(0, p.cf), 0);
  const totalValue = propViews.reduce((a, p) => a + p.value, 0);
  const totalLoan = propViews.reduce((a, p) => a + p.loan, 0);
  const totalRent = propViews.reduce((a, p) => a + p.rent, 0);
  const ltv = totalValue > 0 ? totalLoan / totalValue : 0;
  const avgYield = totalValue > 0 ? totalRent / totalValue : 0;
  const netWorth = cash + stocks + (totalValue - totalLoan);

  // 前年比の純資産成長率（history の直近「前年」の記録と比較）
  const year = num(life.year, 2026);
  const prev = [...history].reverse().find((h) => h && num(h.year, year) < year && Number.isFinite(h.netWorth));
  const nwGrowth = prev && Math.abs(prev.netWorth) > 100 ? (netWorth - prev.netWorth) / Math.abs(prev.netWorth) : 0;

  // --- スキル ---
  const lv = {};
  for (const id of ['reading', 'comm', 'local', 'quant', 'guts']) {
    lv[id] = level(num(skills[id] && skills[id].xp, 0));
  }
  const quantLevel = num(ctx.quantLevel, lv.quant >= 7 ? 4 : lv.quant >= 5 ? 3 : lv.quant >= 3 ? 2 : lv.quant >= 1 ? 1 : 0);

  return {
    age: r0(num(life.age, 22)),
    year,
    alive: life.alive !== false,
    cash, stocks, liquid, stockShare, cashShare, netWorth, nwGrowth,
    debt: num(money.debt, totalLoan),
    x, wc, wcPrev, wcRising: wc > wcPrev + 0.03,
    returns, lastReturn, rate, mortgageRate, dividendYield, crash, bubble, premium,
    regime: regimeOf({ x, wc, crash, lastReturn }),
    props: propViews, assets, liabilities, worst, sumNegCf, sumPosCf,
    totalValue, totalLoan, avgYield, ltv,
    fun: r0(num(meters.fun, 50)),
    energy: r0(num(meters.energy, 0)),
    network: r0(num(meters.network, 0)),
    learning: r0(num(meters.learning, 0)),
    lv, quantLevel,
    readingTime: r0(num(time.reading, 0)),
    funTime: r0(num(time.fun, 0)),
    networkingTime: r0(num(time.networking, 0)),
    savingsRate: num(policy.savingsRate, 0),
    stockAlloc: num(policy.stockAlloc, 0),
    salary: num(work.salary, 0),
    employed: work.employed !== false,
    fired: !!flags.fired,
    offersMade: r0(num(flags.offersMade, 0)),
    offersAccepted: r0(num(flags.offersAccepted, 0)),
    alamoCount: r0(num(flags.alamoCount, 0)),
    failures: Array.isArray(brag.failures) ? brag.failures.length : 0,
    lastOffers: Array.isArray(policy.offers) ? policy.offers : [],
  };
}

// ---------------------------------------------------------------------------
// ルール表
// ---------------------------------------------------------------------------

/** @type {Rule[]} */
const BUFFETT_RULES = [
  {
    id: 'b_broke', pri: 100, stance: 'neutral', focus: '資金繰り',
    when: (v) => v.cash < 0,
    text: (v) => `現金が${fmtMoney(v.cash)}の赤字だ。投資の話はその後でいい。私のルールは二つ。一つ、金を失うな。二つ、一つ目を忘れるな。まず出血を止めてから、次の話をしよう。`,
  },
  {
    id: 'b_liability_many', pri: 91, stance: 'neutral', focus: '負債物件',
    when: (v) => v.liabilities.length >= 2,
    text: (v) => `負債物件が${v.liabilities.length}件。合わせて毎年${fmtMoney(-v.sumNegCf)}があなたの財布から出ていく。家賃が利息と元本に負けている物件を、私は資産とは呼ばない。売るか、家賃を直すかだ。`,
  },
  {
    id: 'b_liability_one', pri: 90, stance: 'neutral', focus: '負債物件',
    when: (v) => v.liabilities.length === 1,
    text: (v) => `${v.worst.name}は資産ではない。負債だ。毎年${fmtMoney(-v.worst.cf)}をあなたから奪っている。家賃が利息と元本に負けている物件は、値上がりを祈るだけの宝くじだよ。`,
  },
  {
    id: 'b_ltv', pri: 85, stance: 'neutral', focus: 'レバレッジ',
    when: (v) => v.ltv > 0.8 && v.totalLoan > 0,
    text: (v) => `借入が物件価値の${pct(v.ltv)}%。賢い人がレバレッジで消えていくのを、私は何度も見てきた。金利が${pct(v.mortgageRate, 1)}%から少し上がるだけで、あなたの黒字は赤字に変わる。`,
  },
  {
    id: 'b_greedy_nocash', pri: 83, stance: 'bull', focus: '割安',
    when: (v) => v.crash && v.x < -0.25 && v.cash < 200,
    text: (v) => `市場は本源価値より${pct(-v.premium)}%安い。安売りの日に財布が空とは残念だ。次の暴落までに弾を貯めておくこと。それが先取り投資の本当の理由だよ。持ち株は手放すな。`,
  },
  {
    id: 'b_greedy_crash', pri: 82, stance: 'bull', focus: '割安',
    when: (v) => v.crash && v.x < -0.25,
    text: (v) => `今年の市場は${spct(v.lastReturn)}%。皆が恐れている今こそ貪欲になる時だ。株価は本源価値より${pct(-v.premium)}%安く、配当利回りは${pct(v.dividendYield, 1)}%。手元の${fmtMoney(v.cash)}の出番だよ。`,
  },
  {
    id: 'b_bubble_heavy', pri: 81, stance: 'bear', focus: '割高',
    when: (v) => v.x > 0.35 && v.stockShare > 0.6 && v.stocks > 0,
    text: (v) => `株価は本源価値を${pct(v.premium)}%上回っている。あなたの流動資産の${pct(v.stockShare)}%が株だ。値段は払うもの、価値は得るもの。今は払いすぎている。少し減らして、待とう。`,
  },
  {
    id: 'b_bubble', pri: 80, stance: 'bear', focus: '割高',
    when: (v) => v.x > 0.35,
    text: (v) => `株価は本源価値を${pct(v.premium)}%も上回り、配当利回りは${pct(v.dividendYield, 1)}%しかない。皆が貪欲な時は恐れよ。新たに買うのはやめて、現金${fmtMoney(v.cash)}を握って待つ勇気を持とう。`,
  },
  {
    id: 'b_cheap_cash', pri: 78, stance: 'bull', focus: '割安',
    when: (v) => v.x < -0.25 && v.cash >= 200,
    text: (v) => `株は本源価値より${pct(-v.premium)}%安く売られている。配当利回り${pct(v.dividendYield, 1)}%は預金の何倍だ。現金${fmtMoney(v.cash)}を眠らせておく理由がない。良い会社を安く、が全てだよ。`,
  },
  {
    id: 'b_cheap_nocash', pri: 77, stance: 'bull', focus: '割安',
    when: (v) => v.x < -0.25,
    text: (v) => `本源価値より${pct(-v.premium)}%安い。こういう年は十年に一度あるかないかだ。買う金がないなら、せめて持っている株を手放すな。安値で売る人が、誰かの富を作っている。`,
  },
  {
    id: 'b_loss_hold', pri: 70, stance: 'neutral', focus: '忍耐',
    when: (v) => v.lastReturn < -0.1 && v.stocks > 0 && v.x >= -0.25,
    text: (v) => `今年の市場は${spct(v.lastReturn)}%。あなたの株${fmtMoney(v.stocks)}は値を下げたが、会社の価値まで下がったわけではない。株式市場は、せっかちな人から辛抱強い人へ金を移す装置だ。`,
  },
  {
    id: 'b_old_debt', pri: 65, stance: 'neutral', focus: '借入',
    when: (v) => v.age >= 60 && v.totalLoan > 500,
    text: (v) => `${v.age}歳で借入が${fmtMoney(v.totalLoan)}残っている。私は借金で眠れない夜を過ごしたことがない。定年後のレバレッジは味方ではなく、取り立て屋になる。少しずつ減らそう。`,
  },
  {
    id: 'b_rate', pri: 62, stance: 'neutral', focus: '金利',
    when: (v) => v.mortgageRate > 0.05 && v.totalLoan > 0,
    text: (v) => `ローン金利が${pct(v.mortgageRate, 1)}%。あなたの物件の平均利回りは${pct(v.avgYield, 1)}%だ。この差が縮むほど、物件は資産から負債へ静かに変わっていく。数字は毎年見直すものだよ。`,
  },
  {
    id: 'b_streak', pri: 60, stance: 'neutral', focus: '便乗',
    when: (v) => v.returns.length >= 3 && v.returns.every((r) => r > 0) && v.x > 0.15 && v.x <= 0.35,
    text: (v) => `三年続けて上がった。今の乖離は${spct(v.premium)}%。潮が引いて初めて、誰が裸で泳いでいたか分かる。上がった理由を一行で言えないなら、それは投資ではなく便乗だ。`,
  },
  {
    id: 'b_cash_idle', pri: 55, stance: 'neutral', focus: '現金',
    when: (v) => v.cash > 1000 && v.cashShare > 0.6 && v.x < 0.2 && !v.crash,
    text: (v) => `現金が${fmtMoney(v.cash)}、流動資産の${pct(v.cashShare)}%だ。現金は最悪の長期投資だよ。インフレが毎年少しずつ削っていく。値段が正しいものから順に、働かせよう。`,
  },
  {
    id: 'b_savings', pri: 52, stance: 'neutral', focus: '先取り',
    when: (v) => v.savingsRate < 0.1 && v.employed && v.age < 60,
    text: (v) => `先取り貯蓄率が${pct(v.savingsRate)}%。使った残りを投資するのではない。投資した残りを使うんだ。給料日に自分へ先に払う人だけが、複利という一番の味方を得る。`,
  },
  {
    id: 'b_slightly_rich', pri: 50, stance: 'neutral', focus: 'やや割高',
    when: (v) => v.x > 0.2 && v.x <= 0.35,
    text: (v) => `株価は本源価値より${pct(v.premium)}%高め。売るほどではないが、買い増しを急ぐ値段でもない。配当${pct(v.dividendYield, 1)}%を受け取りながら、次の安売りの日を静かに待とう。`,
  },
  {
    id: 'b_reading', pri: 45, stance: 'neutral', focus: '読書',
    when: (v) => v.readingTime < 10,
    text: (v) => `読書に時間の${v.readingTime}%しか使っていない。私は今でも一日の大半を読んで過ごす。知識は複利で増える唯一の資産だ。今年は本を一冊、実行とセットで読もう。`,
  },
  {
    id: 'b_assets_praise', pri: 40, stance: 'neutral', focus: '資産',
    when: (v) => v.assets.length >= 1 && v.liabilities.length === 0 && v.sumPosCf > 0,
    text: (v) => `${v.assets.length}件の物件が毎年${fmtMoney(v.sumPosCf)}を運んでくる。これが資産だ。あなたが寝ている間に金が入ってくる仕組みを作れた。次はこの家賃を、また資産に変えよう。`,
  },
  {
    id: 'b_discipline', pri: 35, stance: 'neutral', focus: '規律',
    when: (v) => v.offersMade >= 3 && v.offersAccepted === 0,
    text: (v) => `${v.offersMade}回の買い付けが全て却下された。悪くない。値段にこだわるのは投資の第一歩だ。見送った取引は失敗ではない。払いすぎた取引だけが失敗だよ。`,
  },
  {
    id: 'b_snowball', pri: 30, stance: 'neutral', focus: '複利',
    when: (v) => v.netWorth >= 10000,
    text: (v) => `純資産が${fmtMoney(v.netWorth)}になった。雪玉には湿った雪と長い坂があればいい。あなたはもう坂の途中だ。派手なことをしなくていい。転がり続けるだけで、増える。`,
  },
  {
    id: 'b_calm_wait', pri: 0, stance: 'neutral', focus: '忍耐',
    when: () => true,
    text: (v) => `乖離は${spct(v.premium)}%、配当利回りは${pct(v.dividendYield, 1)}%。特別なことは何もない年だ。良い会社を妥当な値段で持ち、あとは待つ。忍耐は無料で、しかも一番効く。`,
  },
  {
    id: 'b_calm_forever', pri: 0, stance: 'neutral', focus: '忍耐',
    when: () => true,
    text: (v) => `純資産${fmtMoney(v.netWorth)}。私の一番好きな保有期間は「永遠」だ。今年も売る理由がないなら売るな。市場の機嫌ではなく、会社の稼ぐ力だけを見ていればいい。`,
  },
  {
    id: 'b_calm_forecast', pri: 0, stance: 'neutral', focus: '忍耐',
    when: () => true,
    text: (v) => `今年の市場は${spct(v.lastReturn)}%だった。良くも悪くも、来年を予言する材料にはならない。予測屋の言葉より、自分の財布の中の数字を読む方がずっと役に立つよ。`,
  },
];

/** @type {Rule[]} */
const SOROS_RULES = [
  {
    id: 's_crash_cash', pri: 90, stance: 'bull', focus: '急所',
    when: (v) => v.crash && v.cash >= 300,
    text: (v) => `暴落だ。市場は${spct(v.lastReturn)}%。皆が投げている時は急所を狙え。半端に買うな。現金${fmtMoney(v.cash)}のうち、いくらを賭けるか今夜決めろ。恐怖は最良の売り手だ。`,
  },
  {
    id: 's_crash_nocash', pri: 89, stance: 'bull', focus: '急所',
    when: (v) => v.crash,
    text: (v) => `暴落は毎年は来ない好機だ。乖離${spct(v.premium)}%。弾がないなら、持ち株を投げないことが唯一の攻めだ。次のアラモまでに現金を積め。急所は、準備した者だけが突ける。`,
  },
  {
    id: 's_turning', pri: 85, stance: 'bear', focus: '転換点',
    when: (v) => v.wc > 0.7 && v.x > 0.3,
    text: (v) => `転換点が近い。チャーティストが${pct(v.wc)}%を占め、乖離は${pct(v.premium)}%。反射的ループはもう自分の重さで軋んでいる。減らせ。天井で売ろうとするな、天井の前で降りろ。`,
  },
  {
    id: 's_bubble_heavy', pri: 80, stance: 'bear', focus: '撤退線',
    when: (v) => v.x > 0.3 && v.stockShare > 0.8 && v.stocks > 0,
    text: (v) => `流動資産の${pct(v.stockShare)}%を株に置き、乖離は${pct(v.premium)}%。全額を賭けるなら、どこで降りるかを先に決めろ。撤退線のない仮説は、仮説ではなくただの祈りだ。`,
  },
  {
    id: 's_no_stocks_bull', pri: 75, stance: 'bull', focus: '不在',
    when: (v) => v.stocks <= 0 && !v.crash && v.x > -0.2 && v.x < 0.3 && (v.lastReturn > 0.05 || v.wcRising),
    text: (v) => `株をゼロにしたまま、市場は${spct(v.lastReturn)}%動いた。あなたの仮説は何だ。「上がらない」に賭けているなら、それを紙に書け。書けないなら、それはただ怖いだけだ。`,
  },
  {
    id: 's_pessimism', pri: 72, stance: 'bull', focus: '底',
    when: (v) => v.x < -0.25 && !v.crash,
    text: (v) => `悲観のループだ。乖離は${spct(v.premium)}%、ファンダメンタル派が${pct(1 - v.wc)}%。行き過ぎた市場は、行き過ぎたまま反転する。底の鐘は誰も鳴らさない。少しずつ買え。`,
  },
  {
    id: 's_ride', pri: 70, stance: 'bull', focus: '反射性',
    when: (v) => v.wcRising && v.lastReturn > 0.05 && v.x > 0 && v.x <= 0.3,
    text: (v) => `反射的ループが強まっている。チャーティストが${pct(v.wcPrev)}%から${pct(v.wc)}%に増えた。トレンドは乗るものだ。ただし高値から15%下で必ず降りる、と先に決めてから乗れ。`,
  },
  {
    id: 's_down_momentum', pri: 68, stance: 'bear', focus: '下落トレンド',
    when: (v) => v.wc > 0.6 && v.lastReturn < -0.1 && !v.crash && v.x >= -0.25,
    text: (v) => `チャーティスト${pct(v.wc)}%が下落に乗っている。反射的な下落は本源価値を突き抜ける。まだ受け止めるな。落ちてくるナイフではなく、落ち終わったナイフを拾え。`,
  },
  {
    id: 's_bubble_lowwc', pri: 65, stance: 'bear', focus: '割高',
    when: (v) => v.x > 0.35 && v.wc < 0.5,
    text: (v) => `乖離${pct(v.premium)}%なのにチャーティストは${pct(v.wc)}%。燃料のないバブルは長く続かない。自己強化が止まった割高は、ただの割高だ。私なら、ここで持ち高を半分にする。`,
  },
  {
    id: 's_two_losses', pri: 60, stance: 'neutral', focus: '可謬性',
    when: (v) => v.returns.length >= 2 && v.returns.slice(-2).every((r) => r < 0) && v.stocks > 0 && !v.crash,
    text: (v) => `二年続けて負けた。直近は${spct(v.lastReturn)}%。仮説が間違っていたなら、認めるのが私の唯一の強さだ。誤りは恥ではない。固執が恥だ。どこが外れたか、一行で書け。`,
  },
  {
    id: 's_credit_ltv', pri: 58, stance: 'neutral', focus: '信用',
    when: (v) => v.ltv > 0.75 && v.totalLoan > 0,
    text: (v) => `借入が物件価値の${pct(v.ltv)}%。信用の膨張は上り坂では味方だが、下り坂では加速器になる。あなたの仮説が外れた時、銀行は最初に電話をかけてくる相手だ。`,
  },
  {
    id: 's_rate', pri: 55, stance: 'neutral', focus: '金利',
    when: (v) => v.rate > 0.04,
    text: (v) => `金利が${pct(v.rate, 1)}%。反射性は株だけでなく信用にも働く。借りやすさが価格を上げ、価格が借りやすさを上げる。その輪が逆回転する時、借入${fmtMoney(v.totalLoan)}が試される。`,
  },
  {
    id: 's_alamo_survivor', pri: 50, stance: 'neutral', focus: '生存',
    when: (v) => v.alamoCount >= 2 && !v.crash,
    text: (v) => `あなたは${v.alamoCount}回の暴落を生き延びた。生き残った者だけが、次の反射的ループを外から眺められる。前回の暴落で何をしたか。それが次の暴落での、あなたの仮説だ。`,
  },
  {
    id: 's_big_win', pri: 45, stance: 'neutral', focus: '慢心',
    when: (v) => v.nwGrowth > 0.3,
    text: (v) => `今年、純資産が${pct(v.nwGrowth)}%増えた。私は勝った時ほど不安になる。市場が正しかったのか、あなたが正しかったのか。区別できないなら、儲けの一部は運だと認めろ。`,
  },
  {
    id: 's_no_offers', pri: 42, stance: 'neutral', focus: '大胆',
    when: (v) => v.offersMade === 0 && v.age > 23 && v.age < 45,
    text: (v) => `${v.age}歳で買い付けはまだゼロ回。仮説を持たない者は市場に何も問えない。半額で買い付けを出せ。却下されても学びが残る。大胆さは才能ではなく、回数だ。`,
  },
  {
    id: 's_hypothesis', pri: 40, stance: 'neutral', focus: '仮説',
    when: (v) => v.quantLevel < 1 && v.stocks > 0,
    text: (v) => `株を${fmtMoney(v.stocks)}持っている。その仮説を書け。「何が起きたら間違いと認めるか」まで含めて。反証できない仮説は信念であって、投資ではない。`,
  },
  {
    id: 's_calm_question', pri: 0, stance: 'neutral', focus: '仮説',
    when: () => true,
    text: (v) => `平時だ。チャーティストは${pct(v.wc)}%、乖離は${spct(v.premium)}%。今年の仮説を一つ、反証条件つきで書け。市場は答えを教えない。問いの質だけが、あなたの取り分を決める。`,
  },
  {
    id: 's_calm_wrong', pri: 0, stance: 'neutral', focus: '偏り',
    when: () => true,
    text: (v) => `市場は常に間違っている。今の乖離${spct(v.premium)}%も、正しさではなく参加者の偏りの合計だ。偏りがどちらに膨らんでいるか。それを言葉にできた者から、儲かる。`,
  },
  {
    id: 's_calm_review', pri: 0, stance: 'neutral', focus: '検証',
    when: () => true,
    text: (v) => `今年の市場は${spct(v.lastReturn)}%。それより大事なのは、あなたが事前に何を予想し、どこが外れたかだ。当たった理由より、外れた理由の方が、来年のあなたを強くする。`,
  },
];

/** @type {Rule[]} */
const HIMMEL_RULES = [
  {
    id: 'h_broke', pri: 95, stance: 'life', focus: '転生',
    when: (v) => v.cash < 0,
    text: (v) => `現金が${fmtMoney(v.cash)}か。怖いだろうね。でも破産は終わりじゃない。この世界には転生がある。今日までの失敗を全部、次の自分への手紙にしよう。勇者ヒンメルならそうした。`,
  },
  {
    id: 'h_memory', pri: 90, stance: 'life', focus: '記憶',
    when: (v) => v.age > 75,
    text: (v) => `${v.age}歳。僕が死んだ後に残ったのは、金じゃなくて誰かの中の記憶だった。君を思い出して笑う人は何人いる。純資産${fmtMoney(v.netWorth)}より、その数を数えてみて。`,
  },
  {
    id: 'h_statue', pri: 88, stance: 'life', focus: '笑顔',
    when: (v) => v.netWorth >= 10000 && v.fun < 40,
    text: (v) => `純資産${fmtMoney(v.netWorth)}。すごいね。でも楽しさは${v.fun}だ。僕は銅像をたくさん建てたけど、本当に残したかったのは笑顔だった。銅像より笑顔を。今年は少し遊ぼう。`,
  },
  {
    id: 'h_fun_low', pri: 85, stance: 'life', focus: '楽しみ',
    when: (v) => v.fun < 30,
    text: (v) => `楽しさが${v.fun}まで下がっている。がんばり屋だね。でも、楽しくない人生を勝ちとは呼ばない。今年は楽しむ時間を${v.funTime}から増やしてみて。勇者ヒンメルならそうした。`,
  },
  {
    id: 'h_network_low', pri: 80, stance: 'life', focus: '人脈',
    when: (v) => v.network < 30,
    text: (v) => `人脈が${v.network}。誰かに何かを与えた最後はいつだった。見返りを求めない贈り物は、いつか思わぬ道から戻ってくる。今年は一人でいい、誰かの力になってみて。`,
  },
  {
    id: 'h_fired', pri: 78, stance: 'life', focus: '再出発',
    when: (v) => v.fired && !v.employed,
    text: (v) => `仕事を失ったんだね。${v.age}歳、現金${fmtMoney(v.cash)}。旅の途中で仲間と離れることはある。でも旅は続く。失った年のことを、いつか笑って話せるように。今日は休んでいい。`,
  },
  {
    id: 'h_age30', pri: 75, stance: 'life', focus: '節目',
    when: (v) => v.age === 30,
    text: (v) => `三十歳。若さは終わらない、形を変えるだけだ。純資産${fmtMoney(v.netWorth)}、人脈${v.network}。この十年で作った縁は、次の十年で君を助ける。焦らなくていい、でも止まるな。`,
  },
  {
    id: 'h_age40', pri: 75, stance: 'life', focus: '節目',
    when: (v) => v.age === 40,
    text: (v) => `四十歳か。純資産${fmtMoney(v.netWorth)}。ここから先は、増やすことより「誰と増やすか」が大事になる。体は少しずつ正直になる。エネルギー${v.energy}を大切に、楽しみを削るな。`,
  },
  {
    id: 'h_age50', pri: 75, stance: 'life', focus: '節目',
    when: (v) => v.age === 50,
    text: (v) => `五十歳。学び${v.learning}、楽しさ${v.fun}。積み上げたものを、そろそろ誰かに渡し始めてもいい頃だ。教えることは、二度目に学ぶことだから。旅の後半は、仲間のためにある。`,
  },
  {
    id: 'h_age60', pri: 75, stance: 'life', focus: '節目',
    when: (v) => v.age === 60,
    text: (v) => `六十歳、おめでとう。純資産${fmtMoney(v.netWorth)}。ここからは金を増やす旅じゃなく、残す旅だ。誰に何を渡すか。金じゃなくていい。話でも、道でも。勇者ヒンメルならそうした。`,
  },
  {
    id: 'h_energy_crash', pri: 72, stance: 'life', focus: '勇気',
    when: (v) => v.energy >= 50 && v.crash,
    text: (v) => `暴落だ。怖いだろう。でもエネルギーは${v.energy}。最悪の時こそ最高の時だ。皆が下を向いている時に前を見る人が、あとで語れる話を手に入れる。勇者ヒンメルならそうした。`,
  },
  {
    id: 'h_energy_high', pri: 70, stance: 'life', focus: '勇気',
    when: (v) => v.energy >= 50,
    text: (v) => `エネルギーが${v.energy}もある。いい顔をしているね。最悪の時は最高の時だ。今のうちに、いつもなら怖くてできないことを一つやってみて。勇者ヒンメルならそうした。`,
  },
  {
    id: 'h_fun_zero_time', pri: 65, stance: 'life', focus: '時間',
    when: (v) => v.funTime === 0 && v.fun >= 30,
    text: (v) => `今年、楽しむ時間をゼロにしたね。分かるよ、急ぎたいんだろう。でも楽しさ${v.fun}は放っておけば減る。楽しまなかった年は思い出に残らない。少しでいい、遊んで。`,
  },
  {
    id: 'h_fire', pri: 62, stance: 'life', focus: '自由',
    when: (v) => !v.employed && !v.fired && v.age < 60,
    text: (v) => `自由になったんだね。${v.age}歳で働かずに暮らせる人は少ない。さて、何をする。自由は目的じゃなく、道具だ。誰かのために使った自由だけが、後になって君を温める。`,
  },
  {
    id: 'h_energy_low', pri: 60, stance: 'life', focus: '休息',
    when: (v) => v.energy < 15,
    text: (v) => `エネルギーが${v.energy}。疲れているね。勇者だって休む。休むことは逃げじゃなく、次の旅の準備だ。今年は無理に攻めなくていい。眠って、食べて、誰かと笑って。`,
  },
  {
    id: 'h_failures', pri: 55, stance: 'life', focus: '失敗',
    when: (v) => v.failures >= 3,
    text: (v) => `失敗が${v.failures}回。いいね、それだけ挑んだ証だ。僕は失敗を仲間に自慢していた。笑い話にした失敗は、もう君を傷つけない。転生の時、全部持っていこう。`,
  },
  {
    id: 'h_young', pri: 50, stance: 'life', focus: '旅立ち',
    when: (v) => v.age <= 24,
    text: (v) => `${v.age}歳、旅は始まったばかりだ。純資産${fmtMoney(v.netWorth)}は小さくていい。今の君にあって、後の君にないものは時間だ。学び、与え、笑え。順番はどれからでもいい。`,
  },
  {
    id: 'h_network_high', pri: 45, stance: 'life', focus: '縁',
    when: (v) => v.network >= 70,
    text: (v) => `人脈が${v.network}。君が与えてきたものが、ちゃんと縁になっている。金は使えば減るけど、縁は使うほど増える。困っている誰かがいたら、今年も真っ先に手を出そう。`,
  },
  {
    id: 'h_learning', pri: 40, stance: 'life', focus: '継承',
    when: (v) => v.learning >= 300,
    text: (v) => `学びが${v.learning}。よく学んだね。でも学びは、誰かに渡して初めて完成する。今年知ったことを一つ、誰かに話してごらん。それが君の残す、一番小さな銅像だ。`,
  },
  {
    id: 'h_calm_today', pri: 0, stance: 'life', focus: '今日',
    when: () => true,
    text: (v) => `${v.age}歳、今日も生きている。純資産${fmtMoney(v.netWorth)}、楽しさ${v.fun}、人脈${v.network}。特別な年じゃなくていい。誰かをちょっと助けて、ちょっと笑う。それが旅だ。`,
  },
  {
    id: 'h_calm_memory', pri: 0, stance: 'life', focus: '今日',
    when: () => true,
    text: (v) => `楽しさ${v.fun}、エネルギー${v.energy}。悪くない顔だ。旅の記憶は金額じゃなく、誰と笑ったかで残る。今年も一つ、後で話したくなることをしよう。勇者ヒンメルならそうした。`,
  },
  {
    id: 'h_calm_tool', pri: 0, stance: 'life', focus: '今日',
    when: () => true,
    text: (v) => `${v.age}歳。人はいつか死ぬ。だから今日、誰かの役に立てたら、それだけで一日は成功だ。純資産${fmtMoney(v.netWorth)}は道具。道具は誰かのために使ってこそ、光る。`,
  },
];

/**
 * 全ルール表（テスト用に公開）。各要素は `adv` に賢人 id を持つ。
 * @type {Rule[]}
 */
export const RULES = [
  ...BUFFETT_RULES.map((r) => ({ ...r, adv: 'buffett' })),
  ...SOROS_RULES.map((r) => ({ ...r, adv: 'soros' })),
  ...HIMMEL_RULES.map((r) => ({ ...r, adv: 'himmel' })),
];

// ---------------------------------------------------------------------------
// 助言の生成
// ---------------------------------------------------------------------------

/**
 * 賢人ごとの「市場に対する立場」の強制ルール（DESIGN §11）。
 * ルール個別の stance より優先する。ヒンメルは常に 'life'。
 * @param {string} advisorId
 * @param {View} v
 * @param {Rule} rule
 */
function stanceOf(advisorId, v, rule) {
  if (advisorId === 'himmel') return 'life';
  if (advisorId === 'buffett') {
    if (v.x > 0.35) return 'bear';
    if (v.x < -0.25) return 'bull';
    return rule.stance;
  }
  if (advisorId === 'soros') {
    if (v.wc > 0.7 && v.x > 0.3) return 'bear';
    if (v.crash) return 'bull';
    return rule.stance;
  }
  return rule.stance;
}

/**
 * 一人の賢人について、優先度最大のルールを決定的に選ぶ。
 * @param {number} advisorIndex
 * @param {View} v
 * @returns {Rule}
 */
function pickRule(advisorIndex, v, recent = []) {
  const adv = ADVISORS[advisorIndex].id;
  const hits = [];
  for (const rule of RULES) {
    if (rule.adv !== adv) continue;
    let hit = false;
    try { hit = !!rule.when(v); } catch { hit = false; }
    if (hit) hits.push(rule);
  }
  if (!hits.length) return RULES.find(r => r.adv === adv);
  hits.sort((a, b) => b.pri - a.pri);
  // 直近に使ったルールは次点に譲る（同じ台詞が毎年続かないように）。全部使用済みなら最上位に戻る。
  const fresh = hits.filter(r => !recent.includes(r.id));
  const pool = fresh.length ? fresh : hits;
  const best = pool[0].pri;
  const ties = pool.filter(r => r.pri === best);
  // 同順位は (年 + 賢人添字) で決定的に選ぶ。乱数は使わない。
  const k = ((v.year + advisorIndex) % ties.length + ties.length) % ties.length;
  return ties[k];
}

/**
 * 賢人会議。3 人分の助言を返す（順序は ADVISORS と同じ）。state は変更しない。
 * @param {Object} state GameState
 * @param {{yearResult?:Object|null, quantLevel?:number}} [ctx]
 * @returns {Advice[]}
 */
export function advise(state, ctx = {}) {
  const v = buildView(state, ctx);
  const recentAll = (state && state.flags && state.flags.councilRecent) || {};
  return ADVISORS.map((a, i) => {
    const recent = Array.isArray(recentAll[a.id]) ? recentAll[a.id] : [];
    const rule = pickRule(i, v, recent);
    return {
      id: a.id,
      name: a.name,
      text: rule.text(v),
      stance: stanceOf(a.id, v, rule),
      focus: rule.focus,
      rule: rule.id,
    };
  });
}

// ---------------------------------------------------------------------------
// Claude sample 用
// ---------------------------------------------------------------------------

/**
 * 状態の要約（Claude sample プロンプト用）。上位キーは 25 個以下。
 * @param {Object} state GameState
 * @returns {Object}
 */
export function stateDigest(state) {
  const v = buildView(state);
  const r3 = (n) => Math.round(num(n, 0) * 1000) / 1000;
  return {
    age: v.age,
    year: v.year,
    netWorth: r0(v.netWorth),
    cash: r0(v.cash),
    stocks: r0(v.stocks),
    debt: r0(v.debt),
    salary: r0(v.salary),
    props: {
      count: v.props.length,
      assets: v.assets.length,
      liabilities: v.liabilities.length,
      worstCashflow: v.worst ? r0(v.worst.cf) : 0,
    },
    market: {
      x: r3(v.x),
      premiumPct: r0(v.premium * 100),
      wc: r3(v.wc),
      lastReturn: r3(v.lastReturn),
      dividendYield: r3(v.dividendYield),
      regime: v.regime,
    },
    trend: v.returns.map(r3),
    rate: r3(v.rate),
    mortgageRate: r3(v.mortgageRate),
    meters: { fun: v.fun, energy: v.energy, network: v.network, learning: v.learning },
    skills: { ...v.lv },
    savingsRate: r3(v.savingsRate),
    stockAlloc: r3(v.stockAlloc),
    readingTime: v.readingTime,
    offers: {
      made: v.offersMade,
      accepted: v.offersAccepted,
      last: v.lastOffers.slice(0, 3).map((o) => ({ bid: r3(o && o.bidRatio), ltv: r3(o && o.ltv) })),
    },
    alamoCount: v.alamoCount,
  };
}

/** 人格シート（Claude に渡す声のルール）。 */
const PERSONA = {
  buffett: [
    '口調: 平易で素朴、隣のおじいさんの世間話。数字を先に言い、結論は短く。焦らず、辛抱を勧める。',
    '関心: 本源価値との乖離（premiumPct）、配当利回り、現金の使い道、キャッシュフローが赤字の「負債物件」、借入比率、読書時間。',
    '決まり: 割高（x>0.35）なら恐れよ、割安（x<-0.25）なら貪欲に。負債物件は「それは資産ではない、負債だ」と実額で叱る。',
    '禁止: 相場の予言、専門用語の羅列、架空の名言。実在の考え方は自分の言葉として言い換える。',
  ],
  soros: [
    '口調: 鋭く挑発的、短文を重ねる。仮説→検証→撤退線の順で考える。自分の可謬性を隠さない。',
    '関心: 反射的ループの強さ（チャーティスト比率 wc）、直近のトレンド（trend）、乖離 x、信用の膨張、プレイヤーの持ち高。',
    '決まり: wc>0.7 かつ x>0.3 は「転換点が近い、減らせ」。暴落年は「急所を狙え」。反証可能な仮説を一行で書かせる。株ゼロの強気相場では挑発する。',
    '禁止: 曖昧な励まし、両論併記で終わること、根拠のない断定。',
  ],
  himmel: [
    '口調: 穏やかで、まっすぐ勇敢。「君」と呼びかける。死んだ後に何が残るかを話す。締めに「勇者ヒンメルならそうした」を使ってよい。',
    '関心: 楽しさ（fun）、エネルギー、人脈、年齢の節目、与えること、仲間。金は道具として扱う。',
    '決まり: fun<30 は楽しめ、network<30 は与えよ、energy>=50 は「最悪の時が最高の時」。富があって fun が低いなら「銅像より笑顔を」。',
    '禁止: 市場の予測、金額の自慢、説教くささ。',
  ],
};

/** ゲームの価値観（3 行要約）。 */
const VALUES_SUMMARY = [
  '資産と負債はキャッシュフローの符号で区別する。家賃が利息と元本に負ける物件は「負債」で、毎年金を奪う。',
  '給料は貯め込まず投資と学習に回す。買い付けは半額でも出す。却下も損失も学びになり、失敗は自慢していい。',
  '死は終わりではない。スキルを持って転生する。だから恐怖で選択を縮めない。人脈は見返りなく与えて育つ。',
];

/**
 * Claude `sample` 用のプロンプトを組み立てる（Artifact 上の「深く聞く」）。
 * 人格シート + 状態要約 JSON + 価値観の要約 + 厳格な出力制約。
 * @param {'buffett'|'soros'|'himmel'} advisorId
 * @param {Object} state GameState
 * @param {{yearResult?:Object|null, quantLevel?:number, question?:string}} [ctx]
 * @returns {string}
 */
export function buildSamplePrompt(advisorId, state, ctx = {}) {
  const advisor = ADVISORS.find((a) => a.id === advisorId) || ADVISORS[0];
  const digest = stateDigest(state);
  const baseline = advise(state, ctx).find((a) => a.id === advisor.id);
  const question = typeof ctx.question === 'string' && ctx.question.trim() ? ctx.question.trim().slice(0, 200) : '';
  const lines = [
    `あなたはゲーム「転生クオンツ」の賢人会議の一人、${advisor.name}として、プレイヤーに助言する。`,
    '',
    `## 人格（${advisor.name}）`,
    ...PERSONA[advisor.id].map((l) => `- ${l}`),
    '',
    '## プレイヤーの現在の状態（単位: 万円。x は本源価値との対数乖離、wc はチャーティスト比率、meters は 0〜100）',
    JSON.stringify(digest),
    '',
    '## このゲームの価値観',
    ...VALUES_SUMMARY.map((l) => `- ${l}`),
    '',
    '## 今年の定型助言（これより一段深く、具体的に）',
    baseline ? baseline.text : '',
  ];
  if (question) {
    lines.push('', '## プレイヤーからの問い', question);
  }
  lines.push(
    '',
    '## 出力制約（厳守）',
    '- 日本語、120字以内、1段落、改行なし。',
    '- 前置き・挨拶・引用符・箇条書き・署名なし。本文だけを返す。',
    '- 上の状態の数値を必ず1つ以上そのまま引用する（例: 純資産、乖離、楽しさ、負債物件の年間赤字）。',
    `- ${advisor.name}の人格から外れない。ゲームの外の現実の投資助言はしない。`,
  );
  return lines.join('\n');
}
