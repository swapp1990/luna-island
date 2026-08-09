# Dispatch J — Farms, jobs, wages, and a market with honest prices

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report.

**`CLAUDE.md` invariant 7 is the review standard.** Production, employment, prices, and purchases are WORLD RULES — posted facts and mechanical consequences. The brain gains only the thin preferences listed. Money moves ONLY through the existing `transfer()`; goods only through the goods helpers (conservation stays law).

Working directory: `D:\MyProjects\Claude\luna-island`.

## What this dispatch introduces

Production and trade on Dispatch I's foundation: farms grow food when worked, workers earn wages from the commons treasury, harvests get hauled to a market stall whose posted price responds to stock, and villagers with coins buy dinner instead of foraging. Bushes remain the free-but-meager fallback. After this dispatch the full loop runs: work → wage → buy → eat, and produce → haul → stock → sell — every coin and berry accounted for.

## World rules (`src/sim/`)

1. **Farms.** Worldgen: 3 farm plots (3×3 footprint on grass near the village, walkable rows, slots 2 each, owner `'commons'`). Each farm has `growth: 0..1` and an inventory. World process: growth advances `+1/1440` per tick ONLY while a worker is actively working a slot (tend = work action); at `growth ≥ 1`, growth resets and `+10 food` appears in the farm inventory (event `goods:produced` — this is the ONE place food is minted; add it to the ledger law: initial + regrown + produced − eaten === total).
2. **Employment (generic).** A workplace is any place with `jobSlots > 0` and a posted `wage` (worldgen: farms jobSlots 2 wage 6/day; stall jobSlots 1 wage 5/day). World facts on agents: `employedAt: placeId | null`. Claiming a job = setting `employedAt` when a workplace has a free job slot (event `job:hired`, reason honest). Quitting/abandonment: if an agent doesn't work their job at all for 2 consecutive days, the slot frees (event `job:vacated`). **Wage payment is a world process:** at 18:00 daily, each employee receives `wage × min(1, workedTicks/300)` from the treasury via `transfer()` (event carries workedTicks); workedTicks accrue only while performing `work` on a slot tile of their workplace during 08:00–17:00.
3. **Work action semantics by workplace kind (mechanical, not scripted):** at a farm, working tends (drives growth) and auto-harvests (when farm inventory ≥ 5, the worker's work action switches to a haul leg: carry up to 5 food farm→stall, deposit, walk back — implement as the `work` action's mechanical phases, emitting `goods:transfer` events). At the stall, working just accrues workedTicks (the stall sells passively — see 4).
4. **Market stall.** Has inventory + posted `price` per good (world fact). Price rule, recomputed each sim-hour: `price = clamp(round(4 × sqrt(8 / max(stock, 1))), 2, 12)` coins per food. `buy` action (any agent, at a stall slot tile): 1 food stall→agent AND `price` coins agent→treasury per unit, up to 2 units per visit, only while stall stock > 0 and wallet ≥ price. Events per unit.
5. **Treasury floor:** if the treasury can't cover a wage payment, it pays what it can (partial, event says so). No minting. (With buys flowing back in, seed 42 should stay solvent; the ledger test will prove it either way.)

## Thin brain changes ONLY (`utilityBrain.ts`)

- Unemployed + daytime → claim the nearest workplace with a free job slot (one preference line; no career logic).
- Employed + 08:00–17:00 + not urgent-needy → `work` (score ~0.6 so real hunger/energy still preempt).
- Hungry + no food: prefer `buy` when wallet ≥ posted price and stall stock > 0 (score slightly above forage), else `forage`. That's the poverty line, emergent.

## Render/UI

- Farms: tilled dark-soil tiles + simple crop meshes (small green cones/quads) scaled by `growth`; stall: the existing market-ish spot gets a small canopy + crates whose count reflects stock (reuse the crate/box idiom). Keep it cheap and in-style.
- Bubbles: `👨‍🌾 Working the farm`, `🧺 Hauling the harvest`, `🏪 Working the stall`, `🛒 Buying food`. Ticker: hires, wage payments (`💰 Mira earned 6 coins`), notable buys optional.
- Inspector: a `Job` row (`data-testid="job-row"`): workplace kind + wage, or `Unemployed`.
- **Stats collection (UI comes in Dispatch L, data now):** per sim-hour append `{tick, price, stallStock, treasury, employed, meanWallet, minWallet, maxWallet}` to a `stats` array on world state (part of snapshots/hash).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty.
2. New vitest (seed 42):
   - Coin conservation across 4 sim-days WITH wages and purchases flowing (sum wallets + treasury constant).
   - Extended food ledger: initial + regrown + produced − eaten === total across agents+bushes+farms+stall.
   - Job slots never over-claimed; workedTicks only accrue on slot tiles in work hours.
   - Price always within [2,12] and moves at least once over 4 days (stock actually varies).
   - **Economy-flows integration:** by end of day 4 — ≥ 4 agents employed, ≥ 1 wage payment occurred, stall stocked at least once, ≥ 1 buy occurred. If seed 42 stalls, tune ONLY the listed brain scores minimally and record it in DEVIATIONS.
   - Determinism double-run + snapshot/seek hash (farms/stats/jobs in the hash).
3. E2e: ffwd through 2 sim-days; some agent's inspector shows an employed `job-row`; screenshot `artifacts/economy-market.png` (afternoon: farm with visible crops + stall area). Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
