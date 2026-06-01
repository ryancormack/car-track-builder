// pieces/definitions.ts — the catalogue of all piece types and palette ordering.
//
// The Loop's entry-speed gate is derived from the shared physics constants (see
// LOOP_MIN_V2 below). The other stunt `minV2` values (ramps, corkscrew, jump)
// are hand-tuned gameplay thresholds, not physical derivations.

import {
  pathStraight, pathCurveR, pathCurveL,
  pathRampUp, pathRampDown,
  pathLoop, pathCorkscrew, pathJump,
  pathSpiral, pathSteepHill,
} from './paths.js';
import { G, FRICTION, RAMP_FRICTION_MULT, LOOP_RADIUS } from '../constants.js';
import type { Piece, PieceId } from '../types.js';

// Classic result for a vertical loop: to stay pinned to the track at the apex,
// the car needs v² ≥ 5·g·R at the bottom (entry). With g=9.8 and R=0.5 that's
// 24.5. The simulator sheds a little extra to friction on the way up, but stays
// above the stall threshold, so this is genuinely passable at the gate value.
const LOOP_MIN_V2 = 5 * G * LOOP_RADIUS;

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

// Entry-speed gate for Steep Hill, derived the same way as Ramp Up. The car
// must crest a 1.5-unit peak with friction along half the path length (~1.87).
const STEEP_HILL_RISE = 1.5;
const STEEP_HILL_LEN = 3.73;
const STEEP_HILL_MIN_V2 =
  2 * G * STEEP_HILL_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * STEEP_HILL_LEN / 2 +
  5;

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
  JUMP: {
    id: 'JUMP', name: 'Jump', icon: '⤴', category: 'stunt', featured: true,
    forward: 2, turn: 0, dz: 0,
    pathLen: 3.0, excitement: 12, minV2: 18, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathJump,
  },
  SPIRAL: {
    id: 'SPIRAL', name: 'Spiral', icon: '🔽', category: 'stunt', featured: true,
    forward: 2, turn: 0, dz: -2,
    pathLen: 4.22, excitement: 25, minV2: 12, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathSpiral,
  },
  STEEP_HILL: {
    id: 'STEEP_HILL', name: 'Steep Hill', icon: '⛰', category: 'stunt', featured: true,
    forward: 2, turn: 0, dz: 0,
    pathLen: STEEP_HILL_LEN, excitement: 15, minV2: STEEP_HILL_MIN_V2, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathSteepHill,
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
  'RAMP_UP', 'RAMP_DN',
  'LOOP', 'CORKSCREW', 'JUMP',
  'SPIRAL', 'STEEP_HILL',
  'BOOSTER', 'FINISH',
];

/** Narrows an arbitrary string to a known PieceId (used at the JSON boundary). */
export function isPieceId(id: string): id is PieceId {
  return Object.prototype.hasOwnProperty.call(PIECES, id);
}
