// city.js — 街と不動産（DESIGN §7）
//
// 6×6 = 36 地区。各地区には真の相場 value（隠し）、利回り yieldRate、隠しトレンド trend、
// 0〜2 個の秘密（再開発・新駅・浸水リスクなど）がある。
// プレイヤーが見えるのは estimate（推定相場）と estError（推定誤差 σ）だけ。偵察で誤差が縮み、秘密が開示される。
// 売出し listing は毎年再生成。売主の本音 theta は隠しで、買い付けはロジスティック確率で通る。
// 乱数は必ず渡された rng（rng.js）を使う。Math.random は使わない。

export const GRID = 6;
export const DISTRICT_COUNT = GRID * GRID;
export const LOAN_TERM = 25;
export const START_YEAR = 2026;

/** 地区種別 */
export const KINDS = Object.freeze(['駅前', '住宅', '郊外', '湾岸', '山手', '工業']);

/** DESIGN §7 の定数（キャリブレーション用にまとめて公開） */
export const CITY_PARAMS = Object.freeze({
  estError0: 0.30,          // 推定誤差の初期値
  estDecay: 0.35,           // 偵察 1 回あたりの誤差減衰 exp(−0.35·visits)
  estLocalFactor: 0.06,     // 地域知 1 レベルあたりの誤差削減
  listingMean: 0.08,        // ask = value·(1+m), m ~ N(0.08, 0.08)
  listingSd: 0.08,
  listingMinM: -0.05,
  thetaNormalMu: 0.92, thetaNormalSd: 0.04,
  thetaMotivatedMu: 0.68, thetaMotivatedSd: 0.08,
  motivatedShare: 0.15,
  motivatedShareCrash: 0.45,
  offerSlope: 30,           // p = σ(30·(bid − θ_eff))
  commTheta: 0.005,         // θ_eff −= 0.005·L(comm)（Lv10 で −0.05）
  networkTheta: 0.03,       // network > 60
  energyTheta: 0.02,        // energy > 50
  crashTheta: 0.02,         // 暴落年は売主が弱気
  marketBeta: 0.3,          // log value += trend + 0.3·(marketReturn − 0.05) + 0.06·ε
  marketBase: 0.05,
  valueSigma: 0.06,
  rentFollow: 0.5,          // 家賃は価値成長の半分で追随
  mgmtFactor: 0.92,         // rent·(1−0.08)
  maintenance: 0.01,        // 0.01·value
  saleCost: 0.05,           // 売却手取り value·0.95
  crashHaircut: 0.20,       // 暴落年の売却は value −20%
  secretBaseFind: 0.35,     // 偵察 1 回の秘密発見率
  secretLocalFind: 0.04,    // + 0.04·L(local)
  secretBonusFind: 0.20,    // 「配達員の話」イベント
});

// ---------------------------------------------------------------------------
// 地名プール（種別ごと。合計 70 以上、重複なし）
// ---------------------------------------------------------------------------
const NAME_POOLS = Object.freeze({
  '駅前': ['中央', '本町', '栄町', '一番町', '大手前', '錦町', '大通', '駅南', '駅北', '銀座通'],
  '住宅': ['桜ヶ丘', '若葉台', '緑町', '梅ヶ丘', '藤見台', '楓台', '泉ヶ丘', '平和台', '二葉町', '相生町', '曙町', '朝日ヶ丘', '千歳台', '大和町', '白鷺台', '弥生町'],
  '郊外': ['上ノ原', '下ノ原', '深沢', '稲荷台', '五月台', '柳原', '榎木町', '桃園', '黒松', '青葉', '日吉', '新田', '野原', '牧の原', '寺田', '小川町'],
  '湾岸': ['港南', '潮見', '汐入', '浜風町', '塩浜', '東港', '北浜', '晴海台', '海浜台', '波止場町'],
  '山手': ['山手町', '御影台', '高台', '松ヶ崎', '宮の森', '白樺町', '椿山', '清水台', '富士見', '星が丘', '月見台', '鶴見台'],
  '工業': ['鉄工町', '西港', '南工町', '船場', '臨海', '機械町', '埠頭', '鋼管町'],
});

