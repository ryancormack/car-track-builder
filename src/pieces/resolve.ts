// pieces/resolve.ts — context-aware path resolution for consecutive ramp pieces.
// When two ramps of the same type are adjacent, their shared joint should use a
// linear (constant-slope) profile instead of easing to zero, eliminating the
// flat "ladder step" bump between them.

import { PIECES } from './definitions.js';
import {
  makeRampUpPath, makeRampDownPath,
  makeSteepRampUpPath, makeSteepRampDownPath,
} from './paths.js';
import type { PathFn, PieceId } from '../types.js';

// Ramp pieces and their context-aware path factories. Any piece in this map gets
// its entry/exit easing suppressed at a joint shared with another ramp of the
// SAME type, so a run of identical ramps forms one continuous slope.
const RAMP_FACTORIES: Partial<Record<PieceId, (easeIn: boolean, easeOut: boolean) => PathFn>> = {
  RAMP_UP: makeRampUpPath,
  RAMP_DN: makeRampDownPath,
  STEEP_RAMP_UP: makeSteepRampUpPath,
  STEEP_RAMP_DN: makeSteepRampDownPath,
};

/**
 * Resolve the effective path function for piece at `index` given its neighbors.
 * For ramp pieces (standard and steep), easing is suppressed at any joint shared
 * with another ramp of the same type, so a chain of identical ramps becomes a
 * single straight constant-grade incline rather than a series of bumps.
 * All other pieces return their default `pathLocal` unchanged.
 */
export function resolvePathLocal(pieces: PieceId[], index: number): PathFn {
  const id = pieces[index];
  const factory = RAMP_FACTORIES[id];
  if (!factory) {
    return PIECES[id].pathLocal;
  }
  const prev = index > 0 ? pieces[index - 1] : null;
  const next = index < pieces.length - 1 ? pieces[index + 1] : null;
  // Ease at entry unless preceded by the same ramp type; ease at exit unless
  // followed by the same ramp type.
  return factory(prev !== id, next !== id);
}
