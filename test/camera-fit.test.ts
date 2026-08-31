// test/camera-fit.test.ts — the orthographic camera must frame whatever the
// track grows to. These tests pin the two failures that made large layouts
// unusable: a frustum that never scaled past its initial 8 (so a big track could
// not be framed at ANY zoom) and clip planes measured from a fixed 14-unit
// camera distance (so the near half of a big track fell behind the near plane).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cameraBasis,
  computeCameraFit,
  computeRoomLayout,
  computeTrackBounds,
  DEPTH_PAD,
  MIN_CAMERA_DISTANCE,
  MIN_FRUSTUM_SIZE,
  type TrackBounds,
} from '../src/renderer/roomLayout.js';
import { Track } from '../src/track.js';
import type { PieceId } from '../src/types.js';

const ISO_AZIMUTH = Math.PI / 4;
const ISO_POLAR = Math.atan(1 / Math.SQRT2);
/** The zoom floor in renderer/controls.ts — the widest view a user can reach. */
const MIN_ZOOM = 0.3;

function centreOf(b: TrackBounds): { x: number; y: number; z: number } {
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    z: (b.minZ + b.maxZ) / 2,
  };
}

/** Build a serpentine track of `rows` rows of `rowLen` straights. */
function serpentine(rowLen: number, rows: number, gap: number): Track {
  const pieces: PieceId[] = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < rowLen; i++) pieces.push('STRAIGHT');
    if (r < rows - 1) {
      const turn: PieceId = r % 2 === 0 ? 'CURVE_R' : 'CURVE_L';
      pieces.push(turn);
      for (let i = 0; i < gap; i++) pieces.push('STRAIGHT');
      pieces.push(turn);
    }
  }
  const t = new Track();
  t.fromJSON({ dropHeight: 6, pieces });
  return t;
}

/**
 * Project every bounding-box corner into camera space and assert all eight land
 * inside the frustum and between the near/far planes. This is the property that
 * actually matters: "the whole track is on screen".
 */
function assertFramed(
  b: TrackBounds,
  centre: { x: number; y: number; z: number },
  fit: { frustumSize: number; cameraDistance: number; near: number; far: number },
  aspect: number,
  zoom: number,
  label: string,
): void {
  const { right, up, backward } = cameraBasis(ISO_AZIMUTH, ISO_POLAR);
  const halfH = fit.frustumSize / zoom;
  const halfW = halfH * aspect;
  for (const x of [b.minX, b.maxX]) {
    for (const y of [b.minY, b.maxY]) {
      for (const z of [b.minZ, b.maxZ]) {
        const v = [x - centre.x, y - centre.y, z - centre.z];
        const sx = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
        const sy = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
        const back = v[0] * backward[0] + v[1] * backward[1] + v[2] * backward[2];
        const depth = fit.cameraDistance - back;
        assert.ok(Math.abs(sx) <= halfW, `${label}: corner x=${sx.toFixed(2)} outside half-width ${halfW.toFixed(2)}`);
        assert.ok(Math.abs(sy) <= halfH, `${label}: corner y=${sy.toFixed(2)} outside half-height ${halfH.toFixed(2)}`);
        assert.ok(depth > fit.near, `${label}: corner depth ${depth.toFixed(2)} is in front of near plane ${fit.near}`);
        assert.ok(depth < fit.far, `${label}: corner depth ${depth.toFixed(2)} is behind far plane ${fit.far}`);
      }
    }
  }
}

test('cameraBasis returns an orthonormal right-handed basis', () => {
  for (const az of [0, Math.PI / 4, 1.1, Math.PI]) {
    const { right, up, backward } = cameraBasis(az, ISO_POLAR);
    const len = (v: number[]): number => Math.hypot(v[0], v[1], v[2]);
    const dot = (a: number[], c: number[]): number => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    for (const [name, v] of [['right', right], ['up', up], ['backward', backward]] as const) {
      assert.ok(Math.abs(len(v as unknown as number[]) - 1) < 1e-9, `${name} not unit length at az=${az}`);
    }
    assert.ok(Math.abs(dot(right as unknown as number[], up as unknown as number[])) < 1e-9);
    assert.ok(Math.abs(dot(right as unknown as number[], backward as unknown as number[])) < 1e-9);
    assert.ok(Math.abs(dot(up as unknown as number[], backward as unknown as number[])) < 1e-9);
  }
  // `right` must stay horizontal, or panning would drift vertically.
  assert.equal(cameraBasis(1.23, ISO_POLAR).right[1], 0);
});

