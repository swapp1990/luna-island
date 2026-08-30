# 2026 Resource Landscapes and World Presentation Research

**Project:** Luna Island

**Research cutoff:** August 30, 2026

**Status:** Research complete; awaiting review

**Scope guard:** This document deliberately does not define a five-phase plan or implementation specification.

## Contents

1. [Executive conclusion](#executive-conclusion)
2. [Benchmark matrix](#1-benchmark-matrix)
3. [Reference-game findings](#2-reference-game-findings)
4. [Visual-reference board](#3-annotated-visual-reference-board)
5. [Dominant industry techniques](#4-dominant-industry-techniques-and-patterns)
6. [Luna Island current-state audit](#5-luna-island-current-state-audit)
7. [Quality gap](#6-quality-gap)
8. [Measurable quality bar](#7-proposed-measurable-final-quality-bar)
9. [Architectural constraints](#8-architectural-constraints)
10. [Candidate capabilities](#9-candidate-capabilities-for-eventual-planning)
11. [Open questions and risks](#10-open-questions-risks-and-tradeoffs)
12. [Sequencing considerations](#11-evidence-based-sequencing-considerations)

## Method and evidence labels

The benchmark set was selected from current games rather than assumed in advance. Selection weighted:

- Commercial reach or strong player adoption.
- Visual quality.
- Resource and logistics depth.
- Active development in 2025–2026.
- Relevance to a persistent, authored island settlement.

Statements labeled **Sourced observation** come from official sites, developer documentation, update notes, developer-hosted wikis, press kits, or official footage. Statements labeled **Design conclusion** are interpretations for Luna Island and should not be treated as claims made by the source developers.

## Executive conclusion

The strongest 2026 resource landscapes do not depend primarily on raw asset count. They align four systems:

1. **Semantic placement:** resources grow where terrain, water, soil, and biome logic imply they should.
2. **Embodied state:** abundance, work, depletion, damage, and recovery alter the visible world.
3. **Layered readability:** silhouettes carry normal gameplay; precise icons and overlays appear only when requested.
4. **Scalable activity:** workers, cargo, storage, and production remain traceable without rendering every object independently.

Luna Island already has a useful deterministic simulation, explicit hauling legs, instanced trees, continuous terrain, broad overlay modes, and rendering instrumentation. Its largest gap is that the current `/town` resource geometry does not faithfully project simulation state. A forest can be depleted in the simulation while its tree silhouette remains unchanged.

The supplied concept image establishes a compelling authored target, but the runtime is several presentation layers behind it.

## 1. Benchmark matrix

| Game | 2026 qualification | Strongest benchmark role | Luna relevance | Main caution |
|---|---|---|---|---|
| **Anno 117: Pax Romana** | Major 2025 release with 2026 content; Ubisoft reports bookings ahead of comparable-period *Anno 1800* | Commercial visual finish, distinct island biomes, dense production cities, atmospheric dressing | Highest final-presentation benchmark | AAA asset, crowd, lighting, and effects budget is not reproducible literally |
| **Manor Lords** | Extremely prominent town builder, actively updated in 2026 | Naturalistic terrain, irregular settlement form, vegetation and historical landscape integration | Strong aesthetic reference for an authored island | Realism can hide information; UE5 techniques carry high production cost |
| **Farthest Frontier** | 1.0 in 2025; Crate reports more than one million copies | Renewable-versus-finite ecology, overlays, farming, water table, hauling and storage | Strongest broad resource-system reference | Survival-system and UI density would overload Luna if copied wholesale |
| **Foundation** | 1.0 in 2025; substantial 2026 farming and festival development | Gridless growth, modular buildings, visible logistics, organic settlement macroform | Excellent reference for towns growing around terrain | Natural-resource silhouettes are less prominent than settlement presentation |
| **Pioneers of Pagonia** | 1.0 in December 2025; active through Update 1.4 in July 2026 | Thousands of visible residents, physical goods, procedural islands, silhouette iteration | Closest logistics-and-life presentation reference | Fine detail merges at overview distance; full scope is excessive for Luna |
| **Timberborn** | 1.0 in March 2026; more than one million copies | Water-driven terrain state, drought, irrigation, vertical construction, large-map optimization | Strongest terrain/resource-state coupling reference | Dynamic 3D fluid and deformable terrain would be disproportionately expensive |
| **Against the Storm** | Two million copies reported in 2026; active through Update 1.10.4 | Compact resource-node language, fog/glade composition, depletion overlays, hauler configuration | Strongest information-design reference | Roguelite resets and node disappearance are poor matches for a persistent island |

This is not a universal genre ranking. It is the set that collectively covers Luna's visual, ecological, logistical, and technical problem.

## 2. Reference-game findings

### 2.1 Anno 117: Pax Romana

#### Why it qualifies

*Anno 117* is the upper commercial bar for an island-based production city. Ubisoft's FY26 reporting says its bookings outpaced *Anno 1800* at the equivalent point, while the game continued into 2026 content such as *Prophecies of Ash*.

Sources: [official game page](https://www.ubisoft.com/en-us/game/anno/117-pax-romana), [Ubisoft FY26 Q3 report](https://staticctf.ubisoft.com/8aefmxkxpxwl/2fF3sBktllOX6jrLXUgKci/64d1bdb0998fd5403b32e5329ec01c6c/Ubisoft_FY26_Q3_PR_EN.pdf).

#### Sourced observations

- Latium and Albion have different landforms, vegetation, weather, resources, and construction constraints. Albion's marshes visually and mechanically support products such as eels and reeds. [Official gameplay reveal](https://news.ubisoft.com/en-us/article/5LeMPCkCcizfyVQbbVWtkj/anno-117-pax-romana-first-gameplay-revealed), [Albion development article](https://www.ubisoft.com/en-gb/game/anno/117-pax-romana/news-updates/6OI1RbOWR1NsMK1OpzHuXy/the-final-countdown-phase-3-brings-us-closer-to-launch).
- Islands are designed around coastlines, fertility, buildable space, elevation, resources, and landmarks rather than being interchangeable platforms. [Official island-design brief](https://www.anno-union.com/community-contest-design-an-island-for-latium/).
- Ubisoft documents baked flipbook effects, instancing, normal distortion, color ramps, lights, shadows, vertex animation, and shader-controlled destruction as production tools. [Official technical-art devblog](https://www.anno-union.com/devblog-fire-and-destruction-the-job-of-a-technical-artist/).
- Accessibility options explicitly address readability, contrast, text, input, and presentation. [Accessibility spotlight](https://news.ubisoft.com/en-us/article/2FfSSEUp1jtg9isC9NxowP/anno-117-pax-romana-accessibility-spotlight).

#### What it does especially well

It makes biome, coast, industry, streets, population, and distant skyline feel like one art-directed composition. Dressing is hierarchically distributed: landmarks, shore activity, vegetation masses, roads, civic structures, smoke, and crowds form focal areas.

#### Weaknesses or unsuitable techniques

Luna should not treat *Anno 117*'s density as a minimum asset count. Its crowds, animation library, cinematic effects, console optimization, and environment-production budget are beyond the appropriate scope of a Three.js town builder.

#### Transferable principle

Treat each resource region as part of an island composition: approach silhouette, shoreline relationship, landmark, neighboring settlement use, and distant color mass all matter.

### 2.2 Manor Lords

#### Why it qualifies

*Manor Lords* remains the leading naturalistic reference for a settlement that appears to have grown from the landscape rather than been stamped onto it. Its official pages emphasize organic city building, seasonal landscapes, and detailed production. [Official site](https://manorlords.com/), [Steam page](https://store.steampowered.com/app/1363080/Manor_Lords/).

#### Sourced observations

- Regions contain normal and rich deposits; stone and clay are extractive, berries and wildlife replenish under conditions, and deep rich mining can support long-lived extraction. [Resources](https://wiki.hoodedhorse.com/Manor_Lords/Resources/en), [regions](https://wiki.hoodedhorse.com/Manor_Lords/Regions/en).
- Farming uses fertility information, crop rotation, seasonal sowing and harvest, and irregular player-defined fields. [Field reference](https://wiki.hoodedhorse.com/Manor_Lords/Field).
- Workers, oxen, carts, roadside markets, production yards, loose stock, and storage buildings embody the supply chain. [Buildings reference](https://wiki.hoodedhorse.com/Manor_Lords/Buildings/en).
- Update documentation describes environmental changes and resource behavior. Its Unreal Engine transition introduced virtual shadow maps, volumetric atmosphere and clouds, and GPU LOD work for instanced components. [Update 0.8.050](https://wiki.hoodedhorse.com/Manor_Lords/0.8.050_-_Main), [official UE5 patch discussion](https://steamcommunity.com/app/1363080/discussions/0/4434443557916093138/?ctp=2).

#### What it does especially well

Field boundaries, roads, tree lines, streams, topography, work yards, and building setbacks combine into believable settlement geometry. Repetition is reduced through irregular footprints and landscape-dependent placement rather than excessive decorative variants alone.

#### Weaknesses or unsuitable techniques

Photorealistic vegetation and materials can make resources hard to distinguish without overlays. Luna should not inherit the GPU cost, asset-detail requirements, muted palette, or historical literalism.

#### Transferable principle

Use irregular boundaries and landscape-responsive placement, but strengthen resource silhouettes and color hierarchy beyond what a realism-first treatment permits.

### 2.3 Farthest Frontier

#### Why it qualifies

Crate Entertainment reports more than one million copies, and the 2025 1.0 release remains one of the genre's deepest integrations of ecology, gathering, farming, storage, and town survival. [Crate Entertainment](https://www.crateentertainment.com/about/), [official 1.0 announcement](https://forums.crateentertainment.com/t/farthest-frontier-v1-0-is-now-available/149600).

#### Sourced observations

- Resources are biome-dependent. Trees regrow from surviving mature trees; clear-cutting affects recovery. Stone is finite. Fishing grounds can deplete and recover. [Resource guide](https://www.farthestfrontier.com/guide/gameplay/resources/).
- Crop fertility, rotation, weeds, disease, weather, orchards, grazing, and soil management form a renewable food landscape. [Farming guide](https://www.farthestfrontier.com/guide/gameplay/farming/).
- Separate overlays expose fertility, crop suitability, grazing, irrigation, ore, clay, sand, and other spatial questions. [Overlay guide](https://www.farthestfrontier.com/guide/information/overlays/).
- Goods are physically transported and stored. Specialized storage, production limits, worker assignment, town reports, and annual statistics diagnose the chain. [Town Center](https://www.farthestfrontier.com/guide/information/town-center/), [annual report](https://www.farthestfrontier.com/guide/information/annual-report/).
- The game advertises randomized maps, dozens of raw and processed goods, and more than 180 buildings. [Major features](https://www.farthestfrontier.com/guide/about/major-features/).

#### What it does especially well

It clearly distinguishes renewable, conditionally renewable, and finite resources. Ecological consequences are visible over time rather than treating gathering nodes as timeless decorations.

#### Weaknesses or unsuitable techniques

Its overlay count, survival threats, soil variables, and production interfaces can become work rather than discovery. Luna does not need every ecological variable exposed independently.

#### Transferable principle

Every resource should answer: where does it occur, what reduces it, whether it returns, what prevents recovery, and where its output goes.

### 2.4 Foundation

#### Why it qualifies

*Foundation* reached 1.0 in January 2025 and remained active through substantial 2026 agriculture, livestock, orchard, and festival work. Its gridless growth and modular architecture make it especially relevant to authored-but-organic town form. [Official 1.0 release](https://www.polymorph.games/foundation/news/2025/01/31/foundation-full-release/), [official news](https://www.polymorph.games/foundation/news/).

#### Sourced observations

- Villagers form paths through repeated movement; zoning and modular construction allow settlements to grow around terrain rather than a global street grid. [Foundation reference](https://wiki.polymorph.games/foundation/Foundation), [zones](https://wiki.polymorph.games/foundation/Zones).
- The resource panel distinguishes stored, market, production, and in-transit quantities. Players can track a resource across buildings and carriers. [Resource logistics](https://wiki.polymorph.games/foundation/Resource_Logistics), [resource tracking](https://wiki.polymorph.games/foundation/Resources).
- Storage hubs use configurable slots and mediate distribution rather than acting as abstract global inventories.
- Quarries are assembled around a deposit and alter the activity silhouette of the location. [Quarry reference](https://wiki.polymorph.games/foundation/Quarries).
- 2026 material shows orchards, vegetables, livestock, cider, and festival spaces integrated with settlement form. [Croft animals](https://www.polymorph.games/foundation/news/wp-content/uploads/2026/04/CroftAnimals.jpg), [orchard](https://www.polymorph.games/foundation/news/wp-content/uploads/2026/04/Orchard.jpg), [festival overview](https://www.polymorph.games/foundation/news/wp-content/uploads/2026/04/FestivalTopView.jpg).
- Developer material discusses LODs, mipmaps, and texture streaming so high-resolution resources outside the active view can be unloaded. [Development news](https://www.polymorph.games/foundation/news/category/dev-news/).

#### What it does especially well

Movement itself authors the town. Roads, workplaces, housing, gathering territory, and public spaces gradually explain why the settlement has its shape.

#### Weaknesses or unsuitable techniques

Its resources can be visually quiet compared with its buildings. Repeated modular components can become apparent when rooflines, heights, and materials converge.

#### Transferable principle

Let labor paths and land use produce visible settlement history, while preserving stronger resource-region silhouettes than Foundation typically requires.

### 2.5 Pioneers of Pagonia

#### Why it qualifies

The game reached 1.0 in December 2025 and continued through the 1.4 editor and quality-of-life update in mid-2026. It supports more than 60 building types, more than 100 commodities, and settlements of up to roughly 3,000 residents with production steps visible. [Official fact sheet](https://pioneersofpagonia.com/assets/pdf/Pioneers_of_Pagonia_1-0_FactsheetEN.pdf), [1.4 update](https://store.steampowered.com/news/app/2155180/view/698768548504273087).

#### Sourced observations

- Developers explicitly describe hundreds of visible units, buildings, and resources as a readability problem. Buildings are iterated using unique silhouettes, functional props, different footprints, material breakup, height, and orientation.
- Examples include a Forester built around a tree, a Geologist Hut associated with a rocky cliff and visible sediment, a larger Guild Hall with an emphasized clocktower, and a Wood Workshop with stronger forestry cues. [Developer art/readability post](https://store.steampowered.com/news/posts/?enddate=1739454680&feed=steam_community_announcements).
- Geologists discover subsurface resources and leave signs communicating findings. Forest removal and replanting affect animal repopulation; obsolete mine signs are removed after depletion.
- Fish schools, driftwood, branches, flax, reeds, beaches, sediment transitions, cliffs, tree occlusion, and biome plants embed resources in geography. [Economy/environment update](https://store.steampowered.com/news/app/2155180/view/605284704070931751).
- Warehouses expose configurable piles, priorities, presets, fill-state-aware distribution, production history, and unit statistics. [Economy update](https://store.steampowered.com/news/app/2155180/view/4150701564157618175).
- Developer notes document additional LODs, reduced VRAM use, and render improvements for scenes with many physical piles.

#### What it does especially well

Its busy-world quality comes from production steps, carriers, work animations, and goods being present, not merely from ambient NPC wandering. Its documented silhouette iterations are unusually concrete evidence of commercial readability work.

#### Weaknesses or unsuitable techniques

Thousands of visible agents and more than 100 commodities would create unnecessary scope. Tiny workflow details also disappear at overview zoom.

#### Transferable principle

Show only the work that explains the system. Give every major workplace a functional silhouette and one or two large activity cues that survive normal gameplay distance.

### 2.6 Timberborn

#### Why it qualifies

*Timberborn* launched into 1.0 in March 2026 after exceeding one million copies. It is the closest reference for terrain whose water and resource state directly reshape settlement geometry. [Official launch release](https://mechanistry.com/press/lumberpunk-city-builder-timberborn-launches-into-1-0-with-new-features-bonus-content-more), [Steam page](https://store.steampowered.com/app/1062090/Timberborn/).

#### Sourced observations

- Update 7 made terrain fully three-dimensional, supporting caves, tunnels, overhangs, roofs, platforms, and cultivation on stacked surfaces. [Update 7](https://store.steampowered.com/news/app/1062090/view/5444796730017065402).
- Water has depth, flow, spill, pressure, waterfalls, aqueduct layers, and variable power output. Pumps, tanks, dams, valves, floodgates, and reservoirs manipulate it. [Official 1.0 feature post](https://store.steampowered.com/news/app/1062090/view/579383283382486203).
- Irrigation visibly makes soil green and arable. Aquatic plants require water; drought dries rivers; badwater is red and causes plants to wither.
- Interface work includes resource counts separated into storage, input, and output; connected-network highlights; layer views; transparent-water controls; planting and cutting areas; and status icons adapted to vertical occlusion.
- The 2025 visual update added clouds, stars, bloom, stronger plant motion, contrast changes, water glare, skybox work, and lighting-distance tuning. [Visual-update feed](https://store.steampowered.com/news/posts/?appgroupname=Timberborn&appids=1062090&enddate=1762426913).
- An official 2025 patch reported roughly 15–30% higher frame rates following the move to 3D terrain and work on large maps. [Performance/update feed](https://store.steampowered.com/news/posts/?appgroupname=Timberborn&appids=1062090&enddate=1751450804).

#### What it does especially well

Water depth and quality lead to soil color, crop survival, forest survival, food, power, storage, and ultimately city shape. The environment is a readable simulation substrate rather than decorative biome dressing.

#### Weaknesses or unsuitable techniques

Voxel-like terrain, vertical industrial megastructures, toxic-water pressure, and full fluid simulation are not natural fits for Luna's painterly island concept.

#### Transferable principle

Even without fluid simulation, water proximity and condition should visibly explain fertile ground, wetlands, food, routes, and settlement opportunity.

### 2.7 Against the Storm

#### Why it qualifies

Official 2026 announcements report two million copies sold, and development continued through the July 2026 Over-Haulers Update. It is the clearest reference for communicating a large resource vocabulary through compact silhouettes and overlays. [Announcement hub](https://steamcommunity.com/app/1336490/announcements/), [Update 1.10](https://steamcommunity.com/games/1336490/announcements/detail/677376450273219168).

#### Sourced observations

- Settlements begin in a small glade surrounded by dense forest. Unopened glade geometry remains visible through fog while its contents are unknown.
- Different tree families have distinct forms, yields, and cutting times. [Devlog archive](https://wiki.hoodedhorse.com/Against_the_Storm/Updates_and_Devlog).
- Deposits have small or large charge pools. Harvesting consumes charges; exhaustion removes the deposit. Fertile soil, by contrast, can support renewable farming indefinitely. [Gathering reference](https://wiki.hoodedhorse.com/Against_the_Storm/Gather_Resources).
- Camp and farm placement reveals ranges, nearby resources, fertile soil, and marked trees. Production buildings show relationships to ingredient sources. [Buildings reference](https://wiki.hoodedhorse.com/Against_the_Storm/Buildings).
- Update 1.7 added town and workplace production statistics. Update 1.10 added depletion progress to the resource overlay and configurable warehouse haulers that prioritize product versus ingredient movement, building priority, and larger stacks. [QoL 1.7](https://store.steampowered.com/news/app/1336490/view/543349435614101535), [Update 1.10](https://eremitegames.com/overhaulers-update-1-10/).
- Horizontal mirroring and irregular building footprints were added specifically to make settlements more visually varied.

#### What it does especially well

The player can distinguish dense atmosphere from exact information. Forest mass and fog establish mood; placement mode and overlays expose precise quantities and ranges only when needed.

#### Weaknesses or unsuitable techniques

Complete deposit disappearance, heavy fog gating, glade reveals, and settlement resets conflict with a persistent island intended to accumulate history.

#### Transferable principle

Normal play should read from silhouettes and activity. Exact quantities, ranges, depletion progress, and route logic should appear contextually rather than remain permanently overlaid.

## 3. Annotated visual-reference board

| Reference | Visual examples | What to inspect |
|---|---|---|
| **Luna concept** | [Age 1 resource map](../art/age1/age1-resource-map-v1.png) | Warm authored island silhouette; forest masses; mountain-backed stone; reddish clay; berry/fertile/wetland clusters; freshwater-to-coast integration |
| **Anno 117** | [Gameplay trailer](https://www.youtube.com/watch?v=S8G9VCHS1xQ) · [gameplay reveal](https://news.ubisoft.com/en-us/article/5LeMPCkCcizfyVQbbVWtkj/anno-117-pax-romana-first-gameplay-revealed) | Commercial density; differentiated biomes; shore activity; skyline hierarchy; atmospheric depth |
| **Manor Lords** | [Settlement screenshot](https://images.squarespace-cdn.com/content/v1/5eb98d54a2c9a8275e6de2ab/1593537230556-FTFS9E7I4303JUAFQ4ZU/HighresScreenshot00025.png) · [terrain screenshot](https://images.squarespace-cdn.com/content/v1/5eb98d54a2c9a8275e6de2ab/1593537406907-Z5EOZPX457IFKKPNJD6T/HighresScreenshot00156_smaller.jpg) | Irregular roads and fields; vegetation masses; ground variation; town nestled into topography |
| **Farthest Frontier** | [Launch trailer](https://www.youtube.com/watch?v=TZeFRZFAk2Y) · [settlement image](https://forums.crateentertainment.com/uploads/default/original/3X/d/0/d035d8a254d5039da208ccee9b865ddb782e1946.jpeg) | Resource ecology; fields and orchards; forest edges; extractive sites; high-system-density readability |
| **Foundation** | [Launch trailer](https://www.youtube.com/watch?v=gifRDUkchCQ) · [orchard](https://www.polymorph.games/foundation/news/wp-content/uploads/2026/04/Orchard.jpg) · [festival overview](https://www.polymorph.games/foundation/news/wp-content/uploads/2026/04/FestivalTopView.jpg) | Gridless macroform; path-authored growth; modular variation; agriculture embedded in settlement |
| **Pioneers of Pagonia** | [4K press kit](https://www.pioneersofpagonia.com/press.php) · [1.0 trailer](https://www.youtube.com/watch?v=Dfbxs-NH4tc) · [screenshot](https://www.pioneersofpagonia.com/assets/screenshots-carousel/screenshot_01.jpg) | Dense animated logistics; visible goods; procedural coastlines; building silhouettes |
| **Timberborn** | [Update 7 trailer](https://www.youtube.com/watch?v=6va1hQxqkLA) · [1.0 water post](https://store.steampowered.com/news/app/1062090/view/579383283382486203) | Water-to-soil feedback; drought and contamination; vertical layers; environment-driven city form |
| **Against the Storm** | [Launch trailer](https://www.youtube.com/watch?v=MtA1BAeeOAE) · [gathering reference](https://wiki.hoodedhorse.com/Against_the_Storm/Gather_Resources) · [placement overlays](https://wiki.hoodedhorse.com/Against_the_Storm/Buildings) | Forest-wall silhouettes; controlled fog; node charges; range overlays; finite versus renewable distinction |

### Luna concept-image observations

The concept already displays several benchmark-grade compositional ideas:

- Resources occur in clusters, not isolated icons.
- Forest, stone, fertile ground, food shrubs, wetlands, and probable clay have different silhouettes and ground relationships.
- Mountain ridges frame the stone region.
- Reeds and light vegetation connect food or fiber to water.
- Freshwater and coastline divide the island into readable environmental regions.
- Warm resource and settlement opportunities sit against cooler sea and distant mountains.

It does not demonstrate runtime depletion, regrowth, gathering, hauling, storage, production, overlay clarity, procedural repetition, or performance.

## 4. Dominant industry techniques and patterns

### 4.1 Semantic resource placement

The leading games do not distribute resources with one global random threshold:

- *Farthest Frontier* links deposits, wildlife, vegetation, and water to biome and ecological conditions.
- *Timberborn* makes water elevation and quality determine soil and plant viability.
- *Manor Lords* combines regional deposits with fields, woodland, and wildlife.
- *Against the Storm* uses biome-specific trees, deposits, and glade contents.
- *Pagonia* embeds reeds, flax, driftwood, fish, scree, sediment, and mines in corresponding landforms.

### 4.2 Large silhouette first, detail second

At normal gameplay distance, resources are read through:

- Forest edge and canopy mass.
- Boulder or cliff profile.
- Ground hue and texture.
- Crop-row or orchard rhythm.
- Wetland reeds and reflective water.
- Mine, quarry, forestry, or fishing activity.

Small icons and props reinforce those forms but do not create them.

### 4.3 Embodied abundance and state

Common visual-state mechanisms include:

- Fewer or smaller resource elements.
- Cut stumps, dead vegetation, empty ground, excavation, or removed nodes.
- Changed soil color or plant vitality.
- Depletion bars or charge rings in contextual overlays.
- Workers and carts ceasing activity.
- Replanting, saplings, new growth, or replenishing fauna.

The state of the art keeps world geometry, animation, quantities, and UI in agreement.

### 4.4 Renewable and finite resources differ visibly

Forests, crops, berries, fisheries, and wildlife usually have conditional recovery. Stone, ore, clay, and sand are more often finite or require exceptional late-game extraction. *Against the Storm* makes the distinction explicit between finite deposits and indefinitely worked fertile soil.

### 4.5 Three zoom bands

- **Close:** material, animation, props, visible goods, stumps, crop stages.
- **Gameplay:** cluster silhouette, worksite activity, terrain boundary, carrier motion.
- **Overview:** color mass, canopy density, field pattern, icon, overlay, or map mark.

A single high-detail mesh representation is not sufficient across all three.

### 4.6 Logistics as world animation

The strongest settlements make logistics visible through worker destination, carried cargo, carts, physical piles, storage fill, smoke, active machinery, crop harvesting, and production histories. Pagonia is the most extensive example; Foundation and Manor Lords make the same chain legible at a smaller scale.

### 4.7 Overlays answer one question

Good overlays are temporary and specific:

- Where is this resource?
- How much remains?
- Where is fertile soil?
- What can this building reach?
- Where is water influence?
- Which warehouse or producer owns this flow?
- Why is a worker or building idle?

The world remains attractive with overlays off.

### 4.8 Constrained procedural variation

Repetition is reduced using combinations of:

- Several silhouette families.
- Rotation, scale, spacing, and lean.
- Irregular cluster boundaries.
- Terrain-conditioned placement.
- Material or color variants.
- Negative space and clearings.
- Hero formations or landmarks.
- Footprint, orientation, and height variation.

Uniform random scattering is insufficient.

### 4.9 Rendering patterns

Available primary material consistently supports:

- GPU instancing for repeated assets.
- Static batching or merged geometry.
- Multiple LODs with hysteresis.
- Distant sprites, billboards, or impostors for vegetation.
- Texture atlases and shared materials.
- Mipmaps and texture streaming.
- Compressed GPU textures.
- Chunk- or visibility-based culling.
- Limited dynamic-shadow distance.
- Baked or flipbook animation for repeated effects.

These align with Three.js guidance: [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [optimizing many objects](https://threejs.org/manual/en/optimize-lots-of-objects.html), [LOD](https://threejs.org/docs/pages/LOD.html), [texture memory and atlases](https://threejs.org/manual/en/textures.html), and [KTX2 textures](https://threejs.org/docs/pages/KTX2Loader.html).

### Design conclusions for Luna

- Use hero 3D geometry for cluster anchors and worked sites.
- Use instanced variations for close and gameplay-distance foliage, stones, reeds, and ground details.
- Use coarser clusters, sprites, or impostors at overview distance.
- Keep selection and simulation identity separate from individual mesh identity so batching remains possible.
- Use atmosphere to reinforce state without reducing resource contrast.

## 5. Luna Island current-state audit

### 5.1 Simulation and resource model

#### Sourced local observations

- [`src/sim/types.ts`](../src/sim/types.ts) defines five terrain kinds: `water`, `sand`, `grass`, `forest`, and `rock`. Tiles include elevation, walkability, path state, and optional `gatherStock`.
- The current goods vocabulary is `food`, `wood`, and `stone`.
- Tiles, places, agents, inventories, event logs, snapshots, and replay logs are part of deterministic `WorldState`.
- [`src/sim/worldgen.ts`](../src/sim/worldgen.ts) builds a fixed 48×48 island from radial falloff and two-octave value noise. Terrain is classified by elevation thresholds and a separate forest-noise threshold.
- World generation places the plaza in the largest grass region, Forestry at a forest edge, Quarry beside rock, and berry bushes as individual place entities.
- [`src/sim/sim.ts`](../src/sim/sim.ts) gives forest and rock six units of stock. Gathering takes 12 ticks per unit and agents carry three.
- Forest maps to wood and rock maps to stone. Gathering decrements stock and emits `goods:produced`.
- Forest and rock both regrow one unit at the berry-regrowth interval, capped at six.
- The simulation implements explicit fetch, haul, and deliver legs with agent cargo state and destination storage.

#### Design conclusion

The simulation already contains enough logistics structure to support meaningful resource feedback. Its taxonomy and lifecycle rules are too narrow for the concept image, and renewable stone is a major unresolved product decision.

### 5.2 `/town` route

#### Sourced local observations

- [`src/town/main.tsx`](../src/town/main.tsx) creates the simulation, WebGL renderer, camera, terrain, lighting, assets, places, trees, agents, and overlays.
- [`src/town/loop.ts`](../src/town/loop.ts) updates agents, overlays, places, terrain wear, lighting, and rendering after simulation ticks.
- One tile equals three meters. The island is 144 meters square. Camera distance ranges from 18 to 150 meters.
- [`src/town/terrain.ts`](../src/town/terrain.ts) builds one continuous shared-corner heightfield with vertex colors, a large transparent water plane, shallow shoreline instances, and player-path decals.
- [`src/town/trees.ts`](../src/town/trees.ts) creates one to three deterministic tree instances per forest tile and one `InstancedMesh` per tree variant/submesh.
- [`src/town/assets.ts`](../src/town/assets.ts) caches GLTF templates, bakes tree submeshes, and clones place assets.
- [`src/town/places.ts`](../src/town/places.ts) visualizes farm growth, storehouse stock, tier changes, production smoke, and staged construction.
- [`src/town/lighting.ts`](../src/town/lighting.ts) enables ACES tone mapping, PCF soft shadows, a 2048² shadow map, fog, sky and hemisphere lighting, GTAO, day/night updates, and render-call/triangle reporting.

### 5.3 Critical renderer consistency gap

The legacy renderer in [`src/render/terrain.ts`](../src/render/terrain.ts) contains stock-driven forest-tree and boulder scaling. `/town` uses the separate tree system in `src/town/trees.ts`; those instances are built once and have no update method. The town loop never refreshes them after gathering or regrowth.

Consequences in the current `/town` route:

- Forest depletion changes simulation stock and overlays.
- Tree silhouettes do not visibly thin or regrow.
- Rock or boulder visuals do not visibly deplete or recover.
- Resource state and resource appearance can diverge.

This is the most significant resource-visual consistency risk.

### 5.4 Overlays and information visualization

[`src/town/worldOverlays.ts`](../src/town/worldOverlays.ts) supports `needs`, `housing`, `jobs`, `resources`, `fertility`, `water`, `ownership`, and `paths`.

Current limitations:

- The resource overlay shows only a sampled subset of forest and rock tiles, approximately one in five, plus rings around resource-related places.
- Fertility is a presentation heuristic: walkable grass near the plaza, subsampled every third tile, colored mainly by elevation.
- Fertility is not currently a simulated field property.
- The water overlay marks wells and springs but does not represent water terrain or influence.
- Resource rings are categorical and sampled rather than a continuous abundance representation.

### 5.5 Lab architecture

- [`src/town/constructionLabMain.tsx`](../src/town/constructionLabMain.tsx) mounts a standalone lab.
- [`src/town/constructionLabScene.ts`](../src/town/constructionLabScene.ts) creates an isolated synthetic Three.js scene, ground pad, camera, and lighting.
- [`src/town/constructionLabState.ts`](../src/town/constructionLabState.ts) creates deterministic foundation, frame, wall, roofing, and completion states.
- [`test/construction-lab.test.ts`](../test/construction-lab.test.ts) verifies the three house blueprints, geometry, and stage gating.

The construction lab proves building geometry and sequencing. It does not exercise live resource landscapes, hauling, storage, depletion, regrowth, or town-scale performance.

### 5.6 Verification performed

The following focused regression set was run:

```text
npm.cmd test -- --run test/founding.test.ts test/economy.test.ts test/economy-direction.test.ts test/town-terrain-height.test.ts test/town-trees.test.ts test/town-legibility.test.ts test/construction-lab.test.ts
```

Result:

- 7 test files passed.
- 72 tests passed.
- Gathering, depletion, regrowth, occupancy, hauling, storage filters, deterministic replay, terrain height, tree placement, legibility, and construction stages were covered.

## 6. Quality gap

| Area | Current Luna state | Benchmark gap |
|---|---|---|
| **Resource vocabulary** | Five terrain kinds and three goods | Concept requires distinct clay, fiber/reeds, fertile land, freshwater influence, food clusters, and likely wetland/biome metadata |
| **World generation** | 48×48 field classified by elevation and forest noise | Produces categories, not formations with ecological adjacency, cluster centers, edges, clearings, or landmarks |
| **Resource clusters** | Forest is 1–3 trees per tile; berries are individual places | Lacks authored silhouettes, density bands, understory, hero rocks, clay banks, reed beds, and cluster-scale negative space |
| **Depletion projection** | Simulation stock changes correctly; `/town` trees remain static | A depleted resource may remain visually abundant |
| **Renderer split** | Legacy terrain has stock scaling; `/town` uses another system | Behavior differs by route and needs a deliberate canonical contract |
| **Water** | Large water plane and shallow shoreline; water overlay shows wells/springs | No streams, ponds, wetlands, water influence, condition, or freshwater-fertility relationship |
| **Fertility** | Sampled presentation heuristic | Cannot support persistent soil state, crop suitability, depletion, or water relationships |
| **Resource overlay** | Samples eligible tiles and uses rings | Does not show complete cluster extent or continuous abundance; rings compete with scenery |
| **Logistics feedback** | Strong underlying fetch/haul/deliver model | Player cannot yet trace source, carrier, destination, stockpile, and consumer in one coherent view |
| **Asset variation** | Three tree GLBs and small manor asset set | Insufficient silhouette/material range for concept-level regions or a dense authored settlement |
| **Scaling** | Tree instancing, pixel-ratio cap, and render metrics exist | No town resource LOD, impostors, texture streaming, chunk visibility, or representative stress fixture |
| **Labs** | Construction geometry lab | No resource-state, logistics, overlay, or performance lab |
| **Runtime visual result** | Clean simulation prototype with primitive vegetation and sparse assets | Does not reproduce the concept's coast, freshwater network, resource regions, atmospheric depth, or authored density |

### Central conclusion

The immediate gap is not simply a need for more detailed meshes. Simulation truth and visual truth can disagree. Art production before resolving that contract would create polished but misleading scenery.

## 7. Proposed measurable final quality bar

These are proposed acceptance criteria, not an implementation commitment.

### 7.1 Resource recognition

- Forest, stone, clay, food, fiber/wetland, fertile land, and freshwater are recognizable with overlays off at close, gameplay, and overview distances.
- In a blinded screenshot test, at least **90% of core resource regions** are correctly identified within **two seconds** at gameplay distance.
- No resource relies solely on hue; silhouette, ground treatment, activity, or pattern provides a second channel.

### 7.2 State recognition

- Every gatherable resource exposes **abundant, worked/partial, depleted, and recovering** states where recovery applies.
- Reviewers correctly order those states from screenshot-only comparisons at least **90%** of the time.
- A deterministic simulation tick changing stock updates the runtime visual without reload or full scene reconstruction.

### 7.3 Overlay and inspection

- Every resource overlay is reachable in **one action**.
- With the overlay active, **100% of relevant visible clusters** have type and abundance represented; no arbitrary sampling.
- Selecting a source exposes current amount, finite/renewable rule, active workers, haul destination, storage availability, and immediate downstream consumer in one contextual view.
- Opaque overlay markers obscure no more than approximately **5% of useful cluster silhouette area**.

### 7.4 Logistics legibility

For a representative route, an observer can trace:

`source → worker action → carried good → destination storage → producer or consumer`

without opening more than one additional panel. Blocked links communicate a specific cause such as no worker, no reachable stock, full storage, missing transport, or no consumer.

### 7.5 Procedural variation

- No gameplay-distance view contains two obviously identical large resource-cluster arrangements.
- Repetition evaluation covers boundary, anchor silhouette, density, rotation, scale, material family, and negative space—not only random position.
- Procedural output preserves authored landmarks and the island-level hierarchy of the concept image.

### 7.6 Camera-band continuity

- No actionable resource disappears completely at any supported camera distance.
- LOD transitions do not produce silhouette jumps larger than roughly **10 screen pixels**.
- LOD selection uses hysteresis so small camera movements do not cause flicker.

### 7.7 Performance

Once target hardware is named, the acceptance scene must include the full island, target population, active logistics, overlays, atmosphere, and representative maximum building density.

Proposed browser targets at 1920×1080:

- Normal scene: **60 FPS median**, **p95 frame time ≤20 ms**.
- Deliberate 2× stress scene: **30 FPS median**, **p95 frame time ≤33.3 ms**.
- No camera-pan or overlay-toggle main-thread stall above **50 ms**.
- Resource-landscape rendering adds no more than approximately **3 ms** combined CPU/GPU time in the normal scene.
- Draw calls, triangles, GPU texture memory, instance counts, simulation tick time, and pathfinding time are recorded rather than judged only from FPS.

### 7.8 Concept fidelity

A runtime comparison at all three camera bands demonstrates:

- Continuous readable coast and shallows.
- At least one freshwater feature visibly connected to vegetation or fertility.
- Distinct forest, stone, clay, food, fiber/wetland, and fertile-ground formations.
- Settlement routes and workplaces integrated into resource edges.
- Attractive composition with overlays disabled.
- No obvious floating, clipping, z-fighting, or status-marker occlusion.

## 8. Architectural constraints

1. **Simulation remains authoritative.** Visual state derives from deterministic state rather than a competing renderer-only quantity.
2. **Save and replay determinism matter.** Cluster identity, placement variants, transitions, and recovery must be reproducible from stored state and seed.
3. **The current tile model is thin.** Clay, fiber, fertility, wetland, and water influence need explicit semantic ownership before presentation is built around them.
4. **Ground height needs one truth.** Cluster and dressing placement should use the existing terrain-height path.
5. **Selection must be decoupled from meshes.** Instanced rendering cannot require every tree, reed, or rock to become a standalone selectable object.
6. **Spatial batching must coexist with simulation identity.** A logical cluster requires a stable ID even if rendered through shared buffers or impostors.
7. **`/town` and the legacy renderer differ.** Later planning must explicitly choose a canonical behavior.
8. **The overlay API is broad but semantically weak.** Its sampled-ring implementation must not become the underlying data model.
9. **Building and route footprints remain authoritative.** Natural clusters need deterministic exclusion, thinning, or adaptation around construction and paths.
10. **The current place-asset clone model cannot scale to all dressing.** Large repeated sets need batching and residency rules.
11. **Rendering and simulation share the frame budget.** Agents, pathfinding, hauling, animation, shadows, overlays, and terrain must be profiled together.
12. **The construction lab is isolated by design.** It is not evidence for resource-world correctness or scale.
13. **Fallback visuals remain necessary.** Missing or loading assets should not make `/town` unusable.
14. **Existing deterministic tests are valuable constraints.** Gathering, hauling, replay, tree placement, height, and construction behavior should remain covered.
15. **Renewable rock is an unresolved product rule.** It must be decided before visuals teach the player an accidental lifecycle.

## 9. Candidate capabilities for eventual planning

This is an unordered inventory, not a phase breakdown.

- Formal resource taxonomy covering finite, renewable, cultivated, seasonal, and water-dependent resources.
- Biome and landform metadata beyond the current five terrain kinds.
- Semantic cluster generation constrained by terrain, slope, water, shoreline, and neighbors.
- Stable cluster identity and deterministic member placement.
- Cluster-scale abundance, active work, partial depletion, exhaustion, damage, and recovery.
- Runtime state projection shared by `/town` and any retained renderer.
- Forest succession or simplified sapling/recovery states.
- Finite stone and clay excavation states.
- Food, berry, fiber, and reed growth states.
- Fertility and freshwater-influence representation.
- Stream, pond, wetland, and shoreline integration.
- Close, gameplay, and overview representations.
- Contextual resource inspection and depletion visualization.
- Question-specific overlays for type, abundance, fertility, water, ownership, and routes.
- Visible gathering and workplace activity.
- Carrier cargo and selected-route highlighting.
- Storage fill, input, output, reservation, and demand feedback.
- Resource and building silhouette-variant library.
- Ground dressing, understory, stumps, rubble, spoil, reeds, flowers, and edge transitions.
- Instanced meshes, distant impostors, shared materials, atlases, mips, compressed textures, and chunk visibility.
- Shadow-distance tiers and environmental quality presets.
- Atmosphere tied to biome, time, weather, and resource state.
- Dedicated resource-landscape fixtures.
- Deterministic screenshots for full, partial, depleted, and recovering states.
- Dense-settlement and 2× stress scenarios.
- Visual-regression and performance-budget gates.

## 10. Open questions, risks, and tradeoffs

### Art direction

- Is the concept image binding, or inspiration to be reinterpreted toward *Manor Lords* naturalism?
- How painterly may resources become before they stop reading as simulated?
- Is the island handcrafted, procedurally generated, or procedurally populated inside a fixed silhouette?

### Resource semantics

- Is stone finite, slowly exposed, imported later, or genuinely renewable?
- Is clay a finite bank, terrain property, quarry type, or renewable river deposit?
- Is fiber a wetland resource, crop, wild plant, or several sources?
- Is fertility static, water-influenced, seasonal, depleted, or improved through farming?
- Do berries and forests recover automatically, require nearby mature growth, or require worker intervention?

### Water scope

- Is water visual topology, an irrigation influence, or a simulated flow system?
- Are streams fixed geometry or terrain-derived?
- Are flood, drought, contamination, or seasons core mechanics?
- Full dynamic fluids have poor cost-to-value unless water manipulation is central.

### Scale and performance

- What are the target population and maximum carrier count?
- What desktop, GPU, and browser form the support floor?
- Will the island remain 48×48?
- How much close-up camera access must remain supported?

### Information design

- Should amount be read mainly from geometry, inspection, overlay, or all three?
- How will color-blind players distinguish fertility, water, clay, food, and depleted ground?
- Does overview show exact quantities, density classes, or strategic opportunity?

### Production scope

- How many mesh families and animation states can the pipeline sustain?
- Are sprites and impostors acceptable for the target style?
- Can materials share atlases without flattening biome identity?
- How many hero formations are needed for an authored feel?

### Architecture

- Do resources remain tile stock, become first-class clusters, or use clusters owning tile samples?
- Is the legacy renderer aligned, retained as diagnostics, or eventually retired?
- Should resource experimentation extend the gallery, create a dedicated lab, or use deterministic town fixtures?

### Principal risk

The largest risk is producing an attractive landscape whose appearance is only loosely related to the simulation. That would improve screenshots while weakening player trust and making depletion, overlays, saves, and logistics expensive to reconcile later.

## 11. Evidence-based sequencing considerations

These are dependency findings, not a fixed phase breakdown.

| Dependency | Evidence | Consequence for later planning |
|---|---|---|
| **Resource rules precede final state art** | Benchmarks distinguish finite, renewable, cultivated, and conditionally renewable resources; Luna currently regrows rock like forest | Decide semantics before producing depletion and recovery assets |
| **Spatial truth precedes dressing** | Successful games place resources according to biome, water, slope, and landform; Luna uses elevation/noise thresholds | Define cluster and terrain relationships before decorative density |
| **Visual state and UI share one value** | Timberborn, Farthest Frontier, and ATS align world condition with counters and overlays; Luna's `/town` trees remain full after depletion | Establish authoritative simulation-to-render projection before expanding overlays |
| **Camera bands precede asset volume** | Every benchmark simplifies at distance; documented pipelines use LOD, batching, streaming, or instancing | Fix close/gameplay/overview contracts before producing many variants |
| **Performance fixtures precede maximum density** | Pagonia and Timberborn required explicit optimization after terrain, piles, agents, and visible activity expanded | Build representative stress evidence early enough to constrain art and crowd decisions |
| **Logistics feedback follows stable source/destination identity** | Clear chains connect node, worker, cargo, storage, and producer | Ensure clusters and inventories have stable identity before route visualization |
| **Overlay design follows silhouette design** | ATS and Farthest Frontier use overlays for precision while normal views remain readable | Do not use rings to compensate for weak world forms |
| **Variation rules precede mass asset production** | Pagonia's silhouette rework and Foundation's modular repetition show the cost of late readability changes | Validate cluster grammar and material families with a small representative set |
| **Atmosphere follows value hierarchy, while lighting constraints arrive early** | Fog, bloom, shadows, movement, and clouds improve authorship but can obscure resources and consume frame time | Establish contrast and lighting ranges early; apply final atmosphere after core forms read |
| **Verification accompanies each capability** | Luna already benefits from deterministic tests and isolated construction fixtures | Define resource screenshots, route traces, and stress scenarios alongside their corresponding capabilities |

The research supports dependency-driven planning. It does not support imposing five arbitrary equal-sized phases before the resource rules and target constraints are resolved.

---

**Review gate:** Stop here. The five-phase implementation plan should be created only after this research has been reviewed and the open product questions have been answered.
