# Dispatch P7-2c (Realism R2) — Embodied builders: cell claims, adjacency, and physical materials

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a
hang and killed. 3 failed attempts on one item → STOP and report.

**Prerequisite:** P7-2b (stages/roof) is merged. If `StageKind` does not exist in
`src/sim/blueprints.ts`, STOP and report — do not implement both dispatches at once.

**Files you MAY create/edit — nothing else:**
- `src/sim/blueprints.ts`, `src/sim/types.ts`, `src/sim/sim.ts`
- `src/town/structureVisuals.ts`, `src/town/agents.ts` (or wherever `src/town/` renders
  villager bodies — read first, name it in the report), `src/town/hud.tsx`, `src/town/debug.ts`,
  `src/town/main.tsx`
- `test/blueprint-*.test.ts`, `test/town-structure.test.ts`
- `e2e/town-blueprint.spec.ts` (update in place — no other `e2e/**` edits)

**Do NOT touch:** `src/mind/**`, `src/replay/**`, `src/ui/**`, `src/render/**`, `src/god/**`,
`src/sim/utilityBrain.ts`, `src/sim/playerCommands.ts`, `src/App.tsx`, `src/main.tsx`,
`src/loop.ts`, `src/bridge.ts`, `town.html`, `vite.config.ts`, `package.json`, `scripts/**`,
`plans/`, other `specs/`, `art/**`, `README.md`, `CLAUDE.md`.

