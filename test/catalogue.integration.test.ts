// test/catalogue.integration.test.ts — every piece in the catalogue must be
// placeable AND driveable, checked mechanically over PIECES rather than by
// remembering to add a case per piece.
//
// This is the invariant that a new piece is most likely to break silently: it
// type-checks, it renders, its seams line up, and yet a car cannot actually get
// through it because the entry gate is unreachable, the piece cannot be placed
// without violating the floor, or the simulator throws it off. Iterating the
// catalogue means the next piece is covered the moment it is added.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PIECES, PALETTE_ORDER } from '../src/pieces/index.js';
import { Track } from '../src/track.js';
import { Simulator, isRampGrade, isHill } from '../src/physics.js';
import { MAX_DROP_HEIGHT, G } from '../src/constants.js';
import type { PieceId } from '../src/types.js';

/** Pieces that end a run by design, so they cannot sit mid-track. */
const TERMINAL: ReadonlySet<PieceId> = new Set<PieceId>(['FINISH']);

/**
 * Build the shortest track that gives `id` a fair chance: a lead-in, enough
 * launch/boost to clear its entry gate, enough climb for a descending piece to
 * descend from, then the piece and a finish.
 */
function trackFor(id: PieceId): Track | null {
  const piece = PIECES[id];
  const climb: PieceId[] = piece.dz < 0
    ? Array<PieceId>(Math.abs(piece.dz) + 2).fill('RAMP_UP')
    : [];
  // Try progressively more help, so each piece is tested with the least boost
  // that works rather than every piece being drowned in launchpads.
  const boostLadders: PieceId[][] = [
    [],
    ['BOOSTER'],
    ['LAUNCHPAD'],
    ['LAUNCHPAD', 'BOOSTER'],
    ['LAUNCHPAD', 'BOOSTER', 'BOOSTER'],
  ];
  for (const boosts of boostLadders) {
    const t = new Track();
    t.dropHeight = MAX_DROP_HEIGHT;
    const seq: PieceId[] = ['STRAIGHT', ...boosts, ...climb, id];
    if (!TERMINAL.has(id)) seq.push('STRAIGHT', 'FINISH');
    let ok = true;
    for (const p of seq) {
      if (!t.addPiece(p)) { ok = false; break; }
    }
    if (!ok) continue;
    const sim = new Simulator(t);
    let guard = 0;
    while (sim.isRunning() && guard++ < 500000) sim.step(0.002);
    if (!sim.failed && !sim.isRunning()) return t;
  }
  return null;
}

test('every catalogue piece can be placed on a track', () => {
  const unplaceable: string[] = [];
  for (const id of PALETTE_ORDER) {
    const piece = PIECES[id];
    const t = new Track();
    t.dropHeight = MAX_DROP_HEIGHT;
    assert.ok(t.addPiece('STRAIGHT'), 'lead-in should always place');
    // A descending piece needs height above the floor before it can go down.
    if (piece.dz < 0) {
      for (let i = 0; i < Math.abs(piece.dz) + 2; i++) t.addPiece('RAMP_UP');
    }
    if (!t.addPiece(id)) unplaceable.push(`${id}: ${JSON.stringify(t.lastCollisionResult)}`);
  }
  assert.deepEqual(unplaceable, [], `pieces that could not be placed:\n${unplaceable.join('\n')}`);
});

test('every catalogue piece can actually be driven through to the finish', () => {
  const undriveable: string[] = [];
  for (const id of PALETTE_ORDER) {
    if (trackFor(id) === null) undriveable.push(id);
  }
  assert.deepEqual(
    undriveable, [],
    `a car could not complete these pieces even with a max drop plus launch and boosters:\n${undriveable.join('\n')}`,
  );
});

test("every piece's entry gate is reachable within the game's own speed budget", () => {
  // A gate above what the game can ever produce would make the piece decoration.
  // The ceiling is a max-height drop plus the strongest launch and a booster.
  const maxDropV2 = 2 * G * MAX_DROP_HEIGHT;
  const ceiling = maxDropV2 + PIECES.LAUNCHPAD.boostEnergy + PIECES.BOOSTER.boostEnergy;
  const unreachable: string[] = [];
  for (const id of PALETTE_ORDER) {
    const gate = PIECES[id].minV2;
    if (gate > ceiling) unreachable.push(`${id} needs v2 ${gate.toFixed(1)} > ceiling ${ceiling.toFixed(1)}`);
  }
  assert.deepEqual(unreachable, [], unreachable.join('\n'));
});

