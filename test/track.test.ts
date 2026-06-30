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

test('rejoin clears frozen entries and recomputes downstream when connection matches', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('CURVE_R'); t.addPiece('STRAIGHT');
  t.deleteAt(1); // delete CURVE_R, now [S, S], downstream STRAIGHT frozen
  assert.equal(t.isEditing(), true);
  // Rebuild the curve so the live region reconnects to the frozen suffix.
  assert.equal(t.insertAt(1, 'CURVE_R'), true); // back to [S, C, S]
  // Connection matches the frozen entry, so rejoin succeeds and clears.
  assert.equal(t.rejoin(), true);
  assert.equal(t.isEditing(), false);
  // After rejoin, entry for piece 1 recomputes from actual pieces [S, C, S]
  const entry1 = t.entryStateAt(1);
  assert.deepEqual(entry1, { gx: 1, gy: 0, gz: 0, dir: 1 });
});

test('rejoin re-anchors and reconnects after closing a gap of a different length (Bug 4)', () => {
  // Delete a turning piece so the live exit no longer equals the original frozen
  // [0] snapshot. The old exact-match gate returned false; the re-anchor fix
  // reconnects by recomputing the downstream from the live exit.
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('CURVE_R'); t.addPiece('STRAIGHT');
  t.deleteAt(1); // [S, S]; live exit (2,0,0,E) != frozen snapshot (1,1,0,S)
  assert.equal(t.isEditing(), true);
  assert.equal(t.rejoin(), true);
  assert.equal(t.isEditing(), false);
  // The downstream re-anchored onto the live exit: the track is continuous.
  assert.deepEqual(t.entryStateAt(0), { gx: 0, gy: 0, gz: 0, dir: 1 });
  assert.deepEqual(t.entryStateAt(1), { gx: 1, gy: 0, gz: 0, dir: 1 });
});

test('rejoin re-anchors a moved downstream after rebuilding a section of different length (Bug 4)', () => {
  // Build a track ending in FINISH, delete a mid piece, then rebuild the gap
  // with TWO pieces (a different length than the single piece removed). The
  // downstream FINISH re-anchors onto the new live exit and the track reconnects.
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('FINISH');
  t.deleteAt(1); // [S, FINISH]; FINISH frozen at (2,0,0,E)
  assert.equal(t.isEditing(), true);
  assert.equal(t.insertAt(1, 'STRAIGHT'), true); // [S, S, FINISH]
  assert.equal(t.insertAt(2, 'STRAIGHT'), true); // [S, S, S, FINISH] — longer than original
  assert.equal(t.rejoin(), true);
  assert.equal(t.isEditing(), false);
  assert.equal(t.isComplete(), true);
  // FINISH (last piece) re-chains continuously from the rebuilt section.
  assert.deepEqual(t.entryStateAt(3), { gx: 3, gy: 0, gz: 0, dir: 1 });
});

