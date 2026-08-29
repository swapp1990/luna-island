# Luna Island town-builder gameplay and visual audit

Date: 2026-08-27  
Scope: desktop builder surface (`/town.html`) plus the existing observer surface (`/`)  
Question: what must be added before Luna minds move into the player's town?

## Executive summary

The current builder is a good interaction prototype, but it is not yet a town-builder game loop. The player can open a clean construction tray, preview a footprint, designate a site, wait for villagers to deliver and build, cancel, and demolish. There is almost no strategic layer around those actions: no scenario objective, consequential season, failure state, population growth, production planning, logistics direction, work priorities, or readable explanation of why the town is succeeding or failing.

The most important work before Phase 3 is therefore not additional Luna behavior. It is finishing the original Phase 2 promise: a playable `land → provide → prepare → survive → grow` loop. Luna minds should enter a town where the player's decisions already matter.

The repo's own colony-builder plan already describes this correctly. The implemented slice covers only part of its Placement bullet. Roads, zones, work priorities, stockpile rules, pressure, scenario start, and failure remain missing.

## What is already strong

- Strategy camera and town-scale 3D presentation are functional.
- The construction tray uses familiar genre conventions and shows material bills.
- Placement preview communicates valid, invalid, and resource-waiting states.
- Construction uses the real simulation: villagers deliver resources and perform labour.
- Sites have cancel/demolish actions and staged construction rendering.
- The underlying simulation already has food, wood, stone, workplaces, wages, inventories, construction, ownership, needs, conversations, institutions, and deterministic replay.

These are valuable foundations. The problem is that most of the simulation is invisible or uncontrollable from the builder surface.

## Genre benchmark

| Genre expectation | Strong examples | Luna Island now | Priority |
|---|---|---|---|
| A clear objective and mounting pressure | Against the Storm's Orders and Impatience; Frostpunk's heat and social pressure | Cosmetic season label; no objective, threat, or failure | P0 |
| Spatial production and logistics decisions | Manor Lords resource deposits, roads, transport, production chains; Against the Storm ranges and overlays | Five build cards; production buildings omitted; no roads, zones, routes, or priorities | P0 |
| A settlement growth arc | Foundation prosperity/unlock tiers; Manor Lords housing and town growth | Fixed developed start with 24 villagers; no arrivals, housing-driven growth, or unlocks | P0 |
| A signature environmental constraint | Timberborn water/drought; Manor Lords seasons/fertility | Terrain is mainly visual; settlement layout has weak strategic consequence | P1 |
| At-a-glance operational feedback | Builder alerts, overlays, worker counts, stalled-building icons, input/output panels | Four resource totals and a very thin selected-building card | P0 |
| People who react to rule and survival choices | Frostpunk requests/laws; colony-sim pawn stories | Rich resident systems exist, but only on a separate observer surface | P0 before minds |

Reference material:

