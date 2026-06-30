// pieces/frames.ts — the single, pure source of truth for the moving frame
// along a piece: centreline position, tangent, surface normal ("up"), and the
// lateral axis ("side"). No rendering / Three.js dependency, so it can be unit
// tested directly. The renderer (rails, car) and the simulator (carSample) all
// consume these frames, which is what keeps the car glued to the track surface
// and the rails square to it.
//
// Coordinates are grid space: x = forward (wx), y = lateral (wy), z = up (wz).

import { piecePathAtT } from './sampling.js';
import type { GridState, PathFn } from '../types.js';

export interface Vec3 { x: number; y: number; z: number; }

export interface TrackFrame {
  pos: Vec3;       // centreline position
  tangent: Vec3;   // unit forward direction
  up: Vec3;        // unit track-surface normal (the car's "up")
  side: Vec3;      // unit lateral direction (rail offset axis)
  banking: number; // radians, as authored by the path
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const lenSq = (a: Vec3): number => dot(a, a);
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function normalize(a: Vec3): Vec3 {
  const m = Math.sqrt(lenSq(a));
  return m > 1e-12 ? { x: a.x / m, y: a.y / m, z: a.z / m } : { x: 1, y: 0, z: 0 };
}
const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => ({
  x: a.x + (b.x - a.x) * f,
  y: a.y + (b.y - a.y) * f,
  z: a.z + (b.z - a.z) * f,
});

const DIFF = 0.004; // finite-difference half-step for the tangent

function tangentAt(path: PathFn, entry: GridState, t: number): Vec3 {
  const a = piecePathAtT(path, entry, Math.max(t - DIFF, 0));
  const b = piecePathAtT(path, entry, Math.min(t + DIFF, 1));
  const d: Vec3 = { x: b.wx - a.wx, y: b.wy - a.wy, z: b.wz - a.wz };
  return lenSq(d) > 1e-12 ? normalize(d) : { x: 1, y: 0, z: 0 };
}

function buildFrame(path: PathFn, entry: GridState, t: number, prevSide: Vec3 | null): TrackFrame {
  const h = piecePathAtT(path, entry, t);
  const pos: Vec3 = { x: h.wx, y: h.wy, z: h.wz };
  const tangent = tangentAt(path, entry, t);

  // Surface normal = world-up rolled by the banking angle about the TANGENT
  // (forward) axis. Rolling about the tangent (not a fixed world axis) is what
  // lets a horizontal turn bank correctly — the lean follows the rotating
  // heading. For a piece travelling straight along +x this reduces exactly to
  // the old {0, -sin b, cos b}, so corkscrews are unchanged.
  const normal = rollAboutTangent(tangent, h.banking);
  let side = cross(tangent, normal);
  if (lenSq(side) < 1e-8) side = prevSide ? { ...prevSide } : { x: 0, y: 1, z: 0 };
  side = normalize(side);
  // Keep the lateral axis sign-continuous. Without this, a loop's side flips
  // where the tangent passes vertical and the derived "up" would not invert.
  if (prevSide && dot(side, prevSide) < 0) side = scale(side, -1);

  const up = normalize(cross(side, tangent));
  return { pos, tangent, up, side, banking: h.banking };
}

/**
 * World-up ({0,0,1}) rotated by `banking` radians about the (unit) tangent axis,
 * via Rodrigues' rotation. This is the surface-normal direction before
 * re-orthogonalisation. banking 0 → world-up; for a tangent along +x it equals
 * {0, -sin b, cos b} (the legacy fixed-axis formula), so existing banked pieces
 * (the corkscrew) render identically while horizontal turns now bank properly.
 */
function rollAboutTangent(tangent: Vec3, banking: number): Vec3 {
  const U: Vec3 = { x: 0, y: 0, z: 1 };
  if (Math.abs(banking) < 1e-12) return U;
  const c = Math.cos(banking);
  const s = Math.sin(banking);
  const txu = cross(tangent, U);
  const tdu = dot(tangent, U);
  const k = tdu * (1 - c);
  return {
    x: U.x * c + txu.x * s + tangent.x * k,
    y: U.y * c + txu.y * s + tangent.y * k,
    z: U.z * c + txu.z * s + tangent.z * k,
  };
}

/**
 * A continuous sequence of `segments + 1` frames spanning t in [tStart, tEnd].
 * Continuity (the sign tracking in buildFrame) is what makes loops and
 * corkscrews come out smooth.
 */
export function trackFrames(
  path: PathFn, entry: GridState, segments: number, tStart = 0, tEnd = 1,
): TrackFrame[] {
  const frames: TrackFrame[] = [];
  let prevSide: Vec3 | null = null;
  for (let i = 0; i <= segments; i++) {
    const t = tStart + (tEnd - tStart) * (i / segments);
    const f = buildFrame(path, entry, t, prevSide);
    frames.push(f);
    prevSide = f.side;
  }
  return frames;
}

/**
 * Frame at a single parameter t. Builds the continuous sequence (so the sign
 * tracking is applied) and interpolates at t, taking the exact centreline
 * position from the path. Used by the simulator to place the car each frame.
 */
export function trackFrameAt(path: PathFn, entry: GridState, t: number, segments = 48): TrackFrame {
  const frames = trackFrames(path, entry, segments, 0, 1);
  const clamped = Math.min(Math.max(t, 0), 1);
  const x = clamped * segments;
  const i = Math.min(Math.floor(x), segments - 1);
  const f = x - i;
  const a = frames[i];
  const b = frames[i + 1];

  const h = piecePathAtT(path, entry, clamped);
  const pos: Vec3 = { x: h.wx, y: h.wy, z: h.wz };
  const tangent = normalize(lerp(a.tangent, b.tangent, f));
  let up = normalize(lerp(a.up, b.up, f));
  up = normalize(sub(up, scale(tangent, dot(up, tangent)))); // re-orthogonalise vs tangent
  const side = normalize(cross(tangent, up));
  return { pos, tangent, up, side, banking: h.banking };
}
