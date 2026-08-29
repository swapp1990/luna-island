# Dispatch P7-2b (Realism R1) — Buildings rise bottom-up: stages, a roof, and visible progress

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang
and killed. 3 failed attempts on one item → STOP and report.

**Files you MAY create/edit — nothing else:**
- `src/sim/blueprints.ts`, `src/sim/types.ts`, `src/sim/sim.ts`, `src/sim/playerCommands.ts`
- `src/town/structureVisuals.ts`, `src/town/placementGhost.ts`, `src/town/hud.tsx`,
  `src/town/debug.ts`, `src/town/main.tsx`
- `test/blueprint-*.test.ts`, `test/town-structure.test.ts`
- `e2e/town-blueprint.spec.ts` (update in place — no other `e2e/**` edits)

**Do NOT touch:** `src/mind/**`, `src/replay/**`, `src/ui/**`, `src/render/**`, `src/god/**`,
`src/sim/utilityBrain.ts`, `src/App.tsx`, `src/main.tsx`, `src/loop.ts`, `src/bridge.ts`,
`index.html`, `god.html`, `town.html`, `vite.config.ts`, `package.json`, `scripts/**`, `plans/`,
other `specs/`, `art/**`, `README.md`, `CLAUDE.md`.

**A dev server is already running on port 5175 (orchestrator's).** Browse it read-only. For
Playwright use `PLAYWRIGHT_PORT=5188`.

## Read before writing

1. `plans/construction-realism.md` — THE PLAN. This dispatch is Phase R1. R2 (embodied workers)
   is the NEXT dispatch — do not start claims, adjacency, or per-cell piles.
2. `specs/phase7-2a-blueprint-construction.md` + `src/sim/blueprints.ts` — the substrate you are
   extending (cell model, `CELL_COSTS`, school blueprint, validator, helpers).
3. `src/sim/sim.ts` — `stockStructureCells`, `applyStructureWork`, `performBlueprintTend`,
   `stepStructureSites`, `completeBlueprintConstruction`, and the walkability +
   occupied-tile-deferral rules. You are refactoring these, not duplicating them.
4. `src/town/structureVisuals.ts` — per-cell greybox keyed on cell state; it will re-key on
   stage + fraction.
5. `test/blueprint-determinism.test.ts` — the two-runs-same-hash pattern; extend, don't weaken.

## Architecture invariants that bind this dispatch

`src/sim/` pure TS, no randomness/wall-clock. Same seed + same `playerCommandLog` ⇒ identical
hash. Traced events with `reason` on every state change that matters. Bridge shapes additive
only. World rules, not choreography: stages and prerequisites say what is POSSIBLE; nothing
here schedules agents.

## What this is

7-2a cells flip planned→built in one step, at uniform height, in arbitrary order, and the
school has no roof. After this dispatch every cell walks a **stage pipeline with
prerequisites**, walls **visibly grow with worked ticks**, the **roof** exists and closes over
last, and a DEV **stocked-site toggle** lets every future realism soak skip the supply economy.

Not in this dispatch: cell claims, worker adjacency, per-cell material piles, poses (all R2);
scaffolding/stakes/mud (R3); autotile/kit art (R4).

## A. Stage model — `src/sim/blueprints.ts`

```ts
export type StageKind = 'foundation' | 'frame' | 'wall' | 'door' | 'floor' | 'roof'
export interface StageSpec { kind: StageKind; wood: number; stone: number; labourTicks: number }
```

Stage pipelines per cell kind, plus a per-cell `roof: boolean` flag on `BlueprintCell`:

| cell kind | pipeline (in order) |
|---|---|
| wall  | foundation → frame → wall → (roof if flagged) |
| door  | foundation → frame → door → (roof if flagged) |
| floor | floor → (roof if flagged) |

Stage cost table (the ONLY source; replaces `CELL_COSTS`):

| stage | wood | stone | labourTicks |
|---|---|---|---|
| foundation | 0 | 1 | 8 |
| frame | 1 | 0 | 10 |
| wall | 1 | 0 | 12 |
| door | 1 | 0 | 8 |
| floor | 1 | 0 | 6 |
| roof | 1 | 0 | 8 |

School blueprint: every cell gets `roof: true` (flat footprint roof — real roof *geometry* is
R4). Expected totals — assert these in a unit test computed from the tables, do not hardcode
elsewhere: **90 wood, 20 stone, 966 labourTicks** (20 foundations on wall+door cells only;
floors are tamped earth — no foundation stage).

`StructureCell` becomes `{ stageIndex: number; stageState: 'pending' | 'stocked' | 'built';
workedTicks: number }` where `stageIndex` walks the cell's pipeline and the cell is DONE when
its last stage is built. Provide `cellPipeline(bp, i)`, `cellDone(...)`, and keep
`countStructureStates` returning the same `{planned, stocked, built, total}` shape the bridge
and e2e already read — map: planned = cell not started, built = cell fully done, stocked =
anything in between (in-progress). Additive detail goes in a NEW `stages` summary (see §E).

**Prerequisites (world rules):**
- Within a cell: stages strictly in pipeline order.
- **Roof gate (global):** no cell's roof stage may stock or work until EVERY wall and door cell
  in the structure has completed its wall/door stage. One deterministic predicate,
  `roofUnlocked(structure, bp)`.

**Persistence/migration:** old saves and snapshots carry 3-state cells. On load, migrate:
`planned` → stage 0 pending; `built` → final stage built (workedTicks full); `stocked` → stage
0 stocked. Roof flag absent ⇒ blueprint's current definition applies (cells map by index).
Migration must be deterministic and covered by a unit test.

## B. Engine — per-stage stocking, work, and completion (`sim.ts`)

Refactor the 7-2a trio to be stage-aware; the shapes agents see do not change (UtilityBrain
still targets the site via `construction.needs` + `work` — zero brain edits):

1. **Stocking.** While site inventory covers the NEXT unlockable stage of the lowest-index
   eligible cell (pipeline order, prereqs + roof gate respected), consume and mark that stage
   `stocked`. `construction.needs` = summed bill of all remaining unstocked stages.
2. **Work routing.** Worked ticks apply to the nearest cell (Chebyshev, tie → lowest index)
   that has a `stocked` uncompleted stage. `workedTicks` accrues per stage.
3. **Stage completion.** At full `labourTicks` the stage becomes `built`, `stageIndex`
   advances, `workedTicks` resets. Walkability: the tile turns non-walkable when a wall cell's
   **frame** stage completes (a standing frame blocks passage) — and the occupied-tile deferral
   rule moves to that stage: a frame stage stays 1 tick short while an agent stands on the
   tile. Door and floor tiles stay walkable throughout. Cancel restores walkability as today.
4. **Progress.** `construction.progress` = built stages / total stages (all cells). Site
   completes when every cell's pipeline is done — same conversion path as 7-2a.

Events: replace `structure:cell-built` with `structure:stage-built`
(`data: { placeId, index, cellKind, stage, x, y, agentName }`, reason like
`"wall frame raised at (x,y)"`). Keep `structure:complete` unchanged. The e2e's contributor
counting must be updated to the new event type.

## C. Rising geometry — `src/town/structureVisuals.ts`

Per-cell greybox keyed on (stage, fraction = workedTicks/labourTicks of the active stage):

- foundation: slab growing 0→0.3 m.
- frame: four corner posts + top beam lattice, growing 0→3 m (thin boxes are fine).
- wall: solid infill panel growing 0→3 m inside the frame; door: frame stays open with a
  half-height leaf appearing at 100%.
- floor: thin slab fading in over the tile.
- roof: flat slab at 3 m over the cell (tinted distinctly), appearing per-cell as roof stages
  complete — the roof visibly "closes over" the building last.
- Finished structure keeps walls+roof+floor geometry. Meshes update on stage/fraction change
  (throttle fraction updates to ≥5% deltas), never rebuilt per frame.

HUD site card: show current phase in words ("laying foundations", "raising the frame",
"building walls", "roofing") derived from the dominant in-progress stage, plus the existing
counts.

## D. Stocked-site sandbox (DEV, deterministic)

New player command `{ type: 'debug-stock-site', placeId: string }` — recorded in
`playerCommandLog` like every player action (replay-deterministic), gated so the TOWN UI only
offers it in DEV. Effect: inject the site's full remaining material bill into its inventory in
one traced event (`reason: "sandbox: site fully stocked"`). Bridge:
`__townControl.stockSite(placeId)` wraps it. This exists so realism soaks skip the forestry
economy — production behavior is untouched.

## E. Bridge — additive only

`listStructures()` rows keep every existing field and semantics, and gain:
`stages: { built: number, total: number }` and `phase: 'foundation' | 'frame' | 'walls' |
'roofing' | 'done'` (dominant in-progress stage, deterministic). `__townControl.stockSite` per
§D. Nothing existing changes shape.

## F. Tests

Unit: stage tables/totals (90/20/966); pipeline order enforced; roof gate blocks roof stages
until all walls done and unlocks after; walkability flips at frame completion with
occupied-tile deferral; migration of 3-state saves; two-runs-same-hash determinism including a
`debug-stock-site` command; progress math.

E2E (`e2e/town-blueprint.spec.ts`, updated): place school → `stockSite` → fastForward slices →
assert phases appear in order (foundation before any frame completes globally is NOT required —
order is per-cell; assert instead: no roof stage completes before all wall stages are done;
walls' built count is monotonic; final `phase: 'done'`, 35 cells built) → ≥3 distinct
contributors via `structure:stage-built` events. Sim-tick assertions only.

## Gates

1. `npm run check` exit 0 (the known Vitest worker-RPC teardown flake: rerun
   `npx vitest run --maxWorkers=1` and paste the pass line if hit).
2. `PLAYWRIGHT_PORT=5188 npx playwright test --workers=1` — ALL suites green.
3. Greps pasted: `git status --porcelain -- src/mind src/replay src/ui src/render
   src/sim/utilityBrain.ts` → empty; no `Math.random`/`Date.now`/`performance.now` under
   `src/sim/`.
4. Manual on 5175: place school, `stockSite`, watch at 4× — foundations, then frames rising,
   then wall panels climbing, roof closing over last, HUD phase text tracking it. Paste
   `listStructures()` at foundation, frame, wall, roofing, done moments.
5. Do NOT run any `git` command. Do NOT run a soak. Do NOT call any LLM. Do NOT spawn
   subagents.

## Final report (exact structure)

**BUILT** — file-by-file / **DATA MODEL** — final stage shapes as implemented (paste) /
**ENGINE** — stage stocking/routing/roof-gate/walkability as implemented, divergences from §B /
**GATES** — 1–5 with evidence / **DEVIATIONS** / **KNOWN GAPS** (expected: claims/adjacency =
R2, scaffolding/stakes = R3, real roof + autotile art = R4).
