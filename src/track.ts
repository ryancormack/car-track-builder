// track.ts -- Track data model. Linear sequence of pieces from a fixed start state.
//
// Editing model: when a piece is deleted or inserted, the track snapshots the
// entry states of all downstream pieces ("frozen entries"). Downstream pieces
// keep their visual positions until the user presses Rejoin, at which point
// the frozen entries are cleared and everything recomputes from the actual
// piece sequence. No shadows, no ghosts, no gap placeholders.

import { PIECES, applyPiece, isPieceId } from './pieces/index.js';
import type { GridState, PieceId, TrackJSON } from './types.js';

export class Track {
  dropHeight = 3;
  // Start cell, elevation, and direction. Centred on origin so the camera frames it.
  startState: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing East
  pieces: PieceId[] = [];

  // Frozen entries: when the first edit of a session happens, we snapshot the
  // entry states of the pieces *downstream* of the edit. Those frozen positions
  // always apply to the LAST `frozenEntries.length` pieces of the track (a
  // trailing "frozen suffix"). As you add/remove pieces in the live region, the
  // boundary `pieces.length - frozenEntries.length` shifts automatically, so the
  // original downstream stays visually put until Rejoin. No editIndex/delta math.
  frozenEntries: GridState[] | null = null;

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

  canAdd(pieceId: string): boolean {
    if (!isPieceId(pieceId)) return false;
    if (this.hasFinish()) return false; // no pieces after FINISH
    return true;
  }

  addPiece(pieceId: string): boolean {
    if (!isPieceId(pieceId) || !this.canAdd(pieceId)) return false;
    this.pieces.push(pieceId);
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
    // First edit: freeze everything from this index onward (it shifts right).
    if (this.frozenEntries === null) this._freezeFrom(index);
    this.pieces.splice(index, 0, pieceId);
    return true;
  }

  /**
   * Replace the piece at the given index with a new one. It becomes a real piece
   * immediately; the frozen downstream after it stays put until Rejoin.
   */
  replaceAt(index: number, pieceId: PieceId): boolean {
    if (index < 0 || index >= this.pieces.length) return false;
    if (!isPieceId(pieceId)) return false;
    if (this.frozenEntries === null) this._freezeFrom(index + 1);
    this.pieces[index] = pieceId;
    return true;
  }

  /**
   * Rejoin: clear frozen entries. Everything recomputes from the actual piece
   * sequence, so the downstream repositions to connect to the new section.
   */
  rejoin(): void {
    this.frozenEntries = null;
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
    return this.pieces.pop();
  }

  clear(): void {
    this.pieces.length = 0;
    this.frozenEntries = null;
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
    };
  }

  fromJSON(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const obj = data as Record<string, unknown>;
    const dh = typeof obj.dropHeight === 'number' ? obj.dropHeight : 3;
    this.dropHeight = Math.max(0, Math.min(6, dh));
    const rawPieces = obj.pieces;
    this.pieces = Array.isArray(rawPieces)
      ? rawPieces.filter((id): id is PieceId => typeof id === 'string' && isPieceId(id))
      : [];
    // Clear any editing state on load.
    this.frozenEntries = null;
  }
}
