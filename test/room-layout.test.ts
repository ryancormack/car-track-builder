// Tests for the dynamic living-room sizing/centring math (renderer/roomLayout)
// and the RoomExtent scaling path through buildLivingRoom. The layout math is
// pure (no Three.js), so it is exercised directly; buildLivingRoom is checked
// for the wall span/height it produces at a given extent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Track } from '../src/track.js';
import {
  computeTrackBounds,
  computeRoomLayout,
  ROOM_PADDING,
  MIN_ROOM_HALF,
  DEFAULT_WALL_HEIGHT,
  WALL_HEIGHT_RATIO,
} from '../src/renderer/roomLayout.js';
import { resolvePathLocal } from '../src/pieces/index.js';
import { piecePathAtT } from '../src/pieces/sampling.js';
import { buildLivingRoom } from '../src/renderer/environment.js';

/** Build a track from a list of piece ids. */
function trackOf(...ids: string[]): Track {
  const t = new Track();
  for (const id of ids) {
    const ok = t.addPiece(id);
    assert.equal(ok, true, `failed to add piece ${id}`);
  }
  return t;
}

/**
 * Independent reference bounds: walk every piece, sample its swept path densely,
 * and accumulate the min/max in Three.js space (X=wx, Z=wy, Y=wz). Used to
 * assert that the room actually encloses the geometry.
 */
