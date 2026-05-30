// track.ts — Track data model. Linear sequence of pieces from a fixed start state.
//
// Slots can be "emptied" (turned into a gap). An emptied slot preserves the
// *original* piece's geometric footprint (forward / turn / dz) so the rest of
// the track does NOT shift when a piece is deleted or replaced as a gap. The
// renderer draws emptied slots as faint placeholders and filled-but-unjoined
// slots with the new piece, but downstream geometry stays stable until the user
// explicitly presses "Rejoin" (see rejoin()).

import { PIECES, applyPiece, isPieceId } from './pieces/index.js';
import type { GridState, PieceId, TrackJSON } from './types.js';

export class Track {
  dropHeight = 3;
  // Start cell, elevation, and direction. Centred on origin so the camera frames it.
  startState: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing East
  pieces: PieceId[] = [];
  // Parallel to `pieces`: true where a slot is an empty gap (or filled but not
  // yet rejoined). Always kept the same length as `pieces` by every mutator.
  empties: boolean[] = [];
  // Parallel to `pieces`: when a slot becomes a gap, store the *original* piece
  // id so `entryStateAt` can use its footprint (keeping downstream stable). When
  // the user replaces the slot's visible piece but hasn't rejoined yet, the
  // original footprint is still what drives geometry.
  gapOriginals: (PieceId | null)[] = [];
  // Parallel to `pieces`: true for slots that were INSERTED (brand new, didn't
  // exist in the original track). These are skipped entirely when computing
  // entry states for non-gap (original downstream) pieces.
  inserted: boolean[] = [];

  // Entry state for piece i (i.e., before piece i is applied).
  //
  // Two modes depending on what we're computing FOR:
  //
  // 1. If piece i is UNJOINED (gap/inserted): use actual piece ids for all j < i
  //    so the new section chains correctly (e.g. a left bend → straight flows in
  //    the right direction).
  //
  // 2. If piece i is a NON-GAP piece (original downstream): use gapOriginals for
  //    any gap slots j < i, so the original downstream stays frozen until Rejoin.
  //
  // This means the new section you're building flows from one piece to the next,
  // while the original track beyond it stays put.
  entryStateAt(i: number): GridState {
    const targetIsGap = i < this.pieces.length && this.empties[i];
    let s: GridState = { ...this.startState };
    for (let j = 0; j < i && j < this.pieces.length; j++) {
      if (!targetIsGap && this.inserted[j]) {
        // Computing entry for a non-gap piece: skip inserted pieces entirely
        // (they didn't exist in the original track, so they shouldn't shift the
        // frozen downstream).
        continue;
      }
      let id: PieceId;
      if (targetIsGap) {
        // Computing entry for an unjoined piece: use actual pieces so the new
        // section chains correctly.
        id = this.pieces[j];
      } else if (this.empties[j] && this.gapOriginals[j]) {
        // Computing entry for a non-gap piece, and this slot is a gap: use the
        // frozen original so downstream doesn't shift.
        id = this.gapOriginals[j]!;
      } else {
        id = this.pieces[j];
      }
      const p = PIECES[id];
      s = applyPiece(s, p);
    }
    return s;
  }

  // State after all pieces — where the next piece would be placed.
  cursorState(): GridState {
    return this.entryStateAt(this.pieces.length);
  }

  isEmptyAt(index: number): boolean {
    return index >= 0 && index < this.empties.length && this.empties[index] === true;
  }

  /** Whether a gap slot has been filled with a new piece (but not yet rejoined). */
  isFilledGap(index: number): boolean {
    if (!this.isEmptyAt(index)) return false;
    // A "filled gap" is one where the visible piece differs from the original.
    return this.gapOriginals[index] !== null && this.pieces[index] !== this.gapOriginals[index];
  }

  /**
   * Whether a slot should render as a faint placeholder (truly empty gap that
   * hasn't been filled or inserted). Filled gaps, inserted pieces, and normal
   * pieces all render as solid track.
   */
  isUnfilledGap(index: number): boolean {
    if (!this.isEmptyAt(index)) return false;
    if (this.inserted[index]) return false;       // inserted = solid
    if (this.isFilledGap(index)) return false;    // filled = solid
    return true;
  }

  /** Number of filled (non-gap) slots. */
  nonEmptyCount(): number {
    let n = 0;
    for (let i = 0; i < this.pieces.length; i++) if (!this.empties[i]) n++;
    return n;
  }

  /** Any empty gaps currently in the track? */
  hasGaps(): boolean {
    return this.empties.some((e) => e === true);
  }

  /** Any gaps that have been filled but not yet rejoined? */
  hasPendingFills(): boolean {
    for (let i = 0; i < this.pieces.length; i++) {
      if (this.isFilledGap(i)) return true;
    }
    return false;
  }

  canAdd(pieceId: string): boolean {
    if (!isPieceId(pieceId)) return false;
    if (this.hasFinish()) return false; // no pieces after FINISH
    return true;
  }

  addPiece(pieceId: string): boolean {
    if (!isPieceId(pieceId) || !this.canAdd(pieceId)) return false;
    this.pieces.push(pieceId);
    this.empties.push(false);
    this.gapOriginals.push(null);
    this.inserted.push(false);
    return true;
  }

