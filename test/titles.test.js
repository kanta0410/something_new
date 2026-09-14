import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, defaultMeta, endLife } from '../src/engine/game.js';
import { computeScore } from '../src/engine/score.js';
import { TITLES, awardLifeTitles, awardStreakTitles, trackPeaks, hasTitle } from '../src/engine/titles.js';

test('titles are awarded once and match conditions', () => {
  const meta = defaultMeta(); const s = newGame(meta, 1);
  s.money.cash = 20000; trackPeaks(s, [0.5]);
  s.flags.alamoCount = 3; s.flags.fired = true;
  endLife(s, 'voluntary');
  const got = awardLifeTitles(meta, s, computeScore(s));
  const ids = got.map(t => t.id);
  for (const id of ['half', 'alamo', 'fire', 'oku', 'brave']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('juoku'));
  assert.equal(awardLifeTitles(meta, s, computeScore(s)).length, 0);
  assert.ok(hasTitle(meta, 'half'));
  assert.ok(TITLES.length >= 12);
});

test('streak titles', () => {
  const meta = defaultMeta();
  assert.equal(awardStreakTitles(meta, 6, 1).length, 0);
  assert.equal(awardStreakTitles(meta, 7, 1).map(t => t.id).join(), 'streak7');
  assert.equal(awardStreakTitles(meta, 100, 2).length, 2);
  assert.equal(awardStreakTitles(meta, 365, 2).length, 0);
});
