# Dispatch INK-P3 — Ink Town: reading what the minds actually did

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER
spawn subagents. NEVER run any `git` command. Do not edit `README.md`, `CLAUDE.md`,
`plans/`, `specs/`, or anything outside `src/ink/**`, `scripts/ink-*`, `test/ink-*`,
`e2e/ink*` and your report. If a gate will not go green after 3 distinct fix attempts,
STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md`, `plans/ink-town.md`
(section "What success looks like" is the whole brief for this phase), then
`specs/ink-p1-world-and-ink.md` and `specs/ink-p2-grok-minds.md`, then the code under
`src/ink/`. Read `scripts/soak-report.mjs` and `src/replay/runMoments.ts` for how this repo
already turns a run into something a human can read.

## What this dispatch builds

The answer to "did they figure it out?", without anyone having to watch a screen for an
hour. A live decision ledger in the UI, a day and week summary computed from the event
trace, and a `journal.jsonl` to markdown report.

**This phase measures; it must never steer.** Nothing here may feed back into a prompt, a
brain, or the world. No scoring visible to a mind, no reward, no nudge. If you find
yourself passing a metric into `src/ink/mind/**`, you have misread the spec.

## Files you create

```
src/ink/sim/summary.ts      daySummary(events, state, day) and weekSummary(...)
src/ink/ui/Ledger.tsx       live decision ledger panel
src/ink/ui/DayCard.tsx      the end-of-day card
scripts/ink-report.mjs      journal.jsonl to markdown CLI
test/ink-summary.test.ts
audit-reports/ink-p3-report.md your report (section 6)
```

Edit `src/ink/ui/Hud.tsx` and `src/ink/main.tsx` only as needed to mount the panels, and
`package.json` only to add `"ink:report": "node scripts/ink-report.mjs"`.

## 1. The ledger (`Ledger.tsx`)

A scrolling list, newest at top, one row per decision, derived from the event trace only:

```
Thu 13:00  A  buy x3        "getting enough for the weekend"        ok, 60 spent
Thu 12:00  B  work          "I need money for food"                 ok, earned 15
Thu 11:00  B  work          "time to earn"          FAILED — you are at home-b, not at the workshop
Thu 10:00  A  wait          (fallback — decision arrived too late)
```

- Failures in heavier ink with the reason inline. Fallback rows visibly marked as not the
  model's doing.
- Filter chips: all / A / B / failures only / fallbacks only.
- Clicking a row seeks the sim to that tick via `__inkControl.seek`.
- Hand-drawn frame consistent with the rest of the page, monospace for the times.
- Virtualise or cap at the most recent 300 rows — a week is about 336 decisions and the
  panel must not stutter the canvas.

## 2. The day card (`DayCard.tsx`)

At each 00:00 the card slides in for a few seconds, then docks into the ledger's history.
Per mind, computed by `daySummary`:

- meals eaten, meals bought, biggest single purchase, money at end of day
- hours worked, money earned
- hours the two were in the town centre together
- hours spent below `sufferingThreshold` on each need
- decisions: how many from the model, how many fallback, how many failed actions

Plus one line of world state: fridge contents at midnight for each home.

## 3. The summary module (`src/ink/sim/summary.ts`)

Pure, testable, derived from events plus state. No DOM. It computes exactly the six
observations from `plans/ink-town.md`:

```ts
export interface InkObservations {
  stocking: { fridayPurchases: number[]; maxFridayPurchase: number }
  anticipation: { hungerAtPurchase: number[]; median: number }
  locomotion: { notThereFailures: number; totalActions: number; ratioByDay: number[] }
  coordination: { hoursTogether: number; byDay: number[] }
  survival: Record<'A' | 'B', { sufferedHours: number; byNeed: Record<string, number> }>
  honesty: { llm: number; fallback: number; stale: number; parseErrors: number }
}
```

`anticipation.hungerAtPurchase` records the mind's hunger at the tick each `buy` succeeded
— high values mean it shopped before it was desperate. `locomotion.ratioByDay` is the share
of actions failing because the mind was not where the action needed it; a falling curve
across days is the interesting shape.

**These are reported, never ranked.** Do not compute a single "score", do not label a run
good or bad, do not colour anything red or green. A human reads the numbers and decides.

## 4. The report CLI (`scripts/ink-report.mjs`)

`npm run ink:report -- --run <runId>` (or `--latest`) reads
`artifacts/ink/<runId>/journal.jsonl` and writes `artifacts/ink/<runId>/report.md`:

- run metadata: seed, model, config snapshot, wall-clock span, total decisions, total tokens
  and the cost implied by the model's published price (state the price you used);
- the six observations as tables, per day;
- the full decision ledger as a markdown table;
- a short "notable hours" list chosen mechanically: first purchase of 3 or more meals, first
  hour both minds were in the centre together, every hour a need hit 0, the first success
  that followed two failures of the same action, and the last decision of the run.
  First-of-kind is always kept, same rule as `src/replay/runMoments.ts`.

No LLM call anywhere in this script. It is pure data to markdown. It must also survive a
truncated final line in the JSONL (a run killed mid-write) by skipping that line and
noting it in the report header.

## 5. Gates

1. `npm run build` clean; `npm run test` green.
2. `ink-summary.test.ts` drives a synthetic event trace with known content and asserts each
   of the six observations exactly, including the truncated-JSONL case for the CLI parser.
3. `npm run ink:report -- --latest` produces a report from a real P2 journal (or, if none
   exists, from a fixture journal you generate with the stubbed decide endpoint — say which
   in your report).
4. `npx playwright test e2e/ink.spec.ts` still green, plus one new assertion: the ledger
   shows a row per decision, and clicking a row moves `__inkState.tick`.
5. With the ledger mounted and 300 rows present, the canvas frame rate is unchanged from P1.
   Measure it and report both numbers — do not assert it by eye.

## 6. Your report — `audit-reports/ink-p3-report.md`

Gate results verbatim, the generated `report.md` inlined or linked, the before/after frame
rate from gate 5, and any deviation with its reason.
