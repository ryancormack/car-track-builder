// test/coaster-elements.test.ts — the pieces added from the roller-coaster
// element vocabulary. Each one exists to fill a MECHANICAL gap, not just to add a
// shape, so these tests pin the mechanic as well as the geometry:
//
//   Dive Turn   — reverse direction while DESCENDING (the Switchback's inverse;
//                 previously no single piece gave height back while reversing).
//   Wave Turn   — a banked corner with airtime over the apex, interchangeable
//                 with a Bank and, like a Bank, exempt from the flat-corner
//                 overspeed gate.
//   Zero-G Roll — a full roll taken over a crest, as opposed to the Corkscrew's
//                 roll along flat track.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PIECES, applyPiece, localToWorld } from '../src/pieces/index.js';
import { piecePathAtT } from '../src/pieces/sampling.js';
import { trackFrames } from '../src/pieces/frames.js';
import { resolvePathLocal } from '../src/pieces/resolve.js';
import { Track } from '../src/track.js';
import { Simulator } from '../src/physics.js';
import { CORNER_MAX_V2 } from '../src/constants.js';
import type { GridState, PieceId } from '../src/types.js';

const DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
const NEW_PIECES: PieceId[] = [
  'DIVE_TURN_L', 'DIVE_TURN_R', 'WAVE_TURN_L', 'WAVE_TURN_R', 'ZERO_G_ROLL',
  'IMMELMANN', 'COBRA_ROLL',
];

function arcLength(id: PieceId, n = 8000): number {
  const p = PIECES[id].pathLocal;
  let acc = 0;
  let prev = p(0);
  for (let i = 1; i <= n; i++) {
    const q = p(i / n);
    acc += Math.hypot(q.lx - prev.lx, q.ly - prev.ly, q.lz - prev.lz);
    prev = q;
  }
  return acc;
}

test('every new piece starts and ends exactly on its seams, from any entry state', () => {
  const entries: GridState[] = [
    { gx: 0, gy: 0, gz: 0, dir: 1 },
    { gx: 3, gy: -2, gz: 4, dir: 0 },
    { gx: -5, gy: 7, gz: 2, dir: 2 },
    { gx: 9, gy: 9, gz: 6, dir: 3 },
  ];
  for (const id of NEW_PIECES) {
    const piece = PIECES[id];
    for (const entry of entries) {
      const startMid = localToWorld(entry, 0, 0, 0);
      const s = piecePathAtT(piece.pathLocal, entry, 0);
      assert.ok(
        Math.hypot(s.wx - startMid.wx, s.wy - startMid.wy, s.wz - startMid.wz) < 1e-9,
        `${id} does not start at its entry midpoint (dir ${entry.dir})`,
      );
      const next = applyPiece(entry, piece);
      const nextMid = localToWorld(next, 0, 0, 0);
      const e = piecePathAtT(piece.pathLocal, entry, 1);
      assert.ok(
        Math.hypot(e.wx - nextMid.wx, e.wy - nextMid.wy, e.wz - nextMid.wz) < 1e-9,
        `${id} path end does not meet the next piece's entry (dir ${entry.dir})`,
      );
    }
  }
});

test('every new piece exits along the heading applyPiece claims', () => {
  const entry: GridState = { gx: 2, gy: 3, gz: 5, dir: 1 };
  for (const id of NEW_PIECES) {
    const piece = PIECES[id];
    const a = piecePathAtT(piece.pathLocal, entry, 1 - 1e-4);
    const b = piecePathAtT(piece.pathLocal, entry, 1);
    const m = Math.hypot(b.wx - a.wx, b.wy - a.wy) || 1;
    const d = DIRS[applyPiece(entry, piece).dir];
    const dot = ((b.wx - a.wx) / m) * d.dx + ((b.wy - a.wy) / m) * d.dy;
    assert.ok(dot > 0.999, `${id} exit tangent disagrees with its exit heading (dot ${dot.toFixed(4)})`);
  }
});

