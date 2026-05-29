// pieces/resolve.ts — context-aware path resolution for consecutive ramp pieces.
// When two ramps of the same type are adjacent, their shared joint should use a
// linear (constant-slope) profile instead of easing to zero, eliminating the
// flat "ladder step" artefact.

import { PIECES } from './definitions.js';
import { makeRampUpPath, makeRampDownPath } from './paths.js';
import type { PathFn, PieceId } from '../types.js';

/**
 * Resolve the effective path function for piece at `index` given its neighbors.
 * For ramp pieces, easing is suppressed at any joint shared with another ramp
 * of the same type (RAMP_UP next to RAMP_UP, or RAMP_DN next to RAMP_DN).
 * All other pieces return their default `pathLocal` unchanged.
 */
export function resolvePathLocal(pieces: PieceId[], index: number): PathFn {
  const id = pieces[index];
  if (id !== 'RAMP_UP' && id !== 'RAMP_DN') {
    return PIECES[id].pathLocal;
  }
  const prev = index > 0 ? pieces[index - 1] : null;
  const next = index < pieces.length - 1 ? pieces[index + 1] : null;
  // Ease at entry unless preceded by the same ramp type.
  const easeIn = prev !== id;
  // Ease at exit unless followed by the same ramp type.
  const easeOut = next !== id;
  if (id === 'RAMP_UP') return makeRampUpPath(easeIn, easeOut);
  return makeRampDownPath(easeIn, easeOut);
}
