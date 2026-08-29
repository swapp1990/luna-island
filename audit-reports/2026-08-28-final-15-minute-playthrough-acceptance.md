# Final acceptance - 17:40 genre-literacy playthrough

Date: 2026-08-28  
Status: PASS  
Source: [colony-builder plan](../plans/colony-builder.md) and [town-builder gameplay audit](./2026-08-27-luna-island-town-builder-gameplay-audit.md)

## Accepted outcome

A continuous player-facing session now proves the complete town-builder foundation and Phase 3 in one deterministic town:

- The player can read the immediate First Storm threat and its housing, food, and water promises before building.
- The player designates and completes a producer, storage building, homes, a well, routes, and a civic notice board through rendered controls.
- Site bills, worker counts, output state, work priorities, site priorities, and storage filters make bottlenecks diagnosable and fixable.
- The opening build order and low-priority farm/storehouse visibly preserve survival before growth; later priority changes deliberately move the same labour between gathering and construction.
- The live storm occurs, the three promises hold, and the UI reports that every settler stayed.
- Appeal, milestone locks, an extra home, and literal candidate cards turn town quality into player-chosen growth.
- Mira and Tama enter as distinct residents. Their world positions, inspectors, biographies, aspirations, observed player facts, work, and mind-authored activity are readable.
- An emergent story is retained across world speech, Town Stories, the Chronicle, proposals, and the Board: Mira observes her invitation, chooses to socialize, and says “Stay safe out there, friend”; Tama works forestry; the minds propose protecting shared food and convene at the player-built notice board.
- The visible Mind meter holds the deterministic acceptance session to 12,000 approximate tokens. The Chronicle reconstructs a recorded decision and visibly proves zero new mind calls.
- Player authority remains construction, routes, priorities, filters, invitations, and policy surfaces. Mind authority remains personal action, conversation, opinion, proposals, and social participation.

## Accepted video

Durable MP4: [Luna Island - verified final playthrough](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/29/2026-08-28T173309-luna-island-final-playthrough-verified-2026-08-28.mp4)

Local source artifact: `D:\MyProjects\Claude\impressions-agency\products\AGENCY_RECORDINGS\recordings\2026-08-28T173309-luna-island-final-playthrough-verified-2026-08-28.mp4`

Integrity: H.264, 1264x624, 30 fps, 1060.034 seconds (17:40), 17,659,049 bytes, silent by design.

The video is one continuous tab capture with no edits or injected social outcomes. All placement, selection, priority, filter, overlay, invitation, inspector, Chronicle, replay, and Board actions use rendered controls. The disclosed QA bridge only advances deterministic simulation time between visible decisions; a lighting-only midday pose keeps the evidence readable. The deterministic mock travels through the production prompt, parse, intent, conversation, institution, token-budget, and replay paths without network/LLM calls.

### Expectation-to-timecode checklist

| Time | Expected proof | Result |
| --- | --- | --- |
| 00:00-00:35 | The opening surface names `Shelter the settlement`, the First Storm deadline, 7 settlers, and the missing housing/food/water promises before the player acts | PASS |
| 00:35-01:05 | Growth explains Appeal/milestones and the build catalog exposes the producer, storage, home, well, forestry, quarry, market, and civic ladder | PASS |
| 01:15-03:05 | The player designates a home and well at high site priority, then a farm at low priority; each real site exposes crew, bill, deliveries, remaining materials, and progress | PASS |
| 03:10-03:45 | Town work priorities are opened and food/building are raised, visibly directing shared labour instead of directly puppeteering residents | PASS |
| 03:50-04:15 | Repeated world clicks paint a persistent logistics route and the Routes overlay distinguishes it in world space | PASS |
| 04:15-04:45 | The completed farm is inspected for workers, output, inventory, and status, proving a player-built producer rather than a placement ghost | PASS |
| 04:45-06:10 | A player storehouse is designated at low priority; the inspector shows its bill/stall state and the rendered food stockpile filter is toggled | PASS |
| 06:20-07:45 | The live storm state remains visible while Needs, Homes, and Water overlays show the settlement under pressure | PASS |
| 07:50-08:20 | `FIRST STORM SURVIVED`, 7/7 beds, 14/14 food, 1/1 well, and `Every settler stayed` visibly close the pressure event | PASS |
| 08:20-10:40 | The player alternates gathering/build priorities, completes a notice board, and commissions its materialized upgrade as the civic/growth foundation | PASS |
| 10:45-13:10 | A new home and the low-priority storage/upgrade backlog expose a real remaining-material/worker bottleneck; the player restocks, switches to construction-first, and the sites complete | PASS |
| 13:15-14:05 | Literal Growth candidate cards are used to invite Mira and Tama; population/housing update and both named biographies open from the world | PASS |
| 14:20-15:50 | World speech, Town Stories, Mira's `I noticed… I should socialize` reasoning, Tama's work activity, and both inspectors identify at least two residents and a retellable Luna story | PASS |
| 16:00-16:20 | Chronicle visibly joins recorded mind moments with the conversation line | PASS |
| 16:30 | The Chronicle visibly reports `Replayed from the town record · zero new mind calls` while the 12,000-token Mind ceiling remains in the HUD | PASS |
| 16:48 | The scrolled Town Board visibly lists `Assembly at the notice board`, tying a mind-originated civic event to the player-built environment | PASS |
| 17:00-17:40 | The resources overlay and final readable town hold on 9/9 housed, 98 Appeal, survived challenge, speech, activities, and the complete product surface | PASS |

