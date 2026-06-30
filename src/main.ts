// main.ts -- App entry. Wires the renderer, editor, simulator, HUD, overlay,
// storage, and the run loop together. Most logic lives in dedicated modules.

import { Track } from './track.js';
import { Renderer } from './renderer/index.js';
import { Editor } from './editor.js';
import { Simulator } from './physics.js';
import { computeScore } from './scoring.js';
import { SPEED_SCALE } from './constants.js';
import { Hud } from './app/hud.js';
import { ResultOverlay } from './app/overlay.js';
import { saveTrackJSON, loadTrackJSON, saveVehicleId, loadVehicleId } from './app/storage.js';
import {
  environmentVisible,
  cycleOverride,
  loadEnvOverride,
  saveEnvOverride,
  type EnvOverride,
} from './app/environment.js';
import {
  VEHICLES, VEHICLE_ORDER, DEFAULT_VEHICLE_ID, isVehicleId, type VehicleId,
} from './vehicles.js';
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
  envToggle: el('env-toggle'),
  hudSpeed: el('hud-speed'),
  hudScore: el('hud-score'),
  hudPieces: el('hud-pieces'),
  drop: el<HTMLInputElement>('drop-height'),
  dropVal: el('drop-height-val'),
  palette: el('palette'),
  garage: el('garage'),
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
  selBar: el('selbar'),
  selName: el('sel-name'),
  selDelete: el('sel-delete'),
  selDeselect: el('sel-deselect'),
  selRejoin: el('sel-rejoin'),
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
  onChange: () => { refreshHud(); updateRejoinButton(); updateInsertModeUI(); },
  onSelectionChange: (sel) => updateSelectionBar(sel),
});

/** Show/hide the floating selection toolbar over the stage. */
function updateSelectionBar(sel: { index: number; name: string } | null): void {
  if (!sel) {
    // Hide the selection-specific parts but keep bar visible if rejoin is needed.
    els.selName.textContent = '';
    els.selDelete.classList.add('hidden');
    els.selDeselect.classList.add('hidden');
    (els.selBar.querySelector('.selbar-label') as HTMLElement)?.classList.add('hidden');
    (els.selBar.querySelector('.selbar-hint') as HTMLElement)?.classList.add('hidden');
    els.selBar.classList.add('hidden');
    updateRejoinButton();
    return;
  }
  els.selName.textContent = sel.name;
  // Show selection-specific controls.
  (els.selBar.querySelector('.selbar-label') as HTMLElement)?.classList.remove('hidden');
  (els.selBar.querySelector('.selbar-hint') as HTMLElement)?.classList.remove('hidden');
  els.selDeselect.classList.remove('hidden');
  els.selDelete.classList.remove('hidden');
  els.selBar.classList.remove('hidden');
  updateRejoinButton();
}

/** Show the Rejoin button when the track is in editing mode. */
function updateRejoinButton(): void {
  if (track.isEditing()) {
    els.selRejoin.classList.remove('hidden');
    // Ensure the bar is visible so the user can access the rejoin button.
    els.selBar.classList.remove('hidden');
  } else {
    els.selRejoin.classList.add('hidden');
  }
}

/** Show insert-mode indicator when the user is building out a new section. */
function updateInsertModeUI(): void {
  if (editor.insertCursor !== null && editor.selectedIndex === null) {
    // In insert mode: show the bar with a building hint.
    els.selBar.classList.remove('hidden');
    (els.selBar.querySelector('.selbar-label') as HTMLElement)?.classList.remove('hidden');
    (els.selBar.querySelector('.selbar-hint') as HTMLElement)?.classList.remove('hidden');
    els.selName.textContent = 'Building section';
    const hintEl = els.selBar.querySelector('.selbar-hint') as HTMLElement;
    if (hintEl) hintEl.textContent = 'click pieces to extend, Esc to stop';
    els.selDelete.classList.add('hidden');
    els.selDeselect.classList.remove('hidden');
  } else if (editor.selectedIndex === null) {
    // Reset hint text for next time.
    const hintEl = els.selBar.querySelector('.selbar-hint') as HTMLElement;
    if (hintEl) hintEl.textContent = 'pick a palette piece to swap';
  }
}

let mode: Mode = 'build';
let envOverride: EnvOverride = loadEnvOverride();
let selectedVehicleId: VehicleId = DEFAULT_VEHICLE_ID;
let sim: Simulator | null = null;
let runResult: RunResult | null = null;
let wipeoutPlaying = false;
// Water-splash decorations already triggered this run (so each splashes once
// as the car drives through it).
let splashedPieces = new Set<number>();
let lastFrameTime = performance.now();
let mouseDownPos: { x: number; y: number } | null = null;

