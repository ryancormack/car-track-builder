// app/storage.ts — minimal localStorage wrapper for save/load. Pure I/O.

import type { TrackJSON } from '../types.js';

const SAVE_KEY = 'hotTrack.save.v1';

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
