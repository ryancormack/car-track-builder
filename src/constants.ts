// constants.ts — Shared physics constants.
//
// These live in their own leaf module (importing nothing) so that both the
// simulator (physics.ts) and the piece catalogue (definitions.ts) can derive
// values from the same source of truth without creating a circular import.

export const G = 9.8;                    // gravity (grid units / s²)
export const FRICTION = 0.55;            // energy lost per unit length of track
export const RAMP_FRICTION_MULT = 1.1;   // ramps/coils are slightly costlier (steeper grade)
export const DRAG = 0.0008;              // tiny v²-proportional drag, keeps things bounded

// Maximum launch (drop) height in grid units. Single source of truth shared by
// the simulator's corner threshold, the track JSON clamp (track.ts), and the
// drop-height slider (index.html `max`). Bump this in one place to raise the
// ceiling everywhere.
export const MAX_DROP_HEIGHT = 6;

// Below this speed the car is treated as stopped (stall). Kept as a named knob
// rather than a literal so the stall point is obvious and tunable.
export const STALL_SPEED = 0.1;

// Radius of the flat quarter-turn pieces (CURVE_L / CURVE_R) in grid units.
// Must match the geometry in pathCurveR/pathCurveL (pieces/paths.ts).
export const CURVE_RADIUS = 0.5;

// Speed gate (in v²) above which a FLAT corner throws the car off the edge.
// Flat curves have no banking, so this is a gameplay safety valve rather than a
// hard physical grip limit (the implied lateral grip, CORNER_MAX_V2 / CURVE_RADIUS
// / G ≈ 24.5 g, is deliberately arcade-high). It is pinned to the drop ceiling:
// the fastest a plain drop can produce is 2·g·MAX_DROP_HEIGHT, so any legal drop
// alone always clears a corner, while stacking a booster on top sends you over.
export const CORNER_MAX_V2 = 2 * G * MAX_DROP_HEIGHT + 2.4;

// Radius of the vertical loop, in grid units. Must match `R` in pathLoop()
// (pieces/paths.ts): the loop apex sits at 2·R = 1.0.
export const LOOP_RADIUS = 0.5;

// Radius of the spiral's horizontal circle (grid units). The spiral is a true
// vertical-axis helix inscribed in a square footprint, so the radius is half the
// piece's forward span (forward 2 → r 1.0): the circle touches all four edges.
export const SPIRAL_RADIUS = 1.0;

// Radius of the helix's horizontal circle (grid units) — a parking-garage style
// spiral ramp inscribed in a 3×3 square (forward 3 → r 1.5). The car winds two
// full turns (720°) around this circle.
export const HELIX_RADIUS = 1.5;

// Radius of the tall spiral tower's horizontal circle (grid units), inscribed in
// a 4×4 square (forward 4 → r 2.0). Two full turns (720°) stack into the square.
export const SPIRAL_TOWER_RADIUS = 2.0;

// Radius of the giant vertical loop (3x the normal LOOP_RADIUS).
// The giant loop spans 3 forward cells with peak height 2*R = 3.0.
export const GIANT_LOOP_RADIUS = 1.5;

// Entry-speed gate (v²) for the Wall: the car must be going at least this fast
// to SMASH through the breakable barrier. Below it, the car crashes into the
// wall and explodes (game over). Pinned below the standard drop ceiling
// (2·g·6 = 117.6) so a tall-ish drop or a booster gets you through, but a low
// drop does not.
export const WALL_SMASH_V2 = 50;

// Scale factor applied to simulation time in the run loop (main.ts).
// A value < 1 makes the car traverse the track more slowly, giving a more
// dramatic and watchable run without altering the underlying physics.
export const SPEED_SCALE = 0.55;
