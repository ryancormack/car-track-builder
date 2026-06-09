// Property-based tests for the collision detection module (src/collision.ts).
//
// Uses `fast-check` to validate the universally-quantified correctness
// properties from the design document across a wide input space. The custom
// arbitraries defined at the top level here are intentionally reusable: the
// remaining property tasks (7.2–7.9) append further properties that draw on the
// same `gridStateArb`, `pieceIdArb`, and `pieceArb` generators. As those tasks
// land they add the specific collision-module imports they exercise (e.g.
// checkPlacement, buildFrozenOccupiedSet) to the import block below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { buildFrozenOccupiedSet, cellKey, checkFloor, checkOverlap, checkPlacement, computeCells } from '../src/collision.js';
import type { CellKey, GridCell } from '../src/collision.js';
import { PIECES } from '../src/pieces/definitions.js';
import { DIRS, applyPiece } from '../src/pieces/geometry.js';
import { Track } from '../src/track.js';
import type { GridState, Piece, PieceId } from '../src/types.js';

// ---------------------------------------------------------------------------
// Custom arbitraries (reused by all collision property tests)
// ---------------------------------------------------------------------------

/**
 * Generates a GridState within the bounds described by the design's testing
 * strategy: gx/gy in [-10, 10], gz in [0, 6], dir in {0, 1, 2, 3}.
 */
export const gridStateArb: fc.Arbitrary<GridState> = fc.record({
  gx: fc.integer({ min: -10, max: 10 }),
  gy: fc.integer({ min: -10, max: 10 }),
  gz: fc.integer({ min: 0, max: 6 }),
  dir: fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<GridState['dir']>,
});

/**
 * The full set of PieceIds from the catalogue (see src/pieces/definitions.ts).
 * Includes the hidden meta pieces (START, FINISH) so the generators cover the
 * entire `PIECES` record.
 */
export const ALL_PIECE_IDS: PieceId[] = [
  'START',
  'STRAIGHT',
  'CURVE_L',
  'CURVE_R',
  'RAMP_UP',
  'RAMP_DN',
  'LOOP',
  'CORKSCREW',
  'BOOSTER',
  'JUMP',
  'SPIRAL',
  'SPIRAL_TOWER',
  'STEEP_HILL',
  'HELIX_UP',
  'HELIX_DN',
  'FINISH',
];

/** Selects any PieceId from the catalogue. */
export const pieceIdArb: fc.Arbitrary<PieceId> = fc.constantFrom(...ALL_PIECE_IDS);

/** Selects a Piece definition by mapping a generated PieceId through PIECES. */
export const pieceArb: fc.Arbitrary<Piece> = pieceIdArb.map((id) => PIECES[id]);

// ---------------------------------------------------------------------------
// Smoke property — validates the harness and arbitraries work end-to-end.
// ---------------------------------------------------------------------------

test('Feature: track-collision-detection, Property 0: computeCells returns piece.forward cells', () => {
  fc.assert(
    fc.property(gridStateArb, pieceIdArb, (entry, id) => {
      const cells = computeCells(entry, PIECES[id]);
      assert.equal(cells.length, PIECES[id].forward);
    }),
    { numRuns: 100 },
  );
});


