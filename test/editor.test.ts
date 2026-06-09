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
import type { GridState, PieceId } from '../src/types.js';

/** Minimal stand-in for a palette <button>: records click + hover listeners. */
class FakeButton {
  className = '';
  innerHTML = '';
  disabled = false;
  dataset: Record<string, string> = {};
  classList = { add: (_c: string) => {}, remove: (_c: string) => {} };
  private _onClick: (() => void) | null = null;
  private _onEnter: (() => void) | null = null;
  private _onLeave: (() => void) | null = null;

  addEventListener(type: string, handler: () => void): void {
    if (type === 'click') this._onClick = handler;
    if (type === 'mouseenter') this._onEnter = handler;
    if (type === 'mouseleave') this._onLeave = handler;
  }

  /** Fire the recorded click listener, mimicking a user clicking the button. */
  fireClick(): void {
    if (this._onClick) this._onClick();
  }

  /** Fire the recorded mouseenter listener, mimicking a hover. */
  fireHover(): void {
    if (this._onEnter) this._onEnter();
  }

  /** Fire the recorded mouseleave listener. */
  fireUnhover(): void {
    if (this._onLeave) this._onLeave();
  }
}

/** Records the anchor + kind of the most recent ghost request. */
interface GhostRecord {
  kind: 'append' | 'insert';
  pieceId: PieceId;
  anchor: GridState;
}

interface RendererCalls {
  rebuildTrack: number;
  clearGhost: number;
  rebuildGhost: number;
  rebuildGhostAt: number;
  highlightPiece: number;
  pickPiece: number;
  lastGhost: GhostRecord | null;
}

