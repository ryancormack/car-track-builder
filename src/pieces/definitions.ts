// pieces/definitions.ts — the catalogue of all piece types and palette ordering.
//
// The Loop's entry-speed gate is derived from the shared physics constants (see
// LOOP_MIN_V2 below). The other stunt `minV2` values (ramps, corkscrew, jump)
// are hand-tuned gameplay thresholds, not physical derivations.

import {
  pathStraight, pathCurveR, pathCurveL,
  pathWideR2, pathWideL2, pathWideR3, pathWideL3,
  pathRampUp, pathRampDown, pathSteepRampUp, pathSteepRampDown,
  pathLoop, pathCorkscrew, pathJump, pathWall,
  pathSpiral, pathSteepHill,
  pathHelixUp, pathHelixDown, pathSpiralTower,
  pathGiantLoop, pathGiantJump,
} from './paths.js';
import { G, FRICTION, RAMP_FRICTION_MULT, LOOP_RADIUS, GIANT_LOOP_RADIUS } from '../constants.js';
import type { DecorationId, Piece, PieceId } from '../types.js';

// A vertical loop only stays "stuck to the track" while the car is fast enough
// that the required centripetal pull doesn't exceed what gravity + the track can
// supply. The binding point is the APEX, where contact needs v² ≥ g·R (the
// classic result). The naive frictionless entry gate (5·g·R) ignores the energy
// burned climbing to the apex: gravity over the 2·R rise AND friction along the
// ~R·(1+π) of track from the entry seam to the top (an R-long approach plus a
// half-circumference π·R). Folding that toll back in gives an entry gate that
// genuinely guarantees apex contact, which the mid-loop contact check in
// physics.ts then enforces step-by-step. A small buffer keeps a car that *just*
// passes the gate comfortably pinned rather than skimming the detach threshold.
const LOOP_APEX_BUFFER = 2;
function loopEntryGate(radius: number): number {
  const arcToApex = radius * (1 + Math.PI);
  return (
    5 * G * radius +                                  // 5·g·R: apex contact + climb (frictionless)
    2 * FRICTION * arcToApex +                        // friction toll up to the apex
    LOOP_APEX_BUFFER
  );
}

const LOOP_MIN_V2 = loopEntryGate(LOOP_RADIUS);

// Entry-speed gate for Giant Loop: same apex-contact derivation, 3x radius.
const GIANT_LOOP_MIN_V2 = loopEntryGate(GIANT_LOOP_RADIUS);

// Entry-speed gate for Ramp Up, derived from the same accounting the simulator
// uses so the gate matches reality. Clearing the ramp costs the gravity climb
// (2·g·rise) plus the friction toll along its length (2·μ·rampMult·len). We add
// a small buffer so a car that *just* passes the gate crests with a little speed
// to spare instead of stalling exactly at the top (which would otherwise fail
// with a confusing "ran out of speed" mid-ramp rather than this gate's message).
const RAMP_UP_RISE = 1;    // mirrors RAMP_UP.dz below
const RAMP_UP_LEN = 1.5;   // mirrors RAMP_UP.pathLen below
const RAMP_UP_CREST_BUFFER = 4;
const RAMP_UP_MIN_V2 =
  2 * G * RAMP_UP_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * RAMP_UP_LEN +
  RAMP_UP_CREST_BUFFER;

// Entry-speed gate for the Steep Ramp Up, derived exactly like Ramp Up but for a
// 2-unit climb over ~2.30 of (much steeper) track. The bigger rise makes this a
// demanding climb — it needs a solid drop or a booster.
const STEEP_RAMP_UP_RISE = 2;    // mirrors STEEP_RAMP_UP.dz below
const STEEP_RAMP_UP_LEN = 2.30;  // mirrors STEEP_RAMP_UP.pathLen below
const STEEP_RAMP_UP_MIN_V2 =
  2 * G * STEEP_RAMP_UP_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * STEEP_RAMP_UP_LEN +
  4;