test('an empty track keeps the original fixed camera values', () => {
  const fit = computeCameraFit(null, { x: 0, y: 0, z: 0 }, ISO_AZIMUTH, ISO_POLAR, 16 / 9);
  assert.equal(fit.frustumSize, MIN_FRUSTUM_SIZE);
  assert.equal(fit.cameraDistance, MIN_CAMERA_DISTANCE);
});

test('a small track is not zoomed out past the original framing', () => {
  const t = new Track();
  ['STRAIGHT', 'LOOP', 'STRAIGHT', 'FINISH'].forEach((id) => t.addPiece(id as PieceId));
  const b = computeTrackBounds(t)!;
  const fit = computeCameraFit(b, centreOf(b), ISO_AZIMUTH, ISO_POLAR, 16 / 9);
  assert.equal(fit.frustumSize, MIN_FRUSTUM_SIZE, 'small tracks should keep the original 8-unit framing');
  assert.equal(fit.cameraDistance, MIN_CAMERA_DISTANCE);
});

test('the whole track is framed at zoom 1 for every layout size', () => {
  const aspect = 1440 / 820;
  for (const [label, track] of [
    ['medium', serpentine(20, 3, 2)],
    ['big', serpentine(34, 5, 4)],
    ['huge', serpentine(50, 7, 6)],
  ] as const) {
    const b = computeTrackBounds(track)!;
    const centre = centreOf(b);
    const fit = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, aspect);
    assertFramed(b, centre, fit, aspect, 1, label);
  }
});

test('REGRESSION: the OLD fixed frustum cropped a mid-size track at default zoom', () => {
  // The everyday symptom. frustumSize was hardcoded to 8, so the default view
  // always showed 8 world units of half-height no matter how big the track got —
  // the player had to zoom out by hand after every few pieces.
  const b = computeTrackBounds(serpentine(34, 5, 4))!;
  const centre = centreOf(b);
  const aspect = 1440 / 820;
  const fit = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, aspect);
  assert.ok(fit.frustumSize > MIN_FRUSTUM_SIZE, 'a 194-piece track must widen the frustum');
  assert.throws(
    () => assertFramed(b, centre, { ...fit, frustumSize: MIN_FRUSTUM_SIZE }, aspect, 1, 'old-default'),
    /outside half-/,
    'the old fixed frustum should crop this track at default zoom',
  );
  assertFramed(b, centre, fit, aspect, 1, 'fitted-default');
});

test('REGRESSION: a large track could not be framed by the OLD frustum at ANY zoom', () => {
  // Past a certain size, zooming out could not rescue it either: the widest view
  // reachable was 8 / 0.3 = 26.67 units of half-height, full stop. A square-ish
  // window hits that ceiling first, because a wide aspect ratio no longer helps
  // absorb the horizontal extent.
  const oldWidest = MIN_FRUSTUM_SIZE / MIN_ZOOM;
  const b = computeTrackBounds(serpentine(50, 7, 6))!;
  const centre = centreOf(b);
  const aspect = 1;
  const fit = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, aspect);
  assert.ok(
    fit.frustumSize > oldWidest,
    `expected the fitted frustum (${fit.frustumSize.toFixed(1)}) to exceed the old maximum reachable view (${oldWidest.toFixed(1)})`,
  );
  assert.throws(
    () => assertFramed(b, centre, { ...fit, frustumSize: MIN_FRUSTUM_SIZE }, aspect, MIN_ZOOM, 'old-widest'),
    /outside half-/,
    'the old frustum should not frame this track even at minimum zoom',
  );
  // And the fitted frustum does frame it, at default zoom.
  assertFramed(b, centre, fit, aspect, 1, 'fitted');
});

test('the fit adapts to aspect ratio — a narrow window still frames the track', () => {
  const b = computeTrackBounds(serpentine(34, 5, 4))!;
  const centre = centreOf(b);
  for (const aspect of [0.5, 1, 16 / 9, 3.5]) {
    const fit = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, aspect);
    assertFramed(b, centre, fit, aspect, 1, `aspect=${aspect}`);
  }
  // A tall/narrow window must open the frustum up, not crop the track.
  const narrow = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, 0.5);
  const wide = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, 3.5);
  assert.ok(narrow.frustumSize > wide.frustumSize);
});

