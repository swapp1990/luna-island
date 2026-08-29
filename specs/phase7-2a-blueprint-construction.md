# Dispatch P7-2a — Blueprint construction: buildings become cells, villagers raise them piece by piece

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang
and killed. 3 failed attempts on one item → STOP and report.

**Files you MAY create/edit — nothing else:**
- `src/sim/blueprints.ts` (new — the data model, validator, cost table, the school blueprint)
- `src/sim/types.ts`, `src/sim/sim.ts`, `src/sim/playerCommands.ts` (additive changes per §A–§D)
- `src/town/**` (ghost, visuals, HUD, bridge — per §E–§F)
- `test/blueprint-*.test.ts`, `test/town-*.test.ts` (new unit tests)
- `e2e/town-blueprint.spec.ts` (ONE new e2e file, §G — no other `e2e/**` edits)
- `src/render/**` ONLY if the old shell would crash on an unknown place kind — the minimal
  additive fallback (placeholder box), nothing more, reported as a deviation.

**Do NOT touch:** `src/mind/**`, `src/replay/**`, `src/ui/**`, `src/god/**`, `src/App.tsx`,
`src/main.tsx`, `src/loop.ts`, `src/bridge.ts`, `index.html`, `god.html`, `town.html`,
`vite.config.ts`, `package.json`, `scripts/**`, `plans/`, other `specs/`, `art/**`, `README.md`,
`CLAUDE.md`. `src/sim/utilityBrain.ts` must not change (§C explains why it won't need to).

**A dev server is already running on port 5175 (orchestrator's).** Browse it read-only. For
Playwright use `PLAYWRIGHT_PORT=5188`.

## Read before writing

1. `plans/colony-builder.md` — THE PLOT. This dispatch is Phase 2 ("The builder's hands")
   infrastructure: the player places a blueprint; villagers build it through the EXISTING
   construction economy. Minds/LLM goal-giving is a later dispatch — do not touch `src/mind/`.
2. `src/sim/types.ts` — `Place`, `ConstructionSpec`, `PlayerCommand`, `BuildableKind`, `Good`,
   `Tile`, `SimEvent`.
3. `src/sim/sim.ts` — `BUILD_RECIPES`, `validateBuildPlacement` (~line 300), the `build` player
   command handler (~line 1328), `MAX_ACTIVE_SITES`, `CONSTRUCTION_CONSUME_EVERY`, how sites
   consume materials and convert to finished places, slot-tile/work occupancy (~line 3283).
4. `src/sim/playerCommands.ts` + `world.playerCommandLog` — every player action is a recorded,
   deterministically replayable command. Your new command must follow the same pattern exactly.
5. `src/sim/utilityBrain.ts` — how agents pick gather/deliver/work targets for construction
   sites (this is the contract §C preserves).
6. `src/town/placementController.ts`, `src/town/placementGhost.ts`, `src/town/hud.tsx`
   (BUILD_MENU), `src/town/constructionPlan.ts`, `src/town/constructionVisuals.ts`,
   `src/town/places.ts` — the placement/render surfaces you extend.

## Architecture invariants that bind this dispatch

`src/sim/` stays pure TS (no DOM/three/random/wall-clock). Same seed + same
`playerCommandLog` ⇒ identical state hash (`npm run check` gates it). Every state change that
matters is a traced `SimEvent` with a human-readable `reason`. Window bridge shapes are
load-bearing — additive fields only. Engine codifies world rules, not behavior: everything in
this dispatch is a WORLD RULE (what a structure is, what a cell needs); no brain changes.

## What this is

Today a building is a point: one `(x,y)` Place, a uniform square footprint, one aggregate
material bill, one scalar `progress`. This dispatch makes structures **cell-shaped**: a
blueprint is a grid of cells (wall / door / floor), placed as a ghost, validated per-tile, and
raised **cell by cell** — materials delivered, each cell independently stocked → built, walls
becoming solid as they finish — until the structure converts into a functional place. One
blueprint ships: the **school**. Villagers (UtilityBrain, unchanged) build it exactly the way
they build everything else.

Not in this dispatch: minds/LLM anything, blueprint authoring UI, room/enclosure detection,
autotiled wall art, school functionality beyond existing (it completes as an inert social
place), milestone gating of the blueprint menu.

## A. The blueprint data model — `src/sim/blueprints.ts`

```ts
export type CellKind = 'wall' | 'door' | 'floor'
export interface BlueprintCell { kind: CellKind }
export interface Blueprint {
  id: string                    // 'school'
  name: string                  // 'School'
  width: number; height: number
  cells: Array<BlueprintCell | null>   // row-major, length width*height; null = outside shape
  resultKind: string            // place kind created on completion: 'school'
}
```

Per-cell cost table (a `const` in this file — the ONLY source of costs):

| cell  | wood | stone | labourTicks |
|-------|------|-------|-------------|
| wall  | 1    | 1     | 30          |
| door  | 2    | 0     | 20          |
| floor | 1    | 0     | 10          |

`export const SCHOOL_BLUEPRINT: Blueprint` — 7 wide × 5 tall:

```
WWWDWWW
W.....W
W.....W
W.....W
WWWWWWW
```

`W` wall, `D` door, `.` floor. (19 walls, 1 door, 15 floors ⇒ bill 36 wood, 19 stone, 740
labour ticks — sanity-check your encoding against these totals in a unit test.)

`export function validateBlueprint(bp: Blueprint): string[]` (empty = valid): dimensions match
cells length; at least one door; every non-null cell orthogonally connected to the shape;
every floor cell reachable from a door without crossing a wall. Registry:
`export const BLUEPRINTS: Record<string, Blueprint>` (just school for now), validated by a test.

## B. Placement — a recorded player command

New `PlayerCommand` variant: `{ kind: 'place-blueprint', blueprintId: string, x: number,
y: number }` — `(x,y)` = the blueprint's top-left cell in world tiles. Recorded in
`playerCommandLog`, replay-deterministic, same acceptance/rejection event pattern as `build`.

New validation `validateBlueprintPlacement(world, blueprintId, x, y)` mirroring
`validateBuildPlacement`'s result shape, but per actual cell (not a uniform radius): in bounds;
every cell tile buildable (no water/rock/non-walkable, same rules the existing validator
applies); no overlap with existing places' footprints or other structure cells; plus a 1-tile
walkable clearance ring so the site can be worked. Respect `MAX_ACTIVE_SITES` (a blueprint site
counts as one site).

On accept, create ONE place (`kind: 'construction-site'`, `targetKind: bp.resultKind`) anchored
at the blueprint's centre tile, carrying a new additive field:

```ts
// on Place
structure?: {
  blueprintId: string
  originX: number; originY: number          // top-left, world tiles
  cells: Array<{ state: 'planned' | 'stocked' | 'built' } | null>  // parallel to bp.cells
}
```

The site ALSO carries a normal `construction` spec whose `needs` = the summed remaining
material bill over unstocked cells. **This is the load-bearing trick:** UtilityBrain's existing
gather → deliver → work targeting reads `construction.needs` and works construction sites; it
keeps working verbatim with zero brain edits. Planned-cell tiles stay walkable.

Events: `blueprint:placed` (reason: `"placed school blueprint at (x,y)"`) and the standard
rejection event with `reasonCode` on invalid placement.

## C. The per-cell construction engine (inside `sim.ts`)

Blueprint sites do NOT use `CONSTRUCTION_CONSUME_EVERY` / scalar-progress conversion. Instead,
each site with `structure` runs this deterministic per-tick logic:

1. **Stocking.** While the site inventory holds enough material for the lowest-index `planned`
   cell (row-major index order — deterministic), consume that cell's cost from inventory and
   mark it `stocked`. Update `construction.needs` (= bill over remaining `planned` cells).
2. **Work routing.** When an agent works this site (existing `work` intent + slot occupancy —
   do not change how agents get there), their worked ticks apply to the `stocked` unbuilt cell
   **nearest to the agent's tile** (Chebyshev distance; tie → lowest index). Track
   `workedTicks` per cell (add it to the cell record).
3. **Cell completion.** At full `labourTicks` the cell becomes `built` — EXCEPT a wall/door
   cell whose tile is currently occupied by an agent: it stays 1 tick short until the tile is
   free (never trap or teleport an agent). On completion: wall tiles become non-walkable;
   door/floor tiles stay walkable. Emit `structure:cell-built` with a reason naming the cell
   kind and coordinates. Multiple agents on different cells in the same tick must all progress
   — demonstrate ≥3 concurrent builders in the e2e.
4. **Progress.** `construction.progress` = builtCells / totalCells (so existing progress UI and
   renderer stages keep reading something sane).

**Cancel/demolish:** the existing `cancel-construction` command on a blueprint site refunds the
site's unconsumed inventory (existing refund rules), removes the whole structure including
built cells, and restores every cell tile walkable. Deterministic, traced.

## D. Completion

When every cell is `built`: the site converts (same code path as normal site completion) into a
place of kind `school` — a NEW place kind that is **not** added to `BuildableKind`,
`BUILD_RECIPES`, or the milestone unlock tables (blueprints are a parallel path; keep the old
union untouched so every existing switch stays exhaustive). The finished place keeps the
`structure` record (built geometry is world truth: walls stay non-walkable). Its interaction
slot tiles = the interior floor cells. v1 behavior: agents may `socialize`/idle there like any
place with slots — nothing more. Emit `structure:complete` (reason:
`"school finished — 35 cells"`). Persistence/snapshots: all new fields are additive; old saves
(no `structure`) load unchanged; `stateAt(tick)` re-sim must reproduce mid-build states.

## E. Rendering + HUD (`src/town/`)

- **Ghost:** extend the placement controller/ghost with a `blueprint:school` tool — the cell
  grid drawn tile-accurate (walls/door/floor distinguishable), green/red per-cell validity,
  material bill readout. Placement click issues the new command through the same path player
  commands already flow.
- **Site visuals:** new `src/town/structureVisuals.ts` — per-cell greybox: `planned` = flat
  outline/decal on the tile; `stocked` = low material pile; built wall = 3 m grey box; built
  door = box with an opening (or half-height frame); built floor = thin slab. Neutral greys
  consistent with the existing construction look. This REPLACES the pad/frame/rising staging
  for blueprint sites only; normal sites keep `constructionPlan.ts` staging. Finished school:
  keep the built cell geometry (walls/floor/door) — a roof is NOT required this dispatch; note
  the modular-kit/autotile pass as a known gap.
- **HUD:** a "Blueprints" group in BUILD_MENU containing School (always available — note as
  temporary, no milestone gate). Selecting a blueprint site shows: cells built/total by kind
  ("walls 6/19"), remaining materials, workers currently on site.

Per-frame cost discipline: cell meshes update on state-change events, not rebuilt every frame.

## F. Debug bridge — additive only

DEV-gated additions (existing `__townState` / `__townControl` fields must not change shape):

```ts
__townState.structures = { active: number, built: number }   // sites with structure / completed
__townControl.placeBlueprint(id: string, x: number, y: number): { ok: boolean, reason?: string }
__townControl.listStructures(): Array<{ placeId: string, blueprintId: string, state: 'building' | 'built',
  cells: { planned: number, stocked: number, built: number, total: number },
  remaining: Partial<Record<'wood' | 'stone', number>> }>
__townControl.fastForward(ticks: number): void   // synchronously step the sim N ticks, no render between
```

`fastForward` must cap per call (≤ 20000) and flush `__townState`/`__simState` after.

## G. Tests

**Unit (`test/blueprint-*.test.ts`, node env, no three):**
1. `SCHOOL_BLUEPRINT` validates; totals = 36 wood / 19 stone / 740 labour; a mutant blueprint
   (no door, unreachable floor, length mismatch) fails with the right messages.
2. Placement validation: out-of-bounds, water under one cell, overlap with an existing place,
   clearance violation, site-cap — each rejects with the right code; a clean spot accepts.
3. Engine determinism: build a small world, place the blueprint, feed materials + scripted
   work; assert stocking order is row-major, work routes to nearest stocked cell, wall
   completion flips walkability, occupied-tile completion defers, progress math correct.
4. Full determinism: two fresh sims, same seed, same command log (place + run N ticks) ⇒
   identical state hash (use the existing hash helper `npm run check` uses).
5. Cancel: refund + tiles restored.

**E2E (`e2e/town-blueprint.spec.ts`, sim-tick assertions only, never wall-clock):** boot
`/town`, wait `__townState.ready`, `placeBlueprint('school', …)` at a known-valid spot (pick it
via world data, not hardcoded luck), `fastForward` in slices; assert cells monotonically
progress, ≥3 distinct agents contribute work (read the event trace or per-cell events), the
school completes within a generous tick budget, and `listStructures()` reports it `built`.

## Gates

1. `npm run check` exit 0 (strict tsc, vite build all entries, vitest incl. determinism gate).
2. `PLAYWRIGHT_PORT=5188 npx playwright test --workers=1` — ALL existing suites green (main app
   + god + town), plus your new spec green. No other `e2e/**` edits.
3. Greps, pasted: `git status --porcelain -- src/mind src/replay src/ui` → empty;
   `grep -n "utilityBrain" <your diff touchpoints>` shows no brain edits;
   no `Math.random`/`Date.now`/`performance.now` anywhere under `src/sim/`.
4. Manual on the running 5175 server: place a school via the HUD ghost (invalid spot shows
   red + reason; valid placement takes), watch at 4× — villagers gather/deliver, cells rise
   individually, walls become solid mid-build, completion converts to a school; paste
   `listStructures()` output at three moments (early / mid / built).
5. Old shell sanity: `/` boots and runs without errors (if a save/world containing a school or
   blueprint site reaches it, it renders a placeholder, never crashes).
6. Do NOT run any `git` command. Do NOT run a soak. Do NOT call any LLM. Do NOT spawn
   subagents.

## Final report (exact structure)

**BUILT** — file-by-file / **DATA MODEL** — final TS shapes as implemented (paste) /
**ENGINE** — stocking/routing/completion rules as implemented, any divergence from §C /
**GATES** — 1–6 with evidence pasted / **DEVIATIONS** / **KNOWN GAPS** (expected: roof/autotile
art pass, milestone gating, room detection, mind-issued blueprints).