// Entry-speed gate for Steep Hill, derived the same way as Ramp Up. The car
// must crest a 1.5-unit peak with friction along half the path length (~1.87).
const STEEP_HILL_RISE = 1.5;
const STEEP_HILL_LEN = 3.73;
const STEEP_HILL_MIN_V2 =
  2 * G * STEEP_HILL_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * STEEP_HILL_LEN / 2 +
  5;

// Entry-speed gate for Helix Up: must climb 3 units with friction along the
// full helical path (~22.09 arc length of the 720°, 3×3 spiral ramp, verified
// numerically). The long two-turn coil makes this a demanding climb — a tall
// drop or a booster is needed to enter.
const HELIX_UP_RISE = 3;
const HELIX_UP_LEN = 22.09;
const HELIX_UP_MIN_V2 =
  2 * G * HELIX_UP_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * HELIX_UP_LEN +
  6;

// Entry-speed gate for Giant Jump: hand-tuned gameplay threshold scaled up from
// the standard JUMP's minV2 of 18 (which spans 2 cells). For 3 cells, linear
// scaling gives 27 and quadratic (energy-based) scaling gives ~40.5. The value
// 30 sits just above linear, providing a noticeable difficulty increase without
// requiring an excessive run-up. This is a gameplay feel choice, not a strict
// physical derivation.
const GIANT_JUMP_MIN_V2 = 30;

// Arc length of the Spiral Tower (2 helical turns, r=2.0, inscribed in a 4×4
// square), measured numerically. It descends, so no climb gate is needed
// (gravity assists).
const SPIRAL_TOWER_LEN = 29.45;

