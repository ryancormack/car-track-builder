// app/hud.js — Read-only DOM updates for the HUD strip + status line.

import { designScore } from '../scoring.js';

export class Hud {
  constructor(els) { this.els = els; }

  updateForBuild(track) {
    this.els.hudPieces.textContent = track.pieces.length;
    this.els.hudSpeed.textContent = '0';
    this.els.hudScore.textContent = designScore(track);
  }

  updateForPlay(track, sim, runResult) {
    this.els.hudPieces.textContent = track.pieces.length;
    this.els.hudSpeed.textContent = sim ? sim.speed.toFixed(1) : '0';
    this.els.hudScore.textContent = runResult ? runResult.score.total : '—';
  }

  flashStatus(msg, kind = '') {
    this.els.status.textContent = msg;
    this.els.status.className = 'status ' + kind;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.els.status.textContent = '';
      this.els.status.className = 'status';
    }, 2000);
  }
}
