// renderer/meshes.ts — mesh builders for each track piece, the ghost preview,
// and the start tower. The track itself is built as TubeGeometry along each
// piece's parametric path, so loops/corkscrews/jumps come out correctly in 3D.

import * as THREE from 'three';
import { piecePathAtT, samplePiecePath } from '../pieces/sampling.js';
import { COLORS } from './colors.js';
import type { GridState, Piece, WorldPoint } from '../types.js';

interface TubeOpts {
  segments?: number;
  tubularSegments?: number;
  radius?: number;
  emissive?: number;
  emissiveIntensity?: number;
}

/** Grid (gx, gy, gz) → Three.js (x, y=up, z) since Three uses y-up. */
function v3(p: WorldPoint): THREE.Vector3 { return new THREE.Vector3(p.wx, p.wz, p.wy); }

// ---------- Track tubes ----------

function buildCenterTube(piece: Piece, entry: GridState, color: number, opts: TubeOpts = {}): THREE.Mesh {
  const samples = samplePiecePath(piece, entry, opts.segments ?? 36);
  const points = samples.map(v3);
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.0);
  const tube = new THREE.TubeGeometry(curve, opts.tubularSegments ?? 48, opts.radius ?? 0.16, 10, false);
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.25,
    roughness: 0.55,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const mesh = new THREE.Mesh(tube, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Twin-rail look: a thin centre tube plus two rail tubes offset to either side
 * of the path. Banking is honoured for corkscrews so the rails twist with the car.
 */
export function buildRailedTrack(piece: Piece, entry: GridState, color: number, opts: TubeOpts = {}): THREE.Group {
  const group = new THREE.Group();
  group.add(buildCenterTube(piece, entry, color, { ...opts, radius: 0.04 }));

  const segments = opts.segments ?? 28;
  const railOffset = 0.18;
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const here = piecePathAtT(piece, entry, t);

    const tNext = Math.min(t + 0.005, 1);
    const tPrev = Math.max(t - 0.005, 0);
    const a = piecePathAtT(piece, entry, tPrev);
    const b = piecePathAtT(piece, entry, tNext);

    const tang = new THREE.Vector3(b.wx - a.wx, b.wz - a.wz, b.wy - a.wy);
    if (tang.lengthSq() < 1e-8) tang.set(1, 0, 0);
    tang.normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(tang, worldUp);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1); // tangent vertical (e.g. side of loop)
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, tang).normalize();

    if (here.banking) {
      const q = new THREE.Quaternion().setFromAxisAngle(tang, here.banking);
      side.applyQuaternion(q);
      up.applyQuaternion(q);
    }

    const c = new THREE.Vector3(here.wx, here.wz, here.wy);
    left.push(c.clone().add(side.clone().multiplyScalar(-railOffset)));
    right.push(c.clone().add(side.clone().multiplyScalar(railOffset)));
  }

  const railMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.4,
    roughness: 0.4,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const leftRail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(left), 48, 0.05, 8, false),
    railMat,
  );
  const rightRail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(right), 48, 0.05, 8, false),
    railMat,
  );
  leftRail.castShadow = rightRail.castShadow = true;
  group.add(leftRail, rightRail);
  return group;
}

// ---------- Special pieces ----------

function buildBoosterPiece(piece: Piece, entry: GridState): THREE.Group {
  const group = buildRailedTrack(piece, entry, COLORS.booster, {
    emissive: COLORS.boosterEm,
    emissiveIntensity: 0.6,
  });
  // Glowing chevrons on top.
  const samples = samplePiecePath(piece, entry, 6);
  const arrowMat = new THREE.MeshStandardMaterial({
    color: COLORS.boosterArrow,
    emissive: COLORS.boosterArrowEm,
    emissiveIntensity: 0.8,
  });
  for (let i = 1; i < samples.length - 1; i += 2) {
    const s = samples[i];
    const next = samples[i + 1];
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.32, 4), arrowMat);
    arrow.position.set(s.wx, s.wz + 0.25, s.wy);
    const dir = new THREE.Vector3(next.wx - s.wx, next.wz - s.wz, next.wy - s.wy).normalize();
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(arrow);
  }
  return group;
}

function buildFinishPiece(piece: Piece, entry: GridState): THREE.Group {
  const group = buildRailedTrack(piece, entry, COLORS.trackBlue);
  const samples = samplePiecePath(piece, entry, 4);
  const start = samples[0];
  const end = samples[samples.length - 1];
  const cx = (start.wx + end.wx) / 2;
  const cy = (start.wy + end.wy) / 2;
  const cz = (start.wz + end.wz) / 2;

  const stripeMat = (c: number) => new THREE.MeshStandardMaterial({
    color: c, emissive: c, emissiveIntensity: 0.2,
  });
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.5, 0.06),
      stripeMat(i % 2 === 0 ? COLORS.finish : COLORS.finishAlt),
    );
    stripe.position.set(cx - 0.3 + i * 0.12, cz + 0.7, cy);
    group.add(stripe);
  }
  const postMat = new THREE.MeshStandardMaterial({ color: COLORS.finishPost });
  const left = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0), postMat);
  const right = left.clone();
  left.position.set(cx - 0.4, cz + 0.45, cy - 0.3);
  right.position.set(cx - 0.4, cz + 0.45, cy + 0.3);
  group.add(left, right);
  return group;
}

// ---------- Public dispatcher ----------

export function buildPieceMesh(piece: Piece, entry: GridState): THREE.Group {
  if (piece.id === 'BOOSTER') return buildBoosterPiece(piece, entry);
  if (piece.id === 'FINISH') return buildFinishPiece(piece, entry);
  if (piece.id === 'LOOP' || piece.id === 'CORKSCREW') {
    return buildRailedTrack(piece, entry, COLORS.trackBlue);
  }
  if (piece.id === 'JUMP') {
    return buildRailedTrack(piece, entry, COLORS.trackOrangeBright);
  }
  return buildRailedTrack(piece, entry, COLORS.trackOrange);
}

export function buildGhostPiece(piece: Piece, entry: GridState): THREE.Mesh {
  const samples = samplePiecePath(piece, entry, 24);
  const points = samples.map(v3);
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.TubeGeometry(curve, 32, 0.18, 8, false);
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
    }),
  );
  post.position.set(state.gx - 0.5, baseHeight / 2, state.gy);
  group.add(post);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  top.position.set(state.gx - 0.5, baseHeight + 0.04, state.gy);
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
