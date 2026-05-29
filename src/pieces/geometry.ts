// pieces/geometry.ts — direction vectors, frame transforms, and the
// state-transition function applyPiece(). Pure functions, easy to unit-test.
//
// Direction encoding: 0=N(-y), 1=E(+x), 2=S(+y), 3=W(-x).

import type { Dir, DirVec, GridState, Piece, WorldPoint } from '../types.js';

export const DIRS: DirVec[] = [
  { dx: 0, dy: -1 }, // 0 N
  { dx: 1, dy: 0 },  // 1 E
  { dx: 0, dy: 1 },  // 2 S
  { dx: -1, dy: 0 }, // 3 W
];

/** 90° clockwise (screen-right) of the given direction. */
export function rightOf(dir: Dir): DirVec {
  return DIRS[(dir + 1) % 4];
}

/**
 * Map a piece-local point (lx forward, ly right, lz up) to world grid coords,
 * given the piece's entry state. The entry midpoint is at lx=0, ly=0.
 */
export function localToWorld(state: GridState, lx: number, ly: number, lz: number): WorldPoint {
  const f = DIRS[state.dir];
  const r = rightOf(state.dir);
  return {
    wx: state.gx + (lx - 0.5) * f.dx + ly * r.dx,
    wy: state.gy + (lx - 0.5) * f.dy + ly * r.dy,
    wz: state.gz + lz,
  };
}

/**
 * Compute the entry state of the next piece, given the current entry state
 * and the piece being placed. Movement is along the EXIT direction (dir + turn),
 * which is what makes curves correctly land in the cell on the side of the turn.
 */
export function applyPiece(state: GridState, piece: Piece): GridState {
  const newDir = ((state.dir + piece.turn + 4) % 4) as Dir;
  const f = DIRS[newDir];
  const fwd = piece.forward;
  return {
    gx: state.gx + f.dx * fwd,
    gy: state.gy + f.dy * fwd,
    gz: state.gz + piece.dz,
    dir: newDir,
  };
}
