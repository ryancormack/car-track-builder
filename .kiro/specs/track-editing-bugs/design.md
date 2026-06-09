# Track Editing Bugs Bugfix Design

## Overview

This bugfix targets four observable defects in the track build/edit flow of `car-track-builder`. They cluster around the editing model in `src/track.ts` (a live region followed by a *frozen suffix* of downstream snapshot entries) and the collision-detection module in `src/collision.ts`:

1. **Bug 1 — Overlap accepted.** `checkPlacement` lets a piece occupy a 3D grid cell already claimed by another piece, so pieces visibly overlap.
2. **Bug 2 — Missing gap ghost.** In insert mode after a deletion, hovering a palette piece shows no ghost preview.
3. **Bug 3 — Undo removes the wrong piece.** Undo while building into a gap pops the frozen end of the track (`FINISH`) instead of the just-laid piece.
4. **Bug 4 — Rejoin fails to reconnect.** After deleting and rebuilding, `Track.rejoin` refuses to reconnect the live region to the frozen downstream.

The fix strategy is surgical and per-bug:

- **Bug 1** corrects the *cell footprint* (`collision.computeCells`) so every cell a piece occupies — entry, intermediate, **and exit** — is represented with consistent integer elevations, and tightens the overlap-exclusion in `Track._checkPlacement` so it skips only legitimate connection seams instead of masking real overlaps.
- **Bug 2** makes `Editor._hover` and `Renderer.rebuildGhost` aware of insert mode so the ghost renders at the insert cursor regardless of a trailing `FINISH`.
- **Bug 3** routes `Editor.undo` through an insert-aware path that removes the live piece at the insert cursor and steps the cursor back, leaving the frozen suffix intact.
- **Bug 4** replaces the brittle exact-match gate in `Track.rejoin` with a re-anchor-and-recompute reconnection that succeeds whenever the recomputed downstream is valid and reports a clear failure only when it genuinely is not.

Each fix is constrained by a regression-prevention clause (the `3.x` requirements) that the change must not break, and each is validated by a property-based test in the existing `node:test` + `tsx` + `fast-check` harness (see `test/collision.property.test.ts`).

## Glossary

- **Bug_Condition (C)**: The state/action tuple `X` that triggers a given defect. Defined per bug in `isBugCondition_1..4`.
- **Property (P)**: The desired behavior of the fixed code on inputs satisfying `C(X)`.
- **Preservation**: Behavior on inputs where `C(X)` is false that the fix must leave byte-for-byte unchanged.
- **GridState**: `{ gx, gy, gz, dir }` — a piece's entry position and heading (`src/types.ts`).
- **Cell / CellKey**: A discrete 3D grid cell `(gx, gy, gz)`, serialized as `"gx,gy,gz"` for O(1) set lookups (`src/collision.ts`).
- **Footprint**: The set of grid cells a piece's body occupies. Today produced by `computeCells(entry, piece)`.
- **Live region**: Pieces `[0, frozenBoundary)` — original pieces before the edit plus anything newly placed; positions recomputed by chaining `applyPiece` from `startState`.
- **Frozen suffix / frozenEntries**: Snapshot entry states of the downstream pieces captured at the first edit; `frozenEntries[j]` is the entry of `pieces[frozenBoundary + j]`. These keep their absolute positions until Rejoin.
- **frozenBoundary**: `pieces.length - frozenEntries.length` — index of the first frozen piece (`Track._frozenBoundary`).
- **Connection seam**: The single cell two consecutive pieces share, where the predecessor's exit coincides with the successor's entry. A seam is a valid connection, not an overlap.
- **insertCursor / selectedIndex**: `Editor` state. `selectedIndex != null` is replace mode; `insertCursor != null && selectedIndex == null` is insert (gap-fill) mode.
- **F / F'**: The original (buggy) and fixed functions, respectively.

## Bug Details

### Bug 1 — Overlap accepted

The collision detector fails to reject a candidate piece whose discrete cells coincide with cells already occupied by another (non-predecessor) piece.

