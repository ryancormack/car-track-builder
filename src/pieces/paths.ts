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
// The normalized tangents m0 (entry) and m1 (exit) are the Hermite end slopes in
// normalized units (the piece spans lx 0->1). m = 0 gives a level join to flat
// track; m = 1 gives the ramp's own constant slope (a straight incline).
function rampElevation(t: number, m0: number, m1: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  // Hermite basis: H(t) = h01*p1 + h10*m0 + h11*m1  (p0 = 0, p1 = 1)
  return (-2 * t3 + 3 * t2) + (t3 - 2 * t2 + t) * m0 + (t3 - t2) * m1;
}

/**
 * Factory for a ramp of the given signed height with explicit WORLD grades
 * (d lz / d lx) at the entry and exit seams. Because the piece spans one cell
 * (lx 0->1), the Hermite tangent is grade/height. A grade of 0 makes that end
 * level (a clean join to flat track); a grade equal to the ramp's own natural
 * grade (== height) makes that end its full constant slope; an in-between value
 * lets neighbouring ramps meet at a shared, blended slope with no crease.
 */
export function makeGradedRampPath(height: number, entryGrade: number, exitGrade: number): PathFn {
  const m0 = height !== 0 ? entryGrade / height : 0;
  const m1 = height !== 0 ? exitGrade / height : 0;
  return (t) => ({ lx: t, ly: 0, lz: height * rampElevation(t, m0, m1), banking: 0 });
}

/**
 * Backwards-compatible boolean factory: easeIn/easeOut = true means that end is
 * level (grade 0); false means it runs at the ramp's own natural grade (a linear
 * join to an identical ramp). Implemented on top of makeGradedRampPath — the
 * ramp's natural grade equals its per-cell rise (`height`, since forward = 1).
 */
function makeRampPath(height: number, easeIn: boolean, easeOut: boolean): PathFn {
  return makeGradedRampPath(height, easeIn ? 0 : height, easeOut ? 0 : height);
}

/** Factory for context-aware ramp-up paths (1 unit). */
export function makeRampUpPath(easeIn: boolean, easeOut: boolean): PathFn {
  return makeRampPath(1, easeIn, easeOut);
}

/** Factory for context-aware ramp-down paths (1 unit). */
export function makeRampDownPath(easeIn: boolean, easeOut: boolean): PathFn {
  return makeRampPath(-1, easeIn, easeOut);
}

/** Factory for context-aware STEEP ramp-up paths (2 units). */
export function makeSteepRampUpPath(easeIn: boolean, easeOut: boolean): PathFn {
  return makeRampPath(2, easeIn, easeOut);
}

/** Factory for context-aware STEEP ramp-down paths (2 units). */
export function makeSteepRampDownPath(easeIn: boolean, easeOut: boolean): PathFn {
  return makeRampPath(-2, easeIn, easeOut);
}

// Default both-eased variants: zero slope at both ends, so they join flat track
// with no sharp crease. When ramps are chained, resolvePathLocal blends the
// shared-joint slopes so the chain forms one continuous incline (no flat-spot
// "shelf" between consecutive ramps, even of mixed steepness).
export const pathRampUp: PathFn = makeRampUpPath(true, true);
export const pathRampDown: PathFn = makeRampDownPath(true, true);

// Steep ramps climb/descend TWO units over a single cell — higher and steeper
// than the standard one-unit ramps.
export const pathSteepRampUp: PathFn = makeSteepRampUpPath(true, true);
export const pathSteepRampDown: PathFn = makeSteepRampDownPath(true, true);

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

// --- Banked turns -------------------------------------------------------------
// A tight 90° corner (same footprint as the standard curve) that LEANS into the
// turn, so the car can take it at speed without flying off (these are not
// overspeed-gated). banking rolls about the tangent now, so the lean follows the
// heading correctly. The lean eases 0 → max → 0 (sin profile) so it joins flat
// track level at both ends. Sign of `banking` is chosen so the road tilts toward
// the inside of the turn (verified in tests).
const BANK_MAX = 0.5; // ~29° of lean at the apex
export const pathBankR: PathFn = (t) => {
  const R = CURVE_RADIUS;
  const a = -Math.PI / 2 + (Math.PI / 2) * t;
  return { lx: R * Math.cos(a), ly: R + R * Math.sin(a), lz: 0, banking: -BANK_MAX * Math.sin(Math.PI * t) };
};
export const pathBankL: PathFn = (t) => {
  const R = CURVE_RADIUS;
  const a = Math.PI / 2 - (Math.PI / 2) * t;
  return { lx: R * Math.cos(a), ly: -R + R * Math.sin(a), lz: 0, banking: BANK_MAX * Math.sin(Math.PI * t) };
};

