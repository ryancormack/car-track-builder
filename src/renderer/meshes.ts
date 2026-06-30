// renderer/meshes.ts -- mesh builders for each track piece, the ghost preview,
// and the start tower. Track pieces are rendered as a solid road surface with
// semi-transparent edge barriers and a centre lane marking.

import * as THREE from 'three';
import { piecePathAtT } from '../pieces/sampling.js';
import { trackFrames } from '../pieces/frames.js';
import { COLORS } from './colors.js';
import type { GridState, PathFn, Piece, WorldSample } from '../types.js';

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

/** Grid (gx, gy, gz) -> Three.js (x, y=up, z) since Three uses y-up. */
function v3(p: WorldSample): THREE.Vector3 { return new THREE.Vector3(p.wx, p.wz, p.wy); }

/** Evenly-spaced world samples across a sub-range [tStart, tEnd] of the path. */
function sampleRange(path: PathFn, entry: GridState, n: number, tStart: number, tEnd: number): WorldSample[] {
  const out: WorldSample[] = [];
  for (let i = 0; i <= n; i++) {
    out.push(piecePathAtT(path, entry, tStart + (tEnd - tStart) * (i / n)));
  }
  return out;
}

/** Orthonormal frame (tangent, up, side) at parameter t, honouring banking. */
function frameAt(path: PathFn, entry: GridState, t: number) {
  const here = piecePathAtT(path, entry, t);
  const a = piecePathAtT(path, entry, Math.max(t - 0.005, 0));
  const b = piecePathAtT(path, entry, Math.min(t + 0.005, 1));

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

// ---------- Road surface geometry helpers ----------

/**
 * Build a ribbon (quad-strip) BufferGeometry from an array of frame pairs
 * (left vertex, right vertex). Optionally also generates a matching set of
 * normals from the frame 'up' vectors.
 */
function buildRibbonGeometry(
  leftVerts: THREE.Vector3[],
  rightVerts: THREE.Vector3[],
  normals: THREE.Vector3[],
): THREE.BufferGeometry {
  const n = leftVerts.length; // number of cross-sections
  const positions: number[] = [];
  const norms: number[] = [];
  const indices: number[] = [];

  // Two vertices per cross-section: index 2*i = left, 2*i+1 = right
  for (let i = 0; i < n; i++) {
    const l = leftVerts[i];
    const r = rightVerts[i];
    const nm = normals[i];
    positions.push(l.x, l.y, l.z);
    norms.push(nm.x, nm.y, nm.z);
    positions.push(r.x, r.y, r.z);
    norms.push(nm.x, nm.y, nm.z);
  }

  // Connect adjacent cross-sections into quads (two triangles each)
  for (let i = 0; i < n - 1; i++) {
    const bl = i * 2;
    const br = i * 2 + 1;
    const tl = (i + 1) * 2;
    const tr = (i + 1) * 2 + 1;
    // Triangle 1
    indices.push(bl, tl, br);
    // Triangle 2
    indices.push(br, tl, tr);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geom.setIndex(indices);
  return geom;
}

/**
 * Build a wall strip geometry. For each cross-section, the wall goes from a
 * base vertex upward along the up direction by the given height.
 */
function buildWallGeometry(
  baseVerts: THREE.Vector3[],
  upVecs: THREE.Vector3[],
  height: number,
  outwardNormals: THREE.Vector3[],
): THREE.BufferGeometry {
  const n = baseVerts.length;
  const positions: number[] = [];
  const norms: number[] = [];
  const indices: number[] = [];

  // Two vertices per cross-section: bottom and top
  for (let i = 0; i < n; i++) {
    const base = baseVerts[i];
    const up = upVecs[i];
    const top = base.clone().addScaledVector(up, height);
    const nm = outwardNormals[i];

    positions.push(base.x, base.y, base.z);
    norms.push(nm.x, nm.y, nm.z);
    positions.push(top.x, top.y, top.z);
    norms.push(nm.x, nm.y, nm.z);
  }

  for (let i = 0; i < n - 1; i++) {
    const bl = i * 2;
    const bt = i * 2 + 1;
    const nl = (i + 1) * 2;
    const nt = (i + 1) * 2 + 1;
    indices.push(bl, nl, bt);
    indices.push(bt, nl, nt);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geom.setIndex(indices);
  return geom;
}

// ---------- Road track builder ----------

/**
 * Solid road surface with semi-transparent edge barriers and a centre lane
 * marking. Replaces the former 3-tube rail approach. The road banks with the
 * track through loops and corkscrews using the trackFrames() basis.
 *
 * Function signature is unchanged for compatibility with all callers.
 */
export function buildRailedTrack(path: PathFn, entry: GridState, color: number, opts: TubeOpts = {}): THREE.Group {
  const tStart = opts.tStart ?? 0;
  const tEnd = opts.tEnd ?? 1;
  const segments = opts.segments ?? 48;
  const group = new THREE.Group();

  const halfWidth = 0.22;
  const barrierHeight = 0.12;
  const centerLineHalfWidth = 0.012;
  const centerLineRaise = 0.005;

  // Gather frame data
  const frames = trackFrames(path, entry, segments, tStart, tEnd);

  const leftVerts: THREE.Vector3[] = [];
  const rightVerts: THREE.Vector3[] = [];
  const upVecs: THREE.Vector3[] = [];
  const sideVecs: THREE.Vector3[] = [];
  const centerVerts: THREE.Vector3[] = [];

  for (const f of frames) {
    const pos = new THREE.Vector3(f.pos.x, f.pos.z, f.pos.y);
    const side = new THREE.Vector3(f.side.x, f.side.z, f.side.y);
    const up = new THREE.Vector3(f.up.x, f.up.z, f.up.y);

    leftVerts.push(pos.clone().addScaledVector(side, -halfWidth));
    rightVerts.push(pos.clone().addScaledVector(side, halfWidth));
    upVecs.push(up.clone());
    sideVecs.push(side.clone());
    centerVerts.push(pos.clone().addScaledVector(up, centerLineRaise));
  }

  // --- Road surface ---
  // DoubleSide so the road stays visible where the track banks past vertical
  // (loops, corkscrews); otherwise the back faces get culled and the surface
  // appears to vanish through those sections.
  const roadGeom = buildRibbonGeometry(leftVerts, rightVerts, upVecs);
  const roadMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.15,
    roughness: 0.72,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    side: THREE.DoubleSide,
  });
  const roadMesh = new THREE.Mesh(roadGeom, roadMat);
  roadMesh.castShadow = true;
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // --- Edge barriers (semi-transparent walls) ---
  const barrierMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.3,
    roughness: 0.5,
    transparent: true,
    opacity: 0.35,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: (opts.emissiveIntensity ?? 0) * 0.5,
    side: THREE.DoubleSide,
  });

  // Left wall: outward normal is -side
  const leftOutNormals = sideVecs.map(s => s.clone().negate());
  const leftWallGeom = buildWallGeometry(leftVerts, upVecs, barrierHeight, leftOutNormals);
  const leftWall = new THREE.Mesh(leftWallGeom, barrierMat);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;
  group.add(leftWall);

  // Right wall: outward normal is +side
  const rightWallGeom = buildWallGeometry(rightVerts, upVecs, barrierHeight, sideVecs);
  const rightWall = new THREE.Mesh(rightWallGeom, barrierMat);
  rightWall.castShadow = true;
  rightWall.receiveShadow = true;
  group.add(rightWall);

  // --- Centre lane marking ---
  const centerLeft: THREE.Vector3[] = [];
  const centerRight: THREE.Vector3[] = [];
  for (let i = 0; i < centerVerts.length; i++) {
    const s = sideVecs[i];
    centerLeft.push(centerVerts[i].clone().addScaledVector(s, -centerLineHalfWidth));
    centerRight.push(centerVerts[i].clone().addScaledVector(s, centerLineHalfWidth));
  }
  const centerGeom = buildRibbonGeometry(centerLeft, centerRight, upVecs);
  const centerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.6,
    emissive: 0xffffff,
    emissiveIntensity: 0.15,
    side: THREE.DoubleSide,
  });
  const centerMesh = new THREE.Mesh(centerGeom, centerMat);
  centerMesh.castShadow = false;
  centerMesh.receiveShadow = true;
  group.add(centerMesh);

  return group;
}

