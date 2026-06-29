// Tests for parametric path samplers — endpoints, ranges, continuity.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pathStraight, pathCurveR, pathCurveL,
  pathRampUp, pathRampDown,
  pathLoop, pathCorkscrew, pathJump,
  pathSpiral, pathSteepHill,
  pathHelixUp, pathHelixDown, pathSpiralTower,
  pathGiantLoop, pathGiantJump,
  easedProgress,
  makeRampUpPath,
} from '../src/pieces/paths.js';
import { resolvePathLocal } from '../src/pieces/resolve.js';
import { SPIRAL_RADIUS, HELIX_RADIUS, SPIRAL_TOWER_RADIUS } from '../src/constants.js';
import type { PieceId } from '../src/types.js';

const samplers = [pathStraight, pathCurveR, pathCurveL, pathRampUp, pathRampDown,
                  pathLoop, pathCorkscrew, pathJump, pathSpiral, pathSteepHill,
                  pathHelixUp, pathHelixDown, pathSpiralTower,
                  pathGiantLoop, pathGiantJump];

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

// --- Spiral path tests ---

// A "true helix" piece (spiral / helix up+down / spiral tower) is a vertical-axis
// spiral ramp: its plan-view (lx, ly) trace is a circle of radius R that sweeps
// its full diameter (2R) laterally and returns to ly=0; the road never banks
// (banking stays 0 so the car rides upright); forward progress dips back through
// each loop (a genuine 360° turn); and the footprint stays within [0, forward].
function assertTrueHelix(fn: (t: number) => { lx: number; ly: number; lz: number; banking: number },
                         forward: number, radius: number, turns: number, dz: number): void {
  const start = fn(0);
  const end = fn(1);
  assert.ok(Math.abs(start.lx) < 1e-9 && Math.abs(start.ly) < 1e-9 && Math.abs(start.lz) < 1e-9,
    `helix must start at origin, got (${start.lx},${start.ly},${start.lz})`);
  assert.ok(Math.abs(end.lx - forward) < 1e-6 && Math.abs(end.ly) < 1e-6 && Math.abs(end.lz - dz) < 1e-6,
    `helix must end at (${forward},0,${dz}), got (${end.lx},${end.ly},${end.lz})`);

  let maxLy = -Infinity, minLy = Infinity, minLx = Infinity, maxLx = -Infinity, maxBank = 0;
  let reversed = false, prevLx = start.lx;
  for (let i = 0; i <= 2000; i++) {
    const t = i / 2000;
    const p = fn(t);
    maxLy = Math.max(maxLy, p.ly); minLy = Math.min(minLy, p.ly);
    minLx = Math.min(minLx, p.lx); maxLx = Math.max(maxLx, p.lx);
    maxBank = Math.max(maxBank, Math.abs(p.banking));
    if (p.lx < prevLx - 1e-6) reversed = true;
    prevLx = p.lx;
  }
  // Plan-view circle: bulges to its full diameter (2R) and the near edge touches ly=0.
  assert.ok(Math.abs(maxLy - 2 * radius) < 0.02, `helix should sweep full diameter 2R=${2 * radius}, got ${maxLy}`);
  assert.ok(minLy > -1e-6, `helix circle should stay on one side (minLy=${minLy})`);
  // Level ramp — no barrel-roll banking, so the car stays upright.
  assert.ok(maxBank < 1e-9, `true helix must not bank/roll (maxBank=${maxBank})`);
  // Genuine full revolution: forward progress dips back through the loop.
  assert.ok(reversed, `helix should reverse heading through the loop (lx must dip back), turns=${turns}`);
  // Footprint stays within its forward cells.
  assert.ok(minLx > -1e-6 && maxLx < forward + 1e-6, `helix lx out of [0,${forward}]: [${minLx}, ${maxLx}]`);
}