// ---------------------------------------------------------------------------
// Property 1: Floor Violation Detection
// ---------------------------------------------------------------------------
//
// PURE-MODULE vs TRACK-LEVEL distinction
// --------------------------------------
// The design's Property 1 talks about the *effective* starting elevation (drop
// height) and the *exit* cell (entry.gz + piece.dz). Those two concerns —
// applying the drop-height offset to the start state, and validating the exit
// cell that becomes the *next* piece's entry — are TRACK-LEVEL responsibilities
// (see src/track.ts). The pure `collision` module deliberately does NOT apply
// the drop-height offset and does NOT synthesize the exit cell: its `checkFloor`
// only inspects the cells returned by `computeCells`, i.e. the `piece.forward`
// cells the piece actually owns (entry cell + interpolated intermediates).
//
// Therefore the precise, pure-module statement of Property 1 is a biconditional
// over the OWNED cells:
//
//     checkFloor(computeCells(entry, piece)) !== null
//        <=>  checkPlacement(entry, piece, { empty occupied }).reason === 'floor'
//
// i.e. checkPlacement reports a 'floor' rejection for exactly those placements
// whose computed cells dip below gz = 0, and the reported cell is itself below
// the floor. With an empty occupied set and no exclude cell, the only possible
// rejection is a floor rejection, so this isolates the floor predicate cleanly.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.5, 6.1, 6.3, 6.4
//   (the drop-height and exit-cell facets of 6.1/6.3/6.4/1.1 are exercised at
//    the Track level; this property covers the core floor predicate the Track
//    delegates to.)

const EMPTY_OCCUPIED: Set<CellKey> = new Set();

/**
 * Descending multi-cell pieces whose interpolated intermediate cells can dip
 * below the floor. Used (with a low entry gz) to GUARANTEE the positive case —
 * an actual floor violation — is exercised, since `gridStateArb` alone (gz in
 * [0,6]) rarely produces sub-floor cells for shallow descents.
 */
const DESCENDING_PIECE_IDS: PieceId[] = ['SPIRAL', 'SPIRAL_TOWER', 'HELIX_DN'];
const descendingPieceArb: fc.Arbitrary<Piece> = fc
  .constantFrom(...DESCENDING_PIECE_IDS)
  .map((id) => PIECES[id]);

/** A GridState pinned to a low elevation (gz in [0,2]) to provoke floor dips. */
const lowGridStateArb: fc.Arbitrary<GridState> = fc.record({
  gx: fc.integer({ min: -10, max: 10 }),
  gy: fc.integer({ min: -10, max: 10 }),
  gz: fc.integer({ min: 0, max: 2 }),
  dir: fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<GridState['dir']>,
});

test('Feature: track-collision-detection, Property 1: Floor Violation Detection', () => {
  // (a) Biconditional over the full input space: checkPlacement reports a
  //     'floor' rejection iff some computed cell is below the floor, and the
  //     reported cell is itself below the floor. Holds for ALL inputs.
  fc.assert(
    fc.property(gridStateArb, pieceArb, (entry, piece) => {
      const cells = computeCells(entry, piece);
      const offending = checkFloor(cells);
      const result = checkPlacement(entry, piece, {
        occupiedCells: EMPTY_OCCUPIED,
        excludeCell: null,
      });

      if (offending !== null) {
        // A sub-floor cell exists -> must be a floor rejection.
        assert.equal(result.ok, false);
        assert.ok(!result.ok && result.reason === 'floor');
        assert.ok(!result.ok && result.cell.gz < 0);
      } else {
        // No sub-floor cell -> never a floor rejection (empty occupied set
        // means no overlap either, so the placement is accepted).
        assert.ok(result.ok || result.reason !== 'floor');
        assert.equal(result.ok, true);
      }
    }),
    { numRuns: 100 },
  );

  // (b) Positive-case generator: descending multi-cell pieces at a low entry
  //     elevation are constructed to dip below the floor. We keep only the
  //     inputs that actually produce a sub-floor cell, then assert the placement
  //     is rejected for the 'floor' reason with a below-floor cell. SPIRAL_TOWER
  //     (dz=-4, forward=4) guarantees a violation across gz in [0,2], so the
  //     precondition retains ample samples.
  fc.assert(
    fc.property(lowGridStateArb, descendingPieceArb, (entry, piece) => {
      const cells = computeCells(entry, piece);
      fc.pre(checkFloor(cells) !== null);

      const result = checkPlacement(entry, piece, {
        occupiedCells: EMPTY_OCCUPIED,
        excludeCell: null,
      });

      assert.ok(!result.ok && result.reason === 'floor');
      assert.ok(!result.ok && result.cell.gz < 0);
    }),
    { numRuns: 100 },
  );
});



