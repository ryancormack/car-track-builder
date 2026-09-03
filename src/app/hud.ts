// app/hud.ts — Read-only DOM updates for the HUD strip + status line.

import { designScore } from '../scoring.js';
import type { Track } from '../track.js';
import type { UIElements } from '../types.js';

export type StatusKind = 'ok' | 'err' | '';

/** Aggregated race stats consumed by {@link Hud.updateForPlay}. */
export interface RaceHudStats {
  /** Speed of the car currently being followed by the camera (0 if none running). */
  speed: number;
  /** Sum of the scores of every car that has finished its run so far. */
  scoreSoFar: number;
  /** How many launched cars have completed their run (finished or crashed). */
  carsDone: number;
  /** How many cars have been launched down the track so far. */
  carsLaunched: number;
  /** The configured total number of cars for this race. */
  carsTotal: number;
}

export class Hud {
  els: UIElements;
  private _timer?: ReturnType<typeof setTimeout>;

  constructor(els: UIElements) { this.els = els; }

  updateForBuild(track: Track): void {
    this.els.hudPieces.textContent = String(track.nonEmptyCount());
    this.els.hudSpeed.textContent = '0';
    this.els.hudScore.textContent = String(designScore(track));
    this.els.hudCars.textContent = '—';
  }

  updateForPlay(track: Track, stats: RaceHudStats): void {
    this.els.hudPieces.textContent = String(track.nonEmptyCount());
    this.els.hudSpeed.textContent = stats.speed.toFixed(1);
    this.els.hudScore.textContent = stats.carsDone > 0 ? String(stats.scoreSoFar) : '—';
    this.els.hudCars.textContent = `${stats.carsDone}/${stats.carsTotal}`;
  }

  flashStatus(msg: string, kind: StatusKind = ''): void {
    this.els.status.textContent = msg;
    this.els.status.className = 'status ' + kind;
    // Mirror into the stage banner so the message is visible during play (the
    // sidebar status line is dimmed in play mode). Same lifetime — cleared by
    // the timer below.
    const banner = this.els.playStatus;
    if (banner) {
      banner.textContent = msg;
      banner.className = 'play-status ' + kind;
    }
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.els.status.textContent = '';
      this.els.status.className = 'status';
      if (banner) {
        banner.textContent = '';
        banner.className = 'play-status';
      }
    }, 2000);
  }
}
