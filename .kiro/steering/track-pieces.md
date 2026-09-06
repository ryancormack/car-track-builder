# Adding a track piece

Everything you need to add a piece to Hot Track without breaking a seam, and the
two traps that are not guessable from the code.

`src/pieces/definitions.ts` is the source of truth for the catalogue. The README
deliberately does not list the pieces, because a second copy drifts.

## The checklist

In this order. The right-hand column is what actually happens if you skip the
step — the **silent** ones are the dangerous ones, because the piece looks fine.

| # | Step | Where | If you skip it |
| --- | --- | --- | --- |
| 1 | Add the id to the `PieceId` union | `src/types.ts` | **Loud** — nothing else compiles |
| 2 | Write the path sampler | `src/pieces/paths.ts` | **Loud** — no sampler to reference |
| 3 | Add the `PIECES` entry (footprint, gate, excitement, colour) | `src/pieces/definitions.ts` | **Loud** — `PIECES[id]` is undefined |
| 4 | Add the id to a `PALETTE_GROUPS` group | `src/pieces/definitions.ts` | **Loud** — a test asserts every non-hidden piece appears exactly once |
| 5 | Classify it in `isRampGrade` and `isHill` | `src/physics.ts` | **Was silent, now loud** — `catalogue.integration.test.ts` derives both from your sampler's geometry and fails if the piece is missing. This is the step that was missed when seven pieces were added at once |
| 6 | Add a mesh branch, or let it fall through to `buildRailedTrack` | `src/renderer/meshes.ts` | **Silent** — falling through is legitimate and gives the default orange rail, so a piece that *should* have looked distinctive just quietly does not |
| 7 | Decide whether it can carry a decoration | `DECORATABLE` in `definitions.ts` | **Silent** — omission just means no Ring of Fire on it, which is usually right for anything curved or rolling |
| 8 | Decide whether it can carry a laid surface (ice / gravel) | `UNSURFACEABLE` in `definitions.ts` | **Loud if it inverts** — `surfaces.test.ts` measures every sampler's up-vector and fails by name if an inverting piece is left surfaceable. **Silent otherwise**: a new piece DEFAULTS to surfaceable, which is right for anything the car drives on its wheels, but a new *ballistic* piece (a jump) has to be added by hand — no measurement catches that |
| 9 | Add tests for the *mechanic* the piece exists for | `test/coaster-elements.test.ts` | **Silent** — the catalogue-wide suites prove it is well-formed and driveable, not that it does the interesting thing you added it for |

Steps 1–5 are enforced, as is the inverting half of step 8. Steps 6, 7 and 9 are
judgement.

## The seam contract

A piece is described twice: by its declared footprint and by its sampler.
Nothing makes them agree automatically, and if they disagree the piece renders
correctly while the *next* piece starts in the wrong place.

Local coordinates are `lx` = forward, `ly` = right, `lz` = up, with the entry
seam's midpoint at the origin.

**Every piece must start at `(0, 0, 0)` and end at `lz = dz`.** Where it must end
horizontally depends on the turn, writing `fwd` = `forward`, `fe` =
`entryAdvance`, `fs` = `sideAdvance`:

| `turn` | end `lx` | end `ly` |
| --- | --- | --- |
| `0` (straight on) | `fwd + fe` | `fs` |
| `+1` (90° right) | `fe + 0.5` | `fwd + fs − 0.5` |
| `−1` (90° left) | `fe + 0.5` | `fs − fwd + 0.5` |
| `2` (180° reversal) | `1 + fe − fwd` | `fs` |

This falls out of `applyPiece` and `localToWorld` in `src/pieces/geometry.ts`:
`localToWorld` places local `lx` at `(lx − 0.5)` along the entry direction, so the
next piece's entry midpoint is its own cell minus half a cell along its *new*
heading. Equating that with the path's end point gives the table. It is verified
against all 42 pieces by `catalogue.integration.test.ts`.

Two consequences worth internalising:

- **A 180° piece exits at negative `lx` once `forward > 1`.** The Cobra Roll
  declares `forward: 6` and ends at `lx = −5`, i.e. five cells back down the lane
  it came from. That is correct, not a bug.
- **A reversal needs `sideAdvance`.** With `sideAdvance: 0` a 180° piece exits
  exactly where it entered and sits on its own approach track. Every reversal in
  the catalogue uses `±2`.

### The exit tangent matters as much as the exit point

The end **direction** must match the exit heading, or the join creases even
though the positions line up. In practice: make the coordinate that carries the
exit heading **linear** near `t = 1`, and give the other two **zero slope** there
(a `smootherstep` or a raised cosine `1 − cos(πu)` both do this). If all three
components go flat at `t = 1` the tangent is undefined and the frame falls back
to a default.

