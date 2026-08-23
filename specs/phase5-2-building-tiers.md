# Dispatch P5-2 — Building tiers: structures level up through the same construction physics that raised them

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

**Narration is mandatory:** print one line before every long step (each gate command, each file you begin editing). A previous dispatch went silent for 17 minutes and was killed; silence is treated as a hang.

Working directory: `D:\MyProjects\Claude\luna-island`. Read before writing:

- `src/sim/sim.ts` — `BUILD_RECIPES` (~167), `buildableMenuLine` (~200), `commission()` (~3880; note the `already-owns` refusal at ~3905 and the `MAX_ACTIVE_SITES` cap), site completion (~4116–4170, `construction:completed` at ~4168), labour accrual (~2353).
- `src/sim/types.ts` — `Place` (~87), `ConstructionSpec` (~69; `targetKind` precedent for additive site fields), the additive-optional field precedent on `Tile` (`gatherStock`, `wear`).
- `src/render/terrain.ts` — `addPlace` (~1159, per-kind mesh dispatcher), `buildHomeMesh` (~1006), `buildSiteVisual` (~1049), `syncDynamicPlaces` (~732; live site→building swap at ~777 — the template for live level-change rebuilds).
- `src/mind/prompt.ts` (WORLD_RULES block + `buildableMenuLine` usage), `src/mind/knowledge.ts` (`formatNearbyPlaceLine` — where a level tag becomes visible), `src/sim/examine.ts`.
- `src/sim/persist.ts` — additive fields round-trip at `SAVE_FORMAT_VERSION = 5` (wear proved it; level should too).

## Why

Wear paths (P5-1) made *movement* history visible. This rung makes *investment* history visible: a village that has hauled wood for six days should not look like day 1. The mechanic must be real physics, not scenery — a level is bought with the same deliver-and-labour pipeline that raises buildings, and it must change something mechanical, or the visual story is fake.

Design rule (invariant 7): the engine adds what is POSSIBLE (upgrade sites, level effects); whether anyone upgrades is the Brain's business. No nudging, no auto-upgrades.

## A. Levels in the sim

- `Place.level?: number` — missing ⇒ 1 (additive-optional; old saves and both recorded soak worlds must import unchanged). Max level **3** (`MAX_PLACE_LEVEL`, exported). `construction-site`, `berry-bush`, `spring`, `plaza` do not level — only `BuildableKind` places do.
- **Upgrading reuses the refusal seam.** Today `commission('home')` when you already own a home refuses `already-owns`. Change: commissioning a kind you already own becomes an **upgrade commission** of that existing place — a construction-site is placed on a free buildable tile adjacent to it (same placement helper commissions already use), with `construction.upgradeOf = <placeId>` (new additive field beside `targetKind`). At progress ≥ 1 the site is removed and the target place's `level` increments — nothing else about the target place resets (inventory, jobs, owner all keep). At `MAX_PLACE_LEVEL`, refuse with a new honest `max-level` reason. Commons places (notice-board, well without an owner): anyone may commission their upgrade under the same rules — ownership is not required to improve the commons, owning a DIFFERENT kind is what routes to upgrade-vs-new.
- **Upgrade bill** = `BUILD_RECIPES[kind]` scaled by the CURRENT level (level 1→2 costs 1× the recipe, 2→3 costs 2×), labourTicks scaled the same. State the exact formula you ship in the report.
- **A level does something.** Two generic world rules, no per-kind special cases:
  1. `slots` +1 per level above 1 (more villagers can use it at once).
  2. Places with a `production` spec: `yield` +1 per level above 1.
  Home sleep quality, wages, prices: untouched — do not invent more effects.
- Events: the upgrade site's `construction:completed` event carries `upgradeOf` and the new `level` in `data`, with a human `reason` ("Ode's forestry was raised to level 2"). Commission refusals for `max-level` are honest no-op events like every other refusal.
- Determinism: same seed ⇒ same everything; double-run and `stateAt` re-sim gates must stay green. Level must round-trip saves at v5 (bump ONLY if genuinely forced; explain).

## B. Levels you can see (renderer)

- `addPlace` and the per-kind builders become level-aware. Budget your effort:
  - **home** gets a real 3-stage progression (buildHomeMesh already takes options): L1 the current hut; L2 visibly larger footprint or a second storey; L3 adds a chimney or gable — distinct silhouettes at the default camera distance.
  - **every other buildable kind** gets one generic, cheap level dressing applied uniformly (e.g. L2: a corner banner/pennant + 8% scale-up of the main mass; L3: a second pennant + trim color shift). One helper, applied in `addPlace` — not eight bespoke redesigns.
- **Live updates:** when a place's level changes mid-run (or the view scrubs across an upgrade), its mesh must rebuild — extend `syncDynamicPlaces`' existing site-completion swap machinery, keying on `(id, kind, level)` instead of just appearance/removal. Scrubbing back must show the lower-level building (state-derived, no renderer memory — same rule wear followed).
- Upgrade sites reuse the existing `buildSiteVisual` stake/scaffold look as-is.

## C. Levels a mind can know

- WORLD_RULES: extend `buildableMenuLine()`'s neighborhood with one factual line: commissioning a kind you already own upgrades it (bill scales with level, max 3), and a level adds capacity. Facts, no advice.
- `formatNearbyPlaceLine` (and examine text where natural): a place above level 1 shows it compactly — e.g. `forestry (lv 2)` alongside whatever stock/owner facts it already shows.
- No prompt nudges toward upgrading. The affordance is stated once in WORLD_RULES; circumstances do the rest.

## Gates

1. `npm run check` exit 0. `npm run e2e -- --workers=1` all pass (1 flaky retry tolerated if it greens). Purity grep of `src/sim/` empty.
2. New vitest: upgrade commission on an owned kind creates a site with `upgradeOf` and a level-scaled bill; completion increments level and preserves inventory/owner/jobs; `max-level` refuses honestly; level effects apply (slots +1; production yield +1); missing level reads as 1; level survives save round-trip and `stateAt` re-sim; a non-owner CAN upgrade a commons notice-board and CANNOT bypass `MAX_ACTIVE_SITES`.
3. Both recorded soak worlds still import.
4. UtilityBrain must not regress: S-series survival tests in the existing suites stay green (UtilityBrain never commissions upgrades today — confirm you did not teach it to; this dispatch adds no brain behavior).
5. Do NOT run a soak. Do NOT call any LLM. Do NOT run any `git` command.

## Final report (exact structure)

**BUILT** (sim fields + formula, refusal-seam behavior table: own-kind × level × outcome; render approach per kind; prompt lines shipped verbatim) / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
