# Dispatch N1 — Game-standard information layer: resource bar, building panels, tooltips, indicators

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report.

**Scope guard:** this dispatch is RENDER/UI ONLY plus additive event/bridge surface. `src/sim/` may gain ONLY: (a) additive event `data` fields needed to render without lookups, (b) a read-only selector helper (e.g. workers-of-place). No new world rules, no brain changes (`utilityBrain.ts` byte-identical), determinism hashes unchanged aside from nothing (no state shape changes!).

Working directory: `D:\MyProjects\Claude\luna-island`. The user wants the economy readable in the visual language of modern colony sims (Stardew / Timberborn / Manor Lords idioms). Visual family stays: dark translucent panels, rounded corners, the existing HUD style.

## 1. Town resource bar (top-left, always visible)

`data-testid="resource-bar"`: chips for `🪙 treasury · 🫐 stall stock · 🪵 storehouse wood · 🪨 storehouse stone`, updated ~4 Hz, brief highlight pulse on change (scale/flash). Replay-aware (shows the fork's values).

## 2. Buildings are selectable (the big one)

- Raycast selection extends to place meshes (farms, stall, storehouse, forestry, quarry, well, homes, construction sites). Click → building panel replaces the agent inspector position (`data-testid="building-panel"`); agent click still wins when both hit; ESC/✕/empty-click deselects. Selection ring (existing style, larger radius) under the selected building.
- Panel contents by capability, not hardcoded per kind (drive from place data): header icon+name+owner (`commons` → "Village commons"); production progress bar when `production` exists (cycle % + output good icon); inventory as a **slot grid** (icon + count, `data-testid="slot"`, empty slots dimmed); worker roster when `jobSlots > 0` — filled slots as the worker's color chip + name (click → selects that agent), empty slots as dashed "Hiring" chips; wage line; for construction sites a **materials line** `🪵 8/12 · 🪨 4/6` + progress %.
- Building activity log tab/section: that place's events (haul arrivals, production, hires, purchases), latest 30, same row style as agent log.
- Bridge additive: `__simControl.selectPlace(id|null)`, `__simState.selectedPlaceId`, `__simState.placeIds`.

## 3. Agent inventory as slots + carrying visual

- In the inspector's Work tab (Dispatch L landed tabs — integrate cleanly): replace the text inv row with a **slot grid** (4 slots: icon + count badge; keep `data-testid="inv-row"` on the container).
- World-space: agents carrying goods show a small crate/sack on their back (one mesh, tinted by good: green=food, brown=wood, grey=stone) — driven by inventory contents, no sim change.

## 4. World-space indicators (billboarded, pooled like the F overlays)

- **Production progress ring** above farms/forestry/quarry while actively worked (thin radial SVG/HTML ring, % filled).
- **Material chips** above construction sites: `🪵 8/12 🪨 4/6` (compact pill), plus progress bar.
- **Hiring badge** over any workplace with a free job slot during 06:00–17:00: small bouncing `!` pill (reference-image style).
- **Ripe badge** over a farm whose inventory ≥ 5 (ready to haul).
- **Pickup/coin toasts**: on `goods:transfer` to an agent and wage/buy coin events, float `+1 🫐` / `+6 🪙` up from the subject for ~1.5s, pooled (max 8), driven from NEW events only while live (no replay backfill).

## 5. Hover tooltips (reference-image style)

Mouse hover (no click) over agent or building for > 150 ms → compact tooltip near cursor: agents `Mira · 👨‍🌾 Farmhand — Hauling 3 food → stall` (name, job icon+title, current doing incl. carried goods); buildings `Farm · 3 workers · ready in 2h`. Throttled raycast (~10 Hz), hidden while dragging. `data-testid="tooltip"`.

## Gates

1. `npm run build` exit 0; `npm run test` all pass (untouched); `npm run e2e` all pass; purity grep of `src/sim/` empty; `utilityBrain.ts` untouched; determinism tests still green (no state-shape changes).
2. New e2e (`e2e/info-layer.spec.ts`):
   - Resource bar renders 4 chips with numbers; values change after `ffwd` through a work day.
   - `selectPlace` a farm via bridge → building panel with roster + progress; clicking a roster chip selects that agent (`selectedAgentId` set).
   - Construction site (ffwd until `placeCounts['construction-site'] ≥ 1`) → materials line present.
   - Agent inventory slot grid renders with count badges.
   - Screenshots: `artifacts/info-layer-building.png` (farm panel open, hiring badge or progress ring visible), `artifacts/info-layer-site.png` (site with material chips). Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