test('pathSpiral starts at (0,0,0) and ends at (2,~0,-2)', () => {
  const start = pathSpiral(0);
  const end = pathSpiral(1);
  assert.ok(Math.abs(start.lx) < 1e-9);
  assert.ok(Math.abs(start.ly) < 1e-9);
  assert.ok(Math.abs(start.lz) < 1e-9);
  assert.ok(Math.abs(start.banking) < 1e-9);
  assert.ok(Math.abs(end.lx - 2) < 1e-6);
  assert.ok(Math.abs(end.ly) < 0.01);
  assert.ok(Math.abs(end.lz + 2) < 1e-6);
});

test('pathSpiral is a true (upright) helix sweeping a full plan-view circle', () => {
  assertTrueHelix(pathSpiral, 2, SPIRAL_RADIUS, 1, -2);
});

test('pathSpiral is continuous at segment seams', () => {
  const eps = 1e-5;
  // Check seam at t=0.05
  const before05 = pathSpiral(0.05 - eps);
  const after05 = pathSpiral(0.05 + eps);
  assert.ok(Math.abs(before05.lx - after05.lx) < 0.01);
  assert.ok(Math.abs(before05.ly - after05.ly) < 0.01);
  assert.ok(Math.abs(before05.lz - after05.lz) < 0.01);
  // Check seam at t=0.95
  const before95 = pathSpiral(0.95 - eps);
  const after95 = pathSpiral(0.95 + eps);
  assert.ok(Math.abs(before95.lx - after95.lx) < 0.01);
  assert.ok(Math.abs(before95.ly - after95.ly) < 0.01);
  assert.ok(Math.abs(before95.lz - after95.lz) < 0.01);
});

// --- Steep Hill path tests ---

test('pathSteepHill starts and ends at ground level with peak at 1.5', () => {
  const start = pathSteepHill(0);
  const end = pathSteepHill(1);
  const mid = pathSteepHill(0.5);
  assert.ok(Math.abs(start.lx) < 1e-9);
  assert.ok(Math.abs(start.lz) < 1e-9);
  assert.ok(Math.abs(end.lx - 2) < 1e-9);
  assert.ok(Math.abs(end.lz) < 1e-9);
  assert.ok(Math.abs(mid.lz - 1.5) < 1e-9);
  assert.ok(Math.abs(mid.lx - 1) < 1e-9);
});

test('pathSteepHill lx is monotonically increasing from 0 to 2', () => {
  let prev = -Infinity;
  for (let t = 0; t <= 1; t += 0.01) {
    const p = pathSteepHill(t);
    assert.ok(p.lx >= prev - 1e-9, `steep hill lx not monotonic at t=${t}`);
    prev = p.lx;
  }
});

test('pathSteepHill is symmetric', () => {
  for (let t = 0; t <= 0.5; t += 0.05) {
    const a = pathSteepHill(t);
    const b = pathSteepHill(1 - t);
    assert.ok(Math.abs(a.lz - b.lz) < 1e-9, `not symmetric at t=${t}`);
  }
});

// --- Helix Down path tests ---

test('pathHelixDown starts at (0,0,0) and ends at (3,~0,-3), staying level (banking 0)', () => {
  const start = pathHelixDown(0);
  const end = pathHelixDown(1);
  assert.ok(Math.abs(start.lx) < 1e-9);
  assert.ok(Math.abs(start.ly) < 1e-9);
  assert.ok(Math.abs(start.lz) < 1e-9);
  assert.ok(Math.abs(start.banking) < 1e-9);
  assert.ok(Math.abs(end.lx - 3) < 1e-6);
  assert.ok(Math.abs(end.ly) < 0.01, `end ly should be ~0, got ${end.ly}`);
  assert.ok(Math.abs(end.lz + 3) < 1e-6);
  assert.ok(Math.abs(end.banking) < 1e-9, `helix must stay level (banking 0), got ${end.banking}`);
});

test('pathHelixDown is a true (upright) helix sweeping a full plan-view circle', () => {
  assertTrueHelix(pathHelixDown, 3, HELIX_RADIUS, 1, -3);
});

test('pathHelixDown descends monotonically (lz decreases steadily)', () => {
  let prev = Infinity;
  for (let t = 0; t <= 1; t += 0.01) {
    const z = pathHelixDown(t).lz;
    assert.ok(z <= prev + 1e-9, `helix down lz not monotonic at t=${t}`);
    prev = z;
  }
});