// ---------- Special pieces ----------

function buildBoosterPiece(path: PathFn, entry: GridState): THREE.Group {
  const group = buildRailedTrack(path, entry, COLORS.booster, {
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
    const { pos, tang } = frameAt(path, entry, t);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), arrowMat);
    arrow.position.copy(pos).addScaledVector(new THREE.Vector3(0, 1, 0), 0.24);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tang);
    arrow.castShadow = true;
    group.add(arrow);
  }
  return group;
}

function buildBrakePiece(path: PathFn, entry: GridState): THREE.Group {
  const group = buildRailedTrack(path, entry, COLORS.brake, {
    emissive: COLORS.brakeEm,
    emissiveIntensity: 0.7,
  });
  // Backward-facing red chevrons (pointing against the direction of travel).
  const arrowMat = new THREE.MeshStandardMaterial({
    color: COLORS.brakeArrow,
    emissive: COLORS.brakeArrowEm,
    emissiveIntensity: 0.9,
    metalness: 0.2,
    roughness: 0.4,
  });
  for (const t of [0.25, 0.5, 0.75]) {
    const { pos, tang } = frameAt(path, entry, t);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), arrowMat);
    arrow.position.copy(pos).addScaledVector(new THREE.Vector3(0, 1, 0), 0.24);
    // Point backward (against travel direction)
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tang.clone().negate());
    arrow.castShadow = true;
    group.add(arrow);
  }
  return group;
}

