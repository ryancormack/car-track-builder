// track.js — Track data model. Linear sequence of pieces from a fixed start state.

import { PIECES, applyPiece } from './pieces/index.js';

export class Track {
  constructor() {
    this.dropHeight = 3;
    // Start cell, elevation, and direction. Centred on origin so the camera frames it.
    this.startState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing East
    this.pieces = []; // array of piece IDs
  }

  // Entry state for piece i (i.e., before piece i is applied).
  entryStateAt(i) {
    let s = { ...this.startState };
    for (let j = 0; j < i && j < this.pieces.length; j++) {
      const p = PIECES[this.pieces[j]];
      if (!p) break;
      s = applyPiece(s, p);
    }
    return s;
  }

  // State after all pieces — where the next piece would be placed.
  cursorState() {
    return this.entryStateAt(this.pieces.length);
  }

  canAdd(pieceId) {
    if (!PIECES[pieceId]) return false;
    if (this.hasFinish()) return false; // no pieces after FINISH
    return true;
  }

  addPiece(pieceId) {
    if (!this.canAdd(pieceId)) return false;
    this.pieces.push(pieceId);
    return true;
  }

  undo() {
    return this.pieces.pop();
  }

  clear() {
    this.pieces.length = 0;
  }

  hasFinish() {
    return this.pieces.length > 0 && this.pieces[this.pieces.length - 1] === 'FINISH';
  }

  totalPathLength() {
    return this.pieces.reduce((sum, id) => sum + (PIECES[id]?.pathLen ?? 0), 0);
  }

  countByCategory() {
    const counts = {};
    for (const id of this.pieces) {
      const p = PIECES[id]; if (!p) continue;
      counts[p.category] = (counts[p.category] ?? 0) + 1;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }

  toJSON() {
    return { dropHeight: this.dropHeight, pieces: [...this.pieces] };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    this.dropHeight = Math.max(0, Math.min(6, data.dropHeight ?? 3));
    this.pieces = Array.isArray(data.pieces) ? data.pieces.filter((id) => PIECES[id]) : [];
  }
}
