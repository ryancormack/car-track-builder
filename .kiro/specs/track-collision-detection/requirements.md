# Requirements Document

## Introduction

Track Collision Detection prevents users from building invalid tracks by detecting two types of violations: track segments that descend below the floor level (gz < 0), and track segments that overlap or collide with existing track segments occupying the same grid cells. The feature enforces these constraints at the time of piece placement across all track-editing operations (append, insert, replace) and provides clear feedback when a placement is rejected.

## Glossary

- **Track**: A linear sequence of PieceId values starting from a fixed GridState, managed by the Track class.
- **Piece**: A catalogue entry defining a track segment's geometry including forward distance, turn, and elevation change (dz).
- **GridState**: A record containing grid coordinates (gx, gy, gz) and a compass direction (dir) representing the entry point of a piece.
- **Grid_Cell**: A discrete (gx, gy, gz) coordinate tuple identifying a single occupied position in the 3D grid.
- **Collision_Detector**: The module responsible for computing occupied cells and checking for overlaps and floor violations.
- **Floor_Level**: The minimum allowed gz value, defined as gz = 0. No piece entry, exit, or intermediate cell may have gz < 0.
- **Occupied_Cells**: The set of all Grid_Cell tuples currently claimed by pieces already placed on the track.
- **Multi_Cell_Piece**: A piece with a forward value greater than 1, meaning it spans multiple grid cells along its direction of travel (e.g., CORKSCREW forward=3, JUMP forward=2, HELIX_UP forward=3, SPIRAL_TOWER forward=4).
- **Drop_Height**: A configurable starting elevation (0–6) applied to the track's initial GridState gz value, raising the entire track above floor level.
- **Editor**: The build-mode UI that calls Track methods to add, insert, or replace pieces and displays status messages.
- **Frozen_Region**: The portion of the track downstream of an edit that retains its snapshot positions until the user performs a Rejoin operation.

## Requirements

### Requirement 1: Floor Violation Detection

**User Story:** As a track builder, I want the system to prevent me from placing pieces that go below the floor, so that my track always stays at or above ground level.

#### Acceptance Criteria

1. WHEN a piece placement would result in the placed piece's exit GridState having gz < 0 (computed as entry_gz + piece.dz), THE Collision_Detector SHALL reject the placement and leave the track unchanged.
2. WHEN a Multi_Cell_Piece (forward > 1) placement would cause any intermediate cell along its forward path to have gz < 0 (where intermediate cell elevations are computed by linear interpolation: entry_gz + (piece.dz × cell_index / piece.forward) for each cell_index from 1 to piece.forward − 1), THE Collision_Detector SHALL reject the placement and leave the track unchanged.
3. THE Collision_Detector SHALL treat gz = 0 as a valid elevation (floor level is the boundary, not a violation).
4. WHEN the Collision_Detector rejects a placement due to a floor violation, THE System SHALL display a status message indicating the piece cannot be placed because it would go below floor level, and the message SHALL remain visible for at least 2 seconds.
5. WHEN the track startState has gz = 0 and the first piece placed has dz < 0, THE Collision_Detector SHALL reject the placement (specific case of criterion 1 ensuring floor violation is caught from the very first piece).

### Requirement 2: Track Segment Overlap Detection

**User Story:** As a track builder, I want the system to prevent me from placing pieces that overlap existing track segments, so that the track is physically valid and pieces do not occupy the same space.

#### Acceptance Criteria

