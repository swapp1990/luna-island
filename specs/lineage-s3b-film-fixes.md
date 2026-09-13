# Dispatch LINEAGE-S3b — Film fixes after independent QA

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run any `git` command. No LLM calls (re-run local `hyperframes tts` only if a narration line changes). Edit only `videos/lineage-experiment-01/**` and `audit-reports/lineage-s3b-report.md`. Stop honestly after 3 failed attempts at any gate.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `specs/lineage-s3-board-film.md` (still the contract), `audit-reports/lineage-s3-report.md` (what you built), `artifacts/lineage-site/film/QA-verdict.md` (the independent verdict this dispatch answers), and the two stills that show the problem: `videos/lineage-experiment-01/out/stills-main/t70.png` and `t88.png` if present.

## Defects (numbered; fix all)

1. **Scene 6 "7 of 8 gave" is a wall of raw table text.** The C1 footage (the site's analysis panel) plays full-bleed: tiny table cells and literal markdown pipes, with a small badge in the corner. A board member cannot read a result off it. Replace with a **designed result card** centred on a `#14120f` field: headline "7 of 8 gave" (Inter 120 px, teal), sub-line "when a well-fed villager could see a starving neighbour" (36 px, ink), then a 2×2 table at 30 px: rows "generous villagers" / "ungenerous villagers", columns "genome shown" / "genome hidden", cells "7 of 8", "7 of 8", "2 of 3", "1 of 3" (claims C7, C8 and the low-band numbers from `audit-reports/lineage-b-report.md` §"Offline probes"; add them to the report's claims table as C11 "2 of 3" and C12 "1 of 3"). C1 footage may remain as a backdrop at ≤ 18% opacity with a 6 px blur, or be dropped. Headline draws in with the count-up rule from `hyperframes-animation` (cite the rule) over 1.2 s, then holds still ≥ 4 s. The quote card that follows stays as it is.
2. **Scene 5 "0 of 8 traits expressed" beat has the same problem** (B4 footage full-bleed). Replace with a designed card: headline "0 of 8" (120 px, ember), sub-line "inherited temperaments that reached behaviour", and the eight trait names in a 2×4 grid, each with a muted "no" mark (generosity, voice, thrift, curiosity, temper, loyalty, boldness, caution). B4 backdrop ≤ 18% opacity or dropped. Hold ≥ 3 s.
3. **Corner badges** ("158 of ~350 turns: failed eats", "7 of 8 gave", "64×") are small boxed labels in the top-left. Make them one consistent component: Inter 34 px, ink on a 92% opaque `#14120f` pill with a 1 px accent border (the QA verdict found footage header text ghosting through at 70%), 32 px from the top-left, never overlapping the site's own status strip text underneath (offset below it if needed). Keep the "158 of ~350 turns" badge on B1; drop the "7 of 8 gave" badge since the card now carries it.
4. **Scene 4 control line.** Your report is right that yield 0.6 slopes (0.503→0.434). Plot **yield 1.0** (`replicate-20260907-1807/aggregate.json`, n = 20) as the steady control instead of 0.6, label the lines "yield 0.5 · 40 repeats" and "yield 1.0 · 20 repeats", and change the on-screen claim to "metabolism falls under scarcity (yield 0.5); holds steady with plenty (yield 1.0)". Update claim C4 in the report accordingly. Narration is unchanged.
5. **No looped footage.** A3, B1, and B3 have been re-recorded longer than their windows (`public/footage/A3.mp4` ≈ 9.1 s, `B1.mp4` ≈ 6.9 s, `B3.mp4` ≈ 9.1 s, now at 8× for B3). Remove the second/fourth `<video>` loop copies and play each source once, `data-media-start="0"`. Read the new durations with ffprobe before setting `data-duration`; the protected windows stay as in S3 §2.
6. **Anything else the QA verdict lists as ACCEPT WITH FIXES**, each at its timestamp, in the order given.
7. **Write `videos/lineage-experiment-01/STORYBOARD.md`** with one `## Frame N` block per scene (N = 1…7) in the `hyperframes-core/references/storyboard-format.md` shape: `status: built`, `src: compositions/sN-….html`, start and duration after voice override, the beat text (narration sentence list), the on-screen claims by id, and the protected footage window. This is the dispatch record the delegated-approval rule requires; it must match what is rendered, not the original plan.

## Gates (same as S3 §7)

`npx hyperframes lint` → `npx hyperframes check` → `npx hyperframes render --quality high --output out/lineage-experiment-01-16x9.mp4` → ffprobe video and audio streams → 1 fps contact sheet `out/lineage-experiment-01-16x9-sheet.png` → midpoint stills into `out/stills/`. Confirm scenes 6 and 5 hold their cards still for the stated seconds and that no protected footage window went black or frozen (`ffmpeg -vf freezedetect=n=0.001:d=2.5` list in the report, mapped to scenes). Total duration must stay within 88–100 s.

## Report (`audit-reports/lineage-s3b-report.md`)

What changed per defect; the updated claims table with C11/C12; lint/check/render/ffprobe outputs; freeze list mapped to scenes; stills list; anything not fixed and why.
