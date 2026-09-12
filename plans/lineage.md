# Luna Island — Lineage: heritable minds in a text hamlet

**Status:** direction approved 2026-09-07 (this document is the plot; specs derive from it)
**Shape:** a text-first research track. A small hamlet of Luna minds carries a real genome.
Generations turn over at the end of each season. We measure whether the LLM expresses the
genotype in behaviour, and whether mate choice the minds make themselves produces selection
nobody scripted.
**Relationship to the product:** parallel to `plans/colony-builder.md` and `plans/wild-mode.md`,
not a replacement and not an addition to either. No three.js, no tile grid, no town builder.
The genome module and the generation rule are written once and carry forward unchanged when
rooms later become places on the island.
**Prior art this plan answers:** Genomebook (bioRxiv 2026.03.22.713494): 26 traits over 60
diploid loci, SOUL.md + compiled DNA.md per agent, Mendelian segregation with mutation, an
imposed fitness registry, eight generations, random-mating ablation, 20 replicate seeds.
TerraLingua (arXiv 2603.16910): offspring inherit a mutated personality vector, artifacts
outlive authors, an AI Anthropologist annotates the log. "Mutation Without Variation" (arXiv
2606.05408): when the LLM is the mutation operator, diversity collapses.

---

## 1. The claim we want to earn

> A hamlet of **N Luna minds**, each carrying a **numeric diploid genome** compiled into the
> persona it reads, lives under **scarcity, work, and speech** for a season. At season's end the
> minds' own **courtships** decide who pairs; offspring inherit by **Mendelian segregation**; the
> next cohort walks in from the road. Over eight generations the trace shows (a) the LLM
> **expresses** the genotype as observable acts and (b) trait means **respond to selection** the
> world imposes, in the courtship arm and not in the random-mating ablation.

Genomebook's headline (trait means move under an encoded fitness function) is partly
tautological: select on a genome and the genome moves. The claim above is stronger and it is
the only one worth the LLM calls. Its two halves are gated separately (§6).

### 1.1 Three rules we keep from the island

- **Genome is a world rule.** Segregation, mutation, and trait-to-physics bindings live in the
  pure sim and draw only from the seeded RNG. They apply identically under every brain. No
  behaviour branches on which brain is running (the one-world rule from `plans/wild-mode.md`
  §1.5).
- **The LLM never touches the genome.** The DNA block in the prompt is compiled by a
  deterministic trait-to-prose function. Mutation is a bit flip, not a rewrite. This is the
  direct answer to "mutation without variation".
- **Scaffold, not script.** The engine says what is possible: rooms, needs, grain, the granary,
  rules that alter physics, speech, courtship as an act. It never says who should court whom or
  what to say. Mate choice is a brain act (`court`), not the engine reading a ledger.

## 2. The world (text, no coordinates)

A hamlet of five rooms: **fields**, **woods**, **hall**, **homes**, **road**. Movement is free
and implied by the act. Time is four turns a day (dawn, noon, dusk, night), ten days a season,
one season per generation. The RNG, `SimEvent`, and `EventTrace` are shared with `src/sim`.

Each villager: `satiety`, `energy`, `companionship` in [0,1] that decay per turn; a personal
`grain` store; public `standing` (integer, starts 0); a `genome` and derived `traits`; a
`generation` and `parents`. The hamlet has a shared **granary** and a **harvest yield** dial.

Acts (one per villager per turn; every `action:start` carries a first-person `reason`):

| act | room | effect |
|---|---|---|
| `work` | fields | grain += yield × constitution multiplier; energy −0.2 |
| `forage` | woods | grain += 1 with p = 0.5; energy −0.1 |
| `rest` | homes | energy +0.5 |
| `eat` | any | own grain −1 → satiety +0.5; else granary if rule allows |
| `store` / `withdraw` | hall | move grain to/from granary (withdraw gated by rule) |
| `give` | any | grain to a named villager; giver standing +1 |
| `talk` | any | text ≤ 140 chars to a named villager; both companionship +0.3 |
| `court` | any | records a courtship toward a named villager this season |
| `propose` / `vote` | hall | rules from a fixed set that alter physics: `granary-open`, `granary-closed`, `ration-granary`; resolved at dusk by majority of ≥ 3 votes |
| `shun` | any | text; target standing −1 |
| `idle` | any | nothing |

Satiety at 0 starts a starving streak; four starving turns and the villager **leaves for the
coast** (`departed`, never death, consistent with the island). Departed villagers are out of the
breeding pool.