// ---------------------------------------------------------------------------
// Property 2: Cell Computation Correctness
// ---------------------------------------------------------------------------
//
// For ANY piece with forward N and any valid entry GridState, computeCells
// produces exactly N cells where, for i in 0..N-1:
//
//   cell_i = (
//     entry.gx + DIRS[exitDir].dx * i,
//     entry.gy + DIRS[exitDir].dy * i,
//     Math.round(entry.gz + piece.dz * i / N),
//   )
//
// with exitDir = (entry.dir + piece.turn + 4) % 4.
//
// We recompute the expected cells INDEPENDENTLY here (mirroring the formula)
// and assert deepEqual against computeCells, plus that the length equals
// piece.forward. This pins the geometry contract the rest of the module — floor
// and overlap detection, occupied-set construction — relies upon.
//
// Validates: Requirements 2.2, 2.3, 2.5, 5.1, 5.2, 5.3

test('Feature: track-collision-detection, Property 2: Cell Computation Correctness', () => {
  fc.assert(
    fc.property(gridStateArb, pieceArb, (entry, piece) => {
      const exitDir = (entry.dir + piece.turn + 4) % 4;
      const { dx, dy } = DIRS[exitDir];
      const expected: GridCell[] = [];
      for (let i = 0; i < piece.forward; i++) {
        expected.push({
          gx: entry.gx + dx * i,
          gy: entry.gy + dy * i,
          gz: Math.round(entry.gz + (piece.dz * i) / piece.forward),
        });
      }

      const actual = computeCells(entry, piece);

      assert.equal(actual.length, piece.forward);
      assert.deepEqual(actual, expected);
    }),
    { numRuns: 100 },
  );
});



// ---------------------------------------------------------------------------
// Property 3: Cell Computation Consistency with applyPiece
// ---------------------------------------------------------------------------
//
// computeCells and applyPiece must agree at the two seams of a piece:
//
//   - ENTRY seam: the FIRST cell returned by computeCells is the entry cell,
//     i.e. exactly (entry.gx, entry.gy, entry.gz).
//
//   - EXIT seam: the position one exitDir step beyond the LAST cell coincides
//     with the (gx, gy) of applyPiece(entry, piece) — the entry of the NEXT
//     piece. With exitDir = (entry.dir + piece.turn + 4) % 4 and {dx,dy} =
//     DIRS[exitDir], the last owned cell sits at index forward-1
//     (last.gx = entry.gx + dx*(forward-1)), so stepping one more cell forward
//     lands on entry.gx + dx*forward = exit.gx (and likewise for gy).
//
// The exit elevation is governed solely by the piece's dz: exit.gz =
// entry.gz + piece.dz. We deliberately do NOT compare the last owned cell's gz
// against exit.gz — computeCells rounds an interpolated gz over `forward`
// steps, whereas the exit gz is the next piece's entry elevation. Those differ
// by design, so we assert only what the property states.
//
// Validates: Requirements 5.5

test('Feature: track-collision-detection, Property 3: Cell Computation Consistency with applyPiece', () => {
  fc.assert(
    fc.property(gridStateArb, pieceArb, (entry, piece) => {
      const exitDir = (entry.dir + piece.turn + 4) % 4;
      const { dx, dy } = DIRS[exitDir];

      const cells = computeCells(entry, piece);
      const exit = applyPiece(entry, piece);

      // ENTRY seam: first cell equals the entry cell.
      assert.deepEqual(cells[0], { gx: entry.gx, gy: entry.gy, gz: entry.gz });

      // EXIT seam: one exitDir step beyond the last cell equals exit (gx, gy).
      const last = cells[cells.length - 1];
      assert.equal(last.gx + dx, exit.gx);
      assert.equal(last.gy + dy, exit.gy);

      // Exit elevation is entry.gz + piece.dz.
      assert.equal(exit.gz, entry.gz + piece.dz);
    }),
    { numRuns: 100 },
  );
});