  // Removes a piece at the given index, splicing it out so the rest of the track
  // shifts back to close the gap ("compress" delete).
  removePieceAt(index: number): PieceId | undefined {
    if (index < 0 || index >= this.pieces.length) return undefined;
    this.empties.splice(index, 1);
    this.gapOriginals.splice(index, 1);
    this.inserted.splice(index, 1);
    return this.pieces.splice(index, 1)[0];
  }

  // "Gap" delete: empties the slot in place, preserving its footprint so nothing
  // downstream moves. Deleting the trailing slot (or an already-empty slot) has
  // nothing to hold open, so it splices out instead.
  emptyPieceAt(index: number): PieceId | undefined {
    if (index < 0 || index >= this.pieces.length) return undefined;
    if (index === this.pieces.length - 1 || this.empties[index]) {
      return this.removePieceAt(index);
    }
    this.empties[index] = true;
    this.gapOriginals[index] = this.pieces[index]; // store original for footprint
    return this.pieces[index];
  }

  // Replaces the *visible* piece at the given index. If the slot is a gap, it
  // stays marked as a gap (the original footprint is still used for downstream
  // geometry) until the user explicitly calls rejoin(). This means filling a gap
  // does NOT reposition anything downstream — the user stays in control.
  replacePieceAt(index: number, newId: PieceId): boolean {
    if (index < 0 || index >= this.pieces.length) return false;
    if (!isPieceId(newId)) return false;
    this.pieces[index] = newId;
    // If this was NOT a gap, just swap the piece normally (joined track edit).
    // If it IS a gap, keep it marked empty so downstream doesn't move yet.
    if (!this.empties[index]) {
      // Normal replace (not a gap): piece is immediately joined.
      this.gapOriginals[index] = null;
    }
    // else: keep empties[index] = true and gapOriginals[index] intact.
    return true;
  }

  /**
   * Insert a new piece after the given index, pushing subsequent pieces along.
   * The new piece is marked as a gap (unjoined) so downstream geometry stays
   * stable — the user must Rejoin when ready. This enables building out a new
   * multi-piece section in the middle of the track.
   */
  insertPieceAfter(index: number, pieceId: PieceId): boolean {
    if (index < -1 || index >= this.pieces.length) return false;
    if (!isPieceId(pieceId)) return false;
    const insertAt = index + 1;
    this.pieces.splice(insertAt, 0, pieceId);
    this.empties.splice(insertAt, 0, true);
    this.gapOriginals.splice(insertAt, 0, null);
    this.inserted.splice(insertAt, 0, true);
    return true;
  }

  /**
   * Rejoin the track: commit all pending gap-fills by clearing the empty flags
   * and gapOriginals. After this, `entryStateAt` will use the actual pieces
   * (including any new pieces placed in former gaps), which will reposition
   * downstream geometry as needed.
   */
  rejoin(): void {
    for (let i = 0; i < this.pieces.length; i++) {
      this.empties[i] = false;
      this.gapOriginals[i] = null;
      this.inserted[i] = false;
    }
  }

  undo(): PieceId | undefined {
    this.empties.pop();
    this.gapOriginals.pop();
    this.inserted.pop();
    return this.pieces.pop();
  }

  clear(): void {
    this.pieces.length = 0;
    this.empties.length = 0;
    this.gapOriginals.length = 0;
    this.inserted.length = 0;
  }

  hasFinish(): boolean {
    const n = this.pieces.length;
    return n > 0 && this.pieces[n - 1] === 'FINISH' && !this.empties[n - 1];
  }

  /** Track is playable: it has pieces, ends in a (filled) Finish, and no gaps. */
  isComplete(): boolean {
    return this.pieces.length > 0 && this.hasFinish() && !this.hasGaps();
  }

  totalPathLength(): number {
    let sum = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      if (this.empties[i]) continue;
      sum += PIECES[this.pieces[i]].pathLen;
    }
    return sum;
  }

  toJSON(): TrackJSON {
    return {
      dropHeight: this.dropHeight,
      pieces: [...this.pieces],
      empties: [...this.empties],
      gapOriginals: this.gapOriginals.map((g) => g ?? undefined),
      inserted: [...this.inserted],
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
    // Re-derive empties parallel to the validated piece list.
    const rawEmpties = Array.isArray(obj.empties) ? obj.empties : [];
    this.empties = this.pieces.map((_, i) => rawEmpties[i] === true);
    // Restore gapOriginals (tolerate missing/mismatched).
    const rawOriginals = Array.isArray((obj as Record<string, unknown>).gapOriginals)
      ? (obj as Record<string, unknown>).gapOriginals as unknown[]
      : [];
    this.gapOriginals = this.pieces.map((_, i) => {
      const val = (rawOriginals as unknown[])[i];
      return typeof val === 'string' && isPieceId(val) ? val : null;
    });
    // Restore inserted flags (tolerate missing).
    const rawInserted = Array.isArray((obj as Record<string, unknown>).inserted)
      ? (obj as Record<string, unknown>).inserted as unknown[]
      : [];
    this.inserted = this.pieces.map((_, i) => (rawInserted as unknown[])[i] === true);
  }
}
