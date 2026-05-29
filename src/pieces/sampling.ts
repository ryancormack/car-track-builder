// pieces/sampling.ts — convert a piece-local path sample into world coords.

import { localToWorld } from './geometry.js';
import type { GridState, Piece, WorldSample } from '../types.js';

/** World-space sample at parameter t along the given piece. */
export function piecePathAtT(piece: Piece, state: GridState, t: number): WorldSample {
  const p = piece.pathLocal(t);
  const w = localToWorld(state, p.lx, p.ly, p.lz);
  return { ...w, banking: p.banking };
}

/** N+1 evenly-spaced samples along the piece (used by the renderer). */
export function samplePiecePath(piece: Piece, state: GridState, n = 16): WorldSample[] {
  const out: WorldSample[] = [];
  for (let i = 0; i <= n; i++) out.push(piecePathAtT(piece, state, i / n));
  return out;
}
