# Luna Island — Five-Phase Resource Landscape Implementation Plan

**Status:** Proposed for review

**Created:** August 30, 2026

**Research basis:** [`audit-reports/2026-resource-landscape-research.md`](../audit-reports/2026-resource-landscape-research.md)

**Primary visual reference:** [`art/age1/age1-resource-map-v1.png`](../art/age1/age1-resource-map-v1.png)

## Purpose

This plan turns the approved 2026 resource-landscape research into five implementation phases. Its goal is a naturalistic, readable, simulation-faithful island whose resource regions, work, depletion, destruction, and eventual recovery remain understandable from close inspection through strategic overview.

The plan is specifically for resource landscapes and their integration with the current town simulation. It does not replace the colony roadmap or construction-realism plan.

## Decisions locked before planning

The following user decisions govern every phase:

1. **Art direction:** Move toward *Manor Lords*-style naturalism. Preserve Luna's authored composition and warmth, but favor believable terrain response, irregular boundaries, restrained materials, and settlements that grow into the landscape.
2. **Regrowth:** Do not use simple automatic wild-resource replenishment in the early phases. Realistic destruction, recovery, and regrowth arrive later, after depletion and land use are truthful.
3. **Water:** New water systems are out of scope. Retain the existing sea and shoreline presentation, but do not add streams, ponds, irrigation, hydrology, water resources, water simulation, or water-dependent fertility in this plan.
4. **Scale:** Each phase must increase both visible complexity and the size of the validation scene.
5. **Renderer authority:** `/town` becomes the canonical product renderer. The resource-rendering portion may be reconstructed where that is simpler and safer than extending the current split implementation. The legacy renderer is not a compatibility target; useful behavior may be migrated from it.

## Governing outcome

At completion, a player should be able to look at Luna Island with all overlays disabled and understand:

- Where the forests, stone, clay, wild food, fiber, and fertile land are.
- Which regions are abundant, actively worked, partially depleted, exhausted, damaged, or recovering.
- How roads, workplaces, carriers, stockpiles, and buildings relate to those resources.
- How human use has changed the landscape over time.

Exact quantities and routes should be available contextually, but the world must carry the first layer of explanation itself.

## Architectural rules shared by all five phases

### Simulation owns truth

- Resource type, position, capacity, stock, lifecycle, destruction, and recovery are deterministic simulation state.
- Three.js code reads simulation state; it never creates a second authoritative stock or lifecycle.
- New resource behavior remains in the pure TypeScript simulation with no Three.js or React dependency.
- Every lifecycle transition that matters to replay or diagnosis emits a deterministic event.

### Resource regions are logical entities, not loose decoration

A resource region needs stable identity even when its visible members are rendered through shared instance buffers.

The intended model is:

- **Resource field:** a stable, seeded region with an ID, resource kind, cells, aggregate capacity, renewal policy, and generation metadata.
- **Resource cell/source:** an accessible location within the field with stock, capacity, lifecycle state, and deterministic visual seed.
- **Fertility field:** a non-gatherable land property represented independently from resource stock.
- **Visual members:** renderer-owned trees, rocks, shrubs, grasses, stumps, scars, and dressing derived from field and cell state.

Exact type names may follow existing project conventions, but the ownership boundary must remain intact.

### `/town` is canonical

- Build the new resource landscape under `src/town/` and integrate it through the existing town boot and loop.
- Do not maintain feature parity in two product renderers.
- Migrate the legacy renderer's useful stock-driven behavior into the new system.
- Keep the legacy path available only as a temporary diagnostic until the new town path passes parity gates; removal is a separate, explicitly reviewed cleanup.

### Batching is mandatory

- Do not create one standalone scene object per tree, rock, reed, shrub, stump, or ground detail.
- Preserve logical selection through field/cell IDs and instance metadata.
- Share geometry and materials within a resource family.
- Plan close, gameplay, and overview representations from the first renderer contract.

### Existing spatial rules remain authoritative

- Resource members sample the existing town terrain-height function.
- Place footprints, paths, and reserved construction clearance exclude or thin resource members deterministically.
- Simulation walkability and gathering access remain grid-based unless a separate navigation change is approved.
- Save, replay, and deterministic world generation must remain compatible through an explicit migration/version strategy.

### Water remains outside the work

- Existing coastline and sea rendering may receive compatibility fixes necessary for terrain integration.
- No new water body, water resource, irrigation, wetland simulation, river generation, or water overlay redesign is included.
- Fiber and fertility placement must not depend on an unimplemented hydrology system.

## Scale ladder

The counts below are validation fixtures rather than permanent gameplay caps.

