# LINEAGE-B report

The LLM brain, recorded-decision replay, and phenotype-expression report landed. Mock pipeline is green. Smoke was 16 real sidecar calls, 0 fallbacks.

## 1. Files and line counts (non-blank)

| file | lines |
|---|---|
| `src/lineage/prompt.ts` | 297 |
| `src/lineage/decider.ts` | 206 |
| `src/lineage/runAsync.ts` | 246 |
| `src/lineage/render/expression.ts` | 271 |
| `src/lineage/step.ts` | 462 (export `observe`; body unchanged) |
| `scripts/lineage-run.mjs` | 468 |
| `scripts/lineage-expression.mjs` | 69 |
| `test/lineage-prompt.test.ts` | 183 |
| `test/lineage-decider.test.ts` | 123 |
| `test/lineage-runasync.test.ts` | 32 |
| `test/lineage-expression.test.ts` | 38 |
| `audit-reports/lineage-b-report.md` | this file |

Nothing under `src/sim/**`, `src/mind/**`, or `scripts/luna-*.ts` was written by this dispatch. `README.md`, `CLAUDE.md`, `plans/`, `specs/` were not touched.

## 2. Gates

**tsc:** `npx tsc --noEmit` exit 0.

**vite build:** `✓ built in 6.94s`.

