// _stubs.js — TEMPORARY development stubs owned by the UI lead.
// NOT imported by app.js. A dev-only esbuild script (kept outside the repo) redirects an
// engine/ui module to this file ONLY while that module is missing on disk, so the UI can be
// exercised before the real modules land. Shapes follow src/engine/API.md.
// Covers: city.js, events.js, books.js, score.js, cityView.js. Real modules are used for the rest.
import { addXp } from '../engine/skills.js';
import { netWorth } from '../engine/life.js';
import { fitCanvas } from './charts.js';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ───────────── city.js ───────────── */
const KINDS = ['駅前', '住宅', '郊外', '湾岸', '山手', '工業'];
const PRE = ['青葉', '桜', '若葉', '港', '丘', '川', '森', '光', '旭', '錦', '栄', '緑', '梅', '松', '藤', '白', '大', '小'];
const SUF = { '駅前': '駅前', '住宅': '町', '郊外': '野', '湾岸': '浜', '山手': 'が丘', '工業': '工区' };
const SECRETS = [
  { kind: 'redevelop', text: '工事のおっちゃん「ここ、来年から再開発だってよ」', effect: { trendDelta: 0.03 } },
  { kind: 'station', text: '配達員の話「新駅ができるって噂、本当らしい」', effect: { valueJumpPct: 0.25, fireYear: 3 } },
  { kind: 'factory', text: '不動産屋の愚痴「工場が閉まるんだと。人が減る」', effect: { trendDelta: -0.03 } },
  { kind: 'aging', text: '八百屋の女将「若い人、みんな出てっちゃった」', effect: { yieldDeltaPerYear: -0.01 } },
  { kind: 'flood', text: '古老「あの川、昔は毎年あふれてた」', effect: { shockProb: 0.03, shockPct: -0.3 } },
  { kind: 'univ', text: '学生「キャンパス移転、決まったらしいよ」', effect: { trendDelta: 0.02 } },
];
export function createCity(rng) {
  const districts = [];
  for (let i = 0; i < 36; i++) {
    const kind = KINDS[Math.floor(rng.next() * 6)];
    const value = Math.round(1500 + 7500 * rng.next());
    const yieldRate = clamp(0.13 - (value - 1500) / 7500 * 0.09 + 0.015 * rng.normal(), 0.035, 0.13);
    const trend = -0.03 + 0.07 * rng.next();
    const nSec = rng.next() < 0.5 ? 0 : rng.next() < 0.7 ? 1 : 2;
    const secrets = [];
    for (let k = 0; k < nSec; k++) {
      const s = SECRETS[Math.floor(rng.next() * SECRETS.length)];
      secrets.push({ id: `s${i}_${k}`, kind: s.kind, text: s.text, fired: false, effect: { ...s.effect } });
    }
    const estError = 0.30;
    districts.push({
      id: i, x: i % 6, y: Math.floor(i / 6),
      name: PRE[Math.floor(rng.next() * PRE.length)] + SUF[kind], kind, value, yieldRate, trend,
      secrets, knownSecrets: [], visits: 0,
      estimate: value * Math.exp(estError * rng.normal()), estError, owned: 0,
    });
  }
  const city = { districts, listings: [], year: 0, nextListingId: 1 };
  regenListings(city, rng, false);
  return city;
}
function regenListings(city, rng, crash) {
  city.listings = [];
  for (const d of city.districts) {
    const n = rng.next() < 0.55 ? 0 : rng.next() < 0.75 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const m = 0.08 + 0.08 * rng.normal();
      const motivated = rng.next() < (crash ? 0.45 : 0.15);
      const theta = motivated ? 0.68 + 0.08 * rng.normal() : 0.92 + 0.04 * rng.normal();
      city.listings.push({ id: `L${city.nextListingId++}`, districtId: d.id, ask: Math.round(d.value * (1 + m)), theta, motivated, year: city.year });
    }
  }
}
export function stepCity(city, ctx, rng) {
  const events = [];
  city.year = ctx.year;
  for (const d of city.districts) {
    let shock = 0;
    for (const s of d.secrets) {
      if (s.effect.trendDelta) d.trend += s.effect.trendDelta * 0.2;
      if (s.effect.yieldDeltaPerYear) d.yieldRate = Math.max(0.02, d.yieldRate + s.effect.yieldDeltaPerYear);
      if (s.effect.shockProb && rng.next() < s.effect.shockProb) { shock += s.effect.shockPct; events.push({ kind: 'flood', districtId: d.id, text: `${d.name}で浸水。相場 ${(s.effect.shockPct * 100).toFixed(0)}%`, valuePct: s.effect.shockPct }); }
      if (s.effect.valueJumpPct && !s.fired && s.effect.fireYear != null && s.effect.fireYear-- <= 0) { s.fired = true; shock += s.effect.valueJumpPct; events.push({ kind: 'station', districtId: d.id, text: `${d.name}に新駅開業。相場 +${(s.effect.valueJumpPct * 100).toFixed(0)}%`, valuePct: s.effect.valueJumpPct }); }
    }
    const g = d.trend + 0.3 * (ctx.marketReturn - 0.05) + 0.06 * rng.normal();
    d.value *= Math.exp(g) * (1 + shock);
    d.estimate = d.value * Math.exp(d.estError * rng.normal());
  }
  regenListings(city, rng, ctx.crash);
  return { events };
}
export function scout(city, id, ctx, rng) {
  const d = city.districts[id];
  if (!d) return { revealed: null, estimate: 0, estError: 0.3, text: '' };
  d.visits += 1;
  d.estError = 0.30 * Math.exp(-0.35 * d.visits) * (1 - 0.06 * (ctx.localLevel || 0));
  d.estimate = d.value * Math.exp(d.estError * rng.normal());
  let revealed = null;
  const hidden = d.secrets.filter(s => !d.knownSecrets.includes(s.id));
  if (hidden.length && rng.next() < 0.45 + 0.04 * (ctx.localLevel || 0) + (ctx.bonus ? 0.2 : 0)) { revealed = hidden[0]; d.knownSecrets.push(revealed.id); }
  return { revealed, estimate: d.estimate, estError: d.estError, text: revealed ? `${d.name}: ${revealed.text}` : `${d.name}を自転車で回った。相場感が少し掴めた。` };
}
export function evaluateOffer(city, listingId, offer, ctx, rng) {
  const l = city.listings.find(x => x.id === listingId);
  if (!l) return { accepted: false, reaction: '売出しは既に消えていた', price: 0, bidRatio: offer.bidRatio };
  const thetaEff = l.theta - 0.008 * (ctx.commLevel || 0) - 0.03 * (ctx.network > 60) - 0.02 * (ctx.energy > 50);
  const p = 1 / (1 + Math.exp(-30 * (offer.bidRatio - thetaEff)));
  const accepted = rng.next() < p;
  const reaction = accepted ? '売主「…それで手を打とう」' : offer.bidRatio > thetaEff - 0.05 ? '惜しい。あと一歩だった' : offer.bidRatio > thetaEff - 0.15 ? '検討はしてくれた' : '鼻で笑われた';
  return { accepted, reaction, price: Math.round(l.ask * offer.bidRatio), bidRatio: offer.bidRatio };
}
export function maxLtv(ctx) {
  let ltv = 0.70 + 0.02 * (ctx.commLevel || 0) + 0.10 * (ctx.network > 60);
  const cap = 8 * (ctx.income || 0);
  if (ctx.price > 0) ltv = Math.min(ltv, cap / ctx.price);
  return clamp(ltv, 0, 0.95);
}
export function createProperty(city, listing, price, ltv, mortgageRate, year) {
  const d = city.districts[listing.districtId];
  d.owned += 1;
  const loan = price * ltv;
  return { id: `P${listing.id}`, districtId: d.id, name: `${d.name}の物件`, buyPrice: price, value: d.value, loan, rate: mortgageRate, boughtYear: year, rent: d.yieldRate * d.value, lastCashflow: 0, isAsset: true };
}
export function stepProperty(prop, city, ctx, rng) {
  const d = city.districts[prop.districtId];
  prop.value = d.value;
  prop.rent = d.yieldRate * d.value;
  prop.rate = ctx.mortgageRate;
  const r = prop.rate;
  const pay = prop.loan > 0 ? (r > 0 ? prop.loan * r / (1 - Math.pow(1 + r, -25)) : prop.loan / 25) : 0;
  const interest = prop.loan * r;
  const principal = Math.min(prop.loan, pay - interest);
  prop.loan -= principal;
  const cashflow = prop.rent * 0.92 - 0.01 * prop.value - interest - principal;
  prop.lastCashflow = cashflow;
  prop.isAsset = cashflow >= 0;
  return { cashflow, rent: prop.rent, interest, principal, isAsset: prop.isAsset };
}
export function saleProceeds(prop, city, ctx) {
  const v = city.districts[prop.districtId].value * (ctx.crash ? 0.8 : 1);
  return v * 0.95 - prop.loan;
}
export function districtSummary(city, id) {
  const d = city.districts[id];
  return {
    name: d.name, kind: d.kind, estimate: d.estimate, estError: d.estError, estYield: d.yieldRate * (1 + 0.1 * (d.estError - 0.15)),
    knownSecrets: d.secrets.filter(s => d.knownSecrets.includes(s.id)).map(s => s.text),
    listings: city.listings.filter(l => l.districtId === id).map(l => ({ id: l.id, ask: l.ask, districtId: id })),
    visits: d.visits, owned: d.owned,
  };
}

