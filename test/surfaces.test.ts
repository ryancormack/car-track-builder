// Tests for laid surfaces (ice / gravel) — the per-piece modifier applied by
// arming a surface in the palette strip or by the selection-bar chips.
//
// Three things are worth guarding, and one of them is subtle:
//   1. `canModify` must stay in step with the CATALOGUE. Its exclusion list is a
//      claim about each sampler's geometry ("the car goes inverted or airborne
//      here"), so the guard below MEASURES the inverting half from the samplers
//      rather than restating the list. A literal list restated in a test is how
//      physics.ts's isRampGrade/isHill once passed green while silently missing
//      seven pieces. The BALLISTIC half (the two jumps) is not measurable this
//      way and is asserted separately, by name.
//   2. The surfaces array must stay index-aligned with `pieces` through every
//      mutation, exactly as `decorations` does.
//   3. A gravelled piece must still be CLEARABLE within the game's own energy
//      budget, or a player could build a section no car can pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Simulator } from '../src/physics.js';
import { trackFrames } from '../src/pieces/frames.js';
import {
  PIECES, SURFACES, SURFACE_ORDER, canModify, canDecorate, isSurfaceId,
} from '../src/pieces/index.js';
import { MAX_DROP_HEIGHT, ICE_FRICTION_MULT, GRAVEL_FRICTION_MULT } from '../src/constants.js';
import type { PieceId, SurfaceId } from '../src/types.js';

function trackOf(ids: string[], dropHeight = 3): Track {
  const t = new Track();
  t.dropHeight = dropHeight;
  for (const id of ids) t.addPiece(id);
  return t;
}

function runToCompletion(sim: Simulator, maxSteps = 8000): void {
  let steps = 0;
  while (sim.isRunning() && steps++ < maxSteps) sim.step(1 / 240);
}

const ALL_IDS = Object.keys(PIECES) as PieceId[];

/**
 * Measure whether a piece rolls the car past horizontal, from its own sampler —
 * the INVERTING half of the property `canModify`'s exclusion list encodes.
 * `up.z` dropping below horizontal means the car is being rolled over.
 *
 * This says nothing about the ballistic pieces: a jump keeps the car upright
 * while it leaves the road entirely, so those are asserted by name below.
 */
function measureInverts(id: PieceId): boolean {
  let minUpZ = Infinity;
  for (const f of trackFrames(PIECES[id].pathLocal, { gx: 0, gy: 0, gz: 60, dir: 1 }, 400)) {
    minUpZ = Math.min(minUpZ, f.up.z);
  }
  // Comfortably below vertical-wall (0) — a banked turn stays well above this.
  return minUpZ < -0.2;
}

// ---------- 1. The guard tracks the catalogue ----------

test('catalogue is well-formed: SURFACE_ORDER covers every surface exactly once', () => {
  const keys = Object.keys(SURFACES).sort();
  assert.deepEqual([...SURFACE_ORDER].sort(), keys, 'SURFACE_ORDER lists every surface once');
  assert.equal(new Set(SURFACE_ORDER).size, SURFACE_ORDER.length, 'no duplicates');
  for (const id of SURFACE_ORDER) {
    const s = SURFACES[id];
    assert.equal(s.id, id, 'id matches its key');
    assert.ok(s.name.length > 0, `${id} has a name`);
    assert.ok(s.icon.length > 0, `${id} has an icon`);
    assert.ok(s.blurb.length > 0, `${id} has a blurb`);
    assert.ok(s.frictionMult > 0, `${id} friction multiplier is positive`);
  }
});

test('isSurfaceId narrows correctly', () => {
  assert.equal(isSurfaceId('ICE'), true);
  assert.equal(isSurfaceId('GRAVEL'), true);
  assert.equal(isSurfaceId('LAVA'), false);
  assert.equal(isSurfaceId(''), false);
});

