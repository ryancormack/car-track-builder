// renderer/car.ts — car mesh and per-frame placement (position + orientation).

import * as THREE from 'three';
import { COLORS } from './colors.js';
import type { TrackFrame } from '../pieces/frames.js';

export function buildCar(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.18, 0.32),
    new THREE.MeshStandardMaterial({
      color: COLORS.car,
      metalness: 0.55,
      roughness: 0.28,
      emissive: COLORS.carEm,
      emissiveIntensity: 0.45,
    }),
  );
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.14, 0.26),
    new THREE.MeshStandardMaterial({ color: COLORS.carCabin, metalness: 0.7, roughness: 0.2 }),
  );
  cabin.position.set(-0.05, 0.13, 0);
  group.add(cabin);

  const wheelMat = new THREE.MeshStandardMaterial({ color: COLORS.carWheel, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12);
  const positions: Array<[number, number, number]> = [
    [0.18, -0.07, 0.16], [0.18, -0.07, -0.16],
    [-0.18, -0.07, 0.16], [-0.18, -0.07, -0.16],
  ];
  for (const [x, y, z] of positions) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, y, z);
    group.add(w);
  }

  // Glowing headlights at the front.
  const headlightMat = new THREE.MeshStandardMaterial({
    color: COLORS.carHeadlight,
    emissive: COLORS.carHeadlightEm,
    emissiveIntensity: 1.0,
    roughness: 0.3,
  });
  const headlightGeo = new THREE.BoxGeometry(0.05, 0.07, 0.09);
  for (const z of [0.1, -0.1]) {
    const hl = new THREE.Mesh(headlightGeo, headlightMat);
    hl.position.set(0.28, 0.02, z);
    group.add(hl);
  }

  // Rear spoiler.
  const spoilerMat = new THREE.MeshStandardMaterial({ color: COLORS.carCabin, metalness: 0.6, roughness: 0.4 });
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.34), spoilerMat);
  wing.position.set(-0.26, 0.13, 0);
  group.add(wing);
  for (const z of [0.13, -0.13]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.03), spoilerMat);
    strut.position.set(-0.26, 0.07, z);
    group.add(strut);
  }
  return group;
}

/**
 * Place the car using the shared track frame: sit it a fixed height *along the
 * surface normal* (so it hugs loops and corkscrews instead of floating in world
 * up), and orient it with the same {tangent, up, side} basis the rails use.
 */
const RIDE_HEIGHT = 0.12;

export function placeCar(car: THREE.Group, frame: TrackFrame): void {
  // Grid space (x=fwd, y=lateral, z=up) -> three.js (x, z, y).
  const pos = new THREE.Vector3(frame.pos.x, frame.pos.z, frame.pos.y);
  const tang = new THREE.Vector3(frame.tangent.x, frame.tangent.z, frame.tangent.y).normalize();
  const up = new THREE.Vector3(frame.up.x, frame.up.z, frame.up.y).normalize();
  // The grid->three map flips handedness, so derive `side` here to guarantee a
  // right-handed (non-mirrored) basis: tang × up = side.
  const side = new THREE.Vector3().crossVectors(tang, up).normalize();

  car.position.copy(pos).addScaledVector(up, RIDE_HEIGHT);
  car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tang, up, side));
}
