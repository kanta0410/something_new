import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { newGame, endYear, defaultDecisions, defaultMeta } from '../src/engine/game.js';
import { createCity, evaluateOffer, scout, maxLtv, createProperty, stepProperty, districtSummary, stepCity } from '../src/engine/city.js';
import { hazard, rollDeath, taxRate, netWorth, checkBankruptcy, computeIncome } from '../src/engine/life.js';
import { level, addXp, nextLevelXp, skillLevels } from '../src/engine/skills.js';
import { kelly, stats, formatMoney, unlockLevel, monteCarlo, returnsFromHistory } from '../src/engine/quant.js';
import { advise, buildSamplePrompt, stateDigest, ADVISORS } from '../src/engine/council.js';
import { BOOKS, availableBooks, readBook } from '../src/engine/books.js';
import { computeScore, epitaph, lifeSummary } from '../src/engine/score.js';
import { rollEvents, applyEvents } from '../src/engine/events.js';

const fresh = (seed = 1) => newGame(defaultMeta(), seed);

// ---------- city ----------
test('city: 36 districts, unique names, plausible ranges, summary hides secrets', () => {
  const city = createCity(createRng(3));
  assert.equal(city.districts.length, 36);
  assert.equal(new Set(city.districts.map(d => d.name)).size, 36);
  for (const d of city.districts) {
    assert.ok(d.value >= 1500 && d.value <= 9000, `value ${d.value}`);
    assert.ok(d.yieldRate >= 0.035 && d.yieldRate <= 0.13, `yield ${d.yieldRate}`);
    assert.ok(d.trend >= -0.03 && d.trend <= 0.04, `trend ${d.trend}`);
  }
  assert.ok(city.listings.length >= 10 && city.listings.length <= 72, `listings ${city.listings.length}`);
  const sum = districtSummary(city, 0);
  const json = JSON.stringify(sum);
  assert.ok(!('theta' in sum) && !json.includes('theta') && !('trend' in sum));
});

test('city: offer acceptance rates by bid ratio (mixture of motivated sellers)', () => {
  const rates = {};
  for (const bid of [1.0, 0.9, 0.7, 0.5]) {
    let acc = 0, n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed); const city = createCity(rng);
      for (const l of [...city.listings]) {
        const r = evaluateOffer(city, l.id, { bidRatio: bid }, { commLevel: 0, network: 0, energy: 0, crash: false }, rng);
        n++; if (r.accepted) acc++;
      }
    }
    rates[bid] = acc / n;
  }
  assert.ok(rates[1.0] > 0.85, `1.0 → ${rates[1.0]}`);
  assert.ok(rates[0.9] > 0.3 && rates[0.9] < 0.75, `0.9 → ${rates[0.9]}`);
  assert.ok(rates[0.7] > 0.04 && rates[0.7] < 0.25, `0.7 → ${rates[0.7]}`);
  assert.ok(rates[0.5] > 0.002 && rates[0.5] < 0.06, `0.5 → ${rates[0.5]}`);
});

test('city: scouting shrinks estimate error; property amortizes; ltv cap', () => {
  const rng = createRng(9); const city = createCity(rng);
  const d = city.districts[5];
  const e0 = d.estError;
  scout(city, 5, { localLevel: 0 }, rng); const e1 = d.estError;
  scout(city, 5, { localLevel: 0 }, rng); const e2 = d.estError;
  assert.ok(e1 < e0 && e2 < e1);
  const l = city.listings[0];
  const prop = createProperty(city, l, l.ask, 0.8, 0.03, 2026);
  assert.ok(prop.loan > 0 && prop.rent > 0);
  for (let y = 0; y < 25; y++) stepProperty(prop, city, { marketReturn: 0.05, mortgageRate: 0.03, crash: false }, rng);
  assert.ok(prop.loan < prop.buyPrice * 0.02, `loan after 25y ${prop.loan}`);
  const cap = maxLtv({ commLevel: 10, network: 100, income: 10000, price: 3000 });
  assert.ok(cap >= 0.9 && cap <= 1.0);
  const capLowIncome = maxLtv({ commLevel: 0, network: 0, income: 100, price: 5000 });
  assert.ok(capLowIncome <= 0.2, `low income cap ${capLowIncome}`);
});