test('every piece declares an arc length matching its sampler', () => {
  // pathLen drives how fast the simulator advances along the piece, so a wrong
  // value makes the car cover the piece at the wrong speed. It is hand-declared
  // next to the sampler, which is exactly the kind of pair that drifts.
  const wrong: string[] = [];
  for (const id of Object.keys(PIECES) as PieceId[]) {
    const p = PIECES[id].pathLocal;
    let measured = 0;
    let prev = p(0);
    const N = 4000;
    for (let i = 1; i <= N; i++) {
      const q = p(i / N);
      measured += Math.hypot(q.lx - prev.lx, q.ly - prev.ly, q.lz - prev.lz);
      prev = q;
    }
    const declared = PIECES[id].pathLen;
    // 3% tolerance: the declared values are rounded to 2dp by convention.
    if (Math.abs(measured - declared) > Math.max(0.05, declared * 0.03)) {
      wrong.push(`${id}: declared ${declared} but measures ${measured.toFixed(3)}`);
    }
  }
  assert.deepEqual(wrong, [], `pathLen has drifted from the sampler:\n${wrong.join('\n')}`);
});

test('every piece has a positive arc length and a finite gate', () => {  for (const id of Object.keys(PIECES) as PieceId[]) {
    const piece = PIECES[id];
    assert.ok(piece.pathLen > 0, `${id} pathLen must be positive`);
    assert.ok(Number.isFinite(piece.minV2) && piece.minV2 >= 0, `${id} minV2 must be finite and non-negative`);
    assert.ok(Number.isFinite(piece.excitement), `${id} excitement must be finite`);
    // A sampler must never produce NaN anywhere along the piece.
    for (let i = 0; i <= 50; i++) {
      const s = piece.pathLocal(i / 50);
      assert.ok(
        Number.isFinite(s.lx) && Number.isFinite(s.ly) && Number.isFinite(s.lz) && Number.isFinite(s.banking),
        `${id} sampler produced a non-finite value at t=${(i / 50).toFixed(2)}`,
      );
    }
  }
});

// --- physics classification, derived from the geometry ------------------------
//
// `isRampGrade` and `isHill` in physics.ts are hand-written id lists, and the
// tests that used to guard them were hand-written id lists too — so they passed
// unchanged while seven new pieces were added to the catalogue and silently
// omitted from both. These tests instead MEASURE each piece's sampler and derive
// what its classification must be, so the next piece is covered the moment it
// exists. A piece that genuinely does not belong has to be named in the
// exclusion set below, with a reason.

/** Steepest grade anywhere along the piece, in degrees from horizontal. */
function maxGradeDeg(id: PieceId): number {
  const p = PIECES[id].pathLocal;
  let worst = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const a = p(i / N), b = p((i + 1) / N);
    const horiz = Math.hypot(b.lx - a.lx, b.ly - a.ly);
    const rise = Math.abs(b.lz - a.lz);
    if (horiz < 1e-9) { worst = Math.max(worst, 90); continue; }
    worst = Math.max(worst, (Math.atan2(rise, horiz) * 180) / Math.PI);
  }
  return worst;
}

/** How far the piece's highest point rises above the higher of its two ends. */
function crestHeight(id: PieceId): number {
  const p = PIECES[id].pathLocal;
  let peak = -Infinity;
  for (let i = 0; i <= 400; i++) peak = Math.max(peak, p(i / 400).lz);
  return peak - Math.max(p(0).lz, p(1).lz);
}

/**
 * Pieces excluded from the graded-surface surcharge BY DESIGN, each with the
 * reason. Matches the exclusions documented on `isRampGrade`: loops run their own
 * contact physics, jumps are ballistic, and the compound inversions open with a
 * vertical half-loop so they fall under the loop exclusion.
 */
const NOT_GRADED: ReadonlyMap<PieceId, string> = new Map<PieceId, string>([
  ['LOOP', 'loop — own contact physics'],
  ['GIANT_LOOP', 'loop — own contact physics'],
  ['CORKSCREW', 'roll along flat track, rise is the helix offset'],
  ['JUMP', 'ballistic'],
  ['GIANT_JUMP', 'ballistic'],
  ['IMMELMANN', 'opens with a vertical half-loop — loop exclusion'],
  ['COBRA_ROLL', 'opens with a vertical half-loop — loop exclusion'],
  ['START', 'hidden meta piece'],
]);

/** Pieces with a crest that are NOT rollback hills, with the reason. */
const NOT_HILL: ReadonlyMap<PieceId, string> = new Map<PieceId, string>([
  ['LOOP', 'carried over by the loop, not cresting a slope'],
  ['GIANT_LOOP', 'carried over by the loop'],
  ['CORKSCREW', 'flat; the rise is the helix offset'],
  ['JUMP', 'ballistic — leaves the track'],
  ['GIANT_JUMP', 'ballistic — leaves the track'],
  ['IMMELMANN', 'inversion — carried over by the half-loop'],
  ['COBRA_ROLL', 'inversion — carried over by the half-loop'],
  ['SPIRAL', 'coils around rather than over'],
  ['SPIRAL_TOWER', 'coils around rather than over'],
  ['HELIX_DN', 'descends only'],
  ['DIVE_TURN_L', 'descends only'],
  ['DIVE_TURN_R', 'descends only'],
  ['LAUNCHPAD', 'powered climb — never rolls back'],
  ['START', 'hidden meta piece'],
]);

