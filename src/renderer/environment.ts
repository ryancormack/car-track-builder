// renderer/environment.ts — procedural living-room backdrop. Everything is built
// from Three.js primitives (no textures/assets) to match the low-poly aesthetic.
//
// Coordinate note: the scene is y-up. The isometric camera sits at +x/+z and
// looks toward the origin, so only the two "far" walls (on the -x and -z sides)
// are ever visible — an L-shaped corner is enough for a convincing backdrop.
// The Renderer repositions this whole group to the track centroid each rebuild,
// so it is modelled centred on its own origin.

import * as THREE from 'three';
import { COLORS } from './colors.js';

// Default room dimensions (local space, centred on origin).
const DEFAULT_ROOM_HALF = 16;
const DEFAULT_WALL_HEIGHT = 9;
const FLOOR_SIZE = 72;    // generously large so it always fills the view
const WALL_THICK = 0.3;

/** Parameters controlling the dynamic room extent. */
export interface RoomExtent {
  roomHalf: number;
  wallHeight: number;
}

function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0, ...opts });
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

function cyl(rTop: number, rBot: number, h: number, material: THREE.Material, seg = 16): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material);
}

// ---- Shell pieces ----

function buildFloor(floorSize: number): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    stdMat(COLORS.roomFloor, { roughness: 0.82 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015; // just under the track's ground reference
  floor.receiveShadow = true;
  floor.name = 'roomFloor';
  return floor;
}

function buildRug(roomHalf: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'rug';
  // Scale the rug proportionally with the room size.
  const scale = roomHalf / DEFAULT_ROOM_HALF;
  const trimSize = 21 * scale;
  const topSize = 19 * scale;
  // Kept just above the floor (y=-0.015) but below the track surface (~y=0) so
  // flat pieces never poke through the rug.
  const trim = box(trimSize, 0.012, trimSize, stdMat(COLORS.rugTrim, { roughness: 1.0 }));
  trim.position.y = -0.009;
  trim.receiveShadow = true;
  const top = box(topSize, 0.012, topSize, stdMat(COLORS.rug, { roughness: 1.0 }));
  top.position.y = -0.004;
  top.receiveShadow = true;
  g.add(trim, top);
  return g;
}

function buildWalls(roomHalf: number, wallHeight: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'walls';

  // Back wall (perpendicular to z, on the -z side), faces +z toward the camera.
  const backWall = box(roomHalf * 2, wallHeight, WALL_THICK, stdMat(COLORS.roomWall, { roughness: 1.0 }));
  backWall.position.set(0, wallHeight / 2, -roomHalf);
  backWall.receiveShadow = true;
  g.add(backWall);

  // Left wall (perpendicular to x, on the -x side), faces +x toward the camera.
  const leftWall = box(WALL_THICK, wallHeight, roomHalf * 2, stdMat(COLORS.roomWallAlt, { roughness: 1.0 }));
  leftWall.position.set(-roomHalf, wallHeight / 2, 0);
  leftWall.receiveShadow = true;
  g.add(leftWall);

  // Baseboards (pale trim along the foot of each wall).
  const baseMat = stdMat(COLORS.roomBaseboard, { roughness: 0.8 });
  const backBase = box(roomHalf * 2, 0.5, WALL_THICK + 0.06, baseMat);
  backBase.position.set(0, 0.25, -roomHalf + 0.03);
  g.add(backBase);
  const leftBase = box(WALL_THICK + 0.06, 0.5, roomHalf * 2, baseMat);
  leftBase.position.set(-roomHalf + 0.03, 0.25, 0);
  g.add(leftBase);

  return g;
}

function buildWindow(roomHalf: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'window';

  // Mounted on the back wall (-z), inset toward the room so it reads in front
  // of the wall surface. Scale position proportionally to the room size.
  const scale = roomHalf / DEFAULT_ROOM_HALF;
  const winW = 7;
  const winH = 4.5;
  const cx = 5.5 * scale;
  const cy = 5;
  const z = -roomHalf + WALL_THICK / 2 + 0.06;

  // Glowing sky pane.
  const sky = box(winW, winH, 0.08, stdMat(COLORS.windowSky, {
    emissive: COLORS.windowSkyEm,
    emissiveIntensity: 0.55,
    roughness: 0.4,
  }));
  sky.position.set(cx, cy, z);
  g.add(sky);

  // Frame: four borders + a cross mullion.
  const frameMat = stdMat(COLORS.windowFrame, { roughness: 0.7 });
  const fT = 0.35; // frame thickness
  const top = box(winW + fT * 2, fT, 0.16, frameMat);
  top.position.set(cx, cy + winH / 2, z);
  const bot = top.clone(); bot.position.set(cx, cy - winH / 2, z);
  const left = box(fT, winH + fT * 2, 0.16, frameMat);
  left.position.set(cx - winW / 2, cy, z);
  const right = left.clone(); right.position.set(cx + winW / 2, cy, z);
  const mullionV = box(0.18, winH, 0.12, frameMat); mullionV.position.set(cx, cy, z + 0.02);
  const mullionH = box(winW, 0.18, 0.12, frameMat); mullionH.position.set(cx, cy, z + 0.02);
  g.add(top, bot, left, right, mullionV, mullionH);

  return g;
}

// ---- Furniture ----

/** A simple two-seat sofa. Built with its back toward -z (opening toward +z). */
function buildSofa(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = stdMat(COLORS.sofa, { roughness: 1.0 });
  const cushionMat = stdMat(COLORS.sofaCushion, { roughness: 1.0 });

  const W = 6, D = 2.4;
  const base = box(W, 0.7, D, bodyMat); base.position.set(0, 0.45, 0);
  const back = box(W, 1.5, 0.5, bodyMat); back.position.set(0, 1.1, -D / 2 + 0.25);
  const armL = box(0.5, 1.1, D, bodyMat); armL.position.set(-W / 2 + 0.25, 0.85, 0);
  const armR = armL.clone(); armR.position.set(W / 2 - 0.25, 0.85, 0);
  g.add(base, back, armL, armR);

  // Seat cushions sitting proud of the base.
  for (const cx of [-1.4, 1.4]) {
    const c = box(2.5, 0.35, D - 0.6, cushionMat);
    c.position.set(cx, 0.95, 0.15);
    g.add(c);
  }
  return g;
}

/** Low TV stand with a flat-panel TV. Screen faces +z by default. */
function buildTvUnit(): THREE.Group {
  const g = new THREE.Group();
  const standMat = stdMat(COLORS.tvUnit, { roughness: 0.7, metalness: 0.1 });
  const stand = box(4.2, 1.0, 1.1, standMat); stand.position.set(0, 0.5, 0);
  g.add(stand);

  const bezel = box(3.8, 2.2, 0.16, stdMat(0x05070b, { roughness: 0.5 }));
  bezel.position.set(0, 2.25, 0.1);
  const screen = box(3.5, 1.9, 0.05, stdMat(COLORS.tvScreen, {
    emissive: COLORS.tvScreenEm, emissiveIntensity: 0.6, roughness: 0.3,
  }));
  screen.position.set(0, 2.25, 0.19);
  g.add(bezel, screen);
  return g;
}

/** Coffee table: a top on four legs. */
function buildCoffeeTable(): THREE.Group {
  const g = new THREE.Group();
  const mat = stdMat(COLORS.coffeeTable, { roughness: 0.6, metalness: 0.05 });
  const top = box(2.8, 0.18, 1.5, mat); top.position.set(0, 0.62, 0);
  g.add(top);
  for (const [lx, lz] of [[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]] as const) {
    const leg = box(0.16, 0.62, 0.16, mat);
    leg.position.set(lx, 0.31, lz);
    g.add(leg);
  }
  return g;
}

/** Bookshelf with a few colourful "books". Opening faces +z. */
function buildBookshelf(): THREE.Group {
  const g = new THREE.Group();
  const woodMat = stdMat(COLORS.shelf, { roughness: 0.7 });
  const W = 2.0, H = 3.4, D = 0.9;
  const body = box(W, H, D, woodMat); body.position.set(0, H / 2, 0);
  g.add(body);

  const bookColors = [0xc0533b, 0x3b6cc0, 0xd9a23b, 0x4f8a4c, 0x8270a0];
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.7 + shelf * 1.05;
    for (let i = 0; i < 5; i++) {
      const b = box(0.22, 0.7 + (i % 3) * 0.08, 0.5, stdMat(bookColors[(shelf + i) % bookColors.length], { roughness: 1.0 }));
      b.position.set(-0.7 + i * 0.34, y, 0.18);
      g.add(b);
    }
  }
  return g;
}