| Phase | Validation world | Active population | Resource/activity target | Time horizon |
|---|---:|---:|---|---:|
| **1. Truthful Resource Slice** | Controlled resource lab plus current town seed | 7 settlers | Timber, stone, and wild food; at least 12 active source cells | 3 sim days |
| **2. Authored Island Landscape** | Full 48×48 island | 7 settlers | Six readable land-resource categories and full-island dressing | 7 sim days |
| **3. Working Settlement Landscape** | Full 48×48 island with developed village | 24 settlers | Concurrent gathering, hauling, storage, and production feedback | 30 sim days |
| **4. Destruction and Living Recovery** | Full island under sustained use | 64 settlers | Multiple depleted, destroyed, replanted, and recovering fields | 90 sim days |
| **5. Commercial Presentation and Scale** | Full-density acceptance world | 150 settlers | Maximum intended landscape and settlement density | 180 sim days; 300-settler stress fixture |

If later profiling proves a fixture unrealistic, change the number transparently before implementation rather than silently weakening the gate.

---

## Phase 1 — Truthful Resource Slice

### Player-visible outcome

On the current town seed, timber, stone, and wild-food sources visibly move from abundant to partial to depleted as villagers work them. The amount shown by selection and overlays matches the simulation. Depleted tree and stone silhouettes no longer remain falsely full.

The art may still be greybox or use the current assets. Truthful state change is the phase's visual payoff.

### Why this phase comes first

The current simulation already depletes stock, but `/town` builds static tree instances and never refreshes them. Adding richer art before repairing this contract would multiply rework and preserve misleading world state.

### Simulation work

- Introduce the stable resource-field/resource-cell model for the three existing wild resource families:
  - Timber from forest sources.
  - Stone from rock sources.
  - Wild food from berry sources.
- Provide a deterministic compatibility conversion from current forest/rock tile stock and berry-bush places.
- Move gathering lookup and stock mutation behind a resource-domain API rather than branching directly on terrain kind throughout the tick loop.
- Preserve existing gathering time, carry capacity, occupancy, hauling, and goods events unless a migration requires an explicit adjustment.
- Remove autonomous wild-resource replenishment from normal Phase 1 behavior:
  - Timber does not automatically return.
  - Stone is finite.
  - Wild berries do not automatically refill.
- Keep cultivated farm production working; crop production is not classified as wild-resource regrowth.
- Ensure the founding scenario remains viable through existing farm and stored-food systems. Test-only or development fixtures may stock supplies, but release simulation state must not hide infinite wild replenishment.
- Emit or normalize events sufficient for presentation and replay:
  - Resource gathered.
  - Resource state changed.
  - Resource depleted.
  - Field aggregate changed.
- Version snapshots and serialized worlds so old terrain stock can be migrated or rejected with an explicit message.

### Renderer reconstruction

- Add one canonical `ResourceLandscapeRenderer`-style subsystem under `src/town/`.
- Give it a narrow contract:
  - Build deterministic visual membership from resource fields.
  - Apply dirty state updates after simulation ticks.
  - Map cell lifecycle and stock ratio to visible state.
  - Expose field/cell identity for selection without standalone meshes.
  - Dispose all shared GPU resources correctly.
- Migrate the useful stock-driven tree/boulder scaling behavior from `src/render/terrain.ts`, but do not preserve its implementation structure merely for compatibility.
- Replace the current static `TownTrees` integration or make it an internal provider of the new subsystem. There must be one town resource update path by the phase gate.
- Use instanced rendering for repeated members.
- Provide three deterministic state representations for the slice:
  - Abundant: full member density and intact anchors.
  - Partial: reduced member visibility or scale plus worked-edge cues.
  - Depleted: no harvestable silhouette; persistent non-resource evidence such as stumps, low rubble, or bare source ground.
- Do not implement regrowth visuals yet.

### Resource lab

Create a dedicated deterministic resource-landscape lab rather than overloading the construction lab.

The lab must provide:

- Resource-kind selector.
- Abundant, partial, and depleted checkpoints.
- Stock slider that modifies fixture state through the same mapping used by `/town`.
- Close, gameplay, and overview camera presets matching the town camera's useful distance bands.
- Instance, draw-call, triangle, and frame-time display.
- Fixed seed and screenshot-stable lighting.
- Toggle for collision/path/building-footprint exclusions.

The lab is a verification route, not a separate renderer architecture.

### Information layer

- Replace sampled resource rings for these three resource families with complete field-aware selection data.
- Phase 1 may retain simple visuals, but every visible field must report exact stock and capacity when selected.
- Ensure a depleted field is not reported as abundant by any overlay or inspector.

### Expected code areas

