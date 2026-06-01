// Tests for the Track data model.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';

test('a fresh Track is empty with default drop height 3', () => {
  const t = new Track();
  assert.equal(t.pieces.length, 0);
  assert.equal(t.dropHeight, 3);
  assert.equal(t.hasFinish(), false);
});

test('addPiece appends valid pieces and rejects unknown ids', () => {
  const t = new Track();
  assert.equal(t.addPiece('STRAIGHT'), true);
  assert.equal(t.addPiece('NOT_A_PIECE'), false);
  assert.equal(t.pieces.length, 1);
});

test('undo removes the last piece and returns its id', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  assert.equal(t.undo(), 'CURVE_R');
  assert.equal(t.pieces.length, 1);
});

test('clear empties the track', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('LOOP');
  t.clear();
  assert.equal(t.pieces.length, 0);
});

test('hasFinish only returns true when FINISH is the last piece', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('FINISH');
  assert.equal(t.hasFinish(), true);
});

test('canAdd is false after a FINISH piece', () => {
  const t = new Track();
  t.addPiece('FINISH');
  assert.equal(t.canAdd('STRAIGHT'), false);
  assert.equal(t.addPiece('STRAIGHT'), false);
});

test('entryStateAt(0) equals the start state', () => {
  const t = new Track();
  assert.deepEqual(t.entryStateAt(0), t.startState);
});

test('entryStateAt after two STRAIGHTs facing East is at (2, 0, 0, E)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  const s = t.cursorState();
  assert.deepEqual(s, { gx: 2, gy: 0, gz: 0, dir: 1 });
});

test('entryStateAt after CURVE_R puts cursor one cell south, facing south', () => {
  const t = new Track();
  t.addPiece('CURVE_R');
  const s = t.cursorState();
  assert.deepEqual(s, { gx: 0, gy: 1, gz: 0, dir: 2 });
});

test('totalPathLength sums each piece pathLen', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');     // 1.0
  t.addPiece('LOOP');         // 4.14
  t.addPiece('STRAIGHT');     // 1.0
  assert.ok(Math.abs(t.totalPathLength() - 6.14) < 1e-6);
});

test('toJSON / fromJSON round-trip preserves drop height and pieces', () => {
  const a = new Track();
  a.dropHeight = 5;
  ['STRAIGHT', 'CURVE_R', 'LOOP', 'FINISH'].forEach((id) => a.addPiece(id));

  const b = new Track();
  b.fromJSON(a.toJSON());
  assert.equal(b.dropHeight, 5);
  assert.deepEqual(b.pieces, ['STRAIGHT', 'CURVE_R', 'LOOP', 'FINISH']);
});

test('fromJSON ignores invalid piece ids and clamps drop height', () => {
  const t = new Track();
  t.fromJSON({ dropHeight: 999, pieces: ['STRAIGHT', 'GARBAGE', 'LOOP'] });
  assert.equal(t.dropHeight, 6);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'LOOP']);
});

// ---- deleteAt (removePieceAt) ----

test('deleteAt returns undefined for out-of-bounds index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  assert.equal(t.deleteAt(-1), undefined);
  assert.equal(t.deleteAt(1), undefined);
  assert.equal(t.deleteAt(99), undefined);
  assert.equal(t.pieces.length, 1);
});

test('deleteAt returns undefined on empty track', () => {
  const t = new Track();
  assert.equal(t.deleteAt(0), undefined);
});

test('deleteAt removes mid-array piece and shifts subsequent pieces', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  t.addPiece('LOOP');
  const removed = t.deleteAt(1);
  assert.equal(removed, 'CURVE_R');
  assert.deepEqual(t.pieces, ['STRAIGHT', 'LOOP']);
});

test('deleteAt removes first piece', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  const removed = t.deleteAt(0);
  assert.equal(removed, 'STRAIGHT');
  assert.deepEqual(t.pieces, ['CURVE_R']);
});