/* ───────────── events.js ───────────── */
export function rollEvents(state, d, ctx, rng) {
  const ev = [];
  const yr = ctx.yearResult;
  const year = state.life.year;
  if (yr && yr.crash) ev.push({ id: 'alamo', kind: 'alamo', title: 'アラモの時', text: `市場が ${(yr.totalReturn * 100).toFixed(0)}% 暴落。エネルギー +40。売主の投げ売りが増えている。`, severity: 'epic', apply: (s) => { s.meters.energy = Math.min(100, s.meters.energy + 40); s.flags.alamoCount = (s.flags.alamoCount || 0) + 1; } });
  for (const r of ctx.rejectedOffers || []) {
    const dn = state.city.districts[r.listing.districtId]?.name || '';
    ev.push({ id: 'rej' + r.listing.id, kind: 'misc', title: '買い付け却下', text: `${dn}への買い付け（${Math.round(r.bidRatio * 100)}%）は却下。${r.reaction}`, severity: 'bad', apply: (s) => { s.brag.failures.push(`${year}年 ${dn}への買い付け（${Math.round(r.bidRatio * 100)}%）は却下：${r.reaction}`); s.brag.points += 1; s.meters.energy = Math.min(100, s.meters.energy + 8); } });
  }
  if (state.meters.network >= 60 && rng.chance(0.25)) ev.push({ id: 'mentor', kind: 'mentor', title: '達成者との出会い', text: '「秘訣？ 続けることだよ」胆力 +80 XP', severity: 'good', apply: (s) => addXp(s, 'guts', 80) });
  if (rng.chance(0.02 + Math.max(0, state.life.age - 40) * 0.0005)) { const cost = 100 + rng.int(0, 400); ev.push({ id: 'ill', kind: 'illness', title: '病気', text: `入院。医療費 ${cost}万`, severity: 'bad', apply: (s) => { s.money.cash -= cost; } }); }
  if (d.time.networking >= 30 && rng.chance(0.3)) { const g = Math.round((ctx.income?.net || 0) * 0.02); ev.push({ id: 'gift', kind: 'gift', title: 'ギブ', text: `知人の困りごとを助けた（${g}万）。人脈 +10`, severity: 'info', apply: (s) => { s.money.cash -= g; s.meters.network = Math.min(100, s.meters.network + 10); } }); }
  for (const c of ctx.cityEvents || []) ev.push({ id: 'city' + c.districtId, kind: c.kind, title: c.kind === 'station' ? '新駅' : '浸水', text: c.text, severity: c.kind === 'station' ? 'good' : 'bad', apply: () => {} });
  return ev;
}
export function applyEvents(state, events) {
  for (const e of events) {
    if (typeof e.apply === 'function') e.apply(state);
    state.log.push({ year: state.life.year, kind: e.severity === 'info' ? 'info' : e.severity, text: e.kind === 'alamo' ? 'REMEMBER THE ALAMO — 市場暴落。エネルギー +40' : e.text });
  }
}

