// main.ts -- App entry. Wires the renderer, editor, simulator, HUD, overlay,
// storage, and the run loop together. Most logic lives in dedicated modules.

import { Track } from './track.js';
import { Renderer } from './renderer/index.js';
import { Editor } from './editor.js';
import { Simulator } from './physics.js';
import { computeScore } from './scoring.js';
import { SURFACE_ORDER } from './pieces/index.js';
import { SPEED_SCALE, MIN_CARS, MAX_CARS, DEFAULT_CARS } from './constants.js';
import { Hud } from './app/hud.js';
import type { RaceHudStats } from './app/hud.js';
import { ResultOverlay } from './app/overlay.js';
import type { CarRunResult } from './app/overlay.js';
import {
  saveTrackJSON, loadTrackJSON, saveVehicleId, loadVehicleId, saveCarCount, loadCarCount,
} from './app/storage.js';
import { encodeTrackHash, decodeTrackHash } from './app/hash.js';
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
import type { UIElements } from './types.js';

type Mode = 'build' | 'play';

/**
 * One car actively on (or having finished) the track during the current play
 * session. `id` is a stable renderer key (see Renderer's per-car mesh map);
 * `label` is the user-facing "Car N" name in launch order.
 */
interface RaceCar {
  id: number;
  label: string;
  sim: Simulator;
  /** True once this car's wipeout animation has finished playing (or it never crashed). */
  wipeoutDone: boolean;
  /** True once this car's score has been computed (finished running + any wipeout settled). */
  done: boolean;
  score: ReturnType<typeof computeScore> | null;
  splashedPieces: Set<number>;
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
  carCount: el<HTMLInputElement>('car-count'),
  carCountVal: el('car-count-val'),
  btnLaunch: el('btn-launch'),
  hudCars: el('hud-cars'),
  palette: el('palette'),
  pieceSearch: el('piece-search'),
  surfaceStrip: el('surface-strip'),
  selSurfaces: el('sel-surfaces'),
  garage: el('garage'),
  status: el('status'),
  playStatus: document.getElementById('play-status'),
  btnUndo: el('btn-undo'),
  btnClear: el('btn-clear'),
  btnSave: el('btn-save'),
  btnLoad: el('btn-load'),
  btnShare: el('btn-share'),
  overlay: el('overlay'),
  overlayTitle: el('overlay-title'),
  overlayBody: el('overlay-body'),
  overlayScore: el('overlay-score'),
  overlayTop: el('overlay-top'),
  overlayLength: el('overlay-length'),
  overlayCarsList: el('overlay-cars-list'),
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
  searchEl: els.pieceSearch as HTMLInputElement | null,
  surfaceStripEl: els.surfaceStrip,
  selSurfaceEl: els.selSurfaces,
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
let carCount = DEFAULT_CARS; // configured number of cars for the race
let nextCarId = 0; // monotonically increasing renderer car id
let cars: RaceCar[] = []; // every car launched so far this play session
let followedCarId: number | null = null; // which car's sim the camera + HUD speed track
let raceResultsShown = false; // guards against showing the overlay twice
let lastFrameTime = performance.now();
let mouseDownPos: { x: number; y: number } | null = null;

// ---------- Boot ----------

let booted = false;
const rawHash = window.location.hash.slice(1);
if (rawHash.length > 0) {
  const decoded = decodeTrackHash(rawHash);
  if (decoded) {
    track.fromJSON(decoded);
    booted = true;
  }
}
if (!booted) {
  const saved = loadTrackJSON();
  if (saved) {
    track.fromJSON(saved);
  } else {
    // Demo seed so the canvas isn't empty on first load -- showcases the stunts.
    ['STRAIGHT', 'CORKSCREW', 'STRAIGHT', 'JUMP', 'STRAIGHT', 'BOOSTER',
      'STRAIGHT', 'LOOP', 'STRAIGHT', 'FINISH'].forEach((id) => track.addPiece(id));
  }
}
syncDropUi();
syncCarCountUi();
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

els.carCount.addEventListener('input', () => {
  carCount = clampCarCount(Number(els.carCount.value));
  els.carCountVal.textContent = String(carCount);
  saveCarCount(carCount);
  refreshHud();
  updateLaunchButton();
});

els.btnLaunch.addEventListener('click', () => launchCar());

els.btnUndo.addEventListener('click', () => editor.undo());
els.btnClear.addEventListener('click', () => {
  if (confirm('Clear the entire track?')) editor.clear();
});
els.btnSave.addEventListener('click', () => {
  saveTrackJSON(track.toJSON());
  window.location.hash = encodeTrackHash(track.toJSON());
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

els.btnShare.addEventListener('click', async () => {
  const hash = encodeTrackHash(track.toJSON());
  window.location.hash = hash;
  try {
    await navigator.clipboard.writeText(window.location.href);
    hud.flashStatus('Link copied to clipboard!', 'ok');
  } catch {
    hud.flashStatus('Link updated in address bar.', 'ok');
  }
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
    // Disarm a laid surface FIRST: the armed banner advertises Esc, and someone
    // stopping "laying ice" does not usually also mean to drop their selection.
    // A second Esc then deselects as before.
    if (!editor.disarmSurface()) editor.deselectPiece();
  }
  // Surface shortcuts: 1 = plain (disarm), then one key per catalogue surface
  // (2 = Ice, 3 = Gravel). Derived from SURFACE_ORDER so adding a surface does
  // not need a new key wired here. R, Space, Esc, Delete and Ctrl+Z are taken.
  if (mode === 'build' && e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const n = Number(e.key);
    if (n === 1) {
      e.preventDefault();
      editor.armSurface(null);
    } else if (n - 2 < SURFACE_ORDER.length) {
      e.preventDefault();
      editor.armSurface(SURFACE_ORDER[n - 2]);
    }
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
    els.carCount.disabled = true; // car count is a build-time setting too
    cars = [];
    followedCarId = null;
    raceResultsShown = false;
    launchCar(); // the Play button always sends the first car off
  } else {
    mode = 'build';
    document.body.classList.remove('mode-play');
    els.modePlay.classList.remove('active');
    els.modeBuild.classList.add('active');
    editor.setEnabled(true);
    els.drop.disabled = false;
    els.carCount.disabled = false;
    renderer.clearCars();
    renderer.stopLauncher();
    renderer.cleanupWipeout();
    renderer.resetCameraToTrack(track);
    cars = [];
    followedCarId = null;
  }
  applyEnvironment();
  refreshHud();
  updateLaunchButton();
}

/**
 * Launch one more car down the track: a new Simulator + car mesh, using the
 * currently selected vehicle. No-op once `carCount` cars have already been
 * launched, or outside play mode. The plunger animation replays on every
 * launch, including the very first one from the Play button.
 */
function launchCar(): void {
  if (mode !== 'play') return;
  if (cars.length >= carCount) return;
  const id = nextCarId++;
  const sim = new Simulator(track, VEHICLES[selectedVehicleId].physics);
  const car: RaceCar = {
    id,
    label: `Car ${cars.length + 1}`,
    sim,
    wipeoutDone: false,
    done: false,
    score: null,
    splashedPieces: new Set<number>(),
  };
  cars.push(car);
  followedCarId = id;
  renderer.setCar(id, true, sim.carSample());
  renderer.animateLauncher();
  refreshHud();
  updateLaunchButton();
}

/** Show/hide + enable/disable the "Launch Car" button for the current race state. */
function updateLaunchButton(): void {
  // With just one car configured, the Play button already sends it off and
  // there's nothing left to launch — keep the plunger button out of the way.
  if (mode !== 'play' || carCount <= 1) {
    els.btnLaunch.classList.add('hidden');
    return;
  }
  els.btnLaunch.classList.remove('hidden');
  const canLaunch = cars.length < carCount;
  (els.btnLaunch as HTMLButtonElement).disabled = !canLaunch;
  els.btnLaunch.textContent = canLaunch
    ? `🔴 Launch Car (${cars.length}/${carCount})`
    : `🏁 All ${carCount} cars launched`;
}

function refreshHud(): void {
  if (mode === 'play') {
    const followed = followedCarId !== null ? cars.find((c) => c.id === followedCarId) : undefined;
    const stats: RaceHudStats = {
      speed: followed && !followed.done ? followed.sim.speed : 0,
      scoreSoFar: cars.reduce((sum, c) => sum + (c.score?.total ?? 0), 0),
      carsDone: cars.filter((c) => c.done).length,
      carsLaunched: cars.length,
      carsTotal: carCount,
    };
    hud.updateForPlay(track, stats);
  } else {
    hud.updateForBuild(track);
  }
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

function clampCarCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CARS;
  return Math.max(MIN_CARS, Math.min(MAX_CARS, Math.round(n)));
}

function syncCarCountUi(): void {
  const saved = loadCarCount();
  if (saved !== null) carCount = clampCarCount(saved);
  els.carCount.value = String(carCount);
  els.carCountVal.textContent = String(carCount);
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

/**
 * Advance one car's simulation/animation by one frame. Returns true once this
 * car's run (including its wipeout animation, if any) has fully settled and
 * its score has been computed.
 */
function stepCar(car: RaceCar, dt: number): void {
  if (car.done) return;
  const { sim } = car;

  // Drain any walls this car smashed through this frame and shatter them.
  if (sim.smashedWalls.length) {
    for (const idx of sim.smashedWalls) renderer.smashWall(idx);
    sim.smashedWalls.length = 0;
  }
  // Drain any crumbling bridges this car crossed and collapse them behind it.
  if (sim.crossedBridges.length) {
    for (const idx of sim.crossedBridges) renderer.crumbleBridge(idx);
    sim.crossedBridges.length = 0;
  }

  if (sim.isRunning()) {
    const subSteps = 4;
    const sdt = (dt * SPEED_SCALE) / subSteps;
    for (let i = 0; i < subSteps && sim.isRunning(); i++) sim.step(sdt);
    // Splash through any water decoration on the piece this car is crossing.
    if (track.decorationAt(sim.pieceIndex) === 'WATER_SPLASH' && !car.splashedPieces.has(sim.pieceIndex)) {
      car.splashedPieces.add(sim.pieceIndex);
      renderer.splashThrough(sim.pieceIndex);
    }
    const sample = sim.carSample();
    if (sample) {
      renderer.setCar(car.id, true, sample);
      if (car.id === followedCarId) renderer.followCar(sample.pos, dt);
    }
    return;
  }

  if (renderer.isWipeoutPlaying(car.id)) {
    const still = renderer.updateWipeoutAnimation(car.id, dt * SPEED_SCALE);
    if (!still) {
      car.wipeoutDone = true;
      finishCar(car);
    }
    return;
  }

  if (sim.failed && !car.wipeoutDone) {
    // Tell the player WHY the run ended, at the moment it ends. The sim already
    // computes a per-failure reason (too fast for the corner, too slow to smash
    // the wall, bridge collapsed, …); without this the car just flies off with
    // no explanation and the reason only surfaces on the end-of-race card much
    // later. Only announce the followed car so a multi-car pile-up doesn't spam
    // the status line.
    if (car.id === followedCarId) hud.flashStatus(sim.failReason ?? 'The car crashed!', 'err');
    // A collapsing bridge gives way visibly as the car drops.
    if (sim.failType === 'collapse' && sim.failPieceIndex >= 0) renderer.crumbleBridge(sim.failPieceIndex);
    renderer.startWipeoutAnimation(car.id, sim.failType, sim.carSample());
    return;
  }

  if (!sim.failed) {
    finishCar(car);
  }
}

/** Compute a finished car's score and check whether the whole race is over. */
function finishCar(car: RaceCar): void {
  if (car.done) return;
  car.score = computeScore(track, car.sim);
  car.done = true;
  // Hand the camera off to another car still racing, if this was the one being
  // followed (so the view keeps tracking live action instead of freezing).
  if (car.id === followedCarId) {
    const stillRunning = cars.find((c) => !c.done);
    followedCarId = stillRunning ? stillRunning.id : null;
  }
  refreshHud();
  updateLaunchButton();
  maybeShowResults();
}

/**
 * The race ends once every car that WILL be launched has crossed the finish
 * line (or crashed out): all `carCount` cars have been launched, and every
 * launched car has finished its run + settled its wipeout animation.
 */
function maybeShowResults(): void {
  if (raceResultsShown) return;
  if (cars.length < carCount) return;
  if (!cars.every((c) => c.done)) return;
  raceResultsShown = true;
  const results: CarRunResult[] = cars.map((c) => ({
    label: c.label,
    score: c.score!,
    sim: c.sim,
  }));
  const delay = cars.some((c) => c.sim.failed) ? 200 : 700;
  setTimeout(() => {
    if (mode === 'play') overlay.show(track, results);
  }, delay);
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (mode === 'play') {
    for (const car of cars) stepCar(car, dt);
    refreshHud(); // keep the live speed readout current every frame
  }

  renderer.updateAnimations(dt);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