// ---------------------------------------------------------------------------
// Property 4: Overlap Detection Rejects Colliding Placements
// ---------------------------------------------------------------------------
//
// For ANY candidate piece whose computed cells contain at least one CellKey
// that is already present in the occupied set, checkPlacement SHALL return
// { ok: false, reason: 'overlap' }, and the reported cell SHALL be one whose
// key lies in the occupied set.
//
// Floor violations are checked FIRST inside checkPlacement, so a sub-floor cell
// would mask the overlap we want to exercise. We therefore restrict to entries
// + pieces whose computed cells are all at or above the floor via
// `fc.pre(checkFloor(cells) === null)` (gridStateArb keeps gz in [0,6], so the
// precondition retains ample non-descending samples). We then DELIBERATELY seed
// the occupied set with one of the candidate's own computed cells — the LAST
// cell — and pass `excludeCell: null` so nothing is excluded from the scan.
// With no exclusion, every computed cell counts (including a single-cell
// piece's entry cell), so the chosen cell guarantees a genuine overlap.
//
// Validates: Requirements 2.1, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7

test('Feature: track-collision-detection, Property 4: Overlap Detection Rejects Colliding Placements', () => {
  fc.assert(
    fc.property(gridStateArb, pieceArb, (entry, piece) => {
      const cells = computeCells(entry, piece);
      // Avoid floor rejections masking the overlap (floor is checked first).
      fc.pre(checkFloor(cells) === null);

      // Deliberately occupy one of the candidate's own cells (the last one).
      const chosen = cells[cells.length - 1];
      const chosenKey = cellKey(chosen.gx, chosen.gy, chosen.gz);
      const occupiedCells: Set<CellKey> = new Set([chosenKey]);

      const result = checkPlacement(entry, piece, {
        occupiedCells,
        excludeCell: null,
      });

      // The placement must be rejected as an overlap...
      assert.ok(!result.ok && result.reason === 'overlap');
      // ...and the reported cell's key must be in the occupied set.
      assert.ok(
        !result.ok &&
          occupiedCells.has(cellKey(result.cell.gx, result.cell.gy, result.cell.gz)),
      );
    }),
    { numRuns: 100 },
  );
});



// ---------------------------------------------------------------------------
// Property 5: 3D Cell Identity — Elevation Separation
// ---------------------------------------------------------------------------
//
// CellKey serializes the FULL 3D tuple (gx, gy, gz), so two pieces whose cells
// share (gx, gy) but sit at different elevations (gz) occupy DISTINCT cells and
// must NOT be reported as colliding.
//
// For a candidate piece's computed cells we build an occupied set that mirrors
// the SAME (gx, gy) footprint but shifted UP by a non-zero delta in gz (delta in
// [1, 9]). Because every key differs only in its gz component — and gz is part
// of the key — `checkOverlap` finds no match and returns null.
//
// To pin that the separation is SPECIFICALLY due to gz (and not, say, an empty
// or mis-built occupied set), the same test asserts the CONVERSE within each
// run: an occupied set built from the candidate's cells at the SAME gz DOES
// collide, so `checkOverlap` returns a non-null conflicting cell. gridStateArb
// keeps the candidate gz in [0, 6], so the shifted layer (gz + delta) is always
// a distinct, valid elevation.
//
// Validates: Requirements 2.6, 5.4

