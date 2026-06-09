// Tests for the pure-function collision module (src/collision.ts).
//
// Covers cell serialization, cell computation (single- and multi-cell pieces,
// turns, and elevation interpolation), floor/overlap predicates, the
// end-to-end placement check (including floor-over-overlap priority), and the
// occupied-set builders for both normal and frozen (editing-mode) regions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cellKey,
  computeCells,
  checkFloor,
  checkOverlap,
  checkPlacement,
  buildOccupiedSet,
  buildFrozenOccupiedSet,
} from '../src/collision.js';
import type { CellKey, GridCell } from '../src/collision.js';
import { PIECES } from '../src/pieces/definitions.js';
import type { GridState, Piece } from '../src/types.js';

/** Sort a set of cell keys for order-independent comparison. */
function sortedKeys(set: Set<CellKey>): CellKey[] {
  return [...set].sort();
}

// ---- cellKey ----

test('cellKey serializes a cell to "gx,gy,gz"', () => {
  assert.equal(cellKey(3, 2, 1), '3,2,1');
  assert.equal(cellKey(0, 0, 0), '0,0,0');
});

test('cellKey preserves negative coordinates distinctly', () => {
  assert.equal(cellKey(-1, 0, 5), '-1,0,5');
  assert.notEqual(cellKey(1, 2, 3), cellKey(3, 2, 1));
});

// ---- computeCells ----

test('computeCells(STRAIGHT, forward=1) returns the entry cell and the exit cell', () => {
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  const cells = computeCells(entry, PIECES.STRAIGHT);
  assert.deepEqual(cells, [
    { gx: 0, gy: 0, gz: 0 },
    { gx: 1, gy: 0, gz: 0 }, // exit cell now owned (forward + 1 cells)
  ]);
});

test('computeCells(CORKSCREW, forward=3) steps four cells (entry..exit) along the exit dir', () => {
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  const cells = computeCells(entry, PIECES.CORKSCREW);
  assert.equal(cells.length, 4);
  assert.deepEqual(cells, [
    { gx: 0, gy: 0, gz: 0 },
    { gx: 1, gy: 0, gz: 0 },
    { gx: 2, gy: 0, gz: 0 },
    { gx: 3, gy: 0, gz: 0 }, // exit cell
  ]);
});

test('computeCells(CURVE_R, turn=+1) yields the entry cell and the post-turn exit cell', () => {
  // CURVE_R has forward=1, so the footprint is the entry cell plus the exit cell
  // one step along the post-turn exit direction (East + right = South, +y).
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  const cells = computeCells(entry, PIECES.CURVE_R);
  assert.deepEqual(cells, [
    { gx: 0, gy: 0, gz: 0 },
    { gx: 0, gy: 1, gz: 0 }, // exit cell, stepped South
  ]);
});

test('computeCells steps along the post-turn exit direction for a turning multi-cell piece', () => {
  // Derive a turning multi-cell piece to exercise the exitDir = (dir+turn)%4
  // stepping: entering East with turn=+1 exits South (+y), so cells advance
  // along +y rather than +x. forward=2 -> 3 cells (entry, intermediate, exit).
  const turningPiece: Piece = { ...PIECES.CURVE_R, forward: 2 };
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  const cells = computeCells(entry, turningPiece);
  assert.deepEqual(cells, [
    { gx: 0, gy: 0, gz: 0 },
    { gx: 0, gy: 1, gz: 0 }, // stepped South, confirming the +1 turn
    { gx: 0, gy: 2, gz: 0 }, // exit cell
  ]);
});

test('computeCells interpolates elevation at integer endpoints and includes the exit cell', () => {
  // HELIX_UP: forward=3, dz=3 -> gz rises by 1 per step; exit cell lands at
  // entry.gz + dz = 3 exactly (entry.gz + round(dz*i/forward)).
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  const cells = computeCells(entry, PIECES.HELIX_UP);
  assert.deepEqual(cells, [
    { gx: 0, gy: 0, gz: 0 },
    { gx: 1, gy: 0, gz: 1 },
    { gx: 2, gy: 0, gz: 2 },
    { gx: 3, gy: 0, gz: 3 }, // exit cell at entry.gz + dz
  ]);
});

// ---- checkFloor ----

test('checkFloor accepts cells resting exactly on the floor (gz=0 → null)', () => {
  const cells: GridCell[] = [
    { gx: 0, gy: 0, gz: 0 },
    { gx: 1, gy: 0, gz: 2 },
  ];
  assert.equal(checkFloor(cells), null);
});

test('checkFloor rejects a below-floor cell and returns the first offender', () => {
  const cells: GridCell[] = [
    { gx: 0, gy: 0, gz: 1 },
    { gx: 1, gy: 0, gz: -1 }, // first violation
    { gx: 2, gy: 0, gz: -2 },
  ];
  assert.deepEqual(checkFloor(cells), { gx: 1, gy: 0, gz: -1 });
});

// ---- checkOverlap ----

test('checkOverlap returns null when no cell is occupied', () => {
  const occupied = new Set<CellKey>(['1,0,0']);
  const cells: GridCell[] = [{ gx: 2, gy: 0, gz: 0 }];
  assert.equal(checkOverlap(cells, occupied, null), null);
});

test('checkOverlap returns the first conflicting cell', () => {
  const occupied = new Set<CellKey>(['1,0,0', '2,0,0']);
  const cells: GridCell[] = [
    { gx: 0, gy: 0, gz: 0 },
    { gx: 1, gy: 0, gz: 0 }, // first conflict
    { gx: 2, gy: 0, gz: 0 },
  ];
  assert.deepEqual(checkOverlap(cells, occupied, null), { gx: 1, gy: 0, gz: 0 });
});