- [Against the Storm official building documentation](https://wiki.hoodedhorse.com/Against_the_Storm/Buildings)
- [Manor Lords official Steam description](https://store.steampowered.com/app/1363080/Manor_Lords/)
- [Timberborn official feature overview](https://timberborn.wiki.gg/wiki/Features)
- [Foundation official overview](https://www.polymorph.games/en/)
- [Foundation progression documentation](https://wiki.polymorph.games/foundation/Influence)
- [Frostpunk official Steam description](https://store.steampowered.com/app/323190/Frostpunk/)

## Critical gameplay gaps

### P0 — There is no first-session arc

Current loop:

`open build menu → place a site → wait → site eventually completes`

Required loop:

`read the land → identify a shortage → choose a layout → assign capacity → watch delivery → react to a bottleneck → prepare for pressure → survive → unlock growth`

Add one authored scenario before adding breadth:

- Start with roughly seven residents, a supply cart, one shelter, bushes, forest, rock, and water.
- Begin in late summer or autumn.
- Show a visible countdown to the first difficult season or island storm.
- Require adequate food, shelter, and water capacity.
- Use collapse plus resident exodus as the fail state if permanent death is not desired.
- Give the player three readable goals: secure food, house everyone, prepare reserves.

This supplies purpose without scripting resident behavior.

### P0 — The player cannot build an economy

The engine supports farms, forestry camps, and quarries, but the town build tray exposes only houses, wells, stalls, storehouses, and notice boards. The player can spend produced resources but cannot place the producers that create them.

Add:

- Farm, forestry, and quarry to the build menu.
- Roads or paths that affect walking/hauling efficiency.
- Forestry and field zones.
- Stockpile/storage rules by good.
- Construction priorities and an explicit builder/labour pool.
- Lightweight work priorities: Food, Wood, Stone, Haul, Build, Social/Civic.
- Building panels showing workers, input, output, inventory, production rate, delivery status, and the reason for a stall.

The player should influence work; Luna residents should retain agency over how they respond.

### P0 — Town growth is absent

A popular builder provides a transformation from camp to settlement to town. Luna Island starts as an already-developed 24-person village and does not present population growth as a player achievement.

Make Luna arrivals the progression system:

- Housing, food reserve, work opportunity, water access, safety, and social/civic capacity produce Town Appeal.
- Appeal unlocks an invitation or arrival choice rather than spawning anonymous population automatically.
- Each new Luna mind is a meaningful resident, so population growth can be slow and characterful.
- Building tiers and new civic/production options unlock at small milestones, not through a large generic tech tree.

This turns the expensive, memorable minds into the reward for successful town building.

### P0 — The two product surfaces must become one

The town surface has the player verbs but almost none of the resident, economy, narrative, or replay information. The observer surface has the rich inspectors, ticker, minds, stories, charts, town board, and replay, but no builder controls.

Before minds move in, move the useful observer information into `/town` and make it the product route:

- Resident selection and character card.
- Rich building panel.
- Alert/story feed.
- Town board and institutions.
- Replay/timeline access.
- Resource/economy charts behind a secondary panel.

Do not preserve two different visual languages for playing and observing.

### P0 — The player cannot diagnose cause and effect

Four resource totals are not enough. The town surface needs to answer:

- How many residents are housed?
- How many are hungry, exhausted, unemployed, idle, or collapsed?
- How many days of food remain?
- Why is this construction site not advancing?
- Who is hauling or building it?
- Which producer or route is the bottleneck?
- What will the coming pressure consume?

Use alerts and building/status icons for exceptional conditions. Keep detailed logs available, but never require reading logs to play.

## Critical visual gaps

### P0 — World-state legibility

At default strategy zoom, villagers are colored capsules and many buildings are too small or similar to identify. Important facilities, resource nodes, construction, and social events do not establish a strong hierarchy.

The runtime asset readout also reported 14 loaded place assets and 16 fallback place instances. Before a visual-quality gate, the fallback coverage must be eliminated or deliberately art-directed rather than silently accepted.

Add:

- Stronger building silhouettes and category color/material cues.
- Persistent roads and worn paths that expose the town's logistics graph.
- Overhead icons only for actionable exceptions: hungry, homeless, no work, blocked, carrying, conversing.
- Construction progress and missing-material icons visible without selection.
- Select/hover outlines with labels and range overlays.
- Resource, fertility, water, housing, job, ownership, and path-cost overlays.
- Better zoom-dependent detail: clear icons at strategy zoom; resident animation and personality at story zoom.

### P0 — Placement must respect visual obstacles

The current placement validator accepted a notice-board footprint directly over a dense tree cluster. The finished notice board was then almost completely hidden inside the trees. A mechanically valid placement must also be visually valid.

Either:

- mark occupied trees as a collision, or
- preview the exact trees that will be cleared and remove them when construction begins.

The placement ghost should use the final building footprint, orientation, entrances, and path connection—not a large generic scaffold alone.

### P1 — Lighting and contrast

At approximately 06:00 the playable town was so dark that buildings and villagers were barely readable. Atmosphere should not undermine strategy visibility.

Add a gameplay luminance floor, brighter unit/building rim light, and stronger nighttime emissive landmarks. Keep dawn/night beautiful, but make the interactive state readable.

### P1 — Town transformation needs to be visible

The current settlement changes numerically more than visually. Progress should alter the skyline and ground:

- Camp/cart → first paths → clustered homes → productive district → civic center.
- Building upgrades should change models, props, smoke, lighting, and activity.
- Storage should visibly fill; farms should change with growth; workshops should show production.
- A completed structure should have a brief visible celebration and resident reaction.

## Recommended implementation order

### Slice A — First winter/storm vertical loop

1. Seven-resident scenario start.
2. Real season/pressure countdown.
3. Housing, food, and water objectives.
4. Clear failure/exodus state.
5. Alerts and food-days/housing UI.

### Slice B — Economy and direction

1. Expose farm, forestry, and quarry.
2. Roads/paths and resource zones.
3. Construction priority and simplified work priorities.
4. Stockpile filters and production panels.
5. Bottleneck feedback.

### Slice C — One readable product surface

1. Move resident and building inspectors into `/town`.
2. Add alert/story feed and town board.
3. Add useful overlays and hover labels.
4. Fix tree/footprint interaction and low-light readability.
5. Make `/town` the default route after the gate passes.

### Slice D — Growth and mind-ready society

1. Town Appeal and invitation-based arrivals.
2. Small unlock/milestone ladder.
3. Civic/social capacity buildings.
4. Player decisions become observable resident facts.
5. Only then enable Luna minds in the player economy.

## Pre-Phase-3 acceptance gate

A genre-literate player, without instructions, must be able to play for 15–20 minutes and:

1. Explain the immediate threat and the next town objective.
2. Build at least one producer, one storage/logistics improvement, and one home.
3. Diagnose and fix one stalled construction or production chain.
4. Make one meaningful trade-off between immediate survival and longer-term growth.
5. Point to at least two residents and explain what they are doing from the world view.
6. Reach the first pressure event and either survive or understand exactly why they failed.

The played session must remain deterministic and replayable. Once this gate passes, Luna minds will have a real town-builder game to inhabit rather than another observer demo.

## Visual evidence

- [Builder overview](./2026-08-27-luna-island-builder-overview.png)
- [Placement ghost over a visually occupied tree cluster](./2026-08-27-luna-island-placement-ghost.png)
- [Separate observer surface](./2026-08-27-luna-island-observer-surface.png)

Desktop viewport tested: 1264×625. Mobile/responsive behavior was intentionally out of scope because the product is currently a desktop strategy game.
