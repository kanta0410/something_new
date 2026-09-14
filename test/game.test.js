import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, endYear, defaultDecisions, defaultMeta, reincarnate, serialize, deserialize, endLife } from '../src/engine/game.js';
import { netWorth } from '../src/engine/life.js';
import { createRng } from '../src/engine/rng.js';

function playLife(seed, policy) {
  const state = newGame(defaultMeta(), seed);
  const rng = createRng(seed);
  let turns = 0;
  while (state.life.alive && turns < 120) {
    const d = defaultDecisions(state);
    if (policy) policy(state, d, rng);
    const r = endYear(state, d);
    assert.ok(r.yearResult, 'yearResult');
    assert.equal(r.advice.length, 3, 'advice');
    assert.ok(Number.isFinite(netWorth(state)), 'finite net worth');
    assert.ok(Number.isFinite(state.money.cash) && Number.isFinite(state.money.stocks));
    turns++;
  }
  return state;
}

test('a full life runs to death without NaN and with sane history', () => {
  const s = playLife(42);
  assert.equal(s.life.alive, false);
  assert.ok(['natural', 'illness', 'bankrupt'].includes(s.life.deathCause));
  assert.ok(s.history.length >= 2);
  assert.ok(s.life.epitaph && s.life.epitaph.length >= 4);
  for (const h of s.history) for (const k of ['netWorth', 'cash', 'stocks', 'reEquity', 'debt', 'score']) assert.ok(Number.isFinite(h[k]), k);
});

test('determinism: same seed and decisions give identical histories', () => {
  const a = playLife(7), b = playLife(7);
  assert.deepEqual(a.history.map(h => h.netWorth), b.history.map(h => h.netWorth));
});

test('aggressive real-estate policy: offers get made and sometimes accepted', () => {
  let accepted = 0, made = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const s = playLife(seed, (st, d, rng) => {
      d.time = { reading: 10, scouting: 40, networking: 30, fun: 10, hustle: 10 };
      d.savingsRate = 0.7; d.stockAlloc = 0.5;
      d.scoutTargets = [0, 7, 14];
      const ls = st.city.listings.filter(l => l.ask * 0.9 * 0.27 <= st.money.cash);
      d.offers = ls.slice(0, 3).map(l => ({ listingId: l.id, bidRatio: 0.75 + 0.2 * rng.next(), ltv: 0.8 }));
    });
    made += s.flags.offersMade; accepted += s.flags.offersAccepted;
  }
  assert.ok(made > 20, `offers made ${made}`);
  assert.ok(accepted > 0, `accepted ${accepted}`);
});

test('serialize/deserialize roundtrip continues identically', () => {
  const s = newGame(defaultMeta(), 99);
  for (let i = 0; i < 5; i++) endYear(s, defaultDecisions(s));
  const copy = deserialize(serialize(s));
  const s2 = deserialize(serialize(s));
  const r1 = endYear(copy, defaultDecisions(copy));
  const r2 = endYear(s2, defaultDecisions(s2));
  assert.equal(r1.yearResult.totalReturn, r2.yearResult.totalReturn);
  assert.equal(netWorth(copy), netWorth(s2));
});

test('reincarnate carries skills and records hall of fame', () => {
  const meta = defaultMeta();
  const s = newGame(meta, 5);
  for (let i = 0; i < 10; i++) endYear(s, { ...defaultDecisions(s), time: { reading: 100, scouting: 0, networking: 0, fun: 0, hustle: 0 } });
  const readingXp = s.skills.reading.xp;
  assert.ok(readingXp > 500, `reading xp ${readingXp}`);
  endLife(s, 'voluntary');
  const { meta: m2, state: n } = reincarnate(s, meta, { skillForBrag: 'quant' });
  assert.equal(m2.lives, 1);
  assert.equal(m2.hallOfFame.length, 1);
  assert.ok(m2.skills.reading >= readingXp);
  assert.equal(n.life.n, 2);
  assert.equal(n.skills.reading.xp, m2.skills.reading);
  assert.equal(n.life.age, 22);
});

test('voluntary reincarnation grants guts xp', () => {
  const s = newGame(defaultMeta(), 3);
  const before = s.skills.guts.xp;
  endLife(s, 'voluntary');
  assert.equal(s.skills.guts.xp - before >= 100, true);
});

test('same seed gives the same market and city regardless of decisions (same world)', () => {
  const a = newGame(defaultMeta(), 777), b = newGame(defaultMeta(), 777);
  for (let i = 0; i < 25; i++) {
    endYear(a, { ...defaultDecisions(a), time: { reading: 100, scouting: 0, networking: 0, fun: 0, hustle: 0 }, stockAlloc: 0 });
    const d = defaultDecisions(b); d.time = { reading: 0, scouting: 50, networking: 50, fun: 0, hustle: 0 }; d.stockAlloc = 1; d.scoutTargets = [1, 2, 3];
    const ls = b.city.listings.slice(0, 3); d.offers = ls.map(l => ({ listingId: l.id, bidRatio: 0.9, ltv: 0.7 }));
    endYear(b, d);
  }
  assert.deepEqual(a.market.series.index, b.market.series.index);
  assert.deepEqual(a.city.districts.map(x => x.value), b.city.districts.map(x => x.value));
  assert.deepEqual(a.city.listings.map(x => x.ask), b.city.listings.map(x => x.ask));
  assert.notDeepEqual(a.history.map(h => h.netWorth), b.history.map(h => h.netWorth));
});

test('reincarnate with sameWorld reuses the seed', () => {
  const meta = defaultMeta(); const s = newGame(meta, 4242);
  endYear(s, defaultDecisions(s)); endLife(s, 'voluntary');
  const r = reincarnate(s, meta, { skillForBrag: 'guts', sameWorld: true });
  assert.equal(r.state.seed, 4242);
  assert.deepEqual(r.state.city.districts.map(x => x.name), s.city.districts.map(x => x.name));
});

test('salary is paid in the retirement year and skipped offers are not counted', () => {
  let paid59 = null;
  for (let seed = 31; seed < 60 && paid59 === null; seed++) {
    const s = newGame(defaultMeta(), seed);
    while (s.life.alive && s.life.age < 61) {
      const age = s.life.age, employedBefore = s.work.employed && s.work.salary > 0;
      const r = endYear(s, defaultDecisions(s));
      if (age === 59) { if (employedBefore) paid59 = r.income.salary; break; }
    }
  }
  assert.ok(paid59 > 300, `salary at 59 = ${paid59}`);
  const t = newGame(defaultMeta(), 32);
  const d = defaultDecisions(t);
  const big = [...t.city.listings].sort((a, b) => b.ask - a.ask)[0];
  d.offers = [{ listingId: big.id, bidRatio: 1.0, ltv: 0 }];
  const r = endYear(t, d);
  assert.equal(r.offers[0].skipped, true);
  assert.equal(t.flags.offersMade, 0);
});
