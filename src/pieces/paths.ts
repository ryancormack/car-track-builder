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

// Steep ramps climb/descend TWO units over a single cell — higher and steeper
// than the standard one-unit ramps. Same eased Hermite profile, scaled by 2, so
// they still join flat track smoothly (just at a much steeper grade).
export const pathSteepRampUp: PathFn = (t) => ({ lx: t, ly: 0, lz: 2 * rampElevation(t, true, true), banking: 0 });
export const pathSteepRampDown: PathFn = (t) => ({ lx: t, ly: 0, lz: -2 * rampElevation(t, true, true), banking: 0 });

// --- Wide turns ---------------------------------------------------------------
// A 90° bend that sweeps WIDE as a true circular quarter-arc of radius
// R = forward - 0.5. Unlike the tight standard curve (which pivots in half a
// cell), a wide turn advances DIAGONALLY: `entryAdvance = forward - 1` cells
// along the entry axis and `forward` cells along the exit axis (see applyPiece /
// computeCells). That diagonal advance is exactly what lets the arc be a smooth
// constant-radius circle instead of a kinked sweep.
//
// The arc starts at local (0,0) heading +x (entry direction) and ends at
// (R, ±R) heading ±y (exit direction; sign = +1 right, -1 left) — its tangents
// line up with the neighbouring straight track at both seams, so there is no
// crease. R = forward - 0.5 keeps the exit landing on the grid's half-cell
// connection point.
export function makeWideTurnPath(forward: number, sign: number): PathFn {
  const R = forward - 0.5;
  return (t) => {
    const theta = (Math.PI / 2) * t;
    return {
      lx: R * Math.sin(theta),
      ly: sign * R * (1 - Math.cos(theta)),
      lz: 0,
      banking: 0,
    };
  };
}

export const pathWideR2: PathFn = makeWideTurnPath(2, 1);
export const pathWideL2: PathFn = makeWideTurnPath(2, -1);
export const pathWideR3: PathFn = makeWideTurnPath(3, 1);
export const pathWideL3: PathFn = makeWideTurnPath(3, -1);

// The Wall is a flat one-cell straight; its breakable barrier is a renderer
// overlay (see renderer/meshes.ts) and its smash/explode behaviour lives in the
// simulator (physics.ts).
export const pathWall: PathFn = (t) => ({ lx: t, ly: 0, lz: 0, banking: 0 });

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

// --- True helix construction (shared by spiral + helix + spiral tower) --------
// A real vertical-axis helix — a parking-garage spiral RAMP, not a barrel roll —
// laid out to fill a SQUARE forward×forward footprint:
//
//   • a short straight LEAD-IN along the near (y=0) edge, from the entry corner
//     (0,0) to the circle's near point (r, 0);
//   • `turns` full revolutions (e.g. 2 turns = 720°) around a FIXED horizontal
//     circle of radius r = forward/2, centred at (r, r) so it is inscribed in
//     the square (it touches all four edges, sweeping x,y ∈ [0, 2r] = [0,
//     forward]). The coils stack directly on top of each other while the
//     elevation climbs/descends linearly — a clean vertical spiral;
//   • a short straight LEAD-OUT back along the near edge to the exit corner
//     (forward, 0).
//
// Because all the turning is in the ground plane, the road stays level (banking
// = 0): the car circles up/down the ramp staying upright (frames.ts derives the
// car's "up" from the tangent and world-up), instead of being rolled like the
// old barrel coil. Endpoints: t=0 → (0,0,0) heading +x; t=1 → (forward,0,dz)
// heading +x, so it joins flat track cleanly with only a grade break (like a
// ramp). The lead-in/out fraction `ta` is the straights' share of the total arc
// (2 straights of length r vs a coil of length ~2π·r·turns), so the parameter t
// advances at near-constant speed along the whole path.
function helixCoil(t: number, forward: number, r: number, turns: number, dz: number): LocalPoint {
  const ta = 1 / (2 + 2 * Math.PI * turns);
  if (t < ta) {
    // Lead-in: straight along the near edge from the entry corner to (r, 0).
    return { lx: (t / ta) * r, ly: 0, lz: 0, banking: 0 };
  }
  if (t > 1 - ta) {
    // Lead-out: straight along the near edge from (r, 0) to the exit corner.
    const u = (t - (1 - ta)) / ta;
    return { lx: r + u * (forward - r), ly: 0, lz: dz, banking: 0 };
  }
  // Coil: `turns` revolutions around the fixed inscribed circle, climbing dz.
  const u = (t - ta) / (1 - 2 * ta);
  const a = -Math.PI / 2 + turns * 2 * Math.PI * u;
  return {
    lx: r + r * Math.cos(a),
    ly: r + r * Math.sin(a),
    lz: dz * u,
    banking: 0,
  };
}

export const pathSpiral: PathFn = (t) =>
  // One descending helical loop (360°) filling a 2×2 square, dropping 2 units.
  // The car spirals down a level ramp, upright.
  helixCoil(t, 2, SPIRAL_RADIUS, 1, -2);

export const pathSteepHill: PathFn = (t) => {
  // Steep symmetric hill: rises to 1.5 units at midpoint, returns to 0.
  return { lx: 2 * t, ly: 0, lz: 1.5 * Math.sin(Math.PI * t), banking: 0 };
};

export const pathHelixDown: PathFn = (t) =>
  // Two full descending revolutions (720°) filling a 3×3 square, dropping 3
  // units. A dramatic parking-garage spiral the car winds down staying upright.
  helixCoil(t, 3, HELIX_RADIUS, 2, -3);

export const pathHelixUp: PathFn = (t) =>
  // Two full ascending revolutions (720°) filling a 3×3 square, climbing 3
  // units. The car spirals up a level ramp; it needs real entry speed to climb.
  helixCoil(t, 3, HELIX_RADIUS, 2, 3);

export const pathSpiralTower: PathFn = (t) =>
  // Tall two-revolution descent (720°) filling a 4×4 square, dropping 4 units.
  // The widest coil — clearly reads as a spiral tower the car winds down.
  helixCoil(t, 4, SPIRAL_TOWER_RADIUS, 2, -4);

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