// --- Chicane / S-bend ---------------------------------------------------------
// A single piece that weaves to change lane while keeping the same heading: it
// curves one way then the other (an S), shifting ONE cell sideways over a
// 2-cell span. Heading is +x at both ends (smoothstep lateral profile → zero
// lateral slope at the seams), so it joins straight track cleanly. sign = +1
// shifts right (+y), -1 shifts left. Pairs with turn=0, sideAdvance=±1.
function smoothstep01(t: number): number { return t * t * (3 - 2 * t); }
export function makeChicanePath(sign: number): PathFn {
  return (t) => ({ lx: 2 * t, ly: sign * smoothstep01(t), lz: 0, banking: 0 });
}
export const pathChicaneR: PathFn = makeChicanePath(1);
export const pathChicaneL: PathFn = makeChicanePath(-1);

// --- Launchpad ----------------------------------------------------------------
// A booster on a climbing ramp: it rockets the car up and onto a higher section.
// Climbs 2 units over 2 cells (eased to level at both ends so it joins flat
// track), and the catalogue gives it a big boostEnergy so even a slow car gets
// flung up. dz = 2.
export const pathLaunchpad: PathFn = (t) => ({ lx: 2 * t, ly: 0, lz: 2 * smoothstep01(t), banking: 0 });

// --- Crumbling bridge ---------------------------------------------------------
// A flat 2-cell span. Cross it fast enough and it crumbles behind you; too slow
// and it gives way and you fall (handled in physics.ts / renderer).
export const pathCrumbleBridge: PathFn = (t) => ({ lx: 2 * t, ly: 0, lz: 0, banking: 0 });

// --- Zig-zag switchback ramp --------------------------------------------------
// Climbs while doing a flat 180° U-turn: the car winds up and reverses, exiting
// two lanes over and 2 units higher. Stacking alternating left/right switchbacks
// makes a compact zig-zag climb. Like a half-turn of an ascending helix that
// also reverses direction. sign = +1 turns/​offsets right (+y), -1 left.
// Endpoints: t=0 → (0,0,0) heading +x; t=1 → (0, ±2, rise) heading -x. Pairs with
// turn=2, sideAdvance=±2, dz=rise.
//
// `rise` is signed: +2 gives the climbing Switchback, -2 the descending Dive
// Turn, which is the same hairpin taken downhill (see DIVE_TURN_* in
// definitions.ts). The shape is identical, so both share this factory and one
// pathLen.
export function makeSwitchbackPath(sign: number, rise = 2): PathFn {
  const R = 1;
  return (t) => {
    const phi = Math.PI * t;
    return {
      lx: R * Math.sin(phi),
      ly: sign * R * (1 - Math.cos(phi)),
      // Ease the climb at both seams (easedProgress) so the ramp glides out of
      // and back into flat track — and stacks cleanly with the next switchback —
      // instead of kinking sharply upward right at the join. Total rise is still
      // `rise`; only the grade at the ends is flattened.
      lz: rise * easedProgress(t),
      // Level road (no roll): a clean, upright parking-ramp hairpin. Rolling the
      // tight climbing turn looked twisted, so the switchback now rides flat.
      banking: 0,
    };
  };
}
export const pathSwitchbackR: PathFn = makeSwitchbackPath(1);
export const pathSwitchbackL: PathFn = makeSwitchbackPath(-1);

