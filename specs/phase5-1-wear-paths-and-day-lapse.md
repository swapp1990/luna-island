# Dispatch P5-1 — Wear paths (the town organizes itself around real traffic) + day-lapse (growth you can watch)

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read before writing:

- `src/sim/sim.ts` — the movement step loop (~lines 1914–1926: `agent.x = nx; agent.y = ny; agent.pathIndex++`); this is where wear accrues.
- `src/sim/types.ts` — `Tile` (~line 10). Note the precedent on the gatherable-stock field: *"Missing ⇒ full stock. Additive; old saves treat as full."* Wear follows the same additive pattern (missing ⇒ 0).
- `src/render/terrain.ts` — `buildTerrain`, the ground-box loop (~line 275, per-tile meshes; `PATH_COLOR = 0xc9b58a` packed dirt at ~128), `updateEconomyVisuals(places, now, tiles)` (already called per frame from `scene.ts:489` with tiles).
- `src/sim/persist.ts` — `SAVE_FORMAT_VERSION` (5), snapshot round-trip, `pinnedDayStartSnapshots`.
- `scripts/soak-highlights.mjs` — the photographer: boots vite with `?brain=off`, imports a world export, `scrubTo(tick)`, screenshots, contact sheet. Day-lapse is this machinery pointed at day starts. Reuse aggressively; do not fork-and-drift 400 lines.
- `src/loop.ts` `scrubTo` (~491) and `src/bridge.ts` `importWorldJson`/`exportWorldJson` — replay reconstructs past state via `stateAt`, so wear at any scrubbed tick must come out of re-simulation, not renderer memory.

## Why

The civic loop now works end-to-end (a rule passed and bound in the last soak), but nothing about the island *looks* different on day 6 than on day 1. This dispatch is the first visual-progression rung, chosen because both halves derive entirely from state that already exists or accrues from behavior that already happens — no new choreography, no scripted "town level":

1. **Wear paths**: villagers already pathfind thousands of tile-steps per day between homes, the spring, the plaza, and workplaces. Counting those steps per tile and rendering heavy traffic as packed dirt makes the village visibly organize itself around where people actually walk. Nobody designs the roads — they emerge, which is the project's thesis applied to the ground itself.
2. **Day-lapse**: invariant 4 (snapshot + re-sim) means any past day is reconstructable. A strip of same-camera stills at each day's morning is the instrument that makes ALL future progression work legible — including this dispatch's own trails deepening day over day.

## A. Wear accrual (sim — pure TypeScript, invariant 1 applies)

- Add `wear?: number` to `Tile` — cumulative completed agent steps ONTO the tile. Additive optional field: missing ⇒ 0, exactly like the gatherable-stock precedent, so **old saves and both recorded soak worlds must still import** (their tiles simply have no wear yet).
- Increment at the movement step site in `sim.ts` where `agent.x/agent.y` are actually assigned. One increment per completed step onto a tile. Cap at **10000** (`WEAR_CAP`, exported) so long-running worlds don't grow unbounded numbers; increments simply stop at the cap.
- Every agent counts — minds and sheep alike. It's physics, not psychology.
- Wear is world-rule bookkeeping, not behavior: do NOT make agents prefer worn tiles, do NOT touch pathfinding costs (the existing `path` tile preference stays as-is and untouched). A future dispatch may couple them; not this one.
- Determinism: wear derives from deterministic movement, so same seed ⇒ same wear. The determinism gate (double-run hash equality, `stateAt` round-trip) must stay green — if `stableStringify` hashes move *between two runs of the same seed*, that's a real failure; hashes changing *versus historical values* is expected (new state) and fine.
- Persistence: wear must survive `serializeSave`/`restoreSave` and snapshot re-sim. If the additive-optional pattern lets you keep `SAVE_FORMAT_VERSION = 5` (the stock field did), keep it and state so; bump only if round-trip genuinely requires it, and state why.