export const PIECES: Record<PieceId, Piece> = {
  START: {
    id: 'START', name: 'Start', icon: '🚦', category: 'meta',
    forward: 1, turn: 0, dz: 0,
    pathLen: 1, excitement: 0, minV2: 0, boostEnergy: 0,
    color: '#5dd39e', isStart: true, hidden: true,
    pathLocal: pathStraight,
  },
  STRAIGHT: {
    id: 'STRAIGHT', name: 'Straight', icon: '━', category: 'basic',
    forward: 1, turn: 0, dz: 0,
    pathLen: 1, excitement: 1, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathStraight,
  },
  CURVE_L: {
    id: 'CURVE_L', name: 'Turn Left', icon: '↰', category: 'turn',
    forward: 1, turn: -1, dz: 0,
    pathLen: 1.2, excitement: 2, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathCurveL,
  },
  CURVE_R: {
    id: 'CURVE_R', name: 'Turn Right', icon: '↱', category: 'turn',
    forward: 1, turn: 1, dz: 0,
    pathLen: 1.2, excitement: 2, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathCurveR,
  },
  WIDE_L_2: {
    id: 'WIDE_L_2', name: 'Wide Left', icon: '⤴', category: 'turn',
    forward: 2, turn: -1, dz: 0,
    pathLen: 1.64, excitement: 4, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideL2,
  },
  WIDE_R_2: {
    id: 'WIDE_R_2', name: 'Wide Right', icon: '⤵', category: 'turn',
    forward: 2, turn: 1, dz: 0,
    pathLen: 1.64, excitement: 4, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideR2,
  },
  WIDE_L_3: {
    id: 'WIDE_L_3', name: 'Sweep Left', icon: '⤺', category: 'turn',
    forward: 3, turn: -1, dz: 0,
    pathLen: 2.57, excitement: 6, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideL3,
  },
  WIDE_R_3: {
    id: 'WIDE_R_3', name: 'Sweep Right', icon: '⤻', category: 'turn',
    forward: 3, turn: 1, dz: 0,
    pathLen: 2.57, excitement: 6, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideR3,
  },
  RAMP_UP: {
    id: 'RAMP_UP', name: 'Ramp Up', icon: '⬈', category: 'elev',
    forward: 1, turn: 0, dz: 1,
    pathLen: 1.5, excitement: 2, minV2: RAMP_UP_MIN_V2, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathRampUp,
  },
  RAMP_DN: {
    id: 'RAMP_DN', name: 'Ramp Down', icon: '⬊', category: 'elev',
    forward: 1, turn: 0, dz: -1,
    pathLen: 1.5, excitement: 2, minV2: 0, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathRampDown,
  },
  STEEP_RAMP_UP: {
    id: 'STEEP_RAMP_UP', name: 'Steep Ramp Up', icon: '⏫', category: 'elev', featured: true,
    forward: 1, turn: 0, dz: 2,
    pathLen: 2.30, excitement: 6, minV2: STEEP_RAMP_UP_MIN_V2, boostEnergy: 0,
    color: '#ff8c1a',
    pathLocal: pathSteepRampUp,
  },
  STEEP_RAMP_DN: {
    id: 'STEEP_RAMP_DN', name: 'Steep Ramp Down', icon: '⏬', category: 'elev', featured: true,
    forward: 1, turn: 0, dz: -2,
    pathLen: 2.30, excitement: 6, minV2: 0, boostEnergy: 0,
    color: '#ff8c1a',
    pathLocal: pathSteepRampDown,
  },
  LOOP: {
    id: 'LOOP', name: 'Loop', icon: '⭕', category: 'stunt', featured: true,
    forward: 1, turn: 0, dz: 0,
    pathLen: 4.14, excitement: 30, minV2: LOOP_MIN_V2, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathLoop,
  },
  CORKSCREW: {
    id: 'CORKSCREW', name: 'Corkscrew', icon: '🌀', category: 'stunt', featured: true,
    forward: 3, turn: 0, dz: 0,
    pathLen: 4.07, excitement: 18, minV2: 22, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathCorkscrew,
  },
  BOOSTER: {
    id: 'BOOSTER', name: 'Booster', icon: '⚡', category: 'special', boost: true,
    forward: 1, turn: 0, dz: 0,
    pathLen: 1, excitement: 4, minV2: 0, boostEnergy: 90,
    color: '#ff4500',
    pathLocal: pathStraight,
  },
  BRAKE: {
    id: 'BRAKE', name: 'Brake', icon: '🛑', category: 'special',
    forward: 1, turn: 0, dz: 0,
    pathLen: 1, excitement: 0, minV2: 0, boostEnergy: -40,
    color: '#cc3333',
    pathLocal: pathStraight,
  },
  JUMP: {
    id: 'JUMP', name: 'Jump', icon: '⤴', category: 'stunt', featured: true,
    forward: 2, turn: 0, dz: 0,
    pathLen: 3.0, excitement: 12, minV2: 18, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathJump,
  },
  WALL: {
    id: 'WALL', name: 'Smash Wall', icon: '🧱', category: 'special', featured: true,
    forward: 1, turn: 0, dz: 0,
    // minV2 stays 0: the smash/explode gate (WALL_SMASH_V2) is handled specially
    // in physics.ts so failing it triggers an EXPLOSION ('crash'), not the
    // generic "too slow" speed-gate launch.
    pathLen: 1, excitement: 14, minV2: 0, boostEnergy: 0,
    color: '#b5483a',
    pathLocal: pathWall,
  },
  GIANT_LOOP: {
    id: 'GIANT_LOOP', name: 'Giant Loop', icon: '⭕', category: 'stunt', featured: true,
    forward: 3, turn: 0, dz: 0,
    pathLen: 12.42, excitement: 50, minV2: GIANT_LOOP_MIN_V2, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathGiantLoop,
  },
  GIANT_JUMP: {
    id: 'GIANT_JUMP', name: 'Giant Jump', icon: '⤴', category: 'stunt', featured: true,
    forward: 3, turn: 0, dz: 0,
    pathLen: 4.5, excitement: 20, minV2: GIANT_JUMP_MIN_V2, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathGiantJump,
  },
  SPIRAL: {
    id: 'SPIRAL', name: 'Spiral', icon: '🔽', category: 'stunt', featured: true,
    forward: 2, turn: 0, dz: -2,
    pathLen: 8.59, excitement: 25, minV2: 12, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathSpiral,
  },
  SPIRAL_TOWER: {
    id: 'SPIRAL_TOWER', name: 'Spiral Tower', icon: '🌀', category: 'stunt', featured: true,
    forward: 4, turn: 0, dz: -4,
    pathLen: SPIRAL_TOWER_LEN, excitement: 40, minV2: 12, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathSpiralTower,
  },
  STEEP_HILL: {
    id: 'STEEP_HILL', name: 'Steep Hill', icon: '⛰', category: 'stunt', featured: true,
    forward: 2, turn: 0, dz: 0,
    pathLen: STEEP_HILL_LEN, excitement: 15, minV2: STEEP_HILL_MIN_V2, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathSteepHill,
  },
  HELIX_UP: {
    id: 'HELIX_UP', name: 'Helix Up', icon: '🌀⬆', category: 'stunt', featured: true,
    forward: 3, turn: 0, dz: 3,
    pathLen: 22.09, excitement: 32, minV2: HELIX_UP_MIN_V2, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathHelixUp,
  },
  HELIX_DN: {
    id: 'HELIX_DN', name: 'Helix Down', icon: '🌀⬇', category: 'stunt', featured: true,
    forward: 3, turn: 0, dz: -3,
    pathLen: 22.09, excitement: 32, minV2: 12, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathHelixDown,
  },
  FINISH: {
    id: 'FINISH', name: 'Finish', icon: '🏁', category: 'meta',
    forward: 1, turn: 0, dz: 0,
    pathLen: 1, excitement: 0, minV2: 0, boostEnergy: 0,
    color: '#00d4ff', isFinish: true,
    pathLocal: pathStraight,
  },
};

