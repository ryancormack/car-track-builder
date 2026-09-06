// pieces/definitions.ts — the catalogue of all piece types and palette ordering.
//
// The Loop's entry-speed gate is derived from the shared physics constants (see
// LOOP_MIN_V2 below). The other stunt `minV2` values (ramps, corkscrew, jump)
// are hand-tuned gameplay thresholds, not physical derivations.

import {
  pathStraight, pathCurveR, pathCurveL,
  pathWideR2, pathWideL2, pathWideR3, pathWideL3,
  pathBankR, pathBankL, pathChicaneR, pathChicaneL,
  pathRampUp, pathRampDown, pathSteepRampUp, pathSteepRampDown,
  pathSwitchbackR, pathSwitchbackL, pathLaunchpad, pathCrumbleBridge,
  pathDiveTurnR, pathDiveTurnL, pathZeroGRoll, pathWaveTurnR, pathWaveTurnL,
  ZERO_G_ROLL_RISE, WAVE_TURN_RISE,
  pathImmelmann, pathCobraRoll,
  IMMELMANN_LENGTH, COBRA_ROLL_LENGTH,
  HALF_LOOP_RADIUS, COBRA_SECOND_HUMP, IMMELMANN_RISE,
  pathLoop, pathCorkscrew, pathJump, pathWall, pathTopHat,
  TOP_HAT_LENGTH,
  pathSpiral, pathSteepHill,
  pathHelixUp, pathHelixDown, pathSpiralTower,
  pathGiantLoop, pathGiantJump,
} from './paths.js';
import { G, FRICTION, RAMP_FRICTION_MULT, LOOP_RADIUS, GIANT_LOOP_RADIUS, ICE_FRICTION_MULT, GRAVEL_FRICTION_MULT } from '../constants.js';
import type { DecorationId, Piece, PieceId, SurfaceId } from '../types.js';

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

// The Top Hat has NO entry-speed gate (minV2 = 0). Unlike a loop, its apex is a
// flat 180° U-turn with no centripetal requirement, so nothing physically has to
// be satisfied on entry. Instead of gating (which would freeze an underpowered
// car at the base), the simulator lets the car drive up the steep leg and roll
// back down when it runs out of momentum — see the rollback handling in
// physics.ts. A tall drop or a booster is still needed to actually clear it.

// Entry-speed gate for the Switchback ramp: it climbs 2 units while doing a flat
// 180° U-turn (arc ~3.72). Derived like the other climbs — gravity to the top
// plus friction along the way, with a margin.
const SWITCHBACK_RISE = 2;
const SWITCHBACK_LEN = 3.84;
const SWITCHBACK_MIN_V2 =
  2 * G * SWITCHBACK_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * SWITCHBACK_LEN +
  6;

// The Dive Turn is the same hairpin taken DOWNHILL, so it has no climb to pay
// for and no gate: it is the piece that gives height back. It shares the
// Switchback's arc, hence the shared length.
const DIVE_TURN_LEN = SWITCHBACK_LEN;

// Entry-speed gate for the Zero-g roll: it must crest the same hill the Steep
// Hill uses (gravity to the crest + friction over the climbing half), and it must
// arrive there with enough speed to be carried through the inverted apex rather
// than flopping over it. The inversion allowance is a gameplay figure; it puts
// the finished gate just above the Steep Hill's and above the plain Loop's,
// making this the most demanding inversion short of the Giant Loop — you need a
// real drop or a booster behind it.
const ZERO_G_ROLL_LEN = 3.73;
const ZERO_G_ROLL_INVERSION_ALLOWANCE = 8;
const ZERO_G_ROLL_MIN_V2 =
  2 * G * ZERO_G_ROLL_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * ZERO_G_ROLL_LEN / 2 +
  ZERO_G_ROLL_INVERSION_ALLOWANCE;

// Entry-speed gate for the Wave turn: only the small hump has to be cleared, so
// this is a low gate — it stays a corner you can take at speed (like the Bank it
// is based on, it is deliberately NOT subject to the flat-corner overspeed gate
// in physics.ts), just not one you can crawl over.
const WAVE_TURN_LEN = 1.32;
const WAVE_TURN_MIN_V2 =
  2 * G * WAVE_TURN_RISE +
  2 * FRICTION * RAMP_FRICTION_MULT * WAVE_TURN_LEN / 2 +
  3;

