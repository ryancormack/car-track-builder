// app/storage.ts — minimal localStorage wrapper for save/load. Pure I/O.

import type { TrackJSON } from '../types.js';

const SAVE_KEY = 'hotTrack.save.v1';
// Player's chosen vehicle — a profile preference, kept separate from the track
// save so it persists across tracks (and clearing a track doesn't reset it).
const VEHICLE_KEY = 'hotTrack.vehicle.v1';

export function saveTrackJSON(json: TrackJSON): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(json));
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the raw parsed payload (unvalidated). Callers pass it straight to
 * {@link Track.fromJSON}, which validates and sanitises the contents.
 */
export function loadTrackJSON(): unknown {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}


/** Persist the player's selected vehicle id. Returns false if storage failed. */
export function saveVehicleId(id: string): boolean {
  try {
    localStorage.setItem(VEHICLE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the raw stored vehicle id (unvalidated) or null. Callers narrow it
 * with `isVehicleId` before use and fall back to the default otherwise.
 */
export function loadVehicleId(): string | null {
  try {
    return localStorage.getItem(VEHICLE_KEY);
  } catch {
    return null;
  }
}
