// track.ts -- Track data model. Linear sequence of pieces from a fixed start state.
//
// Editing model: when a piece is deleted or inserted, the track snapshots the
// entry states of all downstream pieces ("frozen entries"). Downstream pieces
// keep their visual positions until the user presses Rejoin, at which point
// the frozen entries are cleared and everything recomputes from the actual
// piece sequence. No shadows, no ghosts, no gap placeholders.

import { PIECES, applyPiece, isPieceId, canDecorate, isDecorationId } from './pieces/index.js';
import { MAX_DROP_HEIGHT } from './constants.js';
import {
  buildOccupiedSet,
  buildFrozenOccupiedSet,
  cellKey,
  checkOverlap,
  computeCells,
} from './collision.js';
import type { CellKey, CollisionResult, GridCell } from './collision.js';
import type { DecorationId, GridState, Piece, PieceId, TrackJSON } from './types.js';

export class Track {
  dropHeight = 3;
  // Start cell, elevation, and direction. Centred on origin so the camera frames it.
  startState: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing East
  pieces: PieceId[] = [];

  /**
   * Per-piece decorations (e.g. a Ring of Fire), aligned with `pieces` by index.
   * `decorations[i]` is the decoration on `pieces[i]`, or `null` for none. It is
   * spliced in lockstep with `pieces` by every mutation so the alignment holds.
   */
  decorations: (DecorationId | null)[] = [];

  // Frozen entries: when the first edit of a session happens, we snapshot the
  // entry states of the pieces *downstream* of the edit. Those frozen positions
  // always apply to the LAST `frozenEntries.length` pieces of the track (a
  // trailing "frozen suffix"). As you add/remove pieces in the live region, the
  // boundary `pieces.length - frozenEntries.length` shifts automatically, so the
  // original downstream stays visually put until Rejoin. No editIndex/delta math.
  frozenEntries: GridState[] | null = null;

  /**
   * Result of the last collision check performed by a mutation method. The
   * Editor reads this after a rejected addPiece/insertAt/replaceAt to choose the
   * appropriate error message. It is set on every mutation attempt (and cleared
   * to `{ ok: true }` on a successful placement) by tasks 3.2–3.5.
   */
  lastCollisionResult: CollisionResult | null = null;

  /** Index of the first frozen piece (start of the frozen suffix), or -1. */
  private get _frozenBoundary(): number {
    if (!this.frozenEntries) return -1;
    return this.pieces.length - this.frozenEntries.length;
  }

  /** Compute entry state for piece i by chaining piece geometry from the start. */
  computeEntryAt(i: number): GridState {
    let s: GridState = { ...this.startState };
    for (let j = 0; j < i && j < this.pieces.length; j++) {
      const p = PIECES[this.pieces[j]];
      s = applyPiece(s, p);
    }
    return s;
  }

  /**
   * Entry state for rendering piece i. Pieces in the frozen trailing suffix keep
   * their snapshot positions; everything before the boundary (the live region:
   * original pieces before the edit + any new pieces you've placed) is computed
   * normally so it chains correctly from the start.
   */
  entryStateAt(i: number): GridState {
    if (this.frozenEntries) {
      const boundary = this._frozenBoundary;
      if (i >= boundary && i < this.pieces.length) {
        const frozenIdx = i - boundary;
        if (frozenIdx >= 0 && frozenIdx < this.frozenEntries.length) {
          return { ...this.frozenEntries[frozenIdx] };
        }
      }
    }
    return this.computeEntryAt(i);
  }

  // State after all pieces -- where the next piece would be placed.
  cursorState(): GridState {
    return this.computeEntryAt(this.pieces.length);
  }

  /** Number of pieces in the track (all pieces are real). */
  nonEmptyCount(): number {
    return this.pieces.length;
  }

  /** Whether we are in editing mode (frozen entries active). */
  isEditing(): boolean {
    return this.frozenEntries !== null;
  }

