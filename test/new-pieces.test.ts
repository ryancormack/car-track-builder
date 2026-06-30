// Tests for the new track parts: steep ramps, wide turns, the smash wall, and
// the ring-of-fire decoration.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pathSteepRampUp, pathSteepRampDown, pathRampUp,
  pathWideR2, pathWideL2, pathWideR3, pathWideL3,
} from '../src/pieces/paths.js';
import { PIECES, canDecorate } from '../src/pieces/definitions.js';
import { Track } from '../src/track.js';
import { Simulator } from '../src/physics.js';
import { computeScore, designScore } from '../src/scoring.js';
import { WALL_SMASH_V2, G } from '../src/constants.js';
import type { PieceId } from '../src/types.js';

// --- Steep ramps --------------------------------------------------------------

test('steep ramps span one cell and change elevation by two units', () => {
  for (const [fn, sign] of [[pathSteepRampUp, 1], [pathSteepRampDown, -1]] as const) {
    const s = fn(0), e = fn(1);
    assert.ok(Math.abs(s.lx) < 1e-9 && Math.abs(s.lz) < 1e-9, 'starts at origin');
    assert.ok(Math.abs(e.lx - 1) < 1e-9, 'ends one cell forward');
    assert.ok(Math.abs(e.lz - sign * 2) < 1e-9, `ends at lz=${sign * 2}`);
  }
});

test('steep ramp up is steeper than the standard ramp up at the midpoint', () => {
  // Both climb over a 1-cell span; the steep ramp gains more height by t=0.5.
  assert.ok(pathSteepRampUp(0.5).lz > pathRampUp(0.5).lz + 0.4,
    'steep ramp should be well above the standard ramp mid-span');
  // And it climbs higher overall (dz = 2 vs 1).
  assert.equal(PIECES.STEEP_RAMP_UP.dz, 2);
  assert.equal(PIECES.STEEP_RAMP_DN.dz, -2);
});

test('steep ramp up has a higher entry-speed gate than the standard ramp up', () => {
  assert.ok(PIECES.STEEP_RAMP_UP.minV2 > PIECES.RAMP_UP.minV2,
    'steeper, taller climb needs more entry speed');
});

// --- Wide turns ---------------------------------------------------------------

// Any turn=±1 piece must end at local (0.5, ±(forward-0.5), 0) heading along the
// exit axis, so it connects cleanly to the next piece on the grid.
test('wide turns end at the grid connection point (0.5, ±(forward-0.5))', () => {
  const cases: [(t: number) => { lx: number; ly: number; lz: number }, number, number][] = [
    [pathWideR2, 2, 1], [pathWideL2, 2, -1], [pathWideR3, 3, 1], [pathWideL3, 3, -1],
  ];
  for (const [fn, forward, sign] of cases) {
    const s = fn(0), e = fn(1);
    assert.ok(Math.abs(s.lx) < 1e-9 && Math.abs(s.ly) < 1e-9, 'starts at origin');
    assert.ok(Math.abs(e.lx - 0.5) < 1e-6, `ends at lx=0.5, got ${e.lx}`);
    assert.ok(Math.abs(e.ly - sign * (forward - 0.5)) < 1e-6, `ends at ly=${sign * (forward - 0.5)}, got ${e.ly}`);
    assert.ok(Math.abs(e.lz) < 1e-9, 'stays flat');
  }
});

test('wide turns sweep wider laterally than the tight standard curve, and stay in footprint', () => {
  for (const [fn, forward] of [[pathWideR2, 2], [pathWideR3, 3]] as const) {
    let maxAbsLy = 0, minLx = Infinity, maxLx = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const p = fn(i / 1000);
      maxAbsLy = Math.max(maxAbsLy, Math.abs(p.ly));
      minLx = Math.min(minLx, p.lx); maxLx = Math.max(maxLx, p.lx);
    }
    // Sweeps the full forward-0.5 lateral reach (much wider than the 0.5 of CURVE_R).
    assert.ok(Math.abs(maxAbsLy - (forward - 0.5)) < 0.01, `lateral reach ${forward - 0.5}`);
    // Forward extent stays within the piece (never meaningfully pokes behind entry).
    assert.ok(minLx > -0.01 && maxLx < 0.75, `lx within [0,~0.5]: [${minLx}, ${maxLx}]`);
  }
});

test('wide turns place and chain on the grid (right then left returns to straight)', () => {
  const track = new Track();
  track.dropHeight = 3;
  for (const id of ['STRAIGHT', 'WIDE_R_2', 'WIDE_L_3', 'STRAIGHT', 'FINISH'] as PieceId[]) {
    assert.ok(track.addPiece(id), `should place ${id}`);
  }
  assert.equal(track.pieces.length, 5);
});

// --- Smash Wall ---------------------------------------------------------------

