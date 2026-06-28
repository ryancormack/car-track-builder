// renderer/roomLayout.ts — pure geometry helpers that decide how big the
// living-room backdrop must be and where it (and the camera) should be centred
// to enclose the whole track. Kept free of any Three.js dependency so the math
// is unit-testable in isolation (see test/room-layout.test.ts).
//
// Coordinate mapping reminder: the pure path samplers return world-grid points
// {wx, wy, wz} where x is forward, y is lateral, z is up. The renderer maps
// those onto Three.js space as X = wx, Z = wy (the horizontal floor plane) and
// Y = wz (height). The two visible walls live in the horizontal X/Z plane, so
// containment is governed by the wx/wy extent; wz only affects the camera's
// vertical framing.

import { resolvePathLocal } from '../pieces/resolve.js';
import { piecePathAtT } from '../pieces/sampling.js';
import type { Track } from '../track.js';

/** Padding (grid units) added around the track extent on every side. */
export const ROOM_PADDING = 8;
/** The smallest the room ever gets — the original default half-size. */
export const MIN_ROOM_HALF = 16;
/** Wall height holds the original 16:9 proportion against roomHalf. */
export const WALL_HEIGHT_RATIO = 9 / 16;
/** The original default wall height (used for an empty track). */
export const DEFAULT_WALL_HEIGHT = 9;
/** How many points to sample along each piece's swept path. */
const SAMPLES_PER_PIECE = 16;

/**
 * Axis-aligned bounds of the track in Three.js space. `x`/`z` are the
 * horizontal floor plane (driven by the grid's forward/lateral axes); `y` is
 * height (driven by the grid's up axis).
 */
export interface TrackBounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  minY: number; maxY: number;
}

/**
 * Accumulate the track's bounding box by sampling several points ALONG each
 * resolved piece path — not just the entry/exit joints. This captures the bulge
 * of curves, loops, and jump arcs that reach well beyond their own joints, so
 * the room is sized to the geometry the player actually sees. Returns `null`
 * for an empty track.
 */
export function computeTrackBounds(
  track: Track,
  samplesPerPiece: number = SAMPLES_PER_PIECE,
): TrackBounds | null {
  if (track.pieces.length === 0) return null;

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < track.pieces.length; i++) {
    const entry = track.entryStateAt(i);
    const path = resolvePathLocal(track.pieces, i);
    for (let s = 0; s <= samplesPerPiece; s++) {
      const t = s / samplesPerPiece;
      const w = piecePathAtT(path, entry, t);
      // X = wx (forward), Z = wy (lateral), Y = wz (up).
      if (w.wx < minX) minX = w.wx;
      if (w.wx > maxX) maxX = w.wx;
      if (w.wy < minZ) minZ = w.wy;
      if (w.wy > maxZ) maxZ = w.wy;
      if (w.wz < minY) minY = w.wz;
      if (w.wz > maxY) maxY = w.wz;
    }
  }

  return { minX, maxX, minZ, maxZ, minY, maxY };
}

/**
 * The single source of truth for room size AND centring. Both the room anchor,
 * the wall-sizing centre, and the camera target are derived from the SAME
 * bounding-box midpoint, so containment is guaranteed by the padding rather
 * than depending on a (drifting) joint-mean lining up with the midpoint.
 */
export interface RoomLayout {
  /** Half-size of the room (walls sit at centre ± roomHalf). */
  roomHalf: number;
  /** Wall height, scaled with roomHalf to keep the room's proportions. */
  wallHeight: number;
  /** Three.js X of the bounding-box midpoint (room anchor + camera target). */
  centerX: number;
  /** Three.js Z of the bounding-box midpoint (room anchor + camera target). */
  centerZ: number;
  /** Three.js Y (height) of the bounding-box midpoint (camera target only). */
  centerY: number;
}

/**
 * Compute the room layout for a track: the half-extent about the bbox midpoint
 * plus fixed padding (clamped to a sensible minimum), the proportional wall
 * height, and the shared centre. An empty track yields the default room
 * centred on the origin.
 */
export function computeRoomLayout(
  track: Track,
  samplesPerPiece: number = SAMPLES_PER_PIECE,
): RoomLayout {
  const bounds = computeTrackBounds(track, samplesPerPiece);
  if (!bounds) {
    return {
      roomHalf: MIN_ROOM_HALF,
      wallHeight: DEFAULT_WALL_HEIGHT,
      centerX: 0,
      centerZ: 0,
      centerY: 0,
    };
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  // Half-extent measured about the SAME midpoint the room is anchored to.
  const halfX = (bounds.maxX - bounds.minX) / 2;
  const halfZ = (bounds.maxZ - bounds.minZ) / 2;
  const roomHalf = Math.max(
    MIN_ROOM_HALF,
    Math.ceil(Math.max(halfX, halfZ) + ROOM_PADDING),
  );
  const wallHeight = Math.max(DEFAULT_WALL_HEIGHT, roomHalf * WALL_HEIGHT_RATIO);

  return { roomHalf, wallHeight, centerX, centerZ, centerY };
}
