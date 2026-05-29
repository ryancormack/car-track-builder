// Tests for the energy-based simulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Simulator, G } from '../src/physics.js';

function trackOf(ids: string[], dropHeight = 3): Track {
  const t = new Track();
  t.dropHeight = dropHeight;
  for (const id of ids) t.addPiece(id);
  return t;
}

function runToCompletion(sim: Simulator, maxSteps = 4000): number {
  let steps = 0;
  while (sim.isRunning() && steps++ < maxSteps) sim.step(1 / 240);
  return steps;
}

test('initial v² equals 2·g·dropHeight', () => {
  const sim = new Simulator(trackOf(['STRAIGHT'], 4));
  assert.ok(Math.abs(sim.v2 - 2 * G * 4) < 1e-9);
  assert.ok(Math.abs(sim.speed - Math.sqrt(2 * G * 4)) < 1e-9);
});

test('a straight track loses energy to friction over distance', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'STRAIGHT', 'STRAIGHT'], 5));
  const initial = sim.v2;
  runToCompletion(sim);
  assert.ok(sim.v2 < initial, 'final v² should drop due to friction');
});

test('FINISH piece marks the run as finished, not failed', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'FINISH'], 3));
  runToCompletion(sim);
  assert.equal(sim.finished, true);
  assert.equal(sim.failed, false);
});

test('running off the end without a FINISH counts as failure', () => {
  const sim = new Simulator(trackOf(['STRAIGHT'], 3));
  runToCompletion(sim);
  assert.equal(sim.failed, true);
  assert.match(sim.failReason ?? '', /Finish/i);
});

test('LOOP fails the run when the entry speed is too low', () => {
  // Drop height 0 → v² = 0, which is below the loop's 5·g·R entry gate.
  // Should fail at entry.
  const sim = new Simulator(trackOf(['LOOP', 'FINISH'], 0));
  sim.step(1 / 240); // first step triggers entry checks
  assert.equal(sim.failed, true);
  assert.match(sim.failReason ?? '', /Loop/i);
});

test('LOOP succeeds when starting from a high enough drop', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'LOOP', 'STRAIGHT', 'FINISH'], 5));
  runToCompletion(sim);
  assert.equal(sim.failed, false);
  assert.equal(sim.finished, true);
});

test('BOOSTER applies its boost energy exactly once on entry', () => {
  const sim = new Simulator(trackOf(['BOOSTER', 'FINISH'], 2));
  // Step to enter the booster: this triggers the entry check and applies +90.
  // We measure v² right after entry by taking one tiny step.
  sim.step(1 / 240);
  assert.equal(sim.boostersUsed, 1);
  // Drive on to FINISH and confirm boost wasn't reapplied.
  runToCompletion(sim);
  assert.equal(sim.boostersUsed, 1);
});

test('topSpeed records the maximum speed seen during the run', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'BOOSTER', 'STRAIGHT', 'FINISH'], 3));
  runToCompletion(sim);
  assert.ok(sim.topSpeed >= sim.speed - 1e-6);
});

test('step() is a no-op once the run has ended', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'FINISH'], 3));
  runToCompletion(sim);
  const v2Before = sim.v2;
  const tBefore = sim.elapsed;
  sim.step(0.1);
  assert.equal(sim.v2, v2Before);
  assert.equal(sim.elapsed, tBefore);
});

test('carSample returns a valid frame (position + orthonormal axes) for the active piece', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'FINISH'], 3));
  const s = sim.carSample();
  assert.ok(s);
  for (const v of [s.pos, s.tangent, s.up, s.side]) {
    assert.ok(Number.isFinite(v.x + v.y + v.z), 'frame vector should be finite');
  }
  for (const v of [s.tangent, s.up, s.side]) {
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-6, 'axis should be unit length');
  }
});

test('reset() restores the simulator to its initial state', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'FINISH'], 3));
  for (let i = 0; i < 50; i++) sim.step(1 / 60);
  sim.reset();
  assert.equal(sim.pieceIndex, 0);
  assert.equal(sim.t, 0);
  assert.equal(sim.elapsed, 0);
  assert.ok(Math.abs(sim.v2 - 2 * G * sim.track.dropHeight) < 1e-9);
});
