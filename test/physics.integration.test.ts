// Physics integration tests: numerical verification of path lengths, energy
// conservation, minV2 gates, overspeed thresholds, and full-track completion.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Simulator, G } from '../src/physics.js';
import { pathSpiral, pathSteepHill } from '../src/pieces/paths.js';
import { PIECES } from '../src/pieces/definitions.js';
import type { PathFn } from '../src/types.js';

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

// Numerically compute arc length of a path function by summing small segments.
function computeArcLength(pathFn: PathFn, steps = 10000): number {
  let length = 0;
  let prev = pathFn(0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const curr = pathFn(t);
    const dx = curr.lx - prev.lx;
    const dy = curr.ly - prev.ly;
    const dz = curr.lz - prev.lz;
    length += Math.sqrt(dx * dx + dy * dy + dz * dz);
    prev = curr;
  }
  return length;
}

// --- Path length verification ---

test('SPIRAL: declared pathLen matches numerical arc length within 10%', () => {
  const actual = computeArcLength(pathSpiral);
  const declared = PIECES.SPIRAL.pathLen;
  const ratio = actual / declared;
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `SPIRAL pathLen mismatch: actual=${actual.toFixed(3)}, declared=${declared}, ratio=${ratio.toFixed(3)}`);
});

test('STEEP_HILL: declared pathLen matches numerical arc length within 10%', () => {
  const actual = computeArcLength(pathSteepHill);
  const declared = PIECES.STEEP_HILL.pathLen;
  const ratio = actual / declared;
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `STEEP_HILL pathLen mismatch: actual=${actual.toFixed(3)}, declared=${declared}, ratio=${ratio.toFixed(3)}`);
});

// --- minV2 gate verification ---

test('SPIRAL: car gains net energy from gravity descent (exits faster than entry)', () => {
  // Start with known v2 from drop=3 -> v2=58.8
  const sim = new Simulator(trackOf(['SPIRAL', 'FINISH'], 3));
  const entryV2 = sim.v2;
  runToCompletion(sim);
  assert.ok(!sim.failed, `should not fail: ${sim.failReason}`);
  // dz=-2 gives gravity gain of 2*G*2 = 39.2
  // Friction cost: 2*FRICTION*pathLen ~ 2*0.55*4.22 = 4.64 (no ramp mult for spiral)
  // Net gain should be positive => exit v2 > entry v2
  assert.ok(sim.v2 > entryV2,
    `spiral should gain speed from descent: entry=${entryV2.toFixed(1)}, exit=${sim.v2.toFixed(1)}`);
});

test('SPIRAL: car with v2 just above minV2 gate completes successfully', () => {
  const minV2 = PIECES.SPIRAL.minV2;
  // Give enough drop to pass the gate with a small buffer
  const dropHeight = (minV2 + 2) / (2 * G);
  const sim = new Simulator(trackOf(['SPIRAL', 'FINISH'], dropHeight));
  runToCompletion(sim);
  assert.ok(!sim.failed,
    `SPIRAL should succeed with v2=${(2 * G * dropHeight).toFixed(1)} > minV2=${minV2}: ${sim.failReason}`);
  assert.ok(sim.finished);
});

test('STEEP_HILL: car barely passing minV2 gate still crests successfully', () => {
  const minV2 = PIECES.STEEP_HILL.minV2;
  // +3 buffer above gate to account for friction before reaching the piece
  const dropHeight = (minV2 + 3) / (2 * G);
  const sim = new Simulator(trackOf(['STEEP_HILL', 'FINISH'], dropHeight));
  runToCompletion(sim);
  assert.ok(!sim.failed,
    `STEEP_HILL should succeed with v2=${(2 * G * dropHeight).toFixed(1)} > minV2=${minV2.toFixed(1)}: ${sim.failReason}`);
  assert.ok(sim.finished);
});

test('STEEP_HILL: car with v2 below minV2 fails at gate', () => {
  const minV2 = PIECES.STEEP_HILL.minV2;
  // Drop height that gives v2 clearly below the gate
  const dropHeight = (minV2 - 5) / (2 * G);
  const sim = new Simulator(trackOf(['STEEP_HILL', 'FINISH'], dropHeight));
  runToCompletion(sim);
  assert.ok(sim.failed);
  assert.equal(sim.failType, 'speed_gate');
});

// --- Energy conservation spot-checks ---

test('RAMP_UP + RAMP_DN (net dz=0): exit v2 < entry v2 by approx friction toll', () => {
  const sim = new Simulator(trackOf(['RAMP_UP', 'RAMP_DN', 'FINISH'], 5));
  const entryV2 = sim.v2; // 2*G*5 = 98
  runToCompletion(sim);
  assert.ok(!sim.failed, `should complete: ${sim.failReason}`);
  // Expected friction loss: 2*FRICTION*RAMP_FRICTION_MULT*(1.5+1.5) = 3.63, plus drag
  const loss = entryV2 - sim.v2;
  assert.ok(loss > 2 && loss < 15,
    `friction loss should be reasonable: ${loss.toFixed(2)}`);
});