/** A potted plant: pot + a couple of foliage blobs. */
function buildPlant(): THREE.Group {
  const g = new THREE.Group();
  const pot = cyl(0.45, 0.32, 0.7, stdMat(COLORS.plantPot, { roughness: 0.8 }));
  pot.position.set(0, 0.35, 0);
  g.add(pot);
  const leafMat = stdMat(COLORS.plantLeaf, { roughness: 1.0 });
  const blobs: Array<[number, number, number, number]> = [
    [0, 1.3, 0, 0.7], [0.35, 1.7, 0.1, 0.5], [-0.3, 1.6, -0.15, 0.45],
  ];
  for (const [x, y, z, r] of blobs) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
    leaf.position.set(x, y, z);
    g.add(leaf);
  }
  return g;
}

/** Floor lamp. The warm glow light itself is added by the Renderer (Task 4). */
function buildFloorLamp(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'floorLamp';
  const metalMat = stdMat(0x3a3530, { roughness: 0.4, metalness: 0.5 });
  const base = cyl(0.4, 0.5, 0.12, metalMat); base.position.set(0, 0.06, 0);
  const pole = cyl(0.06, 0.06, 4.0, metalMat); pole.position.set(0, 2.0, 0);
  const shade = cyl(0.7, 0.45, 0.9, stdMat(COLORS.lamp, {
    emissive: COLORS.lampGlow, emissiveIntensity: 0.7, roughness: 0.6,
  }));
  shade.position.set(0, 4.1, 0);
  shade.name = 'lampShade';
  g.add(base, pole, shade);
  return g;
}

