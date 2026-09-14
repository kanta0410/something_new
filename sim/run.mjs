// ヘッドレス方針シミュレーター: 4 つの方針で N 人生を回し、結果分布を表にする（バランス確認用）。
import { newGame, endYear, defaultDecisions, defaultMeta } from '../src/engine/game.js';
import { computeScore } from '../src/engine/score.js';
import { netWorth } from '../src/engine/life.js';
import { createRng } from '../src/engine/rng.js';
import { maxLtv } from '../src/engine/city.js';
import { skillLevels } from '../src/engine/skills.js';
import { availableBooks } from '../src/engine/books.js';

// 毎日モードのプリセット（UI と同じ数値）
const PRESET = {
  guard: { time: { reading: 30, scouting: 10, networking: 20, fun: 30, hustle: 10 }, savingsRate: 0.5, stockAlloc: 0.5 },
  attack: { time: { reading: 15, scouting: 40, networking: 25, fun: 10, hustle: 10 }, savingsRate: 0.7, stockAlloc: 0.7, quick: true },
  learn: { time: { reading: 45, scouting: 10, networking: 25, fun: 15, hustle: 5 }, savingsRate: 0.6, stockAlloc: 0.6, books: 2 },
  play: { time: { reading: 10, scouting: 10, networking: 20, fun: 50, hustle: 10 }, savingsRate: 0.3, stockAlloc: 0.5 },
};
function quickOffers(s, ratio) {
  const lv = skillLevels(s); const income = s.history[s.history.length - 1]?.income || s.work.salary; const out = [];
  for (const l of [...s.city.listings].sort((a, b) => a.ask - b.ask)) {
    const price = l.ask * ratio; const cap = maxLtv({ commLevel: lv.comm, network: s.meters.network, income, price });
    if (price * (1 - cap) + price * 0.07 <= s.money.cash * 0.95) { out.push({ listingId: l.id, bidRatio: ratio, ltv: cap }); if (out.length >= 3) break; }
  }
  return out;
}
function presetPolicy(id) {
  return (s, d) => {
    const p = PRESET[id]; d.time = { ...p.time }; d.savingsRate = p.savingsRate; d.stockAlloc = p.stockAlloc;
    if (p.books) { const read = new Set(s.flags.booksRead || []); d.books = availableBooks(s).filter(b => !read.has(b.id)).slice(0, 2).map(b => b.id); }
    if (p.quick) { let o = quickOffers(s, 0.7); if (!o.length) o = quickOffers(s, 0.5); d.offers = o; d.scoutTargets = [...new Set(s.city.listings.map(l => l.districtId))].slice(0, 3); }
  };
}

const N = Number(process.argv[2] || 100);

const POLICIES = {
  '毎日: 守る': presetPolicy('guard'),
  '毎日: 攻める': presetPolicy('attack'),
  '毎日: 学ぶ': presetPolicy('learn'),
  '毎日: 遊ぶ': presetPolicy('play'),
  放置: (s, d) => { d.time = { reading: 10, scouting: 0, networking: 10, fun: 60, hustle: 20 }; d.savingsRate = 0.2; d.stockAlloc = 0; },
  堅実: (s, d) => { d.time = { reading: 30, scouting: 10, networking: 20, fun: 30, hustle: 10 }; d.savingsRate = 0.5; d.stockAlloc = 0.6; },
  金持ち父さん: (s, d, rng) => {
    d.time = { reading: 20, scouting: 40, networking: 25, fun: 10, hustle: 5 };
    d.savingsRate = 0.7; d.stockAlloc = 0.5;
    // 偵察先: 推定利回りが高い 3 地区
    const ds = [...s.city.districts].sort((a, b) => (b.yieldRate || 0) - (a.yieldRate || 0));
    d.scoutTargets = ds.slice(0, 3).map(x => x.id);
    // 買い付け: 毎年 3 本、bid 0.7〜0.85、LTV 0.8
    const cash = s.money.cash;
    const ls = s.city.listings.filter(l => l.ask * 0.85 * 0.27 <= cash).sort((a, b) => a.ask - b.ask);
    d.offers = ls.slice(0, 3).map(l => ({ listingId: l.id, bidRatio: 0.7 + 0.15 * rng.next(), ltv: 0.8 }));
    // 負債物件は売る
    d.sells = s.props.filter(p => p.isAsset === false && (s.life.year - p.boughtYear) > 3).map(p => p.id);
  },
  ギャンブラー: (s, d, rng) => {
    d.time = { reading: 5, scouting: 20, networking: 15, fun: 40, hustle: 20 };
    d.savingsRate = 0.8; d.stockAlloc = 1.0;
    const ls = s.city.listings.filter(l => l.ask * 0.5 * 0.17 <= s.money.cash);
    d.offers = ls.slice(0, 3).map(l => ({ listingId: l.id, bidRatio: 0.5, ltv: 0.9 }));
  },
};

function pct(arr, p) { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }
function fmt(v) { return v >= 10000 ? (v / 10000).toFixed(1) + '億' : Math.round(v) + '万'; }

const rows = [];
for (const [name, policy] of Object.entries(POLICIES)) {
  const rng = createRng(12345);
  const res = { nw: [], nw60: [], age: [], score: [], bankrupt: 0, props: [], alamo: [], offers: 0, accepted: 0, fired: 0 };
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const state = newGame(defaultMeta(), 1000 + i);
    let nw60 = null;
    while (state.life.alive) {
      const d = defaultDecisions(state);
      policy(state, d, rng);
      const r = endYear(state, d);
      if (state.life.age === 60) nw60 = netWorth(state);
      if (!Number.isFinite(netWorth(state))) throw new Error(`NaN net worth at age ${state.life.age} policy ${name}`);
    }
    const sc = computeScore(state);
    res.nw.push(netWorth(state)); res.nw60.push(nw60 ?? netWorth(state)); res.age.push(state.life.age); res.score.push(sc.total);
    if (state.life.deathCause === 'bankrupt') res.bankrupt++;
    res.props.push(state.props.length); res.alamo.push(state.flags.alamoCount);
    res.offers += state.flags.offersMade; res.accepted += state.flags.offersAccepted; if (state.flags.fired) res.fired++;
  }
  rows.push({
    方針: name,
    '純資産@60 中央値': fmt(pct(res.nw60, 0.5)), 'p10': fmt(pct(res.nw60, 0.1)), 'p90': fmt(pct(res.nw60, 0.9)),
    '最終純資産 中央値': fmt(pct(res.nw, 0.5)), '享年 中央値': pct(res.age, 0.5), 'スコア 中央値': Math.round(pct(res.score, 0.5)),
    '破産率': (res.bankrupt / N * 100).toFixed(1) + '%', '物件数 中央値': pct(res.props, 0.5), 'アラモ回数 中央値': pct(res.alamo, 0.5),
    '買付通過率': res.offers ? (res.accepted / res.offers * 100).toFixed(1) + '%' : '-', 'FIRE率': (res.fired / N * 100).toFixed(0) + '%',
    'ms/人生': ((Date.now() - t0) / N).toFixed(1),
  });
}
console.table(rows);
