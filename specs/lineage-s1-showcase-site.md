# Dispatch LINEAGE-S1 — The `/lineage` showcase site (responsive, recordable)

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents. NEVER run any `git` command. Do NOT run any LLM soak or `--brain llm` run (the mock brain is fine). Do not edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`, `src/sim/**`, `src/mind/**`, `src/lineage/**` (except the one pure helper named in §2), `scripts/luna-*.ts`, or any existing route (`src/town`, `src/wild`, `src/age0`, `src/god`, `src/replay`). If a gate will not go green after 3 distinct fix attempts, STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` first (invariant 6: React renders HUD/panels; invariant 8: window bridges are load-bearing for E2E). Then `plans/lineage.md` §2–§5 and `plans/lineage-showcase.md` (the plot for this dispatch), then `audit-reports/lineage-b-report.md` so you know what the runs contain.

Read before writing, in this order: `src/lineage/types.ts`, `src/lineage/run.ts`, `src/lineage/decider.ts` (`recordedBrainFactory`, `decisionKey`), `src/lineage/step.ts` (`advanceTurn`, `observe`), `src/lineage/season.ts`, `src/lineage/render/expression.ts`, `src/lineage/genome.ts` (`bandOf`, `TRAIT_ORDER`), `scripts/lineage-run.mjs` (what a run directory contains), `scripts/luna-runs.ts` + `src/replay/runsApi.ts` (the read-only dev API pattern you will mirror), `vite.config.ts` (how routes are rewritten and plugins registered), `src/age0/foundation.css` (the house UI tokens), `e2e/age0.spec.ts` (E2E style), `playwright.config.ts`.

Design references (open and look at them): `art/lineage-mobile-concepts/v1-chronicle-feed.png`, `v2-bloodlines-dashboard.png`, `v3-villager-card.png`, and their prompts in `art/lineage-mobile-concepts/prompts/`. These are the three panels of the run page at phone width. Match their typography, palette, spacing, and content exactly where the data exists.

## What this dispatch builds

A new route `/lineage` that turns every recorded lineage run under `artifacts/lineage/` into a watchable, scrubbable, responsive web page: a chronicle feed that plays at 1×/8×/64×, a villager card, a bloodlines panel (family tree, trait heatmap, drift sparklines), and an analysis panel (expression tables, mind stats, probes). It must look right at phone, laptop, desktop, and ultrawide, and expose a window bridge plus URL parameters so Playwright can drive it deterministically for video capture (that is Dispatch S2, not yours).

No three.js. No LLM calls. The page is a **deterministic replay** of a recorded run: it reconstructs every turn's state client-side by re-running the pure sim with the recorded decisions.

## 1. Files

```
lineage.html                                  entry (mirror town.html); title "Luna Island · Lineage"
vite.config.ts                                EDIT: rewrite '/lineage' → '/lineage.html'; register lineageRunsPlugin; add lineage.html to rollup input (mirror how town/wild are done)
scripts/lineage-runs.ts                       read-only dev API (Vite plugin, configureServer + configurePreviewServer)
src/lineage-site/main.tsx                     mount
src/lineage-site/App.tsx                      router (query params), index vs run page
src/lineage-site/api.ts                       fetch helpers (typed)
src/lineage-site/replay.ts                    buildTimeline(config, decisions): snapshots per turn + hash check (uses src/lineage pure modules)
src/lineage-site/model.ts                     derived view models: feed entries, census rows, tree, sparklines
src/lineage-site/components/*.tsx             StatusStrip, PlaybackBar, ChronicleFeed, VillagerCard, Bloodlines, Analysis, ExperimentIndex, CompareView
src/lineage-site/lineage.css                  tokens + responsive layout
src/lineage-site/bridge.ts                    window.__lineage / window.__lineageControl
src/lineage/timeline.ts                       (ALLOWED pure helper) replayTimeline(config, decisions): LineageState snapshots per turn + events; must be importable from src/lineage-site and from tests
e2e/lineage.spec.ts
test/lineage-timeline.test.ts
audit-reports/lineage-s1-report.md
```

## 2. Data: read-only dev API (`scripts/lineage-runs.ts`)

Mirror `scripts/luna-runs.ts`. Root: `process.env.LUNA_LINEAGE_DIR ?? 'artifacts/lineage'`. Never write. Serve only files inside a run directory whose name came from `readdir` (never from the request).

- `GET /api/lineage/runs` → `[{ id, tag, brain, engine, dna, seed, harvestYield, seasons, cohort, mating, generationsBorn, departuresByStarvation, hash, eventCount, mind?: {llm, fallback, invalid, meanLatencyMs}, stamp?: {commit, dirty, at}, hasDecisions, hasExpression, mtime }]` built from each dir's `summary.json` (+ `mind.json`, `stamp.json` when present). Parse `tag/brain/engine/dna/seed` from the directory name pattern `<tag>-<engine>-dna<on|off>-seed<n>-<stamp>` or `<mating>-seed<n>-<stamp>` or `replicate-…`; fall back to nulls. Skip `probes/` and any dir without `summary.json`.
- `GET /api/lineage/runs/:id/:file` for `file ∈ {summary.json, events.jsonl, decisions.jsonl, lineage.json, mind.json, expression.json, expression-rank.md, expression.md, chronicle.md, census.md, tree.md, trajectories.md, progress.log, prompts-sample.md}` with the right Content-Type; 404 otherwise.
- `GET /api/lineage/probes` → list of `artifacts/lineage/probes/*.json` with `{ id, mode, effort, dna, band, summary: { n, recordedDisposition, probeDisposition, changed } }` parsed from each json's `results`; `GET /api/lineage/probes/:id` serves the json.
- `GET /api/lineage/replicates` → the `replicate-*/aggregate.json` files as `{ id, yield, n, deltas }`.

## 3. Replay (`src/lineage/timeline.ts`, pure)

`replayTimeline(config: LineageConfig, decisions: RecordedDecision[]): { snapshots: LineageState[]; events: SimEvent[]; turnStarts: number[]; hash: string }`. Run `createHamlet`, then for every turn: push `structuredClone(state)` BEFORE `advanceTurn` (so snapshot[i] is the state the villagers saw when deciding turn i), record the event index at which the turn starts, call `advanceTurn(state, recordedBrainFactory(decisions), rng, trace)`, and at season end call `endSeason`. Push one final snapshot. `hash = lineageHash(state)` at the end. Test (`test/lineage-timeline.test.ts`): on the mock run written by `node scripts/lineage-run.mjs --brain mock --seasons 2 --seed 42` (generate it in the test's `beforeAll` if `artifacts/lineage` has no `mock-*` dir; the runner is a Node script, spawn it), `hash` equals `summary.json.hash`, `snapshots.length === seasons·days·turns + 1`, and every `mind:decision` event lies inside its turn's event range.

Runs with **instinct** brain (Phase A `courtship-seed…` dirs) have no `decisions.jsonl`; replay them with `instinctBrain` as the factory and verify the hash the same way. Runs whose hash does not match show a visible red "replay mismatch" badge and still render.

## 4. The run page

URL: `/lineage?run=<id>[&t=<turn>][&speed=1|8|64][&autoplay=1][&view=feed|card|bloodlines|analysis][&villager=<id>][&vs=<id2>]`.

**Status strip (top, always):** left `Season s · Day d · <dawn|noon|dusk|night>`, right `<alive> alive · gen <g>`; a thin accent progress line under it for the season.

**Playback bar (bottom, always):** play/pause button; speed chips `1×  8×  64×` (1× = one turn per 1.5 s of wall time, 8× = one per 0.19 s, 64× = one per 0.023 s, i.e. a whole season in ~1 s); a scrubber across all turns with season tick marks; keyboard: space, ←/→ step one turn, shift+←/→ one day. Playback advances `turn`; the page derives everything from `snapshots[turn]` and `events` in `[turnStarts[turn], turnStarts[turn+1])`. When turn crosses a season boundary, the feed shows the turnover cards.

**Panels** (content from the mockups; use real data):

1. **Chronicle feed** (accent ember `#e07a3a`): one entry per `action:start`/`action:fail` in the current turn range, plus `speech` as a serif quote card (`Name → Name` header), `court` as a highlighted row with a heart-outline glyph, `villager:starving`/`villager:departed` as bordered system cards, `lineage:born` / `lineage:arrive` / `generation:turnover` / `rule:enacted` / `proposal:*` as full-width cards. Monogram avatar (two letters, muted colour derived from id hash) per entry. Reasons in italic below the act. Keep the last ~200 entries mounted; newest at the bottom; auto-scroll while playing, hold when the user scrolls up. A one-line ticker under the feed: `granary x · harvest y · rule: …`. Clicking a name opens that villager's card.
2. **Villager card** (accent gold `#d4a437`): name, `generation g · child of X and Y`, small caps `GENOME` then `dnaText(traits)` in serif, three need bars (satiety/energy/companionship as %), small caps `NOW` with the current act and its italic reason, `courted: …` row with monogram avatars, grain and standing. Prev/next arrows and page dots cycle living villagers (carousel). On phones it is a bottom sheet over the feed; on wider screens a column.
3. **Bloodlines** (accent teal `#4fb3a6`): (a) FAMILY TREE: real parentage from `lineage.json`, one row per generation, nodes as pills `Given Surname`, hairline edges parent→child; highlight the villager open in the card; living generation glows. Use a simple layered layout (order children under the midpoint of their parents); no external layout library. (b) TRAITS · N LIVING: heatmap grid, rows = living villagers, 12 columns in `TRAIT_ORDER` with three-letter headers, cell tone low/mid/high via `bandOf`. (c) DRIFT: sparklines of cohort trait mean per generation for four traits (metabolism, industry, generosity, voice) from the snapshots at each season start; label with ↑/↓ when |Δ| ≥ 0.05.
4. **Analysis**: the run's `expression.json` as the band table (all rows, "expressed" column), `expression-rank.md` rendered below it if present, `mind.json` stats (llm/fallback/invalid/mean latency), config block (yield, seasons, cohort, mating, dna), the replay badge (`replay verified · hash ####` or mismatch), and, when the run tag matches a probe's source run, links to probe results with their headline numbers (from `/api/lineage/probes`). Also a `DNA on vs off` compare link when a sibling run with the opposite `dna` and same tag exists.