function makeRenderer(): { renderer: Renderer; calls: RendererCalls } {
  const calls: RendererCalls = {
    rebuildTrack: 0,
    clearGhost: 0,
    rebuildGhost: 0,
    rebuildGhostAt: 0,
    highlightPiece: 0,
    pickPiece: 0,
    lastGhost: null,
  };
  const fake = {
    rebuildTrack: () => { calls.rebuildTrack++; },
    clearGhost: () => { calls.clearGhost++; },
    // Mirror the real renderer's anchor choice (append point = cursorState).
    rebuildGhost: (track: Track, pieceId: PieceId) => {
      calls.rebuildGhost++;
      calls.lastGhost = { kind: 'append', pieceId, anchor: track.cursorState() };
    },
    // Mirror the real renderer's anchor choice (insert point = computeEntryAt).
    rebuildGhostAt: (track: Track, pieceId: PieceId, insertIndex: number) => {
      calls.rebuildGhostAt++;
      calls.lastGhost = { kind: 'insert', pieceId, anchor: track.computeEntryAt(insertIndex) };
    },
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
  hoverPiece: (id: PieceId) => void;
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

  const findBtn = (id: PieceId): FakeButton => {
    const btn = created.find((b) => b.dataset.pieceId === id);
    if (!btn) throw new Error(`no palette button for piece ${id}`);
    return btn;
  };
  const clickPiece = (id: PieceId): void => { findBtn(id).fireClick(); };
  const hoverPiece = (id: PieceId): void => { findBtn(id).fireHover(); };

  return { editor, track, calls, statusEl, clickPiece, hoverPiece };
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



// ===========================================================================
// Bug 2 — Ghost preview missing while filling a deleted gap
// ===========================================================================

// ---------------------------------------------------------------------------
// Property 3: Bug Condition — Ghost Renders at the Gap in Insert Mode
// ---------------------------------------------------------------------------
//
// In insert mode (insertCursor != null, selectedIndex == null, isEditing),
// including when the frozen suffix still ends in FINISH, hovering a palette
// piece SHALL produce a ghost anchored at computeEntryAt(insertCursor + 1).
// On the unfixed code _hover aborted (canAdd false with a trailing FINISH), so
// no ghost was built.
//
// Validates: Requirements 2.3

test('Bug 2 / Property 3: insert-mode hover builds a ghost at the gap despite a trailing FINISH', () => {
  const { editor, track, calls, clickPiece, hoverPiece } = setupEditor();
  clickPiece('STRAIGHT'); // 0
  clickPiece('STRAIGHT'); // 1
  clickPiece('FINISH');   // 2
  editor.selectPiece(1);
  editor.deleteSelected(); // pieces [S, FINISH]; insertCursor=0; editing; hasFinish
  assert.equal(track.isEditing(), true);
  assert.equal(track.hasFinish(), true);
  assert.equal(editor.insertCursor, 0);
  assert.equal(editor.selectedIndex, null);

  const ghostBefore = calls.rebuildGhostAt;
  hoverPiece('STRAIGHT');

  // A ghost was requested at the insert location (insertCursor + 1 = 1).
  assert.equal(calls.rebuildGhostAt, ghostBefore + 1);
  assert.ok(calls.lastGhost && calls.lastGhost.kind === 'insert');
  assert.equal(calls.lastGhost!.pieceId, 'STRAIGHT');
  assert.deepEqual(calls.lastGhost!.anchor, track.computeEntryAt(editor.insertCursor! + 1));
  assert.deepEqual(calls.lastGhost!.anchor, { gx: 1, gy: 0, gz: 0, dir: 1 });
});

// ---------------------------------------------------------------------------
// Property 4: Preservation — Append Ghost Unchanged
// ---------------------------------------------------------------------------
//
// For a non-editing track that can still accept a piece, hovering a palette
// piece still requests a ghost anchored at cursorState() (the append point).
//
// Validates: Requirements 3.4

test('Bug 2 / Property 4: append-mode hover still anchors the ghost at the cursor (end of track)', () => {
  const { track, calls, hoverPiece, clickPiece } = setupEditor();
  clickPiece('STRAIGHT'); // non-editing track that can still accept pieces
  assert.equal(track.isEditing(), false);

  hoverPiece('CURVE_R');

  assert.equal(calls.rebuildGhost, 1);
  assert.equal(calls.rebuildGhostAt, 0);
  assert.ok(calls.lastGhost && calls.lastGhost.kind === 'append');
  assert.equal(calls.lastGhost!.pieceId, 'CURVE_R');
  assert.deepEqual(calls.lastGhost!.anchor, track.cursorState());
});


// ===========================================================================
// Bug 3 — Undo removes the wrong piece in insert mode
// ===========================================================================

// ---------------------------------------------------------------------------
// Property 5: Bug Condition — Undo Removes the Just-Laid Piece in Insert Mode
// ---------------------------------------------------------------------------
//
// In insert mode with a session piece laid, Undo SHALL remove the live piece at
// the insert cursor, step insertCursor back, and leave the frozen downstream
// suffix (frozenEntries + trailing FINISH) intact and still editing. On the
// unfixed code Track.undo() popped the trailing FINISH instead.
//
// Validates: Requirements 2.4

test('Bug 3 / Property 5: insert-mode undo removes the just-laid piece, keeps FINISH + frozen', () => {
  const { editor, track, clickPiece } = setupEditor();
  clickPiece('STRAIGHT'); // 0
  clickPiece('STRAIGHT'); // 1
  clickPiece('FINISH');   // 2
  editor.selectPiece(1);
  editor.deleteSelected(); // [S, FINISH]; insertCursor=0; editing
  const frozenBefore = JSON.stringify(track.frozenEntries);

  clickPiece('STRAIGHT'); // insert into the gap -> [S, STRAIGHT, FINISH]; insertCursor=1
  assert.deepEqual(track.pieces, ['STRAIGHT', 'STRAIGHT', 'FINISH']);
  assert.equal(editor.insertCursor, 1);

  editor.undo();

  // The just-laid STRAIGHT is removed; the trailing FINISH and the frozen suffix
  // stay intact; the cursor steps back; still editing.
  assert.deepEqual(track.pieces, ['STRAIGHT', 'FINISH']);
  assert.equal(track.hasFinish(), true);
  assert.equal(editor.insertCursor, 0);
  assert.equal(track.isEditing(), true);
  assert.equal(JSON.stringify(track.frozenEntries), frozenBefore);
});

// ---------------------------------------------------------------------------
// Property 6: Preservation — Append Undo Unchanged
// ---------------------------------------------------------------------------
//
// For a non-editing track, Undo removes the last appended piece, exactly as
// before.
//
// Validates: Requirements 3.5

test('Bug 3 / Property 6: append-mode undo still removes the last appended piece', () => {
  const { editor, track, clickPiece } = setupEditor();
  clickPiece('STRAIGHT');
  clickPiece('CURVE_R');
  assert.equal(track.isEditing(), false);

  editor.undo();

  assert.deepEqual(track.pieces, ['STRAIGHT']);
  assert.equal(track.isEditing(), false);
});

test('Bug 3: insert-mode undo with no session piece laid leaves the frozen suffix untouched', () => {
  const { editor, track, clickPiece } = setupEditor();
  clickPiece('STRAIGHT'); // 0
  clickPiece('STRAIGHT'); // 1
  clickPiece('FINISH');   // 2
  editor.selectPiece(1);
  editor.deleteSelected(); // [S, FINISH]; insertCursor=0=insertAnchor; nothing laid yet
  const piecesBefore = [...track.pieces];

  editor.undo(); // no session piece -> must not pop the frozen FINISH

  assert.deepEqual(track.pieces, piecesBefore);
  assert.equal(track.isEditing(), true);
  assert.equal(editor.insertCursor, 0);
});