test('Feature: track-collision-detection, Property 5: Elevation Separation', () => {
  fc.assert(
    fc.property(
      gridStateArb,
      pieceArb,
      fc.integer({ min: 1, max: 9 }),
      (entry, piece, delta) => {
        const cells = computeCells(entry, piece);

        // Occupied set: same (gx, gy) footprint, shifted to a DIFFERENT gz.
        const shiftedOccupied: Set<CellKey> = new Set(
          cells.map((c) => cellKey(c.gx, c.gy, c.gz + delta)),
        );
        // The differing gz means no 3D key matches -> no collision.
        assert.equal(checkOverlap(cells, shiftedOccupied, null), null);

        // Converse sanity: same (gx, gy) AND same gz DOES collide, proving the
        // separation above is specifically attributable to the gz component.
        const sameLayerOccupied: Set<CellKey> = new Set(
          cells.map((c) => cellKey(c.gx, c.gy, c.gz)),
        );
        assert.notEqual(checkOverlap(cells, sameLayerOccupied, null), null);
      },
    ),
    { numRuns: 100 },
  );
});



// ---------------------------------------------------------------------------
// Property 6: Rejection Atomicity
// ---------------------------------------------------------------------------
//
// This is a TRACK-LEVEL property (it concerns the Track's mutable state, not
// the pure collision module), so it drives the real `Track` class from
// src/track.ts rather than the pure functions exercised by Properties 1–5.
//
// Statement (design): for ANY track state and ANY piece-placement attempt that
// is REJECTED by the collision detector, the Track's `pieces` array,
// `frozenEntries` state, and editing mode (`isEditing()`) are IDENTICAL before
// and after the rejected call.
//
// To make the property meaningful we must reliably EXERCISE rejections — if the
// attempted op always succeeded, `fc.pre`-style filtering would discard every
// run and the property would pass vacuously. We therefore construct each
// scenario so the attempted op is DETERMINISTICALLY rejected (asserting the
// boolean return is `false` doubles as the guard), and pair that deterministic
// rejecting op with a RANDOMIZED prefix track so the surrounding state varies.
// Two complementary scenarios cover both rejection reasons and both modes:
//
//   (a) FLOOR rejection, NORMAL mode: build a randomized flat prefix (pieces
//       with dz = 0 keep the cursor at gz = 0), drop the cushion to
//       dropHeight = 0, then attempt RAMP_DN (dz = -1). Its exit cell sits at
//       gz = -1 < 0, so the placement is always a floor violation.
//
//   (b) OVERLAP rejection, EDITING mode: build a straight east track of random
//       length N, delete a middle piece (entering editing mode with a frozen
//       downstream suffix), then attempt to insert a JUMP (forward = 2) whose
//       landing cell coincides with the first frozen-suffix cell — the
//       frozen-region auto-detection always rejects it.
//
// In both cases we snapshot pieces / frozenEntries / isEditing() BEFORE the
// rejected op and assert byte-for-byte equality afterwards.
//
// Validates: Requirements 3.4, 4.4

/** Flat pieces (dz = 0): appending these keeps the cursor's gz at 0. */
const FLAT_PIECE_IDS: PieceId[] = ['STRAIGHT', 'CURVE_L', 'CURVE_R'];
const flatSeqArb: fc.Arbitrary<PieceId[]> = fc.array(
  fc.constantFrom(...FLAT_PIECE_IDS),
  { minLength: 0, maxLength: 8 },
);

/** A straight east track length N plus a middle delete index k in [1, N-2]. */
const straightTrackArb: fc.Arbitrary<{ n: number; k: number }> = fc
  .integer({ min: 3, max: 8 })
  .chain((n) =>
    fc.record({ n: fc.constant(n), k: fc.integer({ min: 1, max: n - 2 }) }),
  );