- `src/sim/types.ts`
- A focused resource-domain module under `src/sim/`
- `src/sim/worldgen.ts`
- Gathering and regrowth sections of `src/sim/sim.ts`
- `src/town/main.tsx`
- `src/town/loop.ts`
- `src/town/trees.ts` or its replacement
- New resource renderer modules under `src/town/`
- `src/town/worldOverlays.ts`
- New resource-lab entry point, scene, state, and HTML route
- Deterministic simulation, renderer-state, and lab tests

### Explicitly out of scope

- Final naturalistic art.
- Clay, fiber, or fertility.
- Realistic regrowth or destruction commands.
- New production chains.
- New water behavior.
- Distant impostors or final texture compression.

### Phase 1 gates

- Gathering one timber, stone, or berry source visibly changes its resource geometry within the next rendered simulation update.
- Abundant, partial, and depleted screenshots are distinguishable without UI.
- Selected field stock exactly matches the sum of its authoritative sources.
- No wild source automatically replenishes during a 3-day fixture.
- Old deterministic gathering, hauling, terrain-height, and replay tests remain green after migration.
- A saved/replayed depletion sequence produces the same field IDs, stock, instance membership, and screenshots.
- The controlled slice maintains 60 FPS median on the current development machine with metrics recorded, not estimated.

---

## Phase 2 — Authored Island Landscape

### Player-visible outcome

The full 48×48 island reads as an authored, naturalistic landscape rather than threshold-colored tiles. Forest, stone, clay, wild food, fiber, and fertile ground each form recognizable regions with irregular edges, terrain relationships, negative space, and distinct overview silhouettes.

The settlement remains small so the phase can prove island composition before dense activity obscures it.

### Art direction

Use *Manor Lords* as the naturalism reference, not as a photorealism requirement:

- Believable scale and spacing.
- Irregular resource boundaries.
- Subdued but differentiated earth and vegetation materials.
- Forest edge, clearing, slope, and worksite logic.
- Ground transition and terrain response.
- No oversized fantasy resource icons or evenly repeated clusters.

Preserve Luna's stronger strategic color grouping and authored island silhouette so resources remain more readable than realism alone would permit.

### Resource vocabulary

Expand the land-resource vocabulary to:

- **Timber:** forest fields with canopy core, irregular edge, clearings, and accessible gathering cells.
- **Stone:** finite exposed formations on higher or visibly eroded terrain.
- **Clay:** finite earth deposits represented by exposed red/brown ground, banks, low cuts, and compact extraction areas.
- **Wild food:** berry/shrub fields concentrated at forest margins and open grass pockets.
- **Fiber:** wild grass or fibrous-plant fields on suitable open ground; no water dependency.
- **Fertile land:** non-gatherable soil quality shown as irregular dark or rich-ground regions suitable for cultivation.

Do not create a water resource category.

### Semantic generation

- Replace isolated threshold results with a deterministic field-generation pass operating on the existing island terrain.
- Use rules rather than unrestricted random scatter:
  - Timber favors contiguous mid-elevation land and avoids exposed rock cores, settlement clearance, and shore sand.
  - Stone favors high elevation, steeper transitions, and ridge-like areas.
  - Clay favors lower, gentler exposed ground but does not require simulated water.
  - Wild food favors forest edges, clearings, and moderate grassland.
  - Fiber favors open grassland and transition bands.
  - Fertility favors contiguous gentle grass terrain and avoids rock, sand, and heavily worn land.
- Generate stable field centers, boundary cells, accessible work edges, and internal density gradients.
- Prevent the plaza and opening settlement from being enclosed by dense resources.
- Preserve at least one strong authored landmark or hero formation in each major seed used for visual acceptance.
- Add generation diagnostics to the resource lab: field boundaries, suitability score, rejected cells, and placement seed. These diagnostics remain development-only.

### Naturalistic visual grammar

Build a compact representative asset grammar before producing a large library:

- Forest canopy anchors plus smaller edge trees and understory.
- Several rock anchor silhouettes plus satellites, talus, and ground blending.
- Clay ground material/decal family, exposed faces, loose earth, and sparse props.
- Berry/shrub clumps with readable fruit or flower accents that do not depend only on color.
- Fiber stands with a different vertical rhythm from ordinary grass.
- Fertile-ground material and low dressing that remain readable without an overlay.

Each family requires:

- At least three meaningful silhouette variants for its repeated dominant member.
- Deterministic rotation, scale, spacing, and material-family variation.
- A clear edge treatment and a clear cluster core.
- At least one hero anchor form for large fields where appropriate.
- Shared materials and batched/instanced rendering.

### Three camera bands

- **Close:** individual members, ground transitions, edge props, and material variation.
- **Gameplay:** cluster outline, density, anchor silhouette, and terrain relationship.
- **Overview:** continuous color/value mass and simplified anchor representation; actionable fields remain visible.