/* ───────────── books.js ───────────── */
export const BOOKS = [
  { id: 'buffett', title: 'バフェットからの手紙', author: 'ウォーレン・バフェット', tags: ['quant', 'reading'], xp: { quant: 60, reading: 40 }, quote: '他人が貪欲なときに恐れ、他人が恐れているときに貪欲であれ。', desc: '本源価値と忍耐。市場の気分に値段を付けさせない。', cost: 10 },
  { id: 'soros', title: 'ソロスの錬金術', author: 'ジョージ・ソロス', tags: ['quant'], xp: { quant: 60 }, quote: '重要なのは正しいか間違っているかではなく、正しいときにいくら儲け、間違っているときにいくら失うかだ。', desc: '反射性。市場は現実を映すだけでなく現実を作る。', cost: 10 },
  { id: 'richdad', title: '金持ち父さん 貧乏父さん', author: 'ロバート・キヨサキ', tags: ['local'], xp: { local: 40, reading: 40 }, quote: '資産はポケットにお金を入れ、負債はポケットからお金を取っていく。', desc: 'キャッシュフローの符号で資産と負債を見分ける。', cost: 10 },
  { id: 'frieren', title: '葬送のフリーレン', author: '山田鐘人 / アベツカサ', tags: ['guts'], xp: { guts: 40, reading: 40 }, quote: '人生は、もっと知っておくべきだった。', desc: '長い時間の使い方。勇者の言葉を思い出す。', cost: 10 },
  { id: 'influence', title: '影響力の武器', author: 'ロバート・チャルディーニ', tags: ['comm'], xp: { comm: 60 }, quote: '返報性は、人間社会で最も強力な武器のひとつだ。', desc: 'ギブが返ってくる理由。交渉の裏側。', cost: 10 },
  { id: 'fooled', title: 'まぐれ', author: 'ナシーム・タレブ', tags: ['quant'], xp: { quant: 60 }, quote: '運を実力と勘違いした者から市場は退場させる。', desc: '確率論的思考。生存者バイアスと黒い白鳥。', cost: 10 },
  { id: 'kelly', title: 'ディーラーをやっつけろ', author: 'エドワード・ソープ', tags: ['quant'], xp: { quant: 60 }, quote: '賭け金の大きさこそが、勝つ者と破滅する者を分ける。', desc: 'ケリー基準の原点。', cost: 10 },
  { id: 'atomic', title: '複利で伸びる1つの習慣', author: 'ジェームズ・クリアー', tags: ['reading'], xp: { reading: 60 }, quote: '毎日1%良くなれば、1年で37倍になる。', desc: '小さな習慣の複利。', cost: 10 },
];
export function availableBooks(state) { return BOOKS; }
export function readBook(state, id, executed) {
  const b = BOOKS.find(x => x.id === id);
  if (!b) return null;
  let xpGained = 0;
  for (const [k, v] of Object.entries(b.xp)) xpGained += addXp(state, k, executed ? v : v / 2);
  if (state.flags) { state.flags.booksRead = state.flags.booksRead || []; state.flags.booksRead.push(id); }
  return { xpGained, quote: b.quote, title: b.title };
}

