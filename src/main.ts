// main.ts — App entry. Wires the renderer, editor, simulator, HUD, overlay,
// storage, and the run loop together. Most logic lives in dedicated modules.

import { Track } from './track.js';
import { Renderer } from './renderer/index.js';
import { Editor } from './editor.js';
import { Simulator } from './physics.js';
import { computeScore } from './scoring.js';
import { Hud } from './app/hud.js';
import { ResultOverlay } from './app/overlay.js';
import { saveTrackJSON, loadTrackJSON } from './app/storage.js';
import type { ScoreResult, UIElements } from './types.js';

type Mode = 'build' | 'play';

interface RunResult {
  score: ScoreResult;
  sim: Simulator;
}

/** Look up a required element by id, narrowing to the expected element type. */
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

const els: UIElements = {
  canvas: el<HTMLCanvasElement>('canvas'),
  modeBuild: el('mode-build'),
  modePlay: el('mode-play'),
  hudSpeed: el('hud-speed'),
  hudScore: el('hud-score'),
  hudPieces: el('hud-pieces'),
  drop: el<HTMLInputElement>('drop-height'),
  dropVal: el('drop-height-val'),
  palette: el('palette'),
  status: el('status'),
  btnUndo: el('btn-undo'),
  btnClear: el('btn-clear'),
  btnSave: el('btn-save'),
  btnLoad: el('btn-load'),
  overlay: el('overlay'),
  overlayTitle: el('overlay-title'),
  overlayBody: el('overlay-body'),
  overlayScore: el('overlay-score'),
  overlayTop: el('overlay-top'),
  overlayLength: el('overlay-length'),
  overlayClose: el('overlay-close'),
};

const track = new Track();
const renderer = new Renderer(els.canvas);
const hud = new Hud(els);
const overlay = new ResultOverlay(els);
const editor = new Editor({
  track,
  renderer,
  paletteEl: els.palette,
  statusEl: els.status,
  onChange: () => refreshHud(),
});

let mode: Mode = 'build';
let sim: Simulator | null = null;
let runResult: RunResult | null = null;
let lastFrameTime = performance.now();

// ---------- Boot ----------

const saved = loadTrackJSON();
if (saved) {
  track.fromJSON(saved);
} else {
  // Demo seed so the canvas isn't empty on first load — showcases the stunts.
  ['STRAIGHT', 'CORKSCREW', 'STRAIGHT', 'JUMP', 'STRAIGHT', 'BOOSTER',
    'STRAIGHT', 'LOOP', 'STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
}
syncDropUi();
renderer.rebuildTrack(track);
editor.refresh();
refreshHud();

// ---------- Event wiring ----------

els.drop.addEventListener('input', () => {
  track.dropHeight = Number(els.drop.value);
  els.dropVal.textContent = String(track.dropHeight);
  renderer.rebuildTrack(track);
});

els.btnUndo.addEventListener('click', () => editor.undo());
els.btnClear.addEventListener('click', () => {
  if (confirm('Clear the entire track?')) editor.clear();
});
els.btnSave.addEventListener('click', () => {
  saveTrackJSON(track.toJSON());
  hud.flashStatus('Track saved.', 'ok');
});
els.btnLoad.addEventListener('click', () => {
  const data = loadTrackJSON();
  if (!data) { hud.flashStatus('No saved track found.', 'err'); return; }
  track.fromJSON(data);
  syncDropUi();
  editor.refresh();
  hud.flashStatus('Track loaded.', 'ok');
  refreshHud();
});

els.modeBuild.addEventListener('click', () => switchMode('build'));
els.modePlay.addEventListener('click', () => switchMode('play'));
els.overlayClose.addEventListener('click', () => {
  overlay.hide();
  switchMode('build');
});

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    switchMode(mode === 'build' ? 'play' : 'build');
  }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    editor.undo();
  }
});

// ---------- Mode handling ----------

function switchMode(next: Mode): void {
  if (next === mode) return;
  if (next === 'play') {
    if (track.pieces.length === 0) {
      hud.flashStatus('Add some pieces first!', 'err');
      return;
    }
    mode = 'play';
    document.body.classList.add('mode-play');
    els.modeBuild.classList.remove('active');
    els.modePlay.classList.add('active');
    editor.setEnabled(false);
    els.drop.disabled = true; // drop height is a build-time setting
    sim = new Simulator(track);
    runResult = null;
    renderer.setCar(true, sim.carSample());
  } else {
    mode = 'build';
    document.body.classList.remove('mode-play');
    els.modePlay.classList.remove('active');
    els.modeBuild.classList.add('active');
    editor.setEnabled(true);
    els.drop.disabled = false;
    renderer.setCar(false);
    sim = null;
  }
  refreshHud();
}

function refreshHud(): void {
  if (mode === 'play') hud.updateForPlay(track, sim, runResult);
  else hud.updateForBuild(track);
}

function syncDropUi(): void {
  els.drop.value = String(track.dropHeight);
  els.dropVal.textContent = String(track.dropHeight);
}

// ---------- Run loop ----------

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (mode === 'play' && sim) {
    if (sim.isRunning()) {
      const subSteps = 4;
      const sdt = dt / subSteps;
      for (let i = 0; i < subSteps && sim.isRunning(); i++) sim.step(sdt);
      const sample = sim.carSample();
      if (sample) renderer.setCar(true, sample);
      els.hudSpeed.textContent = sim.speed.toFixed(1);
    } else if (!runResult) {
      const s = sim;
      const result: RunResult = { score: computeScore(track, s), sim: s };
      runResult = result;
      els.hudScore.textContent = String(result.score.total);
      setTimeout(() => {
        if (mode === 'play') overlay.show(track, result.score, s);
      }, 700);
    }
  }

  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
