// 統合モジュール: 1 年を進める、死ぬ、転生する、保存する。
import { createRng, rngFromState, hashSeed } from './rng.js';
import { createMarket, stepYear, regimeLabel } from './market.js';
import { createCity, stepCity, scout, evaluateOffer, maxLtv, createProperty, stepProperty, saleProceeds } from './city.js';
import { computeIncome, advanceCareer, rollDeath, netWorth, liquid } from './life.js';
import { SKILLS, level, addXp, applyTimeXp, skillLevels } from './skills.js';
import { rollEvents, applyEvents } from './events.js';
import { readBook } from './books.js';
import { computeScore, epitaph, lifeSummary } from './score.js';
import { advise } from './council.js';
import { unlockLevel } from './quant.js';

export const META_KEY = 'isekai-quant:meta';
export const RUN_KEY = 'isekai-quant:run';
export const START_AGE = 22;
export const START_YEAR = 2026;
export const MAX_AGE = 100;
export const CLOSING_COST = 0.07;
export const MAX_OFFERS = 3;
export const MAX_BOOKS = 2;
export const MAX_SCOUT_TARGETS = 3;
export const PENSION_AGE = 65;

const SKILL_IDS = ['reading', 'comm', 'local', 'quant', 'guts'];

/** @returns {object} 初期メタ */
export function defaultMeta() {
  return {
    version: 1,
    lives: 0,
    skills: { reading: 0, comm: 0, local: 0, quant: 0, guts: 0 },
    bragPoints: 0,
    hallOfFame: [],
    bestScore: 0,
    tutorialDone: false,
  };
}

function storage() {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch (_) { /* blocked */ }
  return null;
}

export function loadMeta() {
  const s = storage();
  if (!s) return defaultMeta();
  try {
    const raw = s.getItem(META_KEY);
    if (!raw) return defaultMeta();
    const m = JSON.parse(raw);
    return { ...defaultMeta(), ...m, skills: { ...defaultMeta().skills, ...(m.skills || {}) } };
  } catch (_) { return defaultMeta(); }
}

export function saveMeta(meta) {
  const s = storage();
  if (!s) return;
  try { s.setItem(META_KEY, JSON.stringify(meta)); } catch (_) { /* quota */ }
}

/** 新しい人生を始める。seed 省略時は時刻とライフ数から作る。 */
export function newGame(meta, seed) {
  const m = meta || defaultMeta();
  const finalSeed = (seed ?? hashSeed(`${Date.now()}:${m.lives}:${Math.floor(Math.random() * 1e9)}`)) >>> 0;
  const rng = createRng(finalSeed);
  const market = createMarket(rng);
  const city = createCity(rng);
  const skills = {};
  for (const id of SKILL_IDS) skills[id] = { xp: Math.max(0, Math.floor(m.skills?.[id] ?? 0)) };
  const state = {
    version: 1,
    seed: finalSeed,
    rngState: rng.state(),
    life: { n: m.lives + 1, age: START_AGE, year: START_YEAR, alive: true, deathCause: null, epitaph: null },
    money: { cash: 300, stocks: 0, debt: 0 },
    props: [],
    meters: { fun: 40, energy: 20, network: 20, learning: 0, funTotal: 0, networkTotal: 0 },
    skills,
    brag: { failures: [], points: 0 },
    work: { salary: 400, employed: true, hustleIncome: 0, passiveIncome: 0 },
    market,
    city,
    policy: null,
    history: [],
    log: [],
    flags: {
      tutorialSeen: !!m.tutorialDone, alamoCount: 0, offersMade: 0, offersAccepted: 0, fired: false,
      lastCrash: false, scoutBonus: false, giftPending: null, unlockedBooks: [], booksRead: [],
      peakNetWorth: 300, worstYearReturn: 0, yearsFired: 0, illnessCount: 0,
    },
  };
  state.policy = defaultDecisions(state);
  pushLog(state, 'info', `第${state.life.n}生、開始。22歳、現金300万。人生はゲームだ。`);
  const hist = record(state, null, 0);
  state.history.push(hist);
  return state;
}

/** 采配の初期値 */
export function defaultDecisions(state) {
  const prev = state?.policy;
  return {
    time: { ...(prev?.time || { reading: 20, scouting: 20, networking: 20, fun: 20, hustle: 20 }) },
    savingsRate: prev?.savingsRate ?? 0.5,
    stockAlloc: prev?.stockAlloc ?? 0.6,
    scoutTargets: [...(prev?.scoutTargets || [])],
    offers: [],
    sells: [],
    books: [],
    quitJob: false,
  };
}