test('pathHelixDown is continuous (no jumps between adjacent samples)', () => {
  const steps = 200;
  let prev = pathHelixDown(0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const curr = pathHelixDown(t);
    const dx = curr.lx - prev.lx;
    const dy = curr.ly - prev.ly;
    const dz = curr.lz - prev.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    assert.ok(dist < 0.15, `helix down discontinuity at t=${t.toFixed(3)}: dist=${dist.toFixed(4)}`);
    prev = curr;
  }
});

// --- Helix Up path tests ---

test('pathHelixUp starts at (0,0,0) and ends at (3,~0,+3), staying level (banking 0)', () => {
  const start = pathHelixUp(0);
  const end = pathHelixUp(1);
  assert.ok(Math.abs(start.lx) < 1e-9);
  assert.ok(Math.abs(start.ly) < 1e-9);
  assert.ok(Math.abs(start.lz) < 1e-9);
  assert.ok(Math.abs(start.banking) < 1e-9);
  assert.ok(Math.abs(end.lx - 3) < 1e-6);
  assert.ok(Math.abs(end.ly) < 0.01, `end ly should be ~0, got ${end.ly}`);
  assert.ok(Math.abs(end.lz - 3) < 1e-6);
  assert.ok(Math.abs(end.banking) < 1e-9, `helix must stay level (banking 0), got ${end.banking}`);
});

test('pathHelixUp is a true (upright) helix sweeping a full plan-view circle', () => {
  assertTrueHelix(pathHelixUp, 3, HELIX_RADIUS, 1, 3);
});

test('pathHelixUp climbs monotonically (lz increases steadily)', () => {
  let prev = -Infinity;
  for (let t = 0; t <= 1; t += 0.01) {
    const z = pathHelixUp(t).lz;
    assert.ok(z >= prev - 1e-9, `helix up lz not monotonic at t=${t}`);
    prev = z;
  }
});

test('pathHelixUp is continuous (no jumps between adjacent samples)', () => {
  const steps = 200;
  let prev = pathHelixUp(0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const curr = pathHelixUp(t);
    const dx = curr.lx - prev.lx;
    const dy = curr.ly - prev.ly;
    const dz = curr.lz - prev.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    assert.ok(dist < 0.15, `helix up discontinuity at t=${t.toFixed(3)}: dist=${dist.toFixed(4)}`);
    prev = curr;
  }
});


// --- Spiral Tower path tests ---

test('pathSpiralTower starts at (0,0,0) and ends at (4,~0,-4), staying level (banking 0)', () => {
  const start = pathSpiralTower(0);
  const end = pathSpiralTower(1);
  assert.ok(Math.abs(start.lx) < 1e-9);
  assert.ok(Math.abs(start.ly) < 1e-9);
  assert.ok(Math.abs(start.lz) < 1e-9);
  assert.ok(Math.abs(start.banking) < 1e-9);
  assert.ok(Math.abs(end.lx - 4) < 1e-6);
  assert.ok(Math.abs(end.ly) < 0.01, `end ly should be ~0, got ${end.ly}`);
  assert.ok(Math.abs(end.lz + 4) < 1e-6);
  assert.ok(Math.abs(end.banking) < 1e-9, `helix must stay level (banking 0), got ${end.banking}`);
});

test('pathSpiralTower is a true (upright) two-turn helix sweeping a full plan-view circle', () => {
  assertTrueHelix(pathSpiralTower, 4, SPIRAL_TOWER_RADIUS, 2, -4);
});

test('pathSpiralTower winds two full turns (ly returns to the near edge twice)', () => {
  // Over two revolutions the plan-view circle touches its near edge (ly≈0) at
  // the start, after the first turn, and at the end — i.e. it crosses ly≈0
  // multiple times rather than just at the endpoints.
  let nearEdgeCrossings = 0;
  let wasOut = false;
  for (let i = 0; i <= 4000; i++) {
    const ly = pathSpiralTower(i / 4000).ly;
    if (ly > SPIRAL_TOWER_RADIUS) wasOut = true;
    if (wasOut && ly < 0.02) { nearEdgeCrossings++; wasOut = false; }
  }
  assert.ok(nearEdgeCrossings >= 2, `two-turn tower should return to the near edge >=2 times, got ${nearEdgeCrossings}`);
});

