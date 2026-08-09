# Dispatch D — Micro-fix: the rock slab

## Your role

SOLE IMPLEMENTER. Work synchronously, never spawn subagents, never run `git`, don't touch docs/specs. This is a surgical micro-dispatch: THREE items only, no other changes. All gates must stay green. Stop and report after 3 failed attempts on any item.

Working directory: `D:\MyProjects\Claude\luna-island`.

## QA evidence

In `artifacts/polish-day.png` the rock region renders as one enormous flat cold-grey slab left of the village — it reads as a parking lot, covers ~25% of the frame, and is the single worst visual in the scene.

## Items

1. **Shrink and warm the rock region.** `worldgen.ts`: raise the rock elevation threshold so rock covers ≤ 8% of land tiles (currently it's a huge contiguous region). `terrain.ts`: render rock tiles TERRACED — 2–3 elevation bands (box heights ~0.55 / 0.8 / 1.05 mapped from elevation) so it reads as a rocky hill, not a slab; warm stone palette `#9a938a` (upper) / `#837c72` (lower) instead of cold blue-grey; keep boulders on ~15% of rock tiles.
2. **Horizon band.** `polish-night.png`/`polish-day.png` top edge shows a pale band where the water plane meets the sky on the right. Make the water plane extend uniformly to the fog distance (or size the plane so its edge is beyond the fog far value) so the horizon is seamless in both day and night.
3. **Plaza seam (only if trivial).** The plaza disc floats a hair above the terrain/paths; drop it flush (small y epsilon above ground, no gap shadow). Skip if not trivially safe.

## Gates

`npm run build` exit 0 · `npm run test` all pass · `npm run e2e` all pass · fresh `artifacts/polish-day.png` + `artifacts/polish-night.png` (regenerate via the existing flow) · purity grep of `src/sim/` empty.

## Final report

**BUILT / GATES (evidence) / DEVIATIONS / KNOWN GAPS** — same structure as before, brief.
