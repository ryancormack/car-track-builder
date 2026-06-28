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

// Radius of the spiral coil (grid units). Sized proportionally to the helix
// (~0.3 of the piece's forward span) so the single descending loop reads as a
// full, open coil rather than a thin, cramped twist.
export const SPIRAL_RADIUS = 0.6;

// Radius of the circular helix (parking-garage style) in local grid units.
export const HELIX_RADIUS = 1.0;

// Radius of the tall multi-coil spiral tower (grid units). The tower spreads its
// turns over 4 forward cells so consecutive coils have room to separate.
export const SPIRAL_TOWER_RADIUS = 0.85;

// Radius of the giant vertical loop (3x the normal LOOP_RADIUS).
// The giant loop spans 3 forward cells with peak height 2*R = 3.0.
export const GIANT_LOOP_RADIUS = 1.5;

// Scale factor applied to simulation time in the run loop (main.ts).
// A value < 1 makes the car traverse the track more slowly, giving a more
// dramatic and watchable run without altering the underlying physics.
export const SPEED_SCALE = 0.55;
