// Tests for the physics hardening pass: corrected loop entry gates + a
// step-by-step mid-loop contact guarantee, consistent graded-surface friction
// across every coil, a derived/centralized corner threshold, and physically
// grounded rollback-vs-stall semantics.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Simulator, G, isRampGrade, isHill } from '../src/physics.js';
import { PIECES } from '../src/pieces/definitions.js';
import {
  CORNER_MAX_V2, MAX_DROP_HEIGHT, LOOP_RADIUS, GIANT_LOOP_RADIUS,
} from '../src/constants.js';

function trackOf(ids: string[], dropHeight = 3): Track {
  const t = new Track();
  t.dropHeight = dropHeight;
  for (const id of ids) t.addPiece(id);
  return t;
}

function runToCompletion(sim: Simulator, maxSteps = 8000): number {
  let steps = 0;
  while (sim.isRunning() && steps++ < maxSteps) sim.step(1 / 240);
  return steps;
}

/** Step until `pred` is true (or we give up). Returns whether it became true. */
function advanceUntil(sim: Simulator, pred: () => boolean, maxSteps = 4000): boolean {
  let steps = 0;
  while (sim.isRunning() && steps++ < maxSteps) {
    sim.step(1 / 240);
    if (pred()) return true;
  }
  return pred();
}

// --- Loop entry gate guarantees apex contact -------------------------------

test('LOOP: entering exactly at the entry gate keeps contact all the way over', () => {
  // A car that *just* clears the gate must complete the loop — the whole point
  // of folding the climb friction into the gate.
  const drop = PIECES.LOOP.minV2 / (2 * G);
  const sim = new Simulator(trackOf(['LOOP', 'FINISH'], drop));
  assert.ok(Math.abs(sim.v2 - PIECES.LOOP.minV2) < 1e-9, 'entry v2 should equal the gate');
  runToCompletion(sim);
  assert.equal(sim.failed, false, `should not fail at the gate value: ${sim.failReason}`);
  assert.equal(sim.finished, true);
});

test('GIANT_LOOP: entering exactly at the entry gate keeps contact all the way over', () => {
  const drop = PIECES.GIANT_LOOP.minV2 / (2 * G);
  const sim = new Simulator(trackOf(['GIANT_LOOP', 'FINISH'], drop));
  runToCompletion(sim);
  assert.equal(sim.failed, false, `should not fail at the gate value: ${sim.failReason}`);
  assert.equal(sim.finished, true);
});

test('LOOP: the corrected gate rejects the old frictionless 5·g·R speed', () => {
  // The naive frictionless gate was 5·g·R (= 24.5 for R=0.5). A car at that
  // speed cannot actually stay pinned to the apex once friction is paid, so the
  // corrected gate must reject it at entry rather than let it silently "pass".
  const frictionlessGate = 5 * G * LOOP_RADIUS;
  assert.ok(PIECES.LOOP.minV2 > frictionlessGate,
    'corrected gate should sit above the frictionless 5gR');
  const drop = (frictionlessGate + 1) / (2 * G); // above old gate, below the real one
  const sim = new Simulator(trackOf(['LOOP', 'FINISH'], drop));
  runToCompletion(sim);
  assert.equal(sim.failed, true);
  assert.equal(sim.failType, 'speed_gate');
});

// --- Mid-loop contact is enforced step-by-step (safety net) -----------------

test('LOOP: a car starved of speed at the apex peels off (fly_off), never silently completes', () => {
  const sim = new Simulator(trackOf(['LOOP', 'FINISH'], MAX_DROP_HEIGHT));
  // Drive onto the upper half of the loop, then sabotage the speed.
  const reached = advanceUntil(sim, () => sim.pieceIndex === 0 && sim.t >= 0.5);
  assert.ok(reached, 'should reach the loop apex region');
  sim.v2 = 1; // far below g·R needed to stay pinned at the top
  sim.step(1 / 240);
  assert.equal(sim.failed, true);
  assert.equal(sim.failType, 'fly_off');
  assert.match(sim.failReason ?? '', /loop/i);
});