/** 種別ごとの初期相場レンジ（万）と利回りのノイズ。value は 1,500〜9,000 に収まる。 */
const KIND_PROFILE = Object.freeze({
  '駅前': { lo: 6000, hi: 9000, trendBias: 0.010 },
  '山手': { lo: 5000, hi: 8500, trendBias: 0.005 },
  '湾岸': { lo: 4000, hi: 7000, trendBias: 0.000 },
  '住宅': { lo: 3000, hi: 6000, trendBias: 0.000 },
  '郊外': { lo: 1500, hi: 3500, trendBias: -0.010 },
  '工業': { lo: 1500, hi: 3000, trendBias: -0.010 },
});

// ---------------------------------------------------------------------------
// 秘密（地区あたり 0〜2）。text は現地の人の語り口（≤ 60 字）。
// effect: fireYear で発火するもの（valueJumpPct / trendDelta / yieldDeltaPerYear が以後有効）と、
//         毎年 shockProb で発火するもの（shockPct）。
// ---------------------------------------------------------------------------
const SECRET_KINDS = Object.freeze([
  {
    kind: '再開発', code: 'redevelop', kinds: ['駅前', '工業', '湾岸', '住宅'], weight: 1.2,
    effect: () => ({ trendDelta: 0.03, valueJumpPct: 0.08 }), delay: [1, 4],
    texts: [
      '工事のおっちゃん「駅裏の古い倉庫、来年ぜんぶ壊すらしい。図面見たけど、でかいぞ」',
      '不動産屋の愚痴「区画整理の説明会、また延びた。でも決まったら地主は笑いが止まらんよ」',
      '大家仲間「市役所の知り合いが言ってた。この一帯、再開発の指定区域に入るってさ」',
    ],
    event: (n) => `${n}で再開発が動き出した。相場 +8%、今後じわじわ上がる`,
  },
  {
    kind: '新駅', code: 'station', kinds: ['郊外', '住宅', '工業'], weight: 1.0,
    effect: () => ({ valueJumpPct: 0.25 }), delay: [2, 8],
    texts: [
      '配達員「あの空き地、毎朝測量の旗が立ってる。駅ができるって噂は本当かもな」',
      '大家仲間「鉄道会社の人間が地権者を回ってる。新駅の話、そろそろ表に出るぞ」',
    ],
    event: (n) => `${n}に新駅が開業！相場 +25%`,
  },
  {
    kind: '工場閉鎖', code: 'factory', kinds: ['工業', '郊外', '湾岸'], weight: 1.0,
    effect: () => ({ trendDelta: -0.03, valueJumpPct: -0.10 }), delay: [1, 6],
    texts: [
      '八百屋のおばちゃん「工場の若い衆、もう弁当買いに来ないのよ。閉めるんだってさ」',
      '工事のおっちゃん「あの工場、ライン止めた。跡地は空き地のまま何年も放置だろうな」',
    ],
    event: (n) => `${n}の工場が閉鎖。相場 −10%、街の活気が消えていく`,
  },
  {
    kind: '高齢化', code: 'aging', kinds: ['郊外', '住宅', '山手'], weight: 1.0,
    effect: () => ({ yieldDeltaPerYear: -0.005, trendDelta: -0.01 }), delay: [1, 3],
    texts: [
      '配達員「この団地、宛名が年寄りばかりになった。若い人はみんな出ていったよ」',
      '八百屋のおばちゃん「商店街、シャッター増えたでしょ。孫が帰ってこないのよ」',
    ],
    event: (n) => `${n}の高齢化が進む。家賃相場が年々下がる`,
  },
  {
    kind: '浸水リスク', code: 'flood', kinds: ['湾岸', '郊外', '工業', '住宅'], weight: 1.0,
    effect: () => ({ shockProb: 0.03, shockPct: -0.30 }), delay: null,
    texts: [
      '工事のおっちゃん「ここ、大雨のたびに水路が溢れる。電柱の跡を見てみな、線がある」',
      '大家仲間「ハザードマップの赤い所だ。地下の駐車場はもう二回沈んでる」',
    ],
    event: (n) => `${n}が浸水！相場 −30%`,
  },
  {
    kind: '大学移転', code: 'campusIn', kinds: ['郊外', '住宅'], weight: 0.6,
    effect: () => ({ valueJumpPct: 0.18 }), delay: [2, 6],
    texts: [
      '不動産屋の愚痴「大学がキャンパスを移してくる。ワンルーム需要、今から仕込むしかない」',
    ],
    event: (n) => `${n}に大学キャンパスが移転。相場 +18%`,
  },
  {
    kind: '大学移転', code: 'campusOut', kinds: ['住宅', '駅前', '山手'], weight: 0.6,
    effect: () => ({ valueJumpPct: -0.18 }), delay: [2, 6],
    texts: [
      '八百屋のおばちゃん「学生さんたち、来年で大学ごと引っ越すって。うちも潮時かねえ」',
    ],
    event: (n) => `${n}から大学が去った。相場 −18%`,
  },
  {
    kind: '大型商業施設', code: 'mall', kinds: ['郊外', '住宅', '湾岸'], weight: 1.0,
    effect: () => ({ valueJumpPct: 0.15 }), delay: [1, 5],
    texts: [
      '工事のおっちゃん「国道沿いの空き地、あれ大型モールの基礎だ。看板が出るのは半年後」',
      '配達員「配送センターの人が言ってた。大手のショッピングモール、ここに来るって」',
    ],
    event: (n) => `${n}に大型商業施設が開業。相場 +15%`,
  },
  {
    kind: '治安悪化', code: 'crime', kinds: ['駅前', '工業', '住宅'], weight: 0.8,
    effect: () => ({ trendDelta: -0.025 }), delay: [1, 4],
    texts: [
      '大家仲間「夜の駐輪場、また荒らされた。入居者が逃げて空室三つ、きついぞ」',
      '配達員「この辺、夜は配達したくない。街灯が切れたまま直らないんだ」',
    ],
    event: (n) => `${n}の治安が悪化。相場がじわじわ下がる`,
  },
  {
    kind: '空港騒音', code: 'noise', kinds: ['湾岸', '郊外', '工業'], weight: 0.8,
    effect: () => ({ trendDelta: -0.015, valueJumpPct: -0.08 }), delay: [1, 5],
    texts: [
      '不動産屋の愚痴「新しい飛行ルート、真上を通るんだ。内見中に飛ばれたら終わりだよ」',
      '大家仲間「窓を替えたのに苦情が来る。空港の便数、来年また増えるらしい」',
    ],
    event: (n) => `${n}の上空に新飛行ルート。相場 −8%、じわじわ下がる`,
  },
  {
    kind: 'タワマン計画', code: 'tower', kinds: ['駅前', '湾岸', '住宅'], weight: 0.9,
    effect: () => ({ valueJumpPct: 0.12, trendDelta: 0.01 }), delay: [2, 6],
    texts: [
      '工事のおっちゃん「杭打ちの深さがえげつない。あれは四十階級のタワーだな」',
      '不動産屋の愚痴「タワマン計画で地主がみんな強気だ。周りの相場も引っ張られる」',
    ],
    event: (n) => `${n}にタワーマンション着工。相場 +12%`,
  },
]);