test('ice reduces friction and gravel increases it (the whole point)', () => {
  assert.ok(ICE_FRICTION_MULT < 1, 'ice must be slipperier than plain track');
  assert.ok(GRAVEL_FRICTION_MULT > 1, 'gravel must be draggier than plain track');
  assert.equal(SURFACES.ICE.frictionMult, ICE_FRICTION_MULT);
  assert.equal(SURFACES.GRAVEL.frictionMult, GRAVEL_FRICTION_MULT);
});

test('canModify excludes exactly the inverting pieces, measured from their samplers', () => {
  for (const id of ALL_IDS) {
    if (!measureInverts(id)) continue;
    assert.equal(
      canModify(id), false,
      `${id} rolls the car past horizontal (measured) but canModify() allows a surface on it`,
    );
  }
});

test('canModify excludes meta, booster and brake pieces from their own fields', () => {
  for (const id of ALL_IDS) {
    const p = PIECES[id];
    if (p.isStart || p.isFinish) {
      assert.equal(canModify(id), false, `${id} is a meta piece and cannot be surfaced`);
    }
    if (p.boostEnergy !== 0) {
      assert.equal(canModify(id), false, `${id} changes speed by design and cannot be surfaced`);
    }
  }
});

test('canModify excludes the ballistic and barrier pieces, which no measurement catches', () => {
  // Stated by name precisely because the up-vector guard above cannot see these:
  // a jump keeps the car upright while it leaves the road, and the Wall and
  // Crumbling Bridge gate on their own constants rather than on minV2.
  for (const id of ['JUMP', 'GIANT_JUMP', 'WALL', 'CRUMBLE_BRIDGE'] as PieceId[]) {
    assert.equal(canModify(id), false, `${id} must not be surfaceable`);
  }
});

test('canModify is much wider than canDecorate, and covers the climbs and coils', () => {
  const surfaceable = ALL_IDS.filter((id) => canModify(id));
  const decoratable = ALL_IDS.filter((id) => canDecorate(id));
  assert.ok(
    surfaceable.length > decoratable.length * 2,
    `surfaces should apply far more widely than decorations (${surfaceable.length} vs ${decoratable.length})`,
  );
  // The cases that motivated the feature: an icy climb and an icy bend. If a
  // refactor narrows the guard back to the decoration set, these fail by name.
  for (const id of ['STRAIGHT', 'CURVE_L', 'RAMP_UP', 'RAMP_DN', 'HELIX_UP', 'SPIRAL'] as PieceId[]) {
    assert.equal(canModify(id), true, `${id} should be able to carry a surface`);
  }
});

test('a gated piece can still be surfaced — the gate is tested before the surface applies', () => {
  // Guards the reasoning in canModify's comment: entry gates stay valid because
  // minV2 is checked on entry v², which a surface never touches.
  const gated = ALL_IDS.filter((id) => PIECES[id].minV2 > 0 && canModify(id));
  assert.ok(gated.length > 0, 'at least one gated piece should remain surfaceable');
});

// ---------- 2. Physics: the surface actually changes the run ----------

