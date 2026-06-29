// pieces/paths.ts — parametric path samplers, one per piece type.
// Each returns { lx, ly, lz, banking } at t in [0, 1] in piece-local coords.
// Pure functions of t — easy to unit-test for continuity and end-points.

import type { LocalPoint, PathFn } from '../types.js';
import { CURVE_RADIUS, SPIRAL_RADIUS, HELIX_RADIUS, SPIRAL_TOWER_RADIUS, GIANT_LOOP_RADIUS } from '../constants.js';

export const pathStraight: PathFn = (t) => ({ lx: t, ly: 0, lz: 0, banking: 0 });

export const pathCurveR: PathFn = (t) => {
  // Quarter circle from (0, 0) to (R, R), centred at (0, R), radius R.
  const R = CURVE_RADIUS;
  const a = -Math.PI / 2 + (Math.PI / 2) * t;
  return { lx: R * Math.cos(a), ly: R + R * Math.sin(a), lz: 0, banking: 0 };
};

export const pathCurveL: PathFn = (t) => {
  // Quarter circle from (0, 0) to (R, -R), centred at (0, -R), radius R.
  const R = CURVE_RADIUS;
  const a = Math.PI / 2 - (Math.PI / 2) * t;
  return { lx: R * Math.cos(a), ly: -R + R * Math.sin(a), lz: 0, banking: 0 };
};

// Ramps change elevation by one unit. The elevation profile is a cubic Hermite
// interpolant from (0,0) to (1,1) with configurable entry/exit slopes. When
// easeIn is true, slope=0 at t=0 (smooth join to flat track); when false,
// slope=1 (linear join to a neighboring ramp). Likewise for easeOut at t=1.
function rampElevation(t: number, easeIn: boolean, easeOut: boolean): number {
  const m0 = easeIn ? 0 : 1;
  const m1 = easeOut ? 0 : 1;
  const t2 = t * t;
  const t3 = t2 * t;
  // Hermite basis: H(t) = h01*p1 + h10*m0 + h11*m1  (p0 = 0, p1 = 1)
  return (-2 * t3 + 3 * t2) + (t3 - 2 * t2 + t) * m0 + (t3 - t2) * m1;
}

/** Factory for context-aware ramp-up paths. */
export function makeRampUpPath(easeIn: boolean, easeOut: boolean): PathFn {
  return (t) => ({ lx: t, ly: 0, lz: rampElevation(t, easeIn, easeOut), banking: 0 });
}

/** Factory for context-aware ramp-down paths. */
export function makeRampDownPath(easeIn: boolean, easeOut: boolean): PathFn {
  return (t) => ({ lx: t, ly: 0, lz: -rampElevation(t, easeIn, easeOut), banking: 0 });
}

// Default both-eased variants: zero slope at both ends, so they join flat track
// (and each other in the legacy sense) with no sharp crease.
export const pathRampUp: PathFn = makeRampUpPath(true, true);
export const pathRampDown: PathFn = makeRampDownPath(true, true);

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
export function easedProgress(t: number): number {
  const p = CORK_EASE;
  const area = 1 - p; // area under the trapezoidal (peak = 1) rate profile
  if (t < p) return (p * smoothstepArea(t / p)) / area;
  if (t > 1 - p) return (area - p * smoothstepArea((1 - t) / p)) / area;
  return (0.5 * p + (t - p)) / area;
}

export const pathCorkscrew: PathFn = (t) => {
  // A parametric helix on its horizontal axis (the standard game-engine
  // corkscrew): x = k*theta, y = r*sin(theta), z = r*(1 - cos(theta)),
  // banking = theta. Spread over THREE cells (lx = 3*t) so a single 360° roll is
  // nice and gentle. Forward travel stays linear so the piece spans its three
  // cells evenly and the tangent is always well defined; only the angle theta is
  // eased (easedProgress) so the spin glides in and out smoothly at the seams.
  const theta = 2 * Math.PI * easedProgress(t);
  const r = 0.4;
  return { lx: 3 * t, ly: r * Math.sin(theta), lz: r * (1 - Math.cos(theta)), banking: theta };
};

export const pathJump: PathFn = (t) => {
  // Spans two cells (lx: 0 -> 2): a take-off ramp, an airborne ballistic arc
  // over a one-cell gap, then a landing ramp. Net dz = 0. The renderer omits
  // the track over the middle so the gap reads as empty space.
  const lx = 2 * t;
  const lz = 1.15 * Math.sin(Math.PI * t);
  return { lx, ly: 0, lz, banking: 0 };
};

