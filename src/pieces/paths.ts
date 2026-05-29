// pieces/paths.ts — parametric path samplers, one per piece type.
// Each returns { lx, ly, lz, banking } at t in [0, 1] in piece-local coords.
// Pure functions of t — easy to unit-test for continuity and end-points.

import type { PathFn } from '../types.js';

export const pathStraight: PathFn = (t) => ({ lx: t, ly: 0, lz: 0, banking: 0 });

export const pathCurveR: PathFn = (t) => {
  // Quarter circle from (0, 0) to (0.5, 0.5), centred at (0, 0.5), radius 0.5.
  const a = -Math.PI / 2 + (Math.PI / 2) * t;
  return { lx: 0.5 * Math.cos(a), ly: 0.5 + 0.5 * Math.sin(a), lz: 0, banking: 0 };
};

export const pathCurveL: PathFn = (t) => {
  // Quarter circle from (0, 0) to (0.5, -0.5), centred at (0, -0.5), radius 0.5.
  const a = Math.PI / 2 - (Math.PI / 2) * t;
  return { lx: 0.5 * Math.cos(a), ly: -0.5 + 0.5 * Math.sin(a), lz: 0, banking: 0 };
};

export const pathRampUp: PathFn = (t) => ({ lx: t, ly: 0, lz: t, banking: 0 });
export const pathRampDown: PathFn = (t) => ({ lx: t, ly: 0, lz: -t, banking: 0 });

export const pathLoop: PathFn = (t) => {
  // Approach (0..0.1): straight from back edge to loop bottom (lx=0.5, lz=0).
  // Loop (0.1..0.9): full 360° vertical circle in xz-plane, radius R, centre (0.5, 0, R).
  // Depart (0.9..1.0): straight from loop bottom to front edge (lx=1, lz=0).
  const R = 0.5;
  if (t < 0.1) return { lx: (t / 0.1) * 0.5, ly: 0, lz: 0, banking: 0 };
  if (t > 0.9) return { lx: 0.5 + ((t - 0.9) / 0.1) * 0.5, ly: 0, lz: 0, banking: 0 };
  const u = (t - 0.1) / 0.8;
  const a = -Math.PI / 2 + 2 * Math.PI * u;
  return {
    lx: 0.5 + R * Math.cos(a),
    ly: 0,
    lz: R + R * Math.sin(a),
    banking: 0,
  };
};

export const pathCorkscrew: PathFn = (t) => {
  // Barrel roll spanning two cells (lx: 0 -> 2): the centreline traces a single
  // helical loop (radius R) stretched over the extra length so it reads as a
  // clean, graceful corkscrew rather than a cramped knot. The spin is eased with
  // smootherstep so the piece enters and exits flat — ly = lz = 0 and banking = 0
  // at both ends — joining cleanly onto neighbouring track.
  const s = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: S(0)=0, S(1)=1, S'=0 at ends
  const a = 2 * Math.PI * s;
  const R = 0.4;
  return { lx: 2 * t, ly: R * Math.sin(a), lz: R * (1 - Math.cos(a)), banking: a };
};

export const pathJump: PathFn = (t) => {
  // Spans two cells (lx: 0 -> 2): a take-off ramp, an airborne ballistic arc
  // over a one-cell gap, then a landing ramp. Net dz = 0. The renderer omits
  // the track over the middle so the gap reads as empty space.
  const lx = 2 * t;
  const lz = 1.15 * Math.sin(Math.PI * t);
  return { lx, ly: 0, lz, banking: 0 };
};
