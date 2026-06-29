// physics.ts — Energy-based simulator. Car follows the parametric track path.
//
// We work in v² (kinetic energy proxy) for clean conservation accounting.
// At each step ds along the piece's path:
//   Δ(v²) = -2·g·Δh  -  2·μ·ds   (- 2·c_d·v²·ds, optional aerodynamic drag)
//
// On entering a piece we check minV2 (used for loops/corkscrews/jumps that
// require enough centripetal speed to stay on the track). Failing that, the
// car is launched off the track and the run ends.

import { PIECES, trackFrameAt, resolvePathLocal } from './pieces/index.js';
import {
  G, FRICTION, RAMP_FRICTION_MULT, DRAG,
  CORNER_MAX_V2, STALL_SPEED, LOOP_RADIUS, GIANT_LOOP_RADIUS,
} from './constants.js';
import type { Track } from './track.js';
import type { TrackFrame } from './pieces/frames.js';
import type { PathFn } from './types.js';

// Re-exported for convenience (and backwards compatibility for importers/tests).
export { G, FRICTION, RAMP_FRICTION_MULT, DRAG };

// Numerical tolerances (in v² units). Small slack so discretisation never trips
// a failure on a car that is genuinely within its physical envelope.
const ROLLBACK_EPS = 0.5; // how far below "energy to crest" counts as doomed
const CONTACT_EPS = 0.25; // how far below the loop contact threshold counts as a peel-off

export type FailType = 'speed_gate' | 'stall' | 'rollback' | 'overspeed_corner' | 'fly_off' | null;

// Pieces that carry a graded surface (a non-trivial up/down slope) and so pay
// the steeper-grade friction surcharge: the ramps plus every coil. Loops, jumps
// and flat pieces are excluded — loops handle their own contact physics and the
// others are flat or ballistic. Exported so the catalogue/test layer can assert
// that every coil is treated consistently.
export function isRampGrade(id: string): boolean {
  return id === 'RAMP_UP' || id === 'RAMP_DN' || id === 'STEEP_HILL'
    || id === 'HELIX_UP' || id === 'HELIX_DN' || id === 'SPIRAL' || id === 'SPIRAL_TOWER';
}

// Genuine "hills" the car drives over the top of (as opposed to looping through
// or coiling around). These are the only pieces where running out of speed
// means rolling back down rather than peeling off or stalling.
export function isHill(id: string): boolean {
  return id === 'RAMP_UP' || id === 'STEEP_HILL' || id === 'HELIX_UP';
}

export class Simulator {
  track: Track;
  pieceIndex = 0;
  t = 0;
  v2 = 0;
  distanceTraveled = 0;
  topSpeed = 0;
  boostersUsed = 0;
  failed = false;
  failReason: string | null = null;
  failType: FailType = null;
  failPieceIndex = -1;
  finished = false;
  elapsed = 0;
  private _enteredPiece = -1; // last piece index where we ran the entry check
  private _resolvedPath: PathFn | null = null;

  constructor(track: Track) {
    this.track = track;
    this.reset();
  }

  reset(): void {
    this.pieceIndex = 0;
    this.t = 0;
    this.v2 = 2 * G * this.track.dropHeight; // initial kinetic from drop height
    this.distanceTraveled = 0;
    this.topSpeed = Math.sqrt(this.v2);
    this.boostersUsed = 0;
    this.failed = false;
    this.failReason = null;
    this.failType = null;
    this.failPieceIndex = -1;
    this.finished = false;
    this.elapsed = 0;
    this._enteredPiece = -1;
    // Eagerly initialize the resolved path so the hot loop never hits a null.
    this._resolvedPath = this.track.pieces.length > 0
      ? resolvePathLocal(this.track.pieces, 0)
      : null;
  }

  get speed(): number { return Math.sqrt(Math.max(this.v2, 0)); }

  isRunning(): boolean { return !this.failed && !this.finished; }

