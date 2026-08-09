# Dispatch M — Persistence: the world survives a refresh (Phase 2 closer)

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report. **`CLAUDE.md` invariant 7 holds; no brain changes; no world-rule changes** — this dispatch is serialization + boot flow + a small menu.

Working directory: `D:\MyProjects\Claude\luna-island`.

## What this dispatch introduces

Close Phase 2: the world persists. Reloading the page resumes the same civilization at the same tick with the full timeline (day archives, events, stats) intact; worlds can be exported/imported as files; a New World flow starts fresh with a chosen seed.

## Design

1. **Save format** (`src/sim/persist.ts`, pure sim-side serialization): `{ formatVersion: 1, seed, tick, snapshot (full serializable world state — reuse the existing snapshot mechanism), pinnedDayStartSnapshots, fineSnapshotRing, events, dayArchives, stats }`. Everything already serializes for snapshots/hash — reuse those paths; add a `serializeSave()` / `restoreSave()` pair with format-version check (reject with a clear error, never half-load).
2. **IndexedDB autosave** (`src/persistStore.ts`, app-side): DB `luna-island`, store `saves`, key `autosave`. Autosave triggers: every day boundary and every 60 wall-seconds (whichever first, debounced; serialize on `requestIdleCallback` fallback `setTimeout(0)`; skip while in replay mode). Also `beforeunload` best-effort save.
3. **Boot flow**: if an autosave exists → restore it (live sim resumes at saved tick; day chips, archives, charts all intact). Else → fresh world seed 42 as today. Restore must rebuild the loop/renderer cleanly (agents/places counts may differ from worldgen when a private home exists — meshes must be built from the RESTORED state, not from worldgen; N1's dynamic site/home meshes already prove this path).
4. **Menu** (⚙ button, HUD family): `New World` (seed number input + confirm — wipes autosave, regenerates), `Export World` (downloads `luna-island-day<N>.json` via Blob), `Import World` (file input → validate → restore → autosave). Save indicator: small `💾 HH:MM` chip near the clock after each autosave (`data-testid="save-chip"`).
5. **Bridge additive**: `__simControl.saveNow(): Promise<boolean>`, `__simControl.newWorld(seed: number)`, `__simState.lastSavedTick: number | null`.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty (persist.ts is serialization of state, no Date/random); `utilityBrain.ts` untouched.
2. New vitest: `restoreSave(serializeSave(sim))` round-trips to an identical state hash at tick T and continues deterministically (advance both originals and restored 500 ticks → equal hashes); format-version mismatch rejects cleanly.
3. New e2e (`e2e/persistence.spec.ts`):
   - Run to Day 2 (`ffwd`), `saveNow()`, `page.reload()` → world resumes: same tick (±0), same day, `archivedDayCount` preserved, an agent's wallet identical.
   - Day-1 replay still works after reload (`loadDay(1)`, scrub, inspector log rows).
   - `newWorld(7)` → tick 0, Day 1, different world hash than seed 42 (assert via distinct agent positions or place layout through the bridge).
   - Screenshot `artifacts/persistence.png`: reloaded world with save chip visible. Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