function buildGiantJumpPiece(path: PathFn, entry: GridState): THREE.Group {
  const group = new THREE.Group();
  const color = COLORS.trackOrangeBright;
  // Take-off ramp + landing ramp, leaving a visible gap (no track) in between.
  group.add(buildRailedTrack(path, entry, color, { tStart: 0, tEnd: 0.25, segments: 14 }));
  group.add(buildRailedTrack(path, entry, color, { tStart: 0.75, tEnd: 1, segments: 14 }));
  group.add(buildJumpLip(path, entry, 0.25));
  group.add(buildJumpLip(path, entry, 0.75));
  return group;
}

/** A small glowing cross-bar marking the take-off / landing edge of a jump. */
function buildJumpLip(path: PathFn, entry: GridState, t: number): THREE.Mesh {
  const { pos, tang, up, side } = frameAt(path, entry, t);
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

function buildJumpPiece(path: PathFn, entry: GridState): THREE.Group {
  const group = new THREE.Group();
  const color = COLORS.trackOrangeBright;
  // Take-off ramp + landing ramp, leaving a visible gap (no track) in between.
  group.add(buildRailedTrack(path, entry, color, { tStart: 0, tEnd: 0.32, segments: 14 }));
  group.add(buildRailedTrack(path, entry, color, { tStart: 0.68, tEnd: 1, segments: 14 }));
  group.add(buildJumpLip(path, entry, 0.32));
  group.add(buildJumpLip(path, entry, 0.68));
  return group;
}

function buildFinishPiece(path: PathFn, entry: GridState): THREE.Group {
  const group = buildRailedTrack(path, entry, COLORS.trackBlue);
  const start = piecePathAtT(path, entry, 0);
  const end = piecePathAtT(path, entry, 1);
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

// ---------- Smash Wall ----------

/**
 * The Smash Wall: normal road plus a breakable brick barrier standing across
 * the track at its midpoint. The barrier is a sub-group named 'wall' (so the
 * renderer can find and shatter it on a successful smash); its world centre is
 * cached on `userData.wallCenter` for spawning debris. Bricks are individual
 * boxes so the wall reads as breakable.
 */
function buildWallPiece(path: PathFn, entry: GridState): THREE.Group {
  const group = buildRailedTrack(path, entry, COLORS.wall, {
    emissive: COLORS.wallEm,
    emissiveIntensity: 0.15,
  });

  const { pos, tang, up, side } = frameAt(path, entry, 0.5);
  const wall = new THREE.Group();
  wall.name = 'wall';

  const brickMat = new THREE.MeshStandardMaterial({
    color: COLORS.wallBrick, metalness: 0.05, roughness: 0.85,
    emissive: COLORS.wallEm, emissiveIntensity: 0.12,
  });
  const mortarMat = new THREE.MeshStandardMaterial({
    color: COLORS.wallMortar, metalness: 0.05, roughness: 0.9,
  });

  const cols = 5;
  const rows = 4;
  const totalW = 0.62;     // spans the road width + a little
  const totalH = 0.62;     // wall height
  const brickW = totalW / cols;
  const brickH = totalH / rows;
  const depth = 0.12;
  // Orientation basis: bricks face along the tangent, stack along up, run along side.
  const basis = new THREE.Matrix4().makeBasis(tang, up, side);
  const quat = new THREE.Quaternion().setFromRotationMatrix(basis);

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * brickW * 0.5; // running-bond brick stagger
    for (let c = 0; c < cols; c++) {
      const sOff = -totalW / 2 + brickW * (c + 0.5) + offset - brickW * 0.25;
      const uOff = brickH * (r + 0.5);
      const brick = new THREE.Mesh(
        new THREE.BoxGeometry(depth, brickH * 0.86, brickW * 0.86),
        (r + c) % 2 === 0 ? brickMat : mortarMat,
      );
      brick.quaternion.copy(quat);
      brick.position.copy(pos)
        .addScaledVector(side, sOff)
        .addScaledVector(up, uOff);
      brick.castShadow = true;
      brick.receiveShadow = true;
      wall.add(brick);
    }
  }

  // Cache the wall centre (world space) for debris spawning on smash.
  wall.userData.wallCenter = pos.clone().addScaledVector(up, totalH / 2);
  group.add(wall);
  return group;
}

// ---------- Ring of Fire (decoration) ----------

/** Animatable handles for a ring-of-fire decoration, consumed by the renderer. */
export interface FireRingHandle {
  group: THREE.Group;
  /** Per-flame { mesh, base scale, animation phase } for the flicker loop. */
  flames: { mesh: THREE.Mesh; baseScale: number; phase: number }[];
  /** Emissive materials to pulse. */
  glowMats: THREE.MeshStandardMaterial[];
}

/**
 * A ring of fire encircling the track at the piece midpoint — the car drives
 * straight through the hole. Returns the group plus handles the renderer
 * animates each frame (flickering flames + pulsing glow). Purely decorative.
 */
export function buildRingOfFire(path: PathFn, entry: GridState): FireRingHandle {
  const { pos, tang, up } = frameAt(path, entry, 0.5);
  const group = new THREE.Group();
  const flames: FireRingHandle['flames'] = [];
  const glowMats: THREE.MeshStandardMaterial[] = [];

  const ringRadius = 0.52;   // clears the ~0.44-wide road + the car
  const tubeRadius = 0.07;
  // Centre the ring above the road so the hole surrounds the passing car.
  const centre = pos.clone().addScaledVector(up, ringRadius - 0.04);

  // Orient the torus so its hole axis points along the track tangent.
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tang.clone().normalize());

  // Charred ring body.
  const ringMat = new THREE.MeshStandardMaterial({
    color: COLORS.fireRing, metalness: 0.2, roughness: 0.8,
    emissive: COLORS.fireFlameEm, emissiveIntensity: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringRadius, tubeRadius, 10, 36), ringMat);
  ring.position.copy(centre);
  ring.quaternion.copy(quat);
  group.add(ring);
  glowMats.push(ringMat);

  // Flame tongues spaced around the ring, pointing radially outward and licking
  // upward. Each gets a phase so they flicker out of sync.
  const flameCount = 14;
  // Two in-plane axes perpendicular to the tangent (the ring's own plane).
  const planeX = new THREE.Vector3(1, 0, 0).applyQuaternion(quat).normalize();
  const planeY = new THREE.Vector3(0, 1, 0).applyQuaternion(quat).normalize();
  for (let i = 0; i < flameCount; i++) {
    const ang = (i / flameCount) * Math.PI * 2;
    const dir = planeX.clone().multiplyScalar(Math.cos(ang)).addScaledVector(planeY, Math.sin(ang)).normalize();
    const hot = i % 3 === 0;
    const flameMat = new THREE.MeshStandardMaterial({
      color: hot ? COLORS.fireFlameHot : COLORS.fireFlame,
      emissive: hot ? COLORS.fireFlameHot : COLORS.fireFlameEm,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.92,
      roughness: 0.6,
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 6), flameMat);
    // Base of the cone sits on the ring; tip licks outward + up.
    const lickDir = dir.clone().addScaledVector(up, 0.55).normalize();
    flame.position.copy(centre).addScaledVector(dir, ringRadius);
    flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lickDir);
    group.add(flame);
    flames.push({ mesh: flame, baseScale: 0.8 + Math.random() * 0.5, phase: Math.random() * Math.PI * 2 });
    glowMats.push(flameMat);
  }

  return { group, flames, glowMats };
}