**Formal Specification:**
```
FUNCTION isBugCondition_1(X)
  INPUT: X = { pieces, startState, frozenEntries, entry, candidatePiece, connectionIndex }
  OUTPUT: boolean

  trueCells   := everyCellOccupiedBy(entry, candidatePiece)   // entry + intermediate + EXIT
  occupied    := checkedRegionCells(pieces, startState, frozenEntries)
  seamCell    := predecessorConnectionCell(connectionIndex)   // candidate.entry == predecessor.exit

  // Buggy when a non-seam cell of the candidate lies in the occupied region,
  // yet checkPlacement still returns { ok: true }.
  RETURN (EXISTS cell IN trueCells
            SUCH THAT cell IN occupied AND cell <> seamCell)
         AND placementAccepted(entry, candidatePiece) = true
END FUNCTION
```

#### Examples

- **Single-cell loop-back.** Append four `CURVE_R` pieces from the default start `(0,0,0,E)`; the cursor returns to `(0,0,0,E)`. Appending a `STRAIGHT` next claims cell `(0,0,0)` which the first curve already owns. Expected: rejected as overlap. Actual: accepted — the candidate's only cell is its entry, which is excluded as the connection seam, so nothing is checked.
- **Multi-cell crossover.** A `JUMP` (`forward = 2`) whose intermediate/landing cell falls on an existing piece passes because the exit cell is never represented and intermediate elevations are rounded out of alignment.
- **Elevation-changing piece.** A `HELIX_UP`/`SPIRAL` crossing over a lower piece misses the overlap because `Math.round` on the interpolated `gz` places the crossing cell at an elevation that does not line up with the neighbour's integer `gz`.
- **Edge — valid seam (must stay accepted).** A `STRAIGHT` appended to a straight chain shares only the seam cell with its predecessor; this is a connection, not an overlap.

### Bug 2 — Missing gap ghost

```
FUNCTION isBugCondition_2(X)
  INPUT: X = editor + track state on palette hover
  OUTPUT: boolean
  RETURN editor.insertCursor <> null
         AND editor.selectedIndex = null     // insert / gap-fill mode
         AND track.isEditing() = true
         AND track.hasFinish() = true         // frozen suffix still ends in FINISH
         AND noGhostRendered()
END FUNCTION
```

#### Examples

- Delete a mid-track piece (track still ends in `FINISH`), then hover `STRAIGHT`: no ghost appears. Expected: a ghost at the gap.
- Same state, hover `LOOP`: no ghost. Expected: a `LOOP` ghost previewed at the insert cursor.

### Bug 3 — Undo removes the wrong piece

```
FUNCTION isBugCondition_3(X)
  INPUT: X = editor + track state on Undo
  OUTPUT: boolean
  RETURN editor.insertCursor <> null
         AND track.isEditing() = true         // there is a frozen suffix to protect
         AND undoRemovesLastArrayElement()     // i.e. the frozen FINISH, not the laid piece
END FUNCTION
```

#### Examples

- Delete a mid-track piece, insert a `STRAIGHT` into the gap, press Undo: the `FINISH` at the end of the array disappears; the just-laid `STRAIGHT` remains. Expected: the `STRAIGHT` is removed, `FINISH` stays.
- Press Ctrl/Cmd-Z in the same state: same wrong-piece removal (same `Editor.undo` path).

### Bug 4 — Rejoin fails to reconnect

```
FUNCTION isBugCondition_4(X)
  INPUT: X = track state on Rejoin
  OUTPUT: boolean
  RETURN track.isEditing() = true
         AND track.frozenEntries.length > 0
         // The rebuilt live region can be reconnected to the frozen downstream
         // by re-anchoring (the recomputed downstream is a valid track), yet
         // rejoin returns false and stays in editing mode.
         AND recomputedDownstreamIsValid(track)
         AND rejoinReturnedFalse()
END FUNCTION
```

#### Examples

