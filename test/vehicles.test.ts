// Tests for the vehicle system: the catalogue is well-formed, the default
// 'classic' profile is exactly the baseline (so existing behaviour is
// unchanged), and the distinct handling profiles produce the intended,
// observable differences (corner grip and speed retention).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Simulator } from '../src/physics.js';
import {
  VEHICLES, VEHICLE_ORDER, DEFAULT_VEHICLE_ID, BASELINE_PHYSICS, isVehicleId,
} from '../src/vehicles.js';

function trackOf(ids: string[], dropHeight = 3): Track {
  const t = new Track();
  t.dropHeight = dropHeight;
  for (const id of ids) t.addPiece(id);
  return t;
}

function runToCompletion(sim: Simulator, maxSteps = 4000): void {
  let steps = 0;
  while (sim.isRunning() && steps++ < maxSteps) sim.step(1 / 240);
}

test('catalogue is well-formed: order covers every vehicle exactly once', () => {
  const keys = Object.keys(VEHICLES).sort();
  const ordered = [...VEHICLE_ORDER].sort();
  assert.deepEqual(ordered, keys, 'VEHICLE_ORDER must list every vehicle once');
  assert.equal(new Set(VEHICLE_ORDER).size, VEHICLE_ORDER.length, 'no duplicates');
  assert.ok(isVehicleId(DEFAULT_VEHICLE_ID));
  assert.ok(VEHICLES[DEFAULT_VEHICLE_ID], 'default id resolves to a vehicle');
});

test('every vehicle has sane fields and positive physics multipliers', () => {
  for (const id of VEHICLE_ORDER) {
    const v = VEHICLES[id];
    assert.equal(v.id, id, 'id matches its key');
    assert.ok(v.name.length > 0, `${id} has a name`);
    assert.ok(v.icon.length > 0, `${id} has an icon`);
    assert.ok(v.blurb.length > 0, `${id} has a blurb`);
    assert.ok(v.kind === 'car' || v.kind === 'bike', `${id} has a valid kind`);
    for (const k of ['drag', 'friction', 'corner'] as const) {
      assert.ok(v.physics[k] > 0, `${id}.physics.${k} > 0`);
    }
    assert.ok(v.visual.wheelScale > 0 && v.visual.scale > 0, `${id} has positive scales`);
  }
});

test('isVehicleId narrows correctly', () => {
  assert.equal(isVehicleId('classic'), true);
  assert.equal(isVehicleId('bike'), true);
  assert.equal(isVehicleId('rocketship'), false);
  assert.equal(isVehicleId(''), false);
});

test("'classic' profile is exactly the baseline", () => {
  assert.deepEqual(VEHICLES.classic.physics, BASELINE_PHYSICS);
});

test('a classic-vehicle Simulator matches a default (no-vehicle) Simulator step-for-step', () => {
  const ids = ['STRAIGHT', 'RAMP_UP', 'STRAIGHT', 'CURVE_R', 'STRAIGHT', 'FINISH'];
  const a = new Simulator(trackOf(ids, 5));                          // default arg
  const b = new Simulator(trackOf(ids, 5), VEHICLES.classic.physics); // explicit classic
  for (let i = 0; i < 4000 && (a.isRunning() || b.isRunning()); i++) {
    a.step(1 / 240);
    b.step(1 / 240);
  }
  assert.equal(a.v2, b.v2, 'final v² identical');
  assert.equal(a.distanceTraveled, b.distanceTraveled, 'distance identical');
  assert.equal(a.finished, b.finished);
  assert.equal(a.failed, b.failed);
});

test('Speedster flies off a fast corner that the Classic takes cleanly', () => {
  // Drop 6 → entry v² = 2·g·6 = 117.6, just under the corner gate of 120 for a
  // baseline car but well over the Speedster's lower grip (120·0.7 = 84).
  const classic = new Simulator(trackOf(['CURVE_R', 'FINISH'], 6), VEHICLES.classic.physics);
  runToCompletion(classic);
  assert.equal(classic.failed, false, 'classic survives the corner');
  assert.equal(classic.finished, true);

  const speedster = new Simulator(trackOf(['CURVE_R', 'FINISH'], 6), VEHICLES.speedster.physics);
  runToCompletion(speedster);
  assert.equal(speedster.failed, true, 'speedster flies off');
  assert.equal(speedster.failType, 'overspeed_corner');
});

test('Motorbike survives a boosted corner that throws the Classic off', () => {
  // Booster (+90) on top of a drop-6 entry pushes corner-entry v² to ~206,
  // over the baseline gate (120) but under the bike's high grip (120·1.9 = 228).
  const ids = ['BOOSTER', 'CURVE_R', 'FINISH'];
  const classic = new Simulator(trackOf(ids, 6), VEHICLES.classic.physics);
  runToCompletion(classic);
  assert.equal(classic.failed, true, 'classic flies off the boosted corner');
  assert.equal(classic.failType, 'overspeed_corner');

  const bike = new Simulator(trackOf(ids, 6), VEHICLES.bike.physics);
  runToCompletion(bike);
  assert.equal(bike.failed, false, 'bike grips the boosted corner');
  assert.equal(bike.finished, true);
});

test('a low-drag, low-friction vehicle retains more speed over a long straight', () => {
  const ids = ['STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH'];
  const classic = new Simulator(trackOf(ids, 5), VEHICLES.classic.physics);
  const muscle = new Simulator(trackOf(ids, 5), VEHICLES.muscle.physics);
  runToCompletion(classic);
  runToCompletion(muscle);
  assert.ok(
    muscle.v2 > classic.v2,
    `muscle (${muscle.v2.toFixed(2)}) should keep more energy than classic (${classic.v2.toFixed(2)})`,
  );
});
