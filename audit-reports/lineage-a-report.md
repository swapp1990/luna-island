# LINEAGE-A report

Numbers first. No world knobs were turned to chase the prediction.

## 1. Files created (non-blank line counts)

| file | lines |
|---|---|
| `src/lineage/types.ts` | 189 |
| `src/lineage/genome.ts` | 173 |
| `src/lineage/hash.ts` | 96 |
| `src/lineage/world.ts` | 172 |
| `src/lineage/step.ts` | 462 |
| `src/lineage/season.ts` | 202 |
| `src/lineage/instinctBrain.ts` | 141 |
| `src/lineage/run.ts` | 61 |
| `src/lineage/render/chronicle.ts` | 182 |
| `src/lineage/render/census.ts` | 26 |
| `src/lineage/render/tree.ts` | 24 |
| `src/lineage/render/trajectories.ts` | 76 |
| `scripts/lineage-run.mjs` | 241 |
| `test/lineage-genome.test.ts` | 165 |
| `test/lineage-determinism.test.ts` | 23 |
| `test/lineage-season.test.ts` | 81 |
| `test/lineage-rules.test.ts` | 124 |
| `test/lineage-render.test.ts` | 43 |
| `audit-reports/lineage-a-report.md` | this file |

`src/lineage/` is a new module. Nothing under `src/sim/**` was written by this dispatch.

## 2. Gates

**tsc + vite build:** green (`tsc --noEmit` exit 0; `vite build` `✓ built in 4.81s` / `5.08s` on later runs).

**Lineage vitest:** 17/17 pass.

```
✓ test/lineage-rules.test.ts (3)
✓ test/lineage-render.test.ts (1)
✓ test/lineage-season.test.ts (4)
✓ test/lineage-determinism.test.ts (3)
✓ test/lineage-genome.test.ts (6)
Test Files  5 passed (5)
     Tests  17 passed (17)
```

**`npm run check` (full suite):** not green. Three full runs, all red on **pre-existing** files, never on `test/lineage-*.test.ts`.

| attempt | result | failures |
|---|---|---|
| 1 | `4 failed \| 78 passed \| 2 skipped (84)` / `4 failed \| 697 passed \| 7 skipped (708)` | `persist.test.ts`, `economy.test.ts`, `conversation.test.ts`, `wild-screenplay.test.ts` — all **timeouts** under 8-thread load |
| 2 | `1 failed \| 81 passed \| 2 skipped` / `1 failed \| 700 passed \| 7 skipped` | `wild-screenplay.test.ts` timeout 90s (the test then printed `DETERMINISM hash=f0b95e72` after the timeout) |
| 3 | `2 failed \| 80 passed` | screenplay still timed out after a 120s bump (reverted); plus a `mind.test.ts` flake `expected 6 to be 8` |

Isolation: `persist`, `conversation`, `wild-screenplay` pass when not sharing the pool with the other multi-day sims (`wild-screenplay` 55.5s alone vs 90s+ in the full run). This dispatch did not change those tests or `src/sim`. Per the 3-attempt stop rule, the full-suite gate is reported red rather than chasing pool timeouts.

**Purity grep** (`Select-String -Path src\lineage\*.ts,src\lineage\render\*.ts -Pattern "three|react|document|window|fetch\(|Math\.random|Date\.now|performance"`):

```
(no output)
```

No matches in `src/lineage/**`.

**`git status --short src/sim` (read-only):**

```
 M src/sim/blueprints.ts
 M src/sim/events.ts
 M src/sim/examine.ts
 M src/sim/firstStorm.ts
 M src/sim/lunaRoster.ts
 M src/sim/sim.ts
 M src/sim/spawn.ts
 M src/sim/spots.ts
 M src/sim/townGrowth.ts
 M src/sim/types.ts
 M src/sim/utilityBrain.ts
 M src/sim/worldgen.ts
?? src/sim/coastalNeighborhood.ts
?? src/sim/constructionManifest.ts
?? src/sim/legibility.ts
?? src/sim/wildAge0.ts
```

