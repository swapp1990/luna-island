# Luna Island — Three-Phase Roadmap

**Vision.** Start a world with a population on an island. From that point on nothing is scripted: every person is an autonomous agent with their own memory, personality, needs, goals, plans, relationships, inventory, money, beliefs. They must actually live — find work, earn, eat, build, trade, organize. Society itself is emergent: no government, currency, police, or property rights exist unless the agents invent them. The **engine** owns ground truth (world, time, resources, ownership, construction, inventories); the **agents** own their minds. In Phase 3 each mind is an LLM instance ("LunaBrain").

**The observer contract (all phases).** Everything is watchable and replayable, RollerCoaster-Tycoon-style:
- Day/night cycle you can see (sun path, sky, lit windows at night).
- Time controls: pause / 1× / 8× / 64×, with a clock HUD ("Day 3 — 16:40").
- Scrub to **any past date/time** and watch it replay.
- Click **any agent** at any point in time → see exactly what they're doing and *why*, and replay that agent's activities.

**Architectural spine (decided up front, never rewritten):**
- Deterministic sim core: fixed tick (1 tick = 1 sim minute), seeded RNG, pure TS, zero render deps. Same seed ⇒ same history, always — this is what makes replay cheap and trust possible.
- Event trace: every intent/action/result appends `{seq, tick, type, agentId, data, reason}`. The trace *is* the observability product.
- Time travel: periodic snapshots + deterministic re-sim to reach any tick (`stateAt(t)`).
- **The Brain seam:** `Brain.decide(observation) → Intent`. Phase 1–2 use `UtilityBrain` (needs-driven scoring). Phase 3 swaps in `LunaBrain` (LLM) — *same interface, zero engine changes*. This is the single most important design decision in the project.
- Renderer: plain three.js reading interpolated sim state; React for HUD/panels only.

---

## Phase 1 — The Living Island

*Foundation: watch time flow, watch agents live, replay anything.*

**The watchable sim:** ~24 villagers on a procedurally generated island live out their days — sleeping at home when night falls, foraging berries when hungry, drinking at the well, gathering at the plaza to socialize, wandering when content. The sun arcs overhead, sky shifts through dawn/day/dusk/night, home windows glow after dark. You speed time to 64×, days flick past, then you drag the timeline back to yesterday morning and watch Mira's breakfast again.

**Scope:**
- Deterministic sim core (tick loop, seeded RNG, event trace, snapshots, `stateAt`).
- Island worldgen: 48×48 tiles (water/sand/grass/forest/rock), village of homes, berry bushes, well, plaza.
- Needs-driven agents: hunger / energy / social decay over time; `UtilityBrain` scores candidate actions (sleep, eat, drink, socialize, wander) and commits with a stated `reason`; BFS grid pathfinding.
- Day/night cycle: orbiting sun/moon directional light, sky color keyframes, warm home lights at night.
- Time controls: pause / 1× / 8× / 64× + clock HUD.
- **Agent inspector:** click a villager → panel with name, needs bars, current action + reason, and their personal activity log (from the event trace).
- **Timeline scrubber:** drag to any past tick → world reconstructs and replays; "Go Live" returns to the head.
- Gates: `window.__simState`/`__simControl` E2E bridge; Playwright smoke on real-GPU headless; determinism test (same seed ⇒ identical hash over 3 sim-days).

**Exit criteria:** all of the watchable-sim paragraph is demonstrably true on screen; `npm run check` and `npm run e2e` green; scrubbing 3 days back reconstructs in <200 ms.

---

## Phase 2 — Economy & Society

*Stuff worth wanting: property, work, money, trade, relationships.*

> **Decisions (locked 2026-08-09):** failed needs cause collapse/sickness, never death (death is a deliberate later decision). Population stays 24. Equal start: identical coins per villager; all productive assets (farms, stall, well) begin as commons owned by a village treasury — inequality must emerge, not be seeded. The ownership registry supports private transfer from day one so agents (especially Phase-3 minds) can privatize, trade, or hoard. Everything ships as world rules per CLAUDE.md invariant 7 — no merchant scripts; the UtilityBrain stays deliberately simple and economically boring. Money is a closed ledger: total coins constant (conservation-tested) unless deliberately minted.
>
> **Dispatch plan:** I (goods, coins, ownership, forage-to-inventory, collapse) → J (farms, jobs, wages, market stall, prices) → K (forestry/quarry resources, construction pipeline) → L (relationships, inspector biography tabs, town charts) → N1 (colony-sim information layer: resource bar, clickable building panels, slot inventories, world-space indicators, hover tooltips — user directive 2026-08-09) → N2 (juice layer: tool/chop animations, crop stages, job hats, toasts polish, portrait dock) → M (persistence: save/load world + timeline).