Phase 2 may use simple geometric or density LODs. Final impostor production belongs to Phase 5, but the representation interface and distances must already exist.

### Settlement and path integration

- Paths create deterministic clear corridors rather than clipping through dense members.
- Building placement removes or reserves visual members through the same field/cell IDs used by simulation.
- Workplaces sit at believable resource edges and do not erase the identity of the field they exploit.
- Existing ground wear and path decals blend with resource-edge dressing without z-fighting.

### Information layer

- Add exact field boundaries to the resource overlay.
- Add a fertility overlay backed by actual fertility data rather than plaza distance and elevation sampling.
- Resource type and abundance must remain readable with overlays off; overlays provide precision rather than compensation.

### Explicitly out of scope

- Autonomous regrowth.
- Sapling, stump-decay, or land-recovery simulation.
- Intentional clear-cut/destroy commands beyond the minimum building/path exclusion required for placement.
- Dynamic seasons or weather effects on resources.
- New water terrain or water influence.
- Final atmosphere and final GPU compression.

### Phase 2 scale target

- Full 48×48 island.
- All six land-resource categories present in the visual-acceptance seed.
- Seven active settlers.
- Seven-day deterministic run.
- At least two large and two small fields in the representative landscape, without obvious grid repetition.

### Phase 2 gates

- Forest, stone, clay, wild food, fiber, and fertile land are correctly identified in at least 90% of two-second gameplay-distance screenshot trials.
- Every category remains identifiable at close, gameplay, and overview camera presets.
- No core resource relies solely on hue.
- No large field shows an obviously repeated cluster arrangement within one gameplay-distance frame.
- Paths, initial buildings, and gathering access do not intersect visible members incorrectly.
- Fertility overlay covers all authoritative fertile cells and agrees with field selection.
- The world remains compositionally readable with all overlays off.
- Full-island normal view records 60 FPS median and p95 frame time at or below 20 ms on the declared development profile, or produces a documented blocker before Phase 3 asset growth.

---

## Phase 3 — Working Settlement Landscape

### Player-visible outcome

The naturalistic island becomes visibly productive. Players can watch villagers enter a field, work a specific source, carry recognizable goods, deliver them to a workplace or storage building, and see both the source and destination change. A selected resource exposes its complete immediate chain without turning the normal world into a permanent debug view.

### Simulation integration

- Connect all Phase 2 gatherable field types to the existing worker, cargo, hauling, storage-filter, production, and event systems.
- Preserve current economic rules unless a new resource needs a minimal raw-good registration.
- Add `clay` and `fiber` as raw goods only when their storage, hauling, and at least one real demand or reservation path are defined. Do not introduce decorative goods with no systemic use.
- Use existing construction demand where it is a truthful consumer for stone, timber, or clay.
- Use existing food storage/market/consumption for wild food.
- If no legitimate fiber consumer exists, keep fiber as a visually identified future field and defer gathering rather than invent a shallow production chain.
- Expose field, source, reservation, carrier, destination, and consumer IDs in traceable events.
- Ensure multiple workers claim compatible source cells without standing on or targeting the same inaccessible point.

### Gathering presentation

- Workers approach accessible field edges or work positions grounded in simulation navigation.
- The worked source displays a large, readable action cue appropriate to the resource:
  - Timber: chopping motion, controlled tree/felling transition, chips or brief debris.
  - Stone: striking motion, small debris/dust, worked-face change.
  - Clay: digging motion, exposed cut, earth pile.
  - Wild food: picking motion and clump reduction.
  - Fiber: cutting/gathering motion and stand reduction.
- Effects must be pooled, instanced, short-lived, and subordinate to the cluster silhouette.
- Carried cargo must be recognizable at gameplay distance through shape plus restrained color/material coding.

### Workplaces and storage

- Forestry, quarry, food gathering, and any enabled clay/fiber workplace gain naturalistic edge placement and large function cues.
- Storage buildings show coarse fill state through visible piles or bay occupancy without rendering every inventory unit.
- Inputs, outputs, and reserved/in-transit amounts are distinct in inspection data.
- Workplace idle states communicate a cause from authoritative simulation data.

### Contextual information design

Replace permanent ring-heavy feedback with layered contextual tools:

- **Normal view:** resource silhouette, workers, cargo, pile fill, work effects.
- **Hover:** resource type, coarse abundance, current work state.
- **Selection:** exact stock/capacity, finite or renewable policy, assigned workers, reservations, destination, and immediate consumer.
- **Resource overlay:** all visible fields, type, abundance class, and depletion progress.
- **Route mode:** selected source-to-carrier-to-storage/consumer paths only.
- **Ownership/workplace mode:** which workplace claims or services a field.