Those paths were already dirty in this working tree. This dispatch did not write, edit, or create any file under `src/sim/**`. Lineage only **imports** `createRng` / `Rng`, `EventTrace`, and `SimEvent`.

## 3. Replicate

Command: `node scripts/lineage-run.mjs --seeds 1..20`

| run | wall | sim loop | out |
|---|---|---|---|
| 1 (Vite re-optimized after an unrelated config touch) | 97836 ms | n/a | `artifacts/lineage/replicate-20260907-1807` |
| 2 (steady) | **12664 ms** | **707 ms** | `artifacts/lineage/replicate-20260907-1809` |

Steady wall **12.7 s < 60 s**. The 98 s first pass was Vite `Re-optimizing dependencies because vite config has changed`, not the hamlet. 20 seeds × 2 arms × 8 seasons of sim work is 0.7 s.

Default 8-season courtship seed 42: chronicle **243 745 bytes** (under 400 KB), `eventCount` 9697, `generationsBorn` 96, `departuresByStarvation` **0**, hash `da5ffd94`.

Δ gen0→gen7 (n = 20, both arms), copied from `artifacts/lineage/replicate-20260907-1809/aggregate.md`:

```
Δ gen0→gen7 metabolism: courtship = -0.0035 ± 0.1406, random = 0.0313 ± 0.1369
Δ gen0→gen7 stamina:     courtship =  0.0132 ± 0.1360, random = 0.0049 ± 0.1214
Δ gen0→gen7 sociability: courtship =  0.0635 ± 0.1597, random = 0.0438 ± 0.1263
Δ gen0→gen7 industry:    courtship =  0.0285 ± 0.1364, random = 0.0361 ± 0.1644
Δ gen0→gen7 generosity:  courtship = -0.0125 ± 0.0953, random = -0.0368 ± 0.1151
Δ gen0→gen7 voice:       courtship = -0.0625 ± 0.2057, random = -0.0083 ± 0.1861
Δ gen0→gen7 thrift:      courtship =  0.0583 ± 0.1544, random =  0.0104 ± 0.2128
Δ gen0→gen7 curiosity:   courtship = -0.0167 ± 0.1339, random =  0.0031 ± 0.1080
Δ gen0→gen7 temper:      courtship =  0.0563 ± 0.1470, random = -0.0042 ± 0.1793
Δ gen0→gen7 loyalty:     courtship = -0.0764 ± 0.1287, random = -0.0278 ± 0.1098
Δ gen0→gen7 boldness:    courtship =  0.0573 ± 0.1626, random =  0.0135 ± 0.1536
Δ gen0→gen7 caution:     courtship =  0.0806 ± 0.1361, random =  0.0014 ± 0.0813
```

## 4. Did the design prediction hold?

**No for constitution. Yes for disposition (flat).**

The claim: constitution (metabolism down, industry up, stamina up, sociability whichever way) moves in the courtship arm **beyond one sd of the random arm**; disposition stays **within one sd of zero** in both arms.

**Constitution — did not hold.** Every courtship Δ is inside the random arm's ±1 sd band, and |courtship Δ| is itself well under that arm's own sd (~0.12–0.16):

| trait | courtship Δ | random Δ ± sd | \|court − random\| vs random sd |
|---|---|---|---|
| metabolism | −0.0035 | +0.0313 ± 0.1369 | 0.035 < 0.137 |
| stamina | +0.0132 | +0.0049 ± 0.1214 | 0.008 < 0.121 |
| sociability | +0.0635 | +0.0438 ± 0.1263 | 0.020 < 0.126 |
| industry | +0.0285 | +0.0361 ± 0.1644 | 0.008 < 0.164 |

Industry even moves slightly **more** in the random arm. Metabolism does not go down in any detectable way.

**Disposition — held.** In both arms, |Δ| < the arm's own sd for all eight disposition traits (largest courtship |Δ| is caution +0.0806 vs sd 0.1361). That is drift, not a signal.