test('deleteAt removes last piece', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  const removed = t.deleteAt(1);
  assert.equal(removed, 'CURVE_R');
  assert.deepEqual(t.pieces, ['STRAIGHT']);
});

// ---- replaceAt (replacePieceAt) ----

test('replaceAt returns false for out-of-bounds index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  assert.equal(t.replaceAt(-1, 'LOOP'), false);
  assert.equal(t.replaceAt(1, 'LOOP'), false);
  assert.equal(t.replaceAt(99, 'LOOP'), false);
  assert.deepEqual(t.pieces, ['STRAIGHT']);
});

test('replaceAt returns false on empty track', () => {
  const t = new Track();
  assert.equal(t.replaceAt(0, 'LOOP'), false);
});

test('replaceAt changes the element at valid index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  t.addPiece('LOOP');
  const result = t.replaceAt(1, 'STRAIGHT');
  assert.equal(result, true);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'STRAIGHT', 'LOOP']);
});

test('replaceAt does not change array length', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  t.replaceAt(0, 'LOOP');
  assert.equal(t.pieces.length, 2);
  assert.deepEqual(t.pieces, ['LOOP', 'CURVE_R']);
});

// ---- frozen entries (editing mode) ----

test('deleteAt snapshots downstream positions (frozenEntries becomes non-null)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  assert.equal(t.isEditing(), false);
  t.deleteAt(1);
  assert.equal(t.isEditing(), true);
  assert.notEqual(t.frozenEntries, null);
});

test('downstream pieces keep frozen positions after deleteAt', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); // 0: (0,0,0,E) -> (1,0,0,E)
  t.addPiece('CURVE_R');  // 1: (1,0,0,E) -> (1,1,0,S)
  t.addPiece('STRAIGHT'); // 2: (1,1,0,S) -> (1,2,0,S)
  t.addPiece('STRAIGHT'); // 3: (1,2,0,S)
  // Entry for piece 2 before delete:
  const entryBefore = t.computeEntryAt(2);
  // Delete CURVE_R at index 1. Now pieces = [S, S, S]
  t.deleteAt(1);
  // Piece at index 1 now is what was at index 2 (first STRAIGHT after the curve).
  // Its rendered entry should still be the frozen position.
  const entryAfter = t.entryStateAt(1);
  assert.deepEqual(entryAfter, entryBefore);
});

test('insertAt creates a real piece that chains correctly', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); // index 0
  t.addPiece('STRAIGHT'); // index 1
  t.addPiece('STRAIGHT'); // index 2
  t.insertAt(1, 'CURVE_R');
  // pieces = [S, CURVE_R, S, S]
  assert.deepEqual(t.pieces, ['STRAIGHT', 'CURVE_R', 'STRAIGHT', 'STRAIGHT']);
  // The inserted CURVE_R should chain from the first STRAIGHT
  const insertedEntry = t.entryStateAt(1);
  assert.deepEqual(insertedEntry, { gx: 1, gy: 0, gz: 0, dir: 1 });
});

test('insertAt keeps downstream frozen', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); // 0
  t.addPiece('STRAIGHT'); // 1
  t.addPiece('STRAIGHT'); // 2
  // Entry for piece 1 before insert:
  const entry1Before = t.computeEntryAt(1);
  t.insertAt(1, 'CURVE_R');
  // Piece that was at index 1 is now at index 2. Its render position is frozen.
  const entry2After = t.entryStateAt(2);
  assert.deepEqual(entry2After, entry1Before);
});

test('rejoin clears frozen entries and recomputes downstream', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('CURVE_R'); t.addPiece('STRAIGHT');
  t.deleteAt(1); // delete CURVE_R, now [S, S]
  assert.equal(t.isEditing(), true);
  t.rejoin();
  assert.equal(t.isEditing(), false);
  // After rejoin, entry for piece 1 recomputes from actual pieces [S, S]
  const entry1 = t.entryStateAt(1);
  assert.deepEqual(entry1, { gx: 1, gy: 0, gz: 0, dir: 1 });
});

