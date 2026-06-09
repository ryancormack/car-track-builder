// Tests for the Editor's collision feedback (Requirements 4.1–4.4, 7.3).
//
// The Editor needs a DOM (palette buttons, status line) and a Renderer. The
// project has no DOM library (jsdom/happy-dom), so we hand-roll the minimal
// fakes the Editor actually touches:
//   * a fake `document.createElement` that returns FakeButton objects recording
//     their click listener and `dataset.pieceId` (so we can drive placements by
//     invoking the relevant palette button's click handler — `_add` is private
//     and only reachable through button clicks);
//   * a fake `paletteEl` exposing the `innerHTML` setter + `appendChild` that
//     `_build` calls;
//   * a fake `statusEl` exposing the `textContent` / `className` members that
//     `_setStatus` writes;
//   * a fake `renderer` that counts the calls the Editor makes (`rebuildTrack`,
//     `clearGhost`, `rebuildGhost`, `highlightPiece`, `pickPiece`).
// All fakes are cast through `unknown` to the real DOM / Renderer types.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Editor } from '../src/editor.js';
import type { Renderer } from '../src/renderer/index.js';
import type { PieceId } from '../src/types.js';

/** Minimal stand-in for a palette <button>: records its click listener + dataset. */
class FakeButton {
  className = '';
  innerHTML = '';
  disabled = false;
  dataset: Record<string, string> = {};
  classList = { add: (_c: string) => {}, remove: (_c: string) => {} };
  private _onClick: (() => void) | null = null;

  addEventListener(type: string, handler: () => void): void {
    if (type === 'click') this._onClick = handler;
  }

  /** Fire the recorded click listener, mimicking a user clicking the button. */
  fireClick(): void {
    if (this._onClick) this._onClick();
  }
}

interface RendererCalls {
  rebuildTrack: number;
  clearGhost: number;
  rebuildGhost: number;
  highlightPiece: number;
  pickPiece: number;
}

function makeRenderer(): { renderer: Renderer; calls: RendererCalls } {
  const calls: RendererCalls = {
    rebuildTrack: 0,
    clearGhost: 0,
    rebuildGhost: 0,
    highlightPiece: 0,
    pickPiece: 0,
  };
  const fake = {
    rebuildTrack: () => { calls.rebuildTrack++; },
    clearGhost: () => { calls.clearGhost++; },
    rebuildGhost: () => { calls.rebuildGhost++; },
    highlightPiece: (_i: number | null) => { calls.highlightPiece++; },
    pickPiece: () => { calls.pickPiece++; return null; },
  };
  return { renderer: fake as unknown as Renderer, calls };
}

interface Harness {
  editor: Editor;
  track: Track;
  calls: RendererCalls;
  statusEl: HTMLElement;
  clickPiece: (id: PieceId) => void;
}

/**
 * Build an Editor wired to fakes. Installs a fake `document` so the Editor's
 * constructor (`_build`) can create palette buttons, then returns helpers to
 * drive placements and inspect feedback.
 */
function setupEditor(opts?: { dropHeight?: number }): Harness {
  const created: FakeButton[] = [];
  globalThis.document = {
    createElement: (_tag: string) => {
      const btn = new FakeButton();
      created.push(btn);
      return btn as unknown as HTMLButtonElement;
    },
  } as unknown as Document;

  const track = new Track();
  if (opts?.dropHeight !== undefined) track.dropHeight = opts.dropHeight;

  const { renderer, calls } = makeRenderer();
  const statusEl = { textContent: '', className: '' } as unknown as HTMLElement;
  const paletteEl = { innerHTML: '', appendChild: (_child: unknown) => {} } as unknown as HTMLElement;

  const editor = new Editor({ track, renderer, paletteEl, statusEl });

  const clickPiece = (id: PieceId): void => {
    const btn = created.find((b) => b.dataset.pieceId === id);
    if (!btn) throw new Error(`no palette button for piece ${id}`);
    btn.fireClick();
  };

  return { editor, track, calls, statusEl, clickPiece };
}

