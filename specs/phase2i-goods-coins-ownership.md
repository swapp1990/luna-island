# Dispatch I — Phase 2 foundation: goods, coins, ownership, and honest hunger

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report.

**`CLAUDE.md` invariant 7 ("Scaffold, not script") is the review standard.** Everything below is a WORLD RULE (ground truth: what exists, who owns it, what an action physically does). Brain changes are limited to the two thin lines listed. No behavioral state machines.

Working directory: `D:\MyProjects\Claude\luna-island`.

## What this dispatch introduces

Scarcity's foundation: goods exist in inventories, coins exist in wallets under strict conservation, every place has an owner (all commons at start), foraging PICKS food into your inventory (depleting the bush), eating CONSUMES food you carry, and starving villagers collapse instead of magically refilling. After this dispatch the island has property and stock — Dispatch J adds production and trade on top.

## World rules (`src/sim/`)

1. **Goods & inventories.** `type Good = 'food'` (extensible union). Agents and places get `inventory: Record<Good, number>` (serializes into snapshots; part of the state hash). Worldgen: agents start with 2 food each; bushes start with `stock` 6 food (their inventory).
2. **Coins & conservation.** `wallet: number` on agents, plus a `treasury: number` on world state (the village commons' wallet — Dispatch J's wages/market draw on it). Worldgen: 20 coins per agent, 200 in the treasury. **Conservation is a law:** the ONLY way money moves is a single world-level `transfer(from, to, amount, reason)` helper that emits a `coins:transfer` event; no code path may create or destroy coins. (Nothing calls it yet this dispatch — it lands with tests proving conservation over 3 days.)
3. **Ownership registry.** `owners: Record<placeId, agentId | 'commons'>` on world state, all `'commons'` at worldgen, plus a world-level `transferOwnership(placeId, newOwner, reason)` emitting `ownership:transfer`. (No brain uses it yet — it's the mechanism Phase 3 minds get.)
4. **Foraging replaces free eating.** The old eat-at-bush restore is DELETED. New action `forage` (at a bush slot tile, subject to the existing slot rule): each 5 ticks transfers 1 food bush→agent inventory (emit `goods:transfer`), until agent carries 3 or bush empty. Bush regrowth is a world process: +1 food per 240 ticks up to 6.
5. **Eating consumes carried food.** `eat` works anywhere: consumes 1 food from the agent's inventory over 10 ticks, +0.45 hunger per unit, at most 2 units per meal. No food carried → eat is impossible (brain must forage first).
6. **Collapse (world rule, the no-death consequence).** hunger ≤ 0.02 → `collapsed: true`: movement ×0.4 and the world blocks every restore except eat/sleep. Clears at hunger ≥ 0.25. Events `agent:collapsed` / `agent:recovered` (ticker-worthy, reason strings honest).
7. **Goods ledger law:** like coins, food moves only via a world-level goods `transfer`/`consume` helper emitting events — total food = initial + regrown − eaten must reconcile exactly (tested).

## Thin brain changes ONLY (`utilityBrain.ts`)

- `eat` scores as before but requires food in inventory.
- New `forage` candidate: `(1 − hunger) × 1.2 + (hunger < 0.25 ? 0.5 : 0)` when carrying 0 food, targeting the nearest bush with stock > 0 and a free slot (next-nearest when full — the existing generic rule).

## Render/UI

- Bush berry dots reflect stock (6 dots full → 0 at empty) — reuse the existing berry-dot rendering, just count-driven.
- Bubbles: `🫐 Picking berries`, `🍽️ Eating` (walking cases keep `→` style). Collapsed: `😵 Collapsed — needs food`.
- Inspector: under the needs bars add two compact rows — `🎒 2 food` and `🪙 20 coins` (`data-testid="inv-row"`, `data-testid="wallet-row"`).
- Ticker: collapse/recover events.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty.
2. New vitest (seed 42 unless stated):
   - **Coin conservation:** sum(wallets) + treasury identical at tick 0 and after 3 sim-days.
   - **Food ledger:** initial + regrown − eaten === current total across agents+bushes after 3 sim-days (reconcile from `goods:*` events).
   - **Bush bounds:** stock always within [0, 6]; forage never moves food from an empty bush.
   - **Collapse path:** construct a sim, zero every bush's stock and all agent food via direct state access, advance until some agent's hunger ≤ 0.02 → collapsed flag set, movement slowed, then feed them (inject 2 food) → recovers at ≥ 0.25. Events present with reasons.
   - Determinism double-run + snapshot/seek hash equality (inventories/wallets/owners in the hash).
3. E2e addition: select a foraging agent → inventory row and wallet row visible with numbers; screenshot `artifacts/economy-forage.png` (agent picking at a bush, bubble visible). Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
