// track.ts — Track data model. Linear sequence of pieces from a fixed start state.

import { PIECES, applyPiece, isPieceId } from './pieces/index.js';
import type { GridState, PieceId, TrackJSON } from './types.js';

export class Track {
  dropHeight = 3;
  // Start cell, elevation, and direction. Centred on origin so the camera frames it.
  startState: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing East
  pieces: PieceId[] = [];

  // Entry state for piece i (i.e., before piece i is applied).
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

  removePieceAt(index: number): PieceId | undefined {
    if (index < 0 || index >= this.pieces.length) return undefined;
    return this.pieces.splice(index, 1)[0];
  }

  replacePieceAt(index: number, newId: PieceId): boolean {
    if (index < 0 || index >= this.pieces.length) return false;
    this.pieces[index] = newId;
    return true;
  }

  undo(): PieceId | undefined {
    return this.pieces.pop();
  }

  clear(): void {
    this.pieces.length = 0;
  }

  hasFinish(): boolean {
    return this.pieces.length > 0 && this.pieces[this.pieces.length - 1] === 'FINISH';
  }

  totalPathLength(): number {
    return this.pieces.reduce((sum, id) => sum + PIECES[id].pathLen, 0);
  }

  toJSON(): TrackJSON {
    return { dropHeight: this.dropHeight, pieces: [...this.pieces] };
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
  }
}
