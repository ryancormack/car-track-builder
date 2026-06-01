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

function buildFrame(path: PathFn, entry: GridState, t: number, prevSide: Vec3 | null, prevBanking: number): TrackFrame {
  const h = piecePathAtT(path, entry, t);
  const pos: Vec3 = { x: h.wx, y: h.wy, z: h.wz };
  const tangent = tangentAt(path, entry, t);

  // Compute the side vector by rotating the natural (unbanked) reference frame
  // around the tangent axis by the banking angle. The natural frame uses
  // world-up projected perpendicular to the tangent (Gram-Schmidt). This avoids
  // the degeneracy of cross(tangent, normal) when the tangent aligns with the
  // banking-derived normal, which occurs in multi-rotation helical paths like
  // the spiral where the tangent has significant yz components.
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 };
  let naturalUp = sub(worldUp, scale(tangent, dot(worldUp, tangent)));
  const nuMagSq = lenSq(naturalUp);

  if (nuMagSq < 1e-8) {
    // Tangent is vertical (loop apex). Use previous side to derive the up.
    naturalUp = prevSide ? normalize(cross(tangent, prevSide)) : { x: 0, y: 1, z: 0 };
  } else {
    naturalUp = normalize(naturalUp);
  }

  const naturalSide = normalize(cross(tangent, naturalUp));

  // Rotate the natural side by the banking angle around the tangent.
  const cb = Math.cos(h.banking);
  const sb = Math.sin(h.banking);
  let side: Vec3 = normalize({
    x: naturalSide.x * cb + naturalUp.x * sb,
    y: naturalSide.y * cb + naturalUp.y * sb,
    z: naturalSide.z * cb + naturalUp.z * sb,
  });

  // Only apply sign-continuity for pieces without banking (like the loop).
  // For pieces with progressive banking (corkscrew, spiral, helix), the
  // Rodrigues rotation is authoritative and sign-flipping would fight it.
  const bankingActive = Math.abs(h.banking) > 0.01 || Math.abs(prevBanking) > 0.01;
  if (prevSide && !bankingActive && dot(side, prevSide) < 0) side = scale(side, -1);

  const up = normalize(cross(side, tangent));
  return { pos, tangent, up, side, banking: h.banking };
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
  let prevBanking = 0;
  for (let i = 0; i <= segments; i++) {
    const t = tStart + (tEnd - tStart) * (i / segments);
    const f = buildFrame(path, entry, t, prevSide, prevBanking);
    frames.push(f);
    prevSide = f.side;
    prevBanking = f.banking;
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
