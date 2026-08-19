# Dispatch P3-15d — Two cards, exact text: the cold open is truncated

## Your role — the leash

SOLE IMPLEMENTER. Synchronous. NEVER spawn subagents. NEVER run git. Minimal diff on `scripts/shoot-reel.mjs` (and only if unavoidable, the photo-card CSS). No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. 3 failed attempts → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. The sweep fix is accepted — HUD is gone, village scale and the ticking kicker are right. Do not touch sweeps, held beats, ticks, durations, or the assemble/trim path.

## The two defects (orchestrator read `evidence-videos/reel-contact-sheet.png`)

1. **Beat 1 is truncated mid-sentence.** Frames 0–2 render `24 villagers. 6 of them think with an LLM. Nobody wrote their` and stop — "behavior." is cut. Cause: a 3-sentence string was passed as the card's *headline*, which is designed for a short line and clamps.
2. **Beat 9 reads weaker than the payoff card.** Frames 48–50 are a narrow column of small type; frames 43–47 (the board) are bold and wide. They should feel like the same title card.

## The fix — use the card as designed (kicker / short headline / subtitle)

Pass these EXACT strings:

**Beat 1** (cold open, village scale, 3.0s):
- headline: `24 villagers. 6 think with an LLM.`
- subtitle: `Nobody wrote their behaviour.`

**Beat 9** (end card, 3.0s):
- headline: `What happened when we changed what they could see`
- subtitle: *(none)*

Requirements:
- Neither card may truncate, ellipsize, or wrap to more than **2 lines** at 1920×1080 or at 1080×1920. If the 9:16 width forces 3 lines on beat 9's headline, allow 3 lines there but no clipping.
- Beat 9 gets the same type scale and card width treatment as the board payoff card (the one at frames 43–47) in both aspect ratios.
- British/American spelling: use `behaviour` exactly as written above (matches the blog's copy).
- Everything else in the reel stays byte-for-byte the same shot list.

## Gates

1. Re-shoot both aspect ratios. `ffprobe` video-stream duration + dimensions quoted; total stays 46–54s.
2. **Truncation proof:** extract the full-resolution frame at the middle of beat 1 and the middle of beat 9 for BOTH aspect ratios (4 PNGs), save them as `evidence-videos/card-proof-{16x9,9x16}-{open,end}.png`, **read each one yourself**, and quote the exact text you can see in each. A gate that says "looks fine" without the quoted strings is a failed gate.
3. Regenerate `evidence-videos/reel-contact-sheet.png` + held-still table (≥3 consecutive 1-fps frames per card/beat, 2.5s allowed for the pair beat).
4. `decideCalls` before == after == 0; zero `src/sim/` edits; `npm run build` + `npm run test` green.
5. Update `evidence-videos/REEL.md`.

## Report

**CHANGED** / **GATES** (ffprobe, the 4 quoted card texts, held-still table) / **KNOWN GAPS**.