function referenceBounds(track: Track, n = 40) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.pieces.length; i++) {
    const entry = track.entryStateAt(i);
    const path = resolvePathLocal(track.pieces, i);
    for (let s = 0; s <= n; s++) {
      const w = piecePathAtT(path, entry, s / n);
      minX = Math.min(minX, w.wx); maxX = Math.max(maxX, w.wx);
      minZ = Math.min(minZ, w.wy); maxZ = Math.max(maxZ, w.wy);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

// ---- computeTrackBounds ----

test('empty track has no bounds', () => {
  assert.equal(computeTrackBounds(new Track()), null);
});

test('bounds capture the swept geometry, not just the joints', () => {
  // A LOOP returns to its entry/exit joints at z=0, but bulges up to ~2R in
  // height between them. Joint-only bounds would miss that; swept sampling must
  // not.
  const t = trackOf('LOOP');
  const b = computeTrackBounds(t);
  assert.ok(b);
  assert.ok(b!.maxY > 0.5, `expected loop bulge in height, got maxY=${b!.maxY}`);
});

// ---- computeRoomLayout: empty / default ----

test('empty track yields the default room centred on the origin', () => {
  const layout = computeRoomLayout(new Track());
  assert.equal(layout.roomHalf, MIN_ROOM_HALF);
  assert.equal(layout.wallHeight, DEFAULT_WALL_HEIGHT);
  assert.equal(layout.centerX, 0);
  assert.equal(layout.centerZ, 0);
  assert.equal(layout.centerY, 0);
});

test('a small single-piece track stays clamped to the minimum room size', () => {
  const layout = computeRoomLayout(trackOf('STRAIGHT'));
  assert.equal(layout.roomHalf, MIN_ROOM_HALF);
});

// ---- computeRoomLayout: centring is the bbox midpoint, and it contains ----

test('centre is the bounding-box midpoint and the room encloses an asymmetric track', () => {
  // A long out-and-back: drive east a long way, U-turn, come back. The joints
  // cluster, so the joint-MEAN differs from the bbox MIDPOINT — the exact case
  // that let tracks poke through the walls before the fix.
  const t = trackOf(
    'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'STRAIGHT',
    'CURVE_L', 'CURVE_L',
    'STRAIGHT', 'STRAIGHT',
  );
  const layout = computeRoomLayout(t);
  const ref = referenceBounds(t);

  const midX = (ref.minX + ref.maxX) / 2;
  const midZ = (ref.minZ + ref.maxZ) / 2;
  assert.ok(Math.abs(layout.centerX - midX) < 1e-9, 'centerX is the bbox midpoint');
  assert.ok(Math.abs(layout.centerZ - midZ) < 1e-9, 'centerZ is the bbox midpoint');

  // Walls sit at centre ± roomHalf. Every part of the track must be inside,
  // with the full padding margin on every side.
  const minWallX = layout.centerX - layout.roomHalf;
  const maxWallX = layout.centerX + layout.roomHalf;
  const minWallZ = layout.centerZ - layout.roomHalf;
  const maxWallZ = layout.centerZ + layout.roomHalf;
  assert.ok(ref.minX - minWallX >= ROOM_PADDING - 1e-9, 'track clears -X wall by padding');
  assert.ok(maxWallX - ref.maxX >= ROOM_PADDING - 1e-9, 'track clears +X wall by padding');
  assert.ok(ref.minZ - minWallZ >= ROOM_PADDING - 1e-9, 'track clears -Z wall by padding');
  assert.ok(maxWallZ - ref.maxZ >= ROOM_PADDING - 1e-9, 'track clears +Z wall by padding');
});

// ---- computeRoomLayout: large tracks scale up ----

test('a very large track grows roomHalf and wall height proportionally', () => {
  const ids = Array.from({ length: 60 }, () => 'STRAIGHT');
  const layout = computeRoomLayout(trackOf(...ids));
  assert.ok(layout.roomHalf > MIN_ROOM_HALF, 'roomHalf grows past the minimum');

  const ref = referenceBounds(trackOf(...ids));
  const halfX = (ref.maxX - ref.minX) / 2;
  // roomHalf is ceil(halfExtent + padding), so it must cover extent + padding.
  assert.ok(layout.roomHalf >= halfX + ROOM_PADDING, 'roomHalf covers extent + padding');
  // Wall height holds the 16:9 proportion once the room is large enough.
  assert.equal(layout.wallHeight, layout.roomHalf * WALL_HEIGHT_RATIO);
});

// ---- buildLivingRoom: RoomExtent scaling path ----

/** Find the named descendant group of a living-room build. */
function namedChild(room: THREE.Object3D, name: string): THREE.Object3D {
  const found = room.getObjectByName(name);
  assert.ok(found, `expected a '${name}' group in the living room`);
  return found!;
}

test('buildLivingRoom defaults to the original 16-half room', () => {
  const room = buildLivingRoom();
  const walls = namedChild(room, 'walls');
  // The back wall is the box spanning X; it sits at z = -roomHalf.
  const backWall = walls.children[0] as THREE.Mesh;
  assert.equal(backWall.position.z, -MIN_ROOM_HALF);
});

test('buildLivingRoom scales the walls to a supplied RoomExtent', () => {
  const roomHalf = 40;
  const wallHeight = 24;
  const room = buildLivingRoom({ roomHalf, wallHeight });
  const walls = namedChild(room, 'walls');

  const backWall = walls.children[0] as THREE.Mesh;
  const leftWall = walls.children[1] as THREE.Mesh;
  // Walls are anchored at ±roomHalf and stand half their height above the floor.
  assert.equal(backWall.position.z, -roomHalf);
  assert.equal(backWall.position.y, wallHeight / 2);
  assert.equal(leftWall.position.x, -roomHalf);
  assert.equal(leftWall.position.y, wallHeight / 2);
});

test('buildLivingRoom keeps the window-fill light inside the back wall', () => {
  const roomHalf = 40;
  const room = buildLivingRoom({ roomHalf, wallHeight: 24 });
  const lights = namedChild(room, 'roomLights');
  // The window-fill light sits over by the window (positive X). It must be in
  // FRONT of the back wall (z > -roomHalf), not behind it.
  const fill = lights.children.find(
    (c) => (c as THREE.PointLight).isPointLight && c.position.x > 0,
  );
  assert.ok(fill, 'expected a window-fill point light near the window');
  assert.ok(
    fill!.position.z > -roomHalf,
    `window-fill light should be inside the room (z=${fill!.position.z} > ${-roomHalf})`,
  );
});
