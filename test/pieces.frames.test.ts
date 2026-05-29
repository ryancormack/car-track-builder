// Tests for the pure track-frame logic (centreline frame the car + rails share).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trackFrames, trackFrameAt } from '../src/pieces/frames.js';
import type { Vec3 } from '../src/pieces/frames.js';
import { PIECES } from '../src/pieces/definitions.js';
import type { GridState, PieceId } from '../src/types.js';

const ENTRY: GridState = { gx: 0, gy: 0, gz: 0, dir: 1 }; // facing +x (East)
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const frameAt = (id: PieceId, t: number) => trackFrameAt(PIECES[id], ENTRY, t);

test('every piece yields a finite, orthonormal frame at all samples', () => {
  for (const id of Object.keys(PIECES) as PieceId[]) {
    for (const f of trackFrames(PIECES[id], ENTRY, 48)) {
      for (const v of [f.tangent, f.up, f.side]) {
        assert.ok(Number.isFinite(v.x + v.y + v.z), `${id}: non-finite vector`);
        assert.ok(Math.abs(len(v) - 1) < 1e-6, `${id}: not unit length`);
      }
      assert.ok(Math.abs(dot(f.tangent, f.up)) < 1e-6, `${id}: up not ⊥ tangent`);
      assert.ok(Math.abs(dot(f.tangent, f.side)) < 1e-6, `${id}: side not ⊥ tangent`);
      assert.ok(Math.abs(dot(f.up, f.side)) < 1e-6, `${id}: up not ⊥ side`);
    }
  }
});

test('straight stays level and ramps pitch with the grade without ever inverting', () => {
  for (const t of [0, 0.5, 1]) assert.ok(frameAt('STRAIGHT', t).up.z > 0.999, 'straight upright');

  // A ramp's car pitches with the (now eased) grade, but must never roll or
  // invert — up stays in the upper hemisphere — and is level at the flat seams.
  for (const id of ['RAMP_UP', 'RAMP_DN'] as PieceId[]) {
    assert.ok(frameAt(id, 0).up.z > 0.99, `${id} level at entry`);
    assert.ok(frameAt(id, 1).up.z > 0.99, `${id} level at exit`);
    for (let t = 0; t <= 1; t += 0.1) {
      assert.ok(frameAt(id, t).up.z > 0, `${id} should never invert (t=${t})`);
    }
  }
});

test('loop inverts the car over the apex but is upright at the ends', () => {
  assert.ok(frameAt('LOOP', 0).up.z > 0.5, 'upright entering loop');
  assert.ok(frameAt('LOOP', 1).up.z > 0.5, 'upright leaving loop');
  assert.ok(frameAt('LOOP', 0.5).up.z < -0.5, `inverted at apex (up.z=${frameAt('LOOP', 0.5).up.z})`);
});

test('corkscrew rolls a full turn: upright at both ends, fully inverted mid-way', () => {
  assert.ok(frameAt('CORKSCREW', 0).up.z > 0.99, 'upright at entry');
  assert.ok(frameAt('CORKSCREW', 1).up.z > 0.99, 'upright at exit');
  let minUpZ = 1;
  for (const f of trackFrames(PIECES.CORKSCREW, ENTRY, 120)) minUpZ = Math.min(minUpZ, f.up.z);
  assert.ok(minUpZ < -0.9, `passes through inverted (minUpZ=${minUpZ})`);
});

test('loop and corkscrew frames are continuous (no orientation flips)', () => {
  for (const id of ['LOOP', 'CORKSCREW'] as PieceId[]) {
    const frames = trackFrames(PIECES[id], ENTRY, 240);
    for (let i = 1; i < frames.length; i++) {
      assert.ok(dot(frames[i].up, frames[i - 1].up) > 0.9, `${id}: up jumped at i=${i}`);
      assert.ok(dot(frames[i].side, frames[i - 1].side) > 0.9, `${id}: side jumped at i=${i}`);
    }
  }
});

test('frame up stays a fixed offset normal: car rides above the centreline', () => {
  // The car position = pos + up * height; up must point away from the surface
  // (non-zero, unit) everywhere so the car never sinks into the track.
  for (const id of Object.keys(PIECES) as PieceId[]) {
    for (const f of trackFrames(PIECES[id], ENTRY, 32)) {
      assert.ok(Math.abs(len(f.up) - 1) < 1e-6, `${id}: up not unit`);
    }
  }
});
