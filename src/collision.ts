// collision.ts — pure-function collision detection for track placement.
//
// Detects two categories of invalid placements:
//   1. Floor violations  — any occupied cell descending below gz = 0.
//   2. Overlap violations — an occupied cell coinciding with a cell already
//      claimed by another piece (identified by the full 3D tuple gx,gy,gz).
//
// The module is intentionally side-effect free: callers pass in the entry
// state, the piece definition, and the pre-computed set of occupied cells,
// and receive back a structured CollisionResult. This keeps it trivial to
// unit-test and to reuse across the Track's addPiece/insertAt/replaceAt paths.
//
// NOTE: PieceId (from ./types.js), applyPiece (from ./pieces/geometry.js) and
// the PIECES catalogue (from ./pieces/definitions.js) are imported alongside
// buildOccupiedSet, which chains the entry states across a track range. The
// buildFrozenOccupiedSet helper (a subsequent task) reuses the same imports.

import type { GridState, Piece, PieceId } from './types.js';
import { DIRS, applyPiece, localToWorld } from './pieces/geometry.js';
import { PIECES } from './pieces/definitions.js';

/**
 * A serialized cell key for Set-based O(1) lookups.
 * Format: "gx,gy,gz" (e.g. "3,2,1").
 */
export type CellKey = string;

/**
 * A 3D grid cell tuple identifying a single occupied position in the grid.
 */
export interface GridCell {
  gx: number;
  gy: number;
  gz: number;
}

/**
 * Result of a collision check.
 *
 * - `{ ok: true }` — the placement is valid.
 * - `{ ok: false; reason: 'floor'; cell }` — a cell would descend below gz = 0.
 * - `{ ok: false; reason: 'overlap'; cell }` — a cell coincides with an
 *   already-occupied cell.
 */
export type CollisionResult =
  | { ok: true }
  | { ok: false; reason: 'floor'; cell: GridCell }
  | { ok: false; reason: 'overlap'; cell: GridCell };

/**
 * Options for the placement check.
 */
export interface CheckPlacementOpts {
  /** Cells occupied by pieces in the checked region. */
  occupiedCells: Set<CellKey>;
  /** The cell to exclude from overlap checks (connection point with predecessor). */
  excludeCell: CellKey | null;
}

/**
 * Serialize a grid cell to a string key for Set membership tests.
 * Format: "gx,gy,gz".
 */
export function cellKey(gx: number, gy: number, gz: number): CellKey {
  return `${gx},${gy},${gz}`;
}


/**
 * Compute the occupied grid cells for a piece placed at the given entry state.
 *
 * The piece advances `piece.forward` cells along its EXIT direction
 * (`(entry.dir + piece.turn + 4) % 4`), consistent with applyPiece's geometry
 * where movement uses the post-turn heading. The footprint a piece owns is
 * EXIT-INCLUSIVE: the entry cell (i=0), every intermediate cell, AND the cell
 * its body advances into (i=forward) — `piece.forward + 1` cells in total.
 * including the exit cell means the cell a piece computes as its exit equals the
 * next piece's entry cell, so crossing/looping pieces agree on shared cells and
 * a single-cell loop-back is no longer invisible to overlap checks.
 *
 * Elevation is anchored at the integer endpoints `entry.gz` (i=0) and
 * `entry.gz + piece.dz` (i=forward): `gz = entry.gz + Math.round(piece.dz * i /
 * piece.forward)`. The `entry.gz` offset stays OUTSIDE the rounding so the exit
 * cell lands at exactly `entry.gz + piece.dz` (matching `applyPiece`), and two
 * crossing pieces interpolate from consistent integer endpoints.
 *
 * Returns `piece.forward + 1` cells: the first is the entry cell, the last is
 * the exit cell.
 */
export function computeCells(entry: GridState, piece: Piece): GridCell[] {
  // Diagonal-advancing pieces (wide turns) don't move along a single grid axis,
  // so the linear formula below doesn't describe their footprint. Instead we
  // sample the actual swept path and collect the integer cells it passes
  // through. This stays consistent with the exit-inclusive model: the first
  // cell is the entry cell and the last is the exit cell (the next piece's
  // entry), so the shared connection cell is handled exactly as for other
  // pieces.
  if (piece.entryAdvance && piece.entryAdvance > 0) {
    return computeSweptCells(entry, piece);
  }

  const exitDir = (entry.dir + piece.turn + 4) % 4;
  const { dx, dy } = DIRS[exitDir];
  const cells: GridCell[] = [];
  for (let i = 0; i <= piece.forward; i++) {
    cells.push({
      gx: entry.gx + dx * i,
      gy: entry.gy + dy * i,
      gz: entry.gz + Math.round((piece.dz * i) / piece.forward),
    });
  }
  return cells;
}