test('gravel scrubs speed and ice preserves it, over an identical track', () => {
  const ids = ['START', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH'];
  const surfaced = (surface: SurfaceId | null): number => {
    const t = trackOf(ids);
    for (let i = 0; i < t.pieces.length; i++) {
      if (canModify(t.pieces[i])) t.setSurface(i, surface);
    }
    const sim = new Simulator(t);
    runToCompletion(sim);
    assert.ok(sim.finished, `${surface ?? 'plain'} run should finish`);
    return sim.speed;
  };

  const plain = surfaced(null);
  const ice = surfaced('ICE');
  const gravel = surfaced('GRAVEL');

  assert.ok(ice > plain, `ice should hold more speed than plain (${ice} vs ${plain})`);
  assert.ok(gravel < plain, `gravel should shed more speed than plain (${gravel} vs ${plain})`);
});

test('a surface on one piece only affects that piece', () => {
  // Two identical tracks; the second has gravel on a single middle piece. The
  // divergence must appear only once the car reaches it.
  const ids = ['START', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH'];
  const plainTrack = trackOf(ids);
  const oneGravel = trackOf(ids);
  assert.equal(oneGravel.setSurface(2, 'GRAVEL'), true, 'middle piece takes gravel');

  const a = new Simulator(plainTrack);
  const b = new Simulator(oneGravel);
  // Step both while still on piece index 1: speeds must match exactly.
  while (a.pieceIndex < 2 && a.isRunning() && b.isRunning()) {
    a.step(1 / 240);
    b.step(1 / 240);
  }
  assert.equal(b.speed, a.speed, 'before the gravelled piece the runs are identical');

  runToCompletion(a);
  runToCompletion(b);
  assert.ok(b.speed < a.speed, 'after the gravelled piece the surfaced run is slower');
});

// ---------- 3. Lifecycle: surfaces stay aligned with pieces ----------

test('surfaces stay index-aligned through insert, delete, undo and clear', () => {
  const t = trackOf(['START', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT']);
  assert.equal(t.surfaces.length, t.pieces.length, 'aligned after appends');

  t.setSurface(2, 'ICE');
  assert.equal(t.surfaceAt(2), 'ICE');

  // Insert BEFORE the icy piece: the surface must travel with its piece.
  assert.equal(t.insertAt(1, 'STRAIGHT'), true);
  assert.equal(t.surfaces.length, t.pieces.length, 'aligned after insert');
  assert.equal(t.surfaceAt(3), 'ICE', 'the icy piece shifted right with its surface');
  assert.equal(t.surfaceAt(1), null, 'the newly inserted piece is plain');

  // Delete that inserted piece: the surface must shift back.
  t.deleteAt(1);
  assert.equal(t.surfaces.length, t.pieces.length, 'aligned after delete');
  assert.equal(t.surfaceAt(2), 'ICE', 'the icy piece shifted back with its surface');

  t.undo();
  assert.equal(t.surfaces.length, t.pieces.length, 'aligned after undo');

  t.clear();
  assert.equal(t.surfaces.length, 0, 'cleared with the pieces');
});

test('replaceAt KEEPS the surface — it describes the stretch, not the piece', () => {
  const t = trackOf(['START', 'STRAIGHT', 'FINISH']);
  t.setSurface(1, 'GRAVEL');
  // A climb rather than a descent: RAMP_DN from the build plane would breach the
  // floor rule and be rejected for reasons unrelated to surfaces.
  assert.equal(t.replaceAt(1, 'RAMP_UP'), true, 'swap the straight for a climb');
  assert.equal(t.surfaceAt(1), 'GRAVEL', 'the section is still gravelled after the swap');
});

test('replaceAt drops the surface when the new piece cannot carry one', () => {
  const t = trackOf(['START', 'STRAIGHT', 'FINISH']);
  t.setSurface(1, 'ICE');
  assert.equal(canModify('BOOSTER'), false, 'precondition: a booster cannot be surfaced');
  assert.equal(t.replaceAt(1, 'BOOSTER'), true);
  assert.equal(t.surfaceAt(1), null, 'the surface was dropped with the incompatible swap');
});

test('setSurface refuses a piece that cannot carry a surface', () => {
  const t = trackOf(['START', 'LOOP', 'FINISH']);
  assert.equal(t.setSurface(1, 'ICE'), false, 'a loop cannot be iced');
  assert.equal(t.surfaceAt(1), null);
  assert.equal(t.setSurface(99, 'ICE'), false, 'out-of-range index is refused');
});

test('setSurface reports no-ops rather than claiming a change', () => {
  const t = trackOf(['START', 'STRAIGHT', 'FINISH']);
  assert.equal(t.setSurface(1, 'ICE'), true, 'first write changes the track');
  assert.equal(t.setSurface(1, 'ICE'), false, 'same value again is a no-op');
  assert.equal(t.setSurface(1, null), true, 'clearing changes the track');
  assert.equal(t.setSurface(1, null), false, 'clearing again is a no-op');
});

// ---------- Serialization ----------

test('surfaces round-trip through toJSON / fromJSON', () => {
  const t = trackOf(['START', 'STRAIGHT', 'CURVE_L', 'FINISH']);
  t.setSurface(1, 'ICE');
  t.setSurface(2, 'GRAVEL');

  const loaded = new Track();
  loaded.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.deepEqual(loaded.pieces, t.pieces);
  assert.deepEqual(loaded.surfaces, t.surfaces);
});

test('a legacy save with no surfaces field loads as all-plain', () => {
  const loaded = new Track();
  loaded.fromJSON({ dropHeight: 3, pieces: ['START', 'STRAIGHT', 'FINISH'] });
  assert.equal(loaded.surfaces.length, loaded.pieces.length, 'array is still aligned');
  assert.ok(loaded.surfaces.every((s) => s === null), 'every piece loads plain');
});

test('fromJSON rejects unknown ids and surfaces on incompatible pieces', () => {
  const loaded = new Track();
  loaded.fromJSON({
    dropHeight: 3,
    pieces: ['START', 'STRAIGHT', 'LOOP', 'FINISH'],
    // index 1 valid, index 2 is a loop (cannot be surfaced), index 3 is junk.
    surfaces: ['ICE', 'ICE', 'ICE', 'LAVA'],
  });
  assert.equal(loaded.surfaceAt(0), null, 'START cannot carry a surface');
  assert.equal(loaded.surfaceAt(1), 'ICE', 'the valid entry survives');
  assert.equal(loaded.surfaceAt(2), null, 'the loop is stripped');
  assert.equal(loaded.surfaceAt(3), null, 'the unknown id is stripped');
});

// ---------- 4. Clearability: gravel must never make a piece impassable ----------

test('gravel never makes a piece impassable that was passable plain', () => {
  // "Impassable" has to be judged across the budgets the game can actually
  // produce, not at maximum energy: CORNER_MAX_V2 is pinned just above a full
  // drop, so max drop PLUS a launchpad throws the car off a flat corner whether
  // it is gravelled or not. The honest question is therefore comparative — if
  // some legal budget clears the piece plain, some legal budget must clear it
  // gravelled too.
  const budgets: { drop: number; launch: boolean }[] = [
    { drop: 1, launch: false },
    { drop: 3, launch: false },
    { drop: MAX_DROP_HEIGHT, launch: false },
    { drop: MAX_DROP_HEIGHT, launch: true },
  ];

  const clearsSomehow = (id: PieceId, surface: SurfaceId | null): boolean => {
    for (const b of budgets) {
      const t = new Track();
      t.dropHeight = b.drop;
      t.addPiece('START');
      if (b.launch) t.addPiece('LAUNCHPAD');
      if (!t.addPiece(id)) continue; // geometry cannot place it in this stub track
      const idx = t.pieces.length - 1;
      t.addPiece('FINISH');
      if (surface !== null && !t.setSurface(idx, surface)) continue;
      const sim = new Simulator(t);
      runToCompletion(sim);
      if (sim.finished) return true;
    }
    return false;
  };

  const surfaceable = ALL_IDS.filter(
    (id) => canModify(id) && !PIECES[id].isStart && !PIECES[id].isFinish,
  );
  assert.ok(surfaceable.length > 0, 'precondition: there are surfaceable pieces');

  const regressions: string[] = [];
  for (const id of surfaceable) {
    if (!clearsSomehow(id, null)) continue; // not passable plain either; not ours
    if (!clearsSomehow(id, 'GRAVEL')) regressions.push(id);
  }
  assert.deepEqual(
    regressions, [],
    `gravel made these pieces impassable at every legal budget: ${regressions.join(', ')}`,
  );
});
