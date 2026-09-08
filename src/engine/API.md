# Engine API 契約（全モジュール共通・厳守）

すべて ESM、副作用なし（渡された state を mutate するのは明記された関数のみ）。乱数は必ず引数の `rng`（`rng.js`）を使う。`Math.random` 禁止。
金額は万円。skill level は `skills.js` の `level(xp)`。`state` は DESIGN.md §2 の GameState。

## rng.js（実装済み）
`createRng(seed)` → `{ next(), normal(), int(lo,hi), pick(arr), chance(p), state(), setState(s), fork() }`、`rngFromState(s)`、`hashSeed(str)`

## market.js
```js
export const DEFAULT_PARAMS;                       // DESIGN §6 の定数
export function createMarket(rng, params?) → MarketState
  // { p, f, pPrev, uf, uc, wc, rate, index, year, params, last: YearResult|null, series: {index:number[], fundamental:number[], wc:number[], x:number[]} (年次履歴; 直近 60 年まで) }
export function stepMonth(market, rng) → { logRet, dividend }   // mutates
export function stepYear(market, rng) → YearResult              // 12 回 stepMonth、mutates、market.last と series を更新
  // YearResult = { totalReturn, priceReturn, dividendYield, x, wc, monthly:number[12] (月末 index), vol, crash:boolean, bubble:boolean, rate, mortgageRate, depositRate }
export function regimeLabel(market) → '平穏'|'過熱'|'バブル'|'調整'|'暴落'|'底値'
export function cloneMarket(market) → MarketState  // deep copy（モンテカルロ用）
```

## city.js
```js
export function createCity(rng, opts?) → CityState
  // { districts: District[36], listings: Listing[], year:number, nextListingId }
  // District = { id (0..35), x, y, name, kind, value, yieldRate, trend, secrets: Secret[], knownSecrets: string[], visits, estimate, estError, owned:number }
  // Secret = { id, kind, text, fired:boolean, effect: { trendDelta?, valueJumpPct?, yieldDeltaPerYear?, shockProb?, shockPct?, fireYear? } }
  // Listing = { id, districtId, ask, theta (隠し), motivated:boolean, year }
export function stepCity(city, ctx, rng) → { events: {kind, districtId, text, valuePct?}[] }   // ctx = { marketReturn, crash, year }  mutates。秘密発火、価値推移、売出し再生成（前年の listing は消える）
export function scout(city, districtId, ctx, rng) → { revealed: Secret|null, estimate, estError, text }   // ctx = { localLevel }  mutates (visits++, estimate 更新)
export function evaluateOffer(city, listingId, offer, ctx, rng) → { accepted, reaction, price, bidRatio }   // offer={bidRatio}, ctx={commLevel, network, energy, crash}
export function maxLtv(ctx) → number                          // ctx = { commLevel, network, income, price }
export function createProperty(city, listing, price, ltv, mortgageRate, year) → Property
  // Property = { id, districtId, name, buyPrice, value, loan, rate, boughtYear, rent, lastCashflow, isAsset }
export function stepProperty(prop, city, ctx, rng) → { cashflow, rent, interest, principal, isAsset }   // ctx={ marketReturn, mortgageRate, crash } mutates prop
export function saleProceeds(prop, city, ctx) → number         // ctx = { crash }
export function districtSummary(city, id) → 人が読める要約オブジェクト { name, kind, estimate, estError, estYield, knownSecrets:[text], listings:[...] }
```

## life.js
```js
export function computeIncome(state, decisions) → { salary, tax, net, hustle, rent, interest, living, savings, passive, cashDelta }
export function advanceCareer(state, decisions, rng) → { events: string[] }   // 給与成長、定年、リストラ判定、mutates state.work
export function hazard(state) → number
export function rollDeath(state, rng) → null | 'natural' | 'illness'
export function checkBankruptcy(state) → boolean               // 強制売却後も純資産<0
export function netWorth(state) → number
export function liquid(state) → number  // cash + stocks
```