  // Advance simulation by dt seconds.
  step(dt: number): void {
    if (!this.isRunning()) return;
    this.elapsed += dt;

    if (this.pieceIndex >= this.track.pieces.length) {
      this.finished = true;
      return;
    }

    const pieceId = this.track.pieces[this.pieceIndex];
    const piece = PIECES[pieceId];

    // Entry checks -- once per piece.
    if (this._enteredPiece !== this.pieceIndex) {
      this._enteredPiece = this.pieceIndex;
      this._resolvedPath = resolvePathLocal(this.track.pieces, this.pieceIndex);
      if (piece.minV2 > 0 && this.v2 < piece.minV2) {
        this.failed = true;
        this.failReason = `Too slow for ${piece.name}! Add a booster or higher drop.`;
        this.failType = 'speed_gate';
        this.failPieceIndex = this.pieceIndex;
        return;
      }
      if ((pieceId === 'CURVE_L' || pieceId === 'CURVE_R') && this.v2 > CORNER_MAX_V2) {
        this.failed = true;
        this.failReason = 'Too fast for the corner! The car flew off the edge!';
        this.failType = 'overspeed_corner';
        this.failPieceIndex = this.pieceIndex;
        return;
      }
      if (piece.boostEnergy !== 0) {
        this.v2 += piece.boostEnergy;
        if (this.v2 < 0) this.v2 = 0;
        if (piece.boostEnergy > 0) this.boostersUsed++;
      }
    }

    const v = Math.sqrt(Math.max(this.v2, 0));
    const resolvedPath = this._resolvedPath!;

    // Friction multiplier: every graded piece — ramps AND coils (helix, spiral,
    // spiral tower) — pays the steeper-grade surcharge. Computed once here so the
    // rollback estimate and the energy update agree on the toll.
    const frictionMult = isRampGrade(pieceId) ? RAMP_FRICTION_MULT : 1.0;

    // Rollback: on a genuine hill (a piece the car drives over the top of), bail
    // out the instant it can no longer reach the next crest, rather than waiting
    // for a fixed low-speed threshold. This reports "rolled back" at the right
    // moment for any climb height instead of silently degrading into a stall.
    if (isHill(pieceId) && this.v2 > 0.01 &&
        this.cannotReachCrest(resolvedPath, frictionMult)) {
      this.failed = true;
      this.failReason = 'Not enough speed! The car rolls back down the hill...';
      this.failType = 'rollback';
      this.failPieceIndex = this.pieceIndex;
      return;
    }
    if (v < STALL_SPEED) {
      this.failed = true;
      this.failReason = 'Car ran out of speed.';
      this.failType = 'stall';
      this.failPieceIndex = this.pieceIndex;
      return;
    }

    // Travel a fraction of the piece during this dt. Substep (in main.ts) keeps
    // ds small so very fast cars don't tunnel through pieces.
    const ds = v * dt;
    const t_old = this.t;
    const t_new = Math.min(t_old + ds / piece.pathLen, 1);
    const ds_actual = (t_new - t_old) * piece.pathLen;

    // Use actual altitude change over the substep -- this correctly models
    // gravity through loops where lz oscillates.
    const p1 = resolvedPath(t_old);
    const p2 = resolvedPath(t_new);
    const dh = p2.lz - p1.lz; // local altitude change (grid units)

    this.v2 += -2 * G * dh - 2 * FRICTION * frictionMult * ds_actual - 2 * DRAG * this.v2 * ds_actual;

    if (this.v2 < 0) this.v2 = 0;

    // Mid-loop contact: on a vertical loop the car can only stay pinned while
    // v² ≥ g·(h − R), where h is its height above the loop's base and R the loop
    // radius (the inside-of-the-loop normal-force condition; tightest at the
    // apex h = 2R, giving the familiar v² ≥ g·R). If it falls short anywhere on
    // the upper half, it peels off the track. The entry gate (LOOP_MIN_V2) is
    // sized so a legal entry clears this everywhere; this check is the
    // step-by-step guarantee so an under-speed loop can never silently "pass".
    const loopRadius = pieceId === 'LOOP' ? LOOP_RADIUS
      : pieceId === 'GIANT_LOOP' ? GIANT_LOOP_RADIUS : 0;
    if (loopRadius > 0) {
      const required = G * (p2.lz - loopRadius);
      if (required > 0 && this.v2 + CONTACT_EPS < required) {
        this.failed = true;
        this.failReason = 'Too slow at the top of the loop — the car peeled off!';
        this.failType = 'fly_off';
        this.failPieceIndex = this.pieceIndex;
        return;
      }
    }

    const newSpeed = Math.sqrt(Math.max(this.v2, 0));
    if (newSpeed > this.topSpeed) this.topSpeed = newSpeed;

    this.t = t_new;
    this.distanceTraveled += ds_actual;

    if (this.t >= 1 - 1e-6) {
      // Finished this piece -- advance.
      const completed = piece;
      this.t = 0;
      this.pieceIndex++;

      if (completed.isFinish) {
        this.finished = true;
        return;
      }
      if (this.pieceIndex >= this.track.pieces.length) {
        // Ran off the end without a Finish piece -- counts as falling off.
        this.failed = true;
        this.failReason = 'Track ended without a Finish line!';
        this.failType = 'fly_off';
        this.failPieceIndex = this.pieceIndex - 1;
      }
    }
  }

  // Estimate whether the car is doomed on the current climb: scan the remaining
  // path and find the highest forthcoming point; the car can only get there if
  // its current v² covers the gravity climb to it plus the friction toll along
  // the way. If it falls short (beyond a small tolerance), it will roll back.
  // Pure read of `this.v2`/`this.t`; the caller supplies the resolved path and
  // the same frictionMult used by the energy integration so the two agree.
  private cannotReachCrest(path: PathFn, frictionMult: number): boolean {
    const SAMPLES = 24;
    const here = path(this.t);
    let prev = here;
    let arc = 0;
    let required = 0;
    for (let i = 1; i <= SAMPLES; i++) {
      const tt = this.t + (1 - this.t) * (i / SAMPLES);
      const pt = path(tt);
      arc += Math.hypot(pt.lx - prev.lx, pt.ly - prev.ly, pt.lz - prev.lz);
      const climb = pt.lz - here.lz;
      if (climb > 0) {
        const need = 2 * G * climb + 2 * FRICTION * frictionMult * arc;
        if (need > required) required = need;
      }
      prev = pt;
    }
    return this.v2 + ROLLBACK_EPS < required;
  }

  // Sample the car's current frame (position + orientation) from the shared,
  // unit-tested frame logic, so the car hugs the track surface (loops/corkscrews
  // included) exactly as the rails do.
  carSample(): TrackFrame | null {
    const n = this.track.pieces.length;
    if (n === 0) return null;

    // If we've run past the last piece (finished, or fell off the end), sit at
    // the very end of the final piece rather than snapping back to its start.
    let idx: number;
    let t: number;
    if (this.pieceIndex >= n) {
      idx = n - 1;
      t = 1;
    } else {
      idx = this.pieceIndex;
      t = Math.min(Math.max(this.t, 0), 1);
    }

    const entry = this.track.entryStateAt(idx);
    const resolvedPath = resolvePathLocal(this.track.pieces, idx);
    return trackFrameAt(resolvedPath, entry, t);
  }
}
