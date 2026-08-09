# Dispatch H (v2) — General world rules, thin brains: slots, proximity, honest bubbles

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; surgical changes in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

**Read `CLAUDE.md` invariant 7 ("Scaffold, not script") first — it is the reason this spec exists and the standard your diff will be reviewed against.** The engine holds GENERAL world rules; agent behavior stays thin (the LLM brain replaces it in Phase 3). Your net diff should REMOVE about as much behavior code as it adds rule code. No new state machines, no groups/matchmaking, no per-place special cases.

## Problems (user-observed)

1. Socializers scatter uniformly across the plaza, each "chatting" alone.
2. The status bubble can't say who someone is chatting with.
3. Agents can end up restoring (drinking/eating) far from the place they're using — the old reservation ring-widening flings overflow to distant tiles.

## The fix: three general world rules + one thin brain preference

### World rule 1 — Interaction slots (generic, ALL places)

`Place` gains `slots: number` (worldgen sets: well 2, berry-bush 2, plaza 12, home = its residents count). A place's **slot tiles** are the free walkable tiles within its existing footprint radius (reuse the radii already in the code). An agent's place-directed action RESTORES only while standing on a slot tile of that place, and at most `slots` agents restore concurrently (ties broken by agent index — deterministic). Reservations (Dispatch E machinery — reuse it) are capped to slot tiles: DELETE the ring-widening beyond footprint (+1..+3) entirely. This one rule covers well, bushes, plaza, and future Phase-2 workplaces/market stalls with zero extra cases.

### World rule 2 — Social proximity

Social need regenerates only while ≥ 1 other agent is within 1.5 tiles (any agent — no group bookkeeping, no new sim state). The existing passive proximity regen merges into this single rule.

### World rule 3 — Occupancy (already exists, keep)

One stationary agent per tile via reservations. Unchanged.

### Thin brain preference (UtilityBrain, ~2 lines each)

- Socialize destination: among free plaza slot tiles, prefer one adjacent (≤ 1.5 tiles) to another current-or-inbound socializer; else nearest-to-center free slot tile. (Clustering then *emerges* from the proximity rule — no groups in code.)
- Any place full (no free slot tile): pick the next-nearest place of the same kind; if none, wander. No waiting states.

### Legibility, derived at render/UI time (NO sim state)

- Socializer bubble: nearest other agent within 1.5 tiles → `💬 Chatting with <name>`; none → `💬 Looking for company`. Walking: keep existing `→ <destination>` style.
- Inspector/ticker copy unchanged except it stays honest (reasons already name needs/destinations — fine).

## Cleanup (part of the point)

- Delete E's milling special-case if World rule 1 + the brain preference make it redundant; keep it only if the plaza turns into statues without it (note your call in DEVIATIONS).
- Remove the uniform mean-pairwise-≥1.3 test. Replace with world-rule tests (below).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty.
2. New/replacement vitest (sampled every 60 ticks over 3 sim-days, seed 42):
   - Any agent actively restoring at a place stands on one of that place's slot tiles, and concurrent restorers ≤ slots (asserted GENERICALLY over all place kinds in one loop — not per-kind cases).
   - Any tick social regen applies to an agent, another agent is within 1.5 tiles.
   - ≤ 1 stationary agent per tile.
   - Determinism double-run + snapshot/seek hash equality still green.
3. Screenshot `artifacts/world-rules-plaza.png`: afternoon plaza with ≥ 6 socializers in visible adjacent clusters (emergent, not scripted), one selected showing `💬 Chatting with <name>`. Non-black, > 20 KB.
4. **LOC sanity**: report `git diff --stat`-style net lines for `src/sim/` in your final report (from file sizes if needed) — expect roughly net-neutral or negative outside worldgen/tests.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
