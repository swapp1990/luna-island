# Slice 3 acceptance - Readable town surface

Date: 2026-08-28  
Status: PASS  
Source audit: [2026-08-27 Luna Island town-builder gameplay audit](./2026-08-27-luna-island-town-builder-gameplay-audit.md)

## Audited gaps addressed

Slice 3 turns the town into the default, readable player surface and makes resident life, settlement pressure, placement rules, and Luna-mind civic activity visible in one place:

- `/` now opens the playable town. The legacy mind observer remains available at `/observer`, including compatibility redirection for old `?brain=` links.
- The town pulse reports housed residents, food runway in days, actionable problems, and recent town stories without exposing implementation metadata.
- Actionable resident and construction badges appear in the world and connect to the matching alert or inspector.
- Residents can be selected from the world or an alert. Their inspector shows current action and reason, needs, home, work, wallet, carried items, and closest relationship.
- Hovering a resident or place produces a plain-language world label.
- The town board provides the player-facing surface for Luna-mind proposals and standing rules, including explicit empty states before minds have posted anything.
- Needs, housing, and jobs overlays turn settlement health into useful world-space rings rather than dashboard-only numbers.
- The construction catalog remains one coherent player surface with all eight existing build choices.
- Trees are now exact placement obstacles for building footprints and path tiles. Invalid placement shows a red ghost and a specific `Trees block this footprint` reason.
- Player-painted paths use a stronger visual treatment while generated travel wear remains organic, avoiding the grid-like terrain artifact found during visual QA.
- Construction sites expose staged geometry, world badges, alerts, crew counts, material shortages, build progress, and full bill diagnostics together.
- Dawn and night have a gameplay visibility floor: buildings, residents, objective, resources, pulse, and alerts remain readable while the scene retains its time-of-day atmosphere.
- The legacy deterministic wild-simulation hash remains `c10ec3d7`.

## Acceptance video

Durable MP4: [Luna Island - Slice 3 readable town surface acceptance](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T130113-luna-island-slice-3-readable-town-surface-acceptance-2026-08-28.mp4)

Local source artifact: `D:\MyProjects\Claude\impressions-agency\products\AGENCY_RECORDINGS\recordings\2026-08-28T130113-luna-island-slice-3-readable-town-surface-acceptance-2026-08-28.mp4`

Video integrity: H.264, 1264x624, 30 fps, 115.067 seconds, silent by design.

The recording opens the actual root route. All resident selection, alert, overlay, board, build, obstacle, path-painting, and construction interactions use rendered player-facing controls. The only QA overrides are the lighting-clock poses used at the end to prove daylight, night, and dawn readability without waiting through a full simulation day.

### Timecode checklist

| Time | Expected proof | Result |
| --- | --- | --- |
| 00:18 | The actual 06:00 root town view keeps the first-season objective, deadline, resources, named residents, town pulse, actionable housing problem, food runway, and town stories readable together | PASS |
| 00:25 | Daylight pose preserves the same coherent product surface and makes world buildings, residents, terrain, and controls visually distinct | PASS |
| 00:28 | Clicking the actionable housing alert opens Kiba's resident inspector with literal work reason, needs, home, work, wallet, and carrying state | PASS |
| 00:38 | Hovering and selecting Kiba directly in the world shows a named, plain-language action label and the same resident biography | PASS |
| 00:47 | Needs overlay shows a separate world ring for every visible resident | PASS |
| 00:53 | Housing overlay distinguishes the housed building from unhoused residents with world-space status rings | PASS |
| 00:56 | Jobs overlay marks active workplaces and their town-space relationship | PASS |
| 01:02 | Town board opens inside the town pulse with explicit proposal and standing-rule empty states ready for Luna minds | PASS |
| 01:10 | One construction catalog exposes all eight build choices in the same player surface | PASS |
| 01:14 | A house ghost placed over the canopy turns red and reports `Trees block this footprint`; no hidden placement occurs | PASS |
| 01:30 | Repeated canvas clicks paint a connected, visibly stronger logistics path and report the laid tile | PASS |
| 01:40 | A designated farm site shows its staged model and world badge while the alert and inspector expose 2/2 workers, 0% progress, material wait reason, and full bill | PASS |
| 01:48 | Night pose retains readable buildings, residents, objective, resources, pulse, alerts, stories, and construction badges | PASS |
| 01:54 | Dawn pose retains the same gameplay legibility without exposing the generated-path grid artifact rejected during QA | PASS |

Visual sampling artifacts:

- `audit-reports/video-verification/slice-3/contact-sheet.png`
- `audit-reports/video-verification/slice-3/proof-keyframes.png`
- `audit-reports/video-verification/slice-3/frame-018.png` through `frame-114.png`
- `audit-reports/video-verification/slice-3/run_acceptance_interactions.py`

Manual browser evidence:

- `audit-reports/slice-3-browser-initial.png`
- `audit-reports/slice-3-browser-daylight.png`
- `audit-reports/slice-3-browser-dawn-v2.png`
- `audit-reports/slice-3-browser-night.png`
- `audit-reports/slice-3-browser-resident-needs.png`
- `audit-reports/slice-3-browser-board-v2.png`
- `audit-reports/slice-3-browser-tree-blocked.png`
- `audit-reports/slice-3-browser-site-marker.png`

## Verification

- `npm.cmd run build` - PASS on the exact recorded source: 161 modules transformed; root, observer, and town entry points emitted.
- `npm.cmd test -- --reporter=dot --maxWorkers=4` - PASS: 47 files, 456 tests passed, 5 skipped (461 total).
- `PLAYWRIGHT_PORT=5176 npx.cmd playwright test e2e/first-storm.spec.ts e2e/town-placement.spec.ts e2e/economy-direction.spec.ts e2e/town-legibility.spec.ts --reporter=line --retries=0` - PASS: 6 browser tests in 8.9 seconds.
- Slice 3 unit coverage - PASS for town vitals, deterministic story fallback, resident biography, overlays, tree-footprint/path blocking, and day/night visibility floors.
- Manual browser verification at `/` - PASS for the default product route, readable lighting, resident inspection, hover labels, overlays, town board, exact tree collision, stronger player paths, and construction-site diagnostics.
- Legacy observer verification at `/observer` - PASS.
- Stable legacy simulation hash - PASS: `P4_7_WILD_HASH_T0 c10ec3d7`.
- `ffprobe` stream validation - PASS.
- Contact-sheet and exact-frame inspection - PASS.
- Durable S3 upload - PASS.

## QA finding resolved before acceptance

The first visual pass exposed generated travel wear as an artificial square grid after the new path treatment was applied globally. The styling was narrowed to player-painted paths only, the final dawn/night screenshots and video were rechecked, and the grid artifact is absent from the accepted take.

## Slice gate decision

PASS. Slice 3 is accepted. Slice 4 may begin, using the audit as its implementation contract and retaining the same build, unit, browser-flow, visual-inspection, and durable-video evidence gate before Slice 5 starts.