test('the fit follows the camera as it rotates (R key)', () => {
  const b = computeTrackBounds(serpentine(34, 5, 4))!;
  const centre = centreOf(b);
  const aspect = 1440 / 820;
  // Sweep a full turn in the same PI/8 steps the R key uses.
  for (let i = 0; i < 16; i++) {
    const az = ISO_AZIMUTH + (i * Math.PI) / 8;
    const fit = computeCameraFit(b, centre, az, ISO_POLAR, aspect);
    const { right, up } = cameraBasis(az, ISO_POLAR);
    const halfH = fit.frustumSize;
    const halfW = halfH * aspect;
    for (const x of [b.minX, b.maxX]) {
      for (const y of [b.minY, b.maxY]) {
        for (const z of [b.minZ, b.maxZ]) {
          const v = [x - centre.x, y - centre.y, z - centre.z];
          const sx = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
          const sy = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
          assert.ok(Math.abs(sx) <= halfW && Math.abs(sy) <= halfH, `cropped at azimuth step ${i}`);
        }
      }
    }
  }
});

test('REGRESSION: clip planes contain the track — the old fixed distance did not', () => {
  const b = computeTrackBounds(serpentine(34, 5, 4))!;
  const centre = centreOf(b);
  const aspect = 1440 / 820;
  const fit = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, aspect);
  assert.ok(fit.cameraDistance > MIN_CAMERA_DISTANCE, 'a large track must pull the camera back');
  assertFramed(b, centre, fit, aspect, 1, 'clip');

  // With the old fixed 14-unit distance the nearest corner sits BEHIND the
  // camera (negative depth), which is what clipped the near half of the track.
  const { backward } = cameraBasis(ISO_AZIMUTH, ISO_POLAR);
  let maxBack = 0;
  for (const x of [b.minX, b.maxX]) {
    for (const y of [b.minY, b.maxY]) {
      for (const z of [b.minZ, b.maxZ]) {
        const v = [x - centre.x, y - centre.y, z - centre.z];
        maxBack = Math.max(maxBack, v[0] * backward[0] + v[1] * backward[1] + v[2] * backward[2]);
      }
    }
  }
  assert.ok(
    MIN_CAMERA_DISTANCE - maxBack < 0,
    'the old fixed distance should place the nearest corner behind the camera',
  );
  assert.ok(fit.cameraDistance - maxBack >= DEPTH_PAD - 1e-9, 'fitted distance must clear the near plane');
});

test('zooming out from the fit never crops the track', () => {
  const b = computeTrackBounds(serpentine(50, 7, 6))!;
  const centre = centreOf(b);
  const aspect = 1440 / 820;
  const fit = computeCameraFit(b, centre, ISO_AZIMUTH, ISO_POLAR, aspect);
  for (const zoom of [1, 0.7, MIN_ZOOM]) {
    assertFramed(b, centre, fit, aspect, zoom, `zoom=${zoom}`);
  }
});

test('the fit grows monotonically as the track grows', () => {
  // Sizes chosen above the MIN_FRUSTUM_SIZE floor, where the fit is doing the
  // work rather than the clamp.
  const aspect = 1;
  const sizes = [30, 40, 50, 70].map((rowLen) => {
    const b = computeTrackBounds(serpentine(rowLen, 4, 3))!;
    return computeCameraFit(b, centreOf(b), ISO_AZIMUTH, ISO_POLAR, aspect).frustumSize;
  });
  assert.ok(sizes[0] > MIN_FRUSTUM_SIZE, 'baseline should already be above the clamp');
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] > sizes[i - 1], `frustum did not grow from step ${i - 1} to ${i}`);
  }
});

test('the room layout and the camera fit agree that the track fits inside the room', () => {
  // The room is sized from roomHalf; the camera from the bbox. A track that fits
  // the room must therefore also be framed — this catches the two drifting apart.
  for (const rowLen of [20, 34, 50]) {
    const track = serpentine(rowLen, 4, 3);
    const layout = computeRoomLayout(track);
    const b = computeTrackBounds(track)!;
    const half = Math.max((b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2);
    assert.ok(layout.roomHalf >= half, 'room must enclose the track');
    const fit = computeCameraFit(b, centreOf(b), ISO_AZIMUTH, ISO_POLAR, 16 / 9);
    assertFramed(b, centreOf(b), fit, 16 / 9, 1, `rowLen=${rowLen}`);
  }
});
