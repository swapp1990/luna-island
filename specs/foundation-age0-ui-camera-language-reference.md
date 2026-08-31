# Foundation UI, camera, placement, and language reference for Age 0

**Status:** canonical implementation reference for `/age-0`

**Research cutoff:** 30 August 2026

**Reference target:** Foundation 1.0 plus the post-1.0 Quality of Life Update

**Luna Island scope:** Age 0 only; keep the existing grid and deterministic workforce simulation
**Purpose:** stop inventing a generic dashboard and reproduce Foundation's recognisable town-builder screen hierarchy, interaction flow, and language with placeholder art

## Governing decision

Age 0 is a world-first town-builder screen, not a dashboard with a map embedded inside it.

The map fills the viewport. Permanent UI is sparse and attached to the screen edges. Summary information is grouped into compact plaques along the top. Advice and time controls occupy the lower-left corner. The main tool strip sits at the lower centre. Build selection rises from that strip only while the player is choosing a building. After a building is chosen, the menu gives way to an in-world blueprint that follows the cursor and a small contextual placement panel.

The implementation must copy Foundation's **screen anatomy, interaction order, information hierarchy, control language, and restrained visual treatment**. It must not copy proprietary art, icons, fonts, or decorative assets. Placeholder art may remain on the map.

This document supersedes ad hoc Age 0 HUD decisions that conflict with it.

## Exactness contract

"Like Foundation" means all of the following:

1. The world remains the dominant visual surface at every desktop size.
2. There is no permanent left navigation rail, large dashboard header, or always-open inspector.
3. Top status is grouped by subject, not presented as unrelated chips scattered across the screen.
4. Objectives and time controls are co-located at bottom left.
5. The primary town tools are icon-and-label actions at bottom centre.
6. Build selection is a temporary horizontal tray above the primary tools.
7. Choosing a building immediately creates a blueprint under the cursor.
8. Placement remains active until the player places, cancels, or chooses another tool.
9. The mouse wheel zooms the world; it does not scroll the page.
10. Labels use Foundation's direct settlement vocabulary: `VILLAGERS`, `RESOURCES`, `BUILD`, `QUESTS`/`ADVICE`, `Resources needed`, `Produces`, and verb-first objectives.

"Like Foundation" does **not** mean adding Foundation mechanics that Age 0 does not have. Coins, estates, happiness, technology, quests with rewards, autonomous villagers, and monument editing remain absent.

## Evidence method

Labels used below:

- **Observed:** directly stated by an official Foundation source or visible in current 1.0 gameplay footage.
- **Derived:** an Age 0 implementation rule inferred from the observed pattern.
- **Mobile adaptation:** a touch equivalent created for Luna Island; Foundation is the desktop reference, not evidence for a phone layout.

Primary evidence:

