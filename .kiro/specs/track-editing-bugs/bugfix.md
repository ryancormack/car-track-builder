# Bugfix Requirements Document

## Introduction

The track build/edit system has four observable defects in the placement, gap-filling, undo, and rejoin flows. The collision-detection feature (spec `track-collision-detection`) was implemented but does not reliably reject overlapping placements in practice, and the editing flow that runs after a piece is deleted (insert mode → build into the gap → undo / rejoin) behaves incorrectly. This bugfix targets the four reported defects so that overlaps are reliably rejected, the gap-fill preview appears, undo affects the piece the user just laid, and rejoin reconnects the track.

Each bug is treated as a separate requirement. For each, the bug condition C(X) (the observable trigger/state), the current incorrect behavior, and the expected correct behavior are stated, with a corresponding regression-prevention clause that the fix must not break.

The four bugs:

- **Bug 1 — Collision detection accepts overlapping pieces.** Pieces that occupy the same 3D grid cell `(gx, gy, gz)` as an existing piece can still be placed.
- **Bug 2 — Ghost preview missing while filling a deleted gap.** After deleting a piece (insert mode), hovering a palette piece shows no ghost preview.
- **Bug 3 — Undo removes the wrong piece in insert mode.** Undo while building into a gap removes the frozen end of the track (e.g. FINISH) instead of the just-laid piece.
- **Bug 4 — Rejoin does not reconnect after deletion.** After deleting and rebuilding, Rejoin fails to reconnect the live region to the frozen downstream.

### Bug Conditions C(X)

Let `X` describe the editor/track state and the candidate action that triggers each defect.

**Bug 1 — Overlap accepted**
```pascal
FUNCTION isBugCondition_1(X)
  INPUT: X = { entry, piece, occupiedCells }  // candidate placement context
  OUTPUT: boolean
  // X is buggy when the candidate piece claims a discrete grid cell that is
  // already occupied by another (non-connection) piece, yet placement succeeds.
  RETURN EXISTS cell IN trueOccupiedCells(entry, piece)
         SUCH THAT cell IN occupiedCells
         AND cell <> sharedConnectionCellWithPredecessor
END FUNCTION
```

**Bug 2 — Missing gap ghost**
```pascal
FUNCTION isBugCondition_2(X)
  INPUT: X = editor + track state on palette hover
  OUTPUT: boolean
  RETURN editor.insertCursor <> null
         AND editor.selectedIndex = null      // insert mode (gap-fill)
         AND track.isEditing() = true
         AND track.hasFinish() = true          // frozen suffix still holds FINISH
END FUNCTION
```

**Bug 3 — Undo wrong piece**
```pascal
FUNCTION isBugCondition_3(X)
  INPUT: X = editor + track state on Undo
  OUTPUT: boolean
  RETURN editor.insertCursor <> null
         AND track.isEditing() = true          // there is a frozen suffix to protect
END FUNCTION
```

**Bug 4 — Rejoin fails to reconnect**
```pascal
FUNCTION isBugCondition_4(X)
  INPUT: X = track state on Rejoin
  OUTPUT: boolean
  RETURN track.isEditing() = true
         AND track.frozenEntries.length > 0
         // live exit and frozen first-entry are geometrically connectable
         // (occupy a coincident connection point / are reconcilable) but
         // rejoin does not produce a continuous, recomputed track.
END FUNCTION
```

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a candidate piece is placed (via append, insert, or replace) and any of the discrete grid cells `(gx, gy, gz)` it occupies coincides with a cell already occupied by another piece, THEN the system accepts the placement and the pieces visibly overlap.

1.2 WHEN the overlapping piece is multi-cell (`forward > 1`), a turning piece, or an elevation-changing piece, THEN the system fails to detect the overlap because occupied-cell computation rounds interpolated elevation (`Math.round` on `gz`) so cells do not line up with neighbors, the connection-point exclusion removes more than the single shared seam cell and masks a real overlap, and intermediate/exit cells along the exit direction are not all reliably represented.

