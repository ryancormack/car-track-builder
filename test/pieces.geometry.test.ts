// Tests for direction vectors, applyPiece, and localToWorld.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DIRS, rightOf, applyPiece, localToWorld } from '../src/pieces/geometry.js';
import { PIECES } from '../src/pieces/definitions.js';
import type { GridState } from '../src/types.js';

test('DIRS has four unit vectors covering compass directions', () => {
  assert.equal(DIRS.length, 4);
  assert.deepEqual(DIRS[0], { dx: 0, dy: -1 }); // N
  assert.deepEqual(DIRS[1], { dx: 1, dy: 0 });  // E
  assert.deepEqual(DIRS[2], { dx: 0, dy: 1 });  // S
  assert.deepEqual(DIRS[3], { dx: -1, dy: 0 }); // W
});

test('rightOf rotates 90° clockwise', () => {
  assert.deepEqual(rightOf(0), DIRS[1]); // N → E
  assert.deepEqual(rightOf(1), DIRS[2]); // E → S
  assert.deepEqual(rightOf(2), DIRS[3]); // S → W
  assert.deepEqual(rightOf(3), DIRS[0]); // W → N
});

test('applyPiece(STRAIGHT) advances 1 cell in entry direction, dir unchanged', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing East
  const next = applyPiece(start, PIECES.STRAIGHT);
  assert.deepEqual(next, { gx: 1, gy: 0, gz: 0, dir: 1 });
});

test('applyPiece(CURVE_R) from East exits facing South, lands one cell south', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // East
  const next = applyPiece(start, PIECES.CURVE_R);
  assert.equal(next.dir, 2, 'should now face South');
  assert.deepEqual({ gx: next.gx, gy: next.gy, gz: next.gz }, { gx: 0, gy: 1, gz: 0 });
});

test('applyPiece(CURVE_L) from East exits facing North, lands one cell north', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 };
  const next = applyPiece(start, PIECES.CURVE_L);
  assert.equal(next.dir, 0, 'should now face North');
  assert.deepEqual({ gx: next.gx, gy: next.gy, gz: next.gz }, { gx: 0, gy: -1, gz: 0 });
});

test('applyPiece(RAMP_UP) raises gz by 1 and keeps direction', () => {
  const start: GridState = { gx: 5, gy: 5, gz: 2, dir: 2 }; // South
  const next = applyPiece(start, PIECES.RAMP_UP);
  assert.equal(next.gz, 3);
  assert.equal(next.dir, 2);
  assert.deepEqual({ gx: next.gx, gy: next.gy }, { gx: 5, gy: 6 });
});

test('applyPiece(RAMP_DN) lowers gz by 1', () => {
  const start: GridState = { gx: 0, gy: 0, gz: 5, dir: 3 };
  const next = applyPiece(start, PIECES.RAMP_DN);
  assert.equal(next.gz, 4);
});

test('Four CURVE_R pieces from any direction return to the same direction', () => {
  let s: GridState = { gx: 0, gy: 0, gz: 0, dir: 0 };
  for (let i = 0; i < 4; i++) s = applyPiece(s, PIECES.CURVE_R);
  assert.equal(s.dir, 0);
});

test('localToWorld at entry midpoint matches grid cell minus half-forward', () => {
  // Facing East: entry midpoint is at (gx - 0.5, gy).
  const w = localToWorld({ gx: 3, gy: 7, gz: 0, dir: 1 }, 0, 0, 0);
  assert.equal(w.wx, 2.5);
  assert.equal(w.wy, 7);
  assert.equal(w.wz, 0);
});

test('localToWorld respects elevation offset', () => {
  const w = localToWorld({ gx: 0, gy: 0, gz: 4, dir: 0 }, 0.5, 0, 0.7);
  assert.equal(w.wz, 4.7);
});

test('localToWorld applies sideways offset along the right vector', () => {
  // Facing East → right = South (+y). ly=1 should add +1 to wy.
  const w = localToWorld({ gx: 0, gy: 0, gz: 0, dir: 1 }, 0.5, 1, 0);
  assert.equal(w.wx, 0);
  assert.equal(w.wy, 1);
});