// --- Barrel-helix construction (shared by spiral + helix) ---------------------
// A descending/ascending coil built exactly like the corkscrew: the cross-section
// (ly, lz_barrel) traces a circle of radius r whose centre sits one radius above
// the centreline, so the surface normal {0, -sin θ, cos θ} points radially to the
// coil axis at every sample. Net elevation is added as dz·p, a uniform vertical
// shift of BOTH the centreline and the (conceptual) coil axis — this keeps the
// normal radial, so the road renders cleanly (the same reason the corkscrew works).
//
// Using easedProgress for the angle makes the roll-rate (and the lateral/vertical
// velocity) ease to zero at both seams, so the piece joins flat track without a
// kink. With an integer number of turns, ly and the barrel term both return to 0
// at t=1, leaving a clean net elevation change of exactly dz.
function barrelHelix(t: number, forward: number, r: number, turns: number, dz: number): LocalPoint {
  const p = easedProgress(t);
  const theta = turns * 2 * Math.PI * p;
  return {
    lx: forward * t,
    ly: r * Math.sin(theta),
    lz: r * (1 - Math.cos(theta)) + dz * p,
    banking: theta,
  };
}

export const pathSpiral: PathFn = (t) =>
  // One clean descending loop over 2 cells, dropping 2 units. A single full turn
  // (like the helix and corkscrew) reads clearly in the iso view; an earlier
  // 2-turn version packed two coils into 2 cells and looked tangled even though
  // each frame was individually correct.
  barrelHelix(t, 2, SPIRAL_RADIUS, 1, -2);

export const pathSteepHill: PathFn = (t) => {
  // Steep symmetric hill: rises to 1.5 units at midpoint, returns to 0.
  return { lx: 2 * t, ly: 0, lz: 1.5 * Math.sin(Math.PI * t), banking: 0 };
};

export const pathHelixDown: PathFn = (t) =>
  // One big descending coil over 3 cells, dropping 3 units. Parking-garage style
  // but built as a barrel coil so the banked road surface renders correctly.
  barrelHelix(t, 3, HELIX_RADIUS, 1, -3);

export const pathHelixUp: PathFn = (t) =>
  // One big ascending coil over 3 cells, climbing 3 units. Needs real entry speed.
  barrelHelix(t, 3, HELIX_RADIUS, 1, 3);

export const pathSpiralTower: PathFn = (t) =>
  // Tall multi-coil descent: 2 full turns dropping 4 units over 4 cells. Spread
  // over 4 cells (2 per turn) and dropping 2 per turn, the coils have room to
  // separate so the double coil reads cleanly as a spiral tower.
  barrelHelix(t, 4, SPIRAL_TOWER_RADIUS, 2, -4);

export const pathGiantLoop: PathFn = (t) => {
  // Giant loop: 3x bigger than the standard loop. Radius R=1.5, spans 3 forward
  // cells (lx: 0->3). Same approach/loop/depart structure as pathLoop.
  // Approach (0..0.1): straight from back edge to loop bottom (lx=1.5, lz=0).
  // Loop (0.1..0.9): full 360 vertical circle, radius R=1.5, centre at (1.5, 0, R).
  // Depart (0.9..1.0): straight from loop bottom to front edge (lx=3, lz=0).
  const R = GIANT_LOOP_RADIUS;
  if (t < 0.1) return { lx: (t / 0.1) * 1.5, ly: 0, lz: 0, banking: 0 };
  if (t > 0.9) return { lx: 1.5 + ((t - 0.9) / 0.1) * 1.5, ly: 0, lz: 0, banking: 0 };
  const u = (t - 0.1) / 0.8;
  const a = -Math.PI / 2 + 2 * Math.PI * u;
  return {
    lx: 1.5 + R * Math.cos(a),
    ly: 0,
    lz: R + R * Math.sin(a),
    banking: 0,
  };
};

export const pathGiantJump: PathFn = (t) => {
  // Giant jump: spans 3 cells (lx: 0->3) with a taller ballistic arc than the
  // standard jump. The wider gap creates a more dramatic airborne section.
  const lx = 3 * t;
  const lz = 1.8 * Math.sin(Math.PI * t);
  return { lx, ly: 0, lz, banking: 0 };
};