1.3 WHEN the editor is in insert mode after a deletion (`insertCursor` set, `selectedIndex` null) and the frozen downstream suffix still contains FINISH, and the user hovers a palette piece, THEN no ghost preview of the next piece appears (the hover handler aborts because `canAdd` returns false while the track has a Finish, and the ghost builder previews at the append point / end of track rather than at the gap).

1.4 WHEN the user presses Undo while building into a deleted gap (insert mode, frozen suffix active), THEN the system removes the last element of the pieces array — the frozen end of the track (e.g. FINISH) — instead of the piece the user just laid into the gap, and the insert cursor is not adjusted.

1.5 WHEN the user triggers Rejoin after deleting one or more pieces and building back, THEN the system stays in editing mode and does not reconnect: rejoin requires an exact match of all four `GridState` fields (`gx, gy, gz, dir`) between the live region's exit and the frozen suffix's first entry, returning false on any mismatch, and even when the fields match the frozen downstream snapshot positions are not recomputed so the track does not become visually continuous.

### Expected Behavior (Correct)

2.1 WHEN a candidate piece is placed and any discrete grid cell `(gx, gy, gz)` it occupies coincides with a cell already occupied by another piece (excluding only the single shared connection cell with its immediate predecessor), THEN the system SHALL reject the placement, leave the track unchanged, and report an overlap.

2.2 WHEN the overlapping piece is multi-cell, turning, or elevation-changing, THEN the system SHALL reliably detect the overlap by reasoning about every discrete cell the piece occupies (entry, intermediate, and exit cells along the exit direction) using consistent integer elevation values, and SHALL exclude no more than the single shared predecessor connection cell from the overlap check.

2.3 WHEN the editor is in insert mode after a deletion and the user hovers a palette piece, THEN the system SHALL display a ghost preview of that piece at the insert-cursor location (the gap being filled), regardless of whether the frozen downstream suffix still contains FINISH.

2.4 WHEN the user presses Undo while building into a deleted gap (insert mode), THEN the system SHALL remove the most-recently-laid piece in the live editing region (the piece at the insert cursor) and SHALL step the insert cursor back by one, leaving the frozen downstream suffix (e.g. FINISH) intact.

2.5 WHEN the user triggers Rejoin after building back into a gap and the live region's exit can connect to the frozen downstream, THEN the system SHALL re-anchor and recompute the downstream so the whole track is continuous again and exit editing mode; and WHEN the geometry genuinely cannot connect, THEN the system SHALL stay in editing mode and give the user clear feedback that the track does not connect.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a candidate piece's occupied cells do not coincide with any existing piece's cells, THEN the system SHALL CONTINUE TO accept the placement.

3.2 WHEN a candidate piece's entry cell coincides only with its immediate predecessor's exit cell (the shared connection seam), THEN the system SHALL CONTINUE TO treat that single shared cell as a valid connection and not flag it as an overlap.

3.3 WHEN a candidate piece (or any of its cells) would descend below the floor (`gz + dropHeight < 0`), THEN the system SHALL CONTINUE TO reject the placement as a floor violation.

3.4 WHEN the editor is NOT in editing mode (normal append) and the user hovers a palette piece on a track that can still accept pieces, THEN the system SHALL CONTINUE TO show the ghost preview at the append point (end of track).

3.5 WHEN the user presses Undo in normal append mode (not editing, no insert cursor), THEN the system SHALL CONTINUE TO remove the last appended piece.

3.6 WHEN Rejoin is triggered while not editing, or with an empty frozen suffix, THEN the system SHALL CONTINUE TO treat it as a successful no-op (nothing to reconnect).

3.7 WHEN two pieces occupy the same `(gx, gy)` column but different `gz` elevations, THEN the system SHALL CONTINUE TO treat them as distinct, non-colliding cells.