Visual inspection artifacts:

- `audit-reports/video-verification/final-playthrough/verified-contact-sheet-30s.png`
- `audit-reports/video-verification/final-playthrough/verified-frame-990.png` - visible zero-call replay proof
- `audit-reports/video-verification/final-playthrough/verified-frame-1008.png` - visible notice-board assembly proof
- `audit-reports/video-verification/final-playthrough/dry-run-final.png`
- `audit-reports/video-verification/final-playthrough/run_final_playthrough.py`

## Final verification

- Production build - PASS: TypeScript clean and 162 modules transformed.
- Unit suite, two clean thread shards - PASS: 48 files, 462 tests passed, 5 skipped (467 total).
- Full town browser suite - PASS: 9 tests across first storm, economy/direction, placement, legibility, growth, and minds.
- Focused Phase 3 browser rerun after the last source edit - PASS: two distinct minds, dialogue, proposal, notice-board assembly, biography/opinion, bounded budget, and zero-call replay.
- Stable legacy wild hash - PASS: `P4_7_WILD_HASH_T0 c10ec3d7`.
- Deterministic final driver - PASS with exit code 0, including viewport-level assertions for the replay and assembly proof.
- Encoded-frame inspection, duration check, and public S3 object verification - PASS.

## QA findings resolved before acceptance

1. The first long rehearsal discovered a real survival-versus-growth failure: building the farm before shelter/water consumed starter materials and caused an exodus. The accepted order protects home/well first and leaves growth investments low priority.
2. The full-town run exposed a labour/material stall: gathering and building were tied at high priority while the extra home still needed wood. The accepted sequence reads the bill, restocks, switches to construction-first, and verifies the completed home/storage backlog.
3. A long full-town prompt could spend the bounded mock session on solitary decisions before two minds aligned socially. Town-grounded mock prompts now reserve most choices for social activity; non-town mock behavior remains unchanged and its long-run pacing regression passes.
4. The first 19-minute capture was rejected after frame inspection because the successful replay and assembly records were below their panel folds. The accepted take adds viewport assertions and visibly holds both proof lines at 16:30 and 16:48.

## Slice/video completion ledger

| Gate | Acceptance report | Durable video | Status |
| --- | --- | --- | --- |
| Slice 1 - First Storm | [report](./2026-08-28-slice-1-first-storm-acceptance.md) | [video](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T001508-luna-island-slice-1-first-storm-acceptance-2026-08-28.mp4) | PASS |
| Slice 2 - Economy/player direction | [report](./2026-08-28-slice-2-economy-player-direction-acceptance.md) | [video](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T123220-luna-island-slice-2-economy-player-direction-acceptance-2026-08-28.mp4) | PASS |
| Slice 3 - Readable town surface | [report](./2026-08-28-slice-3-readable-town-surface-acceptance.md) | [video](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T130113-luna-island-slice-3-readable-town-surface-acceptance-2026-08-28.mp4) | PASS |
| Slice 4 - Growth/mind readiness | [report](./2026-08-28-slice-4-growth-mind-ready-society-acceptance.md) | [video](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T140201-luna-island-slice-4-growth-mind-ready-acceptance-2026-08-28.mp4) | PASS |
| Phase 3 - Minds move in | [report](./2026-08-28-phase-3-minds-move-in-acceptance.md) | [video](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T153716-luna-island-phase-3-minds-move-in-acceptance-2026-08-28.mp4) | PASS |
| Final 17:40 playthrough | this report | [video](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/29/2026-08-28T173309-luna-island-final-playthrough-verified-2026-08-28.mp4) | PASS |

## Gate decision

PASS. All audited town-builder gaps in the goal, every slice-level video/checklist gate, Phase 3, and the final 15-20 minute genre-literacy playthrough are accepted.