// --- Dive turn ----------------------------------------------------------------
// The descending mirror of the Switchback: the same flat 180° hairpin, but it
// drops 2 units instead of climbing them. This is the piece that lets a track
// come back DOWN off a stacked level while reversing — previously the only
// single-piece reversals (Switchback, Top Hat) either climbed or stayed level, so
// getting down again cost a long run of ramps. Loosely the Dive Loop of the
// roller-coaster vocabulary: trade height for speed while turning back.
export const pathDiveTurnR: PathFn = makeSwitchbackPath(1, -2);
export const pathDiveTurnL: PathFn = makeSwitchbackPath(-1, -2);


// The Wall is a flat one-cell straight; its breakable barrier is a renderer
// overlay (see renderer/meshes.ts) and its smash/explode behaviour lives in the
// simulator (physics.ts).
export const pathWall: PathFn = (t) => ({ lx: t, ly: 0, lz: 0, banking: 0 });

// --- Top Hat tower ------------------------------------------------------------
// A tall element that DOUBLES BACK on itself (Top Thrill Dragster style): the
// car climbs a steep, near-vertical leg, makes a flat 180° U-turn high in the
// air, then descends a parallel leg, exiting in the OPPOSITE direction one lane
// over (so the return track runs beside the approach instead of on top of it).
//
// Built planar-ish in five phases, all with banking 0 so the car stays upright
// (the reversal is a horizontal U-turn at the top, not a vertical loop):
//   • lead-in   : a short flat run along +x, so the steep leg rises OUT of flat
//                 track (the base curves up smoothly instead of kinking — the
//                 same trick the loop/helix use at their seams);
//   • up-ramp   : steep climb to the apex, eased to horizontal at the top;
//   • U-turn    : a flat semicircle (radius R) at height H, reversing heading;
//   • down-ramp : the mirror descent in the parallel (ly = 2R) lane;
//   • lead-out  : a short flat run to the exit corner.
// Endpoints: t=0 → (0,0,0) heading +x; t=1 → (0, 2R, 0) heading -x. Paired with
// turn=2 (180°) and sideAdvance=2R in the catalogue so the exit connects.
const TOP_HAT_HEIGHT = 4;     // apex height (grid units) — a tall tower
const TOP_HAT_RUN = 1.5;      // horizontal run of each steep leg (a touch longer
                              //   than before → a gentler, more ramp-like grade)
const TOP_HAT_RADIUS = 1;     // U-turn radius (lateral offset = 2R = 2 cells)
const TOP_HAT_LEAD = 0.45;    // short flat lead-in / lead-out for a smooth join

// Quintic "smootherstep": S(0)=0, S(1)=1 with BOTH the first and second
// derivatives zero at each end. Used for the elevation of each leg instead of
// the trapezoidal easedProgress (which is only C¹ and runs at a constant, very
// steep slope through its middle). Being C², each leg now lifts off the flat
// base and settles onto the flat U-turn with continuous curvature — the on- and
// off-ramps read as one smooth, sweeping ramp rather than a straight incline
// with a slope-crease where the easing hands over to the linear middle.
function smootherstep(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * c * (c * (c * 6 - 15) + 10);
}

// The Top Hat's raw geometry as a function of a phase parameter s ∈ [0, 1],
// split into five phases (flat lead-in, steep climb, flat U-turn, steep descent,
// flat lead-out). The phase-boundary values of s below are arbitrary book-keeping
// — pathTopHat re-parametrises this shape by ARC LENGTH so the car (and the
// rendered road) advance at a uniform rate along the whole element.
function topHatGeom(s: number): LocalPoint {
  const H = TOP_HAT_HEIGHT, D = TOP_HAT_RUN, R = TOP_HAT_RADIUS, L = TOP_HAT_LEAD;
  const p0 = 0.08, p1 = 0.34, p2 = 0.66, p3 = 0.92;
  if (s < p0) {
    // Flat lead-in along +x.
    const u = s / p0;
    return { lx: L * u, ly: 0, lz: 0, banking: 0 };
  }
  if (s < p1) {
    // Climb: smootherstep elevation, level (slope 0) at both the base and the
    // apex so it joins the lead-in and the U-turn with no crease.
    const u = (s - p0) / (p1 - p0);
    return { lx: L + D * u, ly: 0, lz: H * smootherstep(u), banking: 0 };
  }
  if (s < p2) {
    // Flat 180° U-turn at the apex.
    const u = (s - p1) / (p2 - p1);
    const phi = Math.PI * u;
    return { lx: L + D + R * Math.sin(phi), ly: R * (1 - Math.cos(phi)), lz: H, banking: 0 };
  }
  if (s < p3) {
    // Descent: mirror of the climb in the parallel (ly = 2R) lane.
    const u = (s - p2) / (p3 - p2);
    return { lx: L + D * (1 - u), ly: 2 * R, lz: H * (1 - smootherstep(u)), banking: 0 };
  }
  // Flat lead-out back to the exit corner, heading -x.
  const u = (s - p3) / (1 - p3);
  return { lx: L * (1 - u), ly: 2 * R, lz: 0, banking: 0 };
}

