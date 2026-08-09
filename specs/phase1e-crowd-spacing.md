# Dispatch E — Crowd spacing: no more converging on a single point

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read the existing code first; surgical changes in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report. All `CLAUDE.md` invariants hold (sim purity, determinism, snapshot round-trip, additive-only bridge changes).

Working directory: `D:\MyProjects\Claude\luna-island`.

## Problem (user-observed, live)

All agents targeting a place (plaza, bush, well) path to the SAME tile — the crowd converges into a single point. There is no occupancy or personal space at all.

## Fixes (all in `src/sim/`, deterministic, seeded-rng only)

1. **Spot reservation.** An agent heading to a place reserves a specific destination tile, stored ON the action (so snapshots round-trip it). Candidate tiles = walkable tiles within the place's radius: plaza r=2.5, berry-bush r=1.2, well r=1.2, home = the home tile + its 8 neighbors. Exclude tiles that are (a) another agent's reserved destination or (b) another agent's current standing (non-walking) tile. Pick the nearest free candidate (tie-break via sim rng). If none free, widen the radius by +1 up to +3; if still none, pick any free walkable neighbor of the region edge. Arrival = reaching the reserved tile.
2. **Bush capacity.** A berry bush supports at most 2 concurrent eaters. If the nearest bush is full (2 reservations), target the next-nearest with a free slot. Reason copy stays honest: "Hungry (18%) — the near bushes are crowded, walking to the far ones".
3. **Milling while socializing.** After arriving at the plaza, every 20–40 ticks (rng), with 30% probability, step to an adjacent free tile within the plaza radius. Socializing agents should read as a loose, slowly-shifting crowd — never a stack, never statues.
4. **Co-standing resolution.** Two agents may pass through each other mid-walk (fine), but if two non-walking agents occupy the same tile, on the next re-decide the later-indexed one nudges to an adjacent free tile (no event spam — reuse the current action, just extend its path).
5. **Bed slots.** Residents of a shared home sleep on deterministic distinct tiles (home tile + neighbors by resident index) so sleepers don't stack visually.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty.
2. New vitest regressions:
   - Over 3 sim-days, sampling every 60 ticks: no tile ever holds > 2 stationary (non-walking) agents.
   - At any sample where ≥ 6 agents are socializing, mean pairwise distance between socializers ≥ 1.3 tiles.
   - Determinism double-run hash equality still passes (reservation logic must not consult anything unseeded).
3. New screenshot `artifacts/crowd-plaza.png`: run 64× to an afternoon moment with ≥ 6 agents at the plaza, showing a SPREAD crowd. Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
