# Slice 4 acceptance - Growth and mind-ready society

Date: 2026-08-28  
Status: PASS  
Source audit: [2026-08-27 Luna Island town-builder gameplay audit](./2026-08-27-luna-island-town-builder-gameplay-audit.md)

## Audited gaps addressed

Slice 4 makes settlement growth a player-readable consequence of the town the player builds, then proves that a named Luna can enter that economy without surrendering personal agency:

- Town Appeal is derived from six visible settlement conditions: housing, food reserve, work opportunity, water access, safety, and social/civic life.
- Growth is invitation-based. Population cannot increase merely because a meter filled: the town must survive the first storm, reach the relevant Appeal threshold, and retain an open bed.
- The Camp, Hamlet, Village, Town, and Sanctuary ladder explains the next threshold and unlock. Build cards stay visible while locked and name the exact milestone/Appeal requirement.
- Invitation choices are real Luna-roster characters with names, a promise, and preferred work. Accepting one inserts that exact resident, assigns a home, updates the population, emits a town story, and preserves deterministic save/replay state.
- The player remains responsible for the built environment, routes, priorities, and invitation choice. Residents remain responsible for their actions.
- Player commands become resident-observable town facts and are included in Luna mind prompts. The resident inspector exposes the facts a selected resident has observed.
- The playable town route now runs the same production `LunaBrainService` cadence as the observer route. An invited Luna receives mind-authored actions inside the player economy; each applied intent is labeled in the inspector and recorded for replay.
- Buildings transform visibly as the town develops: farms change crop rows, storehouses gain crates with inventory, active producers gain activity dressing, and upgraded buildings display a higher tier.
- Building upgrades are materialized construction projects with a bill, crew, progress, priority, and world site; they do not mutate instantly from a button press.
- The player has world overlays for goods/resources, fertility, water, ownership, and routes in addition to the existing needs, housing, and jobs views.
- Forestry and quarry fallbacks are deliberate producer silhouettes rather than generic gray placeholder boxes.
- The legacy deterministic wild-simulation hash remains `c10ec3d7`.

## Acceptance video

Durable MP4: [Luna Island - Slice 4 growth and mind-ready society acceptance](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T140201-luna-island-slice-4-growth-mind-ready-acceptance-2026-08-28.mp4)

Local source artifact: `D:\MyProjects\Claude\impressions-agency\products\AGENCY_RECORDINGS\recordings\2026-08-28T140201-luna-island-slice-4-growth-mind-ready-acceptance-2026-08-28.mp4`

Video integrity: H.264, 1264x624, 30 fps, 170.034 seconds, silent by design.

All build, path, overlay, growth, invitation, resident-inspector, and upgrade interactions use rendered player-facing controls. Deterministic fast-forward compresses construction and storm time but does not inject outcomes or bypass simulation rules. A lighting-only midday pose keeps the evidence readable without changing the simulation clock. The Luna decision uses the deterministic mock provider in the same production mind service and replay path; Phase 3's live-provider/token-budget gate remains separate.

### Timecode checklist

| Time | Expected proof | Result |
| --- | --- | --- |
| 00:05 | The actual town opens with 7 settlers, 53 Appeal, a 2d 11h storm deadline, missing beds/well, and a readable food objective | PASS |
| 00:10 | Growth shows `53 / 100 Appeal`, Camp, all six scored components, `Next: Hamlet at 55`, and the explicit post-storm invitation gate | PASS |
| 00:25 | The full catalog remains visible: farm/home/well are usable while forestry, quarry, storehouse, market, and notice board name their exact lock thresholds | PASS |
| 00:31 | Goods overlay distinguishes raw resources and relevant producers/storage in world space | PASS |
| 00:37 | Soil overlay marks farmable clear ground without obscuring the town | PASS |
| 00:40 | Water overlay identifies the spring/water-access geography | PASS |
| 00:47 | Owners overlay distinguishes commons and privately owned places | PASS |
| 00:50 | Repeated rendered canvas clicks paint a persistent player route and report its tiles | PASS |
| 01:00 | Routes overlay distinguishes the player-painted/worn logistics network from ordinary ground | PASS |
| 01:10 | The player designates a real house site through the rendered catalog and world canvas | PASS |
| 01:20 | The player designates the real sheltered well investment; villagers retain delivery/construction responsibility | PASS |
| 01:30 | The challenge visibly reports `First storm survived`, 7/7 housed, 14/14 food, 1/1 well, and that every settler stayed | PASS |
| 01:40 | A real notice-board site exposes crew, shortage, progress, bill, and world construction geometry while the town has reached the Town/Sanctuary range | PASS |
| 01:50 | Growth shows 91 Appeal, Sanctuary, and a literal choice between Mira and Joss with different promises and preferred work | PASS |
| 02:00 | Clicking Mira's rendered Invite button changes the population to 8, opens her named biography, assigns a house, and records her arrival in Town Stories | PASS |
| 02:03 | Mira changes to a mind-authored `drink` action with first-person reasoning; the inspector labels `mock mind · recorded for replay` | PASS |
| 02:10 | Mira's inspector exposes the player-made facts she observed, including the invitation and the town's 91 Appeal at the choice | PASS |
| 02:30 | `Notice-board upgrade to level 2` exists as a 0%-built world site with 2/2 workers and a material bill | PASS |
| 02:40 | The same project completes as a selectable `Notice Board`, visibly reporting `Level 2 / 3` and offering the next materialized tier | PASS |