/**
 * Collect the integer grid cells a piece's local path sweeps through, by
 * densely sampling `piece.pathLocal` and mapping each sample to world coords.
 * Used for diagonal pieces (wide turns) whose footprint isn't a straight line
 * of cells.
 *
 * The entry and exit cells are anchored EXACTLY (from the entry state and
 * `applyPiece`) so the connection cells shared with the neighbouring pieces are
 * always correct — the half-cell-boundary samples in between are then resolved
 * by rounding, which only affects interior cells (harmless for overlap tests).
 * Cells are returned in path order, de-duplicated, entry-cell first.
 */
function computeSweptCells(entry: GridState, piece: Piece): GridCell[] {
  const cells: GridCell[] = [];
  const seen = new Set<CellKey>();
  const add = (gx: number, gy: number, gz: number): void => {
    const key = cellKey(gx, gy, gz);
    if (!seen.has(key)) {
      seen.add(key);
      cells.push({ gx, gy, gz });
    }
  };
  // Entry cell, anchored exactly.
  add(entry.gx, entry.gy, entry.gz);
  const SAMPLES = 96;
  for (let i = 1; i < SAMPLES; i++) {
    const local = piece.pathLocal(i / SAMPLES);
    const w = localToWorld(entry, local.lx, local.ly, local.lz);
    add(Math.round(w.wx), Math.round(w.wy), Math.round(w.wz));
  }
  // Exit cell, anchored exactly (= the next piece's entry cell).
  const exit = applyPiece(entry, piece);
  add(exit.gx, exit.gy, exit.gz);
  return cells;
}


/**
 * Check a sequence of occupied cells for a floor violation.
 *
 * The floor sits at gz = 0, which is the lower BOUNDARY of valid space — a
 * cell resting exactly on the floor (gz = 0) is valid. Only cells that descend
 * BELOW the floor (gz < 0) constitute a violation.
 *
 * Iterates the cells in order and returns the FIRST offending `GridCell`
 * (gz < 0), so callers can surface the precise location of the violation.
 * Returns `null` when every cell is at or above the floor.
 */
export function checkFloor(cells: GridCell[]): GridCell | null {
  for (const cell of cells) {
    if (cell.gz < 0) {
      return cell;
    }
  }
  return null;
}


/**
 * Check a sequence of occupied cells for an overlap with the occupied set.
 *
 * Each candidate cell is serialized with `cellKey` and tested for membership
 * in the `occupied` set, giving O(1) lookups per cell. Cells are identified by
 * the full 3D tuple (gx, gy, gz), so pieces sharing (gx, gy) at different
 * elevations are NOT treated as overlapping.
 *
 * The optional `excludeCell` is skipped during the scan. It represents the
 * shared connection point with the preceding piece. Per the design this
 * exclusion is not strictly necessary — the cell computation already places a
 * piece's entry one exit-direction step beyond its predecessor's last cell —
 * but it is honoured here as a safety guard against accidental
 * self-collisions at the seam.
 *
 * Iterates the cells in order and returns the FIRST conflicting `GridCell`, so
 * callers can surface the precise location of the collision. Returns `null`
 * when no cell overlaps the occupied set.
 */
export function checkOverlap(
  cells: GridCell[],
  occupied: Set<CellKey>,
  excludeCell: CellKey | null,
): GridCell | null {
  for (const cell of cells) {
    const key = cellKey(cell.gx, cell.gy, cell.gz);
    if (excludeCell !== null && key === excludeCell) {
      continue;
    }
    if (occupied.has(key)) {
      return cell;
    }
  }
  return null;
}