test('checkOverlap skips the excludeCell (shared connection point)', () => {
  const occupied = new Set<CellKey>(['1,0,0']);
  const cells: GridCell[] = [{ gx: 1, gy: 0, gz: 0 }];
  // The only candidate matches the occupied cell, but it is excluded.
  assert.equal(checkOverlap(cells, occupied, '1,0,0'), null);
});

test('checkOverlap still flags a non-excluded conflict alongside the excludeCell', () => {
  const occupied = new Set<CellKey>(['1,0,0', '2,0,0']);
  const cells: GridCell[] = [
    { gx: 1, gy: 0, gz: 0 }, // excluded
    { gx: 2, gy: 0, gz: 0 }, // real conflict
  ];
  assert.deepEqual(checkOverlap(cells, occupied, '1,0,0'), { gx: 2, gy: 0, gz: 0 });
});

// ---- checkPlacement (end-to-end) ----

test('checkPlacement returns a floor violation for a piece dropping below the floor', () => {
  // SPIRAL: forward=2, dz=-2 → at gz=0 the second owned cell is gz=-1.
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  const result = checkPlacement(entry, PIECES.SPIRAL, {
    occupiedCells: new Set<CellKey>(),
    excludeCell: null,
  });
  assert.deepEqual(result, { ok: false, reason: 'floor', cell: { gx: 1, gy: 0, gz: -1 } });
});

test('checkPlacement reports floor BEFORE overlap when both occur', () => {
  // SPIRAL at gz=0 owns cells (0,0,0) and (1,0,-1). The occupied set collides
  // on (0,0,0), but the floor violation at (1,0,-1) must take priority.
  const entry: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  const result = checkPlacement(entry, PIECES.SPIRAL, {
    occupiedCells: new Set<CellKey>(['0,0,0']),
    excludeCell: null,
  });
  assert.deepEqual(result, { ok: false, reason: 'floor', cell: { gx: 1, gy: 0, gz: -1 } });
});

test('checkPlacement returns an overlap violation when only overlap occurs', () => {
  const entry: GridState = { gx: 1, gy: 0, gz: 0, dir: 1 };
  const result = checkPlacement(entry, PIECES.STRAIGHT, {
    occupiedCells: new Set<CellKey>(['1,0,0']),
    excludeCell: null,
  });
  assert.deepEqual(result, { ok: false, reason: 'overlap', cell: { gx: 1, gy: 0, gz: 0 } });
});

test('checkPlacement accepts a valid placement (no floor or overlap violation)', () => {
  const entry: GridState = { gx: 2, gy: 0, gz: 0, dir: 1 };
  const result = checkPlacement(entry, PIECES.STRAIGHT, {
    occupiedCells: new Set<CellKey>(['1,0,0']),
    excludeCell: null,
  });
  assert.deepEqual(result, { ok: true });
});

// ---- buildOccupiedSet ----

test('buildOccupiedSet collects every cell across a straight run (exit-inclusive)', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  // Each STRAIGHT owns its entry AND exit cell; the union spans 0..3.
  const set = buildOccupiedSet(['STRAIGHT', 'STRAIGHT', 'STRAIGHT'], start, 0, 3);
  assert.deepEqual(sortedKeys(set), ['0,0,0', '1,0,0', '2,0,0', '3,0,0']);
});

test('buildOccupiedSet collects all cells of a multi-cell piece (exit-inclusive)', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  const set = buildOccupiedSet(['CORKSCREW'], start, 0, 1);
  assert.deepEqual(sortedKeys(set), ['0,0,0', '1,0,0', '2,0,0', '3,0,0']);
});

test('buildOccupiedSet collects only pieces in [fromIndex, toIndex) while advancing the cursor from 0', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  // Pieces 0 and 1 only advance the cursor; piece 2 (entry+exit) is collected.
  const set = buildOccupiedSet(['STRAIGHT', 'STRAIGHT', 'STRAIGHT'], start, 2, 3);
  assert.deepEqual(sortedKeys(set), ['2,0,0', '3,0,0']);
});

test('buildOccupiedSet clamps toIndex to the pieces length', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  const set = buildOccupiedSet(['STRAIGHT', 'STRAIGHT'], start, 0, 10);
  assert.deepEqual(sortedKeys(set), ['0,0,0', '1,0,0', '2,0,0']);
});

// ---- buildFrozenOccupiedSet ----

test('buildFrozenOccupiedSet uses snapshot entries directly (not re-derived positions)', () => {
  // Frozen pieces sit at an arbitrary snapshot location, decoupled from the
  // live region. The set is built straight from frozenEntries (exit-inclusive).
  const pieces = ['STRAIGHT', 'STRAIGHT', 'STRAIGHT'] as const;
  const frozenEntries: GridState[] = [
    { gx: 5, gy: 5, gz: 0, dir: 1 },
    { gx: 6, gy: 5, gz: 0, dir: 1 },
  ];
  const set = buildFrozenOccupiedSet([...pieces], frozenEntries, 1);
  assert.deepEqual(sortedKeys(set), ['5,5,0', '6,5,0', '7,5,0']);
});

test('buildFrozenOccupiedSet guards against entries past the end of the pieces array', () => {
  const frozenEntries: GridState[] = [
    { gx: 0, gy: 0, gz: 0, dir: 1 },
    { gx: 1, gy: 0, gz: 0, dir: 1 }, // index 1 is out of range for a 1-piece track
  ];
  const set = buildFrozenOccupiedSet(['STRAIGHT'], frozenEntries, 0);
  assert.deepEqual(sortedKeys(set), ['0,0,0', '1,0,0']);
});
