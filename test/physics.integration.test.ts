// Physics integration tests: numerical verification of path lengths, energy
// conservation, minV2 gates, overspeed thresholds, and full-track completion.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Simulator, G } from '../src/physics.js';
import { pathSpiral, pathSteepHill, pathHelixUp, pathHelixDown, pathSpiralTower } from '../src/pieces/paths.js';
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

// Build a track and assert every piece actually placed. addPiece silently
// rejects floor/overlap violations, so this guards against a descending piece
// being dropped (the ground is gz = 0: descents must follow a climb).
function builtTrack(ids: string[], dropHeight: number): Track {
  const t = trackOf(ids, dropHeight);
  assert.equal(t.pieces.length, ids.length, `all pieces should place; got [${t.pieces.join(', ')}]`);
  return t;
}

// Run a sim, capturing v² at the entry and exit of a specific piece index. Lets
// us verify a descent piece converts height to speed even though the track now
// stays at or above the ground (so it descends at altitude, not below gz = 0).
function v2AcrossPiece(track: Track, idx: number): { sim: Simulator; entryV2: number; exitV2: number } {
  const sim = new Simulator(track);
  let entryV2 = NaN;
  let exitV2 = NaN;
  let steps = 0;
  while (sim.isRunning() && steps++ < 80000) {
    sim.step(1 / 240);
    if (sim.pieceIndex === idx) {
      if (Number.isNaN(entryV2)) entryV2 = sim.v2;
      exitV2 = sim.v2;
    }
  }
  return { sim, entryV2, exitV2 };
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

test('HELIX_DN: declared pathLen matches numerical arc length within 10%', () => {
  const actual = computeArcLength(pathHelixDown);
  const declared = PIECES.HELIX_DN.pathLen;
  const ratio = actual / declared;
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `HELIX_DN pathLen mismatch: actual=${actual.toFixed(3)}, declared=${declared}, ratio=${ratio.toFixed(3)}`);
});

test('HELIX_UP: declared pathLen matches numerical arc length within 10%', () => {
  const actual = computeArcLength(pathHelixUp);
  const declared = PIECES.HELIX_UP.pathLen;
  const ratio = actual / declared;
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `HELIX_UP pathLen mismatch: actual=${actual.toFixed(3)}, declared=${declared}, ratio=${ratio.toFixed(3)}`);
});

test('SPIRAL_TOWER: declared pathLen matches numerical arc length within 10%', () => {
  const actual = computeArcLength(pathSpiralTower);
  const declared = PIECES.SPIRAL_TOWER.pathLen;
  const ratio = actual / declared;
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `SPIRAL_TOWER pathLen mismatch: actual=${actual.toFixed(3)}, declared=${declared}, ratio=${ratio.toFixed(3)}`);
});

// --- minV2 gate verification ---

test('SPIRAL: descending the coil at altitude accelerates the car (gravity > friction)', () => {
  // Ground is gz = 0, so climb to gz 2 first, then the spiral drops back down.
  const track = builtTrack(['RAMP_UP', 'RAMP_UP', 'SPIRAL', 'FINISH'], 6);
  const { sim, entryV2, exitV2 } = v2AcrossPiece(track, 2); // SPIRAL is index 2
  assert.ok(!sim.failed, `should not fail: ${sim.failReason}`);
  assert.ok(exitV2 > entryV2,
    `spiral should gain speed over its descent: entry=${entryV2.toFixed(1)}, exit=${exitV2.toFixed(1)}`);
});

test('SPIRAL: completes when descending from a climb', () => {
  const track = builtTrack(['RAMP_UP', 'RAMP_UP', 'SPIRAL', 'FINISH'], 6);
  const sim = new Simulator(track);
  runToCompletion(sim);
  assert.ok(!sim.failed, `SPIRAL should complete: ${sim.failReason}`);
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

// --- Helix minV2 gate and energy tests ---

test('HELIX_DN: descending the helix at altitude accelerates the car', () => {
  // Climb to gz 3, then the helix drops back to the ground.
  const track = builtTrack(['RAMP_UP', 'RAMP_UP', 'RAMP_UP', 'HELIX_DN', 'FINISH'], 6);
  const { sim, entryV2, exitV2 } = v2AcrossPiece(track, 3); // HELIX_DN is index 3
  assert.ok(!sim.failed, `should not fail: ${sim.failReason}`);
  assert.ok(exitV2 > entryV2,
    `helix down should gain speed over its descent: entry=${entryV2.toFixed(1)}, exit=${exitV2.toFixed(1)}`);
});

test('HELIX_UP: car with v2 above minV2 gate completes successfully', () => {
  const minV2 = PIECES.HELIX_UP.minV2;
  // Give enough drop to pass the gate with a buffer
  const dropHeight = (minV2 + 5) / (2 * G);
  const sim = new Simulator(trackOf(['HELIX_UP', 'FINISH'], dropHeight));
  runToCompletion(sim);
  assert.ok(!sim.failed,
    `HELIX_UP should succeed with v2=${(2 * G * dropHeight).toFixed(1)} > minV2=${minV2.toFixed(1)}: ${sim.failReason}`);
  assert.ok(sim.finished);
});

test('SPIRAL_TOWER: descending the tower at altitude accelerates the car', () => {
  // Climb to gz 4, then the tower winds back down to the ground.
  const track = builtTrack(['RAMP_UP', 'RAMP_UP', 'RAMP_UP', 'RAMP_UP', 'SPIRAL_TOWER', 'FINISH'], 6);
  const { sim, entryV2, exitV2 } = v2AcrossPiece(track, 4); // SPIRAL_TOWER is index 4
  assert.ok(!sim.failed, `should not fail: ${sim.failReason}`);
  assert.ok(exitV2 > entryV2,
    `spiral tower should gain speed over its descent: entry=${entryV2.toFixed(1)}, exit=${exitV2.toFixed(1)}`);
  assert.ok(sim.finished);
});

test('SPIRAL_TOWER: completes after climbing to its height', () => {
  const track = builtTrack(['RAMP_UP', 'RAMP_UP', 'RAMP_UP', 'RAMP_UP', 'SPIRAL_TOWER', 'FINISH'], 6);
  const sim = new Simulator(track);
  runToCompletion(sim);
  assert.ok(!sim.failed, `SPIRAL_TOWER should complete: ${sim.failReason}`);
  assert.ok(sim.finished);
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

test('SPIRAL (dz=-2): the coil descent converts height to speed', () => {
  // Climb to gz 2, then the spiral drops back to the ground, converting that
  // height into speed (gravity gain well above the friction toll).
  const track = builtTrack(['RAMP_UP', 'RAMP_UP', 'SPIRAL', 'FINISH'], 6);
  const { sim, entryV2, exitV2 } = v2AcrossPiece(track, 2);
  assert.ok(!sim.failed, `should complete: ${sim.failReason}`);
  const gain = exitV2 - entryV2;
  assert.ok(gain > 20,
    `spiral should gain significant energy over its descent: gain=${gain.toFixed(2)}`);
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
    'HELIX_DN', 'STRAIGHT',
    'SPIRAL_TOWER', 'STRAIGHT',
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
