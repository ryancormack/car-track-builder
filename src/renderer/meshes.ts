// renderer/meshes.ts — mesh builders for each track piece, the ghost preview,
// and the start tower. The track itself is built as TubeGeometry along each
// piece's parametric path, so loops/corkscrews/jumps come out correctly in 3D.

import * as THREE from 'three';
import { piecePathAtT } from '../pieces/sampling.js';
import { COLORS } from './colors.js';
import type { GridState, Piece, WorldSample } from '../types.js';

interface TubeOpts {
  segments?: number;
  tubularSegments?: number;
  radius?: number;
  emissive?: number;
  emissiveIntensity?: number;
  /** Sample only a sub-range of the path (used for the jump's ramps). */
  tStart?: number;
  tEnd?: number;
}

/** Grid (gx, gy, gz) → Three.js (x, y=up, z) since Three uses y-up. */
function v3(p: WorldSample): THREE.Vector3 { return new THREE.Vector3(p.wx, p.wz, p.wy); }

/** Evenly-spaced world samples across a sub-range [tStart, tEnd] of the path. */
function sampleRange(piece: Piece, entry: GridState, n: number, tStart: number, tEnd: number): WorldSample[] {
  const out: WorldSample[] = [];
  for (let i = 0; i <= n; i++) {
    out.push(piecePathAtT(piece, entry, tStart + (tEnd - tStart) * (i / n)));
  }
  return out;
}

/** Orthonormal frame (tangent, up, side) at parameter t, honouring banking. */
function frameAt(piece: Piece, entry: GridState, t: number) {
  const here = piecePathAtT(piece, entry, t);
  const a = piecePathAtT(piece, entry, Math.max(t - 0.005, 0));
  const b = piecePathAtT(piece, entry, Math.min(t + 0.005, 1));

  const tang = new THREE.Vector3(b.wx - a.wx, b.wz - a.wz, b.wy - a.wy);
  if (tang.lengthSq() < 1e-8) tang.set(1, 0, 0);
  tang.normalize();

  const side = new THREE.Vector3().crossVectors(tang, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1); // tangent vertical (e.g. side of loop)
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, tang).normalize();

  if (here.banking) {
    const q = new THREE.Quaternion().setFromAxisAngle(tang, here.banking);
    side.applyQuaternion(q);
    up.applyQuaternion(q);
  }
  return { pos: new THREE.Vector3(here.wx, here.wz, here.wy), tang, up, side };
}

// ---------- Track tubes ----------

function buildCenterTube(piece: Piece, entry: GridState, color: number, opts: TubeOpts = {}): THREE.Mesh {
  const samples = sampleRange(piece, entry, opts.segments ?? 48, opts.tStart ?? 0, opts.tEnd ?? 1);
  const curve = new THREE.CatmullRomCurve3(samples.map(v3), false, 'catmullrom', 0.0);
  const tube = new THREE.TubeGeometry(curve, opts.tubularSegments ?? 64, opts.radius ?? 0.05, 12, false);
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.35,
    roughness: 0.45,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const mesh = new THREE.Mesh(tube, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Twin-rail look: a thin centre tube plus two glossy rail tubes offset to either
 * side of the path. Banking is honoured for corkscrews so the rails twist with
 * the car. Can render a sub-range of the path via opts.tStart / opts.tEnd.
 */
export function buildRailedTrack(piece: Piece, entry: GridState, color: number, opts: TubeOpts = {}): THREE.Group {
  const tStart = opts.tStart ?? 0;
  const tEnd = opts.tEnd ?? 1;
  const group = new THREE.Group();
  group.add(buildCenterTube(piece, entry, color, { ...opts, radius: 0.045 }));

  const segments = opts.segments ?? 44;
  const railOffset = 0.18;
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = tStart + (tEnd - tStart) * (i / segments);
    const { pos, side } = frameAt(piece, entry, t);
    left.push(pos.clone().addScaledVector(side, -railOffset));
    right.push(pos.clone().addScaledVector(side, railOffset));
  }

  const railMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.28,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: (opts.emissiveIntensity ?? 0) * 0.8,
  });
  const leftRail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(left), 64, 0.055, 12, false), railMat,
  );
  const rightRail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(right), 64, 0.055, 12, false), railMat,
  );
  leftRail.castShadow = rightRail.castShadow = true;
  group.add(leftRail, rightRail);
  return group;
}

// ---------- Special pieces ----------

function buildBoosterPiece(piece: Piece, entry: GridState): THREE.Group {
  const group = buildRailedTrack(piece, entry, COLORS.booster, {
    emissive: COLORS.boosterEm,
    emissiveIntensity: 0.7,
  });
  // Glowing chevrons on top.
  const arrowMat = new THREE.MeshStandardMaterial({
    color: COLORS.boosterArrow,
    emissive: COLORS.boosterArrowEm,
    emissiveIntensity: 0.9,
    metalness: 0.2,
    roughness: 0.4,
  });
  for (const t of [0.25, 0.5, 0.75]) {
    const { pos, tang } = frameAt(piece, entry, t);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), arrowMat);
    arrow.position.copy(pos).addScaledVector(new THREE.Vector3(0, 1, 0), 0.24);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tang);
    arrow.castShadow = true;
    group.add(arrow);
  }
  return group;
}