/* ───────────── score.js ───────────── */
export function computeScore(state) {
  const NW = netWorth(state);
  const wealth = 1000 * (1 - Math.exp(-Math.max(0, NW) / 30000));
  const fun = 1000 * (1 - Math.exp(-(state.meters.funTotal || 0) / 2500));
  const learning = 1000 * (1 - Math.exp(-(state.meters.learning || 0) / 1500));
  const network = 1000 * (1 - Math.exp(-(state.meters.networkTotal || 0) / 2500));
  const brag = 20 * (state.brag.points || 0);
  return { wealth, fun, learning, network, brag, total: wealth + fun + learning + network + brag };
}
export function epitaph(state, score) {
  const e = { wealth: '金は残した。次は笑え。', fun: '笑って生きた。金は次でいい。', learning: '学び続けた。実行は次の生で。', network: '人に恵まれた。それが財産だった。', brag: '失敗を誇った。それが誇りだった。' };
  let best = 'wealth';
  for (const k of Object.keys(e)) if (score[k] > score[best]) best = k;
  return e[best];
}
export function lifeSummary(state, score) {
  const h = state.history;
  return {
    age: state.life.age, years: h.length, netWorth: netWorth(state),
    peakNetWorth: Math.max(0, ...h.map(x => x.netWorth)),
    offersMade: state.flags.offersMade, offersAccepted: state.flags.offersAccepted, alamoCount: state.flags.alamoCount,
    failures: state.brag.failures.slice(), events: state.log.filter(l => l.kind === 'epic' || l.kind === 'bad' || l.kind === 'good').length,
  };
}

