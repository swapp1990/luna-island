# Phase 3 acceptance - Minds move in

Date: 2026-08-28  
Status: PASS  
Source: [colony-builder plan](../plans/colony-builder.md) and [town-builder gameplay audit](./2026-08-27-luna-island-town-builder-gameplay-audit.md)

## Implemented contract

- Invited Luna residents run through `LunaBrainService` inside the player town and remain subject to its housing, work, food, water, ownership, and construction economy.
- A hard, visible 12,000 approximate-token session ceiling prevents additional provider dispatch after the budget is reached.
- Character inspectors expose persona, aspiration, current action/reason, town-specific mind reasoning, needs, home, work, belongings, observed player facts, and relationships.
- Mind reasoning explicitly responds to real player-authored facts. The player still owns construction, routes, priorities, and policy surfaces; residents own personal and social actions.
- Recent conversation lines appear as clickable world speech over their speakers and are retained in Town Stories and the Chronicle.
- The Chronicle joins decisions, conversation lines, and trace replay. `Revisit latest mind moment` reconstructs the recorded tick with `Simulation.stateAt` and proves the provider call count did not change.
- Mind-originated proposals schedule assemblies at the player-built notice board in the first-season town; the Board retains the assembly record alongside proposals and rules.
- Mock acceptance behavior is deterministic but travels through the same prompt, parse, intent, institution, conversation, token-budget, and replay paths as a live provider.

## Acceptance video

Durable MP4: [Luna Island - Phase 3 minds move in acceptance](https://swapp1990-template-gen.s3.us-west-2.amazonaws.com/2026/08/28/2026-08-28T153716-luna-island-phase-3-minds-move-in-acceptance-2026-08-28.mp4)

Local artifact: `D:\MyProjects\Claude\impressions-agency\products\AGENCY_RECORDINGS\recordings\2026-08-28T153716-luna-island-phase-3-minds-move-in-acceptance-2026-08-28.mp4`

Integrity: H.264, 1264x624, 30 fps, 90.034 seconds, silent by design.

The take begins from a deterministic prepared town because Slices 1-4 already prove the complete build/survival/growth path. No social outcome is injected: the two residents, decisions, speech, proposal, assembly record, budget use, and replay result are produced by the live simulation and production mind service.

### Timecode checklist

| Time | Expected proof | Result |
| --- | --- | --- |
| 00:08 | The survived player town contains 9 housed settlers, world speech, Town Stories, and a visible `Mind mock` token meter capped at 12,000 | PASS |
| 00:23 | Mira opens from the world as a named resident with a distinct biography/aspiration and town-specific mind reasoning beginning `I noticed…` | PASS |
| 00:31 | Mira's lower biography exposes home/work/belongings, player-made facts observed, and relationship state | PASS |
| 00:39 | A clickable speech bubble selects its speaker, tying a literal conversation line to a resident in the world | PASS |
| 00:48 | Tama opens as a second distinct biography rather than anonymous population | PASS |
| 01:00 | Chronicle shows recorded mind moments and conversation lines as a readable story arc | PASS |
| 01:10 | `Revisit latest mind moment` reports `Replayed from the town record · zero new mind calls` | PASS |
| 01:19 | Town Board exposes the mind-originated civic record and the assembly tied to the built notice board | PASS |

Evidence: `audit-reports/video-verification/slice-5/contact-sheet.png`, `run_acceptance_interactions.py`, and `audit-reports/slice-5-browser-final.png`.

## Verification

- Production build: PASS, TypeScript clean, 162 modules transformed.
- Focused mind/conversation/institution/growth tests: PASS, 80 passed and 1 skipped.
- `e2e/town-minds.spec.ts`: PASS with two distinct mind IDs, conversation records, a proposal, notice-board assembly history, biographies, town opinions, token meter, and zero-call replay.
- Encoded-frame inspection and durable upload: PASS.

## Gate decision

PASS. Phase 3 is accepted. The goal remains active until the final 15-20 minute genre-literacy/regression playthrough is recorded and its retellable Luna story, deterministic replay, and no-new-call proof pass.