/** 秘密の種類一覧（テスト・UI 用）。 */
export const SECRET_KIND_NAMES = Object.freeze([...new Set(SECRET_KINDS.map(s => s.kind))]);

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** 現在の推定誤差 σ（DESIGN §7）。 */
export function estimateError(visits, localLevel = 0) {
  const P = CITY_PARAMS;
  return P.estError0 * Math.exp(-P.estDecay * Math.max(0, visits)) * (1 - P.estLocalFactor * clamp(num(localLevel), 0, 10));
}

/** 地区の実効トレンド = trend + 発火済み秘密の trendDelta。 */
function effectiveTrend(d) {
  let t = num(d.trend);
  for (const s of d.secrets || []) {
    if (s.fired && s.effect && s.effect.trendDelta && s.effect.fireYear != null) t += s.effect.trendDelta;
  }
  return t;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 種別を空間的に決める: 駅前は中心、湾岸は一辺、山手は反対辺、工業は湾岸の隣。 */
function layoutKinds(rng) {
  const orient = rng.int(0, 3);
  const depth = (x, y) => (orient === 0 ? y : orient === 1 ? GRID - 1 - y : orient === 2 ? x : GRID - 1 - x);
  const kinds = new Array(DISTRICT_COUNT);
  const c0 = GRID / 2 - 1, c1 = GRID / 2; // 中心 2×2
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const id = y * GRID + x;
      const dep = depth(x, y);
      const isCenter = x >= c0 && x <= c1 && y >= c0 && y <= c1;
      const centerDist = Math.max(Math.abs(x - (c0 + 0.5)), Math.abs(y - (c0 + 0.5))); // 0.5, 1.5, 2.5
      let k;
      if (isCenter) k = '駅前';
      else if (dep === GRID - 1) k = (x === 0 || x === GRID - 1 || y === 0 || y === GRID - 1) && rng.chance(0.5) && isCornerLike(x, y) ? '工業' : '湾岸';
      else if (dep === 0) k = '山手';
      else if (dep === GRID - 2) k = rng.chance(0.55) ? '工業' : (centerDist <= 1.5 ? '住宅' : '郊外');
      else k = centerDist <= 1.5 || rng.chance(0.35) ? '住宅' : '郊外';
      kinds[id] = k;
    }
  }
  // 駅前を 1 つだけ隣に広げることがある（駅ビル側）
  if (rng.chance(0.5)) {
    const cand = [];
    for (let id = 0; id < DISTRICT_COUNT; id++) {
      const x = id % GRID, y = Math.floor(id / GRID);
      if (kinds[id] === '住宅' && Math.max(Math.abs(x - (c0 + 0.5)), Math.abs(y - (c0 + 0.5))) === 1.5) cand.push(id);
    }
    if (cand.length) kinds[rng.pick(cand)] = '駅前';
  }
  return kinds;
}
function isCornerLike(x, y) {
  return (x === 0 || x === GRID - 1) && (y === 0 || y === GRID - 1);
}

