// renderer/car.ts — vehicle meshes (car + motorbike) and per-frame placement
// (position + orientation). The catalogue in ../vehicles.ts decides which mesh
// kind to build and supplies the colour/scale palette; this module turns that
// into a Three.js group.

import * as THREE from 'three';
import { COLORS } from './colors.js';
import { VEHICLES, type VehicleId, type VehicleVisual } from '../vehicles.js';
import type { TrackFrame } from '../pieces/frames.js';

/**
 * Build the mesh for a catalogue vehicle. Dispatches on the vehicle's `kind`
 * (car vs. motorbike) and feeds the per-vehicle visual palette (body/accent
 * colours, wheel size, overall scale) into the chosen builder.
 */
export function buildVehicle(id: VehicleId): THREE.Group {
  const v = VEHICLES[id];
  const mesh = v.kind === 'bike' ? buildBikeMesh(v.visual) : buildCarMesh(v.visual);
  // The per-vehicle base scale lives on an INNER group so the outer group stays
  // free for the renderer's placement/wipeout transforms (setCar resets the
  // outer scale to 1, and a crash shrinks it — neither should wipe out a
  // vehicle's intrinsic size).
  mesh.scale.setScalar(v.visual.scale);
  const outer = new THREE.Group();
  outer.add(mesh);
  return outer;
}

/**
 * Open-wheel race car. The body and accent colours come from the vehicle's
 * visual palette; the wheels scale by `wheelScale` (so the Monster gets big
 * chunky tyres). Everything else (cabin/carbon, headlights) is shared chrome.
 */
function buildCarMesh(visual: VehicleVisual): THREE.Group {
  const group = new THREE.Group();
  const ws = visual.wheelScale;

  // --- Materials ---
  const bodyMat = new THREE.MeshStandardMaterial({
    color: visual.body,
    metalness: 0.6,
    roughness: 0.22,
    emissive: visual.bodyEm,
    emissiveIntensity: 0.4,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: visual.accent,
    metalness: 0.5,
    roughness: 0.3,
    emissive: visual.accentEm,
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
  // Radii scale with the vehicle's wheelScale (monster trucks get big tyres).
  const frontR = 0.055 * ws;
  const rearR = 0.07 * ws;
  const frontWheelGeo = new THREE.CylinderGeometry(frontR, frontR, 0.04 * ws, 14);
  const rearWheelGeo = new THREE.CylinderGeometry(rearR, rearR, 0.05 * ws, 14);
  const frontRimGeo = new THREE.CylinderGeometry(0.03 * ws, 0.03 * ws, 0.042 * ws, 8);
  const rearRimGeo = new THREE.CylinderGeometry(0.038 * ws, 0.038 * ws, 0.052 * ws, 8);

  // Wheels sit lower as they grow, so big tyres lift the body convincingly.
  const frontY = -0.04 - (frontR - 0.055);
  const rearY = -0.03 - (rearR - 0.07);
  const wheelZ = 0.16 + (ws - 1) * 0.06; // push tyres out a touch when chunky

  // Front wheels (narrower, smaller)
  const frontPositions: Array<[number, number, number]> = [
    [0.2, frontY, wheelZ],
    [0.2, frontY, -wheelZ],
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
    [-0.18, rearY, wheelZ + 0.01],
    [-0.18, rearY, -(wheelZ + 0.01)],
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
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.30), carbonMat);
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
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.30), carbonMat);
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
 * A nimble motorbike: two in-line wheels, a sloped frame + fuel tank, a low
 * seat, handlebars, and a hunched rider. Built in the same local axes as the
 * car (x = forward, y = up, z = lateral) so `placeCar` orients it identically.
 */
function buildBikeMesh(visual: VehicleVisual): THREE.Group {
  const group = new THREE.Group();
  const ws = visual.wheelScale;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: visual.body, metalness: 0.6, roughness: 0.25,
    emissive: visual.bodyEm, emissiveIntensity: 0.4,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: visual.accent, metalness: 0.5, roughness: 0.3,
    emissive: visual.accentEm, emissiveIntensity: 0.35,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: COLORS.carCabin, metalness: 0.8, roughness: 0.2 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: COLORS.carWheel, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: COLORS.carWheelRim, metalness: 0.7, roughness: 0.3 });
  const riderMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.3, roughness: 0.6 });

  // --- Wheels: in line along the travel axis, centred on z = 0 ---
  const wheelR = 0.1 * ws;
  const wheelW = 0.05;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 16);
  const rimGeo = new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, wheelW + 0.005, 8);
  const wheelY = -0.04 - (wheelR - 0.1);
  const frontX = 0.22;
  const rearX = -0.22;
  for (const x of [frontX, rearX]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, wheelY, 0);
    w.castShadow = true;
    group.add(w);
    const r = new THREE.Mesh(rimGeo, rimMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(x, wheelY, 0);
    group.add(r);
  }

  // --- Frame spine: a low slanted bar linking the two hubs ---
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.05), darkMat);
  frame.position.set(0, wheelY + 0.07, 0);
  frame.rotation.z = -0.05;
  frame.castShadow = true;
  group.add(frame);

  // --- Fuel tank + bodywork: a chunky rounded block in the body colour ---
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.09), bodyMat);
  tank.position.set(0.0, wheelY + 0.14, 0);
  tank.castShadow = true;
  group.add(tank);

  // Front cowling / fairing over the front wheel.
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.08), bodyMat);
  cowl.position.set(0.17, wheelY + 0.12, 0);
  cowl.rotation.z = -0.5;
  cowl.castShadow = true;
  group.add(cowl);

  // Tail unit behind the seat (accent colour).
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.07), accentMat);
  tail.position.set(-0.18, wheelY + 0.16, 0);
  tail.rotation.z = 0.35;
  tail.castShadow = true;
  group.add(tail);

  // --- Seat: a flat dark pad behind the tank ---
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.07), darkMat);
  seat.position.set(-0.08, wheelY + 0.155, 0);
  seat.castShadow = true;
  group.add(seat);

  // --- Forks + handlebars at the front ---
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), darkMat);
  fork.position.set(0.2, wheelY + 0.08, 0);
  fork.rotation.z = -0.45;
  fork.castShadow = true;
  group.add(fork);
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8), darkMat);
  bars.rotation.x = Math.PI / 2;
  bars.position.set(0.17, wheelY + 0.2, 0);
  group.add(bars);

  // --- Headlight ---
  const headlightMat = new THREE.MeshStandardMaterial({
    color: COLORS.carHeadlight, emissive: COLORS.carHeadlightEm,
    emissiveIntensity: 1.0, roughness: 0.3,
  });
  const hl = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), headlightMat);
  hl.position.set(0.235, wheelY + 0.14, 0);
  group.add(hl);

  // --- Rider: a hunched torso + helmet leaning over the tank ---
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.08), riderMat);
  torso.position.set(-0.04, wheelY + 0.26, 0);
  torso.rotation.z = 0.5; // leaning forward into the wind
  torso.castShadow = true;
  group.add(torso);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), accentMat);
  helmet.position.set(0.07, wheelY + 0.31, 0);
  helmet.castShadow = true;
  group.add(helmet);

  // Visor band across the helmet.
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.085), darkMat);
  visor.position.set(0.11, wheelY + 0.31, 0);
  group.add(visor);

  return group;
}

/**
 * Place the vehicle using the shared track frame: sit it a fixed height *along
 * the surface normal* (so it hugs loops and corkscrews instead of floating in
 * world up), and orient it with the same {tangent, up, side} basis the rails
 * use.
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
