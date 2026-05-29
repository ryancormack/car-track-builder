// app/storage.js — minimal localStorage wrapper for save/load. Pure I/O.

const SAVE_KEY = 'hotTrack.save.v1';

export function saveTrackJSON(json) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(json));
    return true;
  } catch {
    return false;
  }
}

export function loadTrackJSON() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