/**
 * Perform a full placement check for a piece at the given entry state.
 *
 * Computes the piece's occupied cells once, then applies the two collision
 * constraints in PRIORITY order:
 *   1. Floor violation — checked FIRST. A cell descending below gz = 0 is the
 *      more fundamental constraint, so it is reported ahead of any overlap.
 *   2. Overlap violation — checked only when the floor check passes. Tests the
 *      computed cells against `opts.occupiedCells`, honouring `opts.excludeCell`
 *      as the shared connection point with the preceding piece.
 *
 * Returns a discriminated `CollisionResult`:
 *   - `{ ok: false, reason: 'floor', cell }`   on a floor violation,
 *   - `{ ok: false, reason: 'overlap', cell }` on an overlap,
 *   - `{ ok: true }`                            when the placement is valid.
 */
export function checkPlacement(
  entry: GridState,
  piece: Piece,
  opts: CheckPlacementOpts,
): CollisionResult {
  const cells = computeCells(entry, piece);

  const floorCell = checkFloor(cells);
  if (floorCell !== null) {
    return { ok: false, reason: 'floor', cell: floorCell };
  }

  const overlapCell = checkOverlap(cells, opts.occupiedCells, opts.excludeCell);
  if (overlapCell !== null) {
    return { ok: false, reason: 'overlap', cell: overlapCell };
  }

  return { ok: true };
}



/**
 * Build the set of occupied cells for the pieces in the half-open range
 * [fromIndex, toIndex) of a track.
 *
 * `startState` is the entry state of piece index 0, so the cursor is advanced
 * from index 0 (not fromIndex) to reconstruct geometrically correct entry
 * states: each piece's entry depends on the cumulative effect of every piece
 * before it. We chain `applyPiece` across indices 0..toIndex-1, but only the
 * cells of pieces whose index falls within [fromIndex, toIndex) are collected
 * into the returned set. Pieces before fromIndex merely advance the cursor.
 *
 * Returns a `Set<CellKey>` suitable for O(1) overlap lookups via `checkOverlap`.
 */
export function buildOccupiedSet(
  pieces: PieceId[],
  startState: GridState,
  fromIndex: number,
  toIndex: number,
): Set<CellKey> {
  const occupied = new Set<CellKey>();
  const end = Math.min(toIndex, pieces.length);
  let cursor = startState;
  for (let i = 0; i < end; i++) {
    const piece = PIECES[pieces[i]];
    if (i >= fromIndex) {
      for (const cell of computeCells(cursor, piece)) {
        occupied.add(cellKey(cell.gx, cell.gy, cell.gz));
      }
    }
    cursor = applyPiece(cursor, piece);
  }
  return occupied;
}



/**
 * Build the set of occupied cells for the FROZEN-suffix pieces during editing
 * mode, using their snapshot entry states rather than recomputing positions.
 *
 * This is the key helper for AUTO-DETECTING frozen region collisions: while the
 * user rebuilds a track section after a deletion, the downstream pieces past the
 * edit point retain their original snapshot positions until a Rejoin. Those
 * snapshots live in `frozenEntries`, where `frozenEntries[j]` is the entry state
 * of the frozen piece at `pieces[frozenBoundary + j]`. We therefore use each
 * snapshot entry DIRECTLY (never re-deriving via applyPiece), so the frozen
 * cells stay fixed regardless of edits in the live region.
 *
 * For each `j` in 0..frozenEntries.length-1 we compute the piece's cells with
 * `computeCells(frozenEntries[j], PIECES[pieces[frozenBoundary + j]])` and add
 * every cell key to the returned set. The `frozenBoundary + j` index is guarded
 * against running past the end of the `pieces` array, so a `frozenEntries` array
 * longer than the available pieces simply stops at the last valid piece.
 *
 * Returns a `Set<CellKey>` suitable for O(1) overlap lookups via `checkOverlap`.
 */
export function buildFrozenOccupiedSet(
  pieces: PieceId[],
  frozenEntries: GridState[],
  frozenBoundary: number,
): Set<CellKey> {
  const occupied = new Set<CellKey>();
  for (let j = 0; j < frozenEntries.length; j++) {
    const index = frozenBoundary + j;
    if (index < 0 || index >= pieces.length) {
      continue;
    }
    const piece = PIECES[pieces[index]];
    for (const cell of computeCells(frozenEntries[j], piece)) {
      occupied.add(cellKey(cell.gx, cell.gy, cell.gz));
    }
  }
  return occupied;
}