  /**
   * Build the set of occupied grid cells that a candidate placement must be
   * checked against ("the checked region").
   *
   * - NORMAL mode (frozenEntries === null): every piece in the track
   *   contributes its cells, via `buildOccupiedSet` over the full range.
   * - EDITING mode (frozenEntries !== null): the LIVE region (indices
   *   0..frozenBoundary, exclusive) is rebuilt from the actual piece chain, and
   *   the FROZEN suffix contributes its snapshot cells via
   *   `buildFrozenOccupiedSet`. The union of the two is what AUTO-DETECTS
   *   collisions with the downstream frozen track while rebuilding — the user
   *   cannot accidentally build over the segments that still exist past the
   *   edit point.
   *
   * When `excludeIndex` is provided, the cells owned by the piece at that index
   * are omitted from the result. This is needed by replaceAt, which must check a
   * replacement piece against everything EXCEPT the piece it is replacing. The
   * exclusion is achieved by building the cell set piecewise around the excluded
   * index rather than subtracting cells afterwards (cells may be shared).
   */
  private _buildCheckedCells(excludeIndex?: number): Set<CellKey> {
    const editing = this.frozenEntries !== null;
    const boundary = editing ? this._frozenBoundary : this.pieces.length;
    const cells = new Set<CellKey>();

    // Live region: pieces [0, boundary). If the excluded index falls here, build
    // the ranges on either side of it and union them so its cells are omitted.
    if (excludeIndex !== undefined && excludeIndex >= 0 && excludeIndex < boundary) {
      for (const key of buildOccupiedSet(this.pieces, this.startState, 0, excludeIndex)) {
        cells.add(key);
      }
      for (const key of buildOccupiedSet(this.pieces, this.startState, excludeIndex + 1, boundary)) {
        cells.add(key);
      }
    } else {
      for (const key of buildOccupiedSet(this.pieces, this.startState, 0, boundary)) {
        cells.add(key);
      }
    }

    // Frozen region (editing mode only): the downstream suffix keeps its
    // snapshot positions. Including these cells is what auto-detects overlaps
    // with the frozen track during a rebuild (Requirement 7).
    if (editing && this.frozenEntries) {
      if (excludeIndex !== undefined && excludeIndex >= boundary && excludeIndex < this.pieces.length) {
        // The excluded piece lives in the frozen suffix: rebuild the frozen
        // cells piecewise from the snapshot entries, skipping that one index.
        for (let j = 0; j < this.frozenEntries.length; j++) {
          const index = boundary + j;
          if (index === excludeIndex || index >= this.pieces.length) continue;
          for (const cell of computeCells(this.frozenEntries[j], PIECES[this.pieces[index]])) {
            cells.add(cellKey(cell.gx, cell.gy, cell.gz));
          }
        }
      } else {
        for (const key of buildFrozenOccupiedSet(this.pieces, this.frozenEntries, boundary)) {
          cells.add(key);
        }
      }
    }

    return cells;
  }

  /**
   * The connection-point cell to exclude from overlap checks for a candidate
   * piece at `index`. This is the candidate's entry cell — the point it shares
   * with its predecessor's exit. Returns `null` for index 0 (or any non-positive
   * index), where there is no predecessor and thus no shared connection point.
   */
  private _getExcludeCell(index: number): CellKey | null {
    if (index <= 0) return null;
    const entry = this.computeEntryAt(index);
    return cellKey(entry.gx, entry.gy, entry.gz);
  }

  /**
   * Validate placing `piece` at entry state `entry`. Shared by
   * addPiece/insertAt/replaceAt so the floor and overlap rules stay consistent
   * across every editing operation.
   *
   * Floor rule (Requirements 1 & 6): a cell is below the floor when
   * `gz + dropHeight < 0`. The whole track sits `dropHeight` above the floor
   * (startState.gz = 0 is the build plane), so the natural gz values are offset
   * by dropHeight before comparing against the floor. Both the OWNED cells
   * (`computeCells`) AND the EXIT cell (`applyPiece`) are checked, because
   * computeCells deliberately excludes the exit position — a single-cell
   * descent (e.g. RAMP_DN at the build plane) must still be rejected on its
   * exit gz alone.
   *
   * Overlap rule (Requirement 2): checked in the natural gz = 0 frame (overlap
   * is translation-invariant, so no dropHeight offset) against the checked
   * region — live cells plus, in editing mode, the frozen suffix — excluding the
   * shared connection point with the predecessor.
   */
  private _checkPlacement(
    entry: GridState,
    piece: Piece,
    excludeIndex: number | undefined,
    connectionIndex: number,
    excludeExitSeam: boolean,
  ): CollisionResult {
    const cells = computeCells(entry, piece);
    const exit = applyPiece(entry, piece);

    // Floor: owned cells + the exit cell. The ground is the build plane (gz = 0,
    // where the room floor is drawn), so NO piece may descend below it,
    // regardless of drop height. (Drop height only controls the start tower's
    // height / launch energy — it must never change how deep you can build.)
    const floorPts: GridCell[] = [...cells, { gx: exit.gx, gy: exit.gy, gz: exit.gz }];
    for (const c of floorPts) {
      if (c.gz < 0) {
        return { ok: false, reason: 'floor', cell: c };
      }
    }

    // Overlap: against the checked region (live + frozen in editing mode),
    // excluding the connection point shared with the predecessor.
    const occupied = this._buildCheckedCells(excludeIndex);

    // Forward connection seam: a piece placed via INSERT or REPLACE connects its
    // EXIT cell into the existing downstream track (the successor it leads into,
    // or the frozen suffix's first entry when refilling a one-cell gap). That
    // single shared exit cell is a legitimate connection, not an overlap, so it
    // is dropped from the occupied set before the scan. APPEND has no downstream
    // ahead of it, so its exit cell stays checked — this is what now catches a
    // single-cell loop-back onto an already-occupied cell (Bug 1). All other
    // coincidences (intermediate/landing cells against the frozen region) remain
    // rejected, preserving the frozen-region auto-detection.
    if (excludeExitSeam) {
      occupied.delete(cellKey(exit.gx, exit.gy, exit.gz));
    }

    const excludeCell = this._getExcludeCell(connectionIndex);
    const overlap = checkOverlap(cells, occupied, excludeCell);
    if (overlap !== null) {
      return { ok: false, reason: 'overlap', cell: overlap };
    }

    return { ok: true };
  }