Overlay markers must respect terrain height and camera occlusion and must not cover the resource form they explain.

### Town-scale integration

- Validate the renderer in a developed 24-person town rather than only the resource lab.
- Test resource visibility behind buildings, status icons, smoke, agents, and HUD overlays.
- Ensure important cluster anchors remain visible at overview distance even after settlement expansion.
- Resource exclusion and destruction caused by new construction remain deterministic; permanent ecological consequences are deferred to Phase 4.

### Performance work

- Add dirty-field updates so stock changes do not rebuild all instance buffers.
- Pool temporary work effects and cargo visuals.
- Ensure overlay activation does not create a mesh per field cell.
- Record render cost with active workers and overlays, not only in a static island.
- Treat simulation, pathfinding, and renderer frame budgets as one acceptance profile.

### Explicitly out of scope

- Automatic wild-resource recovery.
- Replanting, succession, stump decay, or land reclamation.
- Fire, storm, disease, or combat destruction.
- Water gathering or water-influenced production.
- Full manufacturing trees for clay or fiber unless separately approved.
- Final cinematic atmosphere.

### Phase 3 scale target

- Full 48×48 island.
- 24 active settlers.
- At least three resource families gathered concurrently.
- At least two storage destinations and one downstream consumption or construction demand active.
- Thirty-day unattended deterministic run.

### Phase 3 gates

- A reviewer can trace `source → worker → carried good → destination → consumer` without opening more than one additional panel.
- Every blocked chain exposes a concrete reason such as inaccessible source, no worker, full destination, invalid filter, or absent consumer.
- World geometry, selected quantities, storage UI, event trace, and production history agree after depletion and delivery.
- Context overlays cover 100% of relevant visible fields without arbitrary sampling.
- The normal view remains readable with overlays off and does not require persistent icons.
- Twenty-four settlers can gather and haul concurrently for 30 days with no stock duplication, negative inventory, stale claim, or replay divergence.
- Normal acceptance view maintains 60 FPS median and p95 frame time at or below 20 ms on the declared profile; activating the resource overlay introduces no main-thread stall above 50 ms.

---

## Phase 4 — Destruction and Living Recovery

### Player-visible outcome

Long use leaves history in the land. Forests are felled into stumps and clearings; some recover through nearby seed trees or deliberate replanting. Wild-food and fiber fields return under suitable conditions. Stone and clay do not magically regrow: exhausted sites retain scars, spoil, or worked ground. Construction and intentional clearing visibly transform resource regions rather than silently deleting decoration.

This is the phase where Luna's landscape becomes alive over time rather than simply switching between full and empty.

### Lifecycle rules

Define explicit lifecycle policies by resource family.

#### Timber

Recommended lifecycle:

`mature → worked/felled → stump → cleared or decaying → sapling → young → mature`

Rules:

- Felling yields timber and creates a persistent stump or fallen-material state.
- Automatic return is not a fixed universal timer.
- Natural regeneration requires an eligible seed source within a declared range, suitable non-occupied land, and no destructive land use.
- Forester replanting can create saplings deliberately when labor and any required input are available.
- Saplings and young trees are vulnerable to path/building clearing and do not provide mature yield.
- Dense recovery occurs over sim years or an explicitly compressed but believable game timescale, not days.

#### Wild food

Recommended lifecycle:

`fruiting → harvested → dormant → budding → fruiting`

Rules:

- Harvesting removes yield but normally preserves the plant.
- Destructive clearing removes the plant and prevents automatic return until land becomes eligible and a propagation rule succeeds.
- Seasonal presentation may be used only if it matches the existing calendar and does not require a new weather system.

#### Fiber

Recommended lifecycle:

`ready → cut → short/dormant → recovering → ready`

Rules:

- Recovery requires the field cell to remain undeveloped and unworn beyond a threshold.
- Repeated overharvest may lengthen recovery or reduce capacity.
- No water dependency is introduced.

#### Stone and clay

Recommended lifecycle:

`intact → worked → reduced → exhausted`

Rules:

- Stone and clay are finite.
- Exhaustion leaves a persistent naturalistic scar: low quarry cut, rubble, spoil, compacted earth, or exposed face.
- Cosmetic reclamation may soften the scar over long periods or through labor, but it does not restore extractable stock.
- Any future deep mine or imported supply is outside this plan.

#### Fertility

- Fertility remains a land property, not a resource that pops back on a universal timer.
- Construction, heavy path wear, or extraction can permanently suppress it while occupied.
- Fallow recovery or cultivation improvement may be supported through a slow deterministic rule if it does not require water simulation.
- The overlay and terrain material must remain synchronized with any change.

### Intentional destruction

