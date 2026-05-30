// track.ts — Track data model. Linear sequence of pieces from a fixed start state.
//
// Slots can be "emptied" (turned into a gap). An emptied slot keeps its piece id
// — and therefore its geometric footprint (forward / turn / dz) — so the rest of
// the track does NOT shift when a piece is deleted as a gap. The renderer draws
// emptied slots as faint placeholders, and the slot can later be filled with a
// new piece via replacePieceAt(). This is what lets a player carve out a section
// (e.g. three straights) and build something new in its place without the track
// "compressing" around the hole.

import { PIECES, applyPiece, isPieceId } from './pieces/index.js';
import type { GridState, PieceId, TrackJSON } from './types.js';

export class Track {
  dropHeight = 3;
  // Start cell, elevation, and direction. Centred on origin so the camera frames it.
  startState: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing East
  pieces: PieceId[] = [];
  // Parallel to `pieces`: true where a slot is an empty gap. Always kept the
  // same length as `pieces` by every mutator below.
  empties: boolean[] = [];

  // Entry state for piece i (i.e., before piece i is applied). Emptied slots
  // still contribute their footprint, so downstream geometry is preserved.
  entryStateAt(i: number): GridState {
    let s: GridState = { ...this.startState };
    for (let j = 0; j < i && j < this.pieces.length; j++) {
      const p = PIECES[this.pieces[j]];
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

  canAdd(pieceId: string): boolean {
    if (!isPieceId(pieceId)) return false;
    if (this.hasFinish()) return false; // no pieces after FINISH
    return true;
  }

  addPiece(pieceId: string): boolean {
    if (!isPieceId(pieceId) || !this.canAdd(pieceId)) return false;
    this.pieces.push(pieceId);
    this.empties.push(false);
    return true;
  }

  // Removes a piece at the given index, splicing it out so the rest of the track
  // shifts back to close the gap ("compress" delete).
  removePieceAt(index: number): PieceId | undefined {
    if (index < 0 || index >= this.pieces.length) return undefined;
    this.empties.splice(index, 1);
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
    return this.pieces[index];
  }

  // Replaces a piece at the given index without geometric validation, and fills
  // the slot (clears any empty/gap flag). Users may freely swap any piece for
  // any other piece and the renderer will rebuild the track from the sequence.
  replacePieceAt(index: number, newId: PieceId): boolean {
    if (index < 0 || index >= this.pieces.length) return false;
    if (!isPieceId(newId)) return false;
    this.pieces[index] = newId;
    this.empties[index] = false;
    return true;
  }

  undo(): PieceId | undefined {
    this.empties.pop();
    return this.pieces.pop();
  }

  clear(): void {
    this.pieces.length = 0;
    this.empties.length = 0;
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
    return { dropHeight: this.dropHeight, pieces: [...this.pieces], empties: [...this.empties] };
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
    // Re-derive empties parallel to the validated piece list. Tolerate a missing
    // or mismatched-length array by padding/truncating to false.
    const rawEmpties = Array.isArray(obj.empties) ? obj.empties : [];
    this.empties = this.pieces.map((_, i) => rawEmpties[i] === true);
  }
}
