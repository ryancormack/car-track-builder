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

/** Smallest ortho half-height — preserves the original framing of small tracks. */
export const MIN_FRUSTUM_SIZE = 8;
/** Smallest camera distance — the original fixed value. */
export const MIN_CAMERA_DISTANCE = 14;
/** Slack around the fitted extent so the track isn't flush against the edges. */
export const FRUSTUM_MARGIN = 1.12;
/** Clearance kept in front of the near plane and behind the far plane. */
export const DEPTH_PAD = 12;

/**
 * How the orthographic camera must be configured to frame a whole track.
 *
 * An orthographic frustum shows a fixed world-space rectangle, so it must be
 * sized from the track's extent — otherwise a large track simply cannot fit on
 * screen at any zoom. The camera *distance* does not affect ortho framing, but
 * it does decide which geometry falls outside near/far, so it is fitted too.
 */
export interface CameraFit {
  /** Ortho half-height that frames the whole track at zoom 1.0. */
  frustumSize: number;
  /** Distance from the target along the view axis. */
  cameraDistance: number;
  /** Near plane. */
  near: number;
  /** Far plane. */
  far: number;
}

/**
 * The camera's world-space basis for a given azimuth/polar orbit angle, matching
 * `Renderer.updateCamera` (camera sits at target + distance·backward, with
 * Three's default up of +Y).
 */
export function cameraBasis(azimuth: number, polar: number): {
  right: [number, number, number];
  up: [number, number, number];
  backward: [number, number, number];
} {
  const ca = Math.cos(azimuth), sa = Math.sin(azimuth);
  const cp = Math.cos(polar), sp = Math.sin(polar);
  return {
    // Horizontal, perpendicular to the view axis.
    right: [sa, 0, -ca],
    // Screen-up, tilted by the polar angle.
    up: [-sp * ca, cp, -sp * sa],
    // From target toward the camera.
    backward: [cp * ca, sp, cp * sa],
  };
}

/**
 * Fit the orthographic camera to a track's bounding box.
 *
 * Projects the box's eight corners onto the camera's screen-right / screen-up /
 * view axes, so the fit is exact for any orbit angle (pressing R to rotate
 * re-fits rather than cropping) and for any aspect ratio. Returns the original
 * fixed values for an empty track, so small tracks look exactly as before.
 */
export function computeCameraFit(
  bounds: TrackBounds | null,
  center: { x: number; y: number; z: number },
  azimuth: number,
  polar: number,
  aspect: number,
): CameraFit {
  if (!bounds) {
    return {
      frustumSize: MIN_FRUSTUM_SIZE,
      cameraDistance: MIN_CAMERA_DISTANCE,
      near: 0.1,
      far: MIN_CAMERA_DISTANCE + DEPTH_PAD * 4,
    };
  }

  const { right, up, backward } = cameraBasis(azimuth, polar);
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;

  let halfRight = 0, halfUp = 0, halfBack = 0;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        const vx = x - center.x, vy = y - center.y, vz = z - center.z;
        halfRight = Math.max(halfRight, Math.abs(vx * right[0] + vy * right[1] + vz * right[2]));
        halfUp = Math.max(halfUp, Math.abs(vx * up[0] + vy * up[1] + vz * up[2]));
        halfBack = Math.max(halfBack, Math.abs(vx * backward[0] + vy * backward[1] + vz * backward[2]));
      }
    }
  }

  // Fit BOTH axes: the horizontal need is divided by aspect because the frustum
  // is expressed as a half-HEIGHT (half-width = frustumSize · aspect).
  const frustumSize = Math.max(
    MIN_FRUSTUM_SIZE,
    FRUSTUM_MARGIN * Math.max(halfUp, halfRight / safeAspect),
  );
  // Pull the camera back far enough that the nearest corner stays in front of
  // the near plane, then extend far past the most distant corner.
  const cameraDistance = Math.max(MIN_CAMERA_DISTANCE, halfBack + DEPTH_PAD);
  return {
    frustumSize,
    cameraDistance,
    near: 0.1,
    far: cameraDistance + halfBack + DEPTH_PAD * 2,
  };
}