## skills.js
```js
export const SKILLS = [{ id:'reading', name:'読書', ... }, {id:'comm', name:'コミュ力'}, {id:'local', name:'地域知'}, {id:'quant', name:'クオンツ'}, {id:'guts', name:'胆力'}]
export function level(xp) → 0..10
export function nextLevelXp(xp) → number
export function addXp(state, skillId, amount) → number  // energy ≥ 50 で ×1.5、mutates state.skills[skillId].xp、返り値は実付与
export function applyTimeXp(state, decisions) → { reading, comm, local }
export function skillLevels(state) → { reading, comm, local, quant, guts }  // レベル
```

## events.js
```js
export function rollEvents(state, decisions, ctx, rng) → GameEvent[]   // ctx = { yearResult, cityEvents, income }
  // GameEvent = { id, kind: 'alamo'|'mentor'|'illness'|'joboffer'|'layoff'|'gift'|'giftReturn'|'book'|'secret'|'flood'|'station'|'misc', title, text, severity:'info'|'good'|'bad'|'epic', apply: (state)=>void (副作用をここに閉じ込める), meterDelta?: {...} }
export function applyEvents(state, events) → void
```

## books.js
```js
export const BOOKS = [{ id, title, author, tags:[skillId], xp:{skillId:number}, quote, desc, cost:10 }]  // 8 冊以上
export function availableBooks(state) → Book[]
export function readBook(state, bookId, executed:boolean) → { xpGained, quote }
```

## score.js
```js
export function computeScore(state) → { wealth, fun, learning, network, brag, total }
export function epitaph(state, score) → string      // 遺言（12〜30 字）
export function lifeSummary(state, score) → { age, years, netWorth, peakNetWorth, offersMade, offersAccepted, alamoCount, failures: string[], ... }
```

## council.js
```js
export const ADVISORS = [{ id:'buffett', name:'バフェット', initial:'B', color }, { id:'soros', name:'ソロス', initial:'S' }, { id:'himmel', name:'ヒンメル', initial:'H' }]
export function advise(state, ctx) → Advice[3]         // ctx = { yearResult|null, quantLevel }  Advice = { id, name, text, stance:'bull'|'bear'|'neutral'|'life', focus }
export function buildSamplePrompt(advisorId, state, ctx) → string   // Claude sample 用（ペルソナ + 状態 JSON + 出力制約 120 字）
export function stateDigest(state) → object            // 状態の要約（sample プロンプト用、小さく）
```

## quant.js
```js
export function kelly(returns:number[], rate:number) → { mu, sigma, full, half, n, prior:boolean }
export function stats(history:YearRecord[]) → { cagr, vol, sharpe, maxDrawdown, worstYear, bestYear, years }
export function monteCarlo(state, decisions, opts?) → { years:number[], p5:[], p25:[], p50:[], p75:[], p95:[], ruinProb, n }   // 純資産の分位（万円）
export function unlockLevel(state) → 0..4               // quant スキルの level を 0..4 に写像: L0→0, L1-2→1, L3-4→2, L5-6→3, L7+→4
```

## game.js（統合。オーナー: リード）
```js
export function loadMeta() / saveMeta(meta) / defaultMeta()
export function newGame(meta, seed?) → GameState
export function defaultDecisions(state) → Decisions
export function endYear(state, decisions) → TurnReport   // mutates。{ yearResult, income, events, offers:[{listing, accepted, reaction}], cityEvents, death:null|cause, bankrupt:boolean, advice:Advice[3] }
export function reincarnate(state, meta, choice:{skillForBrag}) → { meta, state:GameState(新) }
export function serialize(state) → string / deserialize(str) → GameState
export function saveRun(state) / loadRun() / clearRun()
```

## YearRecord（state.history の要素）
`{ year, age, netWorth, cash, stocks, reEquity, debt, income, marketReturn, index, fun, energy, network, learning, score }`

## LogEntry
`{ year, kind:'info'|'good'|'bad'|'epic'|'money'|'council', text }`
