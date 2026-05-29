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

// --- Corkscrew easing ---------------------------------------------------------
// Trapezoidal rate profile for the corkscrew's spin: ramp the rotation rate up
// over the first `p` of the piece, hold it constant through the middle (uniform
// pitch — no bunched coils), then ramp down over the last `p`. The rate is zero
// at both ends, so the roll (and the path's lateral/vertical velocity) eases to
// nothing at the seams and the coil glides into straight track without a kink.
const CORK_EASE = 0.3; // fraction of the piece spent easing in / out at each end

// Integral over [0, x] of smoothstep s(u)=u^2(3-2u): the eased ramp for the
// rotation rate. (Closed form so easedProgress stays a cheap pure function.)
function smoothstepArea(x: number): number { return x * x * x - 0.5 * x * x * x * x; }

/** Eased progress in [0, 1]: smooth ease in/out at the ends, linear in the middle. */
function easedProgress(t: number): number {
  const p = CORK_EASE;
  const area = 1 - p; // area under the trapezoidal (peak = 1) rate profile
  if (t < p) return (p * smoothstepArea(t / p)) / area;
  if (t > 1 - p) return (area - p * smoothstepArea((1 - t) / p)) / area;
  return (0.5 * p + (t - p)) / area;
}

export const pathCorkscrew: PathFn = (t) => {
  // A parametric helix on its horizontal axis (the standard game-engine
  // corkscrew): x = k*theta, y = r*sin(theta), z = r*(1 - cos(theta)),
  // banking = theta. Forward travel (lx) stays linear so the piece spans its two
  // cells evenly and the tangent is always well defined; only the angle theta is
  // eased (easedProgress) so the spin glides in and out smoothly at the seams.
  const theta = 2 * Math.PI * easedProgress(t);
  const r = 0.4;
  return { lx: 2 * t, ly: r * Math.sin(theta), lz: r * (1 - Math.cos(theta)), banking: theta };
};

export const pathJump: PathFn = (t) => {
  // Spans two cells (lx: 0 -> 2): a take-off ramp, an airborne ballistic arc
  // over a one-cell gap, then a landing ramp. Net dz = 0. The renderer omits
  // the track over the middle so the gap reads as empty space.
  const lx = 2 * t;
  const lz = 1.15 * Math.sin(Math.PI * t);
  return { lx, ly: 0, lz, banking: 0 };
};
