// pieces/sampling.ts — convert a piece-local path sample into world coords.

import { localToWorld } from './geometry.js';
import type { GridState, PathFn, WorldSample } from '../types.js';

/** World-space sample at parameter t along the given path from the given entry state. */
export function piecePathAtT(path: PathFn, state: GridState, t: number): WorldSample {
  const p = path(t);
  const w = localToWorld(state, p.lx, p.ly, p.lz);
  return { ...w, banking: p.banking };
}

/** N+1 evenly-spaced samples along the path (used by the renderer). */
export function samplePiecePath(path: PathFn, state: GridState, n = 16): WorldSample[] {
  const out: WorldSample[] = [];
  for (let i = 0; i <= n; i++) out.push(piecePathAtT(path, state, i / n));
  return out;
}
