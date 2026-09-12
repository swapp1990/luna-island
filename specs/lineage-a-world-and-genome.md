# Dispatch LINEAGE-A — The text hamlet: world, genome, generations (no LLM)

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents. NEVER run any `git` command. Do not edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`, or anything under `src/sim/**` (you only import from it). Do not build a web page or any React. Do not make any network or LLM call. Do NOT run a soak. Read the existing code first and extend it in its style. If a gate will not go green after 3 distinct fix attempts, STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` first. Invariants 1, 2, 3, 5, and 7 apply to the new module exactly as they apply to `src/sim/`. Then read `plans/lineage.md` end to end; it is the plot and this spec is its Phase A. Where this spec and the plan disagree, this spec wins.

## What this dispatch builds

A new pure TypeScript module `src/lineage/` — a five-room text hamlet where villagers carry a diploid genome, live ten-day seasons under scarcity, court each other, and are replaced at season's end by Mendelian offspring. A trait-blind instinct brain drives them (the LLM brain is Phase B, not yours). Four deterministic markdown renderers, a Node runner with a replicate mode, and vitest gates.

Read these before writing anything, in this order: `src/sim/rng.ts`, `src/sim/events.ts`, the `SimEvent`, `Rng`, and `Brain` shapes in `src/sim/types.ts` (around lines 800–880), `src/sim/utilityBrain.ts` (for the tone of an instinct brain), `scripts/make-run-fixture.mjs` (for how a Node script loads TS via `createServer` + `ssrLoadModule`, and `gitStamp` from `scripts/run-stamp.mjs`), and one existing test such as `test/mind.test.ts` for test style.

## Files you create

```
src/lineage/types.ts          state, villager, genome, intent, observation, brain, config
src/lineage/genome.ts         loci table, randomGenome, traitsOf, meiosis, mutate, offspringGenome, dnaText, bandOf
src/lineage/world.ts          createHamlet(config) → LineageState (founders, granary, rules)
src/lineage/step.ts           advanceTurn(state, brainFor, rng): resolves intents, needs, starving, departures, proposals
src/lineage/season.ts         endSeason(state, rng): fitness, pair pool, offspring, turnover events, arrival
src/lineage/instinctBrain.ts  trait-blind Brain implementation
src/lineage/hash.ts           lineageHash(state): string (FNV-1a over canonical JSON, same spirit as src/sim)
src/lineage/render/chronicle.ts   (events, state) → markdown
src/lineage/render/census.ts      state → markdown table
src/lineage/render/tree.ts        lineage records → mermaid graph TD in a fenced block
src/lineage/render/trajectories.ts lineage records → markdown table + JSON summary
src/lineage/run.ts            runLineage(config): { state, events, summary } — the single entry the CLI and tests call
scripts/lineage-run.mjs       CLI (see §6)
test/lineage-genome.test.ts
test/lineage-determinism.test.ts
test/lineage-season.test.ts
test/lineage-rules.test.ts
test/lineage-render.test.ts
audit-reports/lineage-a-report.md   your report (see §8)
```

Import `createRng` and the `Rng` type from `src/sim/rng.ts` / `src/sim/types.ts`, `EventTrace` from `src/sim/events.ts`, `SimEvent` from `src/sim/types.ts`. Nothing else from `src/sim`.

## 1. Types (pin these shapes)

```ts
export type Room = 'fields' | 'woods' | 'hall' | 'homes' | 'road'
export type Turn = 0 | 1 | 2 | 3            // dawn, noon, dusk, night
export type Allele = 0 | 1
export interface Genome { a: Allele[]; b: Allele[] }   // two haplotypes, length 30, index = locus
export type TraitName =
  | 'metabolism' | 'stamina' | 'sociability' | 'industry'
  | 'generosity' | 'voice' | 'thrift' | 'curiosity' | 'temper' | 'loyalty' | 'boldness' | 'caution'
export type Traits = Record<TraitName, number>          // each in [0,1]
export type Band = 'low' | 'mid' | 'high'

export interface Villager {
  id: string; givenName: string; surname: string
  generation: number; parents: [string, string] | null
  genome: Genome; traits: Traits
  satiety: number; energy: number; companionship: number   // [0,1]
  grain: number; standing: number
  room: Room
  starvingTurns: number
  status: 'alive' | 'departed'
  courted: string[]        // ids courted this season (reset at season start)
  talkedWith: Record<string, number>   // familiarity ledger this season
}

export type RuleId = 'granary-open' | 'granary-closed' | 'ration-granary'
export interface Proposal { id: string; rule: RuleId; by: string; text: string; openedTick: number; votes: Record<string, 'for' | 'against'>; resolved?: 'adopted' | 'rejected' }

export interface LineageConfig {
  seed: number; cohortSize: number; daysPerSeason: number; turnsPerDay: number; seasons: number
  harvestYield: number; mutationRate: number; mating: 'courtship' | 'random'; granaryStart: number
}
export const DEFAULT_CONFIG: LineageConfig = { seed: 42, cohortSize: 12, daysPerSeason: 10, turnsPerDay: 4, seasons: 8, harvestYield: 1.0, mutationRate: 0.01, mating: 'courtship', granaryStart: 6 }

export interface LineageRecord { id: string; givenName: string; surname: string; generation: number; parents: [string, string] | null; genome: Genome; traits: Traits; fitness?: number; departedReason?: string }

export interface LineageState {
  config: LineageConfig
  tick: number                 // 1 tick = 1 turn; day = floor(tick / turnsPerDay) within season
  season: number; day: number; turn: Turn
  villagers: Villager[]        // living + departed this season
  granary: number
  rules: Set<RuleId> | RuleId[]     // pick one and be consistent; must serialize deterministically
  proposals: Proposal[]
  lineage: LineageRecord[]     // every villager ever born, founders included
  granaryTakenToday: Record<string, number>   // for ration-granary
}

export type LineageActKind = 'work' | 'forage' | 'rest' | 'eat' | 'store' | 'withdraw' | 'give' | 'talk' | 'court' | 'propose' | 'vote' | 'shun' | 'idle'
export interface LineageIntent { kind: LineageActKind; target?: string; amount?: number; text?: string; rule?: RuleId; proposalId?: string; choice?: 'for' | 'against'; reason: string }
export interface LineageObservation { self: Villager; others: Villager[]; state: LineageState; facts: string[] }
export interface LineageBrain { decide(obs: LineageObservation, rng: Rng): LineageIntent }
```

`reason` is required on every intent and is copied onto the `action:start` event. Villager ids are `v-<n>` with `n` monotonically increasing across the whole run (founders `v-0..v-11`).

## 2. Genome (`genome.ts`)

Loci table, in this exact order (index 0 = first locus): metabolism ×3, stamina ×3, sociability ×2, industry ×3, generosity ×3, voice ×2, thrift ×2, curiosity ×2, temper ×2, loyalty ×3, boldness ×2, caution ×3 = 30. Modes: additive for metabolism, stamina, sociability, industry, generosity, curiosity, loyalty, boldness; dominant for voice, temper; recessive for thrift, caution.

- `traitsOf(genome)`: per-locus score additive `(a+b)/2`, dominant `a|b`, recessive `a&b`; trait = mean over its loci.
- `randomGenome(rng)`: each allele independently 0/1 with p = 0.5.
- `meiosis(genome, rng)`: one gamete, each locus independently from `a` or `b` (unlinked).
- `mutate(gamete, rate, rng)`: flip each allele with probability `rate`.
- `offspringGenome(p1, p2, rate, rng)`: `{ a: mutate(meiosis(p1)), b: mutate(meiosis(p2)) }`. Call order is fixed exactly like this so determinism tests are meaningful.
- `bandOf(t)`: low `< 0.34`, mid `< 0.67`, high otherwise.
- `dnaText(traits)`: deterministic fixed-template paragraph, constitution sentence first then disposition sentence, one clause per trait keyed by band, no randomness, ≤ 600 chars. Example clause set for generosity: low "you keep what you earn", mid "you share when asked", high "you give before you are asked". Write all 36 clauses (12 traits × 3 bands); this text is the Phase B prompt block so make it plain, first-person-addressed ("you"), and free of any world facts or advice about what to do.

## 3. World and step (`world.ts`, `step.ts`)

- `createHamlet(config)`: `cohortSize` founders, generation 0, random genomes, seeded given names from a fixed list of ≥ 40 names, surnames from a fixed list of ≥ 20, room `road`, satiety/energy/companionship 0.8, grain 2, standing 0. Granary = `granaryStart`. Rules start as `['granary-open']`. Push a `LineageRecord` per founder. Emit `season:start` and `day:start`.
- `advanceTurn(state, brainFor: (v: Villager) => LineageBrain, rng)`:
  1. Emit `turn:start`.
  2. For every living villager in id order: build the observation, call `decide`, emit `action:start { kind, target, … }` with `reason`, resolve the act (table in `plans/lineage.md` §2, exact numbers repeated here), emit `action:end` with an outcome, or `action:fail` with a reason string when the act cannot resolve (no grain to eat, granary closed, target departed, not at the hall).
  3. Needs decay after all acts: satiety −0.12 × (0.85 + 0.30·metabolism), energy −0.15 × (1.15 − 0.30·stamina), companionship −0.06 × (0.85 + 0.30·sociability), all clamped to [0,1]. Emit `need:critical` once when a need first crosses below 0.15.
  4. Starving: satiety === 0 → `starvingTurns++`, emit `villager:starving`; else reset to 0. At `starvingTurns >= 4` the villager departs: `status = 'departed'`, `departedReason`, emit `villager:departed` with reason text, remove from further turns.
  5. At dusk (turn 2) resolve open proposals: adopted if ≥ 3 votes cast and strictly more `for` than `against`, else rejected; adopting `granary-open` removes `granary-closed` and vice versa; `ration-granary` stacks with `granary-open`. Emit `proposal:resolved` and `rule:enacted`. Proposer standing +1 on adoption.
  6. Advance tick/turn/day; on a new day emit `day:start` and clear `granaryTakenToday`.

Act numbers: `work` grain += `harvestYield × (0.85 + 0.30·industry)` (fractional grain allowed; render to one decimal), energy −0.2; `forage` grain += 1 with p 0.5, energy −0.1; `rest` energy +0.5; `eat` own grain −1 → satiety +0.5, else if `granary-open` in force and granary ≥ 1 and (not `ration-granary` or `granaryTakenToday[id] < 1`) take 1 from the granary; `store` moves `amount` (default all) own → granary at the hall; `withdraw` moves `amount` (default 1) granary → own if `granary-open` and ration permits; `give` moves `amount` (default 1) to `target`, giver standing +1, receiver companionship +0.1; `talk` both companionship +0.3, `talkedWith[target]++` both ways, emit `speech { to, text }`; `court` pushes `target` onto `courted` if absent, emit `court`; `propose` only at the hall (the act moves you there), opens a proposal, emit `proposal:open`; `vote` records the choice, emit `vote`; `shun` target standing −1, emit `shun { to, text }`; `idle` nothing. Every act sets `room` to the act's room (`eat`, `give`, `talk`, `court`, `shun`, `idle` keep the current room).

## 4. Season end (`season.ts`)

`endSeason(state, rng)` runs after the last turn of day `daysPerSeason`:

1. Fitness per villager: `alive ? max(0, 1 + 0.1·grain + 0.2·standing) : 0`. Write it onto the `LineageRecord`.
2. Pair pool. Mutual courtships (both ids appear in each other's `courted`) get weight 2. Then, among living villagers not in any mutual pair, sort by fitness descending and pair adjacent (1st with 2nd, 3rd with 4th, …) with weight 1. Each pair's sampling weight = `weight × (f1 + f2)`. If the pool is empty (everyone departed) the run ends early with `season:extinct`.
3. `mating === 'random'`: ignore §4.2 entirely; for each offspring pick two distinct living villagers uniformly. This is a config flag consulted here and nowhere else.
4. For each of `cohortSize` offspring: sample a pair (∝ weight, via `rng`), `offspringGenome(p1, p2, mutationRate, rng)`, seeded given name from the list, surname from the parent with higher standing (tie → first parent by id), `generation = max(parent generations) + 1`, new `v-<n>`. Emit `lineage:pair { p1, p2, weight }` once per distinct pair used and `lineage:born { id, parents, generation }` per child. Push the `LineageRecord`.
5. Every living parent departs: `status = 'departed'`, `departedReason: 'season ended; the elders leave for the coast'`, emit `villager:departed`. Emit `generation:turnover { season, generation, born: n }`.
6. Replace `villagers` with the offspring cohort on the `road`, needs 0.8, grain 2, standing 0, `courted = []`, `talkedWith = {}`. Increment `season`, reset day/turn, emit `season:start`, `lineage:arrive { ids }`, `day:start`.

## 5. Instinct brain (`instinctBrain.ts`)

Trait-blind on purpose: it may read needs, grain, standing, room, rules, granary, `talkedWith`, and others' public fields, but MUST NOT read `genome`, `traits`, or any DNA text. Add a comment saying why (the Phase A null baseline). Priorities, first match wins, with a short first-person `reason` each:

1. satiety < 0.3 and (own grain ≥ 1 or granary reachable) → `eat`.
2. energy < 0.25 → `rest`.
3. satiety < 0.5 and own grain < 1 → `work` if `harvestYield ≥ 0.6` else `forage`.
4. companionship < 0.3 and another living villager exists → `talk` to the villager with the highest `talkedWith` (tie → lowest id; none → `rng.pick`), text from a fixed list of ≥ 12 neutral lines chosen with `rng`.
5. Day ≥ 6 and no courtship yet this season and a most-talked-with villager exists → `court` them.
6. Own grain > 4 → `store` the surplus above 3 (only if not at the hall this turn? No: the act moves you; keep it simple).
7. rng < 0.10 and an open proposal exists the villager has not voted on → `vote` `for` if the rule matches what they lack (starving-adjacent villagers vote `for` `granary-open`), else `against`.
8. rng < 0.03 and no open proposal → `propose` `granary-open` if a `granary-closed` rule is in force, else `ration-granary` if granary < cohortSize, else `idle`.
9. Otherwise `work`.

No `give`, `shun`, or `withdraw` from the instinct brain; those acts exist for Phase B. It is fine that the Phase A chronicle has few proposals.

## 6. Runner (`run.ts`, `scripts/lineage-run.mjs`)

`runLineage(config, brainFactory?)` creates the hamlet, loops seasons × days × turns calling `advanceTurn` then `endSeason`, returns `{ state, events, summary }` where `summary = { config, seasons, generationsBorn, departuresByStarvation, traitMeansByGeneration: Record<TraitName, number[]>, traitVarByGeneration, hash, eventCount }`.

CLI `node scripts/lineage-run.mjs [--seed 42] [--seasons 8] [--mating courtship|random] [--yield 1.0] [--mutation 0.01] [--cohort 12] [--seeds 1..20] [--out artifacts/lineage]`:

- Load TS through `createServer` + `ssrLoadModule('/src/lineage/run.ts')` exactly as `make-run-fixture.mjs` does; close the server when done.
- Single run writes `artifacts/lineage/<mating>-seed<seed>-<yyyymmdd-hhmm>/` with `chronicle.md`, `census.md`, `tree.md`, `trajectories.md`, `summary.json`, `events.jsonl`, and a `stamp.json` from `gitStamp()`.
- `--seeds A..B` runs each seed for BOTH mating arms and writes `artifacts/lineage/replicate-<stamp>/aggregate.md`: per trait, per generation, mean of the per-run trait mean and its sd across seeds, one table per arm, plus a final line per trait: "Δ gen0→gen7 courtship = x ± sd, random = y ± sd". Also `aggregate.json`.
- Print the output directory and the wall time. Twenty seeds × 2 arms × 8 seasons must finish in under 60 s on this machine; if it does not, profile and fix before reporting.

## 7. Renderers (`render/*.ts`)

Pure functions of `(events, state)` or lineage records. Markdown only. No randomness.

- `chronicle`: `## Season s, generation g` / `### Day d` / one line per turn header (`dawn`, `noon`, `dusk`, `night`) then one sentence per `action:start` in template form: `**Tal Mirason** works the fields (+1.1 grain). _"reason"_`. Speech renders as `> Tal to Bel: "text"`. `give`, `shun`, `proposal:*`, `rule:enacted`, `villager:starving`, `villager:departed`, and every `lineage:*` event get their own line. Keep the chronicle for a full 8-season default run under 400 KB.
- `census`: one table: name, gen, satiety/energy/companionship as %, grain, standing, then twelve trait band letters (L/M/H) in the loci-table order, status.
- `tree`: mermaid `graph TD` with one node per villager `v-n["Given Surname (g)"]` and edges parent → child; founders in a subgraph.
- `trajectories`: table trait × generation of cohort mean (2 decimals) and a second table of variance; also returns the JSON used by `summary`.

## 8. Tests and gates

All under `test/`, vitest, `environment: node`. Use the seeded RNG for every stochastic assertion; assert on exact values where the design makes them exact and on tolerances where it does not.

- `lineage-genome.test.ts`: loci table length 30 and trait loci counts; `traitsOf` modes on hand-built genomes (all-ones, all-zeros, heterozygous → additive 0.5 / dominant 1 / recessive 0); AA×aa cross at mutation 0 → every offspring heterozygous at that locus; heterozygote × heterozygote over 10,000 children at mutation 0 → allele-pair ratios within 2% of 1:2:1; at mutation 0 every offspring allele equals one of the parental alleles at that locus; `dnaText` is deterministic, ≤ 600 chars, contains a distinct clause for each band of each trait (36 clauses reachable), and never contains the words "should", "must", or a room name.
- `lineage-determinism.test.ts`: `runLineage` twice with the default config → identical `hash`, `eventCount`, and `traitMeansByGeneration`; seed 43 → different hash; `mating: 'random'` with the same seed → different hash. Run 3 seasons to keep it fast.
- `lineage-season.test.ts`: after `endSeason`, living count equals `cohortSize`, every previous villager is `departed` with the season reason, every child has two parents from the previous cohort and `generation` +1; mutual courtship pairs appear in `lineage:pair` events with weight 2 when present; with `mating: 'random'` no `weight: 2` pair appears even when courtships exist; ids are unique across the run.
- `lineage-rules.test.ts`: with `granary-closed` enacted, `eat` with no own grain emits `action:fail`; with `ration-granary`, the second granary `eat` on the same day fails and the first succeeds; a proposal with 2 votes is rejected at dusk and one with 3 `for` is adopted and emits `rule:enacted`.
- `lineage-render.test.ts`: every `action:start` in a 1-season run has a non-empty `reason`; the chronicle contains at least one `> ` speech line; census has exactly `cohortSize` rows for the living; tree contains a `graph TD` and one edge per non-founder; trajectories has 12 trait rows.

Gates: `npm run check` (tsc + vite build + all vitest) green, including every pre-existing test. Confirm `src/lineage/**` has no import of `three`, `react`, `document`, `window`, `fetch`, `Math.random`, `Date`, or `performance` (quote the grep). Confirm nothing under `src/sim/**` changed (quote `git status --short src/sim` output as read-only evidence; this is a read, not a git operation you perform to change anything).

## 9. Report (`audit-reports/lineage-a-report.md`)

Write honestly, numbers first:

1. Files created, line counts.
2. Gate outputs: `npm run check` summary line, the purity grep, the `src/sim` status line.
3. Replicate run: `node scripts/lineage-run.mjs --seeds 1..20` wall time and output path. Paste the Δ gen0→gen7 line for all twelve traits, both arms.
4. State plainly whether the design's prediction held: constitution traits (metabolism down, industry up, stamina up, sociability whichever way the world pushes) move in the courtship arm beyond one sd of the random arm; disposition traits stay within one sd of zero in both arms. If the prediction did not hold, say so and give your best diagnosis; do not tune the world to make it hold.
5. Anything you skipped, could not finish, or are unsure about.

If you get stuck with a genuine design question, write it in the report under "Questions for main" and continue with the rest.