test('Feature: track-collision-detection, Property 6: Rejection Atomicity', () => {
  // (a) FLOOR rejection in NORMAL mode (frozenEntries stays null).
  fc.assert(
    fc.property(flatSeqArb, (seq) => {
      const t = new Track();
      // Flat prefix: each addPiece either succeeds (cursor advances, gz stays 0)
      // or is itself rejected on overlap — either way the track stays valid and
      // the cursor elevation remains 0.
      for (const id of seq) t.addPiece(id);

      // Remove the floor cushion so a single descent breaks the floor.
      t.dropHeight = 0;

      // Snapshot the full mutable state before the rejected op.
      const piecesBefore = [...t.pieces];
      const frozenBefore = JSON.stringify(t.frozenEntries);
      const editingBefore = t.isEditing();

      // RAMP_DN from cursor gz = 0 with dropHeight = 0: exit cell gz = -1 < 0.
      const ok = t.addPiece('RAMP_DN');

      // The op MUST be rejected (this also guarantees we exercise the false
      // branch rather than filtering all runs away).
      assert.equal(ok, false);
      const res = t.lastCollisionResult;
      assert.ok(res && !res.ok && res.reason === 'floor');

      // Atomicity: pieces, frozenEntries, and editing mode are unchanged.
      assert.deepEqual(t.pieces, piecesBefore);
      assert.equal(JSON.stringify(t.frozenEntries), frozenBefore);
      assert.equal(t.isEditing(), editingBefore);
    }),
    { numRuns: 100 },
  );

  // (b) OVERLAP rejection in EDITING mode (frozen suffix auto-detection).
  fc.assert(
    fc.property(straightTrackArb, ({ n, k }) => {
      const t = new Track();
      for (let i = 0; i < n; i++) t.addPiece('STRAIGHT'); // [S x n] heading East
      // Delete a middle piece -> editing mode with a frozen downstream suffix.
      t.deleteAt(k);
      assert.equal(t.isEditing(), true);

      // Snapshot the full mutable state before the rejected op.
      const piecesBefore = [...t.pieces];
      const frozenBefore = JSON.stringify(t.frozenEntries);
      const editingBefore = t.isEditing();

      // Insert a JUMP at k: entry (k,0,0,E), landing cell {k+1,0,0} coincides
      // with the first frozen-suffix cell -> auto-rejected as an overlap.
      const ok = t.insertAt(k, 'JUMP');

      assert.equal(ok, false);
      const res = t.lastCollisionResult;
      assert.ok(res && !res.ok && res.reason === 'overlap');

      // Atomicity: pieces, frozenEntries, and editing mode are unchanged.
      assert.deepEqual(t.pieces, piecesBefore);
      assert.equal(JSON.stringify(t.frozenEntries), frozenBefore);
      assert.equal(t.isEditing(), editingBefore);
    }),
    { numRuns: 100 },
  );
});



// ---------------------------------------------------------------------------
// Property 7: Frozen Region Auto-Detection
// ---------------------------------------------------------------------------
//
// This is a TRACK-LEVEL property: it concerns the Track's editing mode and the
// auto-detection of collisions with the downstream FROZEN suffix, so it drives
// the real `Track` class (src/track.ts) together with the pure
// `buildFrozenOccupiedSet` helper (src/collision.ts) rather than the pure
// predicates exercised by Properties 1–5.
//
// Statement (design): for ANY track in editing mode (frozenEntries non-null),
// if a new piece placed in the LIVE region has computed cells that overlap with
// cells occupied by the FROZEN-suffix pieces (computed from their snapshot
// entry states), then the placement SHALL be rejected.
//
// This is the safety feature the user explicitly asked for: after deleting a
// piece and rebuilding, you cannot accidentally build over the downstream track
// that still exists past the edit point.
//
// Deterministic-but-parameterized scenario (reusing `straightTrackArb`):
//
//   * Build a straight EAST track of random length N in [3, 8]. Entry of piece i
//     is (i, 0, 0, E); each STRAIGHT (forward=1) occupies exactly cell {i,0,0}.
//   * `deleteAt(k)` for a middle k in [1, N-2] enters editing mode. deleteAt
//     freezes everything strictly downstream of the deleted piece, so the frozen
//     SUFFIX snapshot entries are (k+1,0,0,E) .. (N-1,0,0,E). After the splice,
//     pieces.length = N-1 and frozenEntries.length = N-1-k, so the frozen
//     boundary = (N-1) - (N-1-k) = k. The frozen suffix therefore occupies the
//     cells {k+1,0,0}, {k+2,0,0}, ..., {N-1,0,0} — verified directly against
//     `buildFrozenOccupiedSet` below.
//   * Insert a multi-cell JUMP (forward=2, turn=0, dz=0) at index k. Its entry is
//     the live-chained state (k,0,0,E); computeCells gives the entry cell {k,0,0}
//     (the EXCLUDED connection point shared with its predecessor) and the landing
//     cell {k+1,0,0}. That landing cell is the FIRST frozen-suffix cell, so the
//     auto-detection rejects the insert as an 'overlap' reporting cell {k+1,0,0}.
//   * Atomicity: the rejected insert leaves pieces, frozenEntries, and editing
//     mode unchanged.
//
// CONTRAST (positive) case — proves the rejection is SPECIFICALLY due to the
// frozen region, not the JUMP geometry itself: in a FRESH, non-editing track of
// exactly k STRAIGHTs (the same live prefix, no frozen suffix), inserting the
// same JUMP at index k (the end) lands its {k+1,0,0} cell on empty space, so the
// identical geometry is ACCEPTED. The only difference between the two cases is
// the presence of the frozen downstream region.
//
// Validates: Requirements 7.1, 7.2, 7.4