// ---------- Water Splash (decoration) ----------

/** Animatable handles for a water-splash decoration, consumed by the renderer. */
export interface WaterSplashHandle {
  group: THREE.Group;
  /** World centre of the puddle (for spawning a splash burst as the car passes). */
  center: THREE.Vector3;
  /** Road "up" at the puddle (splash direction). */
  up: THREE.Vector3;
  /** Expanding ripple rings. */
  ripples: { mesh: THREE.Mesh; phase: number }[];
  /** Bobbing spray droplets. */
  droplets: { mesh: THREE.Mesh; baseScale: number; phase: number }[];
  /** The puddle material (its sheen is pulsed). */
  poolMat: THREE.MeshStandardMaterial;
}

/**
 * A shallow water puddle lying on the road that the car drives through. Returns
 * the group plus handles the renderer animates each frame (expanding ripples +
 * bobbing droplets) and uses to fire a splash burst as the car passes. Purely
 * decorative.
 */
export function buildWaterSplash(path: PathFn, entry: GridState): WaterSplashHandle {
  const { pos, up } = frameAt(path, entry, 0.5);
  const group = new THREE.Group();
  const upN = up.clone().normalize();
  const center = pos.clone().addScaledVector(upN, 0.03);
  // A flat geometry's local +z normal is laid onto the road by aligning to up.
  const flat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), upN);

  // Shallow puddle disc.
  const poolMat = new THREE.MeshStandardMaterial({
    color: COLORS.waterPool, transparent: true, opacity: 0.62,
    emissive: COLORS.waterPoolEm, emissiveIntensity: 0.3, roughness: 0.18, metalness: 0.35,
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.5, 28), poolMat);
  pool.quaternion.copy(flat);
  pool.position.copy(center);
  group.add(pool);

  // Expanding ripple rings (thin tori lying flat on the puddle).
  const ripples: WaterSplashHandle['ripples'] = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.waterRipple, emissive: COLORS.waterRipple, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.6, roughness: 0.3,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 28), mat);
    ring.quaternion.copy(flat);
    ring.position.copy(center).addScaledVector(upN, 0.012);
    group.add(ring);
    ripples.push({ mesh: ring, phase: i / 3 });
  }

  // A few spray droplets that bob just above the puddle.
  const droplets: WaterSplashHandle['droplets'] = [];
  const dropMat = new THREE.MeshStandardMaterial({
    color: COLORS.waterDroplet, emissive: COLORS.waterDroplet, emissiveIntensity: 0.4,
    transparent: true, opacity: 0.85, roughness: 0.2,
  });
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), dropMat.clone());
    const ang = (i / 7) * Math.PI * 2;
    const r = 0.18 + Math.random() * 0.22;
    // Offset around the puddle in the road plane, then raised along up.
    const offset = new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, 0).applyQuaternion(flat);
    d.position.copy(center).add(offset).addScaledVector(upN, 0.1 + Math.random() * 0.1);
    group.add(d);
    droplets.push({ mesh: d, baseScale: 0.7 + Math.random() * 0.6, phase: Math.random() * Math.PI * 2 });
  }

  return { group, center, up: upN, ripples, droplets, poolMat };
}

