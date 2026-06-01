// app/overlay.ts — show/hide the run-result overlay panel.

import type { Track } from '../track.js';
import type { Simulator } from '../physics.js';
import type { ScoreResult, UIElements } from '../types.js';

export class ResultOverlay {
  els: UIElements;

  constructor(els: UIElements) { this.els = els; }

  show(track: Track, score: ScoreResult, sim: Simulator): void {
    let title: string;
    let body: string;

    if (!sim.failed) {
      title = sim.finished ? '\u{1F3C1} Run Complete' : 'Run Ended';
      body = sim.finished
        ? 'Nice ride \u2014 design longer + more stunts for higher scores.'
        : '';
    } else {
      switch (sim.failType) {
        case 'rollback':
          title = '\u{1F504} Rolled Back!';
          body = sim.failReason || 'The car lost steam and slid back down.';
          break;
        case 'overspeed_corner':
          title = '\u{1F4A5} KABOOM!';
          body = sim.failReason || 'Way too fast for that turn!';
          break;
        case 'fly_off':
          title = '\u{1F680} Launched!';
          body = sim.failReason || 'The car flew right off the track!';
          break;
        case 'stall':
          title = '\u{1F40C} Out of Steam!';
          body = sim.failReason || 'The car ground to a halt.';
          break;
        default:
          title = '\u{1F4A5} Wipeout!';
          body = sim.failReason || 'The car came off the track.';
          break;
      }
    }

    this.els.overlayTitle.textContent = title;
    this.els.overlayBody.textContent = body;
    this.els.overlayScore.textContent = String(score.total);
    this.els.overlayTop.textContent = sim.topSpeed.toFixed(1);
    this.els.overlayLength.textContent = String(track.pieces.length);
    this.els.overlay.classList.remove('hidden');
  }

  hide(): void { this.els.overlay.classList.add('hidden'); }
}
