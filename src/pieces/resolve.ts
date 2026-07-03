// pieces/resolve.ts — context-aware path resolution for ramp pieces.
//
// A ramp on its own eases to level (grade 0) at both seams so it joins flat
// track without a crease. But when ramps are chained, easing every joint flat
// leaves a stair-step "shelf" between the sloped sections — most visible when
// the chained ramps have DIFFERENT steepness. To make any run of ramps read as
// one continuous incline, we blend the grade at a joint shared with a
// neighbouring ramp that runs the SAME vertical direction: both sides meet at
// the average of their natural grades, so the tangent is continuous (no crease)
// and there is no flat shelf. Against flat track, a non-ramp, or a ramp that
// REVERSES direction (a crest or dip), we still ease that end to level — giving
// a clean join or a smoothly rounded crest.

import { PIECES } from './definitions.js';
import { makeGradedRampPath } from './paths.js';
import type { PathFn, PieceId } from '../types.js';

// Ramp pieces eligible for slope-blending, keyed to their per-cell rise (grade).
// (forward = 1 for every ramp, so the natural grade equals the elevation change.)
const RAMP_GRADE: Partial<Record<PieceId, number>> = {
  RAMP_UP: 1,
  RAMP_DN: -1,
  STEEP_RAMP_UP: 2,
  STEEP_RAMP_DN: -2,
};

/** The blended seam grade between a ramp and a neighbour, or 0 to ease level. */
function jointGrade(self: number, neighbour: number | undefined): number {
  // Blend only with a ramp running the same way (both climbing / both
  // descending). Otherwise ease to level: a clean join to flat/non-ramp track,
  // or a rounded crest/dip where the direction reverses.
  if (neighbour !== undefined && Math.sign(neighbour) === Math.sign(self)) {
    return (self + neighbour) / 2;
  }
  return 0;
}

/**
 * Resolve the effective path function for piece at `index` given its neighbours.
 * Ramp pieces (standard and steep) blend their entry/exit grade with any
 * same-direction ramp neighbour so a chain — even of mixed steepness — forms one
 * continuous, crease-free incline. All other pieces return their default
 * `pathLocal` unchanged.
 */
export function resolvePathLocal(pieces: PieceId[], index: number): PathFn {
  const id = pieces[index];
  const grade = RAMP_GRADE[id];
  if (grade === undefined) {
    return PIECES[id].pathLocal;
  }
  const prevGrade = index > 0 ? RAMP_GRADE[pieces[index - 1]] : undefined;
  const nextGrade = index < pieces.length - 1 ? RAMP_GRADE[pieces[index + 1]] : undefined;
  return makeGradedRampPath(grade, jointGrade(grade, prevGrade), jointGrade(grade, nextGrade));
}
