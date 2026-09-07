// app/overlay.ts — show/hide the run-result overlay panel.
//
// The race only ends once every launched car has crossed the finish line (or
// crashed out), so the overlay summarizes ALL of them: a title/body describing
// the last car to finish (the one that triggered the overlay), the combined
// score, the best top speed of the pack, and a per-car breakdown list.

import type { Track } from '../track.js';
import type { Simulator } from '../physics.js';
import type { ScoreResult, UIElements } from '../types.js';

/** One car's completed run, as tracked by main.ts for the whole race. */
export interface CarRunResult {
  /** Display label, e.g. "Car 1". */
  label: string;
  score: ScoreResult;
  sim: Simulator;
}

function describeOutcome(sim: Simulator): { title: string; body: string } {
  if (!sim.failed) {
    return sim.finished
      ? { title: '\u{1F3C1} Run Complete', body: 'Nice ride \u2014 design longer + more stunts for higher scores.' }
      : { title: 'Run Ended', body: '' };
  }
  switch (sim.failType) {
    case 'rollback':
      return { title: '\u{1F504} Rolled Back!', body: sim.failReason || 'The car lost steam and slid back down.' };
    case 'overspeed_corner':
      return { title: '\u{1F4A5} KABOOM!', body: sim.failReason || 'Way too fast for that turn!' };
    case 'fly_off':
      return { title: '\u{1F680} Launched!', body: sim.failReason || 'The car flew right off the track!' };
    case 'crash':
      return { title: '\u{1F4A5} SMASHED!', body: sim.failReason || 'Not enough speed — the car exploded against the wall!' };
    case 'collapse':
      return { title: '\u{1F573}\u{FE0F} COLLAPSED!', body: sim.failReason || 'Too slow — the bridge gave way and the car fell!' };
    case 'rear_end':
      return { title: '\u{1F4A5} SHUNT!', body: sim.failReason || 'The cars piled into each other!' };
    case 'stall':
      return { title: '\u{1F40C} Out of Steam!', body: sim.failReason || 'The car ground to a halt.' };
    default:
      return { title: '\u{1F4A5} Wipeout!', body: sim.failReason || 'The car came off the track.' };
  }
}

export class ResultOverlay {
  els: UIElements;

  constructor(els: UIElements) { this.els = els; }

  /**
   * Show the final results panel once every car has finished its run.
   * `results` holds one entry per launched car, in launch order.
   */
  show(track: Track, results: CarRunResult[]): void {
    const last = results[results.length - 1];
    const { title, body } = last ? describeOutcome(last.sim) : { title: 'Race Complete', body: '' };

    const totalScore = results.reduce((sum, r) => sum + r.score.total, 0);
    const topSpeed = results.reduce((max, r) => Math.max(max, r.sim.topSpeed), 0);

    this.els.overlayTitle.textContent = results.length > 1 ? '\u{1F3C1} Race Complete' : title;
    this.els.overlayBody.textContent = results.length > 1
      ? `${results.length} cars raced \u2014 last one: ${body || (last?.sim.finished ? 'finished!' : 'crashed out.')}`
      : body;
    this.els.overlayScore.textContent = String(totalScore);
    this.els.overlayTop.textContent = topSpeed.toFixed(1);
    this.els.overlayLength.textContent = String(track.pieces.length);

    this.els.overlayCarsList.innerHTML = '';
    if (results.length > 1) {
      this.els.overlayCarsList.classList.remove('hidden');
      for (const r of results) {
        const row = document.createElement('div');
        row.className = 'overlay-car-row';
        // A shunt is called out separately: in a mixed field the interesting
        // question is whether a car crashed on its own or was taken out.
        const outcome = !r.sim.failed
          ? '\u{1F3C1} Finished'
          : r.sim.failType === 'rear_end' ? '\u{1F4A5} Shunted' : '\u{1F4A5} Crashed';
        row.innerHTML = `<span class="car-label">${r.label}</span>` +
          `<span class="car-outcome">${outcome}</span>` +
          `<span class="car-score">${r.score.total}</span>`;
        this.els.overlayCarsList.appendChild(row);
      }
    } else {
      this.els.overlayCarsList.classList.add('hidden');
    }

    this.els.overlay.classList.remove('hidden');
  }

  hide(): void { this.els.overlay.classList.add('hidden'); }
}