- Delete a mid-track piece and rebuild a section of a different length, then press Rejoin: the live exit no longer equals the original frozen `[0]` snapshot, so the all-four-fields equality check returns false and the track stays split. Expected: the downstream re-anchors onto the live exit and the track becomes continuous.
- Delete a piece and immediately press Rejoin (closing the gap): exact-match fails. Expected: downstream shifts to close the gap; editing mode ends.
- Edge — genuine non-connect: rebuild a section that, once the downstream is re-chained from the new exit, drives the downstream below the floor or back over the live region. Expected: stay in editing mode with clear feedback.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- **3.1** Non-coinciding placements are still accepted.
- **3.2** A candidate whose entry coincides *only* with its predecessor's exit (the seam) is still treated as a valid connection, never an overlap.
- **3.3** A placement that descends below the floor (`gz + dropHeight < 0` on any owned or exit cell) is still rejected as a floor violation, and floor is still reported ahead of overlap.
- **3.4** In normal (non-editing) append mode, hovering a palette piece on a track that can still accept pieces still shows the ghost at the append point (end of track).
- **3.5** Undo in normal append mode (not editing, no insert cursor) still removes the last appended piece.
- **3.6** Rejoin while not editing, or with an empty frozen suffix, is still a successful no-op.
- **3.7** Two pieces in the same `(gx, gy)` column but different `gz` elevations are still distinct, non-colliding cells.

**Scope:**

The fixes must not touch:
- Mouse-pick selection (`Renderer.pickPiece`), highlight, or any rendering path other than the ghost group.
- Physics, scoring, save/load, or the demo seed.
- The `buildOccupiedSet` / `buildFrozenOccupiedSet` chaining semantics beyond the footprint change required by Bug 1.

**Note:** The desired *correct* behavior for buggy inputs is defined in the Correctness Properties section below.

## Hypothesized Root Cause

### Bug 1 — `src/collision.ts` `computeCells` + `src/track.ts` `_checkPlacement` / `_getExcludeCell`

1. **Exit cell never represented.** `computeCells` returns exactly `piece.forward` cells, anchored at the entry and **excluding the exit cell** (the cell the next piece enters). So a `forward = 1` piece's footprint is a single cell — its entry — and the cell its body advances into is invisible to overlap checks.
2. **Connection-exclusion masks the only cell.** `Track._getExcludeCell(index)` returns the candidate's entry cell, and `checkOverlap` skips it. For a single-cell piece, the entry cell *is* the entire footprint, so the overlap scan checks nothing and always returns `null` — the loop-back example is accepted even though it lands on an occupied cell.
3. **Rounded interpolated elevation.** `computeCells` computes `gz = Math.round(entry.gz + piece.dz * i / piece.forward)`. For pieces with fractional per-step `dz`, the rounded intermediate elevations of two crossing pieces need not agree, so cells that physically coincide get different `gz` keys and the overlap is missed.

### Bug 2 — `src/editor.ts` `_hover` + `src/renderer/index.ts` `rebuildGhost`

1. **`_hover` aborts on `canAdd`.** `Editor._hover` returns early when `!this.track.canAdd(id)`. `Track.canAdd` returns `false` whenever `hasFinish()` is true. In insert mode the frozen suffix still ends in `FINISH`, so the hover handler bails before any ghost is built.
2. **`_hover` only handles append/replace.** It explicitly returns in replace mode (`selectedIndex != null`) and otherwise previews the append point; it has no branch for insert mode (`insertCursor != null && selectedIndex == null`).
3. **`rebuildGhost` only previews the append point.** It also guards on `track.canAdd`, builds a *hypothetical append* (`[...track.pieces, pieceId]`), and anchors the ghost at `track.cursorState()` (end of track) — never at an interior insert index.

### Bug 3 — `src/track.ts` `undo` + `src/editor.ts` `undo`

1. **`Track.undo` is a blind pop.** It does `this.pieces.pop()`, which in editing mode removes the last array element — the frozen `FINISH` — not the piece at the insert cursor.
2. **`Editor.undo` discards insert context first.** It calls `this.deselectPiece()` (which nulls `insertCursor`) *before* `track.undo()`, so even the cursor needed to find the just-laid piece is gone, and the cursor is never stepped back.

### Bug 4 — `src/track.ts` `rejoin`

