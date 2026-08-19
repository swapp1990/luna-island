# Dispatch P4-2 — The wild start: an island with nothing built, and a supply chain that works without a depot

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read your own P4-1 work first (`BUILD_RECIPES`, `commission`, `gather`, shore `drink`, `SLEEP_GROUND_ENERGY` in `src/sim/sim.ts`), then `src/sim/worldgen.ts` (presets `default`/`lean`, place spawning), `src/sim/persist.ts` (save version + `ensureMindFields`), `src/render/terrain.ts` (how places are meshed — new places must appear when built), `scripts/soak-political.mjs` (`--preset`).

## Why

P4-1 made founding expressible but nothing uses it: worldgen still spawns the farm, forestry, quarry, stall, storehouse, well, plaza and notice board at tick 0, so the island is a finished town and the villagers' only possible achievement is another house. The operator's decision is a **wild start**: land and people, nothing built, including no notice board. Then "does a society emerge" becomes a real question instead of a rhetorical one.

Your own P4-1 report flagged the blocker: **construction hauls materials from a storehouse**, so in a depot-less world a site's bill can never be filled. Fix that first — a wild start without it is dead on arrival.

## 1. Deposit-to-site (world rule, do this first)

- An agent standing on/adjacent to a construction site may **deliver goods from its own inventory** to that site's bill. Traced event, consistent with existing goods events. This is the missing link between `gather` (fills inventory) and construction (consumes a bill).
- Keep the existing storehouse haul path working for developed worlds — this is an additional supply route, not a replacement.
- The utility layer may deliver (maintenance, like gather). Do NOT add "go build the thing" choreography: delivering is only eligible when the agent already carries the needed good and a site needs it.

## 2. The `wild` preset (`src/sim/worldgen.ts`)

Add preset `wild` alongside `default`/`lean`. It spawns:

- **Terrain as today** — water, sand, grass, forest, rock (the raw resources must be there).
- **Berry bushes** — same count as `default`. Foraging must sustain 24 villagers indefinitely; that is the survival floor.
- **A plaza** — keep it. It is a clearing, not a structure: it costs nothing, and social recharge needs somewhere to happen. State in the report that this is the one deliberate exception.
- **Nothing else.** No homes, farm, well, stall, storehouse, forestry, quarry, or notice board. Zero places of those kinds at tick 0.
- **Starting kit:** each villager gets the same small kit (state exactly what you chose — e.g. 2 food, 0 wood, 0 stone, the same coins as `default`). Equal start, per the Phase-2 decision that inequality must emerge.
- Agents spawn on walkable grass near the plaza, respecting one-per-tile.

## 3. Survivability without choreography

The wild start must not be a mass-collapse machine, and must not be rescued by scripts. Only world-rule levers are allowed:

- Foraging + shore drinking + sleeping rough must be sufficient to survive indefinitely. Verify by MEASUREMENT (§gate 3), and if it fails, adjust **rates** (bush yield/regrow, forage time, rough-sleep rate) — never by adding behaviour.
- Report the exact numbers you changed, if any, and why.

## 4. Renderer must show the town appear

A wild world starts nearly empty and gains buildings. Verify (and fix if broken) that:
- A newly completed place of each kind gets its mesh at completion, not only on reload — the P3-10 gap note said place meshes are built at import head, so check the live path.
- Construction sites are visible from commission (stakes/flag from P3-13 already exist).
- Gathering a forest/rock tile is visibly readable at least as a change in that tile's dressing (trees thinning or rocks shrinking is ideal; if that is too invasive, say so and leave a note — do not fake it).

## 5. Harness

`scripts/soak-political.mjs --preset wild` must work end to end (journal, exports, highlights hook). Journal gains per-minute `placesByKind` counts so a run's build-out is measurable after the fact.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; determinism green for the `wild` preset too (same seed ⇒ same hash); save version answer stated; both recorded soak worlds still import.
2. New vitest: `wild` spawns zero places of the 8 buildable kinds (plaza + bushes only); starting kit is identical across agents; deposit-to-site fills a bill and completes a structure from gathered goods with no storehouse present; determinism for `wild`.
3. **Survival measurement (mock brain, no LLM):** run a headless fast-forward of `wild` for **10 sim-days** with the utility brain only (no LLM), and report: collapses, recoveries, deaths (must be zero — collapse is not death), mean hunger/energy per day, and `placesByKind` at the end. Then the same for `default` as a control. If wild collapses more than a handful of times, adjust rates and re-run — quote both runs.
4. **Founding reachability (cheap, real model, only if budget allows):** `scripts/mind-probe.mjs` with a wild-world fixture, N=10 — does any villager choose `commission` or `gather`? Report the histogram. If the daily budget is exhausted, say so and skip; do NOT run a full soak.

## Final report (exact structure)

**BUILT** (preset contents + starting kit + any rate changes) / **GATES** (evidence incl. both survival runs with numbers) / **RENDERER** (what appears when built; what does not) / **PROBE** (or why skipped) / **DEVIATIONS** / **KNOWN GAPS**.
