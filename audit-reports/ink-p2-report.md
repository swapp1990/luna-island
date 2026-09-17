# INK-P2 report — grok minds, facts-only, clock never waits

Date: 2026-09-17. Default model `grok-4.20-0309-non-reasoning`. Seed 42 for the live prompt snapshot.

## Gates (verbatim)

### 1. `npm run build`

```
> tsc --noEmit && vite build
vite v6.4.3 building for production...
✓ 280 modules transformed.
dist/ink.html                                       0.93 kB │ gzip:     0.48 kB
dist/assets/ink-B6kuWMGh.css                        2.36 kB │ gzip:     0.82 kB
dist/assets/ink-07uO4L2Q.js                        34.27 kB │ gzip:    13.09 kB
✓ built in 4.49s
```

Exit code 0.

### 2. `npm run test`

```
 Test Files  98 passed | 2 skipped (100)
      Tests  791 passed | 7 skipped (798)
   Duration  122.20s
```

Exit code 0. Ink / xAI files in that run:

| file | result |
|---|---|
| `test/xai-runner.test.ts` | 8 passed, 170ms |
| `test/ink-prompt.test.ts` | 5 passed, 65ms |
| `test/ink-parse.test.ts` | 8 passed, 108ms |
| `test/ink-memory.test.ts` | 4 passed, 68ms |
| `test/ink-grok-pump.test.ts` | 1 passed, 28ms |
| `test/ink-world.test.ts` | 7 passed, 68ms |
| `test/ink-step.test.ts` | 5 passed, 54ms |
| `test/ink-actions.test.ts` | 17 passed, 190ms |
| `test/ink-determinism.test.ts` | 2 passed, 111ms |

### 3. One live decide

Ran `npx tsx scripts/ink-live-once.ts` (not a soak). Key source `dotenv`. Model `grok-4.20-0309-non-reasoning`.

| | |
|---|---|
| latency | **987 ms** |
| prompt_tokens | **581** |
| completion_tokens | **31** |
| raw reply | `{"action": "wait", "count": 1, "reason": "Waiting at home until the market and workshop open at 9 AM."}` |

`response_format: json_object` was honoured. The model attached `"count": 1` on a non-`buy` action; `parseIntent` drops that count rather than failing.

Published price for this model: **12500 prompt / 25000 completion price units per token**. This call: `581 * 12500 + 31 * 25000 = 8,037,500` price units. The same-day probe of a similar call reported `cost_in_usd_ticks: 7243500` (a small fraction of a cent). The runner maps only `prompt_tokens` / `completion_tokens`, so this gate does not invent a USD figure beyond that.

First attempt via `vite-node` failed with `ECONNRESET` on `api.x.ai` after the Vite plugin also listed models. Retry used `tsx` (no plugin boot). That is the single successful decide this dispatch billed.

### 4. `npx playwright test e2e/ink.spec.ts`

```
Running 5 tests using 1 worker
·····
  5 passed (1.8m)
```

Exit code 0. Default `/ink` (rule brain). P1 assertions did not regress.

### 5. 90 sim-minute dry run (stubbed decide, 1500 ms delay)

From `test/ink-grok-pump.test.ts`, fake timers, 4000 ms per sim hour (P1 1×):

```
INK_P2_DRY blocked=0 ticks=90 tickMsMax=0 maxInFlight=2 maxPerMind=1 llm=4 fallback=0 stale=0 hours=2
```

| metric | measured |
|---|---|
| blocked ticks | **0** |
| sim minutes | **90** (Monday 06:00 → 07:30) |
| hours decided | **2** (06:00 and 07:00) × 2 minds = **4** llm applies |
| fallback | **0** |
| stale | **0** |
| in-flight backlog | **none** (max 1 per mind, 2 total) |
| clock | 90 ticks against the same 4000 ms/hour as P1 (15 ticks/s). Tick body never awaited the 1500 ms delay (`tickMsMax=0` under fake `Date`; whole test 14–28 ms wall). If `decide` blocked, the 1500 ms timers would have had to fire *during* the tick. |

## System prompt as sent

1086 characters. Live call billed **581 prompt tokens** for system + user together. Character share puts about **462** of those on the system half; chars/4 estimate is **272**. The system string is built once per mind name per run.

```
You are A. You live in a small town.

The town has five places: A's house (home-a), B's house (home-b), Market (market), Town centre (center), Workshop (work).
An action only works where it works: sleep and eat at your own home, buy at the market, work at the workshop, socialize at the town centre. go_home, go_work, go_market and go_center walk you to those places. wait works anywhere.
Hunger, energy and company sit between 0 and 1 and fall every hour. Energy rises while you sleep. Company rises only while both of you are in the town centre at the same time.
Eating needs a meal in your own fridge and your fridge holds at most 6.
Meals are bought at the market for 20 each. The market is open 09:00-18:00 Monday to Friday.
The workshop pays 15 an hour and is open 09:00-17:00 Monday to Friday.
Walking between places takes minutes and you decide again each hour.

Reply with ONE JSON object and nothing else:
{"action": <go_home|go_work|go_market|go_center|sleep|eat|buy|work|socialize|wait>,
 "count": <1-6, only for buy>,
 "reason": <at most 100 characters, first person, why>}
```

## One real user message

279 characters. Same live call, Monday 06:00, seed 42, empty memory.

```
It is Monday, 06:00.
The market is shut. It next opens Monday 09:00.
The workshop is shut. It next opens Monday 09:00.
You are at home-a.
Hunger 1.00. Energy 1.00. Company 1.00.
You have 200 money.
Your fridge holds 2 of 6 meals.
B is at home-b.
In the last 8 hours:
Nothing yet.
```

## Deviations from the spec

1. **`buildSystem(name?, config?)` / `buildUser(obs, memory, config?)`** — spec wrote `buildSystem()`. Identity needs the mind's name; the mealPrice test needs an injectable config. Defaults are `'A'` and `INK_CONFIG`.
2. **Observation grew `dayNameLong`, `walkingTo`, `walkMinutes` (and the same walk fields on `other`).** Needed so the user half can say "walking to X, about N minutes away" and "It is Thursday, 14:00." without a parallel bookkeeping structure.
3. **`window.__inkState.engine` also carries `runId` and `hourDecisions`.** Spec listed `{ brain, model, llm, fallback, stale, budget }`. The extras are for the HUD line (run id, decisions this hour).
4. **Extra files:** `test/ink-grok-pump.test.ts` (gate 5, so `npm test` keeps the dry run) and `scripts/ink-live-once.ts` (gate 3). Neither is a soak.
5. **GET `/v1/language-models` cannot carry a body.** `RunXaiDeps.fetchImpl` types `body: string` (copied from OpenRouter). The sidecar's `fetchInk` omits `body` on GET/HEAD. Listing runs in `configureServer`, not at plugin construct, and is skipped when `VITEST` is set so unit tests do not bill a list call.
6. **Gate 3 runner:** `vite-node` loads `vite.config.ts` and booted the sidecar (extra models GET, then TLS reset on the decide). The successful decide used `tsx`.
7. **Stale hour still POSTs.** At an hour boundary a late in-flight is abandoned, the rule brain fills *this* hour (`source: 'fallback'`), and a new request is issued. If that new reply lands in the same hour it is dropped (`appliedSlot` already set) so there is still only one applied decision per mind-hour.
8. **Seek still uses the rule brain**, including in grok mode (P1 contract). In-flight grok requests are aborted on seek/rebuild.

No gate is blocked. Default `/ink` spends nothing.
