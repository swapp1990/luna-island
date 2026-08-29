# Slice 1 acceptance — First storm scenario

Date: 2026-08-28  
Status: PASS  
Source audit: [2026-08-27 Luna Island town-builder gameplay audit](./2026-08-27-luna-island-town-builder-gameplay-audit.md)

## Audited gap addressed

The town shell previously opened as a developed, low-stakes sandbox with 24 residents, a cosmetic season label, no player objective, no deadline, no weather pressure, and no consequence for failing to build. Slice 1 replaces that opening on `/town` with a deterministic first-season scenario:

- Seven settlers arrive with four beds.
- A Day 3, 18:00 storm is announced with a live countdown.
- The player must have beds for all seven, secure a two-day food cache, and finish a sheltered freshwater well before landfall.
- Player-designated house and well sites form two-person emergency construction crews so the canonical seed is actually winnable.
- Storm pressure doubles hunger decay, increases awake fatigue, weakens sleep recovery, disables shore-water recovery, and stops natural food regrowth.
- Success at Day 4, 06:00 keeps all seven settlers.
- Missing promises at dawn trigger a deterministic exodus; the baseline failed run loses two settlers and the rendered population drops to five.
- Scenario state, prepared promises, departure ids, player commands, snapshots, saves, replay, and the state hash stay deterministic.

## Acceptance video

Durable MP4: [Luna Island — Slice 1 first storm acceptance](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T001508-luna-island-slice-1-first-storm-acceptance-2026-08-28.mp4)

Local source artifact: `D:\MyProjects\Claude\impressions-agency\products\AGENCY_RECORDINGS\recordings\2026-08-28T001508-luna-island-slice-1-first-storm-acceptance-2026-08-28.mp4`

Video integrity: H.264, 1264×624, 30 fps, 72.034 seconds, silent by design.

### Timecode checklist

| Time | Expected proof | Result |
| --- | --- | --- |
| 00:00–00:23 | First-season HUD shows 7 settlers, 4 housed, 32 food, no well, and the Day 3 storm countdown | PASS |
| 00:24–00:34 | Build menu opens; house and well are designated through the rendered player interface; construction sites are visible | PASS |
| 00:35 | Day 3 prepared state shows 8/7 beds, at least 14/14 food, 1/1 well, and five hours to landfall | PASS |
| 00:36–00:47 | Landfall switches to the blue storm countdown, visible rain/vignette, and the explicit hunger/fatigue/shore/regrowth pressure warning | PASS |
| 00:48–00:53 | Day 4 success state reads “First storm survived”; all seven settlers remain | PASS |
| 00:54–00:59 | A fresh baseline run resets to the original seven-settler opening | PASS |
| 01:00–01:12 | Failed dawn reads “Promises broken”; unmet housing/well promises remain visible; two settlers leave and population becomes five | PASS |

Visual sampling artifacts:

- `audit-reports/video-verification/slice-1-contact-sheet.png`
- `audit-reports/video-verification/slice-1-00-35-prepared.png`
- `audit-reports/video-verification/slice-1-00-39-storm.png`

## Verification

- `npm.cmd run build` — PASS.
- `npm.cmd test -- --reporter=dot --maxWorkers=4` — PASS: 45 files, 447 tests passed, 5 skipped.
- `PLAYWRIGHT_PORT=5176 npx.cmd playwright test e2e/first-storm.spec.ts e2e/town-placement.spec.ts --reporter=line` — PASS: 3 browser tests.
- Manual browser verification at `/town` — PASS for initial, prepared, storm, survived, and failed states.
- `ffprobe` stream validation — PASS.
- Contact-sheet and exact-frame inspection — PASS.

## Slice gate decision

PASS. Slice 1 is accepted. Slice 2 may begin; it must add economy legibility and player direction without weakening this scenario or its evidence contract.