test('Feature: track-collision-detection, Property 7: Frozen Region Auto-Detection', () => {
  fc.assert(
    fc.property(straightTrackArb, ({ n, k }) => {
      // --- Editing-mode rejection case ---------------------------------------
      const t = new Track();
      for (let i = 0; i < n; i++) t.addPiece('STRAIGHT'); // [S x n] heading East
      t.deleteAt(k); // editing mode: frozen suffix snapshots (k+1..n-1, 0, 0)
      assert.equal(t.isEditing(), true);
      assert.notEqual(t.frozenEntries, null);

      // Ground the frozen footprint directly: buildFrozenOccupiedSet over the
      // snapshot entries must be exactly { {k+1,0,0} .. {n-1,0,0} }.
      const boundary = t.pieces.length - t.frozenEntries!.length;
      assert.equal(boundary, k);
      const frozenSet = buildFrozenOccupiedSet(t.pieces, t.frozenEntries!, boundary);
      const expectedKeys: CellKey[] = [];
      for (let gx = k + 1; gx <= n - 1; gx++) expectedKeys.push(cellKey(gx, 0, 0));
      assert.equal(frozenSet.size, expectedKeys.length);
      for (const key of expectedKeys) {
        assert.ok(frozenSet.has(key), `frozen set should contain ${key}`);
      }
      // The JUMP's landing cell {k+1,0,0} is the first frozen-suffix cell.
      assert.ok(frozenSet.has(cellKey(k + 1, 0, 0)));

      // Snapshot the full mutable state before the rejected insert (atomicity).
      const piecesBefore = [...t.pieces];
      const frozenBefore = JSON.stringify(t.frozenEntries);
      const editingBefore = t.isEditing();

      // Insert a JUMP at k: entry (k,0,0,E), entry cell {k,0,0} (excluded
      // connection), landing cell {k+1,0,0} coincides with a FROZEN-suffix cell
      // -> auto-detected as an overlap and rejected.
      const ok = t.insertAt(k, 'JUMP');
      assert.equal(ok, false);
      const res = t.lastCollisionResult;
      assert.ok(res && !res.ok && res.reason === 'overlap');
      assert.ok(res && !res.ok && res.cell.gx === k + 1 && res.cell.gy === 0 && res.cell.gz === 0);

      // Atomicity: pieces, frozenEntries, and editing mode are unchanged.
      assert.deepEqual(t.pieces, piecesBefore);
      assert.equal(JSON.stringify(t.frozenEntries), frozenBefore);
      assert.equal(t.isEditing(), editingBefore);

      // --- CONTRAST: same geometry, NO frozen region -> accepted -------------
      // A fresh non-editing track of exactly k STRAIGHTs (the same live prefix).
      // Inserting the same JUMP at the end (index k) lands {k+1,0,0} on empty
      // space, so the identical geometry is accepted. This isolates the frozen
      // suffix as the sole cause of the rejection above.
      const fresh = new Track();
      for (let i = 0; i < k; i++) fresh.addPiece('STRAIGHT');
      assert.equal(fresh.isEditing(), false);
      const freshOk = fresh.insertAt(k, 'JUMP');
      assert.equal(freshOk, true);
      const freshRes = fresh.lastCollisionResult;
      assert.ok(freshRes && freshRes.ok, 'same JUMP geometry is accepted without a frozen region');
    }),
    { numRuns: 100 },
  );
});



