# Phase 5-6 — Run Theater: watch a soak run, skip to what mattered, read what changed

## Why

Soak runs are the only place the village actually lives for hours. Today the
evidence of a run is three files in `artifacts/` and a scrollback of `[soak]`
lines. You cannot *watch* a run after it ends, you cannot jump to the moment
the first proposal passed, and nothing tells you what the village looked like
before versus after.

Run Theater turns each recorded soak into something you can sit down and watch.

## Scope

1. **Run browser** — the app lists every recorded run in `artifacts/`, newest
   first, with the params it ran under and its headline numbers.
2. **Load & watch** — picking a run imports its world export through the
   existing `restoreSave` path, so the full timeline is scrubbable and the
   replay fork plays forward exactly as a live day does. Continuous playback
   chains past the day-end auto-pause so a run plays end to end.
3. **Skip to the important moments** — a chaptered rail of moments the run
   itself decided were important. Three sources, no invention:
   - **the reel** (strongest): if `soak-highlights.mjs` ran after the soak, its
     `highlights.json` *is* the run's verdict — the moments it chose and shot.
     Those shots become the chapters and each carries its still. This replaces
     the view-time `pickHighlights` pass rather than duplicating it.
   - **story** moments: when a run has no reel, the same selector is re-run over
     the recorded trace. Either way, the first occurrence of each notable event
     type is always kept at its exact tick — `pickHighlights` caps two per type,
     and a first must never fall off that list.
   - **ops** moments: what the soak harness flagged while it ran, read from its
     JSONL journal — sim-clock wedges, mind fallbacks, stale intents, budget
     saturation. These are windows (`tick` … `endTick`), not instants, because
     the journal samples once a wall-minute.

   A shot and a first describing the same event are merged (selection nudges
   say/examine/commission a tick forward so the still catches the staging):
   the "First:" framing is kept, and so is the still.
4. **What changed during this run** — a before/after changelog computed from the
   run's own timeline: village buildings and tiers, population and collapses,
   land ownership and treasury, civic proposals/rules/sanctions/assemblies,
   and mind activity. Plus a "firsts" list with the exact clock of each.

## Non-goals

- No new sim mechanics. `src/sim/` is untouched.
- No re-scoring of what matters at view time beyond what the run recorded —
  "important" means *the run said so*, either through its photographer
  selection or through its journal.
- No writes to `artifacts/` from the browser. The API is read-only.

## Architecture

| piece | file | notes |
|---|---|---|
| artifact grouping | `src/replay/runFiles.ts` | pure; `soak-<ts>-{world,story,summary}.json` + `soak-political-<ts>.jsonl` → runs |
| moment index | `src/replay/runMoments.ts` | pure; story moments (trace) ∪ ops moments (journal) |
| changelog | `src/replay/runDiff.ts` | pure; `(before, after, events) → sections + firsts` |
| dev API | `scripts/luna-runs.ts` | vite plugin, read-only, `GET /api/runs`, `/api/runs/:id/{world,summary,journal,story,highlights,still/:file}` |
| UI | `src/ui/RunTheater.tsx` | 36×36 toggle at `top:12 right:98`; 380px drawer, matches TownBoard/Charts |
| wiring | `src/App.tsx`, `src/bridge.ts` | additive `__simControl.runs` namespace; `__simState` shape unchanged except additive `runTheater` |
| fixture | `scripts/make-run-fixture.mjs` | deterministic recorded run so the feature has something to show without a 2h soak |

### Invariants respected

- `src/sim/` stays pure (invariant 1) — every new module reads state, never
  mutates it, and uses no wall clock.
- Moments and changelog are derived from the **event trace**, never re-derived
  history (invariant 3).
- Jumping is `scrubTo` on the existing snapshot + re-sim path (invariant 4).
- Existing `__simState` / `__simControl` keys keep their shapes (invariant 8);
  everything new is additive.

## Acceptance

- `GET /api/runs` lists a run written by `make-run-fixture.mjs` with its params.
- Loading a run in the UI puts the app in replay at the run's day 1 with the
  moment rail populated; `scrubTo` from a moment lands on that moment's tick.
- The changelog's "after" numbers match the imported world's head state.
- Unit tests cover grouping, ops-moment extraction (wedge/throttle/budget),
  story-moment merge, and the diff.
- An e2e spec loads the fixture run, jumps to a moment, and asserts the sim
  tick moved to that moment and the changelog rendered.
