# LINEAGE-S1 report

`/lineage` showcase site: deterministic replay of recorded runs, responsive layout, window bridge.

## 1. Files and line counts (non-blank)

| file | lines |
|---|---|
| `src/lineage/timeline.ts` | 72 |
| `scripts/lineage-runs.ts` | 339 |
| `lineage.html` | 29 |
| `src/lineage-site/main.tsx` | 11 |
| `src/lineage-site/App.tsx` | 674 |
| `src/lineage-site/api.ts` | 149 |
| `src/lineage-site/replay.ts` | 15 |
| `src/lineage-site/model.ts` | 502 |
| `src/lineage-site/bridge.ts` | 74 |
| `src/lineage-site/lineage.css` | 702 |
| `src/lineage-site/components/StatusStrip.tsx` | 22 |
| `src/lineage-site/components/PlaybackBar.tsx` | 76 |
| `src/lineage-site/components/ChronicleFeed.tsx` | 160 |
| `src/lineage-site/components/VillagerCard.tsx` | 113 |
| `src/lineage-site/components/Bloodlines.tsx` | 100 |
| `src/lineage-site/components/Analysis.tsx` | 126 |
| `src/lineage-site/components/ExperimentIndex.tsx` | 135 |
| `src/lineage-site/components/CompareView.tsx` | 82 |
| `e2e/lineage.spec.ts` | 145 |
| `test/lineage-timeline.test.ts` | 123 |
| `audit-reports/lineage-s1-report.md` | this file |

`vite.config.ts` edited: import `lineageRunsPlugin`, rewrite `/lineage` → `/lineage.html` (query preserved), rollup input `lineage: 'lineage.html'`.

`README.md`, `CLAUDE.md`, `plans/`, `specs/`, `src/sim/**`, `src/mind/**`, `scripts/luna-*.ts`, and existing routes were not edited. Under `src/lineage/**` only `timeline.ts` was added.

## 2. Gates (verbatim)

**tsc:** `npx tsc --noEmit` exit 0.

```
(node:7684) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
```

**vite build:** exit 0. `lineage.html` in the bundle (`dist/lineage.html` 1.22 kB, `dist/assets/lineage-okXVfjCG.js` 58.51 kB, `dist/assets/lineage-DbNYdTPK.css` 13.06 kB).

```
✓ 261 modules transformed.
...
dist/lineage.html                                   1.22 kB │ gzip:     0.58 kB
...
dist/assets/lineage-DbNYdTPK.css                   13.06 kB │ gzip:     3.32 kB
...
dist/assets/lineage-okXVfjCG.js                    58.51 kB │ gzip:    18.48 kB
...
✓ built in 8.38s
```

**vitest** `npx vitest run lineage` — 30/30 (Phase A + B + 3 new timeline tests).

```
 ✓ test/lineage-decider.test.ts (2 tests) 25ms
 ✓ test/lineage-rules.test.ts (3 tests) 34ms
 ✓ test/lineage-prompt.test.ts (6 tests) 89ms
 ✓ test/lineage-render.test.ts (1 test) 62ms
 ✓ test/lineage-season.test.ts (4 tests) 72ms
 ✓ test/lineage-determinism.test.ts (3 tests) 184ms
 ✓ test/lineage-genome.test.ts (6 tests) 341ms
 ✓ test/lineage-runasync.test.ts (1 test) 221ms
 ✓ test/lineage-timeline.test.ts (3 tests) 2379ms
   ✓ lineage timeline replay > replays an instinct courtship run without decisions.jsonl  340ms
   ✓ lineage timeline replay > hash-matches every recorded run under artifacts/lineage  1718ms
 ✓ test/lineage-expression.test.ts (1 test) 5518ms
 Test Files  10 passed (10)
      Tests  30 passed (30)
   Duration  6.63s
```

Mock run used: `mock-on-codex-dnaon-seed42-20260912-140727`. `snapshots.length === 2·10·4+1 === 81`. Hash `e98bf7a4` matches `summary.json.hash`. Instinct `courtship-seed*` with empty decisions also matched. Every recorded run under `artifacts/lineage` hash-matched (see §4).

