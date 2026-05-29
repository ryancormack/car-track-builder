// renderer/car.ts — car mesh and per-frame placement (position + orientation).

import * as THREE from 'three';
import { COLORS } from './colors.js';
import type { CarSample } from '../types.js';

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
 * Place the car at the supplied path sample. Builds an orthonormal basis from
 * the tangent, applies banking, hovers the car slightly above the rails.
 */
export function placeCar(car: THREE.Group, sample: CarSample): void {
  const { pos, tangent, banking } = sample;
  car.position.set(pos.wx, pos.wz + 0.12, pos.wy);

  const tang = new THREE.Vector3(tangent.dx, tangent.dz, tangent.dy);
  if (tang.lengthSq() < 1e-8) tang.set(1, 0, 0);
  tang.normalize();

  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, tang);
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  side.normalize();
  const localUp = new THREE.Vector3().crossVectors(tang, side).normalize();

  if (banking) {
    const q = new THREE.Quaternion().setFromAxisAngle(tang, banking);
    side.applyQuaternion(q);
    localUp.applyQuaternion(q);
  }

  const m = new THREE.Matrix4().makeBasis(tang, localUp, side);
  car.quaternion.setFromRotationMatrix(m);
}
