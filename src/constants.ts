// constants.ts — Shared physics constants.
//
// These live in their own leaf module (importing nothing) so that both the
// simulator (physics.ts) and the piece catalogue (definitions.ts) can derive
// values from the same source of truth without creating a circular import.

export const G = 9.8;                    // gravity (grid units / s²)
export const FRICTION = 0.55;            // energy lost per unit length of track
export const RAMP_FRICTION_MULT = 1.1;   // ramps are slightly costlier
export const DRAG = 0.0008;              // tiny v²-proportional drag, keeps things bounded

// Radius of the vertical loop, in grid units. Must match `R` in pathLoop()
// (pieces/paths.ts): the loop apex sits at 2·R = 1.0.
export const LOOP_RADIUS = 0.5;

// Scale factor applied to simulation time in the run loop (main.ts).
// A value < 1 makes the car traverse the track more slowly, giving a more
// dramatic and watchable run without altering the underlying physics.
export const SPEED_SCALE = 0.55;