export const PALETTE_ORDER: PieceId[] = [
  'STRAIGHT', 'CURVE_L', 'CURVE_R',
  'WIDE_L_2', 'WIDE_R_2', 'WIDE_L_3', 'WIDE_R_3',
  'RAMP_UP', 'RAMP_DN', 'STEEP_RAMP_UP', 'STEEP_RAMP_DN',
  'LOOP', 'GIANT_LOOP', 'CORKSCREW', 'JUMP', 'GIANT_JUMP', 'WALL',
  'SPIRAL', 'SPIRAL_TOWER', 'HELIX_UP', 'HELIX_DN', 'STEEP_HILL',
  'BOOSTER', 'BRAKE', 'FINISH',
];

/** Narrows an arbitrary string to a known PieceId (used at the JSON boundary). */
export function isPieceId(id: string): id is PieceId {
  return Object.prototype.hasOwnProperty.call(PIECES, id);
}

/** A decoration that can be attached to (some) pieces. */
export interface Decoration {
  id: DecorationId;
  name: string;
  icon: string;
  /** Bonus excitement added to the decorated piece's score. */
  excitement: number;
}

export const DECORATIONS: Record<DecorationId, Decoration> = {
  RING_OF_FIRE: {
    id: 'RING_OF_FIRE', name: 'Ring of Fire', icon: '🔥', excitement: 12,
  },
};

/** Decoration ordering for the palette. */
export const DECORATION_ORDER: DecorationId[] = ['RING_OF_FIRE'];

/** Narrows an arbitrary string to a known DecorationId. */
export function isDecorationId(id: string): id is DecorationId {
  return Object.prototype.hasOwnProperty.call(DECORATIONS, id);
}

/**
 * Pieces a Ring of Fire (and any future flat decoration) can be attached to:
 * the straight-ish pieces the car drives along upright — straights, ramps,
 * jumps, boosters/brakes, the wall, and the finish. Curves, loops, coils and
 * helixes are excluded (the ring would clip the banked/curved track).
 */
const DECORATABLE: ReadonlySet<PieceId> = new Set<PieceId>([
  'STRAIGHT', 'RAMP_UP', 'RAMP_DN', 'STEEP_RAMP_UP', 'STEEP_RAMP_DN',
  'JUMP', 'GIANT_JUMP', 'BOOSTER', 'BRAKE', 'WALL', 'FINISH',
]);

/** Whether a Ring of Fire can be placed on the given piece type. */
export function canDecorate(pieceId: PieceId): boolean {
  return DECORATABLE.has(pieceId);
}