test('every new piece declares its true arc length', () => {
  for (const id of NEW_PIECES) {
    const measured = arcLength(id);
    const declared = PIECES[id].pathLen;
    assert.ok(
      Math.abs(measured - declared) < 0.02,
      `${id} declares pathLen ${declared} but measures ${measured.toFixed(3)}`,
    );
  }
});

// --- Dive Turn: the descending reversal --------------------------------------

test('Dive Turn is the Switchback mirrored in elevation — same hairpin, dropping', () => {
  for (const [dive, back] of [
    ['DIVE_TURN_L', 'SWITCHBACK_L'], ['DIVE_TURN_R', 'SWITCHBACK_R'],
  ] as const) {
    const d = PIECES[dive], s = PIECES[back];
    assert.equal(d.turn, s.turn, 'same 180° reversal');
    assert.equal(d.sideAdvance, s.sideAdvance, 'same lane offset');
    assert.equal(d.forward, s.forward, 'same footprint');
    assert.equal(d.dz, -s.dz, 'opposite elevation change');
    assert.equal(d.pathLen, s.pathLen, 'same arc, so same length');
  }
});

test('Dive Turn reverses heading and loses 2 elevation', () => {
  const entry: GridState = { gx: 0, gy: 0, gz: 4, dir: 1 };
  for (const id of ['DIVE_TURN_L', 'DIVE_TURN_R'] as const) {
    const next = applyPiece(entry, PIECES[id]);
    assert.equal(next.dir, 3, `${id} should exit heading West after entering East`);
    assert.equal(next.gz, 2, `${id} should drop 2`);
  }
  // Left and right land in opposite lanes.
  assert.equal(applyPiece(entry, PIECES.DIVE_TURN_L).gy, -2);
  assert.equal(applyPiece(entry, PIECES.DIVE_TURN_R).gy, 2);
});

test('Dive Turn needs no entry speed — it gives height back rather than spending it', () => {
  for (const id of ['DIVE_TURN_L', 'DIVE_TURN_R'] as const) {
    assert.equal(PIECES[id].minV2, 0, `${id} should be ungated`);
  }
  assert.ok(PIECES.SWITCHBACK_R.minV2 > 0, 'the climbing twin stays gated');
});

test('a Switchback then a Dive Turn returns to the original height and heading', () => {
  const t = new Track();
  t.dropHeight = 8;
  // Climb with a switchback, come back down with the mirrored dive turn.
  for (const id of ['STRAIGHT', 'BOOSTER', 'SWITCHBACK_R', 'DIVE_TURN_L'] as PieceId[]) {
    assert.ok(t.addPiece(id), `could not place ${id}`);
  }
  const end = t.computeEntryAt(t.pieces.length);
  const start = t.startState;
  assert.equal(end.gz, start.gz, 'net elevation should be back to the start');
  assert.equal(end.dir, start.dir, 'net heading should be back to the start');
});

test('a car actually completes a Dive Turn and gains speed doing it', () => {
  const t = new Track();
  t.dropHeight = 6;
  for (const id of ['STRAIGHT', 'RAMP_UP', 'RAMP_UP', 'DIVE_TURN_R', 'STRAIGHT', 'FINISH'] as PieceId[]) {
    assert.ok(t.addPiece(id), `could not place ${id}`);
  }
  const sim = new Simulator(t);
  let entrySpeed = -1;
  let exitSpeed = -1;
  let guard = 0;
  while (sim.isRunning() && guard++ < 200000) {
    if (sim.pieceIndex === 3 && entrySpeed < 0) entrySpeed = sim.v2;
    if (sim.pieceIndex === 4 && exitSpeed < 0) exitSpeed = sim.v2;
    sim.step(0.002);
  }
  assert.ok(!sim.failed, `run should not fail: ${sim.failReason ?? ''}`);
  assert.ok(entrySpeed > 0 && exitSpeed > 0, 'should have sampled both sides of the dive turn');
  assert.ok(exitSpeed > entrySpeed, `descending turn should add speed (${entrySpeed.toFixed(1)} -> ${exitSpeed.toFixed(1)})`);
});

