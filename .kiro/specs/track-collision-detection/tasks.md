# Implementation Plan: Track Collision Detection

## Overview

Implement a pure-function collision detection module (`src/collision.ts`) that prevents invalid track placements by detecting floor violations (gz < 0) and overlap violations (same 3D grid cell occupied by another piece). Integrate the module into the existing `Track` class mutation methods and surface error messages through the `Editor` UI. A critical feature is **auto-detection of frozen region collisions** — when rebuilding a track section after a deletion, the system automatically prevents building over the frozen downstream pieces that still exist past the edit point.

## Tasks

- [x] 1. Create the collision detection module with pure functions
  - [x] 1.1 Create `src/collision.ts` with types and the `cellKey` utility
    - Create the new file with exports: `CellKey` type, `GridCell` interface, `CollisionResult` discriminated union, `CheckPlacementOpts` interface
    - Implement `cellKey(gx, gy, gz)` → `"${gx},${gy},${gz}"` string serialization
    - Import `Dir`, `GridState`, `Piece`, `PieceId` from `./types.js` and `DIRS` from `./pieces/geometry.js`
    - _Requirements: 2.2, 5.1, 5.4_

  - [x] 1.2 Implement `computeCells(entry, piece)` function
    - Compute exit direction: `(entry.dir + piece.turn + 4) % 4`
    - Step `piece.forward` times along exit direction vector `DIRS[exitDir]`
    - For each cell i: `gx = entry.gx + dx*i`, `gy = entry.gy + dy*i`, `gz = Math.round(entry.gz + piece.dz * i / piece.forward)`
    - Return array of `GridCell` with exactly `piece.forward` elements
    - _Requirements: 2.2, 2.3, 2.5, 5.1, 5.2, 5.3_

  - [x] 1.3 Implement `checkFloor(cells)` function
    - Iterate cells; return the first `GridCell` where `gz < 0`, or `null` if all valid
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 1.4 Implement `checkOverlap(cells, occupied, excludeCell)` function
    - Iterate cells; for each, serialize with `cellKey` and check membership in the `occupied` Set
    - Skip the `excludeCell` if provided (connection point exclusion — note: per design, this is not actually needed but kept for safety)
    - Return the first conflicting `GridCell` or `null`
    - _Requirements: 2.1, 2.3, 2.6_

  - [x] 1.5 Implement `checkPlacement(entry, piece, opts)` function
    - Call `computeCells` → `checkFloor` (priority) → `checkOverlap`
    - Return appropriate `CollisionResult` discriminated union value
    - _Requirements: 1.1, 2.1, 3.7_

  - [x] 1.6 Implement `buildOccupiedSet(pieces, startState, fromIndex, toIndex)` function
    - Chain `applyPiece` from startState to compute entry for each piece in range
    - For each piece, call `computeCells` and add all cell keys to a `Set<CellKey>`
    - _Requirements: 3.1, 3.5, 3.6_

  - [x] 1.7 Implement `buildFrozenOccupiedSet(pieces, frozenEntries, frozenBoundary)` function
    - For each frozen piece, use its snapshot entry from `frozenEntries` array
    - Compute cells using `computeCells` with the snapshot entry and add to Set
    - This is the key function for **auto-detecting frozen region collisions** — it ensures new placements cannot overlap with downstream frozen track
    - _Requirements: 7.1, 7.2, 7.4_

  - [x]* 1.8 Write unit tests for collision module pure functions
    - Create `test/collision.test.ts`
    - Test `cellKey` serialization
    - Test `computeCells` for STRAIGHT (forward=1), CORKSCREW (forward=3), CURVE_R (turn=+1)
    - Test `checkFloor` with gz=0 (accepted) and gz<0 (rejected)
    - Test `checkOverlap` with occupied/non-occupied cells
    - Test `checkPlacement` end-to-end for both violation types
    - Test `buildOccupiedSet` and `buildFrozenOccupiedSet` produce correct cell sets
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.5, 2.6, 5.2, 5.3, 7.1_