test('pathSpiralTower is continuous (no jumps between adjacent samples)', () => {
  const steps = 300;
  let prev = pathSpiralTower(0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const curr = pathSpiralTower(t);
    const dx = curr.lx - prev.lx;
    const dy = curr.ly - prev.ly;
    const dz = curr.lz - prev.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    assert.ok(dist < 0.15, `spiral tower discontinuity at t=${t.toFixed(3)}: dist=${dist.toFixed(4)}`);
    prev = curr;
  }
});

// --- Giant Loop path tests ---

test('pathGiantLoop starts at (0,0,0), ends at (3,0,0), and reaches peak height ~3.0', () => {
  const a = pathGiantLoop(0);
  const b = pathGiantLoop(1);
  assert.deepEqual({ lx: a.lx, lz: a.lz }, { lx: 0, lz: 0 });
  assert.ok(Math.abs(b.lx - 3) < 1e-9);
  assert.ok(Math.abs(b.lz) < 1e-9);

  // Peak height across the path should be ~3 (loop diameter = 2R = 3).
  let peak = 0;
  for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, pathGiantLoop(t).lz);
  assert.ok(peak > 2.99 && peak < 3.01, `giant loop peak should be ~3, got ${peak}`);
});

test('pathGiantLoop is continuous at both segment seams', () => {
  const epsilon = 1e-6;
  const beforeApproach = pathGiantLoop(0.1 - epsilon);
  const afterApproach = pathGiantLoop(0.1 + epsilon);
  assert.ok(Math.abs(beforeApproach.lx - afterApproach.lx) < 1e-3);
  assert.ok(Math.abs(beforeApproach.lz - afterApproach.lz) < 1e-3);

  const beforeDepart = pathGiantLoop(0.9 - epsilon);
  const afterDepart = pathGiantLoop(0.9 + epsilon);
  assert.ok(Math.abs(beforeDepart.lx - afterDepart.lx) < 1e-3);
  assert.ok(Math.abs(beforeDepart.lz - afterDepart.lz) < 1e-3);
});

test('pathGiantLoop spans 3 cells (3x bigger than standard loop)', () => {
  const end = pathGiantLoop(1);
  assert.ok(Math.abs(end.lx - 3) < 1e-9, 'should span 3 cells forward');
});

// --- Giant Jump path tests ---

test('pathGiantJump starts and ends at ground level and rises in the middle', () => {
  assert.equal(pathGiantJump(0).lz, 0);
  assert.ok(Math.abs(pathGiantJump(1).lz) < 1e-9);
  assert.ok(pathGiantJump(0.5).lz > 1.5, 'giant jump should rise above 1.5 units at the apex');
});

test('pathGiantJump spans 3 cells (wider than standard jump)', () => {
  const end = pathGiantJump(1);
  assert.ok(Math.abs(end.lx - 3) < 1e-9, 'should span 3 cells forward');
});

test('pathGiantJump lx is monotonically increasing from 0 to 3', () => {
  let prev = -Infinity;
  for (let t = 0; t <= 1; t += 0.01) {
    const p = pathGiantJump(t);
    assert.ok(p.lx >= prev - 1e-9, `giant jump lx not monotonic at t=${t}`);
    prev = p.lx;
  }
});

test('pathGiantJump peak is taller than standard jump peak', () => {
  let giantPeak = 0;
  let standardPeak = 0;
  for (let t = 0; t <= 1; t += 0.01) {
    giantPeak = Math.max(giantPeak, pathGiantJump(t).lz);
    standardPeak = Math.max(standardPeak, pathJump(t).lz);
  }
  assert.ok(giantPeak > standardPeak, `giant jump peak (${giantPeak}) should be taller than standard (${standardPeak})`);
});
