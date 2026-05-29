// Tests for the scoring system.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../js/track.js';
import { computeScore, designScore } from '../js/scoring.js';

function trackOf(ids) {
  const t = new Track();
  for (const id of ids) t.addPiece(id);
  return t;
}

test('design score is zero for an empty track', () => {
  assert.equal(designScore(new Track()), 0);
});

test('design score = 5·count + sum(excitement)', () => {
  // 2 STRAIGHT (excitement 1 each) + 1 LOOP (excitement 30) = 5*3 + 1+1+30 = 47
  assert.equal(designScore(trackOf(['STRAIGHT', 'STRAIGHT', 'LOOP'])), 47);
});

test('completion bonus is applied on a finished + non-failed run', () => {
  const track = trackOf(['STRAIGHT', 'FINISH']);
  const sim = { topSpeed: 10, boostersUsed: 0, finished: true, failed: false };
  const a = computeScore(track, sim);
  const b = computeScore(track, { ...sim, finished: false });
  assert.ok(a.total - b.total >= 250, 'finishing should add at least the +250 bonus');
});

test('failed runs are penalised with the 0.4× multiplier', () => {
  const track = trackOf(['STRAIGHT', 'LOOP', 'FINISH']);
  const okScore = computeScore(track, { topSpeed: 12, boostersUsed: 0, finished: true, failed: false });
  const failScore = computeScore(track, { topSpeed: 12, boostersUsed: 0, finished: false, failed: true });
  assert.ok(failScore.total < okScore.total);
  assert.equal(failScore.breakdown.failMult, 0.4);
});

test('booster penalty subtracts 15 per booster used', () => {
  const track = trackOf(['BOOSTER', 'STRAIGHT', 'FINISH']);
  const a = computeScore(track, { topSpeed: 10, boostersUsed: 0, finished: true, failed: false });
  const b = computeScore(track, { topSpeed: 10, boostersUsed: 2, finished: true, failed: false });
  assert.equal(a.total - b.total, 30);
});

test('top-speed bonus scales with peak speed', () => {
  const track = trackOf(['STRAIGHT', 'FINISH']);
  const slow = computeScore(track, { topSpeed: 5, boostersUsed: 0, finished: true, failed: false });
  const fast = computeScore(track, { topSpeed: 20, boostersUsed: 0, finished: true, failed: false });
  assert.ok(fast.total > slow.total);
});

test('stunt combo gives a bonus for chaining 2+ stunts in a row', () => {
  const track = trackOf(['LOOP', 'CORKSCREW', 'JUMP', 'FINISH']);
  const sim = { topSpeed: 12, boostersUsed: 0, finished: true, failed: false };
  const r = computeScore(track, sim);
  assert.ok(r.breakdown.stuntCombo > 0);
});

test('non-stunt piece between stunts breaks the combo streak', () => {
  const a = computeScore(trackOf(['LOOP', 'CORKSCREW', 'FINISH']),
    { topSpeed: 10, boostersUsed: 0, finished: true, failed: false });
  const b = computeScore(trackOf(['LOOP', 'STRAIGHT', 'CORKSCREW', 'FINISH']),
    { topSpeed: 10, boostersUsed: 0, finished: true, failed: false });
  assert.ok(a.breakdown.stuntCombo > b.breakdown.stuntCombo);
});

test('total score is never negative', () => {
  const track = trackOf(['BOOSTER', 'BOOSTER', 'BOOSTER', 'BOOSTER', 'BOOSTER']);
  const sim = { topSpeed: 0, boostersUsed: 5, finished: false, failed: true };
  const r = computeScore(track, sim);
  assert.ok(r.total >= 0);
});