Add explicit, traceable environmental transformation rather than renderer-side deletion:

- Building or path placement identifies affected resource cells before confirmation.
- The player sees what will be removed, what can be salvaged, and whether the loss is permanent or recoverable.
- Confirmed construction emits deterministic resource-destruction or clearing commands/events.
- Workers clear resources physically when the construction system requires labor; instant clearing is reserved for development tools or deliberately defined small dressing.
- Clearing releases claims and reservations safely.
- Destroyed cells remain part of field history even when no longer harvestable.
- Regrowth cannot occur beneath buildings, paths, active work yards, or incompatible terrain state.

This phase does not add disasters. “Destruction” means land clearing, extraction, overuse, and construction impact.

### Visual lifecycle system

- Add deterministic visual sets for stump, sapling, young tree, dormant shrub, short fiber, worked face, rubble, clay cut, spoil, and reclaimed ground.
- Transition visuals use stable source/cell seeds so replay does not reshuffle the field.
- Long transitions may use discreet interpolation or crossfade, but the authoritative stage changes only on simulation ticks.
- Distant representations preserve the aggregate field state even when individual lifecycle members are omitted.
- A recovering field should look uneven and age-structured rather than repopulate all members at once.

### Long-horizon observability

- Field inspection shows lifecycle policy, estimated next eligible transition, blockers, seed/replant source, and historical change.
- Town statistics include fields depleted, cells destroyed, cells replanted, recovering capacity, and permanent finite-resource loss.
- Timeline/replay exposes major environmental events without logging every cosmetic member update.
- Overview mode can compare intact, worked, exhausted, damaged, and recovering land.

### Determinism and save behavior

- Lifecycle eligibility and transition timing are derived from deterministic state and seeded randomness recorded through events where necessary.
- Replays never re-roll which cells recover.
- Save migration preserves already depleted Phase 1–3 fields without granting free regrowth.
- Long-run tests verify stock conservation, no recovery under structures, no finite-resource regeneration, and no orphaned field claims.

### Explicitly out of scope

- Fire, flood, storms, pollution, disease, combat damage, and natural disasters.
- Dynamic water or rainfall simulation.
- Fully simulated soil chemistry.
- New mines, imports, or infinite late-game extraction.
- Ecosystem wildlife simulation.

### Phase 4 scale target

- Full 48×48 island.
- 64 active settlers.
- At least three concurrently worked forest fields.
- At least one exhausted stone or clay field.
- At least one deliberate clearing for construction.
- At least one replanted and visibly age-structured recovering field.
- Ninety-day unattended run plus accelerated multi-year lifecycle fixtures.

### Phase 4 gates

- Timber recovery requires a valid seed source or deliberate replanting; deleting every mature source prevents natural recovery.
- Stone and clay never regain extractable stock.
- Construction clearing is previewed, confirmed, simulated, visible, replayable, and reflected in field totals.
- Abundant, worked, destroyed, exhausted, and recovering screenshots are correctly ordered in at least 90% of blinded trials.
- A recovering forest displays mixed lifecycle stages rather than a simultaneous full reset.
- No resource regrows beneath a building, path, quarry yard, or incompatible occupied cell.
- A 90-day 64-settler run produces no divergent replay, negative stock, duplicate yield, stale claim, or lifecycle deadlock.
- Long-horizon fixture results are stable across repeated runs with the same seed.

---

## Phase 5 — Commercial World Presentation and Scale

### Player-visible outcome

The full island and mature town reach a commercially presentable naturalistic standard. Resource regions remain readable through dense settlement growth, active logistics, atmosphere, and all camera distances. The world feels authored and historically changed, while the renderer sustains the target population and a deliberate 2× stress case.

This phase is not a late “add polish” bucket. It completes the asset, lighting, LOD, density, and performance work whose contracts were established earlier.

### Final naturalistic art pass

- Replace greybox or provisional resource members with approved naturalistic assets.
- Establish coherent world scale, trunk and canopy proportions, rock mass, shrub size, grass height, and workplace dimensions.
- Use restrained earth and vegetation materials with sufficient strategic separation between resource families.
- Add authored hero formations and intentional negative space so the island does not read as uniformly procedural.
- Break hard terrain boundaries with ground blending, litter, understory, talus, disturbed earth, path shoulders, and sparse transitional dressing.
- Preserve visible work history: stumps, clearings, worked faces, spoil, compacted yards, regrowth, and recovered ground.
- Ensure settlements appear nested into resource edges and terrain rather than placed on an unrelated decorative layer.

### Repetition control

