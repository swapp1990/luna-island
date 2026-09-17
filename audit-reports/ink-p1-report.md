# INK-P1 report — world, clock, economy, ink renderer

Date: 2026-09-17. Seed 42, rule brain, no LLM.

## Gates (verbatim)

### 1. `npm run build`

```
> tsc --noEmit && vite build
vite v6.4.3 building for production...
✓ 276 modules transformed.
dist/ink.html                                       0.93 kB │ gzip:     0.48 kB
dist/assets/ink-foUXca5_.css                        1.98 kB │ gzip:     0.75 kB
dist/assets/ink-GksMnvrF.js                        22.56 kB │ gzip:     8.82 kB
✓ built in 16.68s
```

Exit code 0.

### 2. `npm run test`

```
 Test Files  93 passed | 2 skipped (95)
      Tests  765 passed | 7 skipped (772)
   Duration  123.94s
```

Exit code 0. Ink files in that run:

| file | result |
|---|---|
| `test/ink-world.test.ts` | 7 passed, 52ms |
| `test/ink-step.test.ts` | 5 passed, 59ms |
| `test/ink-actions.test.ts` | 17 passed, 212ms |
| `test/ink-determinism.test.ts` | 2 passed, 112ms |

Two earlier full-suite runs failed on `test/wild-screenplay.test.ts` (90s timeout under load). That file is untouched by this dispatch. Isolated: 1 passed in 48.6s. Third full `npm run test` (quiet machine) was green as above.

### 3. `npx playwright test e2e/ink.spec.ts`

```
Running 5 tests using 1 worker
·····
  5 passed (2.0m)
```

Exit code 0. Assertions in sim ticks: boot `ready`; `step(1440)` advances one day; `go_market` → `at === 'market'` within 40 ticks; 3-day rule-brain run has 0 `buy`, 0 `work`, non-zero `sufferedHours`; Saturday `buy` → `action:fail` naming Saturday.

### 4. 7-day headless rule-brain soak (inside `ink-determinism.test.ts`)

No throw. No NaN on hunger/energy/social. Both minds stayed on the road graph. Two `createWorld(42)` weeks produced identical `inkHash(state)` and identical event logs.

## Rule-brain week (seed 42, 7 × 1440 ticks from Monday 06:00)

| mind | meals eaten | money left | sufferedHours |
|---|---|---|---|
| A | 2 | 200 | 139.66666666666995 |
| B | 2 | 200 | 139.66666666666995 |

They eat the two starting fridge meals and never shop or work. Money is still `startMoney`. Suffering is ~140 of 168 hours below the 0.15 threshold. That is the intended bleak baseline.

## Tick rate

Measured in `ink-determinism.test.ts` over 10 080 ticks (`performance.now()`, test process, not sim clock):

- Isolated ink-file run: **1 620 683 ticks/s**
- Full `npm run test` worker: **877 147 ticks/s**

A week is ~6–12 ms of CPU.

## Wobble stability

Hand-drawn paths are built once per shape via `cachedPath` in `src/ink/render/ink.ts`. The cache is `inkPathCache: Map<string, Path2D>`. Points come from `wobblePolyline(worldSeed, shapeId, …)` using `createRng(worldSeed ^ hashId(shapeId))`; interior vertices only, amplitude 0.6, 2–3 segments. `clearInkCache()` runs on resize (`scene.ts`), never per frame.

Verified: `test/ink-world.test.ts` `"wobble polylines are identical for the same seed and shape id"` — same seed+id ⇒ equal points; different id ⇒ different points.

## Deviations from the spec

1. **`advanceTick(state, brains, events, rng, source?)`** — spec wrote `(state, brains)`. `EventTrace` and `Rng` are not on `InkState`, so they are extra arguments. Hourly decisions default `source: 'rule'`.
2. **`window.__inkControl.applyIntent(mindId, intent, source?)`** — not in the listed bridge. E2E cannot inject `go_market` / Saturday `buy` without it. Injected source defaults to `'llm'`.
3. **Bridge minds also carry `pos` and `sufferedHours`.** Spec list omitted them; E2E needs both.
4. **Starting needs are 1.0.** Spec did not pin spawn hunger/energy/social.
5. **`TICKS_PER_DAY = INK_CONFIG.ticksPerHour * 24`** lives in `config.ts`. 24 is a civil-day constant, not a balance knob, and is not in the section-2 table.
6. **Social gain is presence-based:** both `at === 'center'` (plus the always-on decay). The `socialize` verb still has to succeed at the centre; the gain does not require both current actions to be `socialize`.
7. **Mind names are `"A"` / `"B"`.** Spec left `name` free.
8. **One extra unit test** in `ink-world.test.ts` for wobble stability.

No LLM, no network, no `src/sim/**` edits except the allowed `rng` / `events` / `types` imports. `vite.config.ts` only gained `ink: 'ink.html'` and the `/ink` rewrite next to `/wild`.
