# Dispatch P4-7 — The contested commons: one spring, one slot, and denial with a name on it

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read before writing: `src/sim/types.ts` (`PlaceKind`, `Place`), `src/sim/spots.ts` (`PLACE_RADIUS`, `slotTiles`, slot-occupying actions), `src/sim/sim.ts` (`stepBushRegrowth`, `regrowGoods`, `claim`, the action-start/retarget paths where a place is used, `BUSH_STOCK_MAX`), `src/sim/examine.ts` (`EXAMINE_BY_KIND`), `src/sim/worldgen.ts` (`generateWorld`, wild preset branch, `PRESET_FACTS`), `src/mind/knowledge.ts` (`feltLineFromEvent`), `src/mind/prompt.ts` (`worldRulesText`, observation lines), `src/render/` (place meshes — a new kind must render, not crash).

## Why (evidence from the P4-6 Luna soak, seed 42, `artifacts/soak-1787255805681-story.json`)

On the real Luna brain — 581 mind decisions, 516 conversations, 0.2% fallback — the island produced **zero mind-authored proposals** for the third run running, despite a seeded worked example on the board and the propose/vote/sanction verbs in every mind's known-facts. The conversations show why, and it is not what we assumed:

There **is** scarcity, and the minds discuss it in public, repeatedly and almost verbatim — Lark, Lumo, Kes, Juno, and Ren (twice) each say *"The bushes by the forest are picked clean."* But every response is individual or dyadic, never collective: Wren *"Then we look farther out. I'm not wasting daylight mourning empty bushes."*; Ode *"I have a roof now… a quarry gives us stone to build with"* (and built the island's first quarry); Joss gave away food to collapsed neighbors twice, unprompted.

The diagnosis: **the island has scarcity but no rivalry.** Ten bushes, each with several slot tiles, deplete diffusely — the shortage is a property of the world ("the bushes are bare"), never an act by a person. Nobody is ever *denied* anything *by someone*. Politics is a response to attributable grievance, and this world cannot generate one. Worse, when a place *is* full, the engine currently says nothing about it — being blocked is invisible, so even the rivalry we do have is imperceptible (same class of bug as P4-5's price-tag menu: the fact exists, the information doesn't).

This dispatch adds rivalry as world physics and makes denial perceptible. It adds NO political choreography: nobody is scripted or nudged to propose, complain, or share. Whether a grievance becomes a rule stays entirely a Brain decision.

## A. The spring (world rule — a rival resource)

Add one new `PlaceKind`: `spring`.

- **Exactly one slot.** Set its `PLACE_RADIUS` so `slotTiles` yields precisely the centre tile (e.g. `0.4`) — one villager may use it at a time. Add a unit test asserting `slotTiles(world, spring).length === 1`. This is the existing occupancy rule at its extreme, not a new mechanic.
- **The best food on the island, and worth walking for.** It holds food like a berry bush (`inventory.food`), stock cap higher than `BUSH_STOCK_MAX` (suggest 8) and regrowth meaningfully faster than the bush interval (suggest one quarter of `presetFacts().bushRegrowInterval`). Reuse the existing `regrowGoods` path and extend `stepBushRegrowth` (or a sibling step that shares its code) — do not fork a second regrowth system. Foraging it uses the existing forage path unchanged.
- **Exactly one spring island-wide**, placed in the wild preset near the plaza but not adjacent to it (far enough that arriving is a choice, ~4–8 tiles). Keep bushes exactly as they are: the spring must be a *better* option, never the only one, so survival never depends on winning the contest. `default`/`lean` worldgen unchanged — their determinism hashes must not move.
- It spawns as `owners[springId] = 'commons'`, which means the existing `claim` action (15 coins) can already make it private. **Do not add, change, or special-case `claim`** — that it applies to the island's most valuable spot is the interesting part, and it is already in the engine.
- Required plumbing: `EXAMINE_BY_KIND` entry (plain physics — what it gives, that one person fits, no advice), `PLACE_RADIUS`, renderer mesh so it draws and does not crash, `placeKindLabel`, and any exhaustive `PlaceKind` switch the compiler flags. Wild determinism hash WILL change (new place) — that is expected; state the new hash in your report. Save version: state whether it moved.

## B. Denial has a name (information physics — the grievance generator)

Today, an agent who targets a place whose slots are all taken just… doesn't use it, silently. Fix that:

- When an agent's attempt to use a place fails **because every slot tile is occupied**, append a traced event (e.g. `place:blocked`) carrying the place kind, the place id, and **the names of the agents occupying it**, with an honest `reason`.
- Give it a `feltLineFromEvent` line in `src/mind/knowledge.ts` so it reaches the prompt through the existing Recently-felt pipeline — e.g. `could not use the spring — Wren was in the only spot`. Name the occupant. That name is the whole point: it converts "the world is stingy" into "a person was in my way."
- When the blocked place is **privately owned and the agent is not the owner**, the felt line must name the owner instead/as well — e.g. `could not use the spring — it is Wren's now`. This is the formal-exclusion case that `claim` creates.
- Purely informational. No cooldown, no retaliation mechanic, no sympathy penalty, no nudge. Do not add advice text anywhere ("you could propose a rule" is forbidden).
- Keep it honest and rate-sane: the same agent blocked by the same occupant at the same place repeatedly should not spam the trace every tick — collapse consecutive identical blocks the way `commissionLastRefusal` already handles repeat refusals, or equivalent. State exactly what rule you shipped.

## C. Ownership is visible where it matters

- The spring's `examine` result, and the observation line for a private place, must state the owner's name when the place is privately owned. If P4-4/P4-5 already do this for places generally, verify it covers the spring and say so; do not duplicate logic.

## D. Scenario probes (real model — the gate on the next soak)

Run on the **real Luna brain** (default engine — codex, model `gpt-5.6-luna` from the mind-home config; do NOT set `LUNA_ENGINE=grok`). If codex genuinely errors, STOP and report rather than silently switching engines — that substitution cost us two misleading soaks.

Extend `scripts/mind-probe.mjs`:

- **W8 `spring-blocked-once`:** comfortable needs, mild hunger, a spring nearby holding food, and the agent's Recently-felt containing ONE `place:blocked` line naming another villager in the only spot. Notice-board present and its verbs in Known. N=10. Measure the intent histogram: how many forage elsewhere / wait / socialize with the occupant / examine / propose / sanction? Verbatim ×3.
- **W9 `spring-claimed-by-another`:** same, but the spring is owned by another villager (`owners[spring] = 'agent-11'`, Wren) and the felt line reads as formal exclusion (`it is Wren's now`), plus two earlier blocked lines from the same source so it reads as a pattern, not an accident. Notice-board present, verbs in Known, agent has ≥2 coins (propose costs 2). N=10. Measure: any `propose`, `sanction`, or rule-talk reasoning? Any `claim` attempt? Verbatim ×3. **This is the dispatch's headline number** — it is the first fixture in the project's history where a mind has a named antagonist and a civic remedy in reach.
- **W4 + S3 survival regressions** unchanged — HARD GATES (the harness now scales the floor with `--n`; keep N=10 so the bar is 9/10).

All W-numbers are measurements, not pass/fail gates — report them honestly whatever they say, including zeros.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; determinism green for `default`, `lean`, AND `wild` (wild hash changes — assert stable across two fresh runs of the NEW world, and state the hash); both recorded soak worlds still import (they predate `spring` — confirm the loader tolerates worlds without it); save version stated.
2. New vitest: spring has exactly one slot tile; a second agent cannot use it while occupied; blocked emits the event with the occupant's name and produces the felt line; owner-exclusion felt line names the owner; repeat-block collapsing works as you specified; spring regrowth respects its cap and interval; `claim` on the spring transfers ownership with coin conservation (existing path — just prove it applies); `default`/`lean` worlds contain no spring.
3. Probes per section D, on the real Luna brain.
4. Do NOT run a soak. The orchestrator runs it after reviewing the probe numbers.

## Final report (exact structure)

**BUILT** (spring stats shipped, blocked-event shape, felt-line wording, repeat-collapse rule, new wild hash) / **GATES** (evidence) / **PROBES** (W8/W9/W4/S3 histograms + verbatim reasonings, engine stated) / **DEVIATIONS** / **KNOWN GAPS**.
