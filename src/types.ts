// types.ts — Shared domain types for the track builder.
//
// These describe the plain data shapes that flow between the pure-logic
// modules (pieces, track, physics, scoring) and the renderer / app layers.

/** Compass direction: 0=N(-y), 1=E(+x), 2=S(+y), 3=W(-x). */
export type Dir = 0 | 1 | 2 | 3;

/** A unit step in grid space. */
export interface DirVec {
  dx: number;
  dy: number;
}

/** Position + heading of a piece's entry, in grid coordinates. */
export interface GridState {
  gx: number;
  gy: number;
  gz: number;
  dir: Dir;
}

/** Piece-local path sample: lx forward, ly right, lz up, banking in radians. */
export interface LocalPoint {
  lx: number;
  ly: number;
  lz: number;
  banking: number;
}

/** A point in world-grid coordinates (z is up). */
export interface WorldPoint {
  wx: number;
  wy: number;
  wz: number;
}

/** A world-space path sample (world point + banking angle). */
export interface WorldSample extends WorldPoint {
  banking: number;
}

/** Maps a parameter t in [0, 1] to a piece-local point. */
export type PathFn = (t: number) => LocalPoint;

/** Stable identifiers for every catalogue piece. */
export type PieceId =
  | 'START'
  | 'STRAIGHT'
  | 'CURVE_L'
  | 'CURVE_R'
  | 'RAMP_UP'
  | 'RAMP_DN'
  | 'LOOP'
  | 'CORKSCREW'
  | 'BOOSTER'
  | 'JUMP'
  | 'FINISH';

export type PieceCategory =
  | 'meta'
  | 'basic'
  | 'turn'
  | 'elev'
  | 'stunt'
  | 'special';

/** A track-piece definition from the catalogue. */
export interface Piece {
  id: PieceId;
  name: string;
  icon: string;
  category: PieceCategory;
  /** Cells advanced along the exit direction (almost always 1). */
  forward: number;
  /** Turn applied to the heading: -1 left, 0 straight, +1 right. */
  turn: number;
  /** Elevation change in grid units. */
  dz: number;
  /** Approximate path length, used for friction + scoring. */
  pathLen: number;
  excitement: number;
  /** Minimum v² required at entry; 0 means no gate. */
  minV2: number;
  /** Energy (v²) injected on entry; non-zero only for boosters. */
  boostEnergy: number;
  color: string;
  pathLocal: PathFn;
  featured?: boolean;
  boost?: boolean;
  hidden?: boolean;
  isStart?: boolean;
  isFinish?: boolean;
}

/**
 * The subset of a simulation run that scoring needs. The full {@link Simulator}
 * satisfies this structurally, and tests can pass a plain object.
 */
export interface SimSummary {
  topSpeed: number;
  boostersUsed: number;
  finished: boolean;
  failed: boolean;
}

export interface ScoreBreakdown {
  length: number;
  excitement: number;
  stuntCombo: number;
  speedBonus: number;
  completionBonus: number;
  boosterPenalty: number;
  failMult: number;
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
}

/** Serialised track, as stored in localStorage. */
export interface TrackJSON {
  dropHeight: number;
  pieces: PieceId[];
}

/** The DOM elements the app wires up at boot. */
export interface UIElements {
  canvas: HTMLCanvasElement;
  modeBuild: HTMLElement;
  modePlay: HTMLElement;
  hudSpeed: HTMLElement;
  hudScore: HTMLElement;
  hudPieces: HTMLElement;
  drop: HTMLInputElement;
  dropVal: HTMLElement;
  palette: HTMLElement;
  status: HTMLElement;
  btnUndo: HTMLElement;
  btnClear: HTMLElement;
  btnSave: HTMLElement;
  btnLoad: HTMLElement;
  overlay: HTMLElement;
  overlayTitle: HTMLElement;
  overlayBody: HTMLElement;
  overlayScore: HTMLElement;
  overlayTop: HTMLElement;
  overlayLength: HTMLElement;
  overlayClose: HTMLElement;
  selBar: HTMLElement;
  selName: HTMLElement;
  selDelete: HTMLElement;
  selDeselect: HTMLElement;
  selRejoin: HTMLElement;
}
