// main.js — App entry. Wires the renderer, editor, simulator, HUD, overlay,
// storage, and the run loop together. Most logic lives in dedicated modules.

import { Track } from './track.js';
import { Renderer } from './renderer/index.js';
import { Editor } from './editor.js';
import { Simulator } from './physics.js';
import { computeScore } from './scoring.js';
import { Hud } from './app/hud.js';
import { ResultOverlay } from './app/overlay.js';
import { saveTrackJSON, loadTrackJSON } from './app/storage.js';

const els = {
  canvas: document.getElementById('canvas'),
  modeBuild: document.getElementById('mode-build'),
  modePlay: document.getElementById('mode-play'),
  hudSpeed: document.getElementById('hud-speed'),
  hudScore: document.getElementById('hud-score'),
  hudPieces: document.getElementById('hud-pieces'),
  drop: document.getElementById('drop-height'),
  dropVal: document.getElementById('drop-height-val'),
  palette: document.getElementById('palette'),
  status: document.getElementById('status'),
  btnUndo: document.getElementById('btn-undo'),
  btnClear: document.getElementById('btn-clear'),
  btnSave: document.getElementById('btn-save'),
  btnLoad: document.getElementById('btn-load'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayBody: document.getElementById('overlay-body'),
  overlayScore: document.getElementById('overlay-score'),
  overlayTop: document.getElementById('overlay-top'),
  overlayLength: document.getElementById('overlay-length'),
  overlayClose: document.getElementById('overlay-close'),
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

let mode = 'build';        // 'build' | 'play'
let sim = null;
let runResult = null;
let lastFrameTime = performance.now();

// ---------- Boot ----------

const saved = loadTrackJSON();
if (saved) {
  track.fromJSON(saved);
} else {
  // Demo seed so the canvas isn't empty on first load.
  ['STRAIGHT', 'STRAIGHT', 'CURVE_R', 'STRAIGHT', 'BOOSTER',
   'STRAIGHT', 'LOOP', 'STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
}
syncDropUi();
renderer.rebuildTrack(track);
editor.refresh();
refreshHud();

// ---------- Event wiring ----------

els.drop.addEventListener('input', () => {
  track.dropHeight = Number(els.drop.value);
  els.dropVal.textContent = track.dropHeight;
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
  const tag = e.target?.tagName;
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

function switchMode(next) {
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
    sim = new Simulator(track);
    runResult = null;
    renderer.setCar(true, sim.carSample());
  } else {
    mode = 'build';
    document.body.classList.remove('mode-play');
    els.modePlay.classList.remove('active');
    els.modeBuild.classList.add('active');
    editor.setEnabled(true);
    renderer.setCar(false);
    sim = null;
  }
  refreshHud();
}

function refreshHud() {
  if (mode === 'play') hud.updateForPlay(track, sim, runResult);
  else hud.updateForBuild(track);
}

function syncDropUi() {
  els.drop.value = track.dropHeight;
  els.dropVal.textContent = track.dropHeight;
}

// ---------- Run loop ----------

function frame(now) {
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
      runResult = { score: computeScore(track, sim), sim };
      els.hudScore.textContent = runResult.score.total;
      setTimeout(() => {
        if (mode === 'play') overlay.show(track, runResult.score, sim);
      }, 700);
    }
  }

  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