// --- Arc-length reparametrisation of the Top Hat ------------------------------
// Because topHatGeom packs phases of very different length into fixed spans of
// s (a 0.45 lead-in vs. a ~4.5-long steep leg), equal steps of s cover wildly
// different distances. The simulator advances the path parameter by ds/pathLen
// assuming a CONSTANT distance-per-parameter, so with the raw shape the car
// would crawl along the flat lead-ins and then rocket up and down the legs
// (measured: a 5× swing in real speed). The renderer, sampling evenly in the
// parameter, likewise starved the long legs of segments and made them look
// faceted.
//
// We fix both at the source by remapping the piece parameter t to a phase s such
// that arc length is proportional to t. A one-off table of cumulative chord
// length (built at module load) is inverted with a binary search + linear
// interpolation. After this, |d(pos)/dt| is essentially constant, so the car
// moves at a steady speed and the road tessellates evenly.
const TOP_HAT_ARC_SAMPLES = 1024;
const { phase: TOP_HAT_PHASE, cumLen: TOP_HAT_CUM_LEN, total: TOP_HAT_LENGTH, climb: TOP_HAT_CLIMB_LENGTH } =
  buildTopHatArcTable();

function buildTopHatArcTable(): { phase: number[]; cumLen: number[]; total: number; climb: number } {
  const phase: number[] = [0];
  const cumLen: number[] = [0];
  let prev = topHatGeom(0);
  let acc = 0;
  let climb = 0;
  for (let i = 1; i <= TOP_HAT_ARC_SAMPLES; i++) {
    const s = i / TOP_HAT_ARC_SAMPLES;
    const p = topHatGeom(s);
    const seg = Math.hypot(p.lx - prev.lx, p.ly - prev.ly, p.lz - prev.lz);
    acc += seg;
    // Accumulate the length of the climbing leg (still rising, before the apex)
    // so the entry-speed gate in definitions.ts can be derived from the true
    // climb distance rather than a hand-guessed constant.
    if (p.lz > prev.lz && p.lz < TOP_HAT_HEIGHT - 1e-9) climb += seg;
    phase.push(s);
    cumLen.push(acc);
    prev = p;
  }
  return { phase, cumLen, total: acc, climb };
}

/** Invert the arc-length table: uniform arc fraction t → phase parameter s. */
function topHatArcToPhase(t: number): number {
  const target = (t < 0 ? 0 : t > 1 ? 1 : t) * TOP_HAT_LENGTH;
  const cum = TOP_HAT_CUM_LEN;
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1; else hi = mid;
  }
  const segLen = cum[lo] - cum[lo - 1];
  const f = segLen > 1e-12 ? (target - cum[lo - 1]) / segLen : 0;
  return TOP_HAT_PHASE[lo - 1] + (TOP_HAT_PHASE[lo] - TOP_HAT_PHASE[lo - 1]) * f;
}

export { TOP_HAT_LENGTH, TOP_HAT_CLIMB_LENGTH };

// The Top Hat path: arc-length parametrised so equal t = equal distance.
export const pathTopHat: PathFn = (t) => topHatGeom(topHatArcToPhase(t));

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