1. WHEN a piece placement would cause any of its occupied Grid_Cells to coincide with a Grid_Cell already in the Occupied_Cells set, THE Collision_Detector SHALL reject the placement by returning a failure result and leaving the track state unchanged.
2. THE Collision_Detector SHALL compute Occupied_Cells for a piece by stepping `forward` times along the piece's exit direction (dir + turn mod 4), starting from the entry cell, producing one Grid_Cell per step identified by integer coordinates (gx, gy, gz) where gz is interpolated linearly from entry gz to entry gz + dz over the forward steps.
3. WHEN a Multi_Cell_Piece (forward > 1) is placed, THE Collision_Detector SHALL include all intermediate cells (from step 1 through step forward minus 1) as well as the final cell in the overlap check against the existing Occupied_Cells set.
4. THE Collision_Detector SHALL NOT flag the entry cell of the candidate piece as overlapping when that cell matches the exit cell of the immediately preceding piece in the sequential chain, since these represent the shared connection point.
5. WHEN a piece turns (CURVE_L with turn = -1 or CURVE_R with turn = +1), THE Collision_Detector SHALL compute the occupied cell by stepping along the exit direction (entry dir + turn mod 4), consistent with the applyPiece geometry where movement uses the post-turn heading.
6. IF two pieces at different elevations (different gz values) occupy the same (gx, gy) coordinates, THEN THE Collision_Detector SHALL NOT flag this as an overlap, since Grid_Cells are identified by the full 3D tuple (gx, gy, gz).
7. WHEN the first piece of the track is placed, THE Collision_Detector SHALL accept the placement unconditionally with respect to overlap (since the Occupied_Cells set is empty), adding its occupied cells to the set.

### Requirement 3: Enforcement in Track Editing Operations

**User Story:** As a track builder, I want collision checks enforced whenever I add, insert, or replace a piece, so that every editing operation produces a valid track.

#### Acceptance Criteria

1. WHEN the user appends a piece via addPiece, THE Track SHALL compute the grid cells occupied by the new piece and reject the operation if any occupied cell overlaps with a cell already occupied by an existing piece in the checked region.
2. WHEN the user inserts a piece via insertAt, THE Track SHALL compute the grid cells occupied by the new piece and reject the operation if any occupied cell overlaps with a cell already occupied by an existing piece in the checked region.
3. WHEN the user replaces a piece via replaceAt, THE Track SHALL compute the grid cells occupied by the replacement piece and reject the operation if any occupied cell overlaps with a cell already occupied by another existing piece in the checked region.
4. IF the Collision_Detector determines that the placement would cause a grid-cell overlap, THEN THE Track SHALL return false from the operation and leave the pieces array, frozenEntries state, and editing mode unchanged from their values prior to the call.
5. WHILE the Track is in editing mode (frozenEntries is non-null), THE Track SHALL perform collision detection only against pieces in the live region (indices 0 through the frozen boundary exclusive), since frozen-suffix pieces retain their snapshot positions and are not subject to re-validation until Rejoin.
6. WHILE the Track is not in editing mode (frozenEntries is null), THE Track SHALL perform collision detection against all existing pieces in the track.
7. WHEN the Collision_Detector checks a piece placement, THE Track SHALL compare the candidate piece's occupied grid cells (determined by its entry state and geometry) against the occupied grid cells of each piece in the checked region, and detect a violation when any two pieces share the same (gx, gy, gz) cell.

### Requirement 4: User Feedback on Rejected Placements

**User Story:** As a track builder, I want to see a clear message explaining why a piece was rejected, so that I understand how to fix my track design.

#### Acceptance Criteria

1. WHEN the Collision_Detector rejects an addPiece, insertAt, or replaceAt operation due to a floor violation, THE Editor SHALL display a status message indicating the piece would go below floor level (gz < 0).
2. WHEN the Collision_Detector rejects an addPiece, insertAt, or replaceAt operation due to an overlap with an existing track segment, THE Editor SHALL display a status message indicating the piece would collide with an existing track segment.
3. THE Editor SHALL display all rejection messages using the error status style (kind = 'err') and auto-clear the message after the standard status timeout (2200 ms).
4. WHEN a placement is rejected, THE Editor SHALL NOT modify the track piece array, SHALL NOT call renderer.rebuildTrack or renderer.rebuildGhost, and SHALL NOT call renderer.clearGhost.
5. IF a new placement is rejected while a previous rejection message is still displayed, THEN THE Editor SHALL replace the previous message with the new rejection message and restart the auto-clear timer.

### Requirement 5: Occupied Cell Computation for Multi-Cell Pieces

**User Story:** As a track builder, I want collision detection to correctly handle pieces that span multiple grid cells, so that large pieces like corkscrews and helixes are properly checked.

#### Acceptance Criteria

