# Dispatch N2 — Juice layer: hats, tools, crop stages, celebrations, portrait dock

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report.

**Scope guard — RENDER/UI ONLY.** Zero `src/sim/` changes of any kind this dispatch (not even selectors). `utilityBrain.ts` and every sim file byte-identical; all animation state lives renderer-side, derived per frame from world state + events. Determinism untouched by construction.

Working directory: `D:\MyProjects\Claude\luna-island`.

## What this dispatch adds

The life layer that makes the economy *feel* like the games it now reads like: job hats, tool swings, crop growth stages, celebration moments, sleeping Zzz, and the reference-image portrait dock.

## 1. Job hats (drive from `employedAt` place kind)

Small head-top meshes tinted per job, matching our low-poly look: farm = straw brim (flat cone, `#e0c068`), stall = kerchief (small box, `#c94f4f`), forestry = cap (halfsphere, `#3d7d46`), quarry & construction site = helmet (halfsphere, `#c9b52a`). Appear/disappear on hire/vacate; sleeping pose keeps the hat on (charm).

## 2. Tool theater (pure renderer flavor over the same world rules)

While an agent performs `work`:
- **Farm:** hoe mesh (stick + blade) swings in a ~1 Hz arc; agent leans into it.
- **Forestry:** agent faces the NEAREST tree mesh within 2 tiles (renderer picks it), axe swings; on each swing apex the tree shakes (rotation jitter ~3°, 200 ms) and 3–4 wood-chip particles puff (tiny brown triangles, pooled).
- **Quarry:** pick swings at the rock face; grey chip particles + a brief spark dot.
- **Construction site:** hammer bobs; faint knock-dust puff at the frame.
- **Haul leg:** no tool; the existing carry sack + slight forward lean sells it.
All animation phase offsets per agent (hash of id) so crews don't sync. Tools are 2-3 primitive meshes each, pooled/shared geometry.

## 3. Crop stages (replace continuous scaling)

4 discrete stages by farm `growth`: <0.25 bare tilled rows; <0.6 sprouts (tiny green cones); <0.9 leafy bushes (green spheres); ≥0.9 golden-ripe (amber tint + slight sway). Stage swap with a 200 ms pop-scale. Ripe badge (N1) still applies to inventory ≥ 5.

## 4. Celebration moments (event-driven, pooled, live-only like toasts)

- `construction:*complete`/new home: sparkle burst (8–12 star particles) + the house pops in with a 300 ms overshoot scale.
- `goods:produced` at a farm (harvest mint): small green burst above the plot.
- `relationship:close`: brief twin-hearts float over the pair if both on screen.

## 5. Sleeping Zzz + collapse tell

Sleepers emit a slow drifting "Z" glyph every ~2 s (pooled HTML overlay, same system as toasts). Collapsed agents get a red-tinted pulse on their body material until recovery.

## 6. Portrait dock (reference-image style, bottom-left above the ticker)

Toggleable row (persist open state in-memory only): one chip per villager — colored circle "head" + job mini-emoji badge + first letter (or name on hover via existing tooltip). Click = select + follow that agent (existing follow mechanics). Chips tint red while collapsed, dim while asleep. Two rows of 12; `data-testid="portrait-dock"`, chips `data-testid="portrait"`. Ticker collapses to make room if needed.

## Gates

1. `npm run build` exit 0; `npm run test` all pass (39/39, untouched); `npm run e2e` all pass; purity grep + `git status --porcelain src/sim/` shows NOTHING (no sim edits at all).
2. New e2e (`e2e/juice.spec.ts`): portrait dock renders 24 chips; clicking one sets `selectedAgentId` and follow mode; ffwd to work hours → at least one hat mesh exists (expose via a DEV-gated `window.__renderProbe = { hats, tools, particles }` counter object — render-side only, fine to add).
3. Screenshots: `artifacts/juice-work.png` (working farm/quarry closeup with hats + tools + progress rings — pick camera via OrbitControls target), `artifacts/juice-night.png` (sleeping village, Zzz visible), `artifacts/juice-dock.png` (portrait dock open). All non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.