function wallRun(drop: number): Simulator {
  const track = new Track();
  track.dropHeight = drop;
  ['STRAIGHT', 'WALL', 'STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
  const sim = new Simulator(track);
  let steps = 0;
  while (sim.isRunning() && steps++ < 20000) sim.step(1 / 240);
  return sim;
}

test('wall: enough speed smashes through and the run continues', () => {
  // drop high enough that v2 at the wall clears WALL_SMASH_V2.
  const sim = wallRun(4);
  assert.ok(!sim.failed, `should smash through: ${sim.failReason}`);
  assert.ok(sim.finished, 'reaches the finish');
  assert.deepEqual(sim.smashedWalls, [1], 'records the smashed wall index for the effect');
});

test('wall: too slow crashes and explodes (game over)', () => {
  const sim = wallRun(1);
  assert.ok(sim.failed, 'should fail');
  assert.equal(sim.failType, 'crash', 'explodes rather than the generic speed gate');
  assert.equal(sim.smashedWalls.length, 0, 'nothing smashed when it crashes');
});

test('WALL_SMASH_V2 gate sits between a low and a moderate drop', () => {
  // Entry v2 from a clean drop is 2*G*drop minus a little track friction.
  assert.ok(2 * G * 1 < WALL_SMASH_V2, 'drop 1 is below the gate');
  assert.ok(2 * G * 4 > WALL_SMASH_V2, 'drop 4 is above the gate');
});

// --- Ring of Fire decoration --------------------------------------------------

test('canDecorate allows flat pieces and rejects curved/inverted ones', () => {
  for (const id of ['STRAIGHT', 'RAMP_UP', 'STEEP_RAMP_DN', 'JUMP', 'BOOSTER', 'WALL', 'FINISH'] as PieceId[]) {
    assert.ok(canDecorate(id), `${id} should be decoratable`);
  }
  for (const id of ['CURVE_L', 'LOOP', 'CORKSCREW', 'HELIX_UP', 'SPIRAL', 'WIDE_R_2'] as PieceId[]) {
    assert.ok(!canDecorate(id), `${id} should NOT be decoratable`);
  }
});

test('toggleDecoration adds, removes, and rejects incompatible pieces', () => {
  const track = new Track();
  ['STRAIGHT', 'LOOP', 'FINISH'].forEach((id) => track.addPiece(id));
  // Add to the straight (index 0).
  assert.equal(track.toggleDecoration(0, 'RING_OF_FIRE'), true);
  assert.equal(track.decorationAt(0), 'RING_OF_FIRE');
  // Toggle off.
  assert.equal(track.toggleDecoration(0, 'RING_OF_FIRE'), false);
  assert.equal(track.decorationAt(0), null);
  // Rejected on the loop (not decoratable).
  assert.equal(track.toggleDecoration(1, 'RING_OF_FIRE'), false);
  assert.equal(track.decorationAt(1), null);
});

test('decorations stay aligned with pieces through insert and delete', () => {
  const track = new Track();
  ['STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
  track.toggleDecoration(2, 'RING_OF_FIRE'); // decorate the third straight
  // Insert a straight at index 1: the decoration should ride along to index 3.
  track.insertAt(1, 'STRAIGHT');
  assert.equal(track.decorationAt(3), 'RING_OF_FIRE');
  assert.equal(track.decorations.length, track.pieces.length);
  // Delete index 0: decoration shifts to index 2.
  track.deleteAt(0);
  assert.equal(track.decorationAt(2), 'RING_OF_FIRE');
  assert.equal(track.decorations.length, track.pieces.length);
});

test('replacing a decorated piece with an incompatible type drops the decoration', () => {
  const track = new Track();
  ['STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
  track.toggleDecoration(0, 'RING_OF_FIRE');
  track.replaceAt(0, 'LOOP'); // loops can't carry a ring
  assert.equal(track.decorationAt(0), null);
});

test('decorations round-trip through toJSON/fromJSON (and legacy saves load cleanly)', () => {
  const track = new Track();
  ['STRAIGHT', 'RAMP_UP', 'FINISH'].forEach((id) => track.addPiece(id));
  track.toggleDecoration(1, 'RING_OF_FIRE');
  const json = track.toJSON();
  assert.deepEqual(json.decorations, [null, 'RING_OF_FIRE', null]);

  const reloaded = new Track();
  reloaded.fromJSON(json);
  assert.equal(reloaded.decorationAt(1), 'RING_OF_FIRE');

  // Legacy save (no decorations field) loads with an all-null aligned array.
  const legacy = new Track();
  legacy.fromJSON({ dropHeight: 3, pieces: ['STRAIGHT', 'FINISH'] });
  assert.equal(legacy.decorations.length, 2);
  assert.deepEqual(legacy.decorations, [null, null]);
});

test('ring of fire adds excitement to the score', () => {
  const track = new Track();
  ['STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
  const before = designScore(track);
  track.toggleDecoration(0, 'RING_OF_FIRE');
  const after = designScore(track);
  assert.ok(after > before, 'ring should raise the design score');
  // And it flows through the run score too.
  const sim = new Simulator(track);
  let steps = 0;
  while (sim.isRunning() && steps++ < 20000) sim.step(1 / 240);
  const scored = computeScore(track, sim);
  assert.ok(scored.breakdown.excitement >= 12, 'ring excitement counted in the run score');
});