// --- Wave Turn: the airtime corner -------------------------------------------

test('Wave Turn is interchangeable with a Bank — same footprint and endpoints', () => {
  for (const [wave, bank] of [['WAVE_TURN_L', 'BANK_L'], ['WAVE_TURN_R', 'BANK_R']] as const) {
    const w = PIECES[wave], b = PIECES[bank];
    assert.equal(w.turn, b.turn);
    assert.equal(w.forward, b.forward);
    assert.equal(w.dz, b.dz, 'both exit level');
    const entry: GridState = { gx: 1, gy: 1, gz: 3, dir: 2 };
    assert.deepEqual(applyPiece(entry, w), applyPiece(entry, b), 'same exit state');
  }
});

test('Wave Turn lifts over a crest and comes back down level', () => {
  for (const id of ['WAVE_TURN_L', 'WAVE_TURN_R'] as const) {
    const p = PIECES[id].pathLocal;
    assert.ok(Math.abs(p(0).lz) < 1e-9, `${id} should start level`);
    assert.ok(Math.abs(p(1).lz) < 1e-9, `${id} should end level`);
    const crest = p(0.5).lz;
    assert.ok(crest > 0.3, `${id} should have a real hump, got ${crest.toFixed(3)}`);
    // The airtime is what distinguishes it from a plain Bank.
    assert.ok(Math.abs(PIECES[id === 'WAVE_TURN_L' ? 'BANK_L' : 'BANK_R'].pathLocal(0.5).lz) < 1e-9);
  }
});

test('Wave Turn leans harder than a Bank, and both lean into the turn', () => {
  // Left and right must roll in opposite senses, and deeper than the Bank.
  const wl = PIECES.WAVE_TURN_L.pathLocal(0.5).banking;
  const wr = PIECES.WAVE_TURN_R.pathLocal(0.5).banking;
  const bl = PIECES.BANK_L.pathLocal(0.5).banking;
  const br = PIECES.BANK_R.pathLocal(0.5).banking;
  assert.ok(Math.sign(wl) === Math.sign(bl), 'left wave turn should lean like a left bank');
  assert.ok(Math.sign(wr) === Math.sign(br), 'right wave turn should lean like a right bank');
  assert.ok(Math.abs(wl) > Math.abs(bl), 'wave turn should lean deeper than a bank');
  assert.ok(Math.abs(wr) > Math.abs(br), 'wave turn should lean deeper than a bank');
});

test('Wave Turn is a banked corner, so it escapes the flat-corner overspeed gate', () => {
  // The overspeed gate in physics.ts applies only to CURVE_L/CURVE_R. A car far
  // over that threshold must survive a Wave Turn, exactly as it survives a Bank.
  const build = (turnPiece: PieceId): Simulator => {
    const t = new Track();
    t.dropHeight = 8;
    for (const id of ['STRAIGHT', 'BOOSTER', 'BOOSTER', turnPiece, 'STRAIGHT', 'FINISH'] as PieceId[]) {
      assert.ok(t.addPiece(id), `could not place ${id}`);
    }
    return new Simulator(t);
  };
  for (const id of ['WAVE_TURN_L', 'WAVE_TURN_R'] as PieceId[]) {
    const sim = build(id);
    let peak = 0;
    let guard = 0;
    while (sim.isRunning() && guard++ < 200000) { peak = Math.max(peak, sim.v2); sim.step(0.002); }
    assert.ok(peak > CORNER_MAX_V2, `test should exceed the flat-corner gate (peak ${peak.toFixed(1)})`);
    assert.ok(!sim.failed, `${id} should not throw the car off: ${sim.failReason ?? ''}`);
  }
});

// --- Zero-G Roll: the inversion with airtime ----------------------------------