- Expand approved silhouette, material, and density variants only after Phase 2–4 grammar has proven readable.
- Add deterministic cluster templates for different field sizes and terrain conditions.
- Prevent identical hero-anchor combinations in the same gameplay-distance view.
- Use controlled asymmetry, edge thinning, age variation, clearings, and landmark placement rather than unconstrained random noise.
- Add screenshot analysis fixtures that flag repeated transforms, repeated anchor combinations, and excessive uniform density.

### Full camera-band rendering

#### Close band

- Highest approved mesh LOD.
- Ground transitions, stumps, crop/fiber condition, quarry/clay cuts, cargo, and work effects.
- Limited high-quality shadows near the camera and selected activity.

#### Gameplay band

- Instanced mid-LOD members and simplified effects.
- Cluster silhouette and field state remain dominant.
- Cargo and large workplace actions remain visible; minor dressing is culled.

#### Overview band

- Coarse cluster geometry, impostors, sprites, or merged field forms as profiling supports.
- Resource type and aggregate state remain visible through mass, pattern, and anchor silhouette.
- No actionable field disappears solely because its close members are culled.

Use hysteresis at every transition to prevent flicker and camera-distance thrashing.

### GPU and asset pipeline

- Use shared geometries and materials by resource family.
- Use texture atlases where they reduce material switches without destroying material quality.
- Generate mipmaps and compressed KTX2 textures for approved assets.
- Use chunk or field visibility to avoid updating and drawing off-camera landscape members.
- Pool particles, dust, chips, and temporary work effects.
- Limit real-time shadow casting by distance, importance, and LOD.
- Use baked, vertex, or flipbook motion for repeated ambient movement when skeletal animation is unnecessary.
- Track asset bounds, triangle count, material count, texture dimensions, compressed size, and GPU residency in a manifest or build report.

### Lighting and atmosphere

Tune the existing ACES, fog, sun, sky, ambient light, GTAO, and shadow foundation toward naturalistic readability:

- Grounded contact and tree-understory shadow without crushed black forest interiors.
- Directional light that reveals slopes, quarry faces, and forest edges.
- Controlled atmospheric perspective that separates foreground, settlement, and island backdrop.
- Subtle plant movement and work effects that make active areas feel alive.
- Restrained bloom and glare.
- Time-of-day profiles that preserve resource identification at dawn, midday, dusk, and night where night play is supported.
- Quality presets that adjust shadow distance, ambient occlusion, dressing density, and impostor distance without changing simulation state.

No new weather or water simulation is added.

### Environmental density without clutter

- Protect clear space around paths, doors, work edges, storage yards, and important buildings.
- Use dressing-density masks so every square meter is not equally decorated.
- Establish a screen-space clutter budget for icons, cargo, effects, dressing, and status markers.
- Contextual overlays fade or simplify when the camera enters overview mode.
- Selected-resource information has priority over ambient status icons.

### Accessibility and readability

- Every resource and lifecycle state uses at least two of silhouette, value, pattern, material, motion, and icon.
- Validate resource and fertility overlays under common color-vision deficiency simulations.
- Preserve readable contrast under every time-of-day profile.
- Provide an optional stronger strategic-color setting without changing the naturalistic base presentation.

### Final performance and stress program

Declare the target hardware profile before final acceptance and record browser, resolution, GPU, CPU, and device-pixel ratio.

Normal acceptance scene:

- Full 48×48 island.
- 150 active settlers.
- Mature settlement at maximum intended density.
- All resource families and lifecycle states represented.
- Concurrent gathering, hauling, construction demand, storage, overlays, day/night lighting, and work effects.

Stress scene:

- Same island and visual density.
- 300 active settlers.
- Doubled concurrent carriers/work effects where possible.
- Resource overlay active during camera traversal.

Required instrumentation:

- Median and p95 frame time.
- Main-thread long tasks.
- Simulation tick and pathfinding time.
- Renderer calls, triangles, instances, and visible chunks.
- GPU texture memory estimate and asset residency.
- Overlay activation time.
- Dirty resource-field update time.
- Save/load and replay reconstruction time for the long-running world.

### Visual acceptance program

- Fixed screenshots at close, gameplay, and overview distances for the full island and each resource lifecycle.
- Side-by-side concept and runtime composition review.
- Manor-Lords-reference review focused on natural scale, irregular boundaries, terrain integration, and authored settlement form—not literal photorealism.
- Blinded two-second resource recognition tests.
- Blinded lifecycle ordering tests.
- Camera-traversal capture to inspect LOD pop, z-fighting, floating dressing, shadow changes, and overlay occlusion.
- Browser-visible happy-path inspection in `/town`; the resource lab alone cannot pass this phase.

### Phase 5 gates

