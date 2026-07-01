// vehicles.ts — the catalogue of playable vehicles: their handling profile
// (physics multipliers applied by the simulator) and their look (colours / mesh
// kind, consumed by renderer/car.ts). Pure data — no Three.js — so the physics
// layer can import the handling profile without pulling in the renderer.

export type VehicleId = 'classic' | 'speedster' | 'muscle' | 'bike' | 'monster';
export type VehicleKind = 'car' | 'bike';

/**
 * Multipliers on the global physics constants. The baseline car ('classic') is
 * all 1.0, so the default simulation is unchanged. Lower drag → higher top
 * speed; lower friction → coasts/holds speed better; higher corner → can take a
 * curve faster before flying off (multiplies CORNER_MAX_V2).
 */
export interface VehiclePhysics {
  drag: number;
  friction: number;
  corner: number;
}

/** Visual config for the mesh builder (renderer/car.ts). */
export interface VehicleVisual {
  body: number;
  bodyEm: number;
  accent: number;
  accentEm: number;
  /** Wheel size multiplier (monster truck = big chunky tyres). */
  wheelScale: number;
  /** Overall mesh scale. */
  scale: number;
}

export interface Vehicle {
  id: VehicleId;
  name: string;
  kind: VehicleKind;
  /** Emoji shown on the garage button. */
  icon: string;
  /** One-line handling summary for the garage UI. */
  blurb: string;
  physics: VehiclePhysics;
  visual: VehicleVisual;
}

/** The neutral profile — also exactly the 'classic' car (keeps physics unchanged). */
export const BASELINE_PHYSICS: VehiclePhysics = { drag: 1, friction: 1, corner: 1 };

export const VEHICLES: Record<VehicleId, Vehicle> = {
  classic: {
    id: 'classic', name: 'Classic', kind: 'car', icon: '🏎',
    blurb: 'All-rounder. Balanced speed and grip.',
    physics: { drag: 1.0, friction: 1.0, corner: 1.0 },
    visual: { body: 0x00ffd5, bodyEm: 0x004455, accent: 0xff3c00, accentEm: 0x661800, wheelScale: 1.0, scale: 1.0 },
  },
  speedster: {
    id: 'speedster', name: 'Speedster', kind: 'car', icon: '⚡',
    blurb: 'Blazing top speed, but twitchy — flies off tight corners.',
    physics: { drag: 0.6, friction: 0.85, corner: 0.7 },
    visual: { body: 0xffe600, bodyEm: 0x665500, accent: 0x111111, accentEm: 0x000000, wheelScale: 0.95, scale: 1.0 },
  },
  muscle: {
    id: 'muscle', name: 'Muscle', kind: 'car', icon: '🚗',
    blurb: 'Heavy hitter: fast and coasts forever, clumsy in corners.',
    physics: { drag: 0.7, friction: 0.7, corner: 0.85 },
    visual: { body: 0xd11a1a, bodyEm: 0x330000, accent: 0x222228, accentEm: 0x000000, wheelScale: 1.1, scale: 1.05 },
  },
  bike: {
    id: 'bike', name: 'Motorbike', kind: 'bike', icon: '🏍',
    blurb: 'Nimble: corners like it is on rails. Modest top speed.',
    physics: { drag: 1.1, friction: 1.0, corner: 1.9 },
    visual: { body: 0x2f7fd6, bodyEm: 0x0a2a4a, accent: 0xffd24a, accentEm: 0x664400, wheelScale: 1.0, scale: 1.0 },
  },
  monster: {
    id: 'monster', name: 'Monster', kind: 'car', icon: '🚙',
    blurb: 'Big grippy tyres: super stable in corners, but slow and draggy.',
    physics: { drag: 1.5, friction: 1.35, corner: 1.4 },
    visual: { body: 0x4f8a4c, bodyEm: 0x143314, accent: 0x222228, accentEm: 0x000000, wheelScale: 1.7, scale: 1.12 },
  },
};

export const VEHICLE_ORDER: VehicleId[] = ['classic', 'speedster', 'muscle', 'bike', 'monster'];

export const DEFAULT_VEHICLE_ID: VehicleId = 'classic';

/** Narrows an arbitrary string to a known VehicleId (used at the storage boundary). */
export function isVehicleId(id: string): id is VehicleId {
  return Object.prototype.hasOwnProperty.call(VEHICLES, id);
}