test('Zero-G Roll rolls a full 360° and ends upright', () => {
  const p = PIECES.ZERO_G_ROLL.pathLocal;
  assert.ok(Math.abs(p(0).banking) < 1e-9, 'should start upright');
  assert.ok(Math.abs(p(1).banking - 2 * Math.PI) < 1e-6, 'should complete exactly one roll');
  // Genuinely inverted somewhere in the middle: the frame's up vector points down.
  let minUpZ = Infinity;
  for (const f of trackFrames(p, { gx: 0, gy: 0, gz: 0, dir: 1 }, 240)) {
    minUpZ = Math.min(minUpZ, f.up.z);
  }
  assert.ok(minUpZ < -0.9, `should invert through the roll, min up.z was ${minUpZ.toFixed(3)}`);
});

test('Zero-G Roll rolls over a crest — that is what separates it from the Corkscrew', () => {
  const zg = PIECES.ZERO_G_ROLL.pathLocal;
  const cork = PIECES.CORKSCREW.pathLocal;
  assert.ok(zg(0.5).lz > 1.0, 'zero-g roll should peak on a real hill');
  assert.ok(Math.abs(zg(0).lz) < 1e-9 && Math.abs(zg(1).lz) < 1e-9, 'and rejoin flat track level');
  // The corkscrew's own rise is only the helix offset, not a hill.
  assert.ok(cork(0.5).lz < 1.0, 'corkscrew rolls along flat track');
  assert.ok(PIECES.ZERO_G_ROLL.minV2 > PIECES.CORKSCREW.minV2, 'and it should cost more entry speed');
});

test('Zero-G Roll costs more than the hill it is built on, but is still clearable', () => {
  assert.ok(
    PIECES.ZERO_G_ROLL.minV2 > PIECES.STEEP_HILL.minV2,
    'adding the inversion should raise the gate above the plain Steep Hill',
  );
  const t = new Track();
  t.dropHeight = 8;
  for (const id of ['STRAIGHT', 'BOOSTER', 'ZERO_G_ROLL', 'STRAIGHT', 'FINISH'] as PieceId[]) {
    assert.ok(t.addPiece(id), `could not place ${id}`);
  }
  const sim = new Simulator(t);
  let guard = 0;
  while (sim.isRunning() && guard++ < 200000) sim.step(0.002);
  assert.ok(!sim.failed, `a boosted car should clear it: ${sim.failReason ?? ''}`);
});

test('Zero-G Roll is rejected when the car is too slow', () => {
  const t = new Track();
  t.dropHeight = 0;
  for (const id of ['STRAIGHT', 'ZERO_G_ROLL', 'STRAIGHT', 'FINISH'] as PieceId[]) {
    assert.ok(t.addPiece(id), `could not place ${id}`);
  }
  const sim = new Simulator(t);
  let guard = 0;
  while (sim.isRunning() && guard++ < 200000) sim.step(0.002);
  assert.ok(sim.failed, 'a crawling car should not get through an inversion');
});

// --- catalogue hygiene --------------------------------------------------------

test('the new pieces are all placeable on a real track', () => {
  for (const id of NEW_PIECES) {
    const t = new Track();
    t.dropHeight = 8;
    assert.ok(t.addPiece('STRAIGHT'));
    // Dive turns descend, so give them height to descend from first.
    if (PIECES[id].dz < 0) {
      for (let i = 0; i < 3; i++) assert.ok(t.addPiece('RAMP_UP'), 'approach ramp');
    }
    assert.ok(t.addPiece(id), `${id} could not be placed: ${JSON.stringify(t.lastCollisionResult)}`);
  }
});

// --- Immelmann and Cobra Roll: the compound inversions ------------------------
//
// These are the only pieces that INVERT and turn the car around. Both open with a
// genuine vertical half-loop, so the inversion comes from pitch (the tangent goes
// over the top) rather than from banking. A consequence worth pinning: they exit
// with banking at an ODD multiple of π, because after a pitched half-loop the
// frame is upside down at banking 0 and only an odd half-roll rights it.

