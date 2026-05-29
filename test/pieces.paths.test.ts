// Tests for parametric path samplers — endpoints, ranges, continuity.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pathStraight, pathCurveR, pathCurveL,
  pathRampUp, pathRampDown,
  pathLoop, pathCorkscrew, pathJump,
  easedProgress,
} from '../src/pieces/paths.js';

const samplers = [pathStraight, pathCurveR, pathCurveL, pathRampUp, pathRampDown,
                  pathLoop, pathCorkscrew, pathJump];

test('every path sampler returns finite numeric coordinates across [0,1]', () => {
  for (const fn of samplers) {
    for (let t = 0; t <= 1; t += 0.05) {
      const p = fn(t);
      for (const k of ['lx', 'ly', 'lz'] as const) {
        assert.ok(Number.isFinite(p[k]), `${fn.name} sample at t=${t.toFixed(2)}: ${k}=${p[k]}`);
      }
    }
  }
});

test('pathStraight runs from (0,0,0) at t=0 to (1,0,0) at t=1', () => {
  assert.deepEqual(pathStraight(0), { lx: 0, ly: 0, lz: 0, banking: 0 });
  assert.deepEqual(pathStraight(1), { lx: 1, ly: 0, lz: 0, banking: 0 });
});

test('pathRampUp gains exactly 1 unit of altitude over the piece', () => {
  assert.equal(pathRampUp(1).lz - pathRampUp(0).lz, 1);
});

test('pathRampDown loses exactly 1 unit of altitude', () => {
  assert.equal(pathRampDown(1).lz - pathRampDown(0).lz, -1);
});

test('pathCurveR exits at (0.5, 0.5, 0)', () => {
  const p = pathCurveR(1);
  assert.ok(Math.abs(p.lx - 0.5) < 1e-9);
  assert.ok(Math.abs(p.ly - 0.5) < 1e-9);
});

test('pathCurveL exits at (0.5, -0.5, 0) — opposite side from CURVE_R', () => {
  const p = pathCurveL(1);
  assert.ok(Math.abs(p.lx - 0.5) < 1e-9);
  assert.ok(Math.abs(p.ly + 0.5) < 1e-9);
});

test('pathLoop starts at (0,0,0), ends at (1,0,0), and reaches a peak at the top', () => {
  const a = pathLoop(0);
  const b = pathLoop(1);
  assert.deepEqual({ lx: a.lx, lz: a.lz }, { lx: 0, lz: 0 });
  assert.ok(Math.abs(b.lx - 1) < 1e-9);
  assert.ok(Math.abs(b.lz) < 1e-9);

  // Peak height across the path should be ~1 (loop diameter = 2R = 1).
  let peak = 0;
  for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, pathLoop(t).lz);
  assert.ok(peak > 0.99 && peak < 1.01, `loop peak should be ~1, got ${peak}`);
});

test('pathLoop is continuous at both segment seams', () => {
  const epsilon = 1e-6;
  const beforeApproach = pathLoop(0.1 - epsilon);
  const afterApproach = pathLoop(0.1 + epsilon);
  assert.ok(Math.abs(beforeApproach.lx - afterApproach.lx) < 1e-3);
  assert.ok(Math.abs(beforeApproach.lz - afterApproach.lz) < 1e-3);

  const beforeDepart = pathLoop(0.9 - epsilon);
  const afterDepart = pathLoop(0.9 + epsilon);
  assert.ok(Math.abs(beforeDepart.lx - afterDepart.lx) < 1e-3);
  assert.ok(Math.abs(beforeDepart.lz - afterDepart.lz) < 1e-3);
});

test('pathCorkscrew spans three cells, connects flat, and inverts at the apex', () => {
  // lx must increase monotonically from 0 to 3 (three cells).
  let prev = -Infinity;
  for (let t = 0; t <= 1; t += 0.05) {
    const p = pathCorkscrew(t);
    assert.ok(p.lx >= prev - 1e-9, `corkscrew lx not monotonic at t=${t}`);
    prev = p.lx;
  }
  assert.ok(Math.abs(pathCorkscrew(1).lx - 3) < 1e-9, 'spans 3 cells');

  // Connects flat and level at both seams: ly = lz = 0, banking 0 / 2π.
  const start = pathCorkscrew(0);
  const end = pathCorkscrew(1);
  assert.ok(Math.abs(start.lx) < 1e-9 && Math.abs(start.ly) < 1e-9 && Math.abs(start.lz) < 1e-9);
  assert.ok(Math.abs(start.banking) < 1e-9, 'starts unbanked');
  assert.ok(Math.abs(end.ly) < 1e-9 && Math.abs(end.lz) < 1e-9, 'ends level');
  assert.ok(Math.abs(end.banking - 2 * Math.PI) < 1e-6, 'ends after one full turn');

  // Apex height = 2r = 0.8 at the midpoint (banking = π).
  assert.ok(Math.abs(pathCorkscrew(0.5).lz - 0.8) < 1e-6, 'apex height 2r');
});

test('easedProgress eases at the ends but is uniform through the middle', () => {
  assert.equal(easedProgress(0), 0);
  assert.ok(Math.abs(easedProgress(1) - 1) < 1e-9);
  assert.ok(Math.abs(easedProgress(0.5) - 0.5) < 1e-9, 'symmetric');

  // Monotonic non-decreasing.
  let prev = -Infinity;
  for (let t = 0; t <= 1; t += 0.02) { const e = easedProgress(t); assert.ok(e >= prev - 1e-9); prev = e; }

  // Rate ~0 at the seams (eased), but non-trivial through the middle (uniform).
  const d = 1e-3;
  const rateStart = (easedProgress(d) - easedProgress(0)) / d;
  const rateMid = (easedProgress(0.5 + d) - easedProgress(0.5 - d)) / (2 * d);
  assert.ok(rateStart < 0.05, `eased-in: start rate ~0 (got ${rateStart})`);
  assert.ok(rateMid > 1.0, `uniform middle has real rate (got ${rateMid})`);
});

test('pathJump returns to ground at both ends and rises in the middle', () => {
  assert.equal(pathJump(0).lz, 0);
  assert.ok(Math.abs(pathJump(1).lz) < 1e-9);
  assert.ok(pathJump(0.5).lz > 0.5, 'jump should rise above half a unit at the apex');
});
