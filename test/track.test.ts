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

// ---- removePieceAt ----

test('removePieceAt returns undefined for out-of-bounds index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  assert.equal(t.removePieceAt(-1), undefined);
  assert.equal(t.removePieceAt(1), undefined);
  assert.equal(t.removePieceAt(99), undefined);
  assert.equal(t.pieces.length, 1);
});

test('removePieceAt returns undefined on empty track', () => {
  const t = new Track();
  assert.equal(t.removePieceAt(0), undefined);
});

test('removePieceAt removes mid-array piece and shifts subsequent pieces', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  t.addPiece('LOOP');
  const removed = t.removePieceAt(1);
  assert.equal(removed, 'CURVE_R');
  assert.deepEqual(t.pieces, ['STRAIGHT', 'LOOP']);
});

test('removePieceAt removes first piece', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  const removed = t.removePieceAt(0);
  assert.equal(removed, 'STRAIGHT');
  assert.deepEqual(t.pieces, ['CURVE_R']);
});

test('removePieceAt removes last piece', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  const removed = t.removePieceAt(1);
  assert.equal(removed, 'CURVE_R');
  assert.deepEqual(t.pieces, ['STRAIGHT']);
});

// ---- replacePieceAt ----

test('replacePieceAt returns false for out-of-bounds index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  assert.equal(t.replacePieceAt(-1, 'LOOP'), false);
  assert.equal(t.replacePieceAt(1, 'LOOP'), false);
  assert.equal(t.replacePieceAt(99, 'LOOP'), false);
  assert.deepEqual(t.pieces, ['STRAIGHT']);
});

test('replacePieceAt returns false on empty track', () => {
  const t = new Track();
  assert.equal(t.replacePieceAt(0, 'LOOP'), false);
});

test('replacePieceAt changes the element at valid index', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  t.addPiece('LOOP');
  const result = t.replacePieceAt(1, 'STRAIGHT');
  assert.equal(result, true);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'STRAIGHT', 'LOOP']);
});

test('replacePieceAt does not change array length', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  t.replacePieceAt(0, 'LOOP');
  assert.equal(t.pieces.length, 2);
  assert.deepEqual(t.pieces, ['LOOP', 'CURVE_R']);
});


// ---- empties / gap delete ----

test('addPiece keeps empties parallel and all false', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('LOOP');
  assert.equal(t.empties.length, t.pieces.length);
  assert.equal(t.isEmptyAt(0), false);
  assert.equal(t.isEmptyAt(1), false);
});

test('emptyPieceAt marks a mid-track slot as a gap without shifting pieces', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); // 0
  t.addPiece('STRAIGHT'); // 1
  t.addPiece('STRAIGHT'); // 2
  const id = t.emptyPieceAt(1);
  assert.equal(id, 'STRAIGHT');
  assert.equal(t.pieces.length, 3);          // not spliced
  assert.deepEqual(t.pieces, ['STRAIGHT', 'STRAIGHT', 'STRAIGHT']);
  assert.equal(t.isEmptyAt(1), true);
  assert.equal(t.hasGaps(), true);
});

test('emptyPieceAt preserves downstream geometry (no compression)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  const before = t.cursorState();
  t.emptyPieceAt(1); // gap the middle straight
  // The end of the track should not move, because the gap keeps the footprint.
  assert.deepEqual(t.cursorState(), before);
});

test('emptyPieceAt on the trailing slot removes it instead of leaving a gap', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('CURVE_R');
  const id = t.emptyPieceAt(1);
  assert.equal(id, 'CURVE_R');
  assert.equal(t.pieces.length, 1);
  assert.equal(t.hasGaps(), false);
});

test('emptyPieceAt twice on the same slot closes the gap', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.emptyPieceAt(1);              // first: leaves a gap
  assert.equal(t.isEmptyAt(1), true);
  const id = t.emptyPieceAt(1);   // second: splices it out
  assert.equal(id, 'STRAIGHT');
  assert.deepEqual(t.pieces, ['STRAIGHT', 'STRAIGHT']);
  assert.equal(t.hasGaps(), false);
});

test('replacePieceAt on a gap changes the piece but keeps it marked empty until rejoin', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.emptyPieceAt(1);
  assert.equal(t.isEmptyAt(1), true);
  t.replacePieceAt(1, 'LOOP');
  // The visible piece is now LOOP, but the slot is still "unjoined" (empty flag stays).
  assert.equal(t.isEmptyAt(1), true);
  assert.equal(t.isFilledGap(1), true);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'LOOP', 'STRAIGHT']);
  // After rejoin, empty flag is cleared.
  t.rejoin();
  assert.equal(t.isEmptyAt(1), false);
  assert.equal(t.isFilledGap(1), false);
});

test('nonEmptyCount ignores gaps', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.emptyPieceAt(1);
  assert.equal(t.nonEmptyCount(), 2);
  assert.equal(t.pieces.length, 3);
});