/** 種別ごとの名前を重複なしで割り当てる。 */
function assignNames(kinds, rng) {
  const pools = {};
  for (const k of KINDS) pools[k] = shuffle(NAME_POOLS[k], rng);
  const used = new Set();
  const spare = shuffle([...NAME_POOLS['住宅'], ...NAME_POOLS['郊外'], ...NAME_POOLS['山手']], rng);
  const names = new Array(kinds.length);
  for (let id = 0; id < kinds.length; id++) {
    let n = null;
    const pool = pools[kinds[id]];
    while (pool.length && n === null) { const c = pool.shift(); if (!used.has(c)) n = c; }
    while (n === null && spare.length) { const c = spare.shift(); if (!used.has(c)) n = c; }
    if (n === null) n = `第${id + 1}地区`;
    used.add(n);
    names[id] = n;
  }
  return names;
}

/** value（万）から利回りを決める: 逆相関 + ノイズ、0.035〜0.13。 */
function yieldFor(value, rng) {
  const t = clamp((9000 - value) / 7500, 0, 1);
  const base = 0.035 + (0.13 - 0.035) * Math.pow(t, 1.15);
  return clamp(base + 0.008 * rng.normal(), 0.035, 0.13);
}

let secretSeq = 0;
function makeSecret(kindDef, districtId, year, rng) {
  const effect = kindDef.effect();
  if (kindDef.delay) effect.fireYear = year + rng.int(kindDef.delay[0], kindDef.delay[1]);
  const text = rng.pick(kindDef.texts);
  secretSeq += 1;
  return {
    id: `S${districtId}-${kindDef.code}-${Math.floor(rng.next() * 1e6).toString(36)}`,
    kind: kindDef.kind,
    code: kindDef.code,
    text,
    fired: false,
    effect,
  };
}