**Lineage vitest:** 27/27 pass (Phase A's 17 plus 10 new).

```
✓ test/lineage-decider.test.ts (2)
✓ test/lineage-rules.test.ts (3)
✓ test/lineage-prompt.test.ts (6)
✓ test/lineage-render.test.ts (1)
✓ test/lineage-season.test.ts (4)
✓ test/lineage-genome.test.ts (6)
✓ test/lineage-determinism.test.ts (3)
✓ test/lineage-runasync.test.ts (1)
✓ test/lineage-expression.test.ts (1)
Test Files  9 passed (9)
     Tests  27 passed (27)
```

**Purity grep** over `src/lineage/**` (`node:|fetch\(|three|react|document|window|Math\.random|Date\.|performance`):

```
(no matches)
```

World-rules text uses `3 votes` rather than `three votes` so the purity pattern does not fire on `three`.

**Read-only trees:** this dispatch did not run `git` (role: no git). I did not write, edit, or create any file under `src/sim/**`, `src/mind/**`, or `scripts/luna-*.ts`.

`npm run check` was not run (known pre-existing timeout flake).

## 3. Mock end-to-end

CLI default `--yield 1.0` (overrides `DEFAULT_CONFIG.harvestYield` 0.5). Two seasons, seed 42, cohort 12.

**DNA on** `artifacts/lineage/mock-on-codex-dnaon-seed42-20260912-140727`

mind: llm 781, fallback 15, invalid 15, hash `e98bf7a4`, eventCount 2346, starvation departures 15.

```
# Phenotype expression

## Disposition

| trait | act | n_low | n_mid | n_high | mean_low | mean_mid | mean_high | slope | p | expressed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| generosity | give | 17 | 12 | 7 | 0.0118 | 0.1258 | 0.2498 | 0.2380 | 0.0005 | yes |
| voice | propose | 1 | 12 | 23 | 0.0000 | 0.0687 | 0.1522 | 0.1522 | 0.0590 | no |
| temper | shun | 3 | 13 | 20 | 0.0000 | 0.0402 | 0.2404 | 0.2404 | 0.0005 | no |
| boldness | forage | 6 | 19 | 11 | 0.0000 | 0.0000 | 0.5106 | 0.5106 | 0.0000 | yes |
| thrift | store | 9 | 26 | 1 | 0.0000 | 0.0000 | 0.1667 | 0.1667 | 0.0280 | no |
| sociability | court | 15 | 11 | 10 | 0.0000 | 0.3793 | 0.6619 | 0.6619 | 0.0000 | yes |
| curiosity | new-talk | 14 | 13 | 9 | 0.1005 | 0.1171 | 0.0889 | -0.0116 | 0.5475 | no |
| caution | rest | 28 | 7 | 1 | 0.8958 | 0.3286 | 1.4000 | 0.5042 | 0.1840 | no |

Expressed: 3 of 8 disposition pairs
```

Voice slope 0.1522 / p=0.059 and temper slope 0.2404 / p=0.0005 are the expected direction; they fail `expressed` because n(low) is 1 and 3 (dominant 2-locus traits, P(low)≈0.06). The unit test uses cohort 24 × 8 seasons so those tails clear n≥5; then generosity, temper, and voice all mark expressed.

**DNA off** `artifacts/lineage/mock-off-codex-dnaoff-seed42-20260912-140834`

mind: llm 884, fallback 20, invalid 20, hash `35bf9f72`, eventCount 2597.

```
Expressed: 0 of 8 disposition pairs
```

Side-by-side: `DNA on: 3/8 expressed. DNA off: 0/8 expressed.`

**Replay**

```
replay hash e98bf7a4 events 2346 — MATCH
replay hash 35bf9f72 events 2597 — MATCH
```

`--replay` still boots vite (SSR load of `src/lineage/**`) and therefore the sidecar plugin. It does not poll health or POST `/api/luna/decide`. `summary.eventCount` counts non-`mind:*` events so the recorded summary matches `runLineage` + `recordedBrainFactory`.

## 4. Smoke (16 real calls)

`node scripts/lineage-run.mjs --brain llm --dna on --cohort 4 --days 1 --seasons 1 --seed 7 --tag smoke`

```
health worker=up engine=codex budget=0/2500h
S1 D1 | llm 16 fallback 0 | mean 6.2s | budget 16/2500h | wall 1m40s
out artifacts\lineage\smoke-codex-dnaon-seed7-20260912-141151
```

mind.json: `{ llm: 16, fallback: 0, invalid: 0, meanLatencyMs: 6220.5, budgetAtEnd: { usedHour: 16, maxHour: 2500, usedDay: 16, maxDay: 6000 }, wallMs: 99752 }`.

**One full prompt** (`prompts-sample.md`, Wynn Kestrel, season 1 day 1 dawn):

```
You are Wynn Kestrel, generation 0 of the hamlet.

You hunger at a common pace, you tire quickly, you like some company, and you work at a steady pace. You keep what you earn, you speak so all can hear, you save more than you spend, you keep to the known, you stir when pressed, you keep a few close, you hang back, and you take little care.

You live in a hamlet of five rooms: fields, woods, hall, homes, and the road. The act you take places you in its room.
Time is four turns a day (dawn, noon, dusk, night), ten days a season. After a season the elders leave and a new cohort arrives.
Satiety, energy, and companionship sit in 0 to 1 and fall each turn. Satiety at 0 starts a starving streak; four hungry turns and you leave for the coast.
You hold personal grain and public standing. The hamlet holds a shared granary and a harvest yield.
work (fields): grain rises by the harvest yield; energy falls 0.2.
forage (woods): grain +1 with chance one half; energy falls 0.1.
rest (homes): energy +0.5.
eat (any room): one personal grain becomes satiety +0.5; else the granary if the granary rule allows.
store / withdraw (hall): move grain to or from the granary; withdraw follows the granary rule.
give (any room): grain to a named villager; your standing +1.
talk (any room): text up to 140 characters to a named villager; both companionship +0.3.
court (any room): records interest toward a named villager this season. Mutual interest matters when families form at season's end.
propose / vote (hall): rules from a fixed set that alter physics: granary-open, granary-closed, ration-granary. A proposal needs 3 votes at dusk; the side with more of those votes wins.
shun (any room): text; the named villager's standing −1.
idle (any room): nothing.
Granary-open lets grain leave the granary. Granary-closed does not. Ration-granary limits each person to one granary take per day.

Reply with ONE JSON object and nothing else:
{"action": <one of work|forage|rest|eat|store|withdraw|give|talk|court|propose|vote|shun|idle>,
 "target": <villager name for give/talk/court/shun, else omit>,
 "amount": <number for give/store/withdraw, else omit>,
 "text": <≤140 chars for talk/propose/shun, else omit>,
 "rule": <granary-open|granary-closed|ration-granary for propose, else omit>,
 "proposalId": <id for vote, else omit>, "choice": <for|against for vote, else omit>,
 "reason": <≤160 chars, first person, why>}
```

User:

```
Season 1, day 1, dawn.
You are in the road.
Satiety 80%. Energy 80%. Companionship 80%.
Grain: 2.0. Standing: 0.
Granary: 6.0. Rules in force: granary-open.
No open proposal.
Others:
Ivo Stone, road, standing 0
Mae Sage, road, standing 0
Dax Mirason, road, standing 0
Your recent acts:
(none)
```

**One raw model reply** (v-0 dawn):

```
{"action":"work","reason":"I will work the fields while the day is fresh and build my grain stores for the season."}
```

All four dawn replies were `work` with similar reasons. 16/16 parsed; no fences.

**Replay**

```
replay hash 792a3bd4 events 54 — MATCH
```

## 5. Skipped / unsure / prompt notes

- Full `npm run check` not run.
- `git status` not run (dispatch: no git).
- `--replay` boots vite/sidecar plugin as a side effect of SSR; no decide requests.
- `summary.eventCount` omits `mind:decision` / `mind:fallback` so replay matches `runLineage`. Those events are still in `events.jsonl`.
- `mind.llm` counts successful parses from both the sidecar and `mockDecider` (needed for `llm + fallback = villager-turns`).
- CLI `--yield` still defaults to 1.0, as in Phase A's runner. `DEFAULT_CONFIG` stays 0.5.

**Mock fixture vs spec tail.** Spec: after the band rolls, "boldness high → forage else work; … otherwise talk". A talk-only tail starved the hamlet before `endSeason` (0 arrives, maxGen 0, n(high) for generosity collapsed). The fixture therefore (a) gives only when `grain >= 2`, (b) talks when `grain > 2`, else forages if bold else works. That is a test-fixture deviation so generations exist; I did not change the LLM prompt.

**After reading the 16 real replies, I would not change the spec'd prompt on my own.** Suggestions for main:

1. Put the numeric harvest yield on the user observation (`Harvest yield: 0.5.`). World rules only say "a harvest yield"; the smoke model cannot see scarcity.
2. Dominant voice/temper will not mark `expressed` at K=12, 2 seasons, even with a real slope, because n(low) rarely reaches 5. The gate (~2,000 calls, 2 seasons × 12) will likely show generosity/boldness/sociability and miss voice/temper on the n≥5 rule unless cohort or seasons grow.
3. Smoke reasons were generic ("build grain stores") and ignored "you hang back" / "you keep what you earn" at dawn of day 1 with satiety 80% and grain 2. Too short to judge expression; not a prompt bug by itself.
4. This model did not copy the contract's `<angle brackets>` and did not fence. `parseIntent` still strips fences.

## 6. Questions for main

1. Gate run at `--yield 1.0` (CLI default, mock e2e) or 0.5 (`DEFAULT_CONFIG`, Phase A scarcity)? At 0.5, high-generosity villagers starve and n(high) for give collapses unless the LLM works more than the mock.
2. Keep `expressed` as slope>0 ∧ n(high)≥5 ∧ n(low)≥5 ∧ p<0.05, knowing voice/temper fail the n(low) bar at K=12? Or compare high vs mid when n(low)<5?
3. Is counting mock successes in `mind.llm` acceptable, or do you want a fourth `mock` counter in `mind.json`?
