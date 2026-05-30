// app/hud.ts — Read-only DOM updates for the HUD strip + status line.

import { designScore } from '../scoring.js';
import type { Track } from '../track.js';
import type { Simulator } from '../physics.js';
import type { ScoreResult, UIElements } from '../types.js';

export type StatusKind = 'ok' | 'err' | '';

export class Hud {
  els: UIElements;
  private _timer?: ReturnType<typeof setTimeout>;

  constructor(els: UIElements) { this.els = els; }

  updateForBuild(track: Track): void {
    this.els.hudPieces.textContent = String(track.nonEmptyCount());
    this.els.hudSpeed.textContent = '0';
    this.els.hudScore.textContent = String(designScore(track));
  }

  updateForPlay(track: Track, sim: Simulator | null, runResult: { score: ScoreResult } | null): void {
    this.els.hudPieces.textContent = String(track.nonEmptyCount());
    this.els.hudSpeed.textContent = sim ? sim.speed.toFixed(1) : '0';
    this.els.hudScore.textContent = runResult ? String(runResult.score.total) : '—';
  }

  flashStatus(msg: string, kind: StatusKind = ''): void {
    this.els.status.textContent = msg;
    this.els.status.className = 'status ' + kind;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.els.status.textContent = '';
      this.els.status.className = 'status';
    }, 2000);
  }
}