/** A small glowing cross-bar marking the take-off / landing edge of a jump. */
function buildJumpLip(piece: Piece, entry: GridState, t: number): THREE.Mesh {
  const { pos, tang, up, side } = frameAt(piece, entry, t);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.jumpLip,
    emissive: COLORS.jumpLipEm,
    emissiveIntensity: 0.7,
    metalness: 0.3,
    roughness: 0.4,
  });
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.52), mat);
  lip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tang, up, side));
  lip.position.copy(pos).addScaledVector(up, 0.05);
  lip.castShadow = true;
  return lip;
}

function buildJumpPiece(piece: Piece, entry: GridState): THREE.Group {
  const group = new THREE.Group();
  const color = COLORS.trackOrangeBright;
  // Take-off ramp + landing ramp, leaving a visible gap (no track) in between.
  group.add(buildRailedTrack(piece, entry, color, { tStart: 0, tEnd: 0.32, segments: 14 }));
  group.add(buildRailedTrack(piece, entry, color, { tStart: 0.68, tEnd: 1, segments: 14 }));
  group.add(buildJumpLip(piece, entry, 0.32));
  group.add(buildJumpLip(piece, entry, 0.68));
  return group;
}

function buildFinishPiece(piece: Piece, entry: GridState): THREE.Group {
  const group = buildRailedTrack(piece, entry, COLORS.trackBlue);
  const start = piecePathAtT(piece, entry, 0);
  const end = piecePathAtT(piece, entry, 1);
  const cx = (start.wx + end.wx) / 2;
  const cy = (start.wy + end.wy) / 2;
  const cz = (start.wz + end.wz) / 2;

  const stripeMat = (c: number) => new THREE.MeshStandardMaterial({
    color: c, emissive: c, emissiveIntensity: 0.2, roughness: 0.5,
  });
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.5, 0.06),
      stripeMat(i % 2 === 0 ? COLORS.finish : COLORS.finishAlt),
    );
    stripe.position.set(cx - 0.3 + i * 0.12, cz + 0.7, cy);
    stripe.castShadow = true;
    group.add(stripe);
  }
  const postMat = new THREE.MeshStandardMaterial({ color: COLORS.finishPost, metalness: 0.4, roughness: 0.4 });
  const left = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 12), postMat);
  const right = left.clone();
  left.position.set(cx - 0.4, cz + 0.45, cy - 0.3);
  right.position.set(cx - 0.4, cz + 0.45, cy + 0.3);
  left.castShadow = right.castShadow = true;
  group.add(left, right);
  return group;
}

// ---------- Public dispatcher ----------

export function buildPieceMesh(piece: Piece, entry: GridState): THREE.Group {
  if (piece.id === 'BOOSTER') return buildBoosterPiece(piece, entry);
  if (piece.id === 'FINISH') return buildFinishPiece(piece, entry);
  if (piece.id === 'JUMP') return buildJumpPiece(piece, entry);
  if (piece.id === 'LOOP' || piece.id === 'CORKSCREW') {
    return buildRailedTrack(piece, entry, COLORS.trackBlue, {
      emissive: COLORS.trackBlue,
      emissiveIntensity: 0.12,
      segments: 64,
    });
  }
  return buildRailedTrack(piece, entry, COLORS.trackOrange);
}

export function buildGhostPiece(piece: Piece, entry: GridState): THREE.Mesh {
  const samples = sampleRange(piece, entry, 28, 0, 1);
  const curve = new THREE.CatmullRomCurve3(samples.map(v3));
  const tube = new THREE.TubeGeometry(curve, 40, 0.16, 10, false);
  const mat = new THREE.MeshBasicMaterial({
    color: COLORS.ghost,
    transparent: true,
    opacity: 0.4,
  });
  return new THREE.Mesh(tube, mat);
}

export function buildStartTower(state: GridState, dropHeight: number): THREE.Group {
  const group = new THREE.Group();
  const baseHeight = Math.max(0.05, dropHeight);
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, baseHeight, 0.4),
    new THREE.MeshStandardMaterial({
      color: COLORS.start, emissive: COLORS.startEm, emissiveIntensity: 0.5,
      metalness: 0.3, roughness: 0.5,
    }),
  );
  post.position.set(state.gx - 0.5, baseHeight / 2, state.gy);
  post.castShadow = true;
  group.add(post);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.4 }),
  );
  top.position.set(state.gx - 0.5, baseHeight + 0.04, state.gy);
  top.castShadow = true;
  group.add(top);

  const ring = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.08, 0.45),
    new THREE.MeshStandardMaterial({
      color: COLORS.trackOrange,
      emissive: COLORS.trackOrange,
      emissiveIntensity: 0.4,
    }),
  );
  ring.position.set(state.gx - 0.5, 0.04, state.gy);
  group.add(ring);
  return group;
}