**Diagnosis (not a retune).** Seed-42 default run had **zero** starvation departures. Fitness is `1 + 0.1·grain + 0.2·standing`. The instinct brain never `give`s or `shun`s, and almost never enacts rules, so standing is ~0 and fitness is a thin function of leftover grain. Work yield only spans `0.85–1.15` across industry in [0,1], so the grain term is a few hundredths of a fitness unit. Courtship is familiarity (`talkedWith`), which is trait-blind, so the weight-2 pairs are not constitution-assortative. Fallback fitness pairing exists, but with K=12, 8 generations, mutation 0.01, and sd ≈ 0.14 across 20 seeds, that lever is smaller than drift. Dominant/recessive baselines (voice ~0.75, thrift/caution ~0.22 at gen 0) are Mendelian starting means, not selection.

Phase A did what it was supposed to as a **null baseline**: disposition did not fake a signal. Constitution did not yet show world-imposed response under this brain and this N. Phase B should not treat these Δ as a go/no-go for the DNA compiler.

## 5. Skipped / unfinished / unsure

- Full `npm run check` is red on pre-existing timeout/flake tests (`wild-screenplay.test.ts` 90s budget vs ~90–120s under 8-thread load; occasional `mind.test.ts` inbox count). Lineage tests and `tsc`/`vite build` are green. I did not keep a timeout bump on `wild-screenplay.test.ts` (tried 120s, still timed out, reverted to 90s).
- I did not profile the 98 s first replicate beyond identifying the Vite re-optimize; the repeat is 12.7 s wall / 0.7 s sim.
- `src/sim` working-tree dirt is pre-existing; not cleaned, not touched.
- No LLM, no soak, no React, no `/lineage` page (Phase C).

## Questions for main

None that blocked the module. The only product question is whether Phase A's constitution-selection claim should be restated as “not detectable at N=20, K=12, instinct brain, yield=1.0” rather than a failed world.

---

## Main session verdict (2026-09-07)

Independently verified: 17/17 lineage tests pass in isolation; purity grep clean; no `src/sim`
file has an mtime after dispatch start. The three `npm run check` failures are the known
timeout flake of pre-existing suites under the 8-thread pool, unrelated to this module.

Answer to question 2: yes, the default fitness lever was too weak, and that was the spec's
world numbers, not the implementation. Scarcity sweep with the shipped CLI (n = 40 seeds per
arm, 8 seasons, Δ gen0→gen7 of cohort mean):

| yield | starvation departures / run | metabolism courtship | metabolism random | industry courtship | industry random |
|---|---|---|---|---|---|
| 1.0 (n=20) | 0.0 | −0.003 ± 0.141 | +0.031 ± 0.137 | +0.028 ± 0.136 | +0.036 ± 0.164 |
| 0.6 (n=20) | 0.0 | −0.057 ± 0.129 | +0.001 ± 0.175 | +0.038 ± 0.124 | +0.035 ± 0.117 |
| 0.5 | 14.8 / 14.6 | −0.176 ± 0.161 | −0.136 ± 0.105 | +0.081 ± 0.154 | +0.034 ± 0.142 |
| 0.45 | 20.4 / 20.8 | −0.160 ± 0.172 | −0.114 ± 0.158 | +0.044 ± 0.144 | +0.059 ± 0.139 |
| 0.4 | 23.2 / 24.4 | −0.172 ± 0.139 | −0.143 ± 0.125 | +0.085 ± 0.142 | +0.022 ± 0.165 |

Viability selection on metabolism is robust from yield 0.5 down (both arms, ≈ 7 se). The
courtship-vs-random gap is not robust with the instinct brain (1.4–3.0 se) because it barely
courts under scarcity (seed 42, yield 0.4: 23 court acts, 5 of 30 pairs weight-2) and fitness
variance is small. That is the Phase B lever, not a world tune.

Changes made by main after the dispatch: `DEFAULT_CONFIG.harvestYield` 1.0 → 0.5 with a
comment; `scripts/lineage-run.mjs` output directories now carry seconds and the yield
(`replicate-y0.5-<stamp>`) because three sweeps in one minute overwrote each other.

Answer to question 1: accepted as a pre-existing flake; not changing timeouts in this track.
