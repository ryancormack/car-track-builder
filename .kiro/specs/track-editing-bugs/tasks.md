# Implementation Plan

This plan fixes the four track-editing defects described in `design.md` using the
exploratory bugfix workflow: for each bug we first write a failing reproduction
(bug-condition) test on the **unfixed** code, then a preservation test that passes
on the unfixed code, then apply the surgical fix and re-run both. All property
tests run in the existing `node:test` + `tsx` + `fast-check` harness
(`npm test` → `node --import tsx --test test/*.test.ts`), reusing the
`gridStateArb`, `pieceIdArb`, and `pieceArb` arbitraries exported from
`test/collision.property.test.ts`.

Property numbers below match the Correctness Properties (1–8) in `design.md`.

---

## Bug 1 — Collision detection accepts overlapping pieces

- [ ] 1. Write the Bug 1 overlap reproduction (bug-condition) test
  - **Property 1: Bug Condition** - Overlap Reliably Rejected
  - **CRITICAL**: This test MUST FAIL on the unfixed code — failure confirms the bug exists. DO NOT fix the test or code when it fails.
  - **GOAL**: Surface counterexamples where a candidate's true footprint (entry + intermediate + exit) lands on an already-occupied cell yet `Track.addPiece`/`insertAt` returns `true`.
  - Add the test to `test/collision.property.test.ts` (reusing the existing arbitraries).
  - **Scoped deterministic case (loop-back)**: drive a real `Track` — append four `CURVE_R` from the default start so the cursor returns to `(0,0,0,E)` (verify via `computeEntryAt`), then `addPiece('STRAIGHT')`. Assert it is *wrongly accepted* on unfixed code (the candidate's only cell is its entry, masked by the seam exclusion).
  - **Multi-cell / elevation case**: construct a `JUMP` (forward=2) and a `HELIX_UP` (forward=3, dz=3) whose intermediate/exit cell crosses an existing piece; assert the overlap is missed on unfixed code because `computeCells` omits the exit cell and `Math.round` mis-aligns interpolated `gz`.
  - **Property form**: for randomized tracks + candidate placements, assert that whenever the true (exit-inclusive, integer-consistent) footprint hits a non-seam occupied cell, the fixed `Track._checkPlacement` will reject with `reason: 'overlap'` (this assertion FAILS now, PASSES after Task 3).
  - Run on unfixed code, document the accepted-overlap counterexamples (e.g. `addPiece('STRAIGHT')` accepted at `(0,0,0)`; `JUMP` landing cell unrepresented).
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [ ] 2. Write the Bug 1 preservation test (observation-first)
  - **Property 2: Preservation** - Valid Placements, Seams, Floor, and Elevation Separation
  - **IMPORTANT**: Follow observation-first methodology — record current behavior on the **unfixed** code, then assert it.
  - Add to `test/collision.property.test.ts`. Observe and assert on the unfixed `Track` / `checkPlacement`:
    - Disjoint footprints are accepted (e.g. straight chains extend cleanly).
    - A candidate coinciding *only* at the predecessor seam is accepted (seam is a connection, not overlap).
    - A candidate with any owned/exit cell at `gz + dropHeight < 0` is rejected as `'floor'`, reported ahead of overlap (mirror the `dropHeight = 0` + `RAMP_DN` case and the floor-before-overlap `SPIRAL` case already in `track.test.ts` / `collision.test.ts`).
    - Two cells sharing `(gx, gy)` at different `gz` do NOT collide (mirror the elevation-separation `JUMP`-over-`RAMP_UP` case in `track.test.ts`).
  - **EXPECTED OUTCOME**: Tests PASS on unfixed code (these behaviors must be preserved by the fix).
  - _Requirements: 3.1, 3.2, 3.3, 3.7_

- [ ] 3. Fix Bug 1 — exit-inclusive, integer-consistent footprint + tightened seam exclusion

  - [ ] 3.1 Correct the cell footprint in `src/collision.ts`
    - In `computeCells(entry, piece)`: extend the footprint to include the EXIT cell so a piece owns its entry, every intermediate cell, and the cell its body advances into (`forward + 1` cells); the exit cell takes `entry.gz + piece.dz` exactly (matching `applyPiece`).
    - Replace the `Math.round(entry.gz + piece.dz * i / forward)` interpolation with a single deterministic integer rule anchored at the integer endpoints `entry.gz` and `entry.gz + piece.dz`, so the cell a piece computes as its exit equals the next piece's entry `gz`, and crossing pieces agree on shared cells.
    - Keep `cellKey`, `checkFloor`, `checkOverlap`, `buildOccupiedSet`, and `buildFrozenOccupiedSet` semantics intact aside from consuming the new footprint.
    - _Bug_Condition: isBugCondition_1(X) — a non-seam true-footprint cell lies in the occupied region yet placement is accepted_
    - _Expected_Behavior: every discrete cell (entry, intermediate, exit) is represented at consistent integer elevation (design Bug 1 fix steps 1–2)_
    - _Requirements: 2.1, 2.2_

  - [ ] 3.2 Tighten the overlap exclusion in `src/track.ts`
    - In `_getExcludeCell(index)` / `_checkPlacement` / `_buildCheckedCells`: continue excluding ONLY the single predecessor connection cell (candidate entry == predecessor exit). Because the candidate now owns its exit cell, a single-cell loop-back onto an occupied cell is caught on the exit cell.
    - In editing mode, additionally treat the candidate's EXIT cell as a valid seam when it coincides with the frozen suffix's first entry (the downstream reconnection point), so refilling a one-cell gap is not a false overlap; all other coincidences with the frozen region remain rejected (preserve frozen-region auto-detection).
    - Keep the floor check (owned cells + exit cell, offset by `dropHeight`) ahead of overlap.
    - _Bug_Condition: isBugCondition_1(X)_
    - _Expected_Behavior: exclude no more than the single shared predecessor seam (design Bug 1 fix steps 3–5)_
    - _Requirements: 2.1, 2.2, 3.2, 3.3_

  - [ ] 3.3 Verify the Bug 1 reproduction test now passes
    - **Property 1: Expected Behavior** - Overlap Reliably Rejected
    - **IMPORTANT**: Re-run the SAME test from Task 1 — do NOT write a new test.
    - Run on fixed code. **EXPECTED OUTCOME**: Test PASSES — the loop-back `STRAIGHT`, the crossing `JUMP`, and the `HELIX_UP` overlaps are now rejected with `reason: 'overlap'` and the track is left unchanged.
    - _Requirements: 2.1, 2.2_

  - [ ] 3.4 Verify the Bug 1 preservation test still passes
    - **Property 2: Preservation** - Valid Placements, Seams, Floor, and Elevation Separation
    - **IMPORTANT**: Re-run the SAME test from Task 2 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES — valid placements, seams, floor-before-overlap ordering, and elevation separation are unchanged.
    - _Requirements: 3.1, 3.2, 3.3, 3.7_

  - [ ] 3.5 Update existing collision tests to the new footprint contract
    - In `test/collision.property.test.ts`, update the contract-pinning properties that encode the OLD footprint, per the design's "Test impact" note:
      - **Property 0** (`computeCells returns piece.forward cells`) → assert the exit-inclusive count (`piece.forward + 1`).
      - **Property 2** (`Cell Computation Correctness`) → recompute the expected cells with the new integer-endpoint elevation rule and exit cell, not the `Math.round` formula.
      - **Property 3** (`Cell Computation Consistency with applyPiece`) → assert the exit cell now equals `applyPiece(entry, piece)` `(gx, gy, gz)` directly.
    - In `test/collision.test.ts`, update the `computeCells` unit tests (STRAIGHT, CORKSCREW, CURVE_R, turning multi-cell, HELIX_UP elevation) to the exit-inclusive, integer-consistent expected cells.
    - This is part of the fix (a deliberate contract change), not a regression.
    - _Requirements: 2.1, 2.2_

---

## Bug 2 — Ghost preview missing while filling a deleted gap

- [ ] 4. Write the Bug 2 missing-ghost reproduction (bug-condition) test
  - **Property 3: Bug Condition** - Ghost Renders at the Gap in Insert Mode
  - **CRITICAL**: This test MUST FAIL on the unfixed code. DO NOT fix the test or code when it fails.
  - Add to `test/editor.test.ts`, reusing the DOM/`Renderer` fakes already in that file; extend the fake renderer to record `rebuildGhost`/`rebuildGhostAt` calls and the anchor entry state passed to them.
  - **Scenario**: build a track ending in `FINISH`, `selectPiece` a mid piece and `deleteSelected()` to enter insert mode (`insertCursor != null`, `selectedIndex == null`, `isEditing() == true`, `hasFinish() == true`); then trigger `_hover` for a palette piece (via the button `mouseenter` handler).
  - Assert that a ghost is requested at the insert-cursor entry `track.computeEntryAt(insertCursor + 1)`. **EXPECTED OUTCOME on unfixed code**: FAILS — `_hover` aborts because `canAdd` returns false while a `FINISH` exists, so no ghost is built.
  - Document the counterexample (no ghost produced in insert mode with trailing `FINISH`).
  - _Requirements: 2.3_

- [ ] 5. Write the Bug 2 append-ghost preservation test (observation-first)
  - **Property 4: Preservation** - Append Ghost Unchanged
  - **IMPORTANT**: Observe current behavior on the unfixed code, then assert it.
  - Add to `test/editor.test.ts`. For a non-editing track that can still accept a piece (`!hasFinish()`, no `insertCursor`, no `selectedIndex`), hovering a palette piece must request a ghost anchored at `track.cursorState()` (the append point), exactly as today.
  - **EXPECTED OUTCOME**: Test PASSES on unfixed code.
  - _Requirements: 3.4_

- [ ] 6. Fix Bug 2 — insert-aware ghost preview

  - [ ] 6.1 Add an insert-mode branch to `Editor._hover` (`src/editor.ts`)
    - When `insertCursor != null && selectedIndex == null`, build the ghost at the insert location instead of returning early, and do NOT gate on `track.canAdd` (which forbids placement past `FINISH`).
    - Keep the existing `selectedIndex != null` (replace) early-return and the normal append path unchanged.
    - _Bug_Condition: isBugCondition_2(X) — insert mode + isEditing + hasFinish, no ghost rendered_
    - _Expected_Behavior: ghost anchored at computeEntryAt(insertCursor + 1) regardless of trailing FINISH_
    - _Requirements: 2.3_

  - [ ] 6.2 Support previewing at an explicit insert index in `src/renderer/index.ts`
    - Add `rebuildGhostAt(track, pieceId, insertIndex)` (or extend `rebuildGhost`): compute the entry via `track.computeEntryAt(insertIndex)`, resolve the path against a hypothetical piece list with the piece inserted at that index (correct neighbour context via `resolvePathLocal`), and anchor the ghost there — without the `canAdd` guard.
    - Keep the existing append path (`canAdd` + `cursorState()`) for normal mode unchanged.
    - _Bug_Condition: isBugCondition_2(X)_
    - _Expected_Behavior: insert-cursor ghost; append ghost preserved (design Bug 2 fix steps 2–3)_
    - _Requirements: 2.3, 3.4_

  - [ ] 6.3 Verify the Bug 2 reproduction test now passes
    - **Property 3: Expected Behavior** - Ghost Renders at the Gap in Insert Mode
    - **IMPORTANT**: Re-run the SAME test from Task 4 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES — a non-empty ghost is anchored at `computeEntryAt(insertCursor + 1)` even with a trailing `FINISH`.
    - _Requirements: 2.3_

  - [ ] 6.4 Verify the Bug 2 preservation test still passes
    - **Property 4: Preservation** - Append Ghost Unchanged
    - **IMPORTANT**: Re-run the SAME test from Task 5 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES — append-mode ghost still anchored at `cursorState()`.
    - _Requirements: 3.4_

---

## Bug 3 — Undo removes the wrong piece in insert mode

- [ ] 7. Write the Bug 3 wrong-undo reproduction (bug-condition) test
  - **Property 5: Bug Condition** - Undo Removes the Just-Laid Piece in Insert Mode
  - **CRITICAL**: This test MUST FAIL on the unfixed code. DO NOT fix the test or code when it fails.
  - Add to `test/editor.test.ts` (reusing the DOM/`Renderer` fakes). Build a track ending in `FINISH`, delete a mid piece (insert mode), insert a `STRAIGHT` into the gap (click the palette button), then call `editor.undo()`.
  - Assert the just-laid `STRAIGHT` is removed, the trailing `FINISH` and the `frozenEntries` suffix stay intact, `insertCursor` steps back by one, and `isEditing()` remains true. **EXPECTED OUTCOME on unfixed code**: FAILS — `Track.undo()` pops the trailing `FINISH` and the `STRAIGHT` remains (also `Editor.undo` nulls `insertCursor` via `deselectPiece` first).
  - Document the counterexample (`FINISH` removed instead of the laid piece).
  - _Requirements: 2.4_

- [ ] 8. Write the Bug 3 append-undo preservation test (observation-first)
  - **Property 6: Preservation** - Append Undo Unchanged
  - **IMPORTANT**: Observe current behavior on the unfixed code, then assert it.
  - Add to `test/editor.test.ts` (and/or `test/track.test.ts`). For a non-editing track (no `insertCursor`, no `selectedIndex`), `editor.undo()` removes the last appended piece (final array element), exactly as the existing `undo removes the last piece` behavior.
  - **EXPECTED OUTCOME**: Test PASSES on unfixed code.
  - _Requirements: 3.5_

- [ ] 9. Fix Bug 3 — insert-aware undo

  - [ ] 9.1 Route `Editor.undo` through an insert-aware path (`src/editor.ts`)
    - Record the gap floor when entering insert mode in `deleteSelected()` via a small `insertAnchor` field (the predecessor index at the gap).
    - In `undo()`, branch BEFORE `deselectPiece()`: when `insertCursor != null && track.isEditing()` and a session piece exists (`insertCursor > insertAnchor`), remove the live piece at `insertCursor` and decrement `insertCursor`; rebuild and keep editing. When no session piece remains, fall back to a safe no-op / exit of insert mode.
    - Leave the normal-append path (`deselectPiece()` then `track.undo()`) for non-editing mode.
    - _Bug_Condition: isBugCondition_3(X) — insert mode + isEditing, undo removes last array element_
    - _Expected_Behavior: remove the live piece at the insert cursor, step cursor back, keep frozen suffix intact (design Bug 3 fix steps 1–3)_
    - _Requirements: 2.4_

  - [ ] 9.2 Remove the live piece via `Track.deleteAt` (`src/track.ts`)
    - Use `deleteAt(insertCursor)` for the removal: in editing mode with `index < frozenBoundary` it splices the live piece, leaves `frozenEntries` untouched, and stays editing — exactly the required semantics. Ensure no blind `pieces.pop()` is used in this path.
    - _Bug_Condition: isBugCondition_3(X)_
    - _Expected_Behavior: frozen suffix (frozenEntries + trailing FINISH) preserved (design Bug 3 fix step 4)_
    - _Requirements: 2.4_

  - [ ] 9.3 Verify the Bug 3 reproduction test now passes
    - **Property 5: Expected Behavior** - Undo Removes the Just-Laid Piece in Insert Mode
    - **IMPORTANT**: Re-run the SAME test from Task 7 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES — the laid `STRAIGHT` is removed, `insertCursor` steps back, `FINISH` and `frozenEntries` stay intact, still editing.
    - _Requirements: 2.4_

  - [ ] 9.4 Verify the Bug 3 preservation test still passes
    - **Property 6: Preservation** - Append Undo Unchanged
    - **IMPORTANT**: Re-run the SAME test from Task 8 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES — append-mode undo still removes the last appended piece.
    - _Requirements: 3.5_

---

## Bug 4 — Rejoin does not reconnect after deletion

- [ ] 10. Write the Bug 4 rejoin reproduction (bug-condition) test
  - **Property 7: Bug Condition** - Rejoin Re-anchors and Reconnects
  - **CRITICAL**: This test MUST FAIL on the unfixed code. DO NOT fix the test or code when it fails.
  - Add to `test/track.test.ts` and as a property in `test/collision.property.test.ts` (reusing arbitraries + the `straightTrackArb` style generator).
  - **Scenario**: build a track, delete a mid piece and rebuild a section of a *different length* (so the live exit no longer equals the original frozen `[0]` snapshot), then call `track.rejoin()`. Assert that — when the re-anchored, recomputed downstream is valid — `rejoin()` succeeds, clears `frozenEntries` (exits editing), and the downstream's first entry equals the live exit `computeEntryAt(frozenBoundary)`. **EXPECTED OUTCOME on unfixed code**: FAILS — the all-four-fields exact-match gate returns `false` and the track stays split.
  - Also cover the close-the-gap case (delete then immediately rejoin).
  - Document the counterexample (moved exit rejected by exact-match gate).
  - _Requirements: 2.5_

- [ ] 11. Write the Bug 4 rejoin preservation test (observation-first)
  - **Property 8: Preservation** - Rejoin No-op and Genuine Non-connect
  - **IMPORTANT**: Observe current behavior on the unfixed code, then assert it.
  - Add to `test/track.test.ts` / `test/collision.property.test.ts`:
    - Rejoin while NOT editing, or with an empty frozen suffix, is a successful no-op (`true`) — passes on unfixed code today.
    - A genuine non-connect (re-anchored, recomputed downstream would be invalid via overlap or floor `gz + dropHeight < 0`) returns `false` and stays in editing mode. On the unfixed code this currently returns `false` for the broader mismatch case; assert specifically the genuinely-invalid scenario so it stays `false` after the fix.
  - **EXPECTED OUTCOME**: No-op cases PASS on unfixed code; capture the invalid-downstream case as the post-fix contract.
  - _Requirements: 2.5, 3.6_

- [ ] 12. Fix Bug 4 — re-anchor-and-recompute rejoin (`src/track.ts`)

  - [ ] 12.1 Replace the exact-match gate in `Track.rejoin`
    - Keep the no-op success cases: not editing → `true`; empty frozen suffix → clear and `true`.
    - Replace the all-four-fields equality check with re-anchor-and-recompute: recompute each downstream piece's entry by chaining `applyPiece` from the live exit `computeEntryAt(frozenBoundary)`, and validate the recomputed downstream against the live region (overlap via the checked-region cells, floor via `gz + dropHeight`).
    - If valid, commit by clearing `frozenEntries` (so `entryStateAt` recomputes everything by chaining) and return `true`.
    - If invalid, keep `frozenEntries` intact, stay editing, and return `false` (`main.ts` already surfaces the "doesn't connect" status on `false`).
    - _Bug_Condition: isBugCondition_4(X) — recomputed downstream is valid yet rejoin returns false and stays editing_
    - _Expected_Behavior: re-anchor + recompute; succeed when valid, clear frozenEntries, downstream[0] == live exit (design Bug 4 fix steps 1–4)_
    - _Requirements: 2.5, 3.6_

  - [ ] 12.2 Verify the Bug 4 reproduction test now passes
    - **Property 7: Expected Behavior** - Rejoin Re-anchors and Reconnects
    - **IMPORTANT**: Re-run the SAME test from Task 10 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES — a moved/short downstream re-anchors, the track becomes continuous, and editing mode ends.
    - _Requirements: 2.5_

  - [ ] 12.3 Verify the Bug 4 preservation test still passes
    - **Property 8: Preservation** - Rejoin No-op and Genuine Non-connect
    - **IMPORTANT**: Re-run the SAME test from Task 11 — do NOT write a new test.
    - **EXPECTED OUTCOME**: Test PASSES — no-op cases still succeed; a genuinely invalid recomputed downstream still returns `false` and stays editing.
    - _Requirements: 2.5, 3.6_

---

## Integration & Final Verification

- [ ] 13. Add a full edit-flow integration test
  - Create `test/track-editing.integration.test.ts` driving the real `Track` (and the `Editor` with the DOM/`Renderer` fakes from `editor.test.ts` for the ghost/undo steps).
  - **Happy path**: append a complete track ending in `FINISH` → select & delete a mid piece → hover (assert a ghost is requested at the gap) → insert pieces into the gap → undo (assert the laid piece is removed and `FINISH`/`frozenEntries` stay intact) → `rejoin()` (assert continuous and `isEditing()` false) → assert `isComplete()` is true so play mode is reachable.
  - **Negative reconnection**: reroute so the recomputed downstream is invalid → `rejoin()` stays in editing mode and returns `false`; the user can keep building or undo.
  - _Bug_Condition: end-to-end exercise of isBugCondition_1..4_
  - _Expected_Behavior: design "Integration Tests" section_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 14. Checkpoint — run the full test suite and verify all pass
  - Run `npm test` (this runs `npm run typecheck` then `node --import tsx --test test/*.test.ts`).
  - Confirm the four bug-condition properties (1, 3, 5, 7) pass, the four preservation properties (2, 4, 6, 8) pass, the updated collision Properties 0/2/3 and unit tests pass, the new integration test passes, and no existing test (physics, scoring, pieces, etc.) has regressed.
  - If anything fails, fix the issue, re-stage, and re-run; ask the user if questions arise.
