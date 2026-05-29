// Tests for parametric path samplers — endpoints, ranges, continuity.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pathStraight, pathCurveR, pathCurveL,
  pathRampUp, pathRampDown,
  pathLoop, pathCorkscrew, pathJump,
  easedProgress,
  makeRampUpPath,
} from '../src/pieces/paths.js';
import { resolvePathLocal } from '../src/pieces/resolve.js';
import type { PieceId } from '../src/types.js';

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

test('ramps join flat track smoothly: ~zero grade at both ends, monotonic climb', () => {
  for (const ramp of [pathRampUp, pathRampDown]) {
    const d = 1e-3;
    const gradeStart = Math.abs(ramp(d).lz - ramp(0).lz) / d;
    const gradeEnd = Math.abs(ramp(1).lz - ramp(1 - d).lz) / d;
    assert.ok(gradeStart < 0.02, `${ramp.name}: entry grade should be ~0 (got ${gradeStart})`);
    assert.ok(gradeEnd < 0.02, `${ramp.name}: exit grade should be ~0 (got ${gradeEnd})`);
    // |lz| increases monotonically (no dip / overshoot).
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.02) {
      const z = Math.abs(ramp(t).lz);
      assert.ok(z >= prev - 1e-9, `${ramp.name}: not monotonic at t=${t}`);
      prev = z;
    }
  }
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

// --- Context-aware ramp path tests ---

test('makeRampUpPath(false, true) has non-zero grade at entry, zero at exit', () => {
  const ramp = makeRampUpPath(false, true);
  const d = 1e-3;
  const gradeStart = (ramp(d).lz - ramp(0).lz) / d;
  const gradeEnd = (ramp(1).lz - ramp(1 - d).lz) / d;
  assert.ok(gradeStart > 0.5, `entry should have significant slope (got ${gradeStart})`);
  assert.ok(gradeEnd < 0.02, `exit should be ~0 slope (got ${gradeEnd})`);
  assert.equal(ramp(0).lz, 0);
  assert.ok(Math.abs(ramp(1).lz - 1) < 1e-9);
});

test('makeRampUpPath(true, false) has zero grade at entry, non-zero at exit', () => {
  const ramp = makeRampUpPath(true, false);
  const d = 1e-3;
  const gradeStart = (ramp(d).lz - ramp(0).lz) / d;
  const gradeEnd = (ramp(1).lz - ramp(1 - d).lz) / d;
  assert.ok(gradeStart < 0.02, `entry should be ~0 slope (got ${gradeStart})`);
  assert.ok(gradeEnd > 0.5, `exit should have significant slope (got ${gradeEnd})`);
});

test('makeRampUpPath(false, false) is linear', () => {
  const ramp = makeRampUpPath(false, false);
  for (let t = 0; t <= 1; t += 0.1) {
    assert.ok(Math.abs(ramp(t).lz - t) < 1e-9, `should be linear at t=${t}`);
  }
});

test('all ramp variants are monotonic from 0 to 1', () => {
  for (const [ei, eo] of [[true, true], [true, false], [false, true], [false, false]]) {
    const ramp = makeRampUpPath(ei as boolean, eo as boolean);
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.01) {
      assert.ok(ramp(t).lz >= prev - 1e-9, `not monotonic at t=${t} ei=${ei} eo=${eo}`);
      prev = ramp(t).lz;
    }
  }
});

test('resolvePathLocal: consecutive RAMP_UP pieces get no easing at joint', () => {
  const pieces: PieceId[] = ['STRAIGHT', 'RAMP_UP', 'RAMP_UP', 'RAMP_UP', 'STRAIGHT'];
  const d = 1e-3;

  // First RAMP_UP (index 1): prev=STRAIGHT, next=RAMP_UP -> easeIn=true, easeOut=false
  const p1 = resolvePathLocal(pieces, 1);
  assert.ok((p1(d).lz - p1(0).lz) / d < 0.02, 'first ramp eases in');
  assert.ok((p1(1).lz - p1(1 - d).lz) / d > 0.5, 'first ramp does NOT ease out');

  // Middle RAMP_UP (index 2): prev=RAMP_UP, next=RAMP_UP -> easeIn=false, easeOut=false
  const p2 = resolvePathLocal(pieces, 2);
  assert.ok((p2(d).lz - p2(0).lz) / d > 0.5, 'middle ramp does NOT ease in');
  assert.ok((p2(1).lz - p2(1 - d).lz) / d > 0.5, 'middle ramp does NOT ease out');

  // Last RAMP_UP (index 3): prev=RAMP_UP, next=STRAIGHT -> easeIn=false, easeOut=true
  const p3 = resolvePathLocal(pieces, 3);
  assert.ok((p3(d).lz - p3(0).lz) / d > 0.5, 'last ramp does NOT ease in');
  assert.ok((p3(1).lz - p3(1 - d).lz) / d < 0.02, 'last ramp eases out');
});

test('resolvePathLocal: RAMP_UP next to RAMP_DN eases at the joint', () => {
  const pieces: PieceId[] = ['RAMP_UP', 'RAMP_DN'];
  const d = 1e-3;

  // RAMP_UP at index 0: prev=none, next=RAMP_DN (different) -> easeIn=true, easeOut=true
  const p0 = resolvePathLocal(pieces, 0);
  assert.ok((p0(1).lz - p0(1 - d).lz) / d < 0.02, 'RAMP_UP eases out before RAMP_DN');

  // RAMP_DN at index 1: prev=RAMP_UP (different), next=none -> easeIn=true, easeOut=true
  const p1 = resolvePathLocal(pieces, 1);
  assert.ok(Math.abs((p1(d).lz - p1(0).lz) / d) < 0.02, 'RAMP_DN eases in after RAMP_UP');
});

test('resolvePathLocal: non-ramp pieces return default pathLocal', () => {
  const pieces: PieceId[] = ['STRAIGHT', 'CURVE_L', 'STRAIGHT'];
  const resolved = resolvePathLocal(pieces, 0);
  assert.deepEqual(resolved(0.5), pathStraight(0.5));
});
