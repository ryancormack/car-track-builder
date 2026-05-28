// app/overlay.js — show/hide the run-result overlay panel.

export class ResultOverlay {
  constructor(els) { this.els = els; }

  show(track, score, sim) {
    this.els.overlayTitle.textContent = sim.failed
      ? '💥 Wipeout!'
      : sim.finished ? '🏁 Run Complete' : 'Run Ended';
    this.els.overlayBody.textContent = sim.failed
      ? (sim.failReason || 'The car came off the track.')
      : sim.finished
        ? 'Nice ride — design longer + more stunts for higher scores.'
        : '';
    this.els.overlayScore.textContent = score.total;
    this.els.overlayTop.textContent = sim.topSpeed.toFixed(1);
    this.els.overlayLength.textContent = track.pieces.length;
    this.els.overlay.classList.remove('hidden');
  }

  hide() { this.els.overlay.classList.add('hidden'); }
}