/** Sign changes of the frame's up.z — two crossings per inversion. */
function inversionCount(id: PieceId, segments = 800): number {
  const frames = trackFrames(PIECES[id].pathLocal, { gx: 0, gy: 0, gz: 60, dir: 1 }, segments);
  let crossings = 0;
  for (let i = 1; i < frames.length; i++) {
    if (Math.sign(frames[i].up.z) !== Math.sign(frames[i - 1].up.z)) crossings++;
  }
  return crossings / 2;
}

function endFrames(id: PieceId): { first: number; last: number; min: number } {
  const frames = trackFrames(PIECES[id].pathLocal, { gx: 0, gy: 0, gz: 60, dir: 1 }, 800);
  let min = Infinity;
  for (const f of frames) min = Math.min(min, f.up.z);
  return { first: frames[0].up.z, last: frames[frames.length - 1].up.z, min };
}

test('Immelmann inverts once and turns the car around', () => {
  assert.equal(inversionCount('IMMELMANN'), 1);
  const entry: GridState = { gx: 0, gy: 0, gz: 5, dir: 1 };
  const next = applyPiece(entry, PIECES.IMMELMANN);
  assert.equal(next.dir, 3, 'should exit heading West after entering East');
  assert.equal(next.gz, 6, 'should exit one unit higher');
  assert.notEqual(next.gy, entry.gy, 'must change lane or it would sit on its own approach');
});

test('Cobra Roll inverts TWICE and turns the car around, exiting level', () => {
  assert.equal(inversionCount('COBRA_ROLL'), 2);
  const entry: GridState = { gx: 0, gy: 0, gz: 5, dir: 1 };
  const next = applyPiece(entry, PIECES.COBRA_ROLL);
  assert.equal(next.dir, 3, 'should exit reversed');
  assert.equal(next.gz, entry.gz, 'should exit at the same height');
});

test('both compound inversions go FULLY inverted and come out upright', () => {
  for (const id of ['IMMELMANN', 'COBRA_ROLL'] as PieceId[]) {
    const { first, last, min } = endFrames(id);
    assert.ok(first > 0.99, `${id} should enter upright, up.z was ${first.toFixed(3)}`);
    assert.ok(last > 0.99, `${id} should EXIT upright, up.z was ${last.toFixed(3)}`);
    assert.ok(min < -0.99, `${id} should go fully inverted, min up.z was ${min.toFixed(3)}`);
  }
});

test('REGRESSION: the half-loop stays planar — leaning it out flips the exit', () => {
  // frames.ts derives the surface normal by tracking the lateral axis
  // sign-continuously, so the parity of that tracking decides whether a π roll
  // rights the car or leaves it upside down. Leaning the half-loop sideways
  // changes that parity and the piece then exits INVERTED — measured, and the
  // reason all sideways travel lives in the roll-out. Pin the planarity.
  for (const id of ['IMMELMANN', 'COBRA_ROLL'] as PieceId[]) {
    const p = PIECES[id].pathLocal;
    // Over the opening half-loop the path must not move sideways at all.
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * 0.25; // safely inside the loop phase for both pieces
      assert.ok(Math.abs(p(t).ly) < 1e-9, `${id} half-loop must stay planar at t=${t.toFixed(3)}`);
    }
  }
});

test('the compound inversions exit at an odd multiple of pi of roll', () => {
  for (const id of ['IMMELMANN', 'COBRA_ROLL'] as PieceId[]) {
    const b = PIECES[id].pathLocal(1).banking / Math.PI;
    assert.ok(Math.abs(b % 2) - 1 < 1e-9 && Math.round(b) % 2 !== 0,
      `${id} exit banking should be an odd multiple of pi, got ${b}pi`);
  }
});