// ---------- Public dispatcher ----------
export function buildPieceMesh(piece: Piece, entry: GridState, path: PathFn): THREE.Group {
  if (piece.id === 'BOOSTER') return buildBoosterPiece(path, entry);
  if (piece.id === 'BRAKE') return buildBrakePiece(path, entry);
  if (piece.id === 'FINISH') return buildFinishPiece(path, entry);
  if (piece.id === 'JUMP') return buildJumpPiece(path, entry);
  if (piece.id === 'GIANT_JUMP') return buildGiantJumpPiece(path, entry);
  if (piece.id === 'WALL') return buildWallPiece(path, entry);
  if (piece.id === 'TOP_HAT') {
    return buildRailedTrack(path, entry, COLORS.trackOrange, {
      emissive: COLORS.trackOrange, emissiveIntensity: 0.1, segments: 200,
    });
  }
  if (piece.id === 'STEEP_RAMP_UP' || piece.id === 'STEEP_RAMP_DN') {
    return buildRailedTrack(path, entry, COLORS.trackOrangeBright, { segments: 40 });
  }
  if (piece.id === 'WIDE_L_2' || piece.id === 'WIDE_R_2') {
    return buildRailedTrack(path, entry, COLORS.trackOrange, { segments: 48 });
  }
  if (piece.id === 'WIDE_L_3' || piece.id === 'WIDE_R_3') {
    return buildRailedTrack(path, entry, COLORS.trackOrange, { segments: 64 });
  }
  if (piece.id === 'SPIRAL') {
    return buildRailedTrack(path, entry, COLORS.trackBlue, {
      emissive: COLORS.trackBlue,
      emissiveIntensity: 0.12,
      segments: 192,
    });
  }
  if (piece.id === 'STEEP_HILL') {
    return buildRailedTrack(path, entry, COLORS.trackOrangeBright, {
      segments: 64,
    });
  }
  if (piece.id === 'HELIX_UP' || piece.id === 'HELIX_DN') {
    return buildRailedTrack(path, entry, COLORS.trackBlue, {
      emissive: COLORS.trackBlue,
      emissiveIntensity: 0.12,
      segments: 256,
    });
  }
  if (piece.id === 'SPIRAL_TOWER') {
    return buildRailedTrack(path, entry, COLORS.trackBlue, {
      emissive: COLORS.trackBlue,
      emissiveIntensity: 0.12,
      segments: 256,
    });
  }
  if (piece.id === 'GIANT_LOOP') {
    return buildRailedTrack(path, entry, COLORS.trackBlue, {
      emissive: COLORS.trackBlue,
      emissiveIntensity: 0.12,
      segments: 128,
    });
  }
  if (piece.id === 'LOOP' || piece.id === 'CORKSCREW') {
    return buildRailedTrack(path, entry, COLORS.trackBlue, {
      emissive: COLORS.trackBlue,
      emissiveIntensity: 0.12,
      segments: 64,
    });
  }
  return buildRailedTrack(path, entry, COLORS.trackOrange);
}