  canAdd(pieceId: string): boolean {
    if (!isPieceId(pieceId)) return false;
    if (this.hasFinish()) return false; // no pieces after FINISH
    return true;
  }

  addPiece(pieceId: string): boolean {
    if (!isPieceId(pieceId) || !this.canAdd(pieceId)) return false;
    const entry = this.cursorState();
    const result = this._checkPlacement(entry, PIECES[pieceId], undefined, this.pieces.length, false);
    this.lastCollisionResult = result;
    if (!result.ok) return false;
    this.pieces.push(pieceId);
    this.decorations.push(null);
    return true;
  }

  /**
   * Begin a freeze session by snapshotting the entry states of the pieces from
   * `fromIndex` to the end (the "downstream" that should stay put). No-ops if
   * already editing, or if there is nothing downstream to freeze (so deleting or
   * replacing the trailing piece stays a clean, non-editing operation).
   */
  private _freezeFrom(fromIndex: number): void {
    if (this.frozenEntries !== null) return; // already editing
    if (fromIndex >= this.pieces.length) return; // nothing downstream to freeze
    const entries: GridState[] = [];
    for (let i = fromIndex; i < this.pieces.length; i++) {
      entries.push(this.computeEntryAt(i));
    }
    this.frozenEntries = entries;
  }

  /** If the frozen suffix has been emptied out, exit editing mode. */
  private _maybeEndEdit(): void {
    if (this.frozenEntries && this.frozenEntries.length === 0) {
      this.frozenEntries = null;
    }
  }

  /**
   * Delete the piece at the given index. The piece is removed from the array
   * entirely. The downstream (pieces after it) keeps its frozen visual positions
   * until Rejoin, so the rest of the track does not jump around.
   */
  deleteAt(index: number): PieceId | undefined {
    if (index < 0 || index >= this.pieces.length) return undefined;
    if (this.frozenEntries === null) {
      // First edit: freeze everything strictly after the deleted piece.
      this._freezeFrom(index + 1);
    } else if (index >= this._frozenBoundary) {
      // Deleting a piece that's part of the frozen suffix: drop its frozen entry.
      this.frozenEntries.splice(index - this._frozenBoundary, 1);
    }
    const removed = this.pieces.splice(index, 1)[0];
    this.decorations.splice(index, 1);
    this._maybeEndEdit();
    return removed;
  }

