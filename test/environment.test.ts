// Tests for the living-room environment visibility + persistence logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  environmentVisible,
  cycleOverride,
  loadEnvOverride,
  saveEnvOverride,
  type EnvOverride,
} from '../src/app/environment.js';

// ---- environmentVisible: all 6 override × mode combinations ----

test('auto override: hidden in build, shown in play', () => {
  assert.equal(environmentVisible('auto', 'build'), false);
  assert.equal(environmentVisible('auto', 'play'), true);
});

test('on override: always shown', () => {
  assert.equal(environmentVisible('on', 'build'), true);
  assert.equal(environmentVisible('on', 'play'), true);
});

test('off override: always hidden', () => {
  assert.equal(environmentVisible('off', 'build'), false);
  assert.equal(environmentVisible('off', 'play'), false);
});

// ---- cycleOverride ----

test('cycle order is auto → on → off → auto', () => {
  assert.equal(cycleOverride('auto'), 'on');
  assert.equal(cycleOverride('on'), 'off');
  assert.equal(cycleOverride('off'), 'auto');
});

test('cycling four times returns to the start', () => {
  let o: EnvOverride = 'auto';
  for (let i = 0; i < 3; i++) o = cycleOverride(o);
  assert.equal(o, 'auto');
});

// ---- load / save persistence ----

/** Install a minimal in-memory localStorage stub for the duration of a test. */
function withStorage<T>(fn: (store: Map<string, string>) => T): T {
  const store = new Map<string, string>();
  const original = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  try {
    return fn(store);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  }
}

test('save then load round-trips each override value', () => {
  withStorage(() => {
    for (const o of ['auto', 'on', 'off'] as const) {
      assert.equal(saveEnvOverride(o), true);
      assert.equal(loadEnvOverride(), o);
    }
  });
});

test('load defaults to auto when nothing is stored', () => {
  withStorage(() => {
    assert.equal(loadEnvOverride(), 'auto');
  });
});

test('load defaults to auto when a garbage value is stored', () => {
  withStorage((store) => {
    store.set('hotTrack.env.v1', 'banana');
    assert.equal(loadEnvOverride(), 'auto');
  });
});

test('load returns auto and save returns false when storage is unavailable', () => {
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  // Simulate an environment without localStorage (accessing it throws).
  delete (globalThis as { localStorage?: unknown }).localStorage;
  try {
    assert.equal(loadEnvOverride(), 'auto');
    assert.equal(saveEnvOverride('on'), false);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  }
});