1. THE Collision_Detector SHALL compute the exit direction for a piece as (entry.dir + piece.turn + 4) mod 4, and SHALL compute occupied cells as the sequence of N cells (where N equals the piece's forward value) starting at the entry cell (index 0) and stepping along the exit direction vector (DIRS[exitDir]) for indices 1 through N−1.
2. IF a piece has forward = 1, THEN THE Collision_Detector SHALL register exactly one occupied cell: the entry cell (gx, gy, gz).
3. IF a piece has forward = N where N > 1, THEN THE Collision_Detector SHALL register N occupied cells where cell_i = (entry.gx + DIRS[exitDir].dx × i, entry.gy + DIRS[exitDir].dy × i, entry.gz) for i in 0..N−1.
4. THE Collision_Detector SHALL identify a cell by the tuple (gx, gy, gz), treating cells at the same (gx, gy) but different gz as distinct non-colliding cells.
5. FOR each piece in the catalogue, WHEN the Collision_Detector computes occupied cells for that piece given an entry GridState, THE Collision_Detector SHALL produce a set whose first element equals the entry GridState position (gx, gy, gz) and whose last element equals the position (gx, gy, gz) of the exit GridState returned by applyPiece minus one exit-direction step.
6. WHEN two pieces in the track have overlapping occupied cells (identical gx, gy, and gz tuples), THE Collision_Detector SHALL report a collision indicating the indices of both conflicting pieces.

### Requirement 6: Drop Height Integration

**User Story:** As a track builder, I want collision detection to account for the track's starting elevation from Drop_Height, so that elevated tracks correctly allow descending pieces.

#### Acceptance Criteria

1. THE Collision_Detector SHALL compute elevations for floor violation checks using an effective starting GridState whose gz equals the Track's current Drop_Height value (range 0–6), with gx, gy, and dir taken from the Track's startState.
2. WHEN the Drop_Height is changed after pieces have been placed, THE Track SHALL retain all existing pieces in the track array unchanged and SHALL NOT remove, flag, or re-validate previously placed pieces against the new Drop_Height value.
3. IF Drop_Height is 0, THEN THE Collision_Detector SHALL reject any piece whose entry, exit, or any intermediate cell would have gz < 0, consistent with the floor violation rules defined in Requirement 1.
4. WHEN a piece is placed with Drop_Height greater than 0, THE Collision_Detector SHALL accept the piece if the cumulative elevation (Drop_Height plus the sum of dz values of all preceding pieces plus the candidate piece's dz) does not produce gz < 0 at any entry, exit, or intermediate cell.

### Requirement 7: Auto-Detection of Frozen Region Collisions During Rebuild

**User Story:** As a track builder, I want the system to automatically detect when my rebuilt track would collide with the frozen (downstream) region, so that I cannot accidentally build over the track parts that exist after my edit point.

#### Acceptance Criteria

1. WHILE the Track is in editing mode (frozenEntries is non-null), THE Collision_Detector SHALL automatically include the frozen-suffix pieces' occupied Grid_Cells in the overlap check when evaluating new piece placements in the live region.
2. WHEN the user places a piece in the live region whose occupied Grid_Cells would coincide with any Grid_Cell occupied by a piece in the Frozen_Region, THE Collision_Detector SHALL reject the placement and return false, leaving the track unchanged.
3. WHEN the Collision_Detector rejects a placement due to overlap with the Frozen_Region, THE Editor SHALL display a status message indicating the piece would collide with existing downstream track segments, using the error status style (kind = 'err').
4. THE Collision_Detector SHALL compute the Frozen_Region's occupied Grid_Cells from the frozenEntries snapshot positions, ensuring that the frozen pieces' cell positions are determined by their original entry states regardless of changes in the live region.
5. WHEN the user triggers a Rejoin operation, THE Track SHALL re-validate the connection point between the live region and the frozen region and merge the frozen pieces back into the active track, at which point the separate frozen-region collision check is no longer needed.
6. IF the live region's final exit GridState does not match the Frozen_Region's first entry GridState at Rejoin time, THEN THE Track SHALL report a mismatch and keep the editing mode active until the user resolves the conflict.