// ---- floor violation feedback (Requirement 4.1) ----

test('floor violation shows the floor message with err kind', () => {
  // dropHeight=0 removes the cushion, so RAMP_DN's descent breaks the floor.
  const { track, statusEl, clickPiece } = setupEditor({ dropHeight: 0 });
  clickPiece('RAMP_DN');
  assert.equal(track.pieces.length, 0); // placement rejected, track unchanged
  assert.equal(statusEl.textContent, 'Cannot place: piece would go below floor level.');
  assert.equal(statusEl.className, 'status err');
});

// ---- overlap violation feedback, normal mode (Requirement 4.2) ----

test('overlap violation (normal mode) shows the existing-track message with err kind', () => {
  const { track, statusEl, clickPiece } = setupEditor();
  // U-turn back over the start cell: same geometry as the Track overlap test.
  clickPiece('STRAIGHT');
  clickPiece('CURVE_R');
  clickPiece('STRAIGHT');
  clickPiece('CURVE_R');
  clickPiece('CURVE_R');
  assert.equal(track.pieces.length, 5);
  // A JUMP from (0,1,0,N) lands on the occupied start cell (0,0,0) -> overlap.
  clickPiece('JUMP');
  assert.equal(track.pieces.length, 5); // rejected, unchanged
  assert.equal(statusEl.textContent, 'Cannot place: collides with existing track.');
  assert.equal(statusEl.className, 'status err');
});

// ---- overlap violation feedback, editing/downstream mode (Requirement 7.3) ----

test('overlap with frozen downstream (editing mode) shows the downstream message with err kind', () => {
  const { editor, track, statusEl, clickPiece } = setupEditor();
  // Build [S,S,S,S] heading East, then delete index 1 to enter editing mode.
  clickPiece('STRAIGHT');
  clickPiece('STRAIGHT');
  clickPiece('STRAIGHT');
  clickPiece('STRAIGHT');
  editor.selectPiece(1);
  editor.deleteSelected(); // pieces [S,S,S]; frozen suffix at (2,0,0),(3,0,0); insertCursor=0
  assert.equal(track.isEditing(), true);
  // Clicking now inserts at cursor+1 = index 1. A JUMP there lands on (2,0,0),
  // which is occupied by the frozen downstream -> auto-detected overlap (Req 7).
  clickPiece('JUMP');
  assert.deepEqual(track.pieces, ['STRAIGHT', 'STRAIGHT', 'STRAIGHT']); // unchanged
  assert.equal(track.isEditing(), true);
  assert.equal(statusEl.textContent, 'Cannot place: collides with downstream track.');
  assert.equal(statusEl.className, 'status err');
});

// ---- rejected placement must not touch the renderer (Requirement 4.4) ----

test('a rejected placement does not rebuild the track or clear the ghost', () => {
  const { track, calls, statusEl, clickPiece } = setupEditor({ dropHeight: 0 });
  // Sanity: construction alone performs no renderer mutations.
  assert.equal(calls.rebuildTrack, 0);
  assert.equal(calls.clearGhost, 0);
  clickPiece('RAMP_DN'); // floor violation -> rejected
  assert.equal(track.pieces.length, 0);
  assert.equal(statusEl.className, 'status err');
  // Req 4.4: no rebuildTrack, no clearGhost side effect on rejection.
  assert.equal(calls.rebuildTrack, 0);
  assert.equal(calls.clearGhost, 0);
});

// ---- successful placement rebuilds and reports success (sanity) ----

test('a successful placement rebuilds the track and shows the success message', () => {
  const { track, calls, statusEl, clickPiece } = setupEditor();
  clickPiece('STRAIGHT');
  assert.deepEqual(track.pieces, ['STRAIGHT']);
  assert.equal(statusEl.textContent, 'Added Straight.');
  assert.equal(statusEl.className, 'status ok');
  assert.equal(calls.rebuildTrack, 1);
  assert.equal(calls.clearGhost, 1);
});