## B. Wear rendering (renderer — plain three.js, invariant 6 applies)

- In `terrain.ts`, blend walkable ground-tile color toward `PATH_COLOR` by wear **band**, not raw count. Use ~4 bands (e.g. 0 / light / trodden / packed at thresholds like 25 / 150 / 600 steps — tune to what reads well at the default camera; state the final thresholds). Fully-packed tiles should read like the existing worldgen `path` tiles; worldgen paths keep their look (treat `tile.path` as already-max band).
- Update live AND on scrub: hook the existing per-frame `updateEconomyVisuals(places, now, tiles)` call (or add a sibling `updateWear(tiles)` called from the same place in `scene.ts` — your call, state it). **Recolor a tile's material only when its band changes** — never per-frame material churn on 1000+ tiles. Scrubbing backward to day 1 must show day-1 wear (bands derive from the scrubbed world's tiles each frame — renderer holds no wear history of its own).
- Non-walkable tiles, water, rock bands: untouched.
- Keep it colorblind-safe by construction: this is a lightness/earth-tone ramp on ground color, not a hue signal.

## C. Day-lapse photographer (`scripts/day-lapse.mjs`)

Model on `scripts/soak-highlights.mjs` — same boot (own vite, `?brain=off`, assert provider is off; ZERO LLM calls), same import/scrub/screenshot flow. Extract shared plumbing into a small helper module under `scripts/` if that's cleaner than duplication; do not rewrite the photographer.

- Usage: `node scripts/day-lapse.mjs <world.json> [--out artifacts/day-lapse/<basename>] [--port 5182] [--hour 10]`
- Shoots ONE still per sim day at the given hour (default 10:00 — full daylight): day d ⇒ tick `(d-1)*1440 + (hour-6)*60` for however many full days the export contains, plus one final still at the export's last tick.
- **Fixed camera across all stills** — same position, target, zoom for every frame, framing the whole village (derive from the plaza/world bounds the way the photographer frames its shots; the strip only works if the camera never moves).
- Output: `day-01.png … day-NN.png`, plus a single horizontal `strip.png` (all days side by side, day label burned into each frame like the photographer's captions) and a `day-lapse.json` manifest (ticks, files, camera params).
- Must work on the existing recorded exports (e.g. `artifacts/soak-1787452399090-world.json`, 6 days) — those worlds predate wear, so their strips show growth/economy change only; that's expected, say so in the report.

## Gates

1. `npm run check` exit 0 (typecheck + lint + full vitest incl. determinism suites). `npm run e2e` all pass (`--workers=1` if WebGL flakes, and say so). Purity grep of `src/sim/` empty (no three/DOM/Date/Math.random).
2. New vitest coverage: wear increments on a completed step and not on a blocked one; wear caps at `WEAR_CAP`; missing wear reads as 0 (old-save import path); wear survives save round-trip AND `stateAt` re-sim (fork at a past tick reproduces that tick's wear exactly); double-run same-seed equality still green with wear in state.
3. Both recorded soak worlds still import (`artifacts/soak-1787430602479-world.json`, `artifacts/soak-1787452399090-world.json`).
4. Run `node scripts/day-lapse.mjs artifacts/soak-1787452399090-world.json` yourself and confirm it writes 6 day stills + strip + manifest; report the output dir and file sizes. (Visual quality judgment is the orchestrator's, not yours — your gate is "it runs and writes plausible non-black PNGs", check byte sizes > 30KB each.)
5. Do NOT run a soak. Do NOT call any LLM. Do NOT run any `git` command.

## Final report (exact structure)

**BUILT** (wear field + increment site + cap; render hook chosen + final band thresholds; day-lapse reuse strategy — what was shared vs new) / **GATES** (evidence per gate, incl. save-version decision and why) / **DAY-LAPSE RUN** (output dir, per-file sizes, camera params used) / **DEVIATIONS** / **KNOWN GAPS**.