**Compare mode** (`&vs=`): two runs side by side (feed + status strip each), one playback bar driving both by turn index. Desktop and up only; on phones show a notice and a switch link.

**Experiment index** (`/lineage` with no `run`): cards grouped by `tag` (gate, gate2, gate3y1, courtship/random replicates, mock, smoke) with the config line, outcome badges (`extinct`, `24 born`, `0 starved`, `0/8 expressed`), and an "Open" button; a Probes section listing probe headline numbers; a Replicates section listing `replicate-*` with the metabolism Δ per arm. Title block: "Luna Island · Lineage — experiments in heritable minds".

## 5. Responsive layout (must be measured, not asserted)

| width | layout |
|---|---|
| ≤ 719 px | single column; tabs `Feed · Card · Bloodlines · Analysis` under the status strip; playback bar fixed to the bottom; card opens as a sheet from the feed |
| 720–1599 px | two columns: feed (58%) and a right column with the card on top and bloodlines below (scroll) ; analysis is a tab in the right column |
| 1600–2399 px | three columns: feed · card · bloodlines; analysis as a full-width drawer toggled from the status strip |
| ≥ 2400 px | four columns: feed · card · bloodlines · analysis, all visible |

Tokens (put in `lineage.css` `:root`): `--bg #14120f`, `--ink #e9dfc8`, `--ink-2 #a99c82`, `--line rgba(233,223,200,.14)`, `--ember #e07a3a`, `--teal #4fb3a6`, `--gold #d4a437`; UI font `Inter, ui-sans-serif, system-ui`; speech/genome font `Georgia, serif`. Type scale ≥ 14 px body on phones, ≥ 15 px on desktop; max line length ~72 ch in the feed. No layout shift while playing at 64×: fixed-height status strip and playback bar, feed uses a scroll container.