1. **Over-strict exact-match gate.** `rejoin` compares the live exit `computeEntryAt(boundary)` against `frozenEntries[0]` on all four fields (`gx, gy, gz, dir`) and returns `false` on any mismatch. A rerouted live region rarely lands exactly on the old snapshot, so reconnection almost always fails.
2. **No re-anchor on success.** The method only ever clears `frozenEntries` when the snapshot already matches; it never re-anchors the downstream onto a *new* live exit, so a legitimately connectable-but-moved downstream is never reconnected.

## Correctness Properties

Property 1: Bug Condition — Overlap Reliably Rejected

_For any_ track state and candidate placement where the candidate's true footprint (entry, intermediate, and exit cells, at consistent integer elevations) contains a cell — other than the single predecessor connection seam — that is already occupied in the checked region, the fixed `checkPlacement`/`Track._checkPlacement` SHALL reject the placement with `reason: 'overlap'`, report an occupied conflicting cell, and leave the track unchanged.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Valid Placements, Seams, Floor, and Elevation Separation

_For any_ placement whose footprint cells (excluding the predecessor seam) are disjoint from the checked region and at/above the floor, the fixed code SHALL accept it; a candidate coinciding only at the predecessor seam SHALL be accepted; a candidate with any owned or exit cell at `gz + dropHeight < 0` SHALL be rejected as `'floor'` (reported ahead of overlap); and two cells sharing `(gx, gy)` at different `gz` SHALL NOT collide.

**Validates: Requirements 3.1, 3.2, 3.3, 3.7**

Property 3: Bug Condition — Ghost Renders at the Gap in Insert Mode

_For any_ track in insert mode (`insertCursor != null`, `selectedIndex == null`, `isEditing()`), including when the frozen suffix still ends in `FINISH`, hovering any valid palette piece SHALL produce a non-empty ghost anchored at the insert-cursor entry state `computeEntryAt(insertCursor + 1)`.

**Validates: Requirements 2.3**

Property 4: Preservation — Append Ghost Unchanged

_For any_ non-editing track that can still accept a piece (`!hasFinish()`, no `insertCursor`, no `selectedIndex`), hovering a palette piece SHALL still produce a ghost anchored at `cursorState()` (the append point), exactly as before.

**Validates: Requirements 3.4**

Property 5: Bug Condition — Undo Removes the Just-Laid Piece in Insert Mode

_For any_ editing track with at least one piece laid in the current insert session, Undo SHALL remove the live piece at the insert cursor, step `insertCursor` back by one, and leave the frozen downstream suffix (its `frozenEntries` and trailing `FINISH`) intact and still in editing mode.

**Validates: Requirements 2.4**

Property 6: Preservation — Append Undo Unchanged

_For any_ non-editing track (no `insertCursor`, no `selectedIndex`), Undo SHALL remove the last appended piece (the final array element) exactly as before.

**Validates: Requirements 3.5**

Property 7: Bug Condition — Rejoin Re-anchors and Reconnects

_For any_ editing track whose downstream, when re-anchored onto the live exit and recomputed by chaining, is a valid track, Rejoin SHALL succeed, clear `frozenEntries` (exit editing mode), and yield a continuous track in which the downstream's first entry equals the live exit `computeEntryAt(frozenBoundary)`.

**Validates: Requirements 2.5**

Property 8: Preservation — Rejoin No-op and Genuine Non-connect

_For any_ Rejoin while not editing or with an empty frozen suffix, the result SHALL be a successful no-op (`true`); and _for any_ editing track whose re-anchored, recomputed downstream would be invalid (overlap or floor violation), Rejoin SHALL return `false` and remain in editing mode.

**Validates: Requirements 2.5, 3.6**

## Fix Implementation

### Bug 1 — `src/collision.ts`, `src/track.ts`

**File**: `src/collision.ts` — **Function**: `computeCells`

