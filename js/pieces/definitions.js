// pieces/definitions.js — the catalogue of all piece types and palette ordering.
// Physics constants used here must stay in sync with physics.js (G ≈ 9.8, FRICTION ≈ 0.55).

import {
  pathStraight, pathCurveR, pathCurveL,
  pathRampUp, pathRampDown,
  pathLoop, pathCorkscrew, pathJump,
} from './paths.js';

export const PIECES = {
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
    pathLen: 1.4, excitement: 2, minV2: 8, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathRampUp,
  },
  RAMP_DN: {
    id: 'RAMP_DN', name: 'Ramp Down', icon: '⬊', category: 'elev',
    forward: 1, turn: 0, dz: -1,
    pathLen: 1.4, excitement: 2, minV2: 0, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathRampDown,
  },
  LOOP: {
    id: 'LOOP', name: 'Loop', icon: '⭕', category: 'stunt', featured: true,
    forward: 1, turn: 0, dz: 0,
    pathLen: 4.14, excitement: 30, minV2: 30, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathLoop,
  },
  CORKSCREW: {
    id: 'CORKSCREW', name: 'Corkscrew', icon: '🌀', category: 'stunt', featured: true,
    forward: 1, turn: 0, dz: 0,
    pathLen: 2.5, excitement: 18, minV2: 16, boostEnergy: 0,
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
    forward: 1, turn: 0, dz: 0,
    pathLen: 1.5, excitement: 12, minV2: 18, boostEnergy: 0,
    color: '#ff9d3d',
    pathLocal: pathJump,
  },
  FINISH: {
    id: 'FINISH', name: 'Finish', icon: '🏁', category: 'meta',
    forward: 1, turn: 0, dz: 0,
    pathLen: 1, excitement: 0, minV2: 0, boostEnergy: 0,
    color: '#00d4ff', isFinish: true,
    pathLocal: pathStraight,
  },
};

export const PALETTE_ORDER = [
  'STRAIGHT', 'CURVE_L', 'CURVE_R',
  'RAMP_UP', 'RAMP_DN',
  'LOOP', 'CORKSCREW', 'JUMP',
  'BOOSTER', 'FINISH',
];