## 3. The genome

Twelve traits over thirty bi-allelic diploid loci. Alleles are 0/1. Loci segregate
independently. Trait value in [0,1] is the mean over its loci of a per-locus score: additive
`(a+b)/2`, dominant `a|b`, recessive `a&b`.

| trait | loci | mode | class | binding |
|---|---|---|---|---|
| metabolism | 3 | additive | constitution | satiety decay × (0.85 + 0.30·t) |
| stamina | 3 | additive | constitution | energy decay × (1.15 − 0.30·t) |
| sociability | 2 | additive | constitution | companionship decay × (0.85 + 0.30·t) |
| industry | 3 | additive | constitution | work yield × (0.85 + 0.30·t) |
| generosity | 3 | additive | disposition | DNA text only |
| voice | 2 | dominant | disposition | DNA text only |
| thrift | 2 | recessive | disposition | DNA text only |
| curiosity | 2 | additive | disposition | DNA text only |
| temper | 2 | dominant | disposition | DNA text only |
| loyalty | 3 | additive | disposition | DNA text only |
| boldness | 2 | additive | disposition | DNA text only |
| caution | 3 | recessive | disposition | DNA text only |

**Constitution** traits bind to physics and therefore feel selection under any brain.
**Disposition** traits reach behaviour only through the DNA block the LLM reads. This split is
the experiment: under the trait-blind instinct brain (Phase A) disposition traits must drift
and constitution traits must respond; under LunaBrain (Phase B) disposition traits must show
up in the trace or the whole premise fails.