// A symmetric "hump" profile that is FLAT (zero grade) at both ends and peaks at
// the midpoint: sin²(πt) = ½(1 − cos 2πt). Used by the jumps and the steep hill
// so they lift out of — and settle back into — flat/ramped track with no crease
// at the seam, while still building a steep face toward the middle (a kicker
// launch for jumps, a rounded crown for the hill). Contrast with a plain
// sin(πt) arc, whose grade is STEEPEST exactly at the seams (the old kink).
function smoothHump(t: number): number {
  const s = Math.sin(Math.PI * t);
  return s * s;
}

export const pathJump: PathFn = (t) => {
  // Spans two cells (lx: 0 -> 2): a take-off ramp, an airborne arc over a
  // one-cell gap, then a landing ramp. Net dz = 0. The renderer omits the track
  // over the middle so the gap reads as empty space. The smoothHump profile
  // eases the take-off/landing to level at the seams (so it joins straight track
  // or a ramp with no kink) while still rearing up into a steep kicker at the lip.
  return { lx: 2 * t, ly: 0, lz: 1.3 * smoothHump(t), banking: 0 };
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
  // Steep symmetric hill: rises to 1.5 units at the midpoint and returns to 0.
  // Uses the smoothHump profile so it eases out of and back into flat track with
  // no crease at the seams (a plain sine arc was steepest right at the joins).
  return { lx: 2 * t, ly: 0, lz: 1.5 * smoothHump(t), banking: 0 };
};

// --- Zero-g roll --------------------------------------------------------------
/**
 * Crest height of the Zero-g roll's hill. Exported so the entry-speed gate in
 * definitions.ts is derived from the geometry the car actually drives, instead of
 * a second literal that can silently drift out of step with this one.
 */
export const ZERO_G_ROLL_RISE = 1.5;
/** Crest height of the Wave turn's hump. Exported for the same reason. */
export const WAVE_TURN_RISE = 0.5;

// A full 360° barrel roll performed OVER the crest of an airtime hill, so the
// car goes weightless and inverted at the same moment. This is what separates it
// from the Corkscrew, which rolls along flat track: same rotation, completely
// different feel, and it costs the hill's climb on the way in.
//
// Reuses the Steep Hill's elevation profile exactly (same rise, same eased
// seams) and layers the Corkscrew's eased roll on top, so it joins flat track
// cleanly at both ends and ends upright (banking 2π ≡ 0).
export const pathZeroGRoll: PathFn = (t) => ({
  lx: 2 * t,
  ly: 0,
  lz: ZERO_G_ROLL_RISE * smoothHump(t),
  banking: 2 * Math.PI * easedProgress(t),
});

// --- Wave turn ----------------------------------------------------------------
// A banked 90° corner that lifts over a small airtime hump halfway round, so the
// car gets a kick of weightlessness mid-corner. Named for the roller-coaster
// wave turn (a banked turn carrying a camelback); this grid is built on 90°
// turns, so it is implemented as a quarter turn rather than the 180° exit some
// real installations use.
//
// Geometry is the Banked turn's quarter circle (identical endpoints, so it drops
// into any slot a Bank fits) plus a smoothHump rise and a deeper lean than a
// plain Bank. sign = +1 turns right, -1 left.
const WAVE_BANK_MAX = 0.85; // ~49° of lean at the apex — deeper than a Bank
function makeWaveTurnPath(sign: number): PathFn {
  const R = CURVE_RADIUS;
  return (t) => {
    const a = sign > 0
      ? -Math.PI / 2 + (Math.PI / 2) * t
      : Math.PI / 2 - (Math.PI / 2) * t;
    return {
      lx: R * Math.cos(a),
      ly: sign * R + R * Math.sin(a),
      lz: WAVE_TURN_RISE * smoothHump(t),
      banking: -sign * WAVE_BANK_MAX * Math.sin(Math.PI * t),
    };
  };
}
export const pathWaveTurnR: PathFn = makeWaveTurnPath(1);
export const pathWaveTurnL: PathFn = makeWaveTurnPath(-1);

