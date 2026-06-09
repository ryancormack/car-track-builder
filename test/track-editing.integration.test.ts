// Integration tests for the full track-editing flow exercising all four bug
// fixes end to end (Bugs 1-4). Drives the real Track together with the Editor
// wired to minimal DOM / Renderer fakes (mirroring test/editor.test.ts) so the
// hover-ghost and insert-undo steps go through the real Editor code paths.
//
// Happy path: append a complete track ending in FINISH -> select & delete a mid
// piece -> hover (a ghost is requested at the gap) -> insert into the gap ->
// undo (the laid piece is removed while FINISH/frozen stay intact) -> rejoin
// (the track becomes continuous and editing ends) -> isComplete() is true.
//
// Negative reconnection: reroute the gap so the recomputed downstream is invalid
// -> rejoin stays in editing mode and returns false.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { Editor } from '../src/editor.js';
import type { Renderer } from '../src/renderer/index.js';
import type { GridState, PieceId } from '../src/types.js';

class FakeButton {
  dataset: Record<string, string> = {};
  className = '';
  innerHTML = '';
  disabled = false;
  classList = { add: (_c: string) => {}, remove: (_c: string) => {} };
  private _onClick: (() => void) | null = null;
  private _onEnter: (() => void) | null = null;

  addEventListener(type: string, handler: () => void): void {
    if (type === 'click') this._onClick = handler;
    if (type === 'mouseenter') this._onEnter = handler;
  }
  fireClick(): void { if (this._onClick) this._onClick(); }
  fireHover(): void { if (this._onEnter) this._onEnter(); }
}

interface GhostRecord {
  kind: 'append' | 'insert';
  pieceId: PieceId;
  anchor: GridState;
}

function makeRenderer(): { renderer: Renderer; ghost: { last: GhostRecord | null; insertCount: number } } {
  const ghost = { last: null as GhostRecord | null, insertCount: 0 };
  const fake = {
    rebuildTrack: () => {},
    clearGhost: () => {},
    rebuildGhost: (track: Track, pieceId: PieceId) => {
      ghost.last = { kind: 'append', pieceId, anchor: track.cursorState() };
    },
    rebuildGhostAt: (track: Track, pieceId: PieceId, insertIndex: number) => {
      ghost.insertCount++;
      ghost.last = { kind: 'insert', pieceId, anchor: track.computeEntryAt(insertIndex) };
    },
    highlightPiece: (_i: number | null) => {},
    pickPiece: () => null,
  };
  return { renderer: fake as unknown as Renderer, ghost };
}

function setup() {
  const created: FakeButton[] = [];
  globalThis.document = {
    createElement: (_tag: string) => {
      const btn = new FakeButton();
      created.push(btn);
      return btn as unknown as HTMLButtonElement;
    },
  } as unknown as Document;

  const track = new Track();
  const { renderer, ghost } = makeRenderer();
  const statusEl = { textContent: '', className: '' } as unknown as HTMLElement;
  const paletteEl = { innerHTML: '', appendChild: (_c: unknown) => {} } as unknown as HTMLElement;
  const editor = new Editor({ track, renderer, paletteEl, statusEl });

  const btn = (id: PieceId): FakeButton => {
    const b = created.find((x) => x.dataset.pieceId === id);
    if (!b) throw new Error(`no palette button for ${id}`);
    return b;
  };
  return {
    track, editor, ghost,
    click: (id: PieceId) => btn(id).fireClick(),
    hover: (id: PieceId) => btn(id).fireHover(),
  };
}