// Entry-speed gates for the two compound inversions. Both open with a genuine
// vertical half-loop, so the binding constraint is the same apex-contact
// condition the Loop uses — reuse loopEntryGate rather than inventing a second
// derivation — plus the friction toll over the rolling section that follows.
// These are the most expensive pieces in the catalogue after the Giant Loop,
// which is the intent: a double inversion should demand a real drop or a launch.
const IMMELMANN_ROLLOUT_LEN = IMMELMANN_LENGTH - HALF_LOOP_RADIUS * (1 + Math.PI);
const IMMELMANN_MIN_V2 =
  loopEntryGate(HALF_LOOP_RADIUS) +
  2 * FRICTION * IMMELMANN_ROLLOUT_LEN +
  2 * G * IMMELMANN_RISE;

const COBRA_ROLLOUT_LEN = COBRA_ROLL_LENGTH - HALF_LOOP_RADIUS * (1 + Math.PI);
const COBRA_ROLL_MIN_V2 =
  loopEntryGate(HALF_LOOP_RADIUS) +
  2 * FRICTION * COBRA_ROLLOUT_LEN +
  // The second hump is taken while rolling through fully inverted, so it needs
  // headroom of its own rather than just the energy to crest it.
  2 * G * COBRA_SECOND_HUMP;

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
    // Quarter circle of radius CURVE_RADIUS (0.5): arc = 0.5·π/2 ≈ 0.785. (The
    // old 1.2 made the car crawl through corners — pathLen drives the t-advance
    // and friction toll, so an overstated length slows traversal and over-brakes.)
    pathLen: 0.79, excitement: 2, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathCurveL,
  },
  CURVE_R: {
    id: 'CURVE_R', name: 'Turn Right', icon: '↱', category: 'turn',
    forward: 1, turn: 1, dz: 0,
    pathLen: 0.79, excitement: 2, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathCurveR,
  },
  BANK_L: {
    id: 'BANK_L', name: 'Banked Left', icon: '↩', category: 'turn', featured: true,
    // Same tight footprint as the standard curve, but the road leans into the
    // turn — so it is NOT overspeed-gated (you can take it flat out).
    forward: 1, turn: -1, dz: 0,
    pathLen: 0.79, excitement: 6, minV2: 0, boostEnergy: 0,
    color: '#ffb000',
    pathLocal: pathBankL,
  },
  BANK_R: {
    id: 'BANK_R', name: 'Banked Right', icon: '↪', category: 'turn', featured: true,
    forward: 1, turn: 1, dz: 0,
    pathLen: 0.79, excitement: 6, minV2: 0, boostEnergy: 0,
    color: '#ffb000',
    pathLocal: pathBankR,
  },
  WIDE_L_2: {
    id: 'WIDE_L_2', name: 'Wide Left', icon: '⤴', category: 'turn',
    forward: 2, entryAdvance: 1, turn: -1, dz: 0,
    pathLen: 2.36, excitement: 4, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideL2,
  },
  WIDE_R_2: {
    id: 'WIDE_R_2', name: 'Wide Right', icon: '⤵', category: 'turn',
    forward: 2, entryAdvance: 1, turn: 1, dz: 0,
    pathLen: 2.36, excitement: 4, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideR2,
  },
  WIDE_L_3: {
    id: 'WIDE_L_3', name: 'Sweep Left', icon: '⤺', category: 'turn',
    forward: 3, entryAdvance: 2, turn: -1, dz: 0,
    pathLen: 3.93, excitement: 6, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideL3,
  },
  WIDE_R_3: {
    id: 'WIDE_R_3', name: 'Sweep Right', icon: '⤻', category: 'turn',
    forward: 3, entryAdvance: 2, turn: 1, dz: 0,
    pathLen: 3.93, excitement: 6, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathWideR3,
  },
  CHICANE_L: {
    id: 'CHICANE_L', name: 'Chicane Left', icon: '⥮', category: 'turn', featured: true,
    // Weaves to shift one lane LEFT over 2 cells, keeping the same heading.
    forward: 2, turn: 0, sideAdvance: -1, dz: 0,
    pathLen: 2.27, excitement: 8, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathChicaneL,
  },
  CHICANE_R: {
    id: 'CHICANE_R', name: 'Chicane Right', icon: '⥯', category: 'turn', featured: true,
    forward: 2, turn: 0, sideAdvance: 1, dz: 0,
    pathLen: 2.27, excitement: 8, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathChicaneR,
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
  SWITCHBACK_L: {
    id: 'SWITCHBACK_L', name: 'Switchback Left', icon: '⮌', category: 'elev', featured: true,
    // Climbs 2 while doing a flat 180° U-turn to the left, exiting two lanes
    // over and reversed. Stack alternating L/R for a zig-zag climb.
    forward: 1, turn: 2, sideAdvance: -2, dz: 2,
    pathLen: 3.84, excitement: 18, minV2: SWITCHBACK_MIN_V2, boostEnergy: 0,
    color: '#ff8c1a',
    pathLocal: pathSwitchbackL,
  },
  SWITCHBACK_R: {
    id: 'SWITCHBACK_R', name: 'Switchback Right', icon: '⮎', category: 'elev', featured: true,
    forward: 1, turn: 2, sideAdvance: 2, dz: 2,
    pathLen: 3.84, excitement: 18, minV2: SWITCHBACK_MIN_V2, boostEnergy: 0,
    color: '#ff8c1a',
    pathLocal: pathSwitchbackR,
  },
  DIVE_TURN_L: {
    id: 'DIVE_TURN_L', name: 'Dive Turn Left', icon: '⤵', category: 'elev', featured: true,
    // The Switchback's descending twin: the same flat 180° hairpin, dropping 2
    // instead of climbing 2. Trades height back for speed, so unlike the
    // Switchback it needs no entry speed at all — this is how a stacked track
    // gets back down to the floor while reversing, in one piece.
    forward: 1, turn: 2, sideAdvance: -2, dz: -2,
    pathLen: DIVE_TURN_LEN, excitement: 20, minV2: 0, boostEnergy: 0,
    color: '#ff8c1a',
    pathLocal: pathDiveTurnL,
  },
  DIVE_TURN_R: {
    id: 'DIVE_TURN_R', name: 'Dive Turn Right', icon: '⤷', category: 'elev', featured: true,
    forward: 1, turn: 2, sideAdvance: 2, dz: -2,
    pathLen: DIVE_TURN_LEN, excitement: 20, minV2: 0, boostEnergy: 0,
    color: '#ff8c1a',
    pathLocal: pathDiveTurnR,
  },
  WAVE_TURN_L: {
    id: 'WAVE_TURN_L', name: 'Wave Turn Left', icon: '🌊', category: 'turn', featured: true,
    // A Bank with an airtime hump over the apex: same footprint and same
    // endpoints as Banked Left, so it drops into any slot a Bank fits, but it
    // lifts the car over a crest mid-corner and leans harder doing it.
    forward: 1, turn: -1, dz: 0,
    pathLen: WAVE_TURN_LEN, excitement: 12, minV2: WAVE_TURN_MIN_V2, boostEnergy: 0,
    color: '#ffc247',
    pathLocal: pathWaveTurnL,
  },
  WAVE_TURN_R: {
    id: 'WAVE_TURN_R', name: 'Wave Turn Right', icon: '🌊', category: 'turn', featured: true,
    forward: 1, turn: 1, dz: 0,
    pathLen: WAVE_TURN_LEN, excitement: 12, minV2: WAVE_TURN_MIN_V2, boostEnergy: 0,
    color: '#ffc247',
    pathLocal: pathWaveTurnR,
  },
  ZERO_G_ROLL: {
    id: 'ZERO_G_ROLL', name: 'Zero-G Roll', icon: '🔃', category: 'stunt', featured: true,
    // A full 360° roll taken over the crest of an airtime hill — inverted and
    // weightless at the same instant. Same two-cell footprint and level exit as
    // the Steep Hill it is built on, but it costs more entry speed than either
    // that or the flat Corkscrew.
    forward: 2, turn: 0, dz: 0,
    pathLen: ZERO_G_ROLL_LEN, excitement: 26, minV2: ZERO_G_ROLL_MIN_V2, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathZeroGRoll,
  },
  IMMELMANN: {
    id: 'IMMELMANN', name: 'Immelmann', icon: '🛩', category: 'stunt', featured: true,
    // Pitches up and over through a vertical half-loop (inverting), then rolls
    // upright as it eases down into the parallel lane — so it inverts AND turns
    // the car around, which nothing else in the catalogue does. Exits reversed,
    // one lane over and one unit HIGHER than it entered: it converts speed into
    // height and a change of direction.
    forward: 4, turn: 2, sideAdvance: 2, dz: 1,
    pathLen: IMMELMANN_LENGTH, excitement: 32, minV2: IMMELMANN_MIN_V2, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathImmelmann,
  },
  COBRA_ROLL: {
    id: 'COBRA_ROLL', name: 'Cobra Roll', icon: '🐍', category: 'stunt', featured: true,
    // Two humps, two inversions, exits reversed and level. The biggest
    // single-piece excitement payoff in the catalogue and the most demanding
    // gate after the Giant Loop.
    forward: 6, turn: 2, sideAdvance: 2, dz: 0,
    pathLen: COBRA_ROLL_LENGTH, excitement: 44, minV2: COBRA_ROLL_MIN_V2, boostEnergy: 0,
    color: '#3da9fc',
    pathLocal: pathCobraRoll,
  },
  LAUNCHPAD: {
    id: 'LAUNCHPAD', name: 'Launchpad', icon: '🚀', category: 'special', boost: true, featured: true,
    // A booster on a 2-unit climbing ramp: rockets the car up and onto a higher
    // section. Stronger boost than the standard booster.
    forward: 2, turn: 0, dz: 2,
    pathLen: 2.91, excitement: 12, minV2: 0, boostEnergy: 150,
    color: '#ff4500',
    pathLocal: pathLaunchpad,
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
    pathLen: 3.4, excitement: 12, minV2: 18, boostEnergy: 0,
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
  CRUMBLE_BRIDGE: {
    id: 'CRUMBLE_BRIDGE', name: 'Crumbling Bridge', icon: '🌉', category: 'special', featured: true,
    // A 2-cell span. minV2 stays 0: the cross-or-collapse gate
    // (CRUMBLE_BRIDGE_V2) is handled specially in physics.ts so failing it makes
    // the bridge give way and the car FALL ('collapse'), not the generic gate.
    forward: 2, turn: 0, dz: 0,
    pathLen: 2.0, excitement: 16, minV2: 0, boostEnergy: 0,
    color: '#9c7a4a',
    pathLocal: pathCrumbleBridge,
  },
  TOP_HAT: {
    id: 'TOP_HAT', name: 'Top Hat', icon: '🎩', category: 'stunt', featured: true,
    // Doubles back: 180° U-turn high in the air, exiting one lane over (turn=2 +
    // sideAdvance=2). A tall climb, so it needs real entry speed.
    forward: 1, entryAdvance: 0, sideAdvance: 2, turn: 2, dz: 0,
    pathLen: TOP_HAT_LENGTH, excitement: 34, minV2: 0, boostEnergy: 0,
    color: '#ff7a1a',
    pathLocal: pathTopHat,
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
    pathLen: 5.18, excitement: 20, minV2: GIANT_JUMP_MIN_V2, boostEnergy: 0,
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

/** A labelled section of the build palette. */
export interface PaletteGroup {
  label: string;
  ids: PieceId[];
}

/**
 * The build palette, organised into labelled sections so the (now large)
 * catalogue is easy to scan. Order within a group goes simple → dramatic.
 */
export const PALETTE_GROUPS: PaletteGroup[] = [
  { label: 'Basics', ids: ['STRAIGHT'] },
  {
    label: 'Turns',
    ids: ['CURVE_L', 'CURVE_R', 'BANK_L', 'BANK_R', 'WAVE_TURN_L', 'WAVE_TURN_R', 'WIDE_L_2', 'WIDE_R_2', 'WIDE_L_3', 'WIDE_R_3', 'CHICANE_L', 'CHICANE_R'],
  },
  {
    label: 'Elevation',
    ids: ['RAMP_UP', 'RAMP_DN', 'STEEP_RAMP_UP', 'STEEP_RAMP_DN', 'STEEP_HILL', 'SWITCHBACK_L', 'SWITCHBACK_R', 'DIVE_TURN_L', 'DIVE_TURN_R'],
  },
  {
    label: 'Stunts',
    ids: ['LOOP', 'GIANT_LOOP', 'CORKSCREW', 'ZERO_G_ROLL', 'IMMELMANN', 'COBRA_ROLL', 'JUMP', 'GIANT_JUMP', 'TOP_HAT', 'SPIRAL', 'SPIRAL_TOWER', 'HELIX_UP', 'HELIX_DN'],
  },
  { label: 'Hazards', ids: ['WALL', 'CRUMBLE_BRIDGE'] },
  { label: 'Boost', ids: ['BOOSTER', 'BRAKE', 'LAUNCHPAD'] },
  { label: 'Finish', ids: ['FINISH'] },
];

/** Flat palette order, derived from the grouped layout (kept for compatibility). */
export const PALETTE_ORDER: PieceId[] = PALETTE_GROUPS.flatMap((g) => g.ids);

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
  WATER_SPLASH: {
    id: 'WATER_SPLASH', name: 'Water Splash', icon: '💦', excitement: 8,
  },
};

/** Decoration ordering for the palette. */
export const DECORATION_ORDER: DecorationId[] = ['RING_OF_FIRE', 'WATER_SPLASH'];

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

/** A surface that can be laid over an existing piece, changing its grip. */
export interface Surface {
  id: SurfaceId;
  name: string;
  icon: string;
  /** Multiplier applied to FRICTION along a piece carrying this surface. */
  frictionMult: number;
  /** One-line description for the palette chip's tooltip. */
  blurb: string;
}

export const SURFACES: Record<SurfaceId, Surface> = {
  ICE: {
    id: 'ICE', name: 'Ice', icon: '❄️', frictionMult: ICE_FRICTION_MULT,
    blurb: 'Almost no grip — the car barely loses speed along it',
  },
  GRAVEL: {
    id: 'GRAVEL', name: 'Gravel', icon: '🪨', frictionMult: GRAVEL_FRICTION_MULT,
    blurb: 'Loose and draggy — scrubs speed off the car',
  },
};

/** Surface ordering for the palette strip. */
export const SURFACE_ORDER: SurfaceId[] = ['ICE', 'GRAVEL'];

/** Narrows an arbitrary string to a known SurfaceId. */
export function isSurfaceId(id: string): id is SurfaceId {
  return Object.prototype.hasOwnProperty.call(SURFACES, id);
}

/**
 * Pieces that cannot carry a laid surface because the car is not riding on its
 * wheels along normal road: the inversions and coils that flip it (where "grip"
 * is incoherent and the simulator's own mid-loop contact rule governs instead),
 * the ballistic jumps (airborne for most of the piece), and the two barrier
 * pieces that gate on their own constants (WALL_SMASH_V2 / CRUMBLE_BRIDGE_V2).
 *
 * This is an explicit list because the property it encodes — "the car goes
 * inverted or airborne here" — is a fact about each sampler's geometry. The
 * INVERTING half is kept honest by a catalogue-derived test that measures every
 * piece's up-vector and fails, naming the piece, if this list drifts (the same
 * guard pattern that `isRampGrade` / `isHill` use in physics.ts, after a literal
 * list there once silently missed seven new pieces). The two jumps are listed on
 * the separate ballistic grounds that the car leaves the road entirely, which
 * that up-vector measurement does not detect — so a NEW jump-like piece would
 * need adding here by hand.
 */
const UNSURFACEABLE: ReadonlySet<PieceId> = new Set<PieceId>([
  'LOOP', 'GIANT_LOOP', 'CORKSCREW', 'IMMELMANN', 'COBRA_ROLL', 'ZERO_G_ROLL',
  'JUMP', 'GIANT_JUMP',
  'WALL', 'CRUMBLE_BRIDGE',
]);

/**
 * Whether a surface can be laid on the given piece type.
 *
 * Deliberately much wider than {@link canDecorate}: a decoration is a prop that
 * would clip through banked or curved track, whereas a surface is the piece's
 * own road material and so is geometrically fine anywhere the car has wheels
 * down — including every climb, descent, turn and coil.
 *
 * Note that a gated piece (`minV2 > 0`) is deliberately still surfaceable: the
 * gate is tested at ENTRY, before this piece's friction is integrated, so a
 * surface cannot invalidate the threshold. It only changes how much speed the
 * car keeps ALONG the piece — a gravelled climb the car cannot crest is
 * reported as a rollback by the simulator, which is the intended difficulty
 * rather than a broken gate.
 */
export function canModify(pieceId: PieceId): boolean {
  const piece = PIECES[pieceId];
  if (!piece) return false;
  if (piece.isStart || piece.isFinish) return false;
  // Boosters, brakes and the launchpad exist purely to change speed; layering a
  // grip change on top muddles a piece whose whole identity is its speed effect.
  if (piece.boostEnergy !== 0) return false;
  return !UNSURFACEABLE.has(pieceId);
}
