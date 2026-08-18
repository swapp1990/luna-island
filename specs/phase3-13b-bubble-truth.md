# Dispatch P3-13b — The bubble isn't in the pixels: fix shot 01 and prove it with crops

## Your role — the leash

SOLE IMPLEMENTER. Synchronous. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diff. 3 failed attempts → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. This is a defect round on your P3-13 work — the working tree is uncommitted, continue on it.

## The defect (orchestrator's pixel evidence)

Your report claims shot 01 "bubble shows utterance text; they face each other." The orchestrator cropped the shipped still (`artifacts/highlights/crop-01-bubble.png`, from `01-mind-say-D1-0634.png`): there is **NO speech bubble anywhere in the frame**. Additionally the subject ring sits on a **woolly (sheep) villager**, but Tama — the speaker, per the caption — is a Luna mind (scarf + hair): either the ring is on the wrong agent or the speaker identification is wrong.

Your own mid-run diagnosis is the prime suspect: "place-hero shots clear agent selection, so `photoSubjectId` goes null and 3D speech/glyphs never draw" — you fixed shoot A, then shot B last. The final directory may hold frames where that path regressed, or the sprite draws behind/above the frame, or the second shoot re-posed with a different selection. Diagnose properly — do not guess-fix.

## Requirements

1. Find the actual root cause of the missing bubble in the FINAL shipped stills (not in an intermediate shoot). State it in one sentence with the code path.
2. Fix so that for `mind:say` moments: the speaker carries a legible 3D bubble sprite with the utterance text, positioned above the head, camera-facing, not clipped by the frame at hero distance, visible from the chosen azimuth (if the default pose puts the bubble off-frame or occluded, the framing must account for the bubble's world-space bounds).
3. The subject ring must sit on the SPEAKER named first in the caption; both participants face each other (your facing work — verify it survived).
4. Determinism: two consecutive shoots must produce the same pixels for shot 01's bubble region (manifest identity is NOT sufficient — that was this defect's blind spot).

## Gates (pixel proof or it didn't happen)

1. `npm run build` exit 0; `npm run test` pass; `e2e/interaction-staging.spec.ts` + `e2e/photo.spec.ts` pass; zero `src/sim/` edits; `utilityBrain.ts` SHA unchanged.
2. Re-shoot the reel. Then produce and SAVE crops (PowerShell System.Drawing or a tiny node script — your choice):
   - `artifacts/highlights/proof/01-bubble-crop.png` — the bubble with readable text, from the final `01-*.png`
   - `artifacts/highlights/proof/02-glyph-crop.png` — the 🔍 over the bush from `02-*.png`
   - `artifacts/highlights/proof/10-ceremony-crop.png` — stakes + flag from `10-*.png`
   Read each crop yourself and describe what is ACTUALLY in the pixels — report claims must match crops.
3. Shoot twice; byte-compare the three cropped regions across shoots (identical, or explain any benign variance you find and why it can't hide a missing bubble).

## Final report

**ROOT CAUSE** (one sentence + code path) / **FIXED** / **GATES** / **CROPS** (paths + what each actually shows) / **KNOWN GAPS**.
