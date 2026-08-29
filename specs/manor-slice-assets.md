# Franconian Village Slice — Asset Production Plan

**Status:** Phases 0–6 built & QA'd (see `art/manor-slice/renders/ph6c_*.png`). Remaining polish + export listed at bottom.
**Owner:** main session (QA/direction) + subagent implementers
**Toolchain:** Blender 5.2 GUI + blender-mcp addon (TCP 9876) driven by `art/manor-slice/tools/blender_client.py`
**References:** `C:\Users\swapp\AppData\Local\Temp\opencode\ml-refs` (ml01–ml12, local analysis only — never commit)

## Legal / design principle

All geometry, UVs, and textures are **original work in the style of late-14th-century Franconian
vernacular architecture** — the same historical wellspring the game itself cites. No game files,
models, textures, screenshots, or audio are copied, ripped, or shipped. Reference images are used
privately for style comparison only. Historical architecture (steep thatch roofs, Fachwerk framing,
wattle hurdles, post mills) is public domain subject matter.

## Goal

One visually convincing **village-building vignette**: a short main street with burgage plots
(L1 thatch + L2 timber-frame), marketplace (3 stalls + stone well), wooden church with churchyard,
granary barn, forest ring, gardens/fences/props. Target: reads correctly at strategy-cam zoom AND
survives a near-ground inspection shot. Success gate = side-by-side render vs reference passes QA.

## Style bible (measured from reference set)

- **Character:** realistic-but-romanticized; medium poly density, realism carried by *textural*
  albedo/normal detail, not geometry. Nothing perfectly straight — sagging ridges, wandering fence
  rails, off-center doors, asymmetric gables. Roofs dominate silhouettes.
- **Scale:** human 1.7 m; L1 house ≈ 6×9 m footprint, eaves ~2.2 m, ridge ~5–6 m; roof pitch 45–55°.
- **Lighting:** low warm sun (~25° elevation, slightly orange-white), long soft shadows, cool
  blue-gray sky fill, pale desaturated blue sky, horizon haze/aerial perspective.
- **Palette (albedo targets):**

| Material | Hex |
|---|---|
| Grass summer | #7A8F4A (dry patches #9AA05A) |
| Forest canopy | #4A5F35 |
| Dirt road dry / mud | #B5A488 / #6E5B44 |
| Plaster whitewash / ochre | #E8E0CC / #D9B878 |
| Oak timber frame | #4A3826 (weathered #5C5142) |
| Thatch | #8A7A5E (eaves #5E5340, bleached #A99B7C) |
| Wood shingle (mossy gray-green) | #7C8378 |
| Clay tile | #9C5F3C → #8A4A38, mossy laps #6E705C |
| Fieldstone footing / mortar | #8C8578 / #A39B8B |

## Scene & file layout

```
art/manor-slice/
  tools/blender_client.py      # socket client for blender-mcp addon
  scenes/village.blend         # master scene (autosaved via client)
  export/gltf/                 # per-asset glTF exports (Y-up, +forward -Z)
  renders/                     # Eevee turntables + contact sheets (QA artifacts)
  scripts/phN_*.py             # idempotent build scripts executed via client
```

Naming: `fv_<category>_<name>[_vNN]` (fv = franconian village), collections mirror categories.
Units: meters, Z-up in Blender. Poly budget total < 800k tris scene-wide.

## Asset list

### Phase 0 — scaffold (gate: scene info reports collections + sun)
Collections `Terrain Buildings Environment Props Lookdev`; unit check; sun+sky rig (sun 25°,
azimuth SW, warm 5500K-ish, Nishita sky, haze); camera presets `cam_strategy` (35–45° pitch,
~40° FOV) and `cam_ground`.

### Phase 1 — ground layer (gate: top-down ortho render)
1. `fv_terrain_tile` — 140×140 m plane, subtle displacement (noise, ≤0.8 m amplitude),
   vertex-painted grass↔dirt blend zones reserved under roads/plots.
2. `fv_road_main` — spline-driven packed-dirt road strip (4–5 m wide), feathered edges
   (alpha-blended edge into grass), wheel-rut normal detail, mud pooling at future market node.

### Phase 2 — modular kit (gate: kit contact sheet)
1. Timber-frame kit: post/rail/brace profiles (150×150 mm oak), curved brace variant, sill beam.
2. Wall infill panels: whitewashed daub (slightly proud of frame), ochre variant, weathered variant.
3. Stone footing strips (1 course, irregular fieldstone, 30–40 cm tall).
4. Roof systems: thick soft-edged **thatch** (rounded ridge, sagging eaves, mossy patches) and flat
   **clay tile** (moss in laps); both parametric on gable/hip base meshes.
