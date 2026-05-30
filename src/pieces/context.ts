// pieces/context.ts — resolves a placed piece into its *effective* shape given
// its neighbours. Only ramps are context-sensitive: a ramp keeps full grade at
// any end that abuts another ramp of the same kind (so a run of ramps is one
// straight incline) and eases to flat at any end that meets non-matching track
// (so it joins level track smoothly, and crests/valleys round off). Every other
// piece is returned from the catalogue unchanged.

import { PIECES } from './definitions.js';
import { rampLz } from './paths.js';
import type { Piece, PieceId } from '../types.js';

const RAMPS: ReadonlySet<PieceId> = new Set<PieceId>(['RAMP_UP', 'RAMP_DN']);

/** True when the neighbour is the same ramp kind, i.e. the run continues. */
function continues(neighbour: PieceId | undefined, id: PieceId): boolean {
  return neighbour === id;
}

/**
 * The effective piece at `index` within `pieces`, with ramp grades adjusted for
 * its neighbours. The returned object is a shallow copy with an overridden
 * `pathLocal`, so all downstream consumers (renderer, simulator) work unchanged.
 */
export function resolvePiece(pieces: readonly PieceId[], index: number): Piece {
  const id = pieces[index];
  const piece = PIECES[id];
  if (!RAMPS.has(id)) return piece;

  const easeIn = !continues(pieces[index - 1], id);   // flat unless a same ramp precedes
  const easeOut = !continues(pieces[index + 1], id);  // flat unless a same ramp follows
  const dz = piece.dz;
  return {
    ...piece,
    pathLocal: (t) => ({ lx: t, ly: 0, lz: rampLz(t, dz, easeIn, easeOut), banking: 0 }),
  };
}