// --- Compound inversions (Immelmann, Cobra Roll) -------------------------------
//
// These two are built from phases of very different length — a short vertical
// half-loop followed by a long rolling run — so equal steps of the raw phase
// parameter cover wildly different distances. The simulator advances the path
// parameter by ds/pathLen assuming constant distance-per-parameter, so without a
// correction the car would crawl through the loop and then rocket along the
// run, and the renderer would starve the long section of segments. The Top Hat
// hit the same problem and solved it with a bespoke table; this is the same fix
// as a reusable helper. (The Top Hat keeps its own table because it also measures
// its climbing-leg length to derive its entry gate, which this does not.)
interface ArcParam {
  /** Total arc length of the shape. */
  total: number;
  /** Uniform arc fraction t → raw phase parameter s. */
  toPhase(t: number): number;
}

function buildArcParam(geom: (s: number) => LocalPoint, samples = 1024): ArcParam {
  const phase: number[] = [0];
  const cumLen: number[] = [0];
  let prev = geom(0);
  let acc = 0;
  for (let i = 1; i <= samples; i++) {
    const s = i / samples;
    const p = geom(s);
    acc += Math.hypot(p.lx - prev.lx, p.ly - prev.ly, p.lz - prev.lz);
    phase.push(s);
    cumLen.push(acc);
    prev = p;
  }
  return {
    total: acc,
    toPhase(t: number): number {
      const target = (t < 0 ? 0 : t > 1 ? 1 : t) * acc;
      let lo = 1;
      let hi = cumLen.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumLen[mid] < target) lo = mid + 1; else hi = mid;
      }
      const segLen = cumLen[lo] - cumLen[lo - 1];
      const f = segLen > 1e-12 ? (target - cumLen[lo - 1]) / segLen : 0;
      return phase[lo - 1] + (phase[lo] - phase[lo - 1]) * f;
    },
  };
}

/** Radius of the vertical half-loop shared by the Immelmann and the Cobra Roll. */
export const HALF_LOOP_RADIUS = 1.1;
/** Net climb of the Immelmann (it exits higher than it entered). */
export const IMMELMANN_RISE = 1;
/** Crest of the Cobra Roll's second (rolled) hump. */
export const COBRA_SECOND_HUMP = 1.1;

/**
 * A vertical half-loop in the local x–z plane: enters at (0,0,0) heading +x and
 * leaves at (0,0,2R) heading -x, INVERTED. The inversion is genuine pitch — the
 * tangent rotates up and over, exactly as in the full Loop — which is why
 * `banking` stays 0 through it and the frame's up vector flips on its own (see
 * the sign-continuity tracking in frames.ts).
 *
 * The loop is kept STRICTLY in the x–z plane (no sideways lean). That is not
 * cosmetic: frames.ts derives the surface normal by tracking the lateral axis
 * sign-continuously, so leaning the loop out changes the parity of that tracking
 * and a following half-roll then leaves the car upside down at the exit instead
 * of upright. Measured both ways — a planar loop is what makes a π roll right the
 * car, and it is also the only version that goes fully inverted (up.z = -1) at
 * the apex. All sideways travel therefore happens in the roll-out.
 */
function halfLoop(u: number, R: number): LocalPoint {
  const a = -Math.PI / 2 + Math.PI * u;
  return {
    lx: R * Math.cos(a),
    ly: 0,
    lz: R + R * Math.sin(a),
    banking: 0,
  };
}

// --- Immelmann ----------------------------------------------------------------
// Half vertical loop straight into a half roll: the car pitches up and over
// (inverting), then rolls upright while easing back down and arcing into the lane
// two over, exiting reversed and one unit higher.
//
// Note the exit `banking` is π, not 0. That is not a bug and not a seam crease:
// after a pitched half-loop the frame is upside down at banking 0, so a roll of
// exactly π is what puts the car back on its wheels. Combined with the reversed
// horizontal tangent the exit frame's up is +z, matching flat track (verified in
// test/coaster-elements.test.ts, which checks the up vector at both seams).
//
// The roll-out is deliberately LONG (the piece declares forward 4, so it exits
// three cells back down the lane). A short roll-out has to cram the whole
// direction change into its last fraction, which reads as the car snapping round
// at the very end instead of arcing round — measured at 40° of tangent swing in
// the final 5% before this was widened.
const IMMELMANN_LOOP_SPAN = 0.42;
const IMMELMANN_EXIT_LX = -3;