1. **Represent the exit cell.** Extend the footprint to include the exit cell so a piece occupies its entry, every intermediate cell, and the cell its body advances into (`forward + 1` cells). This makes single-cell pieces have a body cell that survives the seam exclusion and ensures multi-cell crossings expose their landing cell.
2. **Consistent integer elevation.** Anchor the elevations at the integer endpoints `entry.gz` and `entry.gz + piece.dz` and interpolate with a single shared, deterministic rule so the seam cell computed as one piece's exit equals the next piece's entry `gz`, and crossing pieces agree on shared cells. (The exit cell takes `entry.gz + piece.dz` exactly, matching `applyPiece`.)

**File**: `src/track.ts` — **Functions**: `_checkPlacement`, `_getExcludeCell`, `_buildCheckedCells`

3. **Exclude only legitimate seams.** Keep excluding the single predecessor connection cell (candidate entry == predecessor exit). Because the candidate now owns its exit cell too, a single-cell piece is no longer fully masked — a loop-back onto an occupied cell is caught on the candidate's exit (or one piece earlier when that piece's exit first re-enters an occupied cell).
4. **Insert reconnection seam.** In editing mode, additionally treat the candidate's exit cell as a valid seam when it coincides with the frozen suffix's first entry (the downstream reconnection point), so refilling a one-cell gap is not a false overlap. All other coincidences with the frozen region remain rejected (preserves the frozen-region auto-detection from the collision spec).
5. **Floor unchanged.** Continue checking floor (owned cells + exit cell, offset by `dropHeight`) ahead of overlap, so 3.3 holds.

> Test impact: the existing `track-collision-detection` properties that pin the old `forward`-count footprint and the `Math.round` formula (Properties 0/2/3 in `test/collision.property.test.ts`) must be updated to the exit-inclusive, integer-consistent contract. This is part of the fix, not a regression.

### Bug 2 — `src/editor.ts`, `src/renderer/index.ts`

**File**: `src/editor.ts` — **Function**: `_hover`

1. Add an insert-mode branch: when `insertCursor != null && selectedIndex == null`, build the ghost at the insert location instead of returning, and do **not** gate on `canAdd` (which forbids placement past `FINISH`).

**File**: `src/renderer/index.ts` — **Function**: `rebuildGhost` (or a new `rebuildGhostAt`)

2. Support previewing at an explicit insert index: compute the entry via `track.computeEntryAt(insertCursor + 1)`, resolve the path against a hypothetical piece list with the piece inserted at that index (for correct neighbour context), and anchor the ghost there.
3. Keep the existing append path (`canAdd` + `cursorState()`) for normal mode so 3.4 is unchanged.

### Bug 3 — `src/track.ts`, `src/editor.ts`

**File**: `src/editor.ts` — **Function**: `undo` (plus a small `insertAnchor` field)

1. Record the gap floor when entering insert mode via `deleteSelected()` (the predecessor index at the gap).
2. In `undo`, branch *before* `deselectPiece()`: when `insertCursor != null && track.isEditing()` and a session piece exists (`insertCursor > insertAnchor`), remove the live piece at `insertCursor` and decrement `insertCursor`; rebuild and keep editing. When no session piece remains, fall back to a safe no-op / exit of insert mode.
3. Leave the normal-append path (`deselectPiece()` then `track.undo()`) for non-editing mode (preserves 3.5).

**File**: `src/track.ts` — reuse `deleteAt`

4. Removing the live piece uses `deleteAt(insertCursor)`: in editing mode with `index < frozenBoundary`, it splices the live piece, leaves `frozenEntries` untouched, and stays editing — exactly the required semantics. No blind `pieces.pop()` in this path.

### Bug 4 — `src/track.ts`

**File**: `src/track.ts` — **Function**: `rejoin`

1. Keep the no-op success cases: not editing → `true`; empty frozen suffix → clear and `true` (preserves 3.6).
2. Replace the exact-match gate with **re-anchor and recompute**: recompute each downstream piece's entry by chaining `applyPiece` from the live exit `computeEntryAt(frozenBoundary)`, and validate the recomputed downstream against the live region (overlap via the checked-region cells, and floor via `gz + dropHeight`).
3. If the recomputed downstream is valid, commit by clearing `frozenEntries` (so `entryStateAt` recomputes everything by chaining, making the track continuous) and return `true`.
4. If it is invalid, keep `frozenEntries` intact, stay in editing mode, and return `false`; `main.ts` already surfaces the "doesn't connect" status on `false`.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each defect on the **unfixed** code, then verify the fix produces the expected behavior while preserving the `3.x` behaviors. All properties run in the existing `node:test` + `tsx` + `fast-check` harness, reusing the `gridStateArb`, `pieceIdArb`, and `pieceArb` arbitraries from `test/collision.property.test.ts`.

