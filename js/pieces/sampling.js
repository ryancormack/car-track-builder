// pieces/sampling.js — convert a piece-local path sample into world coords.

import { localToWorld } from './geometry.js';

/** World-space sample at parameter t along the given piece. */
export function piecePathAtT(piece, state, t) {
  const p = piece.pathLocal(t);
  const w = localToWorld(state, p.lx, p.ly, p.lz);
  return { ...w, banking: p.banking };
}

/** N+1 evenly-spaced samples along the piece (used by the renderer). */
export function samplePiecePath(piece, state, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(piecePathAtT(piece, state, i / n));
  return out;
}
