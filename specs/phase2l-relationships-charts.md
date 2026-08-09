# Dispatch L — Relationships (observed, not obeyed), biography inspector, town charts

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report. **`CLAUDE.md` invariant 7 is the review standard.**

Working directory: `D:\MyProjects\Claude\luna-island`.

## What this dispatch introduces

The social ledger and the observatory. Sympathy between villagers accrues as a WORLD FACT from time actually spent together — and deliberately influences NOTHING (no brain changes at all; Phase 3 minds will read these numbers and decide what friendship means). The inspector becomes a tabbed biography, and a town-charts panel finally shows the stats series collected since Dispatch J.

## World rule (`src/sim/`) — the only sim change

**Sympathy.** Per agent, a sparse `sympathy: Record<agentId, number>` (only non-zero entries; serialized, hashed). Accrual: +0.01 per 10 consecutive ticks two agents are both stationary within 1.5 tiles of each other (chatting, working adjacent — the rule doesn't care why). Decay: −0.02/sim-day toward 0 for pairs that didn't meet that day. Clamp [0, 1]. Threshold events, once per crossing direction: ≥ 0.3 `relationship:friends`, ≥ 0.6 `relationship:close` (reason: "grown close from time spent together"; data carries both names). **ZERO brain changes** — grep-verifiable: `utilityBrain.ts` untouched.

## UI

1. **Tabbed inspector** (`Inspector.tsx`): tabs `Status | Life | People | Work` (`data-testid="tab-status"` etc.).
   - Status: current action + reason, needs bars (existing).
   - Life: the activity log (existing, unchanged testid).
   - People: relationship rows — color chip, name, sympathy bar, label (acquaintance < 0.3 ≤ friend < 0.6 ≤ close friend), sorted desc (`data-testid="people-list"`). Empty state: "No close ties yet."
   - Work: job row, owns row, wallet, inventory (existing testids move here).
   - Keep existing `data-testid`s present within their tab; default tab Status; update e2e selectors minimally where a click on a tab is now required first (note each in DEVIATIONS).
2. **Town charts** (`src/ui/Charts.tsx`): 📊 toggle button top-right → panel (`data-testid="charts"`) with three pure-SVG polyline charts from `world.stats` (no libraries): (a) food price, (b) treasury + mean wallet (two lines), (c) employed count + collapse count if available. Show the trailing 3 sim-days, min/max auto-scale with axis labels, ~4 Hz refresh while open, styled like the HUD family. In replay mode, charts show stats ≤ replay tick.
3. Ticker: relationship milestone rows (`💛 Mira and Joss are now friends`).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; **`git`-free check that `utilityBrain.ts` is byte-identical** (e.g. compare mtime/content vs its current state — simply do not edit it).
2. New vitest: constructed-scenario sympathy accrual (two agents pinned adjacent gain sympathy; separated pair decays); milestone events fire exactly once per crossing; determinism + snapshot/seek hashes with sympathy included.
3. New/updated e2e: tabs switch and expose their rows; after ffwd 2 sim-days some People tab has ≥ 1 non-empty relationship; charts panel opens with ≥ 2 polylines each having > 10 points; screenshot `artifacts/biography-charts.png` (People tab open + charts panel visible). Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