function normalizeDecisions(d) {
  const out = defaultDecisions({ policy: d });
  const t = { ...out.time };
  const keys = ['reading', 'scouting', 'networking', 'fun', 'hustle'];
  let sum = 0;
  for (const k of keys) { t[k] = Math.max(0, Number(t[k]) || 0); sum += t[k]; }
  if (sum <= 0) { for (const k of keys) t[k] = 20; sum = 100; }
  for (const k of keys) t[k] = (t[k] / sum) * 100;
  out.time = t;
  out.savingsRate = clamp(Number(d?.savingsRate ?? 0.5), 0, 0.8);
  out.stockAlloc = clamp(Number(d?.stockAlloc ?? 0.6), 0, 1);
  out.scoutTargets = (d?.scoutTargets || []).slice(0, MAX_SCOUT_TARGETS);
  out.offers = (d?.offers || []).slice(0, MAX_OFFERS);
  out.sells = [...(d?.sells || [])];
  out.books = (d?.books || []).slice(0, MAX_BOOKS);
  out.quitJob = !!d?.quitJob;
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function pushLog(state, kind, text) {
  state.log.push({ year: state.life.year, kind, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

function record(state, yr, income) {
  const nw = netWorth(state);
  const debt = state.props.reduce((s, p) => s + p.loan, 0);
  const reEquity = state.props.reduce((s, p) => s + p.value - p.loan, 0);
  const score = computeScore(state);
  return {
    year: state.life.year, age: state.life.age, netWorth: nw,
    cash: state.money.cash, stocks: state.money.stocks, reEquity, debt,
    income, marketReturn: yr ? yr.totalReturn : 0, index: state.market.index,
    fun: state.meters.fun, energy: state.meters.energy, network: state.meters.network,
    learning: state.meters.learning, score: score.total,
  };
}

/**
 * 1 年進める。state を mutate する。
 * @returns {object} TurnReport
 */
export function endYear(state, rawDecisions) {
  if (!state.life.alive) throw new Error('already dead');
  const d = normalizeDecisions(rawDecisions);
  const rng = rngFromState(state.rngState);
  const lv = skillLevels(state);
  const report = { yearResult: null, income: null, events: [], offers: [], cityEvents: [], death: null, bankrupt: false, advice: [], careerEvents: [], scoutFinds: [], books: [], sells: [] };
  const nwStart = netWorth(state);
  const lastCrash = !!state.flags.lastCrash;

  // 1. キャリア（定年時は退職金 = 最終給与 × 2）
  const salaryBefore = state.work.salary || 0;
  const career = advanceCareer(state, d, rng);
  for (const t of career.events || []) { pushLog(state, 'money', t); report.careerEvents.push(t); }
  if ((career.kinds || []).includes('retire') && salaryBefore > 0) {
    const severance = salaryBefore * 2;
    state.money.cash += severance;
    pushLog(state, 'money', `退職金 ${fmt(severance)}が振り込まれた。さて、この金をどうする？`);
    report.severance = severance;
  }

  // 2. 収入と生活費、先取り投資
  const inc = computeIncome(state, d);
  state.flags.peakSalary = Math.max(state.flags.peakSalary || 0, state.work.salary || 0);
  // 年金: 65 歳から。基礎 100万 + 厚生分（最高給与の 8%、上限 100万）
  inc.pension = state.life.age >= PENSION_AGE ? 100 + Math.min(100, 0.08 * (state.flags.peakSalary || 0)) : 0;
  if (inc.pension > 0 && state.life.age === PENSION_AGE) pushLog(state, 'money', `年金受給開始。年 ${fmt(inc.pension)}。`);
  report.income = inc;
  const surplus = inc.net + inc.hustle + inc.pension - inc.living;
  let invest = surplus, spend = 0;
  if (surplus > 0) { invest = surplus * d.savingsRate; spend = surplus - invest; }
  state.money.cash += invest; // 生活費・遊興費は差し引き済み
  const spendFun = Math.min(20, spend / 10);

  // 3. 偵察
  const visits = Math.round(d.time.scouting / 10);
  if (d.scoutTargets.length > 0) {
    for (let i = 0; i < visits; i++) {
      const id = d.scoutTargets[i % d.scoutTargets.length];
      const r = scout(state.city, id, { localLevel: lv.local, bonus: !!state.flags.scoutBonus }, rng);
      if (r && r.revealed) {
        addXp(state, 'local', 25);
        pushLog(state, 'good', r.text || `${state.city.districts[id]?.name}: ${r.revealed.text}`);
        report.scoutFinds.push({ districtId: id, secret: r.revealed });
      }
    }
  }
  state.flags.scoutBonus = false;

  // 4. 買い付け
  const rejected = [];
  let bold = 0;
  const grossIncome = inc.net + inc.hustle + (inc.rent || 0);
  const mortgageRate = state.market.last?.mortgageRate ?? (state.market.rate + 0.012);
  for (const o of d.offers) {
    const listing = state.city.listings.find(l => l.id === o.listingId);
    if (!listing) continue;
    const bidRatio = clamp(Number(o.bidRatio) || 1, 0.3, 1.2);
    const price = listing.ask * bidRatio;
    const cap = maxLtv({ commLevel: lv.comm, network: state.meters.network, income: grossIncome, price });
    const ltv = clamp(Math.min(Number(o.ltv) || 0, cap), 0, 0.95);
    const cashNeeded = price * (1 - ltv) + price * CLOSING_COST;
    const dname = state.city.districts[listing.districtId]?.name || '';
    state.flags.offersMade++;
    addXp(state, 'comm', 10);
    if (state.money.cash < cashNeeded) {
      pushLog(state, 'bad', `${dname}への買い付け: 自己資金不足（必要 ${fmt(cashNeeded)}、手元 ${fmt(state.money.cash)}）。`);
      report.offers.push({ listing, accepted: false, reaction: '資金不足で提出できなかった', price, districtName: dname, skipped: true });
      continue;
    }
    if (bidRatio <= 0.7) { addXp(state, 'guts', 25); bold++; }
    const res = evaluateOffer(state.city, listing.id, { bidRatio }, { commLevel: lv.comm, network: state.meters.network, energy: state.meters.energy, crash: lastCrash }, rng);
    if (res.accepted) {
      const prop = createProperty(state.city, listing, price, ltv, mortgageRate, state.life.year);
      state.money.cash -= cashNeeded;
      state.props.push(prop);
      state.flags.offersAccepted++;
      pushLog(state, 'epic', `${dname}の物件を${fmt(price)}（売出しの${Math.round(bidRatio * 100)}%）で取得。${res.reaction}`);
      addXp(state, 'local', 15);
    } else {
      rejected.push({ listing, reaction: res.reaction, bidRatio });
      state.meters.learning += 2;
      pushLog(state, 'bad', `${dname}への買い付け（${Math.round(bidRatio * 100)}%）は却下。${res.reaction}`);
    }
    report.offers.push({ listing, accepted: res.accepted, reaction: res.reaction, price, districtName: dname, bidRatio });
  }

  // 5. 売却
  for (const pid of d.sells) {
    const idx = state.props.findIndex(p => p.id === pid);
    if (idx < 0) continue;
    const prop = state.props[idx];
    const proceeds = saleProceeds(prop, state.city, { crash: lastCrash });
    state.money.cash += proceeds;
    state.props.splice(idx, 1);
    pushLog(state, 'money', `${prop.name}を売却。手取り ${fmt(proceeds)}。`);
    report.sells.push({ prop, proceeds });
  }

  // 6. 株式リバランス（暴落翌年の買い増しは胆力）
  const liq = liquid(state);
  const prevStocks = state.money.stocks;
  if (liq > 0) {
    const target = liq * d.stockAlloc;
    const bought = target - prevStocks;
    state.money.stocks = target;
    state.money.cash = liq - target;
    if (lastCrash && bought > 0 && bought > liq * 0.05) { addXp(state, 'guts', 40); bold++; pushLog(state, 'good', `暴落の翌年に株を買い増した（${fmt(bought)}）。胆力が育つ。`); }
  }

  // 7. 市場
  const yr = stepYear(state.market, rng);
  report.yearResult = yr;
  state.money.stocks *= (1 + yr.totalReturn);
  if (state.money.cash > 0) state.money.cash *= (1 + yr.depositRate);
  if (state.money.stocks > 0) addXp(state, 'quant', 8);

  // 8. 街と物件
  const cityRes = stepCity(state.city, { marketReturn: yr.totalReturn, crash: yr.crash, year: state.life.year + 1 }, rng);
  report.cityEvents = cityRes.events || [];
  let rentTotal = 0, cfTotal = 0;
  for (const p of state.props) {
    const r = stepProperty(p, state.city, { marketReturn: yr.totalReturn, mortgageRate: yr.mortgageRate, crash: yr.crash }, rng);
    state.money.cash += r.cashflow;
    rentTotal += r.rent; cfTotal += r.cashflow;
  }
  state.money.debt = state.props.reduce((s, p) => s + p.loan, 0);
  state.work.passiveIncome = cfTotal;
  state.work.hustleIncome = inc.hustle;

  // 9. 時間 XP・学び・メーター
  applyTimeXp(state, d);
  const nwMid = netWorth(state);
  const lossRate = nwStart > 0 ? Math.max(0, (nwStart - nwMid) / nwStart) : 0;
  if (lossRate > 0.10) { addXp(state, 'quant', 30); }
  state.flags.worstYearReturn = Math.min(state.flags.worstYearReturn, nwStart > 0 ? (nwMid - nwStart) / nwStart : 0);
  const m = state.meters;
  m.fun = clamp(m.fun * 0.85 + d.time.fun * 0.6 + bold * 5 + spendFun, 0, 100);
  m.energy = clamp(m.energy * 0.7, 0, 100);
  m.network = clamp(m.network * 0.92 + d.time.networking * 0.5, 0, 100);
  m.learning += d.time.reading * 0.3 + lossRate * 30 + rejected.length * 2;

  // 10. イベント
  const events = rollEvents(state, d, { yearResult: yr, cityEvents: report.cityEvents, income: inc, rejectedOffers: rejected, lossRate, lastCrash }, rng) || [];
  applyEvents(state, events);
  report.events = events.map(e => ({ id: e.id, kind: e.kind, title: e.title, text: e.text, severity: e.severity }));
  if (yr.crash) state.flags.alamoCount = state.flags.alamoCount; // events.js が加算

  // 11. 本
  const executed = d.offers.length > 0 || (invest > 0 && d.stockAlloc > 0);
  let readingBudget = d.time.reading;
  for (const bid of d.books) {
    if (readingBudget < 10) break;
    const r = readBook(state, bid, executed);
    if (r) { readingBudget -= 10; report.books.push({ id: bid, ...r }); pushLog(state, 'info', `本を読んだ: ${r.title || bid}。${executed ? '実行を伴い効果2倍。' : ''}${r.quote ? '「' + r.quote + '」' : ''}`); }
  }

  // 12. 破産チェック（自動清算）。現金がマイナスなら株→物件の順に取り崩し、
  //     それでも足りなければカードローン（年 15%）。借入が生活費 2 年分を超えたら破産。
  if (state.money.cash < 0) {
    if (state.money.stocks > 0) {
      const sell = Math.min(state.money.stocks, -state.money.cash);
      state.money.stocks -= sell; state.money.cash += sell;
      if (sell > 0) pushLog(state, 'bad', `現金不足。株を${fmt(sell)}取り崩した。`);
    }
    while (state.money.cash < 0 && state.props.length > 0) {
      const p = state.props.shift();
      const proceeds = p.value * 0.8 - p.loan;
      state.money.cash += proceeds;
      pushLog(state, 'bad', `現金不足で${p.name}を強制売却（−20%）。手取り ${fmt(proceeds)}。`);
      state.brag.failures.push(`${state.life.year}年 ${p.name}を投げ売りした`);
      state.brag.points += 1;
    }
    state.money.debt = state.props.reduce((s, p) => s + p.loan, 0);
    if (state.money.cash < 0) {
      state.money.cash *= 1.15;
      const limit = -2 * (inc.living || 240);
      if (state.money.cash < limit) report.bankrupt = true;
      else pushLog(state, 'bad', `カードローンで凌いだ。借入 ${fmt(-state.money.cash)}（年 15%）。限度は ${fmt(-limit)}。`);
    }
  }

  // 13. 加齢・死
  state.life.age += 1;
  state.life.year += 1;
  m.funTotal += m.fun;
  m.networkTotal += m.network;
  if (state.flags.fired) state.flags.yearsFired++;
  state.flags.lastCrash = !!yr.crash;
  state.flags.peakNetWorth = Math.max(state.flags.peakNetWorth || 0, netWorth(state));

  let death = null;
  if (report.bankrupt) death = 'bankrupt';
  else {
    death = rollDeath(state, rng);
    if (!death && state.life.age >= MAX_AGE) death = 'natural';
  }

  const hist = record(state, yr, inc.net + inc.hustle + inc.pension);
  state.history.push(hist);
  state.policy = { ...d, offers: [], sells: [], books: [], quitJob: false };
  state.rngState = rng.state();

  if (death) {
    endLife(state, death);
    report.death = death;
  }
  report.advice = safeAdvise(state, yr);
  return report;
}

function safeAdvise(state, yr) {
  try { return advise(state, { yearResult: yr, quantLevel: unlockLevel(state) }); }
  catch (e) { return []; }
}

/** 死ぬ（自主転生を含む） */
export function endLife(state, cause) {
  if (!state.life.alive) return;
  state.life.alive = false;
  state.life.deathCause = cause;
  if (cause === 'voluntary') {
    addXp(state, 'guts', 100);
    pushLog(state, 'epic', '恐怖を捨て、自ら転生を選んだ。胆力 +100。');
  } else if (cause === 'bankrupt') {
    state.brag.failures.push(`${state.life.year}年 破産した`);
    state.brag.points += 5;
    pushLog(state, 'epic', '破産。それは授業料だ。転生して倍返しだ。');
  } else if (cause === 'illness') {
    pushLog(state, 'epic', `${state.life.age}歳、病に倒れた。`);
  } else {
    pushLog(state, 'epic', `${state.life.age}歳、天寿を全うした。`);
  }
  const score = computeScore(state);
  state.life.epitaph = epitaph(state, score);
}

/** 転生: メタに XP と殿堂を書き込み、新しい人生を返す */
export function reincarnate(state, meta, choice = {}) {
  const m = { ...defaultMeta(), ...(meta || {}) };
  m.skills = { ...defaultMeta().skills, ...(m.skills || {}) };
  if (state.life.alive) endLife(state, 'voluntary');
  const score = computeScore(state);
  const summary = lifeSummary(state, score);
  for (const id of SKILL_IDS) m.skills[id] = Math.max(m.skills[id], Math.floor(state.skills[id]?.xp ?? 0));
  const bragSkill = SKILL_IDS.includes(choice.skillForBrag) ? choice.skillForBrag : 'guts';
  const bonus = (state.brag.points || 0) * 30;
  m.skills[bragSkill] += bonus;
  m.bragPoints += state.brag.points || 0;
  m.lives = Math.max(m.lives + 1, state.life.n);
  m.hallOfFame.push({
    life: state.life.n, age: state.life.age, score: score.total, netWorth: netWorth(state),
    epitaph: state.life.epitaph, cause: state.life.deathCause, seed: state.seed, year: state.life.year,
    breakdown: { wealth: score.wealth, fun: score.fun, learning: score.learning, network: score.network, brag: score.brag },
  });
  m.hallOfFame.sort((a, b) => b.score - a.score);
  m.hallOfFame = m.hallOfFame.slice(0, 10);
  m.bestScore = Math.max(m.bestScore, score.total);
  m.tutorialDone = true;
  saveMeta(m);
  clearRun();
  const next = newGame(m);
  return { meta: m, state: next, score, summary, bragBonus: bonus, bragSkill };
}

export function serialize(state) { return JSON.stringify(state); }
export function deserialize(str) {
  const s = JSON.parse(str);
  if (!s || s.version !== 1 || !s.life || !s.market || !s.city) throw new Error('bad save');
  return s;
}
export function saveRun(state) { const s = storage(); if (!s) return; try { s.setItem(RUN_KEY, serialize(state)); } catch (_) { /* quota */ } }
export function loadRun() { const s = storage(); if (!s) return null; try { const raw = s.getItem(RUN_KEY); return raw ? deserialize(raw) : null; } catch (_) { return null; } }
export function clearRun() { const s = storage(); if (!s) return; try { s.removeItem(RUN_KEY); } catch (_) { /* ignore */ } }

/** 現在の状況の要約（UI ヘッダ用） */
export function status(state) {
  const nw = netWorth(state);
  const score = computeScore(state);
  return {
    netWorth: nw, score: score.total, regime: regimeLabel(state.market), age: state.life.age, year: state.life.year,
    life: state.life.n, quantLevel: unlockLevel(state), levels: skillLevels(state),
    passive: state.work.passiveIncome, living: 240 * (state.life.age >= 40 ? 1.2 : 1),
  };
}

function fmt(v) {
  const neg = v < 0; const a = Math.abs(v);
  let s;
  if (a >= 10000) s = (a / 10000).toFixed(a >= 100000 ? 0 : 1).replace(/\.0$/, '') + '億';
  else s = Math.round(a).toLocaleString('ja-JP') + '万';
  return (neg ? '−' : '') + s;
}
export { fmt as formatMoney, SKILLS, level, SKILL_IDS };