test('GIANT_LOOP: contact threshold scales with the larger radius', () => {
  // At the apex the contact requirement is v² ≥ g·R, so the giant loop needs a
  // proportionally higher apex speed than the standard loop.
  assert.ok(G * GIANT_LOOP_RADIUS > G * LOOP_RADIUS);
  const sim = new Simulator(trackOf(['GIANT_LOOP', 'FINISH'], MAX_DROP_HEIGHT));
  const reached = advanceUntil(sim, () => sim.pieceIndex === 0 && sim.t >= 0.5);
  assert.ok(reached);
  sim.v2 = G * LOOP_RADIUS; // enough for a small loop, NOT for the giant one
  sim.step(1 / 240);
  assert.equal(sim.failType, 'fly_off');
});

// --- Graded-surface friction is consistent across every coil ----------------

test('isRampGrade: ramps AND every coil pay the graded-surface friction surcharge', () => {
  for (const id of ['RAMP_UP', 'RAMP_DN', 'STEEP_HILL', 'HELIX_UP', 'HELIX_DN', 'SPIRAL', 'SPIRAL_TOWER']) {
    assert.equal(isRampGrade(id), true, `${id} should be a graded surface`);
  }
  // Loops (own contact physics), ballistic jumps, and flat pieces are excluded.
  for (const id of ['LOOP', 'GIANT_LOOP', 'JUMP', 'GIANT_JUMP', 'CORKSCREW', 'STRAIGHT', 'CURVE_L', 'CURVE_R', 'BOOSTER', 'BRAKE', 'FINISH']) {
    assert.equal(isRampGrade(id), false, `${id} should not be a graded surface`);
  }
});

test('SPIRAL is treated like the other descending coils (regression: friction-mult parity)', () => {
  // SPIRAL used to be the odd coil out, skipping the surcharge that HELIX_DN and
  // SPIRAL_TOWER paid. They must now agree.
  for (const id of ['SPIRAL', 'HELIX_DN', 'SPIRAL_TOWER']) {
    assert.equal(isRampGrade(id), true, `${id} (descending coil) should be graded`);
  }
});

test('isHill: only the pieces you drive over the top of can roll back', () => {
  for (const id of ['RAMP_UP', 'STEEP_HILL', 'HELIX_UP']) {
    assert.equal(isHill(id), true, `${id} should be a hill`);
  }
  for (const id of ['HELIX_DN', 'SPIRAL', 'LOOP', 'GIANT_LOOP', 'STRAIGHT', 'JUMP']) {
    assert.equal(isHill(id), false, `${id} should not be a hill`);
  }
});

// --- Corner threshold is centralized and pinned to the drop ceiling ---------

test('CORNER_MAX_V2 is pinned to the drop ceiling: any legal drop alone is safe', () => {
  const fastestLegalDrop = 2 * G * MAX_DROP_HEIGHT;
  assert.ok(CORNER_MAX_V2 > fastestLegalDrop,
    'a corner must survive the fastest legal drop');
  // ...but a booster stacked on top sends the car over the edge.
  assert.ok(fastestLegalDrop + PIECES.BOOSTER.boostEnergy > CORNER_MAX_V2,
    'drop + booster should exceed the corner threshold');
});

// --- Rollback vs stall semantics --------------------------------------------

test('Rollback: a hill that can no longer reach its crest reports rollback (not stall)', () => {
  // Enter HELIX_UP legally, then sabotage the speed mid-climb. The car still has
  // real (non-zero) speed, so this is a rollback, not a stall.
  const sim = new Simulator(trackOf(['HELIX_UP', 'FINISH'], 5));
  const reached = advanceUntil(sim, () => sim.pieceIndex === 0 && sim.t >= 0.2 && sim.t <= 0.4);
  assert.ok(reached, 'should be mid-climb on the helix');
  sim.v2 = 5; // v ≈ 2.2 (well above stall), but nowhere near enough to crest
  sim.step(1 / 240);
  assert.equal(sim.failed, true);
  assert.equal(sim.failType, 'rollback');
});

test('Stall: losing all speed on a flat piece reports stall (not rollback)', () => {
  const sim = new Simulator(trackOf(['STRAIGHT', 'FINISH'], 3));
  advanceUntil(sim, () => sim.pieceIndex === 0 && sim.t > 0.1);
  sim.v2 = 0.004; // v ≈ 0.06, below the stall speed
  sim.step(1 / 240);
  assert.equal(sim.failed, true);
  assert.equal(sim.failType, 'stall');
});
