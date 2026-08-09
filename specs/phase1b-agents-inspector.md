# Dispatch B — Agents, needs, inspector, per-agent replay

## Your role

You are the SOLE IMPLEMENTER for this dispatch. Work synchronously with your own file/shell tools. NEVER spawn subagents or unwaited background processes. NEVER run any `git` command. Do not edit `README.md`, `CLAUDE.md`, `plans/`, or `specs/`. Follow this spec exactly. If a gate can't go green after 3 distinct fix attempts, STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Dispatch A already built: deterministic sim core (`src/sim/`), island worldgen, three.js renderer with day/night, time controls, timeline scrubber, `window.__simState`/`__simControl` bridge, vitest determinism tests, Playwright smoke. **Read the existing code first and extend it in its own style. Do not restructure what works.** The architecture invariants in `CLAUDE.md` are law — especially: `src/sim/` stays pure (no DOM/three/Math.random/Date.now), determinism must survive everything you add, bridge shapes stay stable.

## What you're building

The island comes alive: 24 villagers with needs (hunger/energy/social) decide what to do via `UtilityBrain` (the `Brain` interface from `src/sim/types.ts`), walk the island, sleep at home at night, forage berries, drink at the well, socialize at the plaza. Every decision is traced with a human-readable reason. Click any villager → an inspector shows who they are, what they're doing and *why*, and their full activity log — live or at any point in replay.

## 1. Agents in the sim (`src/sim/`)

**Spawn** (in worldgen or a new `spawnAgents(world, rng)` called from the `Simulation` constructor): 24 agents. Names, in this order:
`Mira, Joss, Tama, Ren, Ode, Pia, Bram, Sela, Nook, Vero, Ansel, Wren, Kiba, Lumo, Etta, Faro, Gale, Hollis, Ines, Juno, Kes, Lark, Moss, Nia`.
Colors: cycle this palette (jitter-free, index % 12): `#e07a5f #81b29a #f2cc8f #6d9dc5 #c98bb9 #e3a857 #7fb069 #d95d67 #8e7dbe #56a3a6 #f4a259 #a26769`.
Each agent gets a `homeId` (round-robin over the 10 homes — sharing is fine), spawns at their home tile, needs start at deterministic values in [0.6, 0.9] from the sim rng.

**Needs decay per tick** (multiply by per-agent jitter factor drawn once at spawn from rng, range ±15%):
- hunger: −1/960 (empty in ~16 h)
- energy: −1/1080 while awake (empty in ~18 h); **+1/420 while sleeping**
- social: −1/720 (empty in ~12 h); **+1/90 while socializing** (also small +1/2880 passive regen when within 2 tiles of another agent)
Clamp all needs to [0,1]. Eating restores hunger +1/15 per tick for 15 ticks at a berry bush. Drinking at the well restores energy +0.02/tick for 5 ticks (quick refresh).

**UtilityBrain** (`src/sim/utilityBrain.ts`, `implements Brain`): score candidates, pick max:
- `sleep` (target: own home): `(1 − energy) × nightBias`, nightBias = 1.6 between 21:00–06:00 else 0.4. While asleep, keep sleeping until energy ≥ 0.95 or hour ≥ 7.
- `eat` (target: nearest berry-bush): `(1 − hunger) × 1.3`, +0.5 bonus if hunger < 0.25.
- `drink` (target: well): `(1 − energy) × 0.35` (daytime only).
- `socialize` (target: plaza): `(1 − social) × 0.9`, ×1.3 between 10:00–20:00.
- `wander` (target: random walkable tile within 8 tiles, via rng): flat 0.15.
**Hysteresis:** keep the current action unless a competitor beats its score by ≥ 0.15, except urgent interrupts (any need < 0.15 forces a re-decide). Re-decide on action completion, on arrival, or at most every 30 ticks.
**Reasons are product copy** — templates like `"Hungry (22%) — heading to the berry bushes"`, `"Exhausted after a long day — going home to sleep"`, `"Feeling lonely (social 31%) — joining the plaza crowd"`. Every `action:start` event carries one.

**Movement:** BFS path over walkable tiles (48×48, trivial cost). Speed 1.0 tile/tick along the path (float x/y so the renderer can interpolate). Re-path if the current path becomes invalid.