test('the compound inversions are arc-length parametrised (car speed stays even)', () => {
  // Without this the car crawls through the loop then rockets down the roll-out,
  // because the simulator advances the parameter assuming constant distance per
  // unit t. Anything much above ~1.2 is a visible lurch.
  for (const id of ['IMMELMANN', 'COBRA_ROLL'] as PieceId[]) {
    const p = PIECES[id].pathLocal;
    let mn = Infinity, mx = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const a = p(i / N), b = p((i + 1) / N);
      const ds = Math.hypot(b.lx - a.lx, b.ly - a.ly, b.lz - a.lz) * N;
      mn = Math.min(mn, ds); mx = Math.max(mx, ds);
    }
    assert.ok(mx / mn < 1.2, `${id} parameter speed varies ${(mx / mn).toFixed(2)}x — reparametrisation broken`);
  }
});

test('a boosted car completes both compound inversions', () => {
  for (const id of ['IMMELMANN', 'COBRA_ROLL'] as PieceId[]) {
    const t = new Track();
    t.dropHeight = 8;
    for (const p of ['STRAIGHT', 'LAUNCHPAD', 'BOOSTER', 'BOOSTER', id, 'STRAIGHT', 'FINISH'] as PieceId[]) {
      assert.ok(t.addPiece(p), `could not place ${p} before ${id}`);
    }
    const sim = new Simulator(t);
    let guard = 0;
    while (sim.isRunning() && guard++ < 400000) sim.step(0.002);
    assert.ok(!sim.failed, `${id} should be clearable with a launch + boosters: ${sim.failReason ?? ''}`);
  }
});

test('the compound inversions are the most demanding gates after the Giant Loop', () => {
  assert.ok(PIECES.IMMELMANN.minV2 > PIECES.LOOP.minV2, 'Immelmann should cost more than a plain Loop');
  assert.ok(PIECES.COBRA_ROLL.minV2 > PIECES.IMMELMANN.minV2, 'two inversions should cost more than one');
  assert.ok(
    PIECES.COBRA_ROLL.excitement > PIECES.TOP_HAT.excitement,
    'a double inversion should out-score the Top Hat',
  );
});

// --- seam smoothness: the ROLL axis, not just the tangent ---------------------

test('no ordered pair of pieces has a jarring ROLL jump at the seam', () => {
  // The existing exhaustive audit in new-pieces.test.ts compares exit/entry
  // TANGENTS, which catches a crease in the path but is blind to the car being
  // rolled differently on either side of a join. A piece that exits upside down
  // joins a flat piece with a perfect tangent and a 180-degree flip of the car —
  // which is exactly the defect this caught while the compound inversions were
  // being built. Compare the surface normals too.
  const all = (Object.keys(PIECES) as PieceId[]).filter((id) => !PIECES[id].hidden);
  const leaders = all.filter((id) => id !== 'FINISH');
  let worst = 0;
  let worstPair = '';
  for (const a of leaders) {
    for (const b of all) {
      const seq: PieceId[] = ['STRAIGHT', a, b];
      let s: GridState = { gx: 0, gy: 0, gz: 100, dir: 1 };
      const entries: GridState[] = [];
      for (const id of seq) { entries.push(s); s = applyPiece(s, PIECES[id]); }
      const fA = trackFrames(resolvePathLocal(seq, 1), entries[1], 48);
      const fB = trackFrames(resolvePathLocal(seq, 2), entries[2], 48);
      const ua = fA[fA.length - 1].up;
      const ub = fB[0].up;
      const dot = ua.x * ub.x + ua.y * ub.y + ua.z * ub.z;
      const ang = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      if (ang > worst) { worst = ang; worstPair = `${a} -> ${b}`; }
    }
  }
  // Same 8deg budget the tangent audit uses: a real flip measures 50-180deg, and
  // the residual here is finite-difference noise on the high-curvature humps.
  assert.ok(worst < 8, `a seam flips the car: ${worstPair} = ${worst.toFixed(1)}deg`);
});
