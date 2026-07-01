// app/hash.ts — URI fragment encoding/decoding for track state. Pure I/O.

import type { TrackJSON } from '../types.js';

/**
 * Encode a TrackJSON object to a base64url string (RFC 4648 section 5) suitable
 * for use as a URI fragment. Uses `-` and `_` instead of `+` and `/`, and omits
 * padding. The returned string does NOT include a leading '#'.
 */
export function encodeTrackHash(json: TrackJSON): string {
  const str = JSON.stringify(json);
  const bytes = new TextEncoder().encode(str);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a base64url hash string back to a parsed object. Returns null if the
 * input is invalid or cannot be decoded.
 */
export function decodeTrackHash(hash: string): unknown {
  if (!hash) return null;
  try {
    // Restore standard base64 from base64url
    let b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    // Re-add padding
    const pad = b64.length % 4;
    if (pad === 2) b64 += '==';
    else if (pad === 3) b64 += '=';

    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const str = new TextDecoder().decode(bytes);
    return JSON.parse(str);
  } catch {
    return null;
  }
}
