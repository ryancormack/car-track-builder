# Hot Track Builder

A browser-based, 2.5D car track builder inspired by classic Hot Wheels sets and Rollercoaster Tycoon. Snap orange track pieces together on a grid, drop your car from a tower or a booster, and watch it tear through loops, corkscrews, and jumps. Written in TypeScript and built with [Vite](https://vite.dev/); Three.js is installed from npm and bundled into the build (no CDN).

## Play

GitHub Pages: enable Pages on this repo with the included workflow (Settings → Pages → "GitHub Actions") and push. The workflow runs `vite build` and publishes the `dist/` output; the URL appears in the action summary.

Local dev: install dependencies and start the Vite dev server (with hot-module reload).

```bash
npm install
npm run dev          # Vite dev server with HMR, prints a localhost URL
# production build + local preview:
npm run build        # type-checks, then bundles into dist/
npm run preview      # serves the production build locally
```

## Controls

- **Sidebar palette** — click a piece to add it to the end of the track; hover to preview a ghost outline of where it lands. Hover a palette button for what the piece does and the entry speed it needs. The palette scrolls (the catalogue is taller than the panel) and its group headings stick as you go.
- **Garage** — pick a vehicle. Each has its own drag, friction and cornering grip, so the same track plays differently. The garage stays live during a race and sets the vehicle for the *next* launch, so a field can mix types — cars already on the track keep the one they were launched in.
- **Drop height slider** — sets initial speed (`v² = 2·g·h`). Higher drops = bigger stunts available.
- **Cars slider** — how many cars a run sends down the track. Cars share one path, so a faster car that catches the one in front rear-ends it and both go out.
- **Drag** the canvas to pan, **scroll** to zoom, press **R** to rotate the camera. In build mode the view frames the whole track automatically as it grows; your own panning is kept until you switch modes.
- **Space** toggles between Build and Play. In Play, the launch button sends the next car off.
- **Click a placed piece** to select it, then a palette piece to replace it, or **Del**/**Backspace** to delete it; **Escape** deselects. Deleting or inserting freezes the downstream track where it is until you press **Rejoin**.
- **Cmd/Ctrl-Z** undoes the last piece. **Clear** empties the track.
- **Save**/**Load** use browser storage; **Share** puts the whole track in the URL.

## Layout

```
src/                           TypeScript sources (Vite entry: src/main.ts)
├── main.ts                    app entry; wires the modules together
├── types.ts                   shared domain types (Piece, GridState, scores, …)
├── constants.ts               shared physics constants (g, friction, drag, loop radius)
├── track.ts                   linear sequence of pieces + start state, edit/rejoin model
├── collision.ts               cell occupancy, overlap and floor checks for placement
├── physics.ts                 energy-based simulator (gravity / friction / loops)
├── vehicles.ts                selectable cars and their handling multipliers
├── scoring.ts                 length + excitement + stunt-combo + bonuses
├── editor.ts                  build-mode UI (palette, tooltips, ghost preview, undo)
├── pieces/
│   ├── geometry.ts            DIRS, applyPiece, localToWorld — the seam contract
│   ├── paths.ts               parametric path samplers per piece
│   ├── definitions.ts         PIECES catalogue + palette groups (source of truth)
│   ├── frames.ts              moving frame per piece: tangent, surface normal, side
│   ├── resolve.ts             neighbour-aware path resolution (ramp grade blending)
│   ├── sampling.ts            world-space samples used by physics + renderer
│   └── index.ts               aggregator
├── renderer/
│   ├── index.ts               Three.js scene, camera, run loop
│   ├── colors.ts              palette
│   ├── meshes.ts              piece + ghost + start-tower mesh builders
│   ├── car.ts                 car mesh and tangent/banking placement
│   ├── controls.ts            drag / wheel / R-key camera controls
│   ├── roomLayout.ts          pure room-sizing + camera-fit maths (no Three.js)
│   └── environment.ts         optional living-room backdrop
└── app/
    ├── hud.ts                 HUD updates
    ├── overlay.ts             run-result overlay
    ├── environment.ts         backdrop toggle state
    ├── hash.ts                URL-fragment encode/decode for sharing a track
    └── storage.ts             localStorage save/load

test/                          node:test suites, run via tsx (see the dir for the
                               full list; catalogue.integration covers every piece
                               mechanically, so new pieces are included on arrival)

dist/                          Vite build output (git-ignored); created by `npm run build`
```

## Tooling

- `npm run dev` — start the Vite dev server with hot-module reload.
- `npm run build` — type-check (`tsc --noEmit`), then bundle `src/` + Three.js into `dist/` with Vite.
- `npm run preview` — serve the production `dist/` build locally.
- `npm run typecheck` — type-check sources and tests without emitting.
- `npm test` — type-check, then run the test suite with `tsx`.

## Pieces

**`src/pieces/definitions.ts` is the source of truth** — 42 pieces (41 in the palette; `START` is implicit). This section deliberately does not list them all: an exhaustive table here is a second copy that drifts the moment a piece is added, which is exactly what happened to the version of this README that documented nine of them.

The palette is grouped, and each group is a different kind of decision:

| Group | Count | What it is for |
| --- | --- | --- |
| Basics | 1 | Straight — the filler that costs least speed |
| Turns | 12 | Change heading. Plain curves are speed-gated and throw the car off if taken too fast; **banked** turns are not, so they are how you corner at speed. Also wide (2- and 3-cell) arcs, lane-shifting chicanes, and the Wave Turn, a banked corner with airtime over the apex |
| Elevation | 9 | Trade speed for height and back: ramps, steep ramps, the Steep Hill, and the two 180° hairpins — Switchback (climbs 2) and Dive Turn (drops 2) |
| Stunts | 13 | The scoring pieces: Loop, Giant Loop, Corkscrew, Zero-G Roll, Immelmann, Cobra Roll, Jump, Giant Jump, Top Hat, Spiral, Spiral Tower, Helix Up/Down |
| Hazards | 2 | Smash Wall and Crumbling Bridge — pass only above a speed threshold |
| Boost | 3 | Booster (+90 to `v²`, −15 score each), Brake, and Launchpad (a booster on a climbing ramp) |
| Finish | 1 | Ends the run, +250. The track locks once placed |

Hover any palette button in-game for that piece's effect and the entry speed it needs; the tooltip is generated from the piece's own fields, so it cannot go stale.

Every piece carries an `minV2` entry-speed gate (0 means ungated). The gates are **derived** from the physics constants rather than hand-tuned where possible — see `loopEntryGate` and the ramp/hill derivations in `definitions.ts` — so changing gravity or friction moves the gates with it.

## Adding a piece

See **`.kiro/steering/track-pieces.md`** for the full contract: the ordered checklist, the exact seam geometry a sampler must satisfy, the per-piece-id lists in `physics.ts` that a new piece has to be classified into, and the frame-parity trap that makes an inverting piece exit upside down if you get it wrong. `test/catalogue.integration.test.ts` enforces most of it mechanically.

## Physics

`physics.ts` uses an energy formulation: it tracks `v²` and updates it per substep with

```
Δ(v²) = -2·g·Δh   −   2·μ·Δs   −   2·c_d·v²·Δs
```

Δh is the actual altitude change between the current and next path samples, so loops correctly slow on the way up and accelerate on the way down. On entering a stunt piece with `minV2 > 0`, the simulator validates `v² ≥ minV2`; otherwise the run ends with a "Wipeout!".

The Loop's gate is **≈ 28.8**, not the naive `5·g·R` (24.5). `loopEntryGate` in `definitions.ts` adds the energy actually spent getting to the apex — gravity over the `2·R` climb plus the friction toll along the `R·(1+π)` of track from the entry seam to the top — and a small buffer, so a car that just clears the gate stays pinned rather than skimming the detach threshold. The Giant Loop's gate is ≈ 82.3 from the same derivation at three times the radius.

Two per-piece classifications in `physics.ts` decide how a piece behaves underpowered, and both must be set for a new piece: `isRampGrade` (pays the steeper-grade friction surcharge) and `isHill` (an underpowered car rolls back down instead of stalling on the spot). `test/catalogue.integration.test.ts` derives both from each piece's sampler and fails if a piece is missing, so they cannot silently fall out of step with the catalogue.

## Tests

```
npm test
```

Type-checks sources and tests, then runs every `test/*.test.ts` suite with `tsx`. Rendering and DOM glue are verified by hand; everything else is covered.

Most suites test one module, but three enforce catalogue-wide invariants and are the ones that keep a *new* piece honest without anybody remembering to add a case:

- `catalogue.integration.test.ts` — every piece can be placed, can be driven to the finish, has a gate reachable within the game's own speed budget, declares an arc length matching its sampler, and is correctly classified in `isRampGrade` / `isHill`.
- `new-pieces.test.ts` — the exhaustive seam audit: the exit tangent of **every** piece against the entry tangent of **every** piece, so no pairing creases.
- `coaster-elements.test.ts` — the same audit over the roll axis (surface normals), which catches a piece that joins with a perfect tangent but leaves the car rotated, plus the mechanic each recent piece was added for.

## Scoring

```
total = max(0, round(failMult · (length + excitement + stuntCombo
                                  + speedBonus + completionBonus
                                  − boosterPenalty)))
```

- `length` — 5 × number of pieces
- `excitement` — sum of per-piece excitement
- `stuntCombo` — +15 per extra consecutive stunt piece (loops / corkscrews / jumps)
- `speedBonus` — 4 × top speed reached
- `completionBonus` — +250 if the run finishes successfully
- `boosterPenalty` — 15 × boosters used
- `failMult` — 0.4 if the car wipes out, 1.0 otherwise

## License

MIT — see `LICENSE` if present, otherwise treat as MIT.
