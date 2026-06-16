// app/environment.ts — pure logic + persistence for the optional living-room
// environment toggle. Kept free of DOM/Three so it can be unit-tested.

/** User preference for the room backdrop. */
export type EnvOverride = 'auto' | 'on' | 'off';

/** App mode the visibility decision depends on. */
export type EnvMode = 'build' | 'play';

const STORE_KEY = 'hotTrack.env.v1';
const DEFAULT_OVERRIDE: EnvOverride = 'auto';

/**
 * Decide whether the living-room environment should be shown.
 *
 *  - 'auto' (default): plain/blue while building, room while playing.
 *  - 'on':  always show the room.
 *  - 'off': never show the room.
 */
export function environmentVisible(override: EnvOverride, mode: EnvMode): boolean {
  switch (override) {
    case 'on':
      return true;
    case 'off':
      return false;
    case 'auto':
    default:
      return mode === 'play';
  }
}

/** Cycle order for the toggle button: auto → on → off → auto. */
export function cycleOverride(override: EnvOverride): EnvOverride {
  switch (override) {
    case 'auto':
      return 'on';
    case 'on':
      return 'off';
    case 'off':
    default:
      return 'auto';
  }
}

/** Narrow an arbitrary value to a valid {@link EnvOverride}. */
function isEnvOverride(value: unknown): value is EnvOverride {
  return value === 'auto' || value === 'on' || value === 'off';
}

/**
 * Load the saved override, defaulting to 'auto' when missing, invalid, or when
 * localStorage is unavailable (e.g. under the test runner).
 */
export function loadEnvOverride(): EnvOverride {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return isEnvOverride(raw) ? raw : DEFAULT_OVERRIDE;
  } catch {
    return DEFAULT_OVERRIDE;
  }
}

/** Persist the override. Returns false if storage is unavailable. */
export function saveEnvOverride(override: EnvOverride): boolean {
  try {
    localStorage.setItem(STORE_KEY, override);
    return true;
  } catch {
    return false;
  }
}
