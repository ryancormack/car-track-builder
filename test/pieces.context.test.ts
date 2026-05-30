// Tests for resolvePiece — context-aware ramp grades (the "no staircase" fix).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePiece } from '../src/pieces/context.js';
import type { Piece, PieceId } from '../src/types.js';

const lz = (p: Piece, t: number): number => p.pathLocal(t).lz;
const grade = (p: Piece, t: number): number => {
  const d = 1e-4;
  const a = Math.max(t - d, 0);
  const b = Math.min(t + d, 1);
  return (lz(p, b) - lz(p, a)) / (b - a);
};

test('non-ramp pieces are returned from the catalogue unchanged', () => {
  const pieces = ['STRAIGHT', 'LOOP', 'FINISH'] as PieceId[];
  assert.equal(resolvePiece(pieces, 1).id, 'LOOP');
  assert.equal(resolvePiece(pieces, 0).id, 'STRAIGHT');
});

test('an isolated ramp eases at both ends and still nets +1', () => {
  const p = resolvePiece(['STRAIGHT', 'RAMP_UP', 'STRAIGHT'] as PieceId[], 1);
  assert.ok(Math.abs(grade(p, 0)) < 0.05, 'eases in (flat at entry)');
  assert.ok(Math.abs(grade(p, 1)) < 0.05, 'eases out (flat at exit)');
  assert.ok(Math.abs(lz(p, 1) - 1) < 1e-9, 'net rise 1');
});

test('a run of ramps is one continuous constant-grade incline (no staircase)', () => {
  const pieces = ['STRAIGHT', 'RAMP_UP', 'RAMP_UP', 'RAMP_UP', 'STRAIGHT'] as PieceId[];
  const first = resolvePiece(pieces, 1);
  const middle = resolvePiece(pieces, 2);
  const last = resolvePiece(pieces, 3);

  // The interior ramp has a constant grade (linear) — no flattening at seams.
  for (let t = 0; t <= 1; t += 0.1) assert.ok(Math.abs(lz(middle, t) - t) < 1e-9, 'interior ramp linear');

  // Grade is continuous across the whole run: ease on, full grade through the
  // body, ease off. (Without this fix, every interior seam dropped back to 0.)
  assert.ok(Math.abs(grade(first, 0)) < 0.05, 'eases onto the run from flat track');
  assert.ok(Math.abs(grade(first, 1) - 1) < 1e-3, 'first → middle grade matches (≈1)');
  assert.ok(Math.abs(grade(middle, 0) - 1) < 1e-3, 'middle holds full grade at entry');
  assert.ok(Math.abs(grade(middle, 1) - 1) < 1e-3, 'middle holds full grade at exit');
  assert.ok(Math.abs(grade(last, 1)) < 0.05, 'eases off the run onto flat track');
});

test('a descending run holds a constant downward grade', () => {
  const pieces = ['RAMP_DN', 'RAMP_DN'] as PieceId[];
  const first = resolvePiece(pieces, 0);
  const second = resolvePiece(pieces, 1);
  assert.ok(Math.abs(grade(first, 0)) < 0.05, 'eases in');
  assert.ok(Math.abs(grade(first, 1) - (-1)) < 1e-3, 'descends into the next ramp');
  assert.ok(Math.abs(grade(second, 0) - (-1)) < 1e-3, 'continues descending');
  assert.ok(Math.abs(grade(second, 1)) < 0.05, 'eases out');
});

test('opposite ramps (a crest) round off: both ease to flat at the shared seam', () => {
  const pieces = ['RAMP_UP', 'RAMP_DN'] as PieceId[];
  const up = resolvePiece(pieces, 0);
  const down = resolvePiece(pieces, 1);
  assert.ok(Math.abs(grade(up, 1)) < 0.05, 'up-ramp levels off at the crest');
  assert.ok(Math.abs(grade(down, 0)) < 0.05, 'down-ramp starts level at the crest');
});