export function buildGhostPiece(path: PathFn, entry: GridState): THREE.Mesh {
  const samples = sampleRange(path, entry, 28, 0, 1);
  const curve = new THREE.CatmullRomCurve3(samples.map(v3));
  const tube = new THREE.TubeGeometry(curve, 40, 0.16, 10, false);
  const mat = new THREE.MeshBasicMaterial({
    color: COLORS.ghost,
    transparent: true,
    opacity: 0.4,
  });
  return new THREE.Mesh(tube, mat);
}

/**
 * An emptied slot ("gap"): the road's footprint is preserved (so downstream
 * geometry doesn't move) but it's drawn as a faint, see-through placeholder the
 * player can click to fill with a new piece. Uses standard materials so the
 * selection highlight (emissive bump) still works.
 */
export function buildGapPiece(path: PathFn, entry: GridState): THREE.Group {
  const group = buildRailedTrack(path, entry, COLORS.gap, { segments: 32 });
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mat = mesh.material;
    if (!mat || Array.isArray(mat)) return;
    const stdMat = mat as THREE.MeshStandardMaterial;
    stdMat.color.set(COLORS.gap);
    stdMat.emissive.set(COLORS.gap);
    stdMat.emissiveIntensity = 0.15;
    stdMat.transparent = true;
    stdMat.opacity = 0.16;
    stdMat.depthWrite = false;
  });
  return group;
}

export function buildStartTower(state: GridState, dropHeight: number): THREE.Group {
  const group = new THREE.Group();
  const baseHeight = Math.max(0.05, dropHeight);
  const baseX = state.gx - 0.5;

  // Static orange base plate sitting on the ground — the plunger compresses
  // down into this.
  const ring = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.1, 0.6),
    new THREE.MeshStandardMaterial({
      color: COLORS.trackOrange,
      emissive: COLORS.trackOrange,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.5,
    }),
  );
  ring.position.set(baseX, 0.05, state.gy);
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);

  // ---- Plunger ----
  // The whole green tower IS the spring-loaded plunger. Its parts are built in a
  // sub-group whose origin sits on the base plate (y = 0) so that scaling the
  // group along Y compresses it straight down toward the base (and springs back)
  // when the launch animation plays. See Renderer.animateLauncher().
  const plunger = new THREE.Group();
  plunger.name = 'plunger';
  plunger.position.set(baseX, 0.1, state.gy);

  const postMat = new THREE.MeshStandardMaterial({
    color: COLORS.start, emissive: COLORS.startEm, emissiveIntensity: 0.5,
    metalness: 0.3, roughness: 0.5,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, baseHeight, 0.34), postMat);
  post.position.set(0, baseHeight / 2, 0); // bottom at the group origin
  post.castShadow = true;
  plunger.add(post);

  // White cap at the top of the post.
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.09, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.4 }),
  );
  top.position.set(0, baseHeight + 0.045, 0);
  top.castShadow = true;
  plunger.add(top);

  // Green knob on top so the tower reads as something you press down.
  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.15, 0.16, 16),
    new THREE.MeshStandardMaterial({
      color: COLORS.start, emissive: COLORS.startEm, emissiveIntensity: 0.7,
      metalness: 0.35, roughness: 0.4,
    }),
  );
  knob.position.set(0, baseHeight + 0.17, 0);
  knob.castShadow = true;
  plunger.add(knob);

  group.add(plunger);

  return group;
}
