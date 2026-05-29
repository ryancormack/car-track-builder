// constants.js — Shared physics constants.
//
// These live in their own leaf module (importing nothing) so that both the
// simulator (physics.js) and the piece catalogue (definitions.js) can derive
// values from the same source of truth without creating a circular import.

export const G = 9.8;                    // gravity (grid units / s²)
export const FRICTION = 0.55;            // energy lost per unit length of track
export const RAMP_FRICTION_MULT = 1.1;   // ramps are slightly costlier
export const DRAG = 0.0008;              // tiny v²-proportional drag, keeps things bounded

// Radius of the vertical loop, in grid units. Must match `R` in pathLoop()
// (pieces/paths.js): the loop apex sits at 2·R = 1.0.
export const LOOP_RADIUS = 0.5;