- The official [UI Overview](https://wiki.polymorph.games/foundation/UI_Overview) names and locates the Help, Visibility, Coins, Resources, Immigration/Villagers, Progression, Village Map, Settings, Territories, Zones, Build, Time, and Quests surfaces.
- The official [Buildings reference](https://wiki.polymorph.games/foundation/Buildings) documents the build search, category filters, cursor-following blueprint, boundary, entrances, move/rotate affordances, cancel controls, and Shift-click repeat placement.
- The official [Quests reference](https://wiki.polymorph.games/foundation/Quests) documents the camera tutorial and the game's objective language.
- The official [Starting a New Game guide](https://wiki.polymorph.games/foundation/Starting_a_New_Game) confirms that Build is opened from the bottom-centre panel and that the HUD begins sparse, gaining tools as progression requires them.
- Polymorph's [1.0 release notes](https://www.polymorph.games/foundation/news/2025/01/31/foundation-full-release/) identify the full-release UI as a deliberate streamlined redesign.
- Polymorph's [post-1.0 Quality of Life update](https://www.polymorph.games/foundation/news/2025/11/26/update-1-quality-of-life-update-is-now-live/) confirms current interaction details including Shift-click repeat placement, Esc closing more windows, clearer disabled-build explanations, and continued visibility-layer work.
- City Planner Plays' current 1.0 gameplay video, [Foundation is One of the Coziest City-Builders I've Played!](https://www.youtube.com/watch?v=UbyCGpwEbd8), was inspected at the HUD, build-menu, and placement moments listed in the evidence board below.

## Visual evidence board

### A. Full-screen hierarchy

![Official Foundation store screenshot showing the compact top plaques, bottom-left quest and time area, and bottom-centre town tools](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/690830/ss_a8723e62155f90d76f4779bd828ef35deaab73e6.1920x1080.jpg?t=1728049795)

**Observed:** almost the entire screen remains world. Four compact subject plaques are centred along the top. Help is isolated at top left and Settings at top right. Quests and time controls share the lower-left region. The town tool strip is centred along the bottom. There is no full-height navigation or permanent right inspector. The image is served by the [official Steam store page](https://store.steampowered.com/app/690830/Foundation/); current 1.0 footage confirms the same topology.

### B. Information overlays remain contextual

![Official Foundation gameplay screenshot showing top status plaques, contextual world labels, lower-left opportunities and quests, time controls, and the bottom tool strip](https://clan.fastly.steamstatic.com/images/32396557/d7dfe06418ff8685d89aa448cb3cb65f4d12b2f2.png)

**Observed:** status problems appear as short alerts below the related top plaque; production information appears over the affected buildings; opportunity/quest information uses the lower-left stack. The game does not relocate routine status into a large management dashboard.

### C. Build menu anatomy

![Official Foundation build-menu crop showing the horizontal building strip, search, filters, highlighted building, and details card](https://clan.fastly.steamstatic.com/images/32396557/7a331c31718545ec63edc3640e26e4c1f0b8cf28.png)

**Observed:** `BUILD` is the tray title. `Search buildings...` is at the top right. Buildings form a horizontal visual list. Category filters sit below. Hover/selection opens one concise detail card with the building name, what it produces, `Resources needed`, and any cost. The image is an older official UI capture, so it is evidence for anatomy only; the same anatomy is visible in 1.0 footage at [12:01](https://www.youtube.com/watch?v=UbyCGpwEbd8&t=721s).

### D. Current 1.0 gameplay checkpoints

| Time | Direct link | What was inspected |
|---|---|---|
| 11:57 | [HUD before opening Build](https://www.youtube.com/watch?v=UbyCGpwEbd8&t=717s) | Top-centre Coins, Resources, Villagers, and Progression plaques; bottom-left Advice and time; small Build action at bottom centre. |
| 12:01 | [Build tray open](https://www.youtube.com/watch?v=UbyCGpwEbd8&t=721s) | Temporary horizontal `BUILD` tray above the tool strip, a `Search buildings...` field, building thumbnails, and a compact hover card. |
| 12:05 | [Stonecutter Camp placement](https://www.youtube.com/watch?v=UbyCGpwEbd8&t=725s) | World-centred blueprint/footprint, compact lower placement card, cancel control, rotation controls, resource cost, and the map still visible at full size. |

These checkpoints are current interaction evidence. The video is a third-party sponsored playthrough, not product documentation; official wiki pages remain authoritative for named controls.

## Desktop screen anatomy

```text
+--------------------------------------------------------------------------------+
| [?]  [visibility]       [RESOURCES] [VILLAGERS] [PROGRESSION]          [settings]|
|                                                                                |
|                                                                                |
|                              WORLD / GRID MAP                                  |
|                       selection and alerts live in-world                       |
|                                                                                |
|                                                                                |
| [ADVICE / OBJECTIVES]                                                          |
| [short checklist]                 [temporary BUILD tray]                       |
| [pause < 1x 2x 4x]                [map] [zones] [BUILD] [book]                 |
+--------------------------------------------------------------------------------+
```

### Layer 1: world

- **Observed:** the world fills the window behind all UI.
- **Derived:** `/age-0` must be a fixed, full-viewport route with `overflow: hidden`; the document itself must never scroll during play.
- **Derived:** the grid may remain visually simple, but it must read as terrain rather than a spreadsheet. Grid lines are subordinate to terrain and placement feedback.

### Layer 2: permanent HUD

| Anchor | Foundation pattern | Age 0 content |
|---|---|---|
| Top left | Help and visibility utilities | Help; optional resource/coverage visibility. No logo or page title. |
| Top centre | Compact subject plaques | `RESOURCES`, `VILLAGERS`, `PROGRESSION`. Omit `COINS` because Age 0 has no coin economy. |
| Top right | Settings | Settings/menu. Keep isolated from simulation data. |
| Bottom left, upper | Quests/advice | One `ADVICE` card with the current next step and a short checklist. Collapsible. |
| Bottom left, lower | Time panel | Pause, slower/faster speed, current day. The visual order follows Foundation: controls first, date/day text second. |
| Bottom centre | Primary town tools | `MAP` or recenter, `ZONES`/resource assignment, `BUILD`, and settlement overview only if it exists. Hide unavailable future tools instead of disabling a row of fake features. |

### Layer 3: temporary panels

Only one primary temporary panel may be open at a time.

- Build tray: lower centre, immediately above the town tools.
- Building/resource details: compact contextual card close to the selected object or lower centre.
- Placement card: compact lower-centre card containing name, purpose, requirements, and valid/invalid reason.
- Help/settings: modal or book-style surface; closes with Esc before the game exits placement.

There must not be a permanent right-side build inspector. A right-side card is acceptable only when the player has selected an existing building and it does not compete with an open build tray.

## HUD sizing and visual treatment

These are Luna implementation tokens inferred from the reference, not measured Foundation source values.

| Property | Desktop contract |
|---|---|
| Edge safe area | 16-24 px plus browser safe-area insets. |
| Top cluster | Content-width, centred, no more than roughly half the viewport at 1440-1920 px. |
| Top plaque height | Approximately 56-72 px; subject label above a single dense value row. |
| Objective width | 260-320 px. It grows vertically, never into the map centre. |
| Tool strip | 56-72 px tall, content-width, centred. |
| Build tray | 620-840 px wide, one visible row; scroll horizontally if required. Age 0 needs only four buildings, so scrolling should not appear. |
| Panel surface | Deep charcoal/forest tint at about 84-92% opacity, slight blur only if text contrast remains stable. |
| Text | Warm off-white primary, muted stone secondary, warm ochre/gold for active values and selected controls. |
| Shape | Small radius, faint internal highlight, restrained shadow. Avoid floating white cards and dashboard borders. |
| Type | Accessible sans-serif placeholder; uppercase, tracked subject labels; sentence case explanations; tabular numerals for stocks and time. |

The visual target is quiet, dark framing around a bright world. Decoration must not consume more attention than the terrain or placement blueprint.

## Camera contract

### Observed Foundation controls

The official tutorial names these controls:

| Action | Foundation input |
|---|---|
| Pan forward/left/back/right | Arrow keys or `W`/`A`/`S`/`D` |
| Zoom in/out | Mouse wheel or Page Up/Page Down |
| Tilt forward/backward | Middle-click gesture or `R`/`F` |
| Rotate left/right | Middle-click gesture or `Q`/`E` |

### Required Age 0 grid-camera behaviour

1. **Mouse wheel zooms.** Wheel up zooms in; wheel down zooms out. The full-screen route prevents page scrolling while the pointer is over the map.
2. **Zoom is cursor-centred.** The world cell beneath the pointer remains beneath the pointer as scale changes. This is what makes the grid feel like a map rather than a web canvas.
3. **Middle-drag pans.** Preserve left click/tap for selection and placement. Right-drag may be reserved for future orbit only if the grid gains a 3D camera.
4. **Keyboard pans.** `WASD` and arrows move the map while focus is not inside a text field. Page Up/Page Down mirror wheel zoom.
5. **Bounds are clamped.** The player can reveal a small visual margin around the grid but cannot lose the entire settlement off-screen.
6. **Zoom is clamped and smooth.** Initial implementation target: approximately 0.75x to 2.25x, with small eased steps. Exact values may change after browser testing.
7. **Recenter remains available.** A map/recenter tool returns to the initial settlement framing without resetting simulation state.
8. **Placement survives camera movement.** Panning or zooming changes the viewed cell under the cursor; it does not cancel the active blueprint.

### Pointer ownership

| Gesture | Normal map | Placement active |
|---|---|---|
| Left click/tap | Select cell/building | Place on valid cell; explain why on invalid cell |
| Left drag | No camera movement | No camera movement |
| Middle drag | Pan | Pan while keeping placement active |
| Wheel | Cursor-centred zoom | Cursor-centred zoom while keeping placement active |
| Right click | Clear selection/close temporary panel | Cancel placement |
| Esc | Close the topmost temporary panel | Cancel placement first, then close Build tray on a second press |
| Shift + left click | Normal selection | Place and retain the same blueprint for another placement |

## Build and placement workflow

```text
World view
   -> choose BUILD
Build tray
   -> choose Hearth / Lean-to / Food Cache / Tool Rack
Blueprint placement
   -> move cursor, pan, or zoom without losing the blueprint
   -> valid: click to place
   -> invalid: click gives a specific reason; no placement occurs
Construction footprint selected
   -> assign builders or return to the world
```

### Build tray

- Title: `BUILD`.
- Four visible building thumbnails in Age 0; placeholder illustrations are acceptable.
- Selected/hovered building receives the warm accent and one detail card.
- Do not add search for only four items. Preserve space for it in the layout so Age 1 can add `Search buildings...` without redesign.
- Do not show Foundation categories until Age 1 has enough buildings to make categories useful.
- Every card answers: what it does, what it needs, and whether it can be placed now.

### Blueprint state

- **Observed:** Foundation shows the actual building visual beneath the cursor, a blue outer boundary, entry markers, and move/rotate affordances.
- **Derived for the grid:** render a semi-transparent building placeholder snapped to the target cell/footprint, not a detached mouse icon.
- Valid footprint: pale blueprint fill plus blue/cool outline; confirm action uses the warm active accent.
- Invalid footprint: red outline/fill and a one-sentence reason in the placement card.
- The footprint must remain visually attached to the pointer during map movement and zoom.
- The cursor changes to a placement cursor while a blueprint is active.
- A placed footprint remains on the map as a construction site; it does not instantly become the finished building.

### Placement feedback language

Use a concrete reason, not `Invalid placement`:

- `Cannot build on water.`
- `This space is already occupied.`
- `The Hearth needs access to water.`
- `Not enough Wood.`
- `Not enough Stone.`
- `Choose open ground.`

Always name resources with initial capitals in compact UI labels (`Wood`, `Stone`, `Fiber`, `Food`) and sentence case in prose.

## Age 0 language dictionary

### Top HUD

| Use | Do not use |
|---|---|
| `RESOURCES` | `Inventory`, `Economy Dashboard` |
| `VILLAGERS` | `Human Units`, `Workforce Pool` in player-facing UI |
| `6 Villagers` | `Population entity count: 6` |
| `2 Unemployed` | `2 idle agents` |
| `PROGRESSION` | `Level Metrics`, `Age-up System` |
| `Age 0` / `Age 1` | `Tier zero` / `next level target` |

`VILLAGERS` is a presentation term only. The simulation remains an abstract deterministic workforce pool with no character minds or pathfinding.

### Building detail cards

Follow Foundation's information order:

1. Building name.
2. One direct purpose sentence.
3. `Produces` or `Provides` when applicable.
4. `Resources needed`.
5. Availability/placement reason.

Age 0 examples:

| Building | Detail copy |
|---|---|
| Hearth | `Establishes the centre of the settlement.` `Resources needed: 8 Wood, 4 Stone` |
| Lean-to | `Provides shelter for 3 Villagers.` `Resources needed: 6 Wood, 4 Fiber` |
| Food Cache | `Increases Food storage.` `Resources needed: 5 Wood, 2 Fiber` |
| Tool Rack | `Improves gathering efficiency.` `Resources needed: 6 Wood, 3 Stone` |

### Advice and objectives

Foundation separates a short narrative thought from a verb-first objective. Age 0 should do the same without creating a scripted quest system.

Good:

```text
ADVICE: Establishing the Settlement
I must place the Hearth where the village can reach water and nearby resources.

Build a Hearth
```

```text
ADVICE: Preparing for Growth
The village needs spare shelter and two days of Food before another Villager can arrive.

Provide 1 spare shelter space
Store 12 Food
```

```text
ADVICE: Reaching Age 1
The village must support 12 Villagers without interruption.

Reach 12 Villagers
Remain stable for 5 days
```

Avoid tutorial copy such as `Click the orange button below`, `Step 3 of 8`, or unexplained system language. The objective names the settlement outcome; the control tooltip explains the input.

### Tooltips and controls

Preferred labels:

- `Build`
- `Assign Villager`
- `Remove Villager`
- `Pause`
- `Normal speed`
- `Faster speed`
- `Recenter map`
- `Right-click or press Esc to cancel`
- `Shift-click to place another`
- `Scroll to zoom`
- `Middle-drag to move the map`

Buttons use verbs. Status uses nouns. Do not expose implementation terms such as `tile index`, `allocation reducer`, `growth tick`, or `camera transform`.

## Resource and workforce selection

Foundation's world-first rule applies even though Age 0 uses a generic workforce pool:

1. Click a Forest, Food patch, Stone deposit, or Fiber patch in the world.
2. Open a compact contextual card for that cell.
3. Show resource name, remaining yield, distance efficiency, assigned Villagers, and plus/minus controls.
4. Keep the cell visibly selected in the world.
5. Close the card with right-click, Esc, or selection of another cell.

Do not make the player choose a resource from a permanent sidebar before seeing it in the world. The world object is the entry point.

Suggested card language:

```text
FOREST
Produces Wood
Distance efficiency: 86%
Villagers: 2 / 4
[-]  [+ Assign Villager]
```

## Population growth and Age 1 presentation

Progression belongs in the top `PROGRESSION` plaque and expands only on hover/tap or selection.

Collapsed:

```text
PROGRESSION
Age 0     3.2 / 5 days
```

Expanded:

```text
AGE 1
Population       12 / 12
Stable for       3.2 / 5 days
Food reserve     2.4 days
Shelter          13 / 15
[progress bar]
```

The top plaque reports progress. It does not become a separate mission panel, checklist, or technology tree. If population falls below 12, show the stability meter draining and explain the current blocker in one line.

## Responsive and mobile adaptation

Foundation supplies the desktop hierarchy. These touch rules preserve that hierarchy without pretending they are observed Foundation controls.

### Breakpoints by available space

| Width | Layout |
|---|---|
| 1024 px and wider | Full desktop anatomy. Top plaques show labels and key values. Build tray is a horizontal floating panel. |
| 600-1023 px | Compact landscape/tablet anatomy. Top plaques shorten secondary values; objective panel becomes a collapsible chip; tool strip remains bottom centre. |
| Below 600 px | Phone anatomy. Top becomes a single compact status row; bottom tool strip spans the safe width; temporary content opens as a bottom sheet above it. |

### Phone screen anatomy

```text
+----------------------------------+
| [?] [Food] [Wood] [6/12] [Age 0]|
|                                  |
|            GRID WORLD            |
|                                  |
| [current advice - tap to expand] |
| [pause] [1x] [2x] [4x]          |
| [Map] [Assign] [BUILD]           |
+----------------------------------+
```

### Touch camera and placement

- One-finger drag pans the map when the gesture begins on empty terrain.
- Pinch zooms around the pinch midpoint.
- Tap selects or places.
- A drag that exceeds the movement threshold never places a building on release.
- While placement is active, one-finger drag on empty terrain pans; a deliberate tap confirms.
- A visible `Cancel` action mirrors right-click/Esc.
- A visible rotate action is required only when footprints gain orientation.
- Controls have at least a 44 x 44 CSS-pixel target and respect `env(safe-area-inset-*)`.
- The bottom sheet never covers the target placement cell; the camera may offset slightly when the sheet opens.
- No hover-only information. First tap selects; a second explicit tap/action confirms destructive or committing operations.

### Mobile information priority

Always visible:

1. Food and the most constrained material.
2. Villager count and unassigned Villagers.
3. Current Age and stability progress.
4. Time controls.
5. Build access.

Available after one tap:

- Full resources.
- Full Advice text.
- Building requirements.
- Cell production and distance efficiency.

## Grid-first mapping

The grid changes the world rendering, not the UI model.

| Foundation world concept | Age 0 grid implementation |
|---|---|
| 3D terrain under a strategy camera | Square terrain cells under a transformable map camera |
| Building model blueprint | Semi-transparent placeholder footprint snapped to cells |
| Blue outer boundary | Blue/cool footprint outline |
| Entry arrows | Optional edge marker only when access becomes mechanically relevant |
| Move/rotate gizmo | Cursor-follow and future rotate action; do not fake unused controls |
| Building selection panel | Compact cell/building contextual card |
| Workplace worker slots | Plus/minus assignment against the generic Villager pool |
| Building alerts | Small world badge plus concise top-related alert |
| Territory/map tools | Recenter/overview tool; territory buying remains absent |

## Things the implementation must remove or avoid

- A large title bar saying `Age 0 Settlement`.
- A web-app navigation sidebar.
- Permanently visible instructions explaining every control.
- Large resource cards with progress bars for ordinary stock values.
- A persistent right panel while nothing is selected.
- Multiple competing panels open at the same time.
- A build mode that shows only a text cursor instead of a footprint.
- Wheel events that scroll the browser page.
- Dragging the map and accidentally placing a building on pointer release.
- Mobile layouts that simply shrink desktop panels until text is unreadable.
- Labels invented from implementation language instead of settlement language.

## Acceptance checklist for `/age-0`

### First screenshot test

- [ ] At a glance, the screen reads as a town-builder: world first, compact top status, objective/time bottom left, tools bottom centre.
- [ ] At least 75% of desktop pixels remain unobstructed world when no temporary menu is open.
- [ ] No permanent full-height panel is present.
- [ ] Placeholder art still reads as terrain/resource/building categories without relying on text inside every cell.

### Camera test

- [ ] Wheel up/down zooms in/out and never scrolls the page.
- [ ] The cell under the pointer remains anchored while zooming.
- [ ] Middle-drag and keyboard pan work.
- [ ] Pan and zoom are clamped.
- [ ] Camera movement never causes an accidental selection or placement.
- [ ] Placement remains active through pan and zoom.

### Build test

- [ ] `BUILD` opens a lower-centre tray, not a sidebar.
- [ ] All four Age 0 buildings are visible without scrolling.
- [ ] Selecting one closes/replaces the tray and creates a cursor-following blueprint.
- [ ] Valid and invalid footprints are visually distinct.
- [ ] Invalid placement names the reason.
- [ ] Right-click/Esc cancels; Shift-click repeats.
- [ ] A placed building becomes a construction footprint and can receive builder allocation.

### Language test

- [ ] HUD uses `RESOURCES`, `VILLAGERS`, `PROGRESSION`, `BUILD`, and `ADVICE` consistently.
- [ ] Building cards use purpose, `Produces`/`Provides`, and `Resources needed`.
- [ ] Objectives begin with a verb and describe a settlement outcome.
- [ ] No technology, quest reward, character-mind, or pathfinding vocabulary leaks into Age 0.
- [ ] Every disabled or invalid action has a concise explanation.

### Mobile test

- [ ] 390 x 844 portrait and 844 x 390 landscape remain playable without page scrolling.
- [ ] Tap targets are at least 44 x 44 CSS px.
- [ ] One-finger pan, pinch zoom, tap selection, and tap placement work without gesture collisions.
- [ ] Build and contextual panels use a bottom sheet and preserve a visible target cell.
- [ ] Safe-area insets are respected.

## Source trail

1. Polymorph Games, [UI Overview - Official Foundation Wiki](https://wiki.polymorph.games/foundation/UI_Overview).
2. Polymorph Games, [Buildings - Official Foundation Wiki](https://wiki.polymorph.games/foundation/Buildings).
3. Polymorph Games, [Quests - Official Foundation Wiki](https://wiki.polymorph.games/foundation/Quests).
4. Polymorph Games, [Starting a New Game - Official Foundation Wiki](https://wiki.polymorph.games/foundation/Starting_a_New_Game).
5. Polymorph Games, [Foundation 1.0 Is Now Available!](https://www.polymorph.games/foundation/news/2025/01/31/foundation-full-release/), 31 January 2025.
6. Polymorph Games, [Update 1 - Quality of Life Update is now live!](https://www.polymorph.games/foundation/news/2025/11/26/update-1-quality-of-life-update-is-now-live/), 26 November 2025.
7. Foundation, [official Steam store page and screenshot gallery](https://store.steampowered.com/app/690830/Foundation/).
8. City Planner Plays, [Foundation is One of the Coziest City-Builders I've Played!](https://www.youtube.com/watch?v=UbyCGpwEbd8), inspected at 11:57, 12:01, and 12:05 for the current 1.0 HUD/build/placement sequence.

## Final implementation rule

When a future Age 0 UI choice is not covered here, first ask: **where does Foundation put this, when does it appear, and what does Foundation call it?** Preserve that answer unless it would imply a mechanic Age 0 intentionally does not have. In that case, omit the mechanic and keep the surrounding hierarchy intact.