function rollSecrets(districtKind, districtId, year, rng) {
  const r = rng.next();
  const n = r < 0.40 ? 0 : r < 0.80 ? 1 : 2;
  const out = [];
  const usedCodes = new Set();
  for (let i = 0; i < n; i++) {
    const cands = SECRET_KINDS.filter(s => s.kinds.includes(districtKind) && !usedCodes.has(s.code) && !(s.kind === '大学移転' && [...usedCodes].some(c => c.startsWith('campus'))));
    if (!cands.length) break;
    const total = cands.reduce((s, c) => s + c.weight, 0);
    let u = rng.next() * total, pick = cands[cands.length - 1];
    for (const c of cands) { u -= c.weight; if (u <= 0) { pick = c; break; } }
    usedCodes.add(pick.code);
    out.push(makeSecret(pick, districtId, year, rng));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 街を生成する。
 * @param {import('./rng.js').Rng} rng
 * @param {{ year?: number }} [opts]
 * @returns {object} CityState { districts, listings, year, nextListingId }
 */
export function createCity(rng, opts = {}) {
  const year = num(opts.year, START_YEAR);
  const kinds = layoutKinds(rng);
  const names = assignNames(kinds, rng);
  const districts = [];
  for (let id = 0; id < DISTRICT_COUNT; id++) {
    const x = id % GRID, y = Math.floor(id / GRID);
    const kind = kinds[id];
    const prof = KIND_PROFILE[kind];
    const value = Math.round(clamp(prof.lo + (prof.hi - prof.lo) * rng.next() + 200 * rng.normal(), 1500, 9000));
    const yieldRate = yieldFor(value, rng);
    const trend = clamp(-0.03 + 0.07 * rng.next() + prof.trendBias, -0.03, 0.04);
    const secrets = rollSecrets(kind, id, year, rng);
    const estError = estimateError(0, 0);
    const estimate = value * Math.exp(estError * rng.normal());
    districts.push({
      id, x, y, name: names[id], kind, value, yieldRate, trend, secrets,
      knownSecrets: [], visits: 0, estimate, estError, owned: 0,
      lastGrowth: 0, lastShock: 0, lastShockYear: null,
    });
  }
  const city = { districts, listings: [], year, nextListingId: 1 };
  city.listings = generateListings(city, false, rng);
  return city;
}

function drawTheta(motivated, rng) {
  const P = CITY_PARAMS;
  const th = motivated ? P.thetaMotivatedMu + P.thetaMotivatedSd * rng.normal() : P.thetaNormalMu + P.thetaNormalSd * rng.normal();
  return clamp(th, 0.40, 1.05);
}

function generateListings(city, crash, rng) {
  const P = CITY_PARAMS;
  const share = crash ? P.motivatedShareCrash : P.motivatedShare;
  const out = [];
  for (const d of city.districts) {
    const r = rng.next();
    const n = r < 0.40 ? 0 : r < 0.77 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const m = Math.max(P.listingMinM, P.listingMean + P.listingSd * rng.normal());
      const motivated = rng.chance(share);
      out.push({
        id: `L${city.nextListingId++}`,
        districtId: d.id,
        ask: Math.round(d.value * (1 + m)),
        theta: drawTheta(motivated, rng),
        motivated,
        year: city.year,
      });
    }
  }
  return out;
}

/**
 * 1 年進める: 秘密の発火、相場推移、売出し再生成。city を mutate する。
 * @param {object} city
 * @param {{ marketReturn: number, crash: boolean, year?: number }} ctx
 * @param {import('./rng.js').Rng} rng
 * @returns {{ events: Array<{ kind: string, code: string, districtId: number, secretId: string, text: string, valuePct?: number }> }}
 */
export function stepCity(city, ctx, rng) {
  const P = CITY_PARAMS;
  const year = Number.isFinite(Number(ctx?.year)) ? Number(ctx.year) : city.year + 1;
  const mr = num(ctx?.marketReturn, P.marketBase);
  const crash = !!ctx?.crash;
  city.year = year;
  const events = [];
  for (const d of city.districts) {
    let jumpLog = 0;
    for (const s of d.secrets || []) {
      const e = s.effect || {};
      const def = SECRET_KINDS.find(k => k.code === s.code) || SECRET_KINDS.find(k => k.kind === s.kind);
      if (e.fireYear != null) {
        if (!s.fired && year >= e.fireYear) {
          s.fired = true;
          if (e.valueJumpPct) jumpLog += Math.log(1 + e.valueJumpPct);
          if (!d.knownSecrets.includes(s.id)) d.knownSecrets.push(s.id);
          events.push({ kind: s.kind, code: s.code, districtId: d.id, secretId: s.id, text: def ? def.event(d.name) : `${d.name}: ${s.kind}`, valuePct: e.valueJumpPct ?? 0 });
        }
        if (s.fired && e.yieldDeltaPerYear) d.yieldRate = clamp(d.yieldRate + e.yieldDeltaPerYear, 0.02, 0.15);
      } else if (e.shockProb) {
        if (rng.chance(e.shockProb)) {
          s.fired = true;
          jumpLog += Math.log(1 + (e.shockPct ?? 0));
          if (!d.knownSecrets.includes(s.id)) d.knownSecrets.push(s.id);
          events.push({ kind: s.kind, code: s.code, districtId: d.id, secretId: s.id, text: def ? def.event(d.name) : `${d.name}: ${s.kind}`, valuePct: e.shockPct ?? 0 });
        }
      }
    }
    // 隠しトレンドは緩やかに平均回帰（永遠に +4% は続かない）
    d.trend = clamp(d.trend * 0.98 + 0.003 * rng.normal(), -0.05, 0.06);
    const g = effectiveTrend(d) + P.marketBeta * (mr - P.marketBase) + P.valueSigma * rng.normal();
    const factor = Math.exp(g + jumpLog);
    d.value = Math.max(300, d.value * factor);
    d.estimate = Math.max(100, d.estimate * factor);
    d.lastGrowth = g;
    d.lastShock = jumpLog;
    d.lastShockYear = year;
  }
  city.listings = generateListings(city, crash, rng);
  return { events };
}

const SCOUT_TEXTS = Object.freeze([
  (n) => `${n}を自転車で一周した。相場の肌感覚が少し掴めた。`,
  (n) => `${n}の商店街で立ち話。目立った噂はなかった。`,
  (n) => `${n}の路地を歩き回った。看板と空室を数えて帰った。`,
  (n) => `${n}で不動産屋の張り紙を眺めた。特に新しい話はない。`,
]);

/**
 * 偵察する。visits++、推定を更新し、秘密を発見することがある。city を mutate する。
 * @param {object} city
 * @param {number} districtId
 * @param {{ localLevel?: number, bonus?: boolean }} ctx
 * @param {import('./rng.js').Rng} rng
 * @returns {{ revealed: object|null, estimate: number, estError: number, text: string }|null}
 */
export function scout(city, districtId, ctx, rng) {
  const d = city?.districts?.[Number(districtId)];
  if (!d) return null;
  const P = CITY_PARAMS;
  const L = clamp(num(ctx?.localLevel), 0, 10);
  d.visits += 1;
  d.estError = estimateError(d.visits, L);
  d.estimate = d.value * Math.exp(d.estError * rng.normal());
  let revealed = null;
  const unknown = (d.secrets || []).filter(s => !d.knownSecrets.includes(s.id));
  const pFind = P.secretBaseFind + P.secretLocalFind * L + (ctx?.bonus ? P.secretBonusFind : 0);
  if (unknown.length && rng.chance(pFind)) {
    revealed = rng.pick(unknown);
    d.knownSecrets.push(revealed.id);
  }
  const text = revealed ? `${d.name}で聞いた。${revealed.text}` : rng.pick(SCOUT_TEXTS)(d.name);
  return { revealed, estimate: d.estimate, estError: d.estError, text };
}

const ACCEPT_TEXTS = Object.freeze({
  full: ['売主は即決だった。「あんたなら安心して任せられる」', '「その値段なら文句はない」握手は一瞬だった'],
  normal: ['売主は少し渋い顔をしたが、最後は「まあいいだろう」と頷いた', '長い沈黙のあと「わかった、あんたに売る」'],
  motivated: ['売主は安堵の表情だった。急いで手放したい事情があったらしい', '「早く決めてくれて助かる」売主は書類を持って走ってきた'],
});

/**
 * 買い付けを評価する。通れば listing を消す。city を mutate する。
 * @param {object} city
 * @param {string} listingId
 * @param {{ bidRatio: number }} offer
 * @param {{ commLevel?: number, network?: number, energy?: number, crash?: boolean }} ctx
 * @param {import('./rng.js').Rng} rng
 * @returns {{ accepted: boolean, reaction: string, price: number, bidRatio: number, listingId: string, districtId: number|null }}
 */
export function evaluateOffer(city, listingId, offer, ctx, rng) {
  const P = CITY_PARAMS;
  const idx = city.listings.findIndex(l => l.id === listingId);
  const bidRatio = clamp(num(offer?.bidRatio, 1), 0.05, 2);
  if (idx < 0) return { accepted: false, reaction: 'その物件はもう売れてしまった', price: 0, bidRatio, listingId, districtId: null };
  const l = city.listings[idx];
  const thetaEff = l.theta
    - P.commTheta * clamp(num(ctx?.commLevel), 0, 10)
    - (num(ctx?.network) > 60 ? P.networkTheta : 0)
    - (num(ctx?.energy) > 50 ? P.energyTheta : 0)
    - (ctx?.crash ? P.crashTheta : 0);
  const p = sigmoid(P.offerSlope * (bidRatio - thetaEff));
  const accepted = rng.next() < p;
  const price = l.ask * bidRatio;
  let reaction;
  if (accepted) {
    const pool = bidRatio >= 1 ? ACCEPT_TEXTS.full : l.motivated ? ACCEPT_TEXTS.motivated : ACCEPT_TEXTS.normal;
    reaction = rng.pick(pool);
    city.listings.splice(idx, 1);
  } else if (bidRatio > thetaEff - 0.05) reaction = '惜しい。あと一歩だった';
  else if (bidRatio > thetaEff - 0.15) reaction = '検討はしてくれた';
  else reaction = '鼻で笑われた';
  return { accepted, reaction, price, bidRatio, listingId: l.id, districtId: l.districtId };
}

/**
 * 融資の LTV 上限（DESIGN §7）。
 * @param {{ commLevel?: number, network?: number, income?: number, price?: number }} ctx
 * @returns {number} 0〜0.95
 */
export function maxLtv(ctx) {
  let cap = 0.70 + 0.02 * clamp(num(ctx?.commLevel), 0, 10) + (num(ctx?.network) > 60 ? 0.10 : 0);
  const price = num(ctx?.price);
  if (price > 0) {
    const income = Math.max(0, num(ctx?.income));
    cap = Math.min(cap, (8 * income) / price);
  }
  return clamp(cap, 0, 0.95);
}

let propSeq = 0;
/**
 * 物件を作る（買い付け成立後）。district.owned++。
 * @returns {object} Property
 */
export function createProperty(city, listing, price, ltv, mortgageRate, year) {
  const d = city.districts[listing?.districtId] || null;
  const value = d ? d.value : num(price);
  const p = Math.max(0, num(price));
  const loan = p * clamp(num(ltv), 0, 0.95);
  propSeq += 1;
  const id = `P${num(year, city.year)}-${listing?.id ?? 'x'}-${propSeq.toString(36)}`;
  if (d) d.owned = (d.owned || 0) + 1;
  const rent = (d ? d.yieldRate : 0.06) * value;
  return {
    id,
    districtId: d ? d.id : -1,
    name: `${d ? d.name : '無名'}物件`,
    buyPrice: p,
    value,
    loan,
    rate: num(mortgageRate, 0.03),
    boughtYear: num(year, city.year),
    rent,
    lastCashflow: 0,
    isAsset: true,
    term: LOAN_TERM,
    termLeft: LOAN_TERM,
  };
}

/** 売却などで地区の所有数を戻す（統合側から任意で呼ぶ）。 */
export function releaseProperty(city, prop) {
  const d = city?.districts?.[prop?.districtId];
  if (d) d.owned = Math.max(0, (d.owned || 0) - 1);
}

/**
 * 物件の 1 年: 価値推移、家賃追随、ローン返済、キャッシュフロー。prop を mutate する。
 * @param {object} prop
 * @param {object} city
 * @param {{ marketReturn: number, mortgageRate: number, crash?: boolean }} ctx
 * @param {import('./rng.js').Rng} rng
 * @returns {{ cashflow: number, rent: number, interest: number, principal: number, isAsset: boolean }}
 */
export function stepProperty(prop, city, ctx, rng) {
  const P = CITY_PARAMS;
  const d = city?.districts?.[prop.districtId] || null;
  const trend = d ? effectiveTrend(d) : 0;
  const shock = d && d.lastShockYear === city.year ? num(d.lastShock) : 0;
  const mr = num(ctx?.marketReturn, P.marketBase);
  const g = trend + P.marketBeta * (mr - P.marketBase) + P.valueSigma * rng.normal() + shock;
  prop.value = Math.max(100, prop.value * Math.exp(g));
  prop.rent = Math.max(0, prop.rent * Math.exp(P.rentFollow * g));
  prop.rate = num(ctx?.mortgageRate, prop.rate);
  const rate = prop.rate;
  const n = Math.max(1, Math.round(num(prop.termLeft, LOAN_TERM)));
  const interest = prop.loan * rate;
  let principal;
  if (prop.loan <= 0) principal = 0;
  else if (Math.abs(rate) < 1e-9) principal = prop.loan / n;
  else {
    const pmt = prop.loan * rate / (1 - Math.pow(1 + rate, -n));
    principal = Math.min(prop.loan, pmt - interest);
  }
  prop.loan = Math.max(0, prop.loan - principal);
  if (prop.loan < 1e-6) prop.loan = 0;
  prop.termLeft = Math.max(0, n - 1);
  const cashflow = prop.rent * P.mgmtFactor - P.maintenance * prop.value - interest - principal;
  prop.lastCashflow = cashflow;
  prop.isAsset = cashflow >= 0;
  return { cashflow, rent: prop.rent, interest, principal, isAsset: prop.isAsset };
}

/**
 * 売却手取り = value·0.95 − loan（暴落年は value −20%）。
 * @returns {number}
 */
export function saleProceeds(prop, city, ctx) {
  const P = CITY_PARAMS;
  const v = num(prop?.value) * (ctx?.crash ? 1 - P.crashHaircut : 1);
  return v * (1 - P.saleCost) - num(prop?.loan);
}

/**
 * UI 用の地区要約。theta / trend / 未開示の秘密は含めない。
 * @returns {object|null}
 */
export function districtSummary(city, id) {
  const d = city?.districts?.[Number(id)];
  if (!d) return null;
  const estimate = Math.round(d.estimate);
  const rent = d.yieldRate * d.value;
  const known = (d.secrets || []).filter(s => d.knownSecrets.includes(s.id));
  return {
    id: d.id, x: d.x, y: d.y, name: d.name, kind: d.kind,
    estimate,
    estError: d.estError,
    estYield: estimate > 0 ? rent / estimate : 0,
    estRent: Math.round(rent),
    visits: d.visits,
    owned: d.owned || 0,
    knownSecrets: known.map(s => s.text),
    secretCount: known.length,
    hasUnknownSecrets: undefined, // 意図的に非公開
    listings: city.listings.filter(l => l.districtId === d.id).map(l => ({ id: l.id, ask: l.ask, year: l.year, askRatio: estimate > 0 ? l.ask / estimate : 1 })),
  };
}