Mutation is a per-locus, per-gamete bit flip at a configurable rate (default 0.01; Genomebook's
0.001 is too low for thirty loci and twelve villagers). The DNA compiler maps each trait to one
of three bands (low, mid, high) and emits a short fixed-template paragraph: constitution first
("you tire quickly, you hunger fast"), disposition second ("strongly generous, quiet in the
hall, quick to anger"). No LLM in the compiler.

## 4. Generations

At season's end the sim:

1. Scores **fitness** per villager: `alive ? 1 + 0.1·grain + 0.2·standing : 0`, floored at 0.
2. Forms the **pair pool**. Mutual courtships (each courted the other at least once this
   season) enter with weight 2. Fitness-ranked fallback pairs among the unpaired enter with
   weight 1 so the cohort is always refilled. Pairs are sampled for each of the K offspring
   with probability ∝ weight × combined fitness.
3. `--mating random` ablation: pairs sampled uniformly from all living villagers, ignoring
   courtship and fitness. This is Genomebook's ablation and it must be a flag, not a branch.
4. Each offspring: one gamete from each parent by independent segregation, mutation applied,
   a seeded given name, surname from the higher-standing parent, `generation = parent + 1`.
5. Emits `lineage:pair`, `lineage:born`, `generation:turnover`; the parent cohort departs with
   reason; the offspring cohort arrives by the road at the next dawn with grain 2 and needs 0.8.

Population is constant (default 12). Discrete generations first, because the statistics are
clean and match Genomebook. Overlapping generations are a later iteration.

## 5. What the reader sees

Four text views, all pure functions of the trace and state, all deterministic templates:

- **Chronicle**: per day, per turn, one line per act, speech quoted, rules and shunnings called
  out. This is the part Genomebook never had.
- **Census**: living villagers with generation, trait bands, grain, standing.
- **Family tree**: founders to the current cohort, mermaid `graph TD`.
- **Trajectories**: trait mean and variance per generation, both arms, and across seeds.

Phase A writes them as markdown into `artifacts/lineage/`. Phase C reads them on a plain React
page at `/lineage` with the season dials. No three.js import anywhere on that route.

## 6. Phases and gates

**Phase A — world, genome, generations, no LLM.** `src/lineage/` pure module, a trait-blind
instinct brain, the four renderers, a Node runner with a replicate mode. Gate: `npm run check`
green; determinism (same seed → same hash and event count after 3 seasons); Mendelian tests
(AA×aa → all Aa, heterozygote cross ≈ 1:2:1, offspring carry only parental alleles at mutation
0); 20 seeds × 2 arms × 8 seasons runs in under a minute; the report shows constitution traits
responding in the courtship arm and disposition traits flat in both arms. Spec:
`specs/lineage-a-world-and-genome.md`.

*Phase A landed 2026-09-07* (grok 4.6, report `audit-reports/lineage-a-report.md`). Measured
result, 40 seeds per arm, 8 seasons, 12 villagers:

- At harvest yield ≥ 0.6 nobody starves (the open granary feeds everyone), fitness collapses to
  ≈ 1 + 0.1·grain, and no trait moves beyond noise. The original default of 1.0 was wrong.
- At yield 0.5 about 15 of 96 villager-seasons leave hungry. **Metabolism drops 0.14–0.18 over
  eight generations in both arms** (≈ 7 se from zero). That is viability selection: a world
  rule acting before mating, brain-independent, exactly what a constitution trait should do.
  Default yield is now 0.5.
- **The arm gap is weak with the instinct brain** (industry +0.05 to +0.15 courtship over
  random, 1.4–3.0 se depending on the run). Two reasons: under scarcity the instinct brain
  courts only 23 times per run against 96 when fed, so only 5 of 30 pairs come from mutual
  courtship and the courtship arm is mostly fitness-ranked fallback; and fitness has little
  variance because `give`, `shun`, and proposals barely happen. Both are Phase B matters (the
  LLM should court regardless of hunger and its standing should vary), not world tuning.
- Disposition traits stay within one sd of zero in both arms at every yield, as predicted.

Two facts to carry forward. The random-mating ablation removes courtship and fitness weighting
but not survival, so viability selection shows in both arms and only fertility selection
separates them; Genomebook's ablation has the same property. And the seed-42 census at
generation 8 carries a single surname because standing rarely moves and ties go to the first
parent: a founder effect, worth showing rather than hiding.

**Phase B — the LLM expresses the genome.** A `LineageBrain` on the existing `MindProvider`
seam (codex or grok through the sidecar runners, called from Node), a prompt builder with
persona + DNA block + observation + strict JSON contract, decisions recorded into the trace for
replay. Then the phenotype-expression report: for each disposition trait, the act rate that
should carry it (`give` per day vs generosity, proposals vs voice, `shun` vs temper, `forage`
vs boldness, `store` vs thrift, `court` vs sociability) by low/mid/high band, dose-response not
presence. Control arm: same genomes, DNA block removed. Budget: 12 villagers × 4 turns × 10 days
× 2 seasons ≈ 1,000 decisions for the gate run. **Go/no-go:** if band does not predict act rate
with the DNA block and not without it, stop and rework the compiler before Phase C.

*Phase B ran 2026-09-12* (grok 4.6 implementation, commit `de13665`; gates run by main; report
`audit-reports/lineage-b-report.md`). Verdict: **no-go for Phase C as designed.** Three gates
on codex, seed 42, 12 villagers, 2 seasons, ≈ 3,560 decisions, 0 fallbacks:

- Gate 1 (yield 0.5): extinction in both arms. The model read "Grain: 0.5" as a meal and spent
  45% of turns failing to eat. Fixed with two world facts in the prompt, no advice.
- Gate 2 (yield 0.5, fixed prompt): 24 born, 4 starved, **0 of 8 traits expressed**. `give`,
  `propose`, `shun` never taken. Every turn goes to survival.
- Gate 3 (yield 1.0): 0 starved, **0 of 8 expressed**. Nobody hungry, so nothing to give to;
  `give` taken twice, both by the single highest-generosity villager, with the DNA clause quoted
  as the reason. The observation never shows a neighbour's hunger.

The DNA block is read and, on the rare occasion it can be acted on, acted on correctly. It
almost never can: scarcity removes the slack and slack removes the triggers, and the "Others"
line hides the triggers anyway. Next iteration must give the world inequality inside slack and
make it visible (a starving neighbour, a hoarded surplus) before any further LLM gate. Options
and costs are in the report.

**Phase C — the demonstration.** 8 seasons, 5 seeds per arm on the LLM (≈ 20k decisions),
the `/lineage` text page with chronicle, census, tree, trajectories, and the between-season
dials (harvest yield, blight, granary rule). Run Theater lists lineage runs like any other.

**Later, not now:** overlapping generations, an anthropologist pass over the chronicle, mapping
rooms to island places.

## 7. Leash lines every lineage spec carries

- `src/lineage/**` is pure: no three.js, React, DOM, network, `Math.random`, `Date`,
  `performance`. Import `Rng`, `createRng`, `SimEvent`, `EventTrace` from `src/sim`.
- No behaviour may branch on brain identity or provider. `--mating` is a world parameter.
- Do not edit `src/sim/**`, `plans/`, `specs/`, `CLAUDE.md`. No git. No subagents. No LLM calls
  in Phase A. No web page before Phase C.
- Reports state measured numbers; a trend is claimed only with the seed count that produced it.
