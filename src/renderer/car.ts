// renderer/car.ts — car mesh and per-frame placement (position + orientation).

import * as THREE from 'three';
import { COLORS } from './colors.js';
import type { TrackFrame } from '../pieces/frames.js';

export function buildCar(): THREE.Group {
  const group = new THREE.Group();

  // --- Materials ---
  const bodyMat = new THREE.MeshStandardMaterial({
    color: COLORS.car,
    metalness: 0.6,
    roughness: 0.22,
    emissive: COLORS.carEm,
    emissiveIntensity: 0.4,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: COLORS.carAccent,
    metalness: 0.5,
    roughness: 0.3,
    emissive: COLORS.carAccentEm,
    emissiveIntensity: 0.3,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: COLORS.carCabin,
    metalness: 0.8,
    roughness: 0.15,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: COLORS.carWheel, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: COLORS.carWheelRim, metalness: 0.7, roughness: 0.3 });

  // --- Main body: tapered wedge (wider rear, narrow nose) ---
  // Use a custom shape via ExtrudeGeometry for the side profile
  const bodyShape = new THREE.Shape();
  // Side profile: starts at rear-bottom, goes forward tapering up at nose
  bodyShape.moveTo(-0.27, -0.04); // rear bottom
  bodyShape.lineTo(0.28, -0.04);  // front bottom (nose)
  bodyShape.lineTo(0.30, 0.0);    // nose tip rises slightly
  bodyShape.lineTo(0.22, 0.02);   // top of nose
  bodyShape.lineTo(0.05, 0.06);   // front of cockpit area
  bodyShape.lineTo(-0.06, 0.06);  // rear of cockpit area
  bodyShape.lineTo(-0.18, 0.05);  // engine cover
  bodyShape.lineTo(-0.27, 0.04);  // rear top
  bodyShape.closePath();

  const bodyExtrudeSettings = {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.015,
    bevelSegments: 2,
  };
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, bodyExtrudeSettings);
  bodyGeo.center();
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.set(0.01, 0.02, 0);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);

  // --- Nose cone: tapered front section ---
  const noseGeo = new THREE.ConeGeometry(0.06, 0.12, 4);
  const noseMesh = new THREE.Mesh(noseGeo, bodyMat);
  noseMesh.rotation.z = -Math.PI / 2;
  noseMesh.position.set(0.28, 0.0, 0);
  noseMesh.castShadow = true;
  group.add(noseMesh);

  // --- Cockpit: low bubble ---
  const cockpitGeo = new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const cockpitMat = new THREE.MeshStandardMaterial({
    color: 0x112244,
    metalness: 0.9,
    roughness: 0.05,
    opacity: 0.85,
    transparent: true,
  });
  const cockpitMesh = new THREE.Mesh(cockpitGeo, cockpitMat);
  cockpitMesh.position.set(0.0, 0.06, 0);
  cockpitMesh.scale.set(1.4, 0.8, 1.0);
  cockpitMesh.castShadow = true;
  group.add(cockpitMesh);

  // --- Side pods / air intakes ---
  const sidePodGeo = new THREE.BoxGeometry(0.14, 0.05, 0.04);
  for (const z of [0.13, -0.13]) {
    const pod = new THREE.Mesh(sidePodGeo, accentMat);
    pod.position.set(-0.04, 0.0, z);
    pod.castShadow = true;
    group.add(pod);
  }

  // --- Side intake openings (dark slots) ---
  const intakeGeo = new THREE.BoxGeometry(0.06, 0.035, 0.015);
  for (const z of [0.145, -0.145]) {
    const intake = new THREE.Mesh(intakeGeo, carbonMat);
    intake.position.set(0.02, 0.01, z);
    group.add(intake);
  }

  // --- Wheels: larger rear, smaller front (open-wheel style) ---
  const frontWheelGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.04, 14);
  const rearWheelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14);
  const frontRimGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.042, 8);
  const rearRimGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.052, 8);

  // Front wheels (narrower, smaller)
  const frontPositions: Array<[number, number, number]> = [
    [0.2, -0.04, 0.16],
    [0.2, -0.04, -0.16],
  ];
  for (const [x, y, z] of frontPositions) {
    const w = new THREE.Mesh(frontWheelGeo, wheelMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, y, z);
    w.castShadow = true;
    group.add(w);
    const r = new THREE.Mesh(frontRimGeo, rimMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(x, y, z);
    group.add(r);
  }

  // Rear wheels (wider, larger)
  const rearPositions: Array<[number, number, number]> = [
    [-0.18, -0.03, 0.17],
    [-0.18, -0.03, -0.17],
  ];
  for (const [x, y, z] of rearPositions) {
    const w = new THREE.Mesh(rearWheelGeo, wheelMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, y, z);
    w.castShadow = true;
    group.add(w);
    const r = new THREE.Mesh(rearRimGeo, rimMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(x, y, z);
    group.add(r);
  }

  // --- Front wing ---
  const frontWingMat = carbonMat;
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.30), frontWingMat);
  frontWing.position.set(0.27, -0.03, 0);
  frontWing.castShadow = true;
  group.add(frontWing);

  // Front wing endplates
  const endplateGeo = new THREE.BoxGeometry(0.05, 0.03, 0.008);
  for (const z of [0.15, -0.15]) {
    const ep = new THREE.Mesh(endplateGeo, accentMat);
    ep.position.set(0.27, -0.03, z);
    ep.castShadow = true;
    group.add(ep);
  }

  // --- Rear wing / spoiler ---
  const rearWingMat = carbonMat;
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.30), rearWingMat);
  rearWing.position.set(-0.26, 0.1, 0);
  rearWing.castShadow = true;
  group.add(rearWing);

  // Rear wing struts
  for (const z of [0.1, -0.1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.06, 0.012), carbonMat);
    strut.position.set(-0.26, 0.07, z);
    strut.castShadow = true;
    group.add(strut);
  }

  // Rear wing endplates
  const rearEndplateGeo = new THREE.BoxGeometry(0.06, 0.05, 0.008);
  for (const z of [0.15, -0.15]) {
    const ep = new THREE.Mesh(rearEndplateGeo, accentMat);
    ep.position.set(-0.26, 0.09, z);
    ep.castShadow = true;
    group.add(ep);
  }

  // --- Glowing headlights at the front ---
  const headlightMat = new THREE.MeshStandardMaterial({
    color: COLORS.carHeadlight,
    emissive: COLORS.carHeadlightEm,
    emissiveIntensity: 1.0,
    roughness: 0.3,
  });
  const headlightGeo = new THREE.SphereGeometry(0.018, 8, 6);
  for (const z of [0.08, -0.08]) {
    const hl = new THREE.Mesh(headlightGeo, headlightMat);
    hl.position.set(0.27, 0.01, z);
    hl.castShadow = true;
    group.add(hl);
  }

  // --- Rear lights (red glow) ---
  const rearLightMat = new THREE.MeshStandardMaterial({
    color: 0xff1100,
    emissive: 0xff2200,
    emissiveIntensity: 0.8,
    roughness: 0.4,
  });
  const rearLightGeo = new THREE.BoxGeometry(0.01, 0.02, 0.12);
  const rearLight = new THREE.Mesh(rearLightGeo, rearLightMat);
  rearLight.position.set(-0.28, 0.02, 0);
  rearLight.castShadow = true;
  group.add(rearLight);

  // --- Engine cover fin (shark fin) ---
  const finGeo = new THREE.BoxGeometry(0.12, 0.04, 0.005);
  const fin = new THREE.Mesh(finGeo, bodyMat);
  fin.position.set(-0.14, 0.07, 0);
  fin.castShadow = true;
  group.add(fin);

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