**The watchable sim:** a working village economy. A farmer sows and harvests; a forester chops; goods flow to a market stall where prices move with supply; agents earn wages, buy food instead of foraging, and save. Someone accumulates enough to commission a new house — you watch it built plank by plank over sim-days. Friendships form from shared meals; the inspector now reads like a biography.

**Scope:**
- Resources & inventories: food/wood/stone; agents and buildings carry stock.
- Jobs & workplaces: farm, forest camp, quarry, market stall; agents take jobs by expected utility (pay vs needs).
- Money & trade: wages, a market with posted prices, simple supply/demand price adjustment. (Currency exists as an engine *capability* — Phase 3 agents may abandon or replace it.)
- Ownership: homes and plots have owners; occupancy and (simple) rent.
- Construction: build orders consume resources + labor over time; new buildings enter the world.
- Relationships: sympathy scores accumulated through shared activities; friends/rivals affect socialize choices.
- Agent memory + daily plans: a morning planning step queues intents; urgent needs interrupt.
- Observability upgrades: inspector tabs (Needs / Inventory & Wallet / Relationships / Plan / History), town dashboard (price charts, wealth distribution, employment), event-type filters on the timeline.
- Persistence: save/load full world + event history (IndexedDB + file export) so long-running worlds survive reload.

**Exit criteria:** an unattended 30-sim-day run stays alive (no starvation collapse, no NaN economy); price of food visibly responds to a supply shock; a house gets built end-to-end; every economic transaction is traceable to two agents' logs; determinism still holds.

---

## Phase 3 — Minds & Institutions

*LunaBrain: LLM minds, conversation, and emergent society.*

**The watchable sim:** villagers with real minds. Each agent's high-level decisions come from its own LLM instance with a persona, memory stream, and reflections (Stanford "generative agents" two-tier pattern: LLM decides *what to pursue* about once per sim-hour or on interrupts; the utility layer executes moment-to-moment). Agents converse — transcripts land in both biographies. There are **no built-in institutions**: the engine only offers primitives — claim, agreement, proposal, vote, sanction — and whether laws, councils, or currency reform emerge is up to the agents. A narrative feed surfaces what history is being made; you click any agent and read their actual thoughts, then replay their whole day.

**Scope:**
- `LunaBrain implements Brain`: prompt = persona + relevant memories + observation → structured Intent (+ inner monologue, stored as `thought` events). Provider-pluggable (Anthropic API first, local model optional).
- Cost containment: decision cadence + interrupt triggers, response caching, tiered minds (a few "protagonist" agents on a big model, rest on a small one), token budget dashboard, graceful fallback to UtilityBrain when offline/over budget.
- Agent↔agent conversation: engine delivers messages; transcripts traced; knowledge/rumors spread through talk.
- Institution primitives: propose / agree / vote / claim / sanction as engine verbs with ground-truth effects (e.g., a registered claim changes ownership checks) — but zero built-in policy.
- Narrative feed: notable emergent events auto-surfaced ("Day 12: Joss proposed nightly berry rationing; 9 for, 6 against").
- Mind inspector: current goal, plan, memory stream, last prompt/response exchange, decision timeline — plus full RCT-style day replay per agent including conversations.
- Determinism with an oracle in the loop: LLM responses are recorded into the event trace at decision points, so **replay never re-calls the LLM** — a recorded world replays bit-identically forever.

**Exit criteria:** a fresh world with 12+ LLM-driven agents runs a full sim-week unattended within a stated token budget; at least one unscripted multi-agent arrangement emerges and is legible in the narrative feed; any agent's day is replayable including thoughts and conversations; recorded worlds replay identically with zero API calls.

---

## Beyond (unscheduled)

Bigger populations via brain LOD; observer "god tools" (drop resources, spawn agents); multi-island trade; shareable world replays; multiplayer observation.
