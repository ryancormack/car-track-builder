// app/hash.ts — URI fragment encoding/decoding for track state. Pure I/O.

import type { TrackJSON } from '../types.js';

/**
 * Encode a TrackJSON object to a URL-safe base64 string suitable for use as a
 * URI fragment. The returned string does NOT include a leading '#'.
 */
export function encodeTrackHash(json: TrackJSON): string {
  const str = JSON.stringify(json);
  const bytes = new TextEncoder().encode(str);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

/**
 * Decode a base64 hash string back to a parsed object. Returns null if the
 * input is invalid or cannot be decoded.
 */
export function decodeTrackHash(hash: string): unknown {
  if (!hash) return null;
  try {
    const binary = atob(hash);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const str = new TextDecoder().decode(bytes);
    return JSON.parse(str);
  } catch {
    return null;
  }
}