5. Doors/shutters/tiny unglazed windows (shutter variants).

### Phase 3 — buildings (gate: turntable each, silhouette check vs ml01/ml02/ml05/ml07)
1. `fv_burgage_l1` — one-cell hall: wattle-daub walls on stone footing, steep hipped thatch,
   2 tiny windows + shuttered door; yard add-ons (hay stack, small timber shed) as separate props.
2. `fv_burgage_l2` — two-bay gabled house: full oak frame w/ X + curved braces over cream plaster,
   wood-shingle roof, jetty option flag, brick chimney variant.
3. `fv_church_wooden` — whitewashed nave, very steep roof, shingled bell spire + simple cross,
   tiny lancet windows, picket-fence churchyard w/ gate.
4. `fv_granary_barn` — large gabled volume, vertical weathered planks, thatch, few openings.
5. `fv_market_stall` ×3 — open timber frame, hipped canopy: striped red/cream canvas, plain tan
   canvas, thatch; table goods variants (bread, cloth bolts).
6. `fv_well_stone` — stone drum, two-post windlass, small shingled roof, bucket.

### Phase 4 — environment (gate: scatter test render)
1. Trees: `fv_tree_oak` (blobby full canopy), `fv_tree_beech`, spruce accent — 2 LODs each
   (near = individual leaf clusters, far = low-poly card blob), autumn tint material variant.
2. Shrub clumps, wildflower patches (grass tufts with color variance).
3. Garden beds: raised dark-soil strips + cabbage rows (bright green heads) + feathery carrot tops.
4. Fences: `fv_fence_wattle` (sagging woven hurdles, L1 yards) + `fv_fence_picket` (pale, L2+).

### Phase 5 — props (gate: clutter pass render at doorways/wells/market only)
Barrel, firewood stack, hay pile, two-wheel handcart, trestle table, crates/bread/cloth bolts.
Clutter clusters at working edges (doors, wells, stall fronts), zero in decorative spots.

### Phase 6 — lookdev + assembly (final gate)
Layout street spine → plots → market → church → barn → forest ring (forest presses close as dark
backdrop wall, scattered trees INSIDE town). Render: strategy cam, ground cam, dawn warm light;
side-by-side contact sheet vs ml02/ml05/ml06/ml07. Iterate until palette/light/silhouette match.

## Execution model

- Implementer subagents author idempotent Python (`scripts/phN_*.py`) executed through
  `blender_client.py exec` against the live Blender MCP socket; they report measurements
  (poly counts, bounding boxes, render paths) as text. Main session spot-checks final renders only.
- Every script re-runnable from scratch: starts by purging its own collection prefix.
- Renders via Eevee Next, 1280×720, saved to `renders/`; client returns screenshot path for review.

## Out of scope (later)

glTF export → three.js import into luna-island renderer; LOD chains beyond 2 levels; seasons pack;
interiors; agents/animals rigs.

## Build log / next steps (as of 2026-08-24)

Built: terrain+road, kit (frame/infill/footings/thatch/tile/shingle roofs), 8 buildings (burgage
L1/L2, wooden church w/ bell-cot+spire, granary, 3 market stalls, well), oaks/beech/spruce, shrubs,
garden beds w/ cabbages, wattle+picket fences, props (barrels, firewood, hay, cart), village layout
along the road, sun/sky rig matched to palette. Scripts `scripts/ph*.py` are idempotent; master
scene `scenes/village.blend`.

Known polish items: gable-end framing on l2/church, hip-roof underside quad for l1 (fix returned
False), grass tuft/flower scatter layer, tree canopy refinement (reads "broccoli" near ground),
thatch clump bump could be stronger, forest ring to hide terrain edge, per-asset turntables.

Gotchas hit (for future delegates): building child meshes must be purged via parent relationship
(name-prefix purge left 514 orphans once — fixed in ph6c_cleanup.py); ShaderNodeMix RGBA needs
socket indices (6/7/2), not named 'A'/'B'/'Result'; 50° sun-facing slopes render ~2.3× albedo under
the low-sun rig (roof albedos are darkened accordingly); Blender 5.2 EEVEE = EEVEE Next
('BLENDER_EEVEE'), sky texture = SINGLE_SCATTERING (NISHITA renamed, blows out under Standard
transform — gradient sky used instead).