function immelmannGeom(s: number): LocalPoint {
  const R = HALF_LOOP_RADIUS;
  if (s < IMMELMANN_LOOP_SPAN) {
    return halfLoop(s / IMMELMANN_LOOP_SPAN, R);
  }
  const u = (s - IMMELMANN_LOOP_SPAN) / (1 - IMMELMANN_LOOP_SPAN);
  return {
    // Linear in lx so the exit tangent is a clean, non-degenerate -x, and long
    // enough that the lateral and vertical terms never dominate it.
    lx: IMMELMANN_EXIT_LX * u,
    // Raised cosine: zero lateral slope at BOTH ends, so it neither creases the
    // junction out of the loop nor skews the exit heading.
    ly: 1 - Math.cos(Math.PI * u),
    lz: 2 * R + (IMMELMANN_RISE - 2 * R) * smootherstep(u),
    banking: Math.PI * smootherstep(u),
  };
}

const IMMELMANN_ARC = buildArcParam(immelmannGeom);
export const IMMELMANN_LENGTH = IMMELMANN_ARC.total;
export const pathImmelmann: PathFn = (t) => immelmannGeom(IMMELMANN_ARC.toPhase(t));

// --- Cobra Roll ---------------------------------------------------------------
// Two humps, two inversions, exits reversed — the double-inversion turnaround.
//
// The first hump is a true vertical half-loop (pitch inversion, as above). The
// car then rolls upright as it comes down, and takes the SECOND hump through a
// full 360° roll, so it is inverted again exactly at that hump's crest. Total
// roll is 3π: an odd multiple, which is what leaves it upright at the exit.
//
// A textbook cobra roll reaches its 180° exit by yawing through two half
// corkscrews between two vertical half-loops. Two vertical half-loops each
// reverse the heading, so on their own they would cancel and the piece would
// exit the way it came in; this build takes the reversal from the single pitch
// loop and makes the second hump roll-driven instead. Same silhouette, same two
// inversions, same reversed exit, and it stays authorable as an explicit curve
// with exact endpoints.
//
// It is the longest piece in the catalogue (forward 6) because a descent AND a
// second hump have to fit after the loop without either becoming a cliff.
const COBRA_LOOP_SPAN = 0.3;
const COBRA_EXIT_LX = -5;

function cobraGeom(s: number): LocalPoint {
  const R = HALF_LOOP_RADIUS;
  if (s < COBRA_LOOP_SPAN) {
    return halfLoop(s / COBRA_LOOP_SPAN, R);
  }
  const u = (s - COBRA_LOOP_SPAN) / (1 - COBRA_LOOP_SPAN);
  // Descend out of the first hump (u < 0.5), then take the second hump (u >= 0.5).
  // Both sub-phases meet at lz = 0 with zero slope, so the valley is creaseless.
  const lz = u < 0.5
    ? 2 * R * (1 - smootherstep(2 * u))
    : COBRA_SECOND_HUMP * smoothHump(2 * u - 1);
  // Roll: 0 → π rights the car on the way down, then π → 3π is the full roll over
  // the second hump. smootherstep puts the halfway point of that second sweep
  // (banking = 2π, fully inverted) exactly at the second hump's crest.
  const banking = u < 0.5
    ? Math.PI * smootherstep(2 * u)
    : Math.PI + 2 * Math.PI * smootherstep(2 * u - 1);
  return {
    lx: COBRA_EXIT_LX * u,
    ly: 1 - Math.cos(Math.PI * u),
    lz,
    banking,
  };
}

const COBRA_ARC = buildArcParam(cobraGeom);
export const COBRA_ROLL_LENGTH = COBRA_ARC.total;
export const pathCobraRoll: PathFn = (t) => cobraGeom(COBRA_ARC.toPhase(t));



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
  // Giant jump: spans 3 cells (lx: 0->3) with a taller arc than the standard
  // jump — a more dramatic airborne section. Same smoothHump profile so the
  // take-off/landing meet neighbouring track level (no kink) yet still kick up
  // steeply at the lips.
  return { lx: 3 * t, ly: 0, lz: 2.0 * smoothHump(t), banking: 0 };
};
