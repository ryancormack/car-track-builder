# Hot Track Builder

A browser-based, 2.5D car track builder inspired by classic Hot Wheels sets and Rollercoaster Tycoon. Snap orange track pieces together on a grid, drop your car from a tower or a booster, and watch it tear through loops, corkscrews, and jumps. Written in TypeScript and compiled to native ES modules (no bundler); Three.js is loaded from a CDN via an import map.

## Play

GitHub Pages: enable Pages on this repo with the included workflow (Settings → Pages → "GitHub Actions") and push. The workflow compiles the TypeScript and publishes the site; the URL appears in the action summary.

Local dev: install dependencies, build once (or watch), then serve the folder with any static file server.

```bash
npm install
npm run build        # or: npm run dev  (recompiles on change)
python3 -m http.server     # then open http://localhost:8000
# or
npx serve .
```

## Controls

- **Sidebar palette** — click a piece to add it to the end of the track; hover to preview a ghost outline of where it lands.
- **Drop height slider** — sets initial speed (`v² = 2·g·h`). Higher drops = bigger stunts available.
- **Drag** the canvas to pan, **scroll** to zoom, press **R** to rotate the camera.
- **Space** toggles between Build and Play.
- **Cmd/Ctrl-Z** undoes the last piece.

## Layout

```
src/                           TypeScript sources (compiled to dist/)
├── main.ts                    app entry; wires the modules together
├── types.ts                   shared domain types (Piece, GridState, scores, …)
├── constants.ts               shared physics constants (g, friction, drag, loop radius)
├── track.ts                   linear sequence of pieces + start state
├── physics.ts                 energy-based simulator (gravity / friction / loops)
├── scoring.ts                 length + excitement + stunt-combo + bonuses
├── editor.ts                  build-mode UI (palette, ghost preview, undo)
├── pieces/
│   ├── geometry.ts            DIRS, applyPiece, localToWorld
│   ├── paths.ts               parametric path samplers per piece
│   ├── definitions.ts         PIECES catalogue + palette ordering
│   ├── sampling.ts            world-space samples used by physics + renderer
│   └── index.ts               aggregator
├── renderer/
│   ├── index.ts               Three.js scene, camera, run loop
│   ├── colors.ts              palette
│   ├── meshes.ts              piece + ghost + start-tower mesh builders
│   ├── car.ts                 car mesh and tangent/banking placement
│   └── controls.ts            drag / wheel / R-key camera controls
└── app/
    ├── hud.ts                 HUD updates
    ├── overlay.ts             run-result overlay
    └── storage.ts             localStorage save/load

test/                          node:test suites, run via tsx
├── pieces.geometry.test.ts
├── pieces.paths.test.ts
├── track.test.ts
├── physics.test.ts
└── scoring.test.ts

dist/                          tsc build output (git-ignored); index.html loads dist/main.js
```

## Tooling

- `npm run build` — type-check and compile `src/` → `dist/` (native ES modules).
- `npm run dev` — same, in watch mode.
- `npm run typecheck` — type-check sources and tests without emitting.
- `npm test` — type-check, then run the test suite with `tsx`.

## Pieces

| Piece     | Effect                                  | Notes                                              |
| --------- | --------------------------------------- | -------------------------------------------------- |
| Straight  | 1 cell forward                          | Cheapest filler                                    |
| Turn L/R  | 90° turn into the side cell             | Free turning, slight friction over arc length      |
| Ramp Up   | +1 elevation                            | Costs energy — needs entry speed of √8             |
| Ramp Down | −1 elevation                            | Trades altitude for speed                          |
| Loop      | Vertical 360° loop                      | Needs `v² ≥ 5·g·R` (≈ 24.5) at entry, +30 excitement |
| Corkscrew | Barrel roll along the forward axis      | +18 excitement, decent speed required              |
| Jump      | Parabolic arc over the cell             | Skips the rails through the apex                   |
| Booster   | One-shot energy boost (+90 to v²)       | −15 from final score for each one used             |
| Finish    | Ends the run (+250 completion bonus)    | Track is locked once placed                        |

## Physics

`physics.ts` uses an energy formulation: it tracks `v²` and updates it per substep with

```
Δ(v²) = -2·g·Δh   −   2·μ·Δs   −   2·c_d·v²·Δs
```

Δh is the actual altitude change between the current and next path samples, so loops correctly slow on the way up and accelerate on the way down. On entering a stunt piece with `minV2 > 0`, the simulator validates `v² ≥ minV2`; otherwise the run ends with a "Wipeout!".

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

## Tests

```
npm test
```

Tests cover the pure-logic modules (`pieces/`, `track`, `physics`, `scoring`); rendering and DOM glue are visually verified.

## License

MIT — see `LICENSE` if present, otherwise treat as MIT.