test('rejoin returns false and stays editing when the recomputed downstream is invalid', () => {
  // A genuine non-connect: after re-anchoring, the recomputed chain drives a
  // piece below the floor (gz = 0). Build [RAMP_UP, RAMP_DN, S] (valid: gz
  // 0->1->0->0), then delete the leading RAMP_UP. Re-chained from the ground the
  // RAMP_DN now sinks to gz -1, so rejoin must refuse and stay editing.
  const t = new Track();
  t.addPiece('RAMP_UP'); t.addPiece('RAMP_DN'); t.addPiece('STRAIGHT');
  t.deleteAt(0); // pieces [RAMP_DN, S]; downstream frozen
  assert.equal(t.isEditing(), true);
  assert.equal(t.rejoin(), false);
  assert.equal(t.isEditing(), true); // editing mode preserved
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
  // Rebuild the deleted STRAIGHT so the live region reconnects to FINISH.
  assert.equal(t.insertAt(0, 'STRAIGHT'), true);
  assert.equal(t.rejoin(), true);
  // After rejoin, the track is [STRAIGHT, FINISH] again and complete
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

test('deleting a middle piece does not move the pieces before it (no overlap)', () => {
  const t = new Track();
  for (let i = 0; i < 5; i++) t.addPiece('STRAIGHT'); // [S,S,S,S,S] heading East
  const before0 = t.computeEntryAt(0);
  const before1 = t.computeEntryAt(1);
  t.deleteAt(2);
  // Pieces before the gap (indices 0,1) must stay exactly where they were.
  assert.deepEqual(t.entryStateAt(0), before0);
  assert.deepEqual(t.entryStateAt(1), before1);
  // The piece now at index 2 (originally index 3) stays frozen at gx=3,
  // i.e. it does NOT slide back to overlap the pieces before the gap.
  assert.deepEqual(t.entryStateAt(2), { gx: 3, gy: 0, gz: 0, dir: 1 });
  assert.deepEqual(t.entryStateAt(3), { gx: 4, gy: 0, gz: 0, dir: 1 });
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


// ---- collision integration (Task 3.6) ----
//
// Behaviour grounded in src/track.ts + src/collision.ts:
//   * Floor checks use the dropHeight offset and include the piece's EXIT cell
//     (computeCells excludes the exit, so a single-cell descent is caught via it).
//   * Overlap checks exclude a piece's entry cell (the connection point shared
//     with its predecessor). A piece's entry cell (computeCells i=0) is always
//     that connection point, so a single-cell piece (forward=1) can never trip
//     the overlap rule on its own seam — only cells at i>=1 of a multi-cell
//     piece (e.g. JUMP, forward=2) are checked against the occupied set. The
//     overlap tests below therefore use a multi-cell JUMP whose i=1 cell lands
//     on a genuinely occupied cell.
//   * rejoin() match/mismatch is already covered above (Task 3.5), so it is not
//     duplicated here.

test('addPiece rejects a floor-violating piece (dropHeight=0, descending exit gz<0)', () => {
  const t = new Track();
  t.dropHeight = 0; // remove the cushion so a single descent breaks the floor
  // RAMP_DN at the build plane: owned cell {0,0,0} is fine, but its EXIT cell
  // {1,0,-1} sits below the floor once dropHeight no longer offsets it.
  const ok = t.addPiece('RAMP_DN');
  assert.equal(ok, false);
  assert.equal(t.pieces.length, 0); // unchanged
  const res = t.lastCollisionResult;
  assert.ok(res && !res.ok, 'expected a rejection result');
  if (res && !res.ok) {
    assert.equal(res.reason, 'floor');
    assert.deepEqual(res.cell, { gx: 1, gy: 0, gz: -1 });
  }
});

test('addPiece rejects an overlapping piece (multi-cell JUMP revisits an occupied cell)', () => {
  const t = new Track();
  // Trace a path back toward the start cell. Geometry verified via computeEntryAt:
  //   p0 STRAIGHT (0,0,0,E) -> exit (1,0,0,E)
  //   p1 CURVE_R  (1,0,0,E) -> exit (1,1,0,S)
  //   p2 STRAIGHT (1,1,0,S) -> exit (1,2,0,S)
  //   p3 CURVE_R  (1,2,0,S) -> exit (0,2,0,W)
  //   p4 CURVE_R  (0,2,0,W) -> exit (0,1,0,N)
  // Occupied (gz=0): (0,0),(1,0),(1,1),(1,2),(0,2). Cursor (0,1,0,N).
  assert.equal(t.addPiece('STRAIGHT'), true);
  assert.equal(t.addPiece('CURVE_R'), true);
  assert.equal(t.addPiece('STRAIGHT'), true);
  assert.equal(t.addPiece('CURVE_R'), true);
  assert.equal(t.addPiece('CURVE_R'), true);
  assert.deepEqual(t.cursorState(), { gx: 0, gy: 1, gz: 0, dir: 0 });
  // A JUMP (forward=2) from (0,1,0,N): entry cell {0,1,0} (excluded connection),
  // landing cell {0,0,0} which is occupied by p0 -> overlap.
  const ok = t.addPiece('JUMP');
  assert.equal(ok, false);
  assert.equal(t.pieces.length, 5); // unchanged
  const res = t.lastCollisionResult;
  assert.ok(res && !res.ok, 'expected a rejection result');
  if (res && !res.ok) {
    assert.equal(res.reason, 'overlap');
    assert.deepEqual(res.cell, { gx: 0, gy: 0, gz: 0 });
  }
});

test('insertAt rejects overlap with the frozen region (auto-detection)', () => {
  const t = new Track();
  // [S,S,S,S] heading East. Entries: 0:(0,0,0) 1:(1,0,0) 2:(2,0,0) 3:(3,0,0).
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.deleteAt(1); // editing mode: pieces [S,S,S], frozen suffix entries (2,0,0),(3,0,0)
  assert.equal(t.isEditing(), true);
  // Insert a JUMP at index 1: entry (1,0,0,E), entry cell {1,0,0} (excluded),
  // landing cell {2,0,0} coincides with a FROZEN-suffix cell -> auto-rejected.
  const ok = t.insertAt(1, 'JUMP');
  assert.equal(ok, false);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'STRAIGHT', 'STRAIGHT']); // unchanged
  const res = t.lastCollisionResult;
  assert.ok(res && !res.ok, 'expected a rejection result');
  if (res && !res.ok) {
    assert.equal(res.reason, 'overlap');
    assert.deepEqual(res.cell, { gx: 2, gy: 0, gz: 0 });
  }
});

test('replaceAt excludes the old piece\'s own cells (single-cell replace succeeds)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  // Replacing the single-cell STRAIGHT at index 1 with a single-cell CURVE_R at
  // the same entry must NOT count the old piece's cell as a conflict.
  const ok = t.replaceAt(1, 'CURVE_R');
  assert.equal(ok, true);
  assert.deepEqual(t.pieces, ['STRAIGHT', 'CURVE_R', 'STRAIGHT']);
  const res = t.lastCollisionResult;
  assert.ok(res && res.ok, 'expected an accepted result');
});

test('rejected placement leaves track unchanged (atomicity)', () => {
  const t = new Track();
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.addPiece('STRAIGHT'); t.addPiece('STRAIGHT');
  t.deleteAt(1); // enter editing mode with a frozen suffix
  // Snapshot state before a placement we know will be rejected.
  const piecesBefore = [...t.pieces];
  const frozenBefore = JSON.stringify(t.frozenEntries);
  const editingBefore = t.isEditing();
  const ok = t.insertAt(1, 'JUMP'); // overlaps frozen suffix -> rejected
  assert.equal(ok, false);
  // Pieces, frozen entries, and editing mode must be byte-for-byte identical.
  assert.deepEqual(t.pieces, piecesBefore);
  assert.equal(JSON.stringify(t.frozenEntries), frozenBefore);
  assert.equal(t.isEditing(), editingBefore);
});

test('two pieces at same (gx,gy) but different gz do not collide (elevation separation)', () => {
  const t = new Track();
  // Climb to gz=1, then loop back over the start column at the higher level.
  // Geometry verified via computeEntryAt:
  //   p0 RAMP_UP  (0,0,0,E) -> exit (1,0,1,E)   occ (0,0,0)
  //   p1 CURVE_R  (1,0,1,E) -> exit (1,1,1,S)   occ (1,0,1)
  //   p2 STRAIGHT (1,1,1,S) -> exit (1,2,1,S)   occ (1,1,1)
  //   p3 CURVE_R  (1,2,1,S) -> exit (0,2,1,W)   occ (1,2,1)
  //   p4 CURVE_R  (0,2,1,W) -> exit (0,1,1,N)   occ (0,2,1)
  assert.equal(t.addPiece('RAMP_UP'), true);
  assert.equal(t.addPiece('CURVE_R'), true);
  assert.equal(t.addPiece('STRAIGHT'), true);
  assert.equal(t.addPiece('CURVE_R'), true);
  assert.equal(t.addPiece('CURVE_R'), true);
  assert.deepEqual(t.cursorState(), { gx: 0, gy: 1, gz: 1, dir: 0 });
  // (0,0) is occupied at gz=0 (p0's entry cell). A JUMP from (0,1,1,N) lands its
  // i=1 cell on (0,0,1) -- same (gx,gy) as (0,0,0) but a different gz -- so the
  // 3D cell identity keeps them separate and the placement is accepted.
  const ok = t.addPiece('JUMP');
  assert.equal(ok, true);
  assert.equal(t.pieces.length, 6);
  const res = t.lastCollisionResult;
  assert.ok(res && res.ok, 'expected an accepted result (elevation separation)');
});
