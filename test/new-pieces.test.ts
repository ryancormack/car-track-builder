// Tests for the new track parts: steep ramps, wide turns, the smash wall, and
// the ring-of-fire decoration.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pathSteepRampUp, pathSteepRampDown, pathRampUp,
  pathWideR2, pathWideL2, pathWideR3, pathWideL3, pathTopHat,
  pathChicaneR, pathChicaneL,
  pathSwitchbackR, pathSwitchbackL,
} from '../src/pieces/paths.js';
import { PIECES, PALETTE_GROUPS, canDecorate } from '../src/pieces/definitions.js';
import { applyPiece, localToWorld } from '../src/pieces/geometry.js';
import { trackFrames } from '../src/pieces/frames.js';
import { resolvePathLocal } from '../src/pieces/resolve.js';
import { Track } from '../src/track.js';
import { Simulator } from '../src/physics.js';
import { computeScore, designScore } from '../src/scoring.js';
import { WALL_SMASH_V2, CRUMBLE_BRIDGE_V2, G } from '../src/constants.js';
import type { GridState, PieceId } from '../src/types.js';

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

// Chaining: consecutive ramps of the SAME type must form one continuous slope,
// with no flat-spot "bump" at the shared joints (the bug in the screenshot).
test('consecutive steep ramps chain into one continuous slope (no bump)', () => {
  const pieces: PieceId[] = ['STRAIGHT', 'STEEP_RAMP_UP', 'STEEP_RAMP_UP', 'STEEP_RAMP_UP', 'STRAIGHT'];
  const d = 1e-3;
  // Interior ramp (index 2): both neighbours are the same ramp, so it should be
  // a straight constant-grade segment (slope = dz/dt = 2) at BOTH ends.
  const mid = resolvePathLocal(pieces, 2);
  const slopeStart = (mid(d).lz - mid(0).lz) / d;
  const slopeEnd = (mid(1).lz - mid(1 - d).lz) / d;
  assert.ok(Math.abs(slopeStart - 2) < 0.05, `interior enters at slope 2, got ${slopeStart.toFixed(3)}`);
  assert.ok(Math.abs(slopeEnd - 2) < 0.05, `interior exits at slope 2, got ${slopeEnd.toFixed(3)}`);
  // First ramp (index 1): eases in from the flat straight, but exits at full slope
  // (no ease) so it meets the next ramp with matching grade.
  const first = resolvePathLocal(pieces, 1);
  assert.ok(Math.abs((first(d).lz - first(0).lz) / d) < 0.05, 'first ramp eases in from flat');
  assert.ok(Math.abs((first(1).lz - first(1 - d).lz) / d - 2) < 0.05, 'first ramp exits at full slope');
});

test('chained ramp joints have matching slopes on both sides (up and steep)', () => {
  const d = 1e-3;
  for (const [id, slope] of [['RAMP_UP', 1], ['STEEP_RAMP_UP', 2], ['STEEP_RAMP_DN', -2]] as const) {
    const pieces: PieceId[] = [id, id];
    const a = resolvePathLocal(pieces, 0); // eases in, no ease out
    const b = resolvePathLocal(pieces, 1); // no ease in, eases out
    const exitA = (a(1).lz - a(1 - d).lz) / d;
    const entryB = (b(d).lz - b(0).lz) / d;
    assert.ok(Math.abs(exitA - entryB) < 0.05, `${id} joint slope mismatch: ${exitA} vs ${entryB}`);
    assert.ok(Math.abs(exitA - slope) < 0.05, `${id} joint should be full grade ${slope}, got ${exitA}`);
  }
});

// --- Wide turns ---------------------------------------------------------------

// A wide turn is a true circular quarter-arc of radius R = forward-0.5 that
// advances DIAGONALLY. Its path ends at local (R, ±R) heading along the exit
// axis, and applyPiece advances entryAdvance=forward-1 along the entry axis and
// forward along the exit axis, so the path endpoint lands exactly on the next
// piece's entry midpoint (no gap, no kink).
test('wide turns are circular quarter-arcs ending at (R, ±R)', () => {
  const cases: [(t: number) => { lx: number; ly: number; lz: number }, number, number][] = [
    [pathWideR2, 2, 1], [pathWideL2, 2, -1], [pathWideR3, 3, 1], [pathWideL3, 3, -1],
  ];
  for (const [fn, forward, sign] of cases) {
    const R = forward - 0.5;
    const s = fn(0), e = fn(1);
    assert.ok(Math.abs(s.lx) < 1e-9 && Math.abs(s.ly) < 1e-9, 'starts at origin');
    assert.ok(Math.abs(e.lx - R) < 1e-6, `ends at lx=R=${R}, got ${e.lx}`);
    assert.ok(Math.abs(e.ly - sign * R) < 1e-6, `ends at ly=${sign * R}, got ${e.ly}`);
    // Constant radius: every sample sits on the circle centred at (0, ±R).
    for (let i = 0; i <= 50; i++) {
      const p = fn(i / 50);
      const dist = Math.hypot(p.lx - 0, p.ly - sign * R);
      assert.ok(Math.abs(dist - R) < 1e-6, `point ${i} off the circle (r=${dist})`);
    }
  }
});