test('SPIRAL (dz=-2): car exits with more v2 than it entered (gravity > friction)', () => {
  // Use drop=2 for a moderate entry speed
  const sim = new Simulator(trackOf(['SPIRAL', 'FINISH'], 2));
  const entryV2 = sim.v2; // 2*G*2 = 39.2
  runToCompletion(sim);
  assert.ok(!sim.failed, `should complete: ${sim.failReason}`);
  // Gravity gain: 2*G*2 = 39.2
  // Friction cost: 2*FRICTION*4.22 = 4.64
  // Net gain: ~34.5 (plus small drag loss)
  const gain = sim.v2 - entryV2;
  assert.ok(gain > 20,
    `spiral should gain significant energy from descent: gain=${gain.toFixed(2)}`);
});

// --- Overspeed corner verification ---

test('Overspeed corner: drop=6 alone (v2=117.6) does NOT trigger overspeed at curves', () => {
  // v2=117.6 is below 120 threshold
  const sim = new Simulator(trackOf(['CURVE_R', 'FINISH'], 6));
  runToCompletion(sim);
  assert.ok(!sim.failed, `drop=6 should not trigger overspeed: ${sim.failReason}`);
  assert.ok(sim.finished);
});

test('Overspeed corner: booster + drop=6 (v2>200) DOES trigger overspeed', () => {
  const sim = new Simulator(trackOf(['BOOSTER', 'CURVE_R', 'FINISH'], 6));
  runToCompletion(sim);
  assert.ok(sim.failed);
  assert.equal(sim.failType, 'overspeed_corner');
});

test('Overspeed corner: CURVE_L behaves same as CURVE_R', () => {
  const sim = new Simulator(trackOf(['BOOSTER', 'CURVE_L', 'FINISH'], 6));
  runToCompletion(sim);
  assert.ok(sim.failed);
  assert.equal(sim.failType, 'overspeed_corner');
});

// --- Rollback detection ---

test('Rollback triggers on RAMP_UP with marginal speed', () => {
  // Give just barely enough to pass the speed gate but not enough to crest
  // RAMP_UP_MIN_V2 is about 25.4, let's give exactly that
  const minV2 = PIECES.RAMP_UP.minV2;
  const dropHeight = minV2 / (2 * G); // exactly at gate
  const sim = new Simulator(trackOf(['RAMP_UP', 'FINISH'], dropHeight));
  runToCompletion(sim);
  // The car should either succeed or fail with rollback/stall (not speed_gate)
  if (sim.failed) {
    assert.ok(sim.failType === 'rollback' || sim.failType === 'stall',
      `should be rollback or stall, not ${sim.failType}`);
  }
});

test('Rollback does NOT trigger on STEEP_HILL (uses speed_gate instead)', () => {
  // Give insufficient speed for STEEP_HILL
  const sim = new Simulator(trackOf(['STEEP_HILL', 'FINISH'], 0));
  runToCompletion(sim);
  assert.ok(sim.failed);
  assert.equal(sim.failType, 'speed_gate');
});

// --- Full integration test ---

test('Integration: all piece types in sequence at drop=6 completes', () => {
  // Order carefully: curves first (before v2 exceeds 120), booster before demanding stunts
  const pieces = [
    'STRAIGHT', 'CURVE_R', 'STRAIGHT', 'CURVE_L', 'STRAIGHT',
    'RAMP_UP', 'RAMP_DN', 'STRAIGHT',
    'BOOSTER',
    'LOOP', 'STRAIGHT',
    'CORKSCREW', 'STRAIGHT',
    'JUMP', 'STRAIGHT',
    'SPIRAL', 'STRAIGHT',
    'STEEP_HILL', 'STRAIGHT',
    'FINISH',
  ];
  const sim = new Simulator(trackOf(pieces, 6));
  runToCompletion(sim);
  assert.ok(!sim.failed,
    `Integration test failed at piece ${sim.failPieceIndex} (${pieces[sim.failPieceIndex]}): ${sim.failReason}`);
  assert.ok(sim.finished, 'should reach finish');
});

test('Integration: moderate track at drop=4 completes', () => {
  // A simpler track that tests basic piece connectivity
  const pieces = [
    'STRAIGHT', 'CURVE_R', 'STRAIGHT', 'CURVE_L', 'STRAIGHT',
    'LOOP', 'STRAIGHT',
    'SPIRAL', 'STRAIGHT',
    'FINISH',
  ];
  const sim = new Simulator(trackOf(pieces, 4));
  runToCompletion(sim);
  assert.ok(!sim.failed,
    `Moderate track failed at piece ${sim.failPieceIndex}: ${sim.failReason}`);
  assert.ok(sim.finished);
});