  /**
   * Insert a new piece at the given index. The piece is real and chains from the
   * pieces before it; the frozen downstream stays put until Rejoin.
   */
  insertAt(index: number, pieceId: PieceId): boolean {
    if (index < 0 || index > this.pieces.length) return false;
    if (!isPieceId(pieceId)) return false;
    // Validate the placement BEFORE any state mutation (no _freezeFrom, no
    // splice) so a rejected insert leaves frozenEntries and pieces untouched
    // (Requirement 3.4 atomicity). The entry state for a piece inserted at
    // `index` is the live-chained state at that position — what the inserted
    // piece's predecessor leads into. `excludeIndex` is undefined (an insert
    // adds a new piece; it replaces nothing) and `connectionIndex` is `index`
    // (the inserted piece's entry/connection cell shared with its predecessor).
    // In editing mode `_buildCheckedCells` includes the frozen suffix, so this
    // auto-detects overlaps with the downstream frozen region (Requirement 7).
    const entry = this.computeEntryAt(index);
    const result = this._checkPlacement(entry, PIECES[pieceId], undefined, index, true);
    this.lastCollisionResult = result;
    if (!result.ok) return false;
    // First edit: freeze everything from this index onward (it shifts right).
    if (this.frozenEntries === null) this._freezeFrom(index);
    this.pieces.splice(index, 0, pieceId);
    this.decorations.splice(index, 0, null);
    return true;
  }

  /**
   * Replace the piece at the given index with a new one. It becomes a real piece
   * immediately; the frozen downstream after it stays put until Rejoin.
   */
  replaceAt(index: number, pieceId: PieceId): boolean {
    if (index < 0 || index >= this.pieces.length) return false;
    if (!isPieceId(pieceId)) return false;
    // Validate the placement BEFORE any state mutation (no _freezeFrom, no
    // array assignment) so a rejected replace leaves frozenEntries and pieces
    // untouched (Requirement 3.4 atomicity). The entry state for the piece at
    // `index` is its live-chained state. `excludeIndex` is `index` so the OLD
    // piece's own cells are removed from the checked region — we are replacing
    // it, so it must not count as a collision against itself (Requirement 3.3).
    // `connectionIndex` is `index` (the shared entry/connection cell with the
    // predecessor). In editing mode `_buildCheckedCells` includes the frozen
    // suffix, auto-detecting overlaps with the downstream region (Requirement 7).
    const entry = this.computeEntryAt(index);
    const result = this._checkPlacement(entry, PIECES[pieceId], index, index, true);
    this.lastCollisionResult = result;
    if (!result.ok) return false;
    if (this.frozenEntries === null) this._freezeFrom(index + 1);
    this.pieces[index] = pieceId;
    // Drop the decoration if the new piece type can't carry it.
    if (this.decorations[index] && !canDecorate(pieceId)) this.decorations[index] = null;
    return true;
  }

  /**
   * Validate the ENTIRE piece sequence as one continuous chain, ignoring the
   * frozen snapshots. Chains `applyPiece` from `startState` through every piece
   * and, for each, checks:
   *   (a) floor — every cell of `computeCells` satisfies `gz + dropHeight >= 0`;
   *   (b) overlap — each cell key (excluding the piece's own entry cell, which
   *       is the legitimate seam shared with its predecessor's exit) is not
   *       already present in an accumulating occupied set.
   * Cells are accumulated AFTER the per-piece checks so a piece never collides
   * with itself. Returns true when the whole recomputed track is valid.
   */
  private _validateContinuous(): boolean {
    const occupied = new Set<CellKey>();
    let cursor: GridState = { ...this.startState };
    for (let i = 0; i < this.pieces.length; i++) {
      const piece = PIECES[this.pieces[i]];
      const cells = computeCells(cursor, piece);

      // (a) Floor: the ground is the build plane (gz = 0); nothing may go below.
      for (const c of cells) {
        if (c.gz < 0) return false;
      }

      // (b) Overlap: exclude the piece's own entry cell (the predecessor seam).
      const entryKey = cellKey(cursor.gx, cursor.gy, cursor.gz);
      for (const c of cells) {
        const key = cellKey(c.gx, c.gy, c.gz);
        if (key === entryKey) continue;
        if (occupied.has(key)) return false;
      }

      // Accumulate this piece's cells only after its own checks pass.
      for (const c of cells) {
        occupied.add(cellKey(c.gx, c.gy, c.gz));
      }

      cursor = applyPiece(cursor, piece);
    }
    return true;
  }

