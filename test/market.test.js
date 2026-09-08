import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { createMarket, stepYear, cloneMarket, regimeLabel, DEFAULT_PARAMS } from '../src/engine/market.js';

function simulate(seeds, years) {
  const rets = []; let crash = 0, bubble = 0, n = 0, maxAbsX = 0, bad20 = 0, n20 = 0;
  for (const seed of seeds) {
    const rng = createRng(seed); const m = createMarket(rng); const idx = [100];
    for (let i = 0; i < years; i++) {
      const y = stepYear(m, rng); rets.push(y.totalReturn);
      if (y.crash) crash++; if (y.bubble) bubble++; n++; maxAbsX = Math.max(maxAbsX, Math.abs(y.x));
      assert.equal(y.monthly.length, 12); assert.equal(y.monthly[11], m.index);
      assert.ok(y.rate >= DEFAULT_PARAMS.rateMin && y.rate <= DEFAULT_PARAMS.rateMax);
      idx.push(idx[idx.length - 1] * (1 + y.totalReturn));
      if (idx.length > 20) { const c = (idx[idx.length - 1] / idx[idx.length - 21]) ** (1 / 20) - 1; n20++; if (c < -0.02) bad20++; }
    }
  }
  const mean = rets.reduce((a, b) => a + b) / n; const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const skew = rets.reduce((a, b) => a + ((b - mean) / sd) ** 3, 0) / n;
  return { mean, sd, skew, crash: crash / n, bubble: bubble / n, bad20: bad20 / n20, maxAbsX, n };
}

test('calibration: 12,000 simulated years match DESIGN §6 acceptance ranges', () => {
  const s = simulate([11, 22, 33, 44], 3000);
  assert.ok(s.n >= 10000);
  assert.ok(s.mean >= 0.05 && s.mean <= 0.09, `mean ${s.mean}`);
  assert.ok(s.sd >= 0.16 && s.sd <= 0.26, `sd ${s.sd}`);
  assert.ok(s.skew < 0.2, `skew ${s.skew} (target: near zero or negative)`);
  assert.ok(s.crash >= 0.04 && s.crash <= 0.12, `crash ${s.crash}`);
  assert.ok(s.bubble >= 0.04 && s.bubble <= 0.25, `bubble ${s.bubble}`);
  assert.ok(s.bad20 < 0.05, `bad20 ${s.bad20}`);
  assert.ok(s.maxAbsX < 1.5, `maxAbsX ${s.maxAbsX}`);
});

test('determinism and clone independence', () => {
  const a = createMarket(createRng(5)), ra = createRng(9);
  const b = createMarket(createRng(5)), rb = createRng(9);
  for (let i = 0; i < 30; i++) { stepYear(a, ra); stepYear(b, rb); }
  assert.deepEqual(a.series.index, b.series.index);
  const c = cloneMarket(a); const rc = createRng(1);
  stepYear(c, rc);
  assert.equal(a.series.index.length + 1, c.series.index.length);
  assert.notEqual(c.index, a.index);
});

test('regime labels cover all states', () => {
  const m = createMarket(createRng(3)); const rng = createRng(3);
  const seen = new Set();
  for (let i = 0; i < 400; i++) { stepYear(m, rng); seen.add(regimeLabel(m)); }
  for (const l of ['平穏', '過熱', 'バブル', '暴落']) assert.ok(seen.has(l), `missing ${l}: ${[...seen]}`);
});