/** Arrange the furniture around the walls, clear of the central track/rug. */
function buildFurniture(roomHalf: number): THREE.Group {
  const furniture = new THREE.Group();
  furniture.name = 'furniture';

  // Scale furniture positions proportionally with room size so they stay
  // against the walls regardless of extent.
  const scale = roomHalf / DEFAULT_ROOM_HALF;

  const sofa = buildSofa();
  sofa.position.set(-6 * scale, 0, -13.2 * scale); // against the back wall, left of the window
  furniture.add(sofa);

  const table = buildCoffeeTable();
  table.position.set(-6 * scale, 0, -9.6 * scale); // in front of the sofa
  furniture.add(table);

  const tv = buildTvUnit();
  tv.position.set(-14.2 * scale, 0, 4 * scale);    // against the left wall...
  tv.rotation.y = Math.PI / 2;     // ...screen facing into the room (+x)
  furniture.add(tv);

  const shelf = buildBookshelf();
  shelf.position.set(-14.2 * scale, 0, -7 * scale);
  shelf.rotation.y = Math.PI / 2;
  furniture.add(shelf);

  const plant = buildPlant();
  plant.position.set(-13.8 * scale, 0, -13.8 * scale); // far corner
  furniture.add(plant);

  const lamp = buildFloorLamp();
  lamp.position.set(-1.5 * scale, 0, -13.6 * scale);   // beside the sofa, under the window
  furniture.add(lamp);

  // Furniture casts (and receives) shadows for grounding.
  furniture.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });

  return furniture;
}

/** Indoor accent lights, parented to the room so they toggle with its visibility. */
function buildRoomLights(roomHalf: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'roomLights';

  const scale = roomHalf / DEFAULT_ROOM_HALF;

  // Warm glow emanating from the floor-lamp shade (matches buildFloorLamp pos).
  const lamp = new THREE.PointLight(COLORS.lampGlow, 26, 26 * scale, 2);
  lamp.position.set(-1.5 * scale, 4.1, -13.6 * scale);
  g.add(lamp);

  // Cool daylight spilling in through the window (matches buildWindow pos).
  const windowFill = new THREE.PointLight(COLORS.windowSky, 16, 44 * scale, 2);
  windowFill.position.set(5.5 * scale, 5, -roomHalf - 0.5);
  g.add(windowFill);

  return g;
}

/**
 * Build the full living-room backdrop group. Furniture is collected in a named
 * `furniture` subgroup so it can be reasoned about/tested independently.
 *
 * @param extent - optional room extent to scale dynamically. Defaults to the
 * original hardcoded dimensions if not provided.
 */
export function buildLivingRoom(extent?: RoomExtent): THREE.Group {
  const roomHalf = extent?.roomHalf ?? DEFAULT_ROOM_HALF;
  const wallHeight = extent?.wallHeight ?? DEFAULT_WALL_HEIGHT;
  const floorSize = Math.max(FLOOR_SIZE, roomHalf * 4.5);

  const room = new THREE.Group();
  room.name = 'livingRoom';

  room.add(buildFloor(floorSize));
  room.add(buildRug(roomHalf));
  room.add(buildWalls(roomHalf, wallHeight));
  room.add(buildWindow(roomHalf));
  room.add(buildFurniture(roomHalf));
  room.add(buildRoomLights(roomHalf));

  return room;
}
