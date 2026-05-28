// physics.js — Energy-based simulator. Car follows the parametric track path.
//
// We work in v² (kinetic energy proxy) for clean conservation accounting.
// At each step ds along the piece's path:
//   Δ(v²) = -2·g·Δh  -  2·μ·ds   (- 2·c_d·v²·ds, optional aerodynamic drag)
//
// On entering a piece we check minV2 (used for loops/corkscrews/jumps that
// require enough centripetal speed to stay on the track). Failing that, the
// car is launched off the track and the run ends.

import { PIECES, piecePathAtT } from './pieces/index.js';

export const G = 9.8;
export const FRICTION = 0.55;   // energy lost per unit length of track
export const RAMP_FRICTION_MULT = 1.1; // ramps slightly costlier
export const DRAG = 0.0008;     // tiny v²-proportional drag, keeps things bounded

export class Simulator {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.pieceIndex = 0;
    this.t = 0;
    this.v2 = 2 * G * this.track.dropHeight; // initial kinetic from drop height
    this.distanceTraveled = 0;
    this.topSpeed = Math.sqrt(this.v2);
    this.boostersUsed = 0;
    this.failed = false;
    this.failReason = null;
    this.finished = false;
    this.elapsed = 0;
    this._enteredPiece = -1;     // last piece index where we ran the entry check
  }

  get speed() { return Math.sqrt(Math.max(this.v2, 0)); }

  isRunning() { return !this.failed && !this.finished; }

  // Advance simulation by dt seconds.
  step(dt) {
    if (!this.isRunning()) return;
    this.elapsed += dt;

    if (this.pieceIndex >= this.track.pieces.length) {
      this.finished = true;
      return;
    }

    const pieceId = this.track.pieces[this.pieceIndex];
    const piece = PIECES[pieceId];

    // Entry checks — once per piece.
    if (this._enteredPiece !== this.pieceIndex) {
      this._enteredPiece = this.pieceIndex;
      if (piece.minV2 > 0 && this.v2 < piece.minV2) {
        this.failed = true;
        this.failReason = `Too slow for ${piece.name}! Add a booster or higher drop.`;
        return;
      }
      if (piece.boostEnergy > 0) {
        this.v2 += piece.boostEnergy;
        this.boostersUsed++;
      }
    }

    // Substep so very fast cars don't tunnel through pieces.
    const v = Math.sqrt(Math.max(this.v2, 0));
    if (v < 0.1) {
      this.failed = true;
      this.failReason = "Car ran out of speed.";
      return;
    }

    // Travel a fraction of the piece during this dt.
    const ds = v * dt;
    const t_old = this.t;
    const t_new = Math.min(t_old + ds / piece.pathLen, 1);
    const ds_actual = (t_new - t_old) * piece.pathLen;

    // Use actual altitude change over the substep — this correctly models
    // gravity through loops where lz oscillates.
    const p1 = piece.pathLocal(t_old);
    const p2 = piece.pathLocal(t_new);
    const dh = p2.lz - p1.lz; // local altitude change (grid units)

    const frictionMult = piece.id === 'RAMP_UP' || piece.id === 'RAMP_DN' ? RAMP_FRICTION_MULT : 1.0;
    this.v2 += -2 * G * dh - 2 * FRICTION * frictionMult * ds_actual - 2 * DRAG * this.v2 * ds_actual;

    if (this.v2 < 0) this.v2 = 0;

    const newSpeed = Math.sqrt(Math.max(this.v2, 0));
    if (newSpeed > this.topSpeed) this.topSpeed = newSpeed;

    this.t = t_new;
    this.distanceTraveled += ds_actual;

    if (this.t >= 1 - 1e-6) {
      // Finished this piece — advance.
      const completed = piece;
      this.t = 0;
      this.pieceIndex++;

      if (completed.isFinish) {
        this.finished = true;
        return;
      }
      if (this.pieceIndex >= this.track.pieces.length) {
        // Ran off the end without a Finish piece — counts as falling off.
        this.failed = true;
        this.failReason = "Track ended without a Finish line!";
      }
    }
  }

  // Sample current car world position and forward direction (grid-space coords).
  carSample() {
    if (!this.isRunning() && !this.finished) {
      // For visualization after fail, freeze at last position.
    }
    const idx = Math.min(this.pieceIndex, this.track.pieces.length - 1);
    if (idx < 0) return null;
    const piece = PIECES[this.track.pieces[idx]];
    const entry = this.track.entryStateAt(idx);
    const t = Math.min(Math.max(this.t, 0), 1);
    const here = piecePathAtT(piece, entry, t);

    // Tangent via finite difference.
    const t2 = Math.min(t + 0.02, 1);
    const t1 = Math.max(t - 0.02, 0);
    const a = piecePathAtT(piece, entry, t1);
    const b = piecePathAtT(piece, entry, t2);
    return {
      pos: here,
      tangent: { dx: b.wx - a.wx, dy: b.wy - a.wy, dz: b.wz - a.wz },
      banking: here.banking || 0,
    };
  }
}
