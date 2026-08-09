# Dispatch G — Day-paged timeline: archive each day, load and scrub any day

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report. `CLAUDE.md` invariants hold throughout.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Problem (user-requested)

The single timeline scrubber spans the whole history — it gets overwhelming as days accumulate. The user wants: each completed day archived, a day selector to load any past day, and the scrubber scoped to one day at a time.

## Design

### Sim-side (`src/sim/`)

- **DayArchive**: when the sim crosses a day boundary, record `{ day, startTick, endTick }` and PIN the snapshot at `startTick` permanently. Then PRUNE the fine-grained (180-tick) snapshot ring for that completed day — day-start snapshot + events are enough to reconstruct any moment of it deterministically (`stateAt` already re-sims from the nearest ≤ snapshot; verify it picks pinned day-start snapshots after pruning).
- Day 1 starts at tick 0 (06:00) — its archive spans 06:00→24:00; later days span 00:00→24:00.
- Expose `archives(): DayArchiveMeta[]` on `Simulation`. Events are never pruned.
- **Test/dev fast-step:** add `advanceTicksBatch(n)` exposure via the bridge as `__simControl.ffwd(n)` (synchronous batch advance of the LIVE sim; additive; e2e needs it to reach Day 2+ quickly).

### UI (`src/ui/Timeline.tsx` + loop/bridge)

- **Day selector** on the timeline bar: `◀ Day N ▶` (or compact day chips when ≤ 7 days), `data-testid="day-selector"`. Default = today (live), marked `● LIVE`.
- Selecting a **past day**: enter replay mode forked at that day's `startTick`; scrubber min/max = that day's bounds; drag to scrub within the day (existing 100 ms debounce; each scrub forks from the pinned day-start snapshot — measure, and if dragging janks, lazily rebuild that day's in-day snapshot cache on first load). Play speeds work; playback auto-pauses at the day's end.
- Selecting **today** while in replay: scoped live view of today-so-far; `GO LIVE` (existing button) returns to live head from anywhere.
- Inspector activity log and the ticker (if Dispatch F has landed by now — check the code) scope to the loaded day: events within `[startTick, replayTick]`.
- Clock HUD in replay shows the loaded day faithfully (existing behavior should already do this — verify).
- **Bridge (additive only):** `__simState.archivedDayCount: number`, `__simState.viewDay: number`; `__simControl.loadDay(day: number)`, `__simControl.ffwd(n)`.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty.
2. New vitest:
   - Run 3 sim-days: 2+ archives exist with correct tick bounds; fine snapshots for archived days are pruned while day-start snapshots remain; `stateAt` mid-Day-1 still equals a fresh sim advanced to the same tick (hash equality).
   - Determinism double-run still green.
3. New e2e (`e2e/timeline.spec.ts`):
   - `ffwd` to Day 3 → `archivedDayCount ≥ 2`, day selector present.
   - `loadDay(1)` → mode `replay`, tick within Day 1 bounds, scrubber bounds = Day 1; inspector log rows (select an agent) all within Day 1.
   - `goLive()` → mode `live`, day = 3.
4. Screenshot `artifacts/day-archive.png`: Day 3 live, day selector visible; and while in Day-1 replay, `artifacts/day-replay.png`. Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