A subtler version of the same thing: satisfying the endpoint tangent *exactly at*
`t = 1` is not enough if the curvature just before it is huge. An early Immelmann
met the contract at the seam but swung 40° in its final 5% — it read as the car
snapping round. The fix was to give the roll-out more forward travel, not to
adjust the endpoint. `test/new-pieces.test.ts`'s exhaustive audit samples at the
seam and will not catch this; look at it.

## Trap 1: frame parity, and why an inverting piece exits at `banking = π`

`src/pieces/frames.ts` does not store an orientation. It derives the surface
normal per sample by rolling world-up about the tangent by `banking`, then keeps
the lateral axis **sign-continuous** against the previous sample. That
sign-tracking is what makes a loop invert at all: as the tangent pitches through
vertical the naive cross product flips, and suppressing that flip is what leaves
the car's "up" pointing at the ground over the top.

Two things follow, and neither is obvious from the code:

1. **After a pitched half-loop the car is upside down at `banking = 0`.** Pitch
   did the inverting, so righting the car needs a roll of an **odd** multiple of
   π. The Immelmann therefore ends at `banking = π` and the Cobra Roll at `3π`,
   where every other piece ends at `0` or `2π`. That is required. The exit frame's
   up vector is `+z` and matches flat track — which is the thing to assert, not
   the banking number.
2. **The parity depends on the path's shape.** Because the tracking is
   incremental, changing the geometry can change how many times the lateral axis
   was flipped, and therefore whether a π roll rights the car or inverts it. This
   is not theoretical: adding a sideways lean to the Immelmann's half-loop flipped
   the parity and the piece exited **upside down** with a perfect tangent —
   measured exit `up.z` went from `+1.000` to `−1.000`.

**So: keep an inverting piece's half-loop strictly planar** (all sideways travel
in the roll-out), and **assert the exit `up` vector**, never the banking value.
`test/coaster-elements.test.ts` pins the planarity and the exit up for both
compound inversions.

This is also why the roll-axis seam audit exists. The older exhaustive audit
compares exit/entry **tangents** across every ordered pair, which is completely
blind to a piece that exits rotated: upside down joins flat track with a perfect
tangent and a 180° flip of the car. The roll audit compares surface normals over
the same pairs.

## Trap 2: values that must be kept in sync by hand

- **`pathLen` vs the sampler's true arc length.** `pathLen` drives how fast the
  simulator advances along the piece, so a wrong value makes the car cover the
  piece at the wrong speed. Measure it, do not estimate — a Wave Turn guess of
  1.13 measured 1.32. Enforced to 3% by `catalogue.integration.test.ts`.
- **Heights and radii shared between a sampler and its gate.** A gate derived
  from a rise that no longer matches the sampler is silently wrong. Export the
  constant from `paths.ts` and import it in `definitions.ts` — `ZERO_G_ROLL_RISE`,
  `WAVE_TURN_RISE`, `HALF_LOOP_RADIUS` and `COBRA_SECOND_HUMP` all do this.
  Nothing enforces it, so prefer the shared constant over a second literal.
- **A derived gate must match the friction the simulator actually applies.** The
  ramp/hill gates multiply by `RAMP_FRICTION_MULT`, which is only real if the
  piece is in `isRampGrade` (step 5). Derive the gate and classify the piece in
  the same change, or the gate is quietly too harsh.

## Non-uniform parameter speed

If a piece packs phases of very different length (a short vertical loop then a
long rolling run), equal steps of `t` cover very different distances — the
simulator assumes constant distance per unit `t`, so the car crawls through one
phase and rockets through the next, and the renderer starves the long phase of
segments. `paths.ts` has `buildArcParam` for this: build the shape as a function
of a raw phase, then reparametrise by arc length. The Immelmann and Cobra Roll do
it (the Top Hat has its own older table because it also measures its climbing leg
to derive its gate). A ratio above ~1.2 between the fastest and slowest step is a
visible lurch; `coaster-elements.test.ts` asserts it.

## What the tests already guarantee

Run `npm test`. You do not need to add a case per piece for any of this:

- every piece places, drives to the finish, and has a gate reachable within the
  game's own speed budget (max drop + launch + booster)
- the sampler agrees with the declared footprint, at both seams
- `pathLen` matches the sampler; no sampler produces `NaN`
- `isRampGrade` / `isHill` match the sampler's measured grade and crest
- every **ordered pair** of pieces joins without a tangent crease **or** a roll
  flip — 42 × 41 combinations, both axes

What they do not check: how it looks, and whether it is fun. Look at it in the
browser and drive it.