test('wide turns connect with no gap: path end maps onto the next entry midpoint', () => {
  // STRAIGHT -> WIDE_R_2 -> STRAIGHT. The wide turn's local path end, mapped to
  // world, must equal the next piece's entry midpoint (its local origin).
  for (const wide of ['WIDE_R_2', 'WIDE_L_2', 'WIDE_R_3', 'WIDE_L_3'] as PieceId[]) {
    const track = new Track();
    ['STRAIGHT', wide, 'STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
    const entry = track.entryStateAt(1);      // entry state of the wide turn
    const nextEntry = track.entryStateAt(2);  // entry state of the following straight
    const end = PIECES[wide].pathLocal(1);
    const endWorld = localToWorld(entry, end.lx, end.ly, end.lz);
    const nextMid = localToWorld(nextEntry, 0, 0, 0);
    assert.ok(Math.abs(endWorld.wx - nextMid.wx) < 1e-6 && Math.abs(endWorld.wy - nextMid.wy) < 1e-6,
      `${wide} seam gap: end=(${endWorld.wx},${endWorld.wy}) next=(${nextMid.wx},${nextMid.wy})`);
  }
});

test('wide turns advance diagonally on the grid; the standard curve does not', () => {
  // Standard curve: forward 0 along entry axis (entryAdvance unset -> 0).
  assert.ok(!PIECES.CURVE_R.entryAdvance, 'CURVE_R should not advance along the entry axis');
  assert.equal(PIECES.WIDE_R_2.entryAdvance, 1);
  assert.equal(PIECES.WIDE_R_3.entryAdvance, 2);

  // From East at origin, WIDE_R_2 should land 1 cell East and 2 cells South.
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  const exit = applyPiece(start, PIECES.WIDE_R_2);
  assert.deepEqual(
    { gx: exit.gx, gy: exit.gy, dir: exit.dir },
    { gx: 1, gy: 2, dir: 2 },
    'WIDE_R_2 advances diagonally (1 East, 2 South) and faces South',
  );
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


// --- Grounding limit (floor at the build plane, gz = 0) ----------------------

test('grounding: nothing can be built below the ground (gz=0), regardless of drop height', () => {
  for (const drop of [0, 3, 6]) {
    const t = new Track();
    t.dropHeight = drop;
    // A descent straight from the start would sink below gz 0 -> always rejected,
    // consistently at every drop height (drop height no longer moves the floor).
    assert.equal(t.addPiece('RAMP_DN'), false, `RAMP_DN from ground rejected at drop ${drop}`);
    assert.equal(t.addPiece('SPIRAL'), false, `SPIRAL from ground rejected at drop ${drop}`);
    assert.equal(t.addPiece('STEEP_RAMP_DN'), false, `STEEP_RAMP_DN from ground rejected at drop ${drop}`);
  }
});

test('grounding: descents are allowed once the track is above the ground', () => {
  const t = new Track();
  t.dropHeight = 3;
  assert.ok(t.addPiece('RAMP_UP'), 'climb to gz 1');
  assert.ok(t.addPiece('RAMP_DN'), 'descend back to gz 0 (at/above ground)');
  assert.equal(t.pieces.length, 2);
  // But descending past the ground is still rejected.
  const t2 = new Track();
  t2.dropHeight = 6;
  assert.ok(t2.addPiece('RAMP_UP')); // gz 1
  assert.equal(t2.addPiece('SPIRAL'), false, 'SPIRAL (-2) from gz 1 would hit gz -1');
});

// --- Water Splash decoration --------------------------------------------------

test('water splash is a valid decoration: toggles, scores, and round-trips', () => {
  const t = new Track();
  ['STRAIGHT', 'FINISH'].forEach((id) => t.addPiece(id));
  const before = designScore(t);
  assert.equal(t.toggleDecoration(0, 'WATER_SPLASH'), true);
  assert.equal(t.decorationAt(0), 'WATER_SPLASH');
  assert.ok(designScore(t) > before, 'water splash adds excitement');
  const reloaded = new Track();
  reloaded.fromJSON(t.toJSON());
  assert.equal(reloaded.decorationAt(0), 'WATER_SPLASH');
});

test('water splash only attaches to flat pieces (same rule as ring of fire)', () => {
  const t = new Track();
  ['STRAIGHT', 'LOOP', 'FINISH'].forEach((id) => t.addPiece(id));
  assert.equal(t.toggleDecoration(0, 'WATER_SPLASH'), true);  // straight OK
  assert.equal(t.toggleDecoration(1, 'WATER_SPLASH'), false); // loop rejected
});

// --- Top Hat tower (doubles back) --------------------------------------------

test('Top Hat doubles back: starts heading +x, exits reversed (-x) one lane over, and is tall', () => {
  const start = pathTopHat(0);
  const end = pathTopHat(1);
  assert.ok(Math.abs(start.lx) < 1e-9 && Math.abs(start.ly) < 1e-9 && Math.abs(start.lz) < 1e-9, 'starts at origin');
  assert.ok(Math.abs(end.lx) < 1e-6 && Math.abs(end.ly - 2) < 1e-6 && Math.abs(end.lz) < 1e-6,
    `ends at (0,2,0) (reversed, one lane over, back at ground), got (${end.lx},${end.ly},${end.lz})`);
  // The exit heads back the way it came (lx decreasing at the end).
  assert.ok(pathTopHat(1).lx - pathTopHat(1 - 1e-3).lx < 0, 'exit heads -x (doubled back)');
  // It climbs tall.
  let apex = 0;
  for (let i = 0; i <= 500; i++) apex = Math.max(apex, pathTopHat(i / 500).lz);
  assert.ok(apex >= 3.5, `tower should be tall, apex=${apex}`);
});

test('Top Hat exits reversed + laterally offset on the grid, and places after an approach', () => {
  // From East at the origin: exits West (dir 3), 1 cell back and 2 lanes over.
  const exit = applyPiece({ gx: 0, gy: 0, gz: 0, dir: 1 }, PIECES.TOP_HAT);
  assert.deepEqual({ gx: exit.gx, gy: exit.gy, dir: exit.dir }, { gx: -1, gy: 2, dir: 3 });
  // Placeable after a straight approach — the offset return lane avoids folding
  // back on top of the approach track (no self-overlap).
  const t = new Track();
  ['STRAIGHT', 'STRAIGHT', 'TOP_HAT', 'STRAIGHT', 'FINISH'].forEach(
    (id) => assert.ok(t.addPiece(id), `should place ${id}`),
  );
});

test('Top Hat keeps the car upright (never inverts) and demands real entry speed', () => {
  let minUpZ = 1;
  const frames = trackFrames(PIECES.TOP_HAT.pathLocal, { gx: 0, gy: 0, gz: 0, dir: 1 }, 240);
  for (const f of frames) {
    assert.ok(Number.isFinite(f.up.x + f.up.y + f.up.z), 'frame finite');
    minUpZ = Math.min(minUpZ, f.up.z);
  }
  assert.ok(minUpZ > 0, `car should never invert (up.z stays > 0); got ${minUpZ.toFixed(3)}`);
  // Tall climb -> a much higher gate than a single ramp.
  assert.ok(PIECES.TOP_HAT.minV2 > 2 * PIECES.RAMP_UP.minV2, 'top hat needs a tall drop or a booster');
});


// --- Banked turns -------------------------------------------------------------

test('banked turns share the standard curve footprint but are not overspeed-gated', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  // Same grid transition as the tight curve (forward 1, ±90°).
  assert.deepEqual(applyPiece(start, PIECES.BANK_R), applyPiece(start, PIECES.CURVE_R));
  assert.deepEqual(applyPiece(start, PIECES.BANK_L), applyPiece(start, PIECES.CURVE_L));
  // No overspeed gate (the lean lets you take them flat out).
  assert.equal(PIECES.BANK_R.minV2, 0);
  assert.equal(PIECES.BANK_L.minV2, 0);
});

test('banked turns lean into the turn (road rolls toward the inside)', () => {
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  // BANK_R curves toward +y (inside +y) → the road's up should tilt toward +y.
  const fr = trackFrames(PIECES.BANK_R.pathLocal, entry, 80);
  const mid = fr[Math.floor(fr.length / 2)];
  assert.ok(mid.up.y > 0.1, `banked-right up should lean toward +y, got ${mid.up.y.toFixed(2)}`);
  assert.ok(mid.up.z > 0.5, 'still mostly upright');
  // BANK_L leans the other way.
  const frL = trackFrames(PIECES.BANK_L.pathLocal, entry, 80);
  assert.ok(frL[Math.floor(frL.length / 2)].up.y < -0.1, 'banked-left leans toward -y');
  // Level at the seams so it joins flat track cleanly.
  assert.ok(Math.abs(fr[0].up.z - 1) < 1e-6 && Math.abs(fr[fr.length - 1].up.z - 1) < 1e-6);
});

test('a banked turn survives booster-level speed that throws a normal curve off', () => {
  const bank = new Track(); bank.dropHeight = 6;
  ['STRAIGHT', 'BOOSTER', 'BANK_R', 'FINISH'].forEach((id) => bank.addPiece(id));
  const sb = new Simulator(bank); let n = 0;
  while (sb.isRunning() && n++ < 40000) sb.step(1 / 240);
  assert.ok(!sb.failed, `banked turn should hold at speed: ${sb.failReason}`);
  // The same speed flings a standard curve off (overspeed).
  const curve = new Track(); curve.dropHeight = 6;
  ['STRAIGHT', 'BOOSTER', 'CURVE_R', 'FINISH'].forEach((id) => curve.addPiece(id));
  const sc = new Simulator(curve); let m = 0;
  while (sc.isRunning() && m++ < 40000) sc.step(1 / 240);
  assert.equal(sc.failType, 'overspeed_corner', 'a normal curve should overspeed at this speed');
});

// --- Chicane / S-bend ---------------------------------------------------------

test('chicane shifts one lane sideways and keeps the same heading', () => {
  for (const [fn, sign] of [[pathChicaneR, 1], [pathChicaneL, -1]] as const) {
    const s = fn(0), e = fn(1);
    assert.ok(Math.abs(s.lx) < 1e-9 && Math.abs(s.ly) < 1e-9, 'starts at origin');
    assert.ok(Math.abs(e.lx - 2) < 1e-6 && Math.abs(e.ly - sign) < 1e-6, `ends 2 forward, ${sign} sideways`);
    // Heading is +x at both ends (lateral slope ~0 at the seams).
    assert.ok(Math.abs(fn(0.001).ly - fn(0).ly) < 1e-3, 'enters heading +x');
    assert.ok(Math.abs(fn(1).ly - fn(0.999).ly) < 1e-3, 'exits heading +x');
  }
  // Grid: shifts to the proper lane and keeps the heading.
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  assert.deepEqual(applyPiece(start, PIECES.CHICANE_R), { gx: 2, gy: 1, gz: 0, dir: 1 });
  assert.deepEqual(applyPiece(start, PIECES.CHICANE_L), { gx: 2, gy: -1, gz: 0, dir: 1 });
});

// --- Launchpad ----------------------------------------------------------------

test('launchpad climbs and boosts harder than a booster, lifting a slow car', () => {
  assert.equal(PIECES.LAUNCHPAD.dz, 2, 'climbs 2 units');
  assert.ok(PIECES.LAUNCHPAD.boostEnergy > PIECES.BOOSTER.boostEnergy, 'stronger than a booster');
  // Even from a tiny drop, the boost flings the car up and over the climb.
  const t = new Track(); t.dropHeight = 1;
  ['STRAIGHT', 'LAUNCHPAD', 'STRAIGHT', 'FINISH'].forEach((id) => assert.ok(t.addPiece(id)));
  const sim = new Simulator(t); let n = 0;
  while (sim.isRunning() && n++ < 40000) sim.step(1 / 240);
  assert.ok(!sim.failed && sim.finished, `launchpad should fling the car up: ${sim.failReason}`);
});

// --- Crumbling bridge ---------------------------------------------------------

function crumbleRun(drop: number): Simulator {
  const t = new Track(); t.dropHeight = drop;
  ['STRAIGHT', 'CRUMBLE_BRIDGE', 'STRAIGHT', 'FINISH'].forEach((id) => t.addPiece(id));
  const sim = new Simulator(t); let n = 0;
  while (sim.isRunning() && n++ < 40000) sim.step(1 / 240);
  return sim;
}

test('crumbling bridge: cross fast enough and it holds (recording the crossing)', () => {
  const sim = crumbleRun(3); // v2 = 58.8 > gate
  assert.ok(!sim.failed && sim.finished, `should cross: ${sim.failReason}`);
  assert.deepEqual(sim.crossedBridges, [1], 'records the crossed bridge for the crumble effect');
});

test('crumbling bridge: too slow and it gives way (collapse, game over)', () => {
  const sim = crumbleRun(1); // v2 = 19.6 < gate
  assert.ok(sim.failed);
  assert.equal(sim.failType, 'collapse');
  assert.equal(sim.crossedBridges.length, 0, 'nothing recorded when it collapses');
});

test('CRUMBLE_BRIDGE_V2 gate sits between a low and a moderate drop', () => {
  assert.ok(2 * G * 1 < CRUMBLE_BRIDGE_V2, 'drop 1 is below the gate');
  assert.ok(2 * G * 3 > CRUMBLE_BRIDGE_V2, 'drop 3 is above the gate');
});

// --- Zig-zag switchback ramp --------------------------------------------------

test('switchback climbs while reversing, exiting two lanes over and 2 higher', () => {
  for (const [fn, sign] of [[pathSwitchbackR, 1], [pathSwitchbackL, -1]] as const) {
    const s = fn(0), e = fn(1);
    assert.ok(Math.abs(s.lx) < 1e-9 && Math.abs(s.ly) < 1e-9 && Math.abs(s.lz) < 1e-9, 'starts at origin');
    assert.ok(Math.abs(e.lx) < 1e-6 && Math.abs(e.ly - sign * 2) < 1e-6 && Math.abs(e.lz - 2) < 1e-6,
      `ends reversed at (0, ${sign * 2}, 2), got (${e.lx},${e.ly},${e.lz})`);
  }
  // Grid: from East, exits West (dir 3), 2 lanes over and 2 up.
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  const exR = applyPiece(start, PIECES.SWITCHBACK_R);
  assert.deepEqual({ gx: exR.gx, gy: exR.gy, gz: exR.gz, dir: exR.dir }, { gx: -1, gy: 2, gz: 2, dir: 3 });
});

test('switchback stays upright, is speed-gated, and places after an approach', () => {
  let minUpZ = 1;
  for (const f of trackFrames(PIECES.SWITCHBACK_R.pathLocal, { gx: 0, gy: 0, gz: 0, dir: 1 }, 200)) {
    assert.ok(Number.isFinite(f.up.x + f.up.y + f.up.z));
    minUpZ = Math.min(minUpZ, f.up.z);
  }
  assert.ok(minUpZ > 0.4, `switchback should stay upright, got ${minUpZ.toFixed(3)}`);
  assert.ok(PIECES.SWITCHBACK_R.minV2 > 0, 'climbing switchback needs entry speed');
  // Placeable after a straight approach — the offset lane avoids self-overlap.
  const t = new Track();
  ['STRAIGHT', 'STRAIGHT', 'SWITCHBACK_R', 'STRAIGHT', 'FINISH'].forEach(
    (id) => assert.ok(t.addPiece(id), `should place ${id}`),
  );
  // Two alternating switchbacks zig-zag up: net heading restored, climbed 4.
  const z = new Track(); z.dropHeight = 6;
  ['STRAIGHT', 'BOOSTER', 'SWITCHBACK_R', 'SWITCHBACK_L', 'FINISH'].forEach((id) => assert.ok(z.addPiece(id)));
});

// --- Palette organisation -----------------------------------------------------

test('palette groups cover every non-meta piece exactly once (plus FINISH)', () => {
  const grouped = PALETTE_GROUPS.flatMap((g) => g.ids);
  // No duplicates.
  assert.equal(new Set(grouped).size, grouped.length, 'no piece appears in two groups');
  // Every catalogue piece except the hidden START is placed in a group.
  const expected = (Object.keys(PIECES) as PieceId[]).filter((id) => !PIECES[id].hidden);
  for (const id of expected) {
    assert.ok(grouped.includes(id), `${id} should appear in a palette group`);
  }
  assert.equal(grouped.length, expected.length, 'no extra/missing ids in the groups');
  // Every group has a non-empty label.
  for (const g of PALETTE_GROUPS) assert.ok(g.label.length > 0 && g.ids.length > 0);
});