test('every piece with a real grade pays the graded-surface friction surcharge', () => {
  const missing: string[] = [];
  for (const id of Object.keys(PIECES) as PieceId[]) {
    if (NOT_GRADED.has(id)) continue;
    // 8 degrees: steeper than sampling noise on a flat piece, gentler than any
    // deliberate ramp in the catalogue.
    if (maxGradeDeg(id) > 8 && !isRampGrade(id)) {
      missing.push(`${id} (max grade ${maxGradeDeg(id).toFixed(0)}deg) is graded but isRampGrade() says no`);
    }
  }
  assert.deepEqual(
    missing, [],
    `physics.ts isRampGrade() is out of step with the catalogue:\n${missing.join('\n')}\n` +
    'Add the piece to isRampGrade, or name it in NOT_GRADED here with a reason.',
  );
});

test('every piece driven over a crest can roll back rather than stall', () => {
  const missing: string[] = [];
  for (const id of Object.keys(PIECES) as PieceId[]) {
    if (NOT_HILL.has(id)) continue;
    if (crestHeight(id) > 0.25 && !isHill(id)) {
      missing.push(`${id} (crest ${crestHeight(id).toFixed(2)} above its ends) is a hill but isHill() says no`);
    }
  }
  assert.deepEqual(
    missing, [],
    `physics.ts isHill() is out of step with the catalogue:\n${missing.join('\n')}\n` +
    'Add the piece to isHill, or name it in NOT_HILL here with a reason.',
  );
});

test('the physics exclusion lists do not name pieces that no longer exist', () => {
  // Keeps the two maps above honest as the catalogue changes.
  for (const id of [...NOT_GRADED.keys(), ...NOT_HILL.keys()]) {
    assert.ok(PIECES[id], `exclusion list names ${id}, which is not in the catalogue`);
  }
});

// --- the seam contract, in the piece's OWN local coordinates ------------------
//
// A piece's declared footprint (`forward`, `turn`, `entryAdvance`, `sideAdvance`,
// `dz`) and its `pathLocal` sampler are two descriptions of the same shape, and
// nothing makes them agree automatically. Get one wrong and the piece renders in
// the right place but the NEXT piece starts somewhere else. The other suites
// catch that in world space via chained tracks; this states it directly, so the
// failure names the piece and the exact offset instead of surfacing as a crease
// somewhere downstream.
//
// Derived from applyPiece + localToWorld in pieces/geometry.ts and verified
// against all 42 pieces. See .kiro/steering/track-pieces.md for the derivation.
function expectedEnd(piece: typeof PIECES[PieceId]): { lx: number; ly: number } {
  const fe = piece.entryAdvance ?? 0;
  const fs = piece.sideAdvance ?? 0;
  const fwd = piece.forward;
  switch (((piece.turn % 4) + 4) % 4) {
    case 0: return { lx: fwd + fe, ly: fs };              // straight on
    case 1: return { lx: fe + 0.5, ly: fwd + fs - 0.5 };  // 90 right
    case 3: return { lx: fe + 0.5, ly: fs - fwd + 0.5 };  // 90 left
    default: return { lx: 1 + fe - fwd, ly: fs };         // 180 reversal
  }
}

test('every piece starts at its entry seam and ends where its footprint claims', () => {
  const wrong: string[] = [];
  for (const id of Object.keys(PIECES) as PieceId[]) {
    const piece = PIECES[id];
    const s = piece.pathLocal(0);
    if (Math.hypot(s.lx, s.ly, s.lz) > 1e-9) {
      wrong.push(`${id} must start at local (0,0,0), got (${s.lx}, ${s.ly}, ${s.lz})`);
    }
    const e = piece.pathLocal(1);
    const want = expectedEnd(piece);
    if (Math.hypot(e.lx - want.lx, e.ly - want.ly, e.lz - piece.dz) > 1e-9) {
      wrong.push(
        `${id} (forward=${piece.forward} turn=${piece.turn} ` +
        `entryAdvance=${piece.entryAdvance ?? 0} sideAdvance=${piece.sideAdvance ?? 0} dz=${piece.dz}) ` +
        `should end at (${want.lx}, ${want.ly}, ${piece.dz}) but ends at ` +
        `(${e.lx.toFixed(4)}, ${e.ly.toFixed(4)}, ${e.lz.toFixed(4)})`,
      );
    }
  }
  assert.deepEqual(wrong, [], `sampler and declared footprint disagree:\n${wrong.join('\n')}`);
});
