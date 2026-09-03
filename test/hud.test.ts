// Tests for Hud.flashStatus mirroring into the play-mode banner.
//
// The build-mode status line lives in the sidebar, which is dimmed during play,
// so crash reasons (and every other flash message) are mirrored into a dedicated
// #play-status banner over the stage. This test locks in that both surfaces get
// the message + kind class, and that both are cleared when the flash expires.
//
// No DOM library in this project, so we hand-roll the two element fakes Hud
// touches (textContent + className) plus the minimal UIElements the HUD reads.
// Fake timers are avoided; the clear path is exercised by invoking the timer
// callback synchronously via a captured setTimeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Hud } from '../src/app/hud.js';
import type { UIElements } from '../src/types.js';

interface FakeEl { textContent: string; className: string; }
function el(): FakeEl { return { textContent: '', className: '' }; }

/** Build a Hud over fake elements, capturing the pending flash timer callback. */
function setupHud(withBanner: boolean) {
  const status = el();
  const playStatus = withBanner ? el() : null;
  const noop = () => {};
  // Minimal els: only the members Hud.flashStatus reads. Everything else is a
  // fake element so constructing the Hud never throws.
  const els = {
    status,
    playStatus,
    hudPieces: el(), hudSpeed: el(), hudScore: el(), hudCars: el(),
  } as unknown as UIElements;

  // Capture the timer so we can fire the clear synchronously without waiting 2s.
  let fired: (() => void) | null = null;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => { fired = fn; return 0 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout;

  const hud = new Hud(els);
  const restore = () => { globalThis.setTimeout = realSetTimeout; };
  return { hud, status, playStatus, clear: () => fired && fired(), restore, noop };
}

test('flashStatus mirrors the message + kind into the play banner', () => {
  const { hud, status, playStatus, restore } = setupHud(true);
  try {
    hud.flashStatus('Too fast for the corner! The car flew off the edge!', 'err');
    // Sidebar status line.
    assert.equal(status.textContent, 'Too fast for the corner! The car flew off the edge!');
    assert.equal(status.className, 'status err');
    // Play banner mirror.
    assert.ok(playStatus);
    assert.equal(playStatus!.textContent, 'Too fast for the corner! The car flew off the edge!');
    assert.equal(playStatus!.className, 'play-status err');
  } finally { restore(); }
});

test('flashStatus clears both surfaces when the flash expires', () => {
  const { hud, status, playStatus, clear, restore } = setupHud(true);
  try {
    hud.flashStatus('Track saved.', 'ok');
    assert.equal(playStatus!.className, 'play-status ok');
    clear(); // fire the pending timer callback
    assert.equal(status.textContent, '');
    assert.equal(status.className, 'status');
    assert.equal(playStatus!.textContent, '');
    assert.equal(playStatus!.className, 'play-status');
  } finally { restore(); }
});

test('flashStatus is a no-op on the banner when no play-status element exists', () => {
  // The banner element is optional (absent in the minimal test/DOM); Hud must
  // not throw when it is null.
  const { hud, status, restore } = setupHud(false);
  try {
    assert.doesNotThrow(() => hud.flashStatus('Removed Straight.', 'ok'));
    assert.equal(status.textContent, 'Removed Straight.');
  } finally { restore(); }
});
