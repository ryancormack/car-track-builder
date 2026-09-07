// Tests for car-on-car rear-end collisions: the pure detector (which pairs of
// cars have run into each other) and the external crash path it drives.
//
// Every car runs the same one-dimensional path, so the detector works purely on
// travelled distance + speed — there is no geometry here to get wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Simulator, findRearEnds, type RunningCar, type RearEnd } from '../src/physics.js';
import { VEHICLES, type VehiclePhysics } from '../src/vehicles.js';
import { REAR_END_GAP } from '../src/constants.js';

function car(id: number, distanceTraveled: number, speed: number): RunningCar {
  return { id, distanceTraveled, speed };
}

test('a car closing on the one in front rear-ends it', () => {
  const hits = findRearEnds([
    car(1, 10, 3),                          // leader, slower
    car(2, 10 - REAR_END_GAP / 2, 6),       // right behind and gaining
  ]);
  assert.deepEqual(hits, [{ trailing: 2, lead: 1 }]);
});

test('a closed gap alone is not a crash — the trailing car must be faster', () => {
  // Same speed: the gap can never close (there is no propulsion), so two cars
  // running nose-to-tail at matched pace stay that way. This is what makes
  // launching a second car immediately behind the first survivable.
  assert.deepEqual(findRearEnds([car(1, 10, 5), car(2, 9.9, 5)]), []);
  // Trailing car slower still: the leader is pulling away.
  assert.deepEqual(findRearEnds([car(1, 10, 5), car(2, 9.9, 4)]), []);
});

test('two cars launched on the same frame do not instantly crash', () => {
  // Both at distance 0 with identical drop speed — the gap is zero, but neither
  // is closing on the other, so nothing happens.
  assert.deepEqual(findRearEnds([car(1, 0, 7), car(2, 0, 7)]), []);
});

test('a faster car far behind has not caught up yet', () => {
  assert.deepEqual(findRearEnds([car(1, 10, 2), car(2, 10 - REAR_END_GAP * 3, 9)]), []);
});

test('the gap threshold is exactly REAR_END_GAP', () => {
  const justInside = findRearEnds([car(1, 10, 1), car(2, 10 - REAR_END_GAP * 0.99, 9)]);
  assert.equal(justInside.length, 1, 'a gap under REAR_END_GAP is contact');
  const justOutside = findRearEnds([car(1, 10, 1), car(2, 10 - REAR_END_GAP, 9)]);
  assert.equal(justOutside.length, 0, 'a gap of exactly REAR_END_GAP is still clear');
});

test('the detector pairs each car with its immediate neighbour, in any input order', () => {
  // Deliberately unsorted input: 3 leads, then 1, then 2 at the back.
  const hits = findRearEnds([
    car(2, 10 - REAR_END_GAP * 1.5, 9),
    car(3, 10, 1),
    car(1, 10 - REAR_END_GAP * 0.75, 5),
  ]);
  // 1 shunts 3 (gap 0.75·GAP, faster); 2 shunts 1 (gap 0.75·GAP, faster).
  assert.deepEqual(hits, [{ trailing: 1, lead: 3 }, { trailing: 2, lead: 1 }]);
});

test('a single car cannot rear-end anything', () => {
  assert.deepEqual(findRearEnds([car(1, 5, 5)]), []);
  assert.deepEqual(findRearEnds([]), []);
});

test('crash() ends a running car with a rear_end failure', () => {
  const track = new Track();
  track.dropHeight = 3;
  track.addPiece('STRAIGHT');
  const sim = new Simulator(track);
  sim.step(1 / 240); // get it moving onto the piece

  assert.equal(sim.isRunning(), true);
  sim.crash('Rear-ended by Car 2 (Speedster)!', 'rear_end');

  assert.equal(sim.failed, true);
  assert.equal(sim.failType, 'rear_end');
  assert.equal(sim.failReason, 'Rear-ended by Car 2 (Speedster)!');
  assert.equal(sim.failPieceIndex, 0);
  assert.equal(sim.isRunning(), false);
});

test('crash() cannot overwrite why a car already went out', () => {
  const track = new Track();
  track.dropHeight = 3;
  track.addPiece('STRAIGHT');
  track.addPiece('FINISH');
  const sim = new Simulator(track);
  let steps = 0;
  while (sim.isRunning() && steps++ < 4000) sim.step(1 / 240);
  assert.equal(sim.finished, true);

  sim.crash('Slammed into the back of Car 1 (Classic)!', 'rear_end');
  assert.equal(sim.failed, false, 'a car that already finished is not retro-crashed');
  assert.equal(sim.failType, null);
});

/** Run two sims down one track as the run loop does, and report the first shunt. */
function raceUntilShunt(leadV: VehiclePhysics, chaseV: VehiclePhysics, headStartSteps = 120) {
  const track = new Track();
  track.dropHeight = 3;
  for (let i = 0; i < 30; i++) track.addPiece('STRAIGHT');

  const lead = new Simulator(track, leadV);
  const chaser = new Simulator(track, chaseV);
  const dt = 1 / 240;

  for (let i = 0; i < headStartSteps && lead.isRunning(); i++) lead.step(dt);
  const headStart = lead.distanceTraveled;

  let hit: RearEnd[] = [];
  for (let i = 0; i < 20000; i++) {
    if (lead.isRunning()) lead.step(dt);
    if (chaser.isRunning()) chaser.step(dt);
    if (!lead.isRunning() || !chaser.isRunning()) break; // a wreck leaves the track
    hit = findRearEnds([
      car(1, lead.distanceTraveled, lead.speed),
      car(2, chaser.distanceTraveled, chaser.speed),
    ]);
    if (hit.length) break;
  }
  return { hit, headStart };
}

test('a real Speedster reels in a real Monster and shunts it', () => {
  // The behaviour is only worth having if the actual catalogue profiles can
  // produce it — this pins that a rear-end is genuinely reachable from the
  // shipped vehicles, not just a theoretical branch.
  const { hit, headStart } = raceUntilShunt(VEHICLES.monster.physics, VEHICLES.speedster.physics);
  assert.ok(headStart > REAR_END_GAP, 'the chaser must start genuinely behind');
  assert.deepEqual(hit, [{ trailing: 2, lead: 1 }], 'the Speedster catches the Monster');
});

test('two identical cars never rear-end each other, however long the track', () => {
  // The other half of the contract: matched cars hold their gap forever (there
  // is no propulsion to close it), so launching a second car of the same type
  // right behind the first is never punished.
  const { hit } = raceUntilShunt(VEHICLES.classic.physics, VEHICLES.classic.physics);
  assert.deepEqual(hit, []);
});
