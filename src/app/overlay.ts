// app/overlay.ts — show/hide the run-result overlay panel.

import type { Track } from '../track.js';
import type { Simulator } from '../physics.js';
import type { ScoreResult, UIElements } from '../types.js';

export class ResultOverlay {
  els: UIElements;

  constructor(els: UIElements) { this.els = els; }

  show(track: Track, score: ScoreResult, sim: Simulator): void {
    this.els.overlayTitle.textContent = sim.failed
      ? '💥 Wipeout!'
      : sim.finished ? '🏁 Run Complete' : 'Run Ended';
    this.els.overlayBody.textContent = sim.failed
      ? (sim.failReason || 'The car came off the track.')
      : sim.finished
        ? 'Nice ride — design longer + more stunts for higher scores.'
        : '';
    this.els.overlayScore.textContent = String(score.total);
    this.els.overlayTop.textContent = sim.topSpeed.toFixed(1);
    this.els.overlayLength.textContent = String(track.pieces.length);
    this.els.overlay.classList.remove('hidden');
  }

  hide(): void { this.els.overlay.classList.add('hidden'); }
}