test('full edit flow: append -> delete -> hover ghost at gap -> insert -> undo -> rejoin -> complete', () => {
  const { track, editor, ghost, click, hover } = setup();

  // Append a complete track ending in FINISH.
  click('STRAIGHT'); // 0
  click('STRAIGHT'); // 1
  click('STRAIGHT'); // 2
  click('FINISH');   // 3
  assert.deepEqual(track.pieces, ['STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH']);
  assert.equal(track.isComplete(), true);

  // Select & delete a mid piece -> insert mode at the gap (Bug 2/3 setup).
  editor.selectPiece(1);
  editor.deleteSelected();
  assert.equal(track.isEditing(), true);
  assert.equal(track.hasFinish(), true);
  assert.equal(editor.insertCursor, 0);
  const frozenAfterDelete = JSON.stringify(track.frozenEntries);

  // Hover a palette piece: a ghost is requested at the gap (Bug 2), even though
  // the frozen suffix still ends in FINISH.
  hover('STRAIGHT');
  assert.equal(ghost.insertCount, 1);
  assert.ok(ghost.last && ghost.last.kind === 'insert');
  assert.deepEqual(ghost.last!.anchor, track.computeEntryAt(editor.insertCursor! + 1));

  // Insert a piece into the gap.
  click('STRAIGHT');
  assert.deepEqual(track.pieces, ['STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH']);
  assert.equal(editor.insertCursor, 1);
  assert.equal(track.isEditing(), true);

  // Undo removes the just-laid piece (Bug 3); FINISH and the frozen suffix stay.
  editor.undo();
  assert.deepEqual(track.pieces, ['STRAIGHT', 'STRAIGHT', 'FINISH']);
  assert.equal(track.hasFinish(), true);
  assert.equal(editor.insertCursor, 0);
  assert.equal(track.isEditing(), true);
  assert.equal(JSON.stringify(track.frozenEntries), frozenAfterDelete);

  // Rejoin re-anchors the downstream and makes the track continuous (Bug 4).
  assert.equal(track.rejoin(), true);
  editor.deselectPiece();
  assert.equal(track.isEditing(), false);
  // Continuous: every piece chains from the start.
  assert.deepEqual(track.entryStateAt(0), { gx: 0, gy: 0, gz: 0, dir: 1 });
  assert.deepEqual(track.entryStateAt(1), { gx: 1, gy: 0, gz: 0, dir: 1 });
  assert.deepEqual(track.entryStateAt(2), { gx: 2, gy: 0, gz: 0, dir: 1 });
  // Play mode is reachable.
  assert.equal(track.isComplete(), true);
});

test('full edit flow: insert keeps a rerouted section, rejoin extends the track and completes', () => {
  const { track, editor, click } = setup();
  click('STRAIGHT'); click('STRAIGHT'); click('FINISH'); // [S,S,FINISH]
  editor.selectPiece(1);
  editor.deleteSelected(); // [S, FINISH]; insertCursor=0

  // Build a LONGER section into the gap than what was removed.
  click('STRAIGHT'); // insert -> [S, S, FINISH], insertCursor=1
  click('STRAIGHT'); // insert -> [S, S, S, FINISH], insertCursor=2
  assert.deepEqual(track.pieces, ['STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH']);

  assert.equal(track.rejoin(), true);
  editor.deselectPiece();
  assert.equal(track.isEditing(), false);
  assert.equal(track.isComplete(), true);
  assert.deepEqual(track.entryStateAt(3), { gx: 3, gy: 0, gz: 0, dir: 1 });
});

test('negative reconnection: a reroute that folds the downstream back over the live region stays editing', () => {
  // Build [S, S, FINISH], delete the middle piece, then reroute the gap with a
  // U-turn (three right curves). After re-anchoring, the recomputed chain would
  // drive a curve back onto the start cell (an overlap), so rejoin refuses.
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('FINISH');
  t.deleteAt(1); // [S, FINISH]; FINISH frozen downstream
  assert.equal(t.isEditing(), true);
  assert.equal(t.insertAt(1, 'CURVE_R'), true);
  assert.equal(t.insertAt(2, 'CURVE_R'), true);
  assert.equal(t.insertAt(3, 'CURVE_R'), true);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'CURVE_R', 'CURVE_R', 'CURVE_R', 'FINISH']);

  // The recomputed downstream folds back over the live region -> non-connect.
  assert.equal(t.rejoin(), false);
  assert.equal(t.isEditing(), true); // user can keep building or undo
});