## 6. Window bridge and URL params (load-bearing for S2)

```ts
window.__lineage = { ready: boolean, runId: string|null, turn: number, turnCount: number, season: number, day: number, turnOfDay: 0|1|2|3, speed: 1|8|64, playing: boolean, alive: number, generation: number, view: string, villagerId: string|null, replayOk: boolean|null, width: number }
window.__lineageControl = { play(), pause(), setSpeed(n), seek(turn), step(±1), setView(name), openVillager(id|null), loadRun(id), compare(id|null) }
```

Set `ready = true` only after the timeline is built and the first frame rendered. `autoplay=1` starts playback once ready. Every control must be reachable without a mouse (S2 drives it through the bridge).

## 7. Tests and gates

- `test/lineage-timeline.test.ts` (§3).
- `e2e/lineage.spec.ts`: (a) index lists ≥ 1 run and shows the Probes section; (b) open the mock run via URL with `autoplay=1&speed=64`, wait for `__lineage.ready`, assert `turn` increases by ≥ 40 within 3 s of wall time and that the status strip text changes; (c) `seek(0)` then `step(1)` moves exactly one turn; (d) open a villager, assert the card shows the villager's name and a GENOME block; (e) at viewports 390×844, 1280×800, 1920×1080, 3440×1440: assert the expected column count via a `data-layout` attribute on the root (`single|two|three|four`), assert no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`), and save screenshots to `artifacts/lineage-site/shots/<viewport>-<view>.png` (feed, card, bloodlines, analysis on phone; the composite on the others). Assertions in sim turns, never wall clock, except the 3 s autoplay bound.
- If `artifacts/lineage` has no runs, the E2E `beforeAll` generates the mock run with `node scripts/lineage-run.mjs --brain mock --seasons 2 --seed 42`.
- Gates: `npx tsc --noEmit` exit 0; `npx vite build` green (lineage.html in the bundle); `npx vitest run test/lineage-*.test.ts` green (all prior lineage tests too); `npx playwright test e2e/lineage.spec.ts` green on the real GPU config (do not add swiftshader flags); `grep -rn "from 'three'" src/lineage-site` → nothing; `git status --short src/sim src/mind src/lineage scripts/luna-*.ts` read-only evidence shows only `src/lineage/timeline.ts` added.

## 8. Report (`audit-reports/lineage-s1-report.md`)

Files and line counts; gate outputs verbatim; the four viewport screenshots' paths and their measured `data-layout` and scrollWidth; the replay-badge state for each real run in `artifacts/lineage` (verified or mismatch, with hash); anything skipped; questions for main. Self-grade nothing: report measurements.