/* ───────────── cityView.js (stub) ───────────── */
function cellGeom(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const size = Math.floor(Math.min(w, h) / 6);
  return { size, ox: Math.floor((w - size * 6) / 2), oy: Math.floor((h - size * 6) / 2) };
}
export function drawCity(canvas, city, o = {}) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const { size, ox, oy } = cellGeom(canvas);
  for (const d of city.districts) {
    const x = ox + d.x * size, y = oy + d.y * size;
    const fog = d.visits === 0;
    const t = clamp((d.yieldRate - 0.035) / 0.095, 0, 1);
    ctx.fillStyle = fog ? '#15263D' : `rgba(${Math.round(111 + (217 - 111) * t)},${Math.round(191 - (191 - 164) * t)},${Math.round(163 - (163 - 65) * t)},${0.25 + 0.5 * t})`;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    if (fog) { ctx.fillStyle = 'rgba(143,140,184,.25)'; for (let i = 3; i < size - 3; i += 6) for (let j = 3; j < size - 3; j += 6) ctx.fillRect(x + i, y + j, 2, 2); }
    if (o.ownedDistrictIds && o.ownedDistrictIds.has(d.id)) { ctx.fillStyle = '#F1E9D2'; ctx.fillRect(x + 4, y + 4, 8, 8); }
    if (o.listingDistrictIds && o.listingDistrictIds.has(d.id) && (o.blink !== false)) { ctx.fillStyle = '#E4482C'; ctx.fillRect(x + size - 12, y + 4, 8, 8); }
    if (o.scoutTargets && o.scoutTargets.has(d.id)) { ctx.strokeStyle = '#6FBFA3'; ctx.setLineDash([3, 2]); ctx.strokeRect(x + 3.5, y + 3.5, size - 7, size - 7); ctx.setLineDash([]); }
    if (o.hover === d.id) { ctx.strokeStyle = '#8F8CB8'; ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3); }
    if (o.selected === d.id) { ctx.strokeStyle = '#D9A441'; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, size - 4, size - 4); ctx.lineWidth = 1; }
    ctx.fillStyle = 'rgba(241,233,210,.8)'; ctx.font = '10px DotGothic16, sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
    ctx.fillText(d.kind, x + 4, y + size - 4);
  }
  ctx.strokeStyle = '#2A4266'; ctx.strokeRect(ox + 0.5, oy + 0.5, size * 6 - 1, size * 6 - 1);
}
export function districtAt(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const { size, ox, oy } = cellGeom(canvas);
  const cx = Math.floor((clientX - r.left - ox) / size), cy = Math.floor((clientY - r.top - oy) / size);
  if (cx < 0 || cy < 0 || cx > 5 || cy > 5) return null;
  return cy * 6 + cx;
}
