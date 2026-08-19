# Dispatch P4-1 — Founding capability: buildable place kinds, raw-terrain gathering, shoreline water

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` invariants (especially **7: engine encodes what is POSSIBLE, brains decide what to DO** — this dispatch is pure capability, zero policy), `src/sim/sim.ts` (`commission`, the construction pipeline `site.kind = 'home'`, `consumeGoods`/`regrowGoods`, action dispatch), `src/sim/types.ts`, `src/sim/worldgen.ts` (what spawns today; terrain kinds `water/sand/grass/forest/rock`), `src/sim/spots.ts`, `src/sim/utilityBrain.ts` (candidate scoring + `STRATEGIC_ACTION_KINDS`), `src/mind/prompt.ts` (action list + world rules text).

## Why

The island currently spawns fully developed: farm, forestry, quarry, stall, storehouse, well, plaza AND the notice board all exist at tick 0, and the only constructible thing is a home (`site.kind = 'home'` is hardcoded, one active site island-wide). So villagers inherit a working economy and can never found anything — which defeats the premise of an emergent-civilization sandbox. The operator's decision: the world will start wild (a later dispatch), and **the engine must first be able to express founding**.

**This dispatch changes capability only. Do NOT change worldgen.** Existing worlds, saves, replays, the two recorded soak worlds, and every current test must keep working unchanged.

## 1. Buildable place kinds with recipes (`src/sim/sim.ts`, `types.ts`)

- Replace the hardcoded home completion with a **recipe table**: `kind → { wood, stone, labourTicks }`. Cover at least: `home`, `farm`, `well`, `stall`, `storehouse`, `forestry`, `quarry`, `notice-board`.
- **Cost shape matters and is a product decision, not yours to reshuffle:** `notice-board` must be the CHEAPEST structure (a couple of wood, minimal labour) — the civic experiment requires that posting a rule is reachable on day one, not gated behind an economy. `home`/`storehouse`/`stall` are mid. `well` is stone-heavy. Put the table in one place with a comment saying it is world physics, not policy.
- `commission(agentId, kind, x, y)` (or the closest minimal extension of the existing signature) accepts the kind. Refusals stay honest, traced, no-op events as today: unknown kind, unaffordable, tile not buildable, site cap reached, cooldown armed.
- **Site cap:** replace the single island-wide lock with: at most **one active site per commissioner**, and at most **3** island-wide. Keep the P3-14 failed-commission cooldown behaviour.
- Completion sets `site.kind` to the commissioned kind and initialises whatever that kind needs (inventory, slots, wage/job hooks, ownership). A completed `farm`/`forestry`/`quarry`/`stall` must be a fully working place of that kind — indistinguishable from a worldgen-spawned one. Deed/ownership: private for `home`, commons (treasury) for the rest, unless the existing ownership model says otherwise — state what you chose.

## 2. Raw-terrain gathering (new world rule)

Bootstrapping cannot require a pre-built forestry or quarry. Add a `gather` action kind:

- `gather` targets a **terrain tile**, not a place: `forest` → wood, `rock` → stone. Yield after N ticks of standing on/adjacent to that tile, respecting the one-standing-agent-per-tile rule.
- Depletion is a world rule, and must be sane: a gathered tile yields a bounded amount and regrows on a timer (reuse the bush-regrowth pattern; do NOT invent a second mechanism). Emit traced events consistent with existing goods events.
- Add `gather` to the mind's action list and to `STRATEGIC_ACTION_KINDS`? **No** — gathering is maintenance, not strategy: sheep may gather. Only `commission` stays mind-only for Luna agents.

## 3. Shoreline water (no new terrain kind)

Water already exists as terrain. Allow `drink` at any tile **adjacent to a `water` tile**, at a lower restore rate than a built `well` (a well is an improvement: closer to home, better rate). No new terrain kind, no new place.

## 4. Sleeping rough

Sleeping on a tile that is not a home slot recovers energy at a reduced rate (pick ~60%, state the number). This makes shelter valuable without making the wild start lethal. World rule only — no behavioural nudge anywhere.

## 5. Prompt/world-rules text (`src/mind/prompt.ts`)

Update the WORLD_RULES block and the action list so minds know these are possible — plain capability statements, in the existing terse voice, with NO encouragement to build anything. E.g. that structures can be commissioned on buildable ground for wood/stone/labour, that wood comes from forest tiles and stone from rock tiles, that water can be drunk at the shore, that sleeping without a roof rests you less. Do not name a "best" build order, do not mention the notice board specially, do not add goals.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; determinism test green (same seed ⇒ same hash) — and **state explicitly whether the save format version had to change**; if yes, old-world load must still work (the two recorded soak worlds must still import: verify by loading `artifacts/soak-1786938450347-world.json` through the existing import path in a test or script and reporting the head tick).
2. New vitest coverage: recipe affordability and refusal reasons; per-commissioner and island site caps; each buildable kind completes into a working place of that kind (assert its slots/inventory/job behaviour, not just `kind`); `gather` yields from forest and rock, respects occupancy, depletes and regrows; shoreline `drink` works and is weaker than a well; sleeping rough is slower than sleeping home; cooldown still silences repeat failures.
3. `utilityBrain.ts` may change (it must not crash on the new kinds, and sheep may gather) — quote the full diff of that file in the report. Sheep must NOT commission for Luna agents (P3-14 boundary intact).
4. **Behaviour probe (cheap, real model):** run `scripts/mind-probe.mjs` with a fixture where a villager stands near forest/rock with an empty village and comfortable needs, N=10, and report the action histogram + 3 reasonings. This is a read on whether founding is *reachable* in prompt space — not a pass/fail gate. Do NOT run a full soak.

## Final report (exact structure)

**BUILT** (incl. the recipe table as shipped) / **GATES** (evidence; save-version answer; old-world import proof) / **UTILITYBRAIN DIFF** (full) / **PROBE** (histogram + reasonings) / **DEVIATIONS** / **KNOWN GAPS**.
