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

  // Frozen entries: when an edit-mode operation happens, we snapshot the entry
  // states for all pieces at or after the edit point. These frozen positions are
  // used by the renderer for downstream pieces until Rejoin.
  frozenEntries: GridState[] | null = null;
  // The index where editing started. Pieces at indices >= editIndex that existed
  // before the edit use their frozen entry state for rendering.
  editIndex: number | null = null;
  // How many pieces have been inserted/removed since editing started.
  // Positive means net insertions, negative means net deletions.
  private _editDelta = 0;

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
   * Entry state for rendering piece i. If frozen entries exist and this piece
   * is a "downstream original" (existed before the edit), return its frozen
   * position. Otherwise compute normally.
   */
  entryStateAt(i: number): GridState {
    if (this.frozenEntries && this.editIndex !== null) {
      // Pieces in the new/edited section (from editIndex up to editIndex + _editDelta - 1
      // for insertions, or the replacement point) compute normally so they chain.
      // Original downstream pieces (those that were at editIndex or later before
      // the edit) use their frozen state.
      const originalStart = this.editIndex + this._editDelta;
      if (i >= originalStart && i < this.pieces.length) {
        // Map this back to the frozen array. The frozen array was snapshotted
        // starting at editIndex in the original track.
        const frozenIdx = i - this._editDelta - this.editIndex;
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
   * Snapshot downstream entry states starting at the given index.
   * Only snapshots once per editing session (first edit wins).
   */
  private _snapshotDownstream(fromIndex: number): void {
    if (this.frozenEntries !== null) return; // already editing
    this.editIndex = fromIndex;
    this._editDelta = 0;
    // Snapshot entries for pieces from fromIndex to end.
    const entries: GridState[] = [];
    for (let i = fromIndex; i < this.pieces.length; i++) {
      entries.push(this.computeEntryAt(i));
    }
    this.frozenEntries = entries;
  }

  /**
   * Delete the piece at the given index. The piece is gone from the array.
   * Downstream pieces keep their frozen visual positions until Rejoin.
   */
  deleteAt(index: number): PieceId | undefined {
    if (index < 0 || index >= this.pieces.length) return undefined;
    this._snapshotDownstream(index);
    const removed = this.pieces.splice(index, 1)[0];
    this._editDelta--;
    return removed;
  }

  /**
   * Insert a new piece at the given index. The piece is real and chains
   * correctly from pieces before it. Downstream keeps frozen positions.
   */
  insertAt(index: number, pieceId: PieceId): boolean {
    if (index < 0 || index > this.pieces.length) return false;
    if (!isPieceId(pieceId)) return false;
    this._snapshotDownstream(index);
    this.pieces.splice(index, 0, pieceId);
    this._editDelta++;
    return true;
  }

  /**
   * Replace the piece at the given index. It becomes a real piece immediately.
   * Downstream keeps frozen positions.
   */
  replaceAt(index: number, pieceId: PieceId): boolean {
    if (index < 0 || index >= this.pieces.length) return false;
    if (!isPieceId(pieceId)) return false;
    this._snapshotDownstream(index);
    this.pieces[index] = pieceId;
    return true;
  }

  /**
   * Rejoin: clear frozen entries. Everything recomputes from actual pieces.
   * Downstream repositions to connect to the new section.
   */
  rejoin(): void {
    this.frozenEntries = null;
    this.editIndex = null;
    this._editDelta = 0;
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
    this.editIndex = null;
    this._editDelta = 0;
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
    this.editIndex = null;
    this._editDelta = 0;
  }
}
