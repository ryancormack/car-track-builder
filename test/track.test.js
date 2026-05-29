// Tests for the Track data model.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../js/track.js';

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