### Exploratory Bug Condition Checking

**Goal**: Reproduce each bug on the current code to confirm the root-cause analysis before changing anything.

**Test Cases**:
1. **Overlap loop-back** (Bug 1): build four `CURVE_R` from start, append a `STRAIGHT`, assert it is *wrongly accepted* on unfixed code (cursor `(0,0,0)` already occupied).
2. **Multi-cell / elevation crossover** (Bug 1): construct a crossing `JUMP`/`HELIX_UP` over an existing piece and observe the missed overlap.
3. **Insert-mode ghost** (Bug 2): delete a mid-track piece (track ends in `FINISH`), hover a piece, assert the ghost group is empty on unfixed code.
4. **Insert-mode undo** (Bug 3): delete, insert a `STRAIGHT`, undo, assert `FINISH` was removed and the `STRAIGHT` remained on unfixed code.
5. **Rejoin after reroute** (Bug 4): delete + rebuild a different-length section, call `rejoin`, assert it returns `false` and stays editing on unfixed code.

**Expected Counterexamples**: single-cell entry masked by seam exclusion; exit/intermediate cells unrepresented; `Math.round` elevation mismatch; `_hover` aborting on `canAdd`; `pieces.pop()` removing `FINISH`; exact-match gate rejecting a moved exit.

### Fix Checking

**Goal**: For all inputs where the bug condition holds, the fixed function produces the expected behavior.

```
FOR ALL X WHERE isBugCondition_i(X) DO
  result := fixedFunction_i(X)
  ASSERT property_i(result)      // Properties 1, 3, 5, 7
END FOR
```

### Preservation Checking

**Goal**: For all inputs where the bug condition does NOT hold, the fixed function matches the original.

```
FOR ALL X WHERE NOT isBugCondition_i(X) DO
  ASSERT originalFunction_i(X) = fixedFunction_i(X)   // Properties 2, 4, 6, 8
END FOR
```

**Testing Approach**: Property-based testing is preferred for preservation because it samples the input domain broadly (random tracks, pieces, entry states, delete/insert indices) and catches seam/edge cases manual tests miss. For Bugs 2–4 the relevant "function" is the editor/track operation; properties assert structural invariants (ghost anchor equals `computeEntryAt`, `frozenEntries` unchanged on insert-undo, continuity after rejoin).

### Unit Tests

- `collision.test.ts` / `track.test.ts`: exit-inclusive footprint cell counts and keys; loop-back rejection; seam acceptance; floor-before-overlap ordering; column-different-`gz` separation.
- `editor.test.ts`: insert-mode hover builds a ghost despite `FINISH`; insert-mode undo removes the laid piece and steps the cursor back; append undo unchanged.
- `track.test.ts`: `rejoin` re-anchors a moved/short downstream; no-op when not editing / empty suffix; refuses an invalid recomputed downstream.

### Property-Based Tests

- Properties 1–2 (Bug 1) extend `test/collision.property.test.ts` with the corrected footprint contract and seam/elevation invariants.
- Properties 3–4 (Bug 2), 5–6 (Bug 3), 7–8 (Bug 4) drive the real `Track` (and a thin ghost-anchor helper) over randomized tracks and edit indices, asserting the bug-condition and preservation invariants above.

### Integration Tests

- Full edit flow: append a complete track → select & delete a mid piece → hover (ghost appears at the gap) → insert pieces → undo (laid piece removed, `FINISH` intact) → Rejoin (continuous, editing ends) → enter play mode (`isComplete()` true).
- Negative reconnection: reroute so the recomputed downstream is invalid → Rejoin stays in editing mode with feedback; the user can keep building or undo.