Visual sampling artifacts:

- `audit-reports/video-verification/slice-4/contact-sheet.png`
- `audit-reports/video-verification/slice-4/frame-10.png` through `frame-160.png`
- `audit-reports/video-verification/slice-4/run_acceptance_interactions.py`

Manual browser evidence includes:

- `audit-reports/slice-4-browser-growth-initial.png`
- `audit-reports/slice-4-browser-growth-invitation-v2.png`
- `audit-reports/slice-4-browser-mira-arrived.png`
- `audit-reports/slice-4-browser-upgrade-site.png`
- `audit-reports/slice-4-browser-resources-overlay-v2.png`
- `audit-reports/slice-4-browser-fertility-overlay-v2.png`
- `audit-reports/slice-4-browser-locked-builds.png`
- `audit-reports/slice-4-browser-final-tier.png`

## Verification

- `npm.cmd run build` - PASS on the exact recorded source: TypeScript clean; 162 modules transformed; root, observer, town, god, and gallery entry points emitted.
- Unit coverage, clean two-shard threads run - PASS: 48 files, 461 tests passed, 5 skipped (466 total).
- `PLAYWRIGHT_PORT=5176 npx.cmd playwright test e2e/first-storm.spec.ts e2e/town-placement.spec.ts e2e/economy-direction.spec.ts e2e/town-legibility.spec.ts e2e/town-growth.spec.ts --reporter=line --retries=0` - PASS: 8 browser tests in 9.7 seconds.
- Town-growth coverage - PASS for the six-part Appeal calculation, storm/bed/threshold gates, named roster invitations, actual resident insertion/home assignment, player-observed facts, stable save hash, and materialized upgrades.
- Town-loop mind seam - PASS: a regression test requires the player-town loop to invoke the Luna hook after every live simulation tick, including deterministic fast-forward.
- Manual browser verification - PASS for every overlay, locked build explanation, real survival investments, invitation choice, resident insertion, mind-authored action, observed facts, upgrade construction site, and completed tier.
- Stable legacy simulation hash - PASS: `P4_7_WILD_HASH_T0 c10ec3d7`.
- `ffprobe` stream validation - PASS.
- Contact-sheet and exact-frame inspection - PASS.
- Durable S3 upload - PASS.

## QA findings resolved before acceptance

1. The first resource/fertility overlay pass was visually too dense. Marker density was reduced and the accepted video shows the quieter art-directed versions.
2. The playable town loop originally inserted a real Luna roster ID but did not attach `LunaBrainService`; the resident would therefore have remained idle after arrival. The production hook is now attached per tick, deterministic fast-forward preserves the cadence, and the accepted video proves Mira's authored action plus replay record.
3. The first upgrade-site label read like a generic new building. It now states the target and tier literally (`Notice-board upgrade to level 2`).

## Slice gate decision

PASS. Slice 4 is accepted. Phase 3 minds may begin, retaining the audit's authority split and requiring the same build, unit, deterministic-replay, browser-flow, visual-inspection, durable-video, and expectation-to-timecode gate before the final 15-20 minute playthrough.
