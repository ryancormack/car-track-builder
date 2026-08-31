// app/storage.ts — minimal localStorage wrapper for save/load. Pure I/O.

import type { TrackJSON } from '../types.js';

const SAVE_KEY = 'hotTrack.save.v1';
// Player's chosen vehicle — a profile preference, kept separate from the track
// save so it persists across tracks (and clearing a track doesn't reset it).
const VEHICLE_KEY = 'hotTrack.vehicle.v1';
// Player's chosen car count — also a profile preference, independent of the
// track save, so it persists across tracks.
const CAR_COUNT_KEY = 'hotTrack.carCount.v1';
// Which palette groups the player has collapsed — a layout preference, so it is
// also kept out of the track save.
const COLLAPSED_GROUPS_KEY = 'hotTrack.collapsedGroups.v1';

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


/** Persist the player's chosen number of cars. Returns false if storage failed. */export function saveCarCount(count: number): boolean {
  try {
    localStorage.setItem(CAR_COUNT_KEY, String(count));
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the raw stored car count (unvalidated) or null. Callers should clamp
 * it to the valid [MIN_CARS, MAX_CARS] range before use.
 */
export function loadCarCount(): number | null {
  try {
    const raw = localStorage.getItem(CAR_COUNT_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}


/**
 * Persist which palette groups the player has collapsed. Also a profile
 * preference rather than track state — how you like the palette arranged should
 * survive loading a different track.
 */
export function saveCollapsedGroups(labels: readonly string[]): boolean {
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(labels));
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the stored collapsed group labels, or null when nothing is stored.
 * Anything unparseable or not an array of strings is treated as absent rather
 * than trusted, so a corrupted value cannot hide the whole palette.
 */
export function loadCollapsedGroups(): string[] | null {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}
