// Tests for the hash encoding/decoding module.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeTrackHash, decodeTrackHash } from '../src/app/hash.js';
import type { TrackJSON } from '../src/types.js';

test('round-trip: encodeTrackHash then decodeTrackHash returns the original TrackJSON', () => {
  const input: TrackJSON = {
    dropHeight: 3,
    pieces: ['STRAIGHT', 'LOOP', 'FINISH'],
  };
  const encoded = encodeTrackHash(input);
  const decoded = decodeTrackHash(encoded);
  assert.deepEqual(decoded, input);
});

test('decodeTrackHash returns null for garbage input', () => {
  const result = decodeTrackHash('not-valid-base64!!!');
  assert.equal(result, null);
});

test('decodeTrackHash returns null for empty string', () => {
  const result = decodeTrackHash('');
  assert.equal(result, null);
});

test('encoded string is URL-safe (base64url charset, no padding)', () => {
  const input: TrackJSON = {
    dropHeight: 5,
    pieces: ['STRAIGHT', 'CURVE_R', 'LOOP', 'JUMP', 'FINISH'],
  };
  const encoded = encodeTrackHash(input);
  // base64url uses A-Z, a-z, 0-9, -, _ with no padding (=).
  // Verify no whitespace, #, +, /, or = characters are present.
  assert.ok(!/[\s#+=\/]/.test(encoded), 'encoded string should not contain whitespace, #, +, /, or =');
  // Verify it only contains valid base64url characters
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(encoded), 'encoded string should only contain base64url chars');
});

test('a known TrackJSON with decorations round-trips correctly', () => {
  const input: TrackJSON = {
    dropHeight: 4,
    pieces: ['STRAIGHT', 'LOOP', 'STRAIGHT', 'FINISH'],
    decorations: [null, 'RING_OF_FIRE', 'WATER_SPLASH', null],
  };
  const encoded = encodeTrackHash(input);
  const decoded = decodeTrackHash(encoded);
  assert.deepEqual(decoded, input);
});
