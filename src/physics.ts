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
import { G, FRICTION, RAMP_FRICTION_MULT, DRAG } from './constants.js';
import type { Track } from './track.js';
import type { TrackFrame } from './pieces/frames.js';
import type { PathFn } from './types.js';

// Re-exported for convenience (and backwards compatibility for importers/tests).
export { G, FRICTION, RAMP_FRICTION_MULT, DRAG };

export type FailType = 'speed_gate' | 'stall' | 'rollback' | 'overspeed_corner' | 'fly_off' | null;

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
      if ((pieceId === 'CURVE_L' || pieceId === 'CURVE_R') && this.v2 > 120) {
        this.failed = true;
        this.failReason = 'Too fast for the corner! The car flew off the edge!';
        this.failType = 'overspeed_corner';
        this.failPieceIndex = this.pieceIndex;
        return;
      }
      if (piece.boostEnergy > 0) {
        this.v2 += piece.boostEnergy;
        this.boostersUsed++;
      }
    }

    // Substep so very fast cars don't tunnel through pieces.
    const v = Math.sqrt(Math.max(this.v2, 0));
    if (pieceId === 'RAMP_UP' && this.v2 < 2.0 && this.v2 > 0.01 && this.t > 0.3) {
      this.failed = true;
      this.failReason = 'Not enough speed! The car rolls back down the hill...';
      this.failType = 'rollback';
      this.failPieceIndex = this.pieceIndex;
      return;
    }
    if (v < 0.1) {
      this.failed = true;
      this.failReason = 'Car ran out of speed.';
      this.failType = 'stall';
      this.failPieceIndex = this.pieceIndex;
      return;
    }

    // Travel a fraction of the piece during this dt.
    const ds = v * dt;
    const t_old = this.t;
    const t_new = Math.min(t_old + ds / piece.pathLen, 1);
    const ds_actual = (t_new - t_old) * piece.pathLen;

    // Use actual altitude change over the substep -- this correctly models
    // gravity through loops where lz oscillates.
    const resolvedPath = this._resolvedPath!;
    const p1 = resolvedPath(t_old);
    const p2 = resolvedPath(t_new);
    const dh = p2.lz - p1.lz; // local altitude change (grid units)

    const frictionMult = piece.id === 'RAMP_UP' || piece.id === 'RAMP_DN' ? RAMP_FRICTION_MULT : 1.0;
    this.v2 += -2 * G * dh - 2 * FRICTION * frictionMult * ds_actual - 2 * DRAG * this.v2 * ds_actual;

    if (this.v2 < 0) this.v2 = 0;

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