// ---------- life / skills ----------
test('skills: level curve and energy multiplier', () => {
  assert.equal(level(0), 0); assert.equal(level(40), 1); assert.equal(level(160), 2); assert.equal(level(4000), 10); assert.equal(level(99999), 10);
  assert.ok(nextLevelXp(0) > 0);
  const s = fresh(1);
  s.meters.energy = 10; const a = addXp(s, 'guts', 10);
  s.meters.energy = 60; const b = addXp(s, 'guts', 10);
  assert.ok(b > a);
  assert.ok(skillLevels(s).guts >= 0);
});

test('life: hazard curve, tax monotone, survival to 85 in a plausible band', () => {
  const s = fresh(2);
  const h = (age) => { s.life.age = age; return hazard(s); };
  const h22 = h(22), h50 = h(50), h70 = h(70), h85 = h(85);
  assert.ok(h22 < h50 && h50 < h70 && h70 < h85);
  assert.ok(h85 > 0.03 && h85 < 0.12, `h85 ${h85}`);
  assert.ok(taxRate(300) <= taxRate(800) && taxRate(800) <= taxRate(2000));
  let alive85 = 0; const N = 3000;
  for (let i = 0; i < N; i++) {
    const rng = createRng(1000 + i); const st = fresh(1); let dead = false;
    for (let age = 22; age < 85; age++) { st.life.age = age; if (rollDeath(st, rng)) { dead = true; break; } }
    if (!dead) alive85++;
  }
  const p = alive85 / N;
  assert.ok(p > 0.35 && p < 0.7, `survival to 85 = ${p}`);
});

test('life: income fields finite; bankruptcy check', () => {
  const s = fresh(3);
  const inc = computeIncome(s, defaultDecisions(s));
  for (const k of ['salary', 'tax', 'net', 'hustle', 'living', 'savings', 'passive']) assert.ok(Number.isFinite(inc[k]), k);
  assert.ok(inc.net < inc.salary);
  assert.equal(checkBankruptcy(s), false);
  s.money.cash = -10000; s.money.stocks = 0;
  assert.equal(checkBankruptcy(s), true);
  assert.equal(netWorth(s), -10000);
});

// ---------- quant ----------
test('quant: kelly, stats, formatMoney, unlock levels, monte carlo shape and speed', () => {
  const rets = [...Array(20).fill(0.10), ...Array(5).fill(-0.10)];
  const k = kelly(rets, 0.01);
  const mu = rets.reduce((a, b) => a + b) / rets.length;
  assert.ok(Math.abs(k.mu - mu) < 1e-9);
  assert.ok(k.full > 0 && k.half <= k.full);
  const kp = kelly([0.3, 0.3], 0.01);
  assert.equal(kp.prior, true);
  const hist = [100, 200, 100, 150].map((nw, i) => ({ year: 2026 + i, age: 22 + i, netWorth: nw, marketReturn: 0.05 }));
  const st = stats(hist);
  assert.ok(Math.abs(st.maxDrawdown - 0.5) < 1e-9, `mdd ${st.maxDrawdown}`);
  assert.equal(formatMoney(2400), '2,400万');
  assert.equal(formatMoney(12000), '1.2億');
  assert.ok(formatMoney(-500).startsWith('−') || formatMoney(-500).startsWith('-'));
  const s = fresh(4);
  for (const [xp, lvl] of [[0, 0], [40, 1], [360, 2], [1000, 3], [1960, 4]]) { s.skills.quant.xp = xp; assert.equal(unlockLevel(s), lvl, `xp ${xp}`); }
  for (let i = 0; i < 3; i++) endYear(s, defaultDecisions(s));
  const t0 = Date.now();
  const mc = monteCarlo(s, defaultDecisions(s), { n: 400, years: 70, seed: 7 });
  const ms = Date.now() - t0;
  assert.ok(ms < 800, `mc ${ms}ms`);
  assert.equal(mc.p50.length, mc.years.length);
  for (let i = 0; i < mc.p50.length; i++) assert.ok(mc.p5[i] <= mc.p25[i] && mc.p25[i] <= mc.p50[i] && mc.p50[i] <= mc.p75[i] && mc.p75[i] <= mc.p95[i]);
  assert.ok(mc.ruinProb >= 0 && mc.ruinProb <= 1);
  const mc2 = monteCarlo(s, defaultDecisions(s), { n: 400, years: 70, seed: 7 });
  assert.deepEqual(mc.p50, mc2.p50);
  assert.equal(returnsFromHistory(s.history).length, s.history.length - 1);
});