// ---------------------------------------------------------------------------
// Property 9: Valid Placements Accepted
// ---------------------------------------------------------------------------
//
// Statement (design): for ANY piece and entry GridState where ALL computed
// cells have gz >= 0 AND no computed cell exists in the occupied set,
// `checkPlacement` SHALL return `{ ok: true }`.
//
// This is the acceptance counterpart to the floor (Property 1) and overlap
// (Property 4) rejection properties: when NEITHER constraint is violated the
// placement must be accepted. We isolate the two clauses of the precondition:
//
//   * gz >= 0 for every cell — enforced with `fc.pre(checkFloor(cells) === null)`.
//     gridStateArb keeps gz in [0, 6] and most pieces are non-descending, so the
//     precondition retains ample samples.
//   * no computed cell is in the occupied set — guaranteed BY CONSTRUCTION in
//     two complementary ways:
//
//       (a) EMPTY occupied set: an empty set trivially contains none of the
//           candidate's cells, so the placement must be accepted.
//
//       (b) NON-EMPTY but provably DISJOINT occupied set: build an occupied set
//           from the candidate's own cells shifted by a large gx offset (+1000).
//           Since gridStateArb keeps gx in [-10, 10] and pieces advance at most a
//           few cells, every candidate cell has gx <= ~14, so every shifted key
//           (gx + 1000) is distinct from every candidate key. This proves
//           acceptance holds even when the occupied set is populated, as long as
//           it is disjoint from the candidate — not merely the empty-set case.
//
// In both cases `excludeCell` is null (nothing to exclude) and the expected
// result is `{ ok: true }`.
//
// Validates: Requirements 1.3, 2.7, 6.4

const DISJOINT_GX_OFFSET = 1000;

test('Feature: track-collision-detection, Property 9: Valid Placements Accepted', () => {
  fc.assert(
    fc.property(gridStateArb, pieceArb, (entry, piece) => {
      const cells = computeCells(entry, piece);
      // Precondition: all computed cells are at or above the floor (gz >= 0).
      fc.pre(checkFloor(cells) === null);

      // (a) Empty occupied set trivially contains none of the candidate cells.
      const emptyResult = checkPlacement(entry, piece, {
        occupiedCells: EMPTY_OCCUPIED,
        excludeCell: null,
      });
      assert.equal(emptyResult.ok, true);

      // (b) Non-empty but provably disjoint occupied set: the candidate's own
      //     cells shifted far away in gx (+1000). gridStateArb keeps gx in
      //     [-10, 10] and forward spans only a few cells, so no shifted key can
      //     collide with a candidate key -> disjoint by construction.
      const disjointOccupied: Set<CellKey> = new Set(
        cells.map((c) => cellKey(c.gx + DISJOINT_GX_OFFSET, c.gy, c.gz)),
      );
      // Verify disjointness explicitly: none of the candidate's keys appear.
      for (const c of cells) {
        assert.ok(!disjointOccupied.has(cellKey(c.gx, c.gy, c.gz)));
      }

      const disjointResult = checkPlacement(entry, piece, {
        occupiedCells: disjointOccupied,
        excludeCell: null,
      });
      assert.equal(disjointResult.ok, true);
    }),
    { numRuns: 100 },
  );
});