test('removePieceAt keeps empties aligned when closing a gap before it', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); // 0
  t.addPiece('CURVE_R');  // 1
  t.addPiece('LOOP');     // 2
  t.emptyPieceAt(2 - 1);  // gap the CURVE_R at index 1 (not trailing)
  assert.equal(t.isEmptyAt(1), true);
  t.removePieceAt(0);     // compress-remove the first straight
  // The gap should now travel with its piece to index 0.
  assert.deepEqual(t.pieces, ['CURVE_R', 'LOOP']);
  assert.equal(t.isEmptyAt(0), true);
  assert.equal(t.isEmptyAt(1), false);
});

test('undo pops both pieces and empties', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('LOOP');
  t.undo();
  assert.equal(t.pieces.length, 1);
  assert.equal(t.empties.length, 1);
});

test('clear resets empties too', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.emptyPieceAt(1);
  t.clear();
  assert.equal(t.pieces.length, 0);
  assert.equal(t.empties.length, 0);
  assert.equal(t.hasGaps(), false);
});

// ---- hasFinish / isComplete with gaps ----

test('hasFinish is false when the Finish slot is emptied', () => {
  const t = new Track();
  t.addPiece('STRAIGHT');
  t.addPiece('FINISH');
  // Force the finish slot to be a gap (bypassing the trailing-splice nicety).
  t.empties[1] = true;
  assert.equal(t.hasFinish(), false);
});

test('isComplete requires a Finish and no gaps (including filled-but-unjoined)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); // 0
  t.addPiece('STRAIGHT'); // 1
  t.addPiece('FINISH');   // 2
  assert.equal(t.isComplete(), true);
  t.emptyPieceAt(1);      // open a gap in the middle
  assert.equal(t.isComplete(), false);
  assert.equal(t.hasGaps(), true);
  t.replacePieceAt(1, 'LOOP'); // fill it — but still unjoined
  assert.equal(t.isComplete(), false); // not complete until rejoined
  assert.equal(t.hasPendingFills(), true);
  t.rejoin();
  assert.equal(t.isComplete(), true);
});

test('isComplete is false without a Finish', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('LOOP');
  assert.equal(t.isComplete(), false);
});

test('totalPathLength skips gaps', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); // 1.0
  t.addPiece('LOOP');     // 4.14
  t.addPiece('STRAIGHT'); // 1.0
  t.emptyPieceAt(1);      // gap the loop
  assert.ok(Math.abs(t.totalPathLength() - 2.0) < 1e-6);
});

test('toJSON / fromJSON round-trip preserves gaps', () => {
  const a = new Track();
  ['STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH'].forEach((id) => a.addPiece(id));
  a.emptyPieceAt(1);
  const b = new Track();
  b.fromJSON(a.toJSON());
  assert.deepEqual(b.pieces, ['STRAIGHT', 'STRAIGHT', 'STRAIGHT', 'FINISH']);
  assert.equal(b.isEmptyAt(1), true);
  assert.equal(b.nonEmptyCount(), 3);
});

test('fromJSON tolerates a missing empties array', () => {
  const t = new Track();
  t.fromJSON({ dropHeight: 3, pieces: ['STRAIGHT', 'LOOP'] });
  assert.equal(t.empties.length, 2);
  assert.equal(t.hasGaps(), false);
});

// ---- rejoin behaviour ----

test('rejoin clears all empties and gapOriginals', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.emptyPieceAt(0);
  t.emptyPieceAt(1);
  t.replacePieceAt(0, 'LOOP');
  t.replacePieceAt(1, 'BOOSTER');
  assert.equal(t.hasGaps(), true);
  assert.equal(t.hasPendingFills(), true);
  t.rejoin();
  assert.equal(t.hasGaps(), false);
  assert.equal(t.hasPendingFills(), false);
  assert.deepEqual(t.pieces, ['LOOP', 'BOOSTER', 'STRAIGHT']);
});

test('filling a gap does NOT move downstream geometry until rejoin', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  const beforeCursor = t.cursorState();
  t.emptyPieceAt(1);
  // Downstream unchanged after gap creation.
  assert.deepEqual(t.cursorState(), beforeCursor);
  // Fill the gap with a CURVE_R (different footprint).
  t.replacePieceAt(1, 'CURVE_R');
  // Downstream STILL unchanged because the gap original footprint is used.
  assert.deepEqual(t.cursorState(), beforeCursor);
  // After rejoin, the new piece's geometry takes effect and downstream shifts.
  t.rejoin();
  assert.notDeepEqual(t.cursorState(), beforeCursor);
});

test('hasPendingFills is false when gap piece matches original', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.emptyPieceAt(1);
  // Replace with the same piece — not really a "pending fill" conceptually.
  t.replacePieceAt(1, 'STRAIGHT');
  // The implementation checks pieces[i] !== gapOriginals[i], so same-id means no pending fill.
  assert.equal(t.isFilledGap(1), false);
  assert.equal(t.hasPendingFills(), false);
});

test('replacePieceAt on a non-gap slot still works immediately (no gap state)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.replacePieceAt(1, 'LOOP');
  assert.equal(t.isEmptyAt(1), false);
  assert.equal(t.isFilledGap(1), false);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'LOOP', 'STRAIGHT']);
});