- Forest, stone, clay, wild food, fiber, and fertile land achieve at least 90% two-second identification at gameplay distance with overlays off.
- Abundant, worked, partial, depleted/exhausted, destroyed, and recovering states achieve at least 90% correct ordering where applicable.
- No resource relies on hue alone.
- No actionable field disappears at any supported camera distance.
- LOD transitions produce no silhouette jump larger than approximately 10 screen pixels and do not flicker during small camera movements.
- Normal acceptance scene reaches 60 FPS median with p95 frame time at or below 20 ms at 1920×1080 on target hardware.
- The 300-settler stress fixture reaches 30 FPS median with p95 frame time at or below 33.3 ms.
- Camera traversal and overlay toggling produce no main-thread stall above 50 ms.
- Resource-landscape rendering adds no more than approximately 3 ms combined CPU/GPU time in the normal acceptance scene compared with the same scene's controlled no-resource-render baseline.
- A selected source can be traced through worker, cargo, destination, and consumer in one contextual workflow.
- All deterministic simulation, replay, save migration, browser smoke, visual-regression, and performance-budget checks pass.
- Final `/town` screenshots visibly demonstrate the concept image's authored resource hierarchy while meeting the approved naturalistic direction.

---

## Cross-phase test matrix

| Test area | P1 | P2 | P3 | P4 | P5 |
|---|:---:|:---:|:---:|:---:|:---:|
| Resource stock determinism | ✓ | ✓ | ✓ | ✓ | ✓ |
| Save/replay migration | ✓ | ✓ | ✓ | ✓ | ✓ |
| Visual state synchronized to stock | ✓ | ✓ | ✓ | ✓ | ✓ |
| Full-island cluster generation |  | ✓ | ✓ | ✓ | ✓ |
| Three camera bands | Contract | ✓ | ✓ | ✓ | Final |
| Gathering/haul/storage trace | Existing compatibility |  | ✓ | ✓ | ✓ |
| Regrowth and destruction |  |  |  | ✓ | ✓ |
| Screenshot recognition tests | Slice | ✓ | ✓ | ✓ | Final |
| Resource lab regression | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/town` browser inspection | ✓ | ✓ | ✓ | ✓ | Final |
| Performance fixture | Slice | Full island | 24 settlers | 64 settlers | 150/300 settlers |

## Definition of done for every phase

A phase is complete only when all of the following are true:

- Its player-visible outcome is demonstrated in the real `/town` route.
- Its simulation behavior is deterministic and replayable.
- Its resource and UI state agree in the same captured scenario.
- Relevant unit, integration, and browser tests pass.
- A fixed visual fixture and screenshot set exist.
- Performance metrics were recorded against the phase's scale target.
- New diagnostics remain development-only and do not leak into normal player presentation.
- Files outside the phase's scope were not refactored without a documented necessity.
- Known limitations and deferred work are recorded before the next phase begins.

## Risks requiring active control

### Renderer reconstruction becomes a general rewrite

Control: reconstruct only resource landscape, terrain integration points, and required overlay/selection adapters. Preserve working camera, lighting, place, agent, and HUD systems unless a measured dependency requires change.

### Early finite resources destabilize the town

Control: preserve cultivated farms, validate founding supplies, and use explicit test fixtures. Do not quietly restore infinite wild regrowth to mask balance problems.

### Naturalism reduces strategic readability

Control: require screenshot-recognition gates with overlays off and preserve a stronger strategic-color accessibility option.

### Asset density outruns browser performance

Control: enforce instance/shared-material contracts in Phase 1, full-island profiling in Phase 2, active-town profiling in Phase 3, and do not wait until Phase 5 to discover per-object architecture.

### Regrowth becomes a universal timer again

Control: lifecycle policy is resource-specific. Timber requires seed or planting; wild plants require eligible land; stone and clay never regenerate.

### Renderer and simulation state diverge

Control: renderers consume resource snapshots/events, visual fixtures assert state mapping, and no renderer-owned stock is permitted.

### Scope expands into water, weather, or ecosystem simulation

Control: keep water and disasters explicitly excluded. Any such work requires a separate reviewed proposal.

## Final handoff produced by this plan

Completion should leave the repository with:

- A deterministic first-class resource-field model.
- One canonical `/town` resource renderer.
- A dedicated resource-landscape lab using the same renderer.
- Naturalistic, semantically placed land-resource fields.
- Truthful depletion, destruction, finite extraction, and realistic later recovery.
- Visible gathering, cargo, storage, and contextual route feedback.
- Three camera-band representations and a scalable asset pipeline.
- Fixed visual, lifecycle, replay, and performance fixtures.
- A full-density town scene meeting the measurable commercial quality bar.

This plan intentionally leaves new water systems, disasters, deep mining, imports, wildlife ecology, and unrelated economy expansion for separate review.