**playwright** `e2e/lineage.spec.ts` on the real GPU config (no swiftshader flags). Port 5175 was already occupied (`reuseExistingServer: false`), so the suite ran with `PLAYWRIGHT_PORT=5185`.

```
Running 5 tests using 1 worker
·····
  5 passed (4.6m)
```

A later isolated viewport re-run (after pinning the turn chip outside the feed scroller) with `PLAYWRIGHT_PORT=5187`:

```
Running 1 test using 1 worker
·
  1 passed (1.4m)
```

**three.js grep:** `grep -rn "from 'three'" src/lineage-site` → no matches.

**git:** not run (dispatch: no git). Working tree under `src/sim`, `src/mind`, `scripts/luna-*.ts` was not written. The only new file under `src/lineage` is `timeline.ts`.

## 3. Viewport measurements

Taken by Playwright after `__lineage.ready`, written to `artifacts/lineage-site/shots/<viewport>-metrics.json`. `document.documentElement.scrollWidth` vs `window.innerWidth`.

| viewport | `data-layout` | scrollWidth | innerWidth | shots |
|---|---|---|---|---|
| 390×844 | `single` | 390 | 390 | `artifacts/lineage-site/shots/390x844-feed.png`, `-card.png`, `-bloodlines.png`, `-analysis.png` |
| 1280×800 | `two` | 1280 | 1280 | `artifacts/lineage-site/shots/1280x800-composite.png` |
| 1920×1080 | `three` | 1920 | 1920 | `artifacts/lineage-site/shots/1920x1080-composite.png` |
| 3440×1440 | `four` | 3440 | 3440 | `artifacts/lineage-site/shots/3440x1440-composite.png` |

No horizontal page scroll at any of the four sizes (`scrollWidth === innerWidth`).

## 4. Replay badge / hash for each run in `artifacts/lineage`

`replayTimeline(config, decisions)` vs `summary.json.hash`. Empty `decisions.jsonl` (instinct / Phase A) uses `recordedBrainFactory` → instinct fallback. All matched; the analysis badge is `replay verified · hash <8 hex>`.

| id | hash | badge |
|---|---|---|
| `courtship-seed42-20260907-1807` | `da5ffd94` | verified |
| `courtship-seed42-20260907-1809` | `da5ffd94` | verified |
| `courtship-seed42-20260907-1812` | `6e063dbf` | verified |
| `courtship-seed42-20260907-181510` | `da5ffd94` | verified |
| `gate-codex-dnaoff-seed42-20260912-142831` | `e184ed2c` | verified |
| `gate-codex-dnaon-seed42-20260912-141833` | `f6938bb5` | verified |
| `gate2-codex-dnaoff-seed42-20260912-150655` | `98a76916` | verified |
| `gate2-codex-dnaon-seed42-20260912-144038` | `97e76572` | verified |
| `gate3y1-codex-dnaon-seed42-20260912-153258` | `bbe05fb4` | verified |
| `mock-off-codex-dnaoff-seed42-20260912-140834` | `35bf9f72` | verified |
| `mock-on-codex-dnaon-seed42-20260912-140727` | `e98bf7a4` | verified |
| `smoke-codex-dnaon-seed7-20260912-141151` | `792a3bd4` | verified |

`probes/` and `replicate-*` dirs have no `summary.json`; they are listed on the index via `/api/lineage/probes` and `/api/lineage/replicates`, not replayed.

## 5. Skipped

- `git status` / any git command.
- `npm run check` (full project test suite).
- `--brain llm` / any sidecar soak.
- Mock generation in tests (`artifacts/lineage` already had `mock-*` dirs).
- Compare-mode screenshots (not in the S1 shot list; compare is desktop-only with a phone notice).

## 6. Questions for main

- `propose` currently yields both an `action:start` row and a `proposal:open` full-width card, because the spec asked for both. Collapse to one?
- Two-column Hamlet / Analysis tabs sit in the full-width row under the status strip, not inside the right column. Move them into the right column?
- E2E could not bind 5175 (something already served there). Suite used `PLAYWRIGHT_PORT=5185` / `5187`. Want a dedicated lineage port in `playwright.config.ts`?
- Index loads `expression.json` per `hasExpression` run to paint `n/8 expressed` badges (N extra GETs). Bake `expressed` into `/api/lineage/runs` instead?