**Events** (extend `events.ts` usage; don't spam): `action:start` (kind, target, reason — REQUIRED reason), `action:end` (kind, outcome e.g. `"ate berries, hunger 34%→96%"`), `need:critical` (once per need per drop below 0.15), plus existing `day:start`. Walking is part of the action, not separate events.

**Integration:** implement the `stepAgents()` hook Dispatch A left in `Simulation.advanceTicks`. All randomness through the sim rng — grep-clean of `Math.random`/`Date.now` stays a gate. Snapshots must round-trip agent state (verify: the existing snapshot/seek tests must still pass with agents active).

## 2. Rendering agents (`src/render/agents.ts`)

- One mesh group per agent (24 is cheap): capsule body (cylinder h≈0.55 + sphere head r≈0.16) in the agent's color, head slightly lighter. Cast shadows.
- Interpolate positions between the last two sim ticks with the loop's accumulator alpha — movement must look smooth at 1× and 8×.
- Sleeping agents: scale y ×0.5 and dim material to 60% (they're "in bed").
- Selection ring: a flat ring/disc mesh under the selected agent (warm white, subtle pulse ok), follows them.
- Raycast selection: click on canvas → raycast against agent meshes → `selectAgent(id)`; click empty ground → `selectAgent(null)`. Keep OrbitControls drag vs click distinguished (only select if pointer moved < 5 px between down/up).

## 3. Inspector panel (`src/ui/Inspector.tsx`)

Right-side floating panel (dark translucent, rounded, ~300 px wide), `data-testid="inspector"`, visible only when an agent is selected:
- Header: color chip + name + `✕` close (deselects).
- Current action, big: verb + reason line under it (e.g. **Eating** — "Hungry (22%) — heading to the berry bushes").
- Three needs bars (Hunger/Energy/Social) with % labels, color shifting green→amber→red as they drop, `data-testid="need-hunger"` etc.
- **Activity log**: that agent's events (newest first, latest 50), each row `Day 2 14:03 — Started eating — Hungry (22%)…` from `action:start`/`action:end`/`need:critical`. `data-testid="activity-log"`.
- **Replay-aware:** in replay mode everything above reflects the forked sim at the replay tick, and the log only shows events with `tick ≤ replayTick`. (This is the RollerCoaster-Tycoon moment: scrub back a day, click Mira, watch her morning again.)
- Poll UI state at ~4 Hz plus on selection change; never setState per frame.

## 4. E2E + tests

Extend `test/determinism.test.ts` (all existing tests must STILL pass, now with agents):
- 3-sim-day double-run hash equality and seek-vs-fresh equality (existing tests now exercise agents).
- New: after 3 sim-days — every agent's needs ∈ [0,1] and finite; every agent has ≥ 1 `action:start` with a non-empty `reason`; every agent slept at least once (some `action:start` with kind `sleep`).

New `e2e/agents.spec.ts`:
1. `__simState.agentCount === 24`.
2. Life happens: `setSpeed(64)`, wait ~3 s → `eventCount` grew by ≥ 20 and some agent is doing a non-idle action.
3. Bridge selection: `selectAgent` first agent id (expose agent ids — add `window.__simState.agentIds: string[]` — this is an ADDITIVE bridge change, allowed) → inspector visible with the agent's name; needs bars present; activity log has ≥ 1 row.
4. Replay inspector: run to ≥ 600 ticks at 64×, `scrubTo(300)`, select an agent → log rows all have tick ≤ 300 (assert via displayed count or add `data-tick` attrs to rows).
5. Screenshot `artifacts/agents-day.png`: daytime, ≥ 5 agents visible near plaza/paths, inspector open on Mira. Screenshot `artifacts/agents-night.png`: ~23:00, most agents home. Non-black, > 20 KB.

## Acceptance gates — run all, paste evidence

1. `npm run build` exit 0.
2. `npm run test` all pass (including the untouched Dispatch-A tests).
3. `npm run e2e` all pass (smoke.spec.ts AND agents.spec.ts); screenshots exist.
4. `grep -rn "Math.random\|Date.now\|performance.now" src/sim/` → empty.

## Final report (exact structure)

- **BUILT**: file list, one line each.
- **GATES**: command + decisive output lines each.
- **DEVIATIONS**: differences from spec + why (should be ~empty).
- **KNOWN GAPS**: honest list.