**A dev server is already running on port 5175 (orchestrator's).** Browse it read-only. For
Playwright use `PLAYWRIGHT_PORT=5188`.

## Read before writing

1. `plans/construction-realism.md` — THE PLAN. This dispatch is Phase R2. Scaffolding, stakes,
   mud, stockpile dressing are R3 — do not start them.
2. `specs/phase7-2b-construction-stages.md` + its implementation — stage pipelines, roof gate,
   stocking/work routing you are making physical.
3. `src/sim/sim.ts` — `performBlueprintTend`, `applyStructureWork`, `stockStructureCells`, haul
   legs (`performHaulLeg`, `haulGood/haulSourceId/haulDropoffId`), slot-tile work occupancy, and
   the one-agent-per-tile rule. The claim system generalizes these, it does not bypass them.
4. `src/sim/spots.ts` — how slot tiles are derived for structure sites today.
5. How `src/town/` renders and animates villagers (walk interpolation, any existing action
   language from the charm specs) — reuse its idiom for the build pose.

## Architecture invariants that bind this dispatch

`src/sim/` pure TS, deterministic, traced. Bridge shapes additive only. **Zero UtilityBrain
edits** — brains still emit `deliver`/`work` at the site; claims, stand tiles, and pile routing
are ENGINE consequences of those intents (world rules: what standing here lets you do), never
brain choreography. If you find yourself wanting to edit `utilityBrain.ts`, the design is wrong
— STOP and report.

## What this is

After 7-2b a building rises in the right order, but "working the site" is still standing
anywhere on it while the engine teleports effort, and materials are an abstract site number
with a floating MAT token. After this dispatch a builder **claims one specific cell**, walks to
a tile **adjacent** to it, faces it, and visibly builds *it*; haulers carry materials to the
cell and drop them as a **visible staging pile** the builder consumes. Three villagers on a
site means three people hammering at three different cells.

Not in this dispatch: scaffolding/stakes/mud/stockpile dressing (R3), art (R4), reachability +
structural-support rules (R5 — adjacency here is about WHERE THE WORKER STANDS, not yet about
whether a cell is legally buildable).

## A. Cell claims — a world rule (`types.ts`, `sim.ts`)

`StructureCell` gains `claimedBy?: string` and `claimTick?: number`.

- When an agent in `work` at the site needs a target, the engine assigns the nearest claimable
  cell (Chebyshev from agent tile, tie → lowest index) whose next stage is `stocked` (7-2b
  eligibility) and which is unclaimed. One claim per agent, one agent per cell.
- The claim persists until: the stage completes (re-claim naturally on next work tick), the
  agent's action ends / they are vacated / they die, or the claim is **stale** —
  `CLAIM_STALE_TICKS = 60` without a work tick applied — whichever first. All releases traced
  in the claim's lifecycle events? No — event volume: claims are DATA on existing work/stage
  events (`data.cellIndex`), plus ONE event type `structure:claim-released` only for stale/
  vacate releases (reason says why). Stage-complete releases are implicit in
  `structure:stage-built`.
- Work ticks apply ONLY to the agent's claimed cell, and ONLY while the agent stands on a
  walkable tile orthogonally adjacent to it (or on it, for floor/foundation stages — you kneel
  on those). No adjacency ⇒ the engine retargets the agent's movement to the nearest free
  adjacent stand tile (existing retarget helper); tiles occupied by other agents are not free
  (one-agent-per-tile already enforces this).
- Slot tiles for structure sites become: the set of stand tiles adjacent to currently claimable
  cells (recompute on stage transitions, deterministic order). Job-seat capacity stays 3 from
  7-2a.

## B. Physical materials — per-cell staging piles (`sim.ts`, `blueprints.ts`)

`StructureCell` gains `staged: Partial<Record<Good, number>>`.

- Deliveries to a structure site land in the site inventory exactly as today (brains
  unchanged), BUT stocking changes meaning: instead of §B-1 of 7-2b consuming from site
  inventory directly into an abstract `stocked` flag, the engine now moves material from site
  inventory into the **lowest-index eligible cell's `staged`** pile at a haul-realistic rate —
  one unit per tick per site (a porter fiction until R3 gives it a body). A stage becomes
  `stocked` when its `staged` covers its cost, and the pile is consumed into the stage at that
  moment (traced, as today).
- Render every cell with a non-empty `staged` or a `stocked` uncompleted stage as a small
  material pile on the tile (logs / stone chunks by good, greybox). DELETE the floating MAT
  token.
- `construction.needs` semantics unchanged (remaining unstocked bill) so UtilityBrain delivery
  targeting is untouched.

## C. The builder is visibly building (`src/town/`)

- A working agent with a claim: body faces the claimed cell; a build pose plays — arm-bob
  hammer motion (reuse the villager-charm action idiom; a simple prop + oscillation is enough
  at greybox). Frame stage may use a saw pose if the idiom makes it cheap; otherwise hammer
  everywhere — do not gold-plate.
- Between claims / while hauling, no pose. Pose is driven by sim state read at render time
  (claim + adjacency), never by renderer guesses.
- HUD site card: list the workers on site by name with their current cell coordinate ("Kiba —
  wall (12,6)").

## D. Bridge — additive only

`listStructures()` rows gain `claims: Array<{ agentId: string, cellIndex: number }>` and
`piles: number` (cells with non-empty staged). New `__townControl.listCellDetail(placeId)` →
per-cell `{ index, kind, stageIndex, stageState, workedTicks, claimedBy?, staged }` for tests.
Nothing existing changes shape.

## E. Tests

Unit: claim exclusivity (two agents never share a cell; deterministic assignment order); work
ticks gated on adjacency (agent 2 tiles away applies nothing and gets retargeted); stale-claim
release at exactly `CLAIM_STALE_TICKS`; vacate/death releases; pile fill order and
stock-on-cover semantics; determinism two-runs-same-hash with 3 workers + stockSite; migration:
7-2b saves without `claimedBy`/`staged` load clean.

E2E (update `e2e/town-blueprint.spec.ts`): place school → `stockSite` → fastForward slices →
via `listCellDetail`, assert at some tick ≥3 distinct agents hold claims on ≥3 distinct cells
AND each claimant's rounded position is adjacent to (or on) its claimed cell; piles appear then
disappear as stages stock; school completes; contributors ≥3 as before. Sim-tick assertions
only.

## Gates

1. `npm run check` exit 0 (known Vitest RPC flake: rerun `npx vitest run --maxWorkers=1`,
   paste the pass line).
2. `PLAYWRIGHT_PORT=5188 npx playwright test --workers=1` — ALL suites green.
3. Greps pasted: `git status --porcelain -- src/mind src/replay src/ui src/render
   src/sim/utilityBrain.ts src/sim/playerCommands.ts` → empty; no
   `Math.random`/`Date.now`/`performance.now` under `src/sim/`.
4. Manual on 5175: place school, `stockSite`, watch at 2× — three builders at three different
   cells, facing them, hammer-bobbing; material piles at cells being worked; MAT token gone;
   HUD names workers with their cells. Paste `listCellDetail` excerpts showing distinct
   adjacent claims.
5. Do NOT run any `git` command. Do NOT run a soak. Do NOT call any LLM. Do NOT spawn
   subagents.

## Final report (exact structure)

**BUILT** — file-by-file / **CLAIMS** — assignment/release rules as implemented, divergences
from §A / **MATERIALS** — pile flow as implemented / **GATES** — 1–5 with evidence /
**DEVIATIONS** / **KNOWN GAPS** (expected: porter has no body until R3; scaffolding/stakes/mud
= R3; art = R4; reachability/support = R5).