test('isComplete requires Finish and not editing', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('FINISH');
  assert.equal(t.isComplete(), true);
  // Now edit - delete and re-add to enter editing mode
  t.deleteAt(0);
  assert.equal(t.isEditing(), true);
  assert.equal(t.isComplete(), false);
  t.rejoin();
  // After rejoin, just FINISH remains
  assert.equal(t.isComplete(), true);
});

test('isComplete is false without a Finish', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('LOOP');
  assert.equal(t.isComplete(), false);
});

test('replaceAt enters editing mode and snapshots downstream', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  const entryBefore = t.computeEntryAt(2);
  t.replaceAt(1, 'CURVE_R');
  assert.equal(t.isEditing(), true);
  // Downstream (piece 2) keeps its frozen position
  const entryAfter = t.entryStateAt(2);
  assert.deepEqual(entryAfter, entryBefore);
});

test('multiple edits in same session share one snapshot', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  const entryLast = t.computeEntryAt(4);
  // First edit
  t.deleteAt(1);
  // Second edit
  t.insertAt(1, 'LOOP');
  // The frozen snapshot was taken on first edit; last piece stays frozen
  const lastEntry = t.entryStateAt(t.pieces.length - 1);
  assert.deepEqual(lastEntry, entryLast);
});

test('nonEmptyCount returns pieces.length (all pieces are real)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('LOOP'); t.addPiece('STRAIGHT');
  assert.equal(t.nonEmptyCount(), 3);
  t.deleteAt(1);
  assert.equal(t.nonEmptyCount(), 2);
});

test('clear resets editing state', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.deleteAt(1);
  assert.equal(t.isEditing(), true);
  t.clear();
  assert.equal(t.pieces.length, 0);
  assert.equal(t.isEditing(), false);
});

test('fromJSON clears editing state', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.deleteAt(0);
  assert.equal(t.isEditing(), true);
  t.fromJSON({ dropHeight: 3, pieces: ['LOOP', 'FINISH'] });
  assert.equal(t.isEditing(), false);
  assert.deepEqual(t.pieces, ['LOOP', 'FINISH']);
});

// ---- insertPieceAfter (legacy compat) ----

test('insertPieceAfter splices a new piece after the given index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  const ok = t.insertPieceAfter(0, 'LOOP');
  assert.equal(ok, true);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'LOOP', 'STRAIGHT', 'STRAIGHT']);
});

test('insertPieceAfter allows chaining multiple inserts', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('FINISH');
  t.insertPieceAfter(0, 'CURVE_L');
  t.insertPieceAfter(1, 'CURVE_R');
  t.insertPieceAfter(2, 'LOOP');
  assert.deepEqual(t.pieces, ['STRAIGHT', 'CURVE_L', 'CURVE_R', 'LOOP', 'FINISH']);
});

test('insertPieceAfter returns false for out-of-bounds index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  assert.equal(t.insertPieceAfter(5, 'LOOP'), false);
  assert.equal(t.insertPieceAfter(-2, 'LOOP'), false);
});

// ---- toJSON / fromJSON with the new model ----

test('toJSON does not include empties or gapOriginals', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('LOOP'); t.addPiece('FINISH');
  const json = t.toJSON();
  assert.equal('empties' in json, false);
  assert.equal('gapOriginals' in json, false);
  assert.equal('inserted' in json, false);
});

test('fromJSON tolerates legacy data with empties field', () => {
  const t = new Track();
  t.fromJSON({ dropHeight: 3, pieces: ['STRAIGHT', 'LOOP'], empties: [false, true] });
  // Legacy empties are ignored - all pieces are real
  assert.deepEqual(t.pieces, ['STRAIGHT', 'LOOP']);
  assert.equal(t.isEditing(), false);
});