  /**
   * Rejoin: reconnect the live region to the frozen downstream by RE-ANCHORING
   * and RECOMPUTING the whole track, then (on success) clear the frozen entries
   * so everything recomputes from the actual piece sequence and the downstream
   * repositions to connect to the new section.
   *
   * Rather than demanding the live exit exactly match the original frozen `[0]`
   * snapshot, we re-chain the entire `pieces` array from `startState` and accept
   * the rejoin whenever that recomputed track is valid (no floor or overlap
   * violation, via `_validateContinuous`). This lets a rebuilt section of a
   * DIFFERENT length — or simply closing a deleted gap — reconnect: the
   * downstream re-anchors onto the live exit and the track becomes continuous.
   *
   * On success we clear `frozenEntries` so `entryStateAt` recomputes every
   * piece by chaining (the downstream visually shifts to connect). If the
   * recomputed downstream would be invalid (it drives below the floor or back
   * over the live region), we keep `frozenEntries` intact, stay in editing mode,
   * and return `false`; `main.ts` surfaces the "doesn't connect" status.
   *
   * No-op success cases (return `true` without rejecting):
   * - Not editing (`frozenEntries === null`): nothing to rejoin.
   * - Empty frozen suffix (`length === 0`): nothing downstream to connect to.
   */
  rejoin(): boolean {
    // Not editing: nothing to validate or clear.
    if (this.frozenEntries === null) return true;
    // Empty frozen suffix: nothing downstream; clear and succeed.
    if (this.frozenEntries.length === 0) {
      this.frozenEntries = null;
      return true;
    }
    // Re-anchor and recompute: if the whole chained track is valid, commit by
    // clearing the frozen snapshots so the downstream repositions to connect.
    if (this._validateContinuous()) {
      this.frozenEntries = null;
      return true;
    }
    // Genuinely cannot connect: stay in editing mode.
    return false;
  }

  // Legacy removePieceAt - now delegates to deleteAt
  removePieceAt(index: number): PieceId | undefined {
    return this.deleteAt(index);
  }

  // Legacy replacePieceAt - now delegates to replaceAt
  replacePieceAt(index: number, newId: PieceId): boolean {
    return this.replaceAt(index, newId);
  }

  // Legacy insertPieceAfter - now delegates to insertAt
  insertPieceAfter(index: number, pieceId: PieceId): boolean {
    if (index < -1 || index >= this.pieces.length) return false;
    return this.insertAt(index + 1, pieceId);
  }

  undo(): PieceId | undefined {
    this.decorations.pop();
    return this.pieces.pop();
  }

  clear(): void {
    this.pieces.length = 0;
    this.decorations.length = 0;
    this.frozenEntries = null;
  }

  /**
   * Toggle a decoration on the piece at `index`. Returns the resulting state:
   * `true` if a decoration is now present, `false` if it was removed or the
   * placement was rejected (incompatible piece / out of range). Placing a
   * decoration that is already present with the same id removes it (toggle).
   */
  toggleDecoration(index: number, decoId: DecorationId): boolean {
    if (index < 0 || index >= this.pieces.length) return false;
    if (!isDecorationId(decoId)) return false;
    if (!canDecorate(this.pieces[index])) return false;
    this.decorations[index] = this.decorations[index] === decoId ? null : decoId;
    return this.decorations[index] !== null;
  }

  /** The decoration on piece `index`, or null. */
  decorationAt(index: number): DecorationId | null {
    return this.decorations[index] ?? null;
  }

  hasFinish(): boolean {
    const n = this.pieces.length;
    return n > 0 && this.pieces[n - 1] === 'FINISH';
  }

  /** Track is playable: it has pieces, ends in Finish, and is not currently editing. */
  isComplete(): boolean {
    return this.pieces.length > 0 && this.hasFinish() && !this.isEditing();
  }

  totalPathLength(): number {
    let sum = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      sum += PIECES[this.pieces[i]].pathLen;
    }
    return sum;
  }

  toJSON(): TrackJSON {
    return {
      dropHeight: this.dropHeight,
      pieces: [...this.pieces],
      decorations: [...this.decorations],
    };
  }

  fromJSON(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const obj = data as Record<string, unknown>;
    const dh = typeof obj.dropHeight === 'number' ? obj.dropHeight : 3;
    this.dropHeight = Math.max(0, Math.min(MAX_DROP_HEIGHT, dh));
    const rawPieces = obj.pieces;
    this.pieces = Array.isArray(rawPieces)
      ? rawPieces.filter((id): id is PieceId => typeof id === 'string' && isPieceId(id))
      : [];
    // Decorations: aligned with pieces by index. Coerce to the right length and
    // validate ids (legacy saves without the field get an all-null array).
    const rawDecos = Array.isArray(obj.decorations) ? obj.decorations : [];
    this.decorations = this.pieces.map((pieceId, i) => {
      const d = rawDecos[i];
      if (typeof d === 'string' && isDecorationId(d) && canDecorate(pieceId)) return d;
      return null;
    });
    // Clear any editing state on load.
    this.frozenEntries = null;
  }
}
