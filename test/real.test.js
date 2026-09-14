import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, defaultMeta } from '../src/engine/game.js';
import { REAL_ACTIONS, recordRealAction, doneToday, currentStreak, recentDays, ledgerText, todayKey, questFor, QUESTS, setNote, getNote, recentNotes } from '../src/engine/real.js';

test('real actions apply once per day and build a streak', () => {
  const meta = defaultMeta(); const s = newGame(meta, 1);
  const g0 = s.skills.guts.xp;
  const r1 = recordRealAction(meta, s, 'offer', '2026-09-14');
  assert.equal(r1.applied, true); assert.equal(r1.streak, 1);
  assert.ok(s.skills.guts.xp > g0);
  const r2 = recordRealAction(meta, s, 'offer', '2026-09-14');
  assert.equal(r2.applied, false);
  assert.deepEqual(doneToday(meta, '2026-09-14'), ['offer']);
  recordRealAction(meta, s, 'read', '2026-09-15');
  assert.equal(currentStreak(meta, '2026-09-15'), 2);
  assert.equal(currentStreak(meta, '2026-09-16'), 2);
  assert.equal(currentStreak(meta, '2026-09-18'), 0);
  const r3 = recordRealAction(meta, s, 'scout', '2026-09-20');
  assert.equal(r3.streak, 1);
});

test('full combo grants energy; ledger and recent days shaped', () => {
  const meta = defaultMeta(); const s = newGame(meta, 2);
  s.meters.energy = 0;
  let last;
  for (const a of REAL_ACTIONS) last = recordRealAction(meta, s, a.id, '2026-10-01');
  assert.equal(last.combo, true);
  assert.ok(s.meters.energy >= 20);
  assert.equal(recentDays(meta, 7, '2026-10-01').length, 7);
  assert.equal(recentDays(meta, 7, '2026-10-01')[6].count, REAL_ACTIONS.length);
  assert.ok(ledgerText(meta, '2026-10-01').includes('買い付け: 1 回'));
  assert.match(todayKey(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('daily quest rotates and notes persist per day', () => {
  const q1 = questFor('2026-09-14'), q2 = questFor('2026-09-15');
  assert.ok(QUESTS.includes(q1) && QUESTS.includes(q2));
  assert.notEqual(q1, q2);
  assert.ok(REAL_ACTIONS.some(a => a.id === q1.action));
  const meta = defaultMeta();
  setNote(meta, '  買い付けは月 3 本。 ', '2026-09-14');
  assert.equal(getNote(meta, '2026-09-14'), '買い付けは月 3 本。');
  setNote(meta, 'x'.repeat(300), '2026-09-15');
  assert.equal(getNote(meta, '2026-09-15').length, 200);
  assert.equal(recentNotes(meta, 14, '2026-09-15')[0].date, '2026-09-15');
  assert.ok(ledgerText(meta, '2026-09-15').includes('言語化メモ'));
});