// ---------- Boot ----------

const saved = loadTrackJSON();
if (saved) {
  track.fromJSON(saved);
} else {
  // Demo seed so the canvas isn't empty on first load -- showcases the stunts.
  ['STRAIGHT', 'CORKSCREW', 'STRAIGHT', 'JUMP', 'STRAIGHT', 'BOOSTER',
    'STRAIGHT', 'LOOP', 'STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
}
syncDropUi();
renderer.rebuildTrack(track);
editor.refresh();
refreshHud();
applyEnvironment();
buildGarage();

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
els.envToggle.addEventListener('click', () => {
  envOverride = cycleOverride(envOverride);
  saveEnvOverride(envOverride);
  applyEnvironment();
});
els.overlayClose.addEventListener('click', () => {
  overlay.hide();
  switchMode('build');
});

// Selection toolbar
els.selDelete.addEventListener('click', () => editor.deleteSelected());
els.selDeselect.addEventListener('click', () => editor.deselectPiece());
els.selRejoin.addEventListener('click', () => {
  const ok = track.rejoin();
  if (!ok) {
    // Mismatch (Req 7.6): the rebuilt live region doesn't connect to the frozen
    // suffix. Stay in editing mode so the user can keep building or undo, and
    // keep the rejoin button visible.
    hud.flashStatus("Cannot rejoin: track doesn't connect. Keep building or undo.", 'err');
    updateRejoinButton();
    return;
  }
  renderer.rebuildTrack(track);
  editor.deselectPiece();
  hud.flashStatus('Track rejoined!', 'ok');
  refreshHud();
  updateRejoinButton();
});

// Canvas click detection: distinguish click from drag
els.canvas.addEventListener('mousedown', (e) => {
  mouseDownPos = { x: e.clientX, y: e.clientY };
});
els.canvas.addEventListener('mouseup', (e) => {
  if (!mouseDownPos) return;
  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  mouseDownPos = null;
  if (dist >= 5) return; // was a drag, not a click
  if (mode !== 'build') return;
  const index = renderer.pickPiece(e);
  if (index !== null) {
    editor.selectPiece(index);
  } else {
    editor.deselectPiece();
  }
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
  if (e.key === 'Escape' && mode === 'build') {
    editor.deselectPiece();
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'build') {
    if (editor.selectedIndex !== null) {
      e.preventDefault();
      editor.deleteSelected();
    }
  }
});

// ---------- Mode handling ----------

function switchMode(next: Mode): void {
  if (next === mode) return;
  if (next === 'play') {
    if (!track.isComplete()) {
      let msg: string;
      if (track.isEditing()) {
        msg = 'Rejoin the track before playing!';
      } else {
        msg = 'Complete the track with a Finish piece to play!';
      }
      hud.flashStatus(msg, 'err');
      return;
    }
    mode = 'play';
    editor.deselectPiece();
    document.body.classList.add('mode-play');
    els.modeBuild.classList.remove('active');
    els.modePlay.classList.add('active');
    editor.setEnabled(false);
    els.drop.disabled = true; // drop height is a build-time setting
    sim = new Simulator(track, VEHICLES[selectedVehicleId].physics);
    runResult = null;
    wipeoutPlaying = false;
    splashedPieces = new Set<number>();
    renderer.setCar(true, sim.carSample());
    renderer.animateLauncher();
  } else {
    mode = 'build';
    document.body.classList.remove('mode-play');
    els.modePlay.classList.remove('active');
    els.modeBuild.classList.add('active');
    editor.setEnabled(true);
    els.drop.disabled = false;
    renderer.setCar(false);
    renderer.stopLauncher();
    renderer.cleanupWipeout();
    renderer.resetCameraToTrack(track);
    wipeoutPlaying = false;
    sim = null;
  }
  applyEnvironment();
  refreshHud();
}

function refreshHud(): void {
  if (mode === 'play') hud.updateForPlay(track, sim, runResult);
  else hud.updateForBuild(track);
  // Visually disable play button unless the track is complete.
  if (track.isComplete()) {
    els.modePlay.classList.remove('disabled');
  } else {
    els.modePlay.classList.add('disabled');
  }
}

function syncDropUi(): void {
  els.drop.value = String(track.dropHeight);
  els.dropVal.textContent = String(track.dropHeight);
}

/** Apply the current environment override for the active mode + refresh the toggle UI. */
function applyEnvironment(): void {
  const visible = environmentVisible(envOverride, mode);
  renderer.setEnvironmentVisible(visible);
  document.body.classList.toggle('env-room', visible);
  updateEnvButton(visible);
}

/** Update the toggle button's label and lit state. */
function updateEnvButton(visible: boolean): void {
  const labels: Record<EnvOverride, string> = {
    auto: '🛋 Room: Auto',
    on: '🛋 Room: On',
    off: '🛋 Room: Off',
  };
  els.envToggle.textContent = labels[envOverride];
  els.envToggle.classList.toggle('env-active', visible);
}

/**
 * Build the garage (vehicle picker). Restores the saved vehicle, renders one
 * button per catalogue vehicle, and shows the chosen one in the scene. Clicking
 * a button selects + persists that vehicle and swaps the live mesh immediately.
 */
function buildGarage(): void {
  const saved = loadVehicleId();
  if (saved && isVehicleId(saved)) selectedVehicleId = saved;

  els.garage.innerHTML = '';
  for (const id of VEHICLE_ORDER) {
    const v = VEHICLES[id];
    const btn = document.createElement('button');
    btn.className = 'veh-btn';
    btn.dataset.vehicleId = id;
    btn.title = v.blurb;
    btn.innerHTML = `
      <span class="icon">${v.icon}</span>
      <span class="label">${v.name}</span>
    `;
    btn.addEventListener('click', () => selectVehicle(id));
    els.garage.appendChild(btn);
  }
  highlightVehicle();
  renderer.setVehicle(selectedVehicleId);
}

/** Select a vehicle: persist it, swap the mesh, and update the button state. */
function selectVehicle(id: VehicleId): void {
  selectedVehicleId = id;
  saveVehicleId(id);
  renderer.setVehicle(id);
  highlightVehicle();
}

/** Mark the active vehicle's button as selected. */
function highlightVehicle(): void {
  for (const btn of Array.from(els.garage.children) as HTMLElement[]) {
    btn.classList.toggle('selected', btn.dataset.vehicleId === selectedVehicleId);
  }
}

// ---------- Run loop ----------

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (mode === 'play' && sim) {
    // Drain any walls the car smashed through this frame and shatter them.
    if (sim.smashedWalls.length) {
      for (const idx of sim.smashedWalls) renderer.smashWall(idx);
      sim.smashedWalls.length = 0;
    }
    // Drain any crumbling bridges the car crossed and collapse them behind it.
    if (sim.crossedBridges.length) {
      for (const idx of sim.crossedBridges) renderer.crumbleBridge(idx);
      sim.crossedBridges.length = 0;
    }
    if (sim.isRunning()) {
      const subSteps = 4;
      const sdt = (dt * SPEED_SCALE) / subSteps;
      for (let i = 0; i < subSteps && sim.isRunning(); i++) sim.step(sdt);
      // Splash through any water decoration on the piece the car is crossing.
      if (track.decorationAt(sim.pieceIndex) === 'WATER_SPLASH' && !splashedPieces.has(sim.pieceIndex)) {
        splashedPieces.add(sim.pieceIndex);
        renderer.splashThrough(sim.pieceIndex);
      }
      const sample = sim.carSample();
      if (sample) {
        renderer.setCar(true, sample);
        renderer.followCar(sample.pos, dt);
      }
      els.hudSpeed.textContent = sim.speed.toFixed(1);
    } else if (wipeoutPlaying) {
      const still = renderer.updateWipeoutAnimation(dt * SPEED_SCALE);
      if (!still) {
        wipeoutPlaying = false;
        if (!runResult) {
          const s = sim;
          const result: RunResult = { score: computeScore(track, s), sim: s };
          runResult = result;
          els.hudScore.textContent = String(result.score.total);
          setTimeout(() => {
            if (mode === 'play') overlay.show(track, result.score, s);
          }, 200);
        }
      }
    } else if (!runResult) {
      const s = sim;
      if (s.failed) {
        // A collapsing bridge gives way visibly as the car drops.
        if (s.failType === 'collapse' && s.failPieceIndex >= 0) renderer.crumbleBridge(s.failPieceIndex);
        renderer.startWipeoutAnimation(s.failType, s.carSample());
        wipeoutPlaying = true;
      } else {
        const result: RunResult = { score: computeScore(track, s), sim: s };
        runResult = result;
        els.hudScore.textContent = String(result.score.total);
        setTimeout(() => {
          if (mode === 'play') overlay.show(track, result.score, s);
        }, 700);
      }
    }
  }

  renderer.updateAnimations(dt);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