// ---------- council ----------
test('council: three advisors, stances react to market, prompt carries digest', () => {
  const s = fresh(5);
  for (let i = 0; i < 2; i++) endYear(s, defaultDecisions(s));
  const adv = advise(s, { yearResult: s.market.last, quantLevel: 0 });
  assert.equal(adv.length, 3);
  assert.deepEqual(adv.map(a => a.id).sort(), ADVISORS.map(a => a.id).sort());
  for (const a of adv) assert.ok(a.text.length >= 30 && a.text.length <= 160, a.text);
  s.market.last = { ...s.market.last, x: 0.5, wc: 0.8 }; s.market.p = s.market.f + 0.5;
  const bear = advise(s, { yearResult: s.market.last, quantLevel: 0 }).find(a => a.id === 'buffett');
  assert.equal(bear.stance, 'bear');
  s.market.last = { ...s.market.last, x: -0.3, wc: 0.3, crash: true }; s.market.p = s.market.f - 0.3;
  const bull = advise(s, { yearResult: s.market.last, quantLevel: 0 }).find(a => a.id === 'buffett');
  assert.equal(bull.stance, 'bull');
  const prompt = buildSamplePrompt('soros', s, { yearResult: s.market.last, quantLevel: 2 });
  assert.ok(prompt.includes('120') && prompt.length > 300);
  assert.ok(Object.keys(stateDigest(s)).length <= 30);
});

// ---------- books / events / score ----------
test('books: catalogue, availability, xp doubling when executed, half on reread', () => {
  assert.ok(BOOKS.length >= 10);
  const s = fresh(6);
  const avail = availableBooks(s);
  assert.ok(avail.length >= 5);
  const id = avail[0].id;
  const before = JSON.stringify(s.skills);
  const r1 = readBook(s, id, false);
  assert.ok(r1 && r1.xpGained > 0 && typeof r1.title === 'string');
  const s2 = fresh(6); const r2 = readBook(s2, id, true);
  assert.ok(r2.xpGained > r1.xpGained);
  const r3 = readBook(s, id, false);
  assert.ok(r3.xpGained < r1.xpGained);
  assert.notEqual(before, JSON.stringify(s.skills));
});

test('events: alamo on crash adds energy; rejected offers become brag points', () => {
  const s = fresh(7);
  const rng = createRng(1);
  const yr = { ...(s.market.last || {}), crash: true, totalReturn: -0.3, x: -0.2, wc: 0.3 };
  const e0 = s.meters.energy;
  const evs = rollEvents(s, defaultDecisions(s), { yearResult: yr, cityEvents: [], income: { net: 300 }, rejectedOffers: [{ listing: s.city.listings[0], reaction: '鼻で笑われた', bidRatio: 0.5 }], lossRate: 0, lastCrash: false }, rng);
  assert.ok(evs.some(e => e.kind === 'alamo'));
  applyEvents(s, evs);
  assert.ok(s.meters.energy > e0);
  assert.ok(s.brag.points >= 1 && s.brag.failures.length >= 1);
  assert.ok(s.log.length > 1);
});

test('score: components saturate below 1000, monotone in wealth, epitaph per cause', () => {
  const s = fresh(8);
  const sc0 = computeScore(s);
  s.money.cash = 1e6; const sc1 = computeScore(s);
  assert.ok(sc1.wealth > sc0.wealth && sc1.wealth <= 1000);
  s.brag.points = 10000; assert.ok(computeScore(s).brag <= 1000);
  for (const c of ['natural', 'illness', 'bankrupt', 'voluntary']) { s.life.deathCause = c; assert.ok(epitaph(s, computeScore(s)).length >= 6); }
  const sum = lifeSummary(s, computeScore(s));
  for (const k of ['age', 'netWorth', 'peakNetWorth', 'offersMade', 'offersAccepted', 'alamoCount', 'failures']) assert.ok(k in sum, k);
});