- [x] 2. Checkpoint - Verify collision module
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Integrate collision detection into Track class
  - [x] 3.1 Add `lastCollisionResult` field and helper methods to `src/track.ts`
    - Import collision module functions and `CollisionResult` type
    - Add `lastCollisionResult: CollisionResult | null = null` field
    - Implement `private _buildCheckedCells(excludeIndex?: number): Set<CellKey>` that:
      - In normal mode: builds occupied set for all pieces
      - In editing mode: builds live region set + frozen region set (auto-detection of frozen collisions)
    - Implement `private _getExcludeCell(index: number): CellKey | null`
    - _Requirements: 3.1, 3.5, 3.6, 7.1, 7.4_

  - [x] 3.2 Modify `addPiece` to perform collision check before mutation
    - Compute entry state for the new piece (cursor state)
    - Build checked cells for all existing pieces
    - Call `checkPlacement`; if rejected, set `lastCollisionResult` and return false
    - On success, clear `lastCollisionResult` and proceed with existing append logic
    - _Requirements: 3.1, 3.4, 6.1, 6.4_

  - [x] 3.3 Modify `insertAt` to perform collision check before mutation
    - Compute entry state for piece at the insertion index
    - Build checked cells excluding the piece being inserted (it doesn't exist yet)
    - In editing mode, include frozen region cells for **auto-detection** of frozen collisions
    - Call `checkPlacement`; if rejected, set `lastCollisionResult` and return false
    - On success, proceed with existing insert logic
    - _Requirements: 3.2, 3.4, 7.1, 7.2_

  - [x] 3.4 Modify `replaceAt` to perform collision check before mutation
    - Compute entry state for piece at the replacement index
    - Build checked cells excluding the old piece's cells at that index
    - Call `checkPlacement`; if rejected, set `lastCollisionResult` and return false
    - On success, proceed with existing replace logic
    - _Requirements: 3.3, 3.4_

  - [x] 3.5 Modify `rejoin()` to validate connection point mismatch
    - Before clearing frozen entries, compare live region's final exit state with frozen region's first entry
    - If mismatch: return `false` and keep `frozenEntries` intact (stay in editing mode)
    - If match: clear `frozenEntries` as before and return `true`
    - Change return type from `void` to `boolean`
    - _Requirements: 7.5, 7.6_

  - [x]* 3.6 Write unit tests for Track collision integration
    - Create or extend `test/track.test.ts` with collision-specific tests
    - Test `addPiece` rejects floor-violating piece (RAMP_DN at gz=0 with dropHeight=0)
    - Test `addPiece` rejects overlapping piece (U-turn track with 4 right curves → 5th overlaps)
    - Test `insertAt` rejects overlap with frozen region (auto-detection)
    - Test `replaceAt` excludes old piece's cells from check
    - Test rejected placement leaves track unchanged (atomicity)
    - Test `rejoin()` returns false on mismatch, true on match
    - Test two pieces at same (gx,gy) but different gz → no collision (elevation separation)
    - _Requirements: 1.1, 2.1, 2.6, 3.1, 3.2, 3.3, 3.4, 7.1, 7.6_

- [x] 4. Checkpoint - Verify Track integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate collision feedback into Editor
  - [x] 5.1 Modify `src/editor.ts` to read `lastCollisionResult` and display error messages
    - In the `_add` method: after `addPiece`/`insertAt`/`replaceAt` returns false, read `track.lastCollisionResult`
    - If `reason === 'floor'`: show "Cannot place: piece would go below floor level."
    - If `reason === 'overlap'`: show "Cannot place: collides with existing track." (or "...collides with downstream track." when in editing mode for frozen overlap)
    - Use existing `_setStatus(msg, 'err')` for display (already has 2200ms auto-clear)
    - Ensure rejected placements don't call `renderer.rebuildTrack` or `renderer.clearGhost`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.3_

  - [x] 5.2 Update rejoin handling in Editor/UI for mismatch feedback
    - When `track.rejoin()` returns false, display "Cannot rejoin: track doesn't connect. Keep building or undo."
    - Keep editing mode active (don't deselect or clear insert cursor)
    - _Requirements: 7.5, 7.6_

  - [x]* 5.3 Write unit tests for Editor collision feedback
    - Test that floor violation shows correct error message
    - Test that overlap violation shows correct error message
    - Test that rejoin mismatch shows feedback message
    - Test that rejected placement does not trigger renderer rebuild
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.3_

- [x] 6. Checkpoint - Verify Editor integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Property-based tests for collision detection
  - [x]* 7.1 Add `fast-check` dependency and create test file
    - Add `fast-check` to devDependencies in package.json
    - Create `test/collision.property.test.ts`
    - Define custom arbitraries: `gridStateArb` (gx/gy in [-10,10], gz in [0,6], dir in [0,3]), `pieceArb` (select from PIECES catalogue)
    - _Requirements: 5.1, 5.2_

  - [x]* 7.2 Write property test for Property 1: Floor Violation Detection
    - **Property 1: Floor Violation Detection**
    - For any piece and entry GridState, if any computed cell has gz < 0, `checkPlacement` returns `{ ok: false, reason: 'floor' }`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 6.1, 6.3, 6.4**

  - [x]* 7.3 Write property test for Property 2: Cell Computation Correctness
    - **Property 2: Cell Computation Correctness**
    - For any piece with forward=N and valid entry, `computeCells` produces exactly N cells with correct coordinates
    - **Validates: Requirements 2.2, 2.3, 2.5, 5.1, 5.2, 5.3**

  - [x]* 7.4 Write property test for Property 3: Cell Computation Consistency with applyPiece
    - **Property 3: Cell Computation Consistency with applyPiece**
    - First cell equals (entry.gx, entry.gy, entry.gz); one step beyond last cell equals applyPiece(entry, piece).(gx,gy)
    - **Validates: Requirements 5.5**

  - [x]* 7.5 Write property test for Property 4: Overlap Detection Rejects Colliding Placements
    - **Property 4: Overlap Detection Rejects Colliding Placements**
    - If computed cells have at least one CellKey present in occupied set, placement is rejected
    - **Validates: Requirements 2.1, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7**

  - [x]* 7.6 Write property test for Property 5: Elevation Separation
    - **Property 5: 3D Cell Identity — Elevation Separation**
    - Cells sharing (gx, gy) but differing in gz do not collide
    - **Validates: Requirements 2.6, 5.4**

  - [x]* 7.7 Write property test for Property 6: Rejection Atomicity
    - **Property 6: Rejection Atomicity**
    - Rejected placements leave track pieces array, frozenEntries, and editing mode unchanged
    - **Validates: Requirements 3.4, 4.4**

  - [x]* 7.8 Write property test for Property 7: Frozen Region Auto-Detection
    - **Property 7: Frozen Region Auto-Detection**
    - In editing mode, new pieces placed in the live region are checked against frozen-suffix cells and rejected on overlap
    - **Validates: Requirements 7.1, 7.2, 7.4**

  - [x]* 7.9 Write property test for Property 9: Valid Placements Accepted
    - **Property 9: Valid Placements Accepted**
    - If all cells have gz >= 0 and no cell is in the occupied set, placement succeeds
    - **Validates: Requirements 1.3, 2.7, 6.4**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses `node:test` with `tsx` for test execution (run: `node --import tsx --test test/*.test.ts`)
- The `fast-check` library is needed for property-based tests (task 7.1)
- **Frozen region auto-detection** (Requirement 7) is a critical safety feature: it ensures users cannot accidentally build track over downstream frozen segments during editing mode. This is implemented via `buildFrozenOccupiedSet` (task 1.7) and integrated in `_buildCheckedCells` (task 3.1) so that `insertAt` and `addPiece` in editing mode automatically include frozen cells in the overlap check.
- The collision module is pure functions with no side effects, making it straightforward to test in isolation before integrating with the Track class.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6", "1.7"] },
    { "id": 3, "tasks": ["1.8"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4", "3.5"] },
    { "id": 6, "tasks": ["3.6"] },
    { "id": 7, "tasks": ["5.1", "5.2"] },
    { "id": 8, "tasks": ["5.3", "7.1"] },
    { "id": 9, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9"] }
  ]
}
```
