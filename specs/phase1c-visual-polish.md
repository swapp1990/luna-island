# Dispatch C — Behavior fix + visual polish: make the island read as a cozy village

## Your role

You are the SOLE IMPLEMENTER for this dispatch. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. If a gate won't go green after 3 distinct fix attempts, STOP and report. Read the existing code first; make surgical changes in its style — this is a tuning pass, not a rewrite.

Working directory: `D:\MyProjects\Claude\luna-island`. Dispatches A+B built a working sim (island, day/night, agents, inspector, replay). All existing tests/e2e must stay green. Determinism invariants in `CLAUDE.md` remain law; worldgen changes WILL change hashes (fine — tests compare run-vs-run, not golden values), but sim purity and snapshot round-tripping must survive.

## 0. BEHAVIOR BUG (highest priority): sleep flip-flop churns all afternoon

QA evidence: an agent's activity log shows `Started sleep 13:54 → Finished sleep 13:55 (energy 62%→62%) → Started sleep 13:55 → ...` repeating for hours, energy pinned at ~62%. Root cause: the wake condition `energy ≥ 0.95 OR hour ≥ 7` is true all afternoon, so any daytime nap ends after one tick, then sleep immediately wins the next decide. Fix in `utilityBrain.ts` (and wherever the keep-sleeping check lives):

- **Wake rule:** wake when `energy ≥ 0.95`, or at the **07:00 boundary crossing** (asleep as the clock passes 7:00), not whenever `hour ≥ 7`.
- **Sleep scoring:** `sleep = (1 − energy) × nightBias + (energy < 0.2 ? 1.0 : 0)` with nightBias **1.6** in 21:00–06:00 and **0.15** during the day. (Day naps only happen on near-collapse; the exhaustion term guarantees they do happen.)
- **Minimum action duration:** once any action starts, no re-decide for 30 ticks unless an urgent interrupt (a *different* need < 0.15) fires. This kills event-log spam generally.
- **Reason copy must match reality:** "Feeling tired" only when energy < 0.35; bedtime at night says night-time copy. No more "Feeling tired (energy 62%)".
- Add a vitest regression: over 3 sim-days, no agent has more than 4 `action:start` events with `kind: 'sleep'` per sim-day.

## Problems observed in QA screenshots (fix each with the given numbers)

1. **Forest is a solid tree-wall covering half the island.** In `worldgen.ts`: raise the forest noise threshold so forest covers ≤ 25% of land tiles. In `terrain.ts`: only ~45% of forest tiles get a tree (deterministic per-tile hash, render-side); vary per-tree scale 0.7–1.3 and alternate two foliage greens (`#2f6b3a`, `#3d7d46`); tiny random yaw. Forest tiles WITHOUT a tree still read as forest via slightly darker ground tint.
2. **Rock region renders as a dense dark boulder blob.** Rock tiles: render as raised grey terrain boxes (their elevation already steps up) with only ~15% carrying a boulder dodecahedron (scale 0.5–1.0, greys `#8a8f98`/`#6f747c`). No boulders on top of trees.
3. **Homes overlap in a tight clump.** In `worldgen.ts`: place the 10 homes on a ring radius 4–7 tiles from the plaza with minimum Chebyshev spacing of 2 tiles between homes; each home yaw-rotated to face the plaza. If the region can't fit all 10, expand radius before giving up.
4. **Plaza + well don't read.** Plaza: light-stone disc radius ≈ 2.5 tiles (`#cfc6b3`), a few scattered flat stone slabs. Well: at the plaza edge — grey stone cylinder + small wooden A-frame roof (two dark beams + tiny pitched roof), so it reads as "well" from the default camera.
5. **Berry bushes are invisible.** Render each as a cluster of 3 overlapping low spheres in brighter green `#4e9b47` with 6–10 tiny red berry dots (`#d95d67`, r≈0.045) on the surface. Target: findable at a glance from the default camera.
6. **No paths — village looks unplanned.** In `worldgen.ts`: BFS a corridor from each home to the plaza and from plaza to well; mark those tiles `path: true` (add optional field to `Tile` — additive type change). In `terrain.ts`: path tiles render in packed-dirt `#c9b58a`, slightly lower saturation than sand. Agents already BFS over walkable tiles — additionally make path tiles cost 0.7 in the pathfinder so villagers PREFER paths (keep it deterministic; plain Dijkstra/weighted BFS is fine).
7. **Default camera too far/centered on the island, not the village.** Initial camera: target the plaza center, position at plaza + (14, 13, 14), OrbitControls target = plaza. The whole village + a good slice of island should fill the frame.
8. **Water is one flat blue.** Water tiles adjacent to land render shallow `#5fa3c9`; the rest deep `#3f7fae`. (Tint via vertex colors on the water plane, a second shallow plane, or per-tile quads — implementer's choice, cheapest wins.)

## Gates

1. `npm run build` exit 0.
2. `npm run test` all pass.
3. `npm run e2e` all pass (existing specs untouched unless an assertion hard-codes old worldgen specifics — if so, loosen minimally and note it in DEVIATIONS).
4. Fresh screenshots via the existing e2e screenshot flow: `artifacts/polish-day.png` (14:00, default camera) and `artifacts/polish-night.png` (22:00). Both non-black, > 20 KB.
5. Purity grep of `src/sim/` still empty.

## Final report (exact structure)

- **BUILT** (files touched, one line each) / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
