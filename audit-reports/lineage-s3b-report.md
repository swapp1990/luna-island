# LINEAGE-S3b report — film fixes after independent QA

Answers `artifacts/lineage-site/film/QA-verdict.md` (ACCEPT WITH FIXES). Edits only under `videos/lineage-experiment-01/**` and this file. No git. No TTS (narration unchanged). HyperFrames pin `0.8.36` = latest; no bump.

## What changed per defect

### 1. Scene 6 “7 of 8 gave” was a wall of raw table text (QA Fix 1)

C1 was the same expression table as B4 (QA verified with `blend=difference`). Dropped C1 rather than run it at 18% — a ghost of “0 of 8” under “7 of 8 gave” would keep the contradiction. Replaced the beat with a designed card on `#14120f`:

- Headline “7 of 8 gave”, Inter 120 px, teal `#4fb3a6`
- Sub-line “when a well-fed villager could see a starving neighbour”, 36 px ink
- 2×2 table at 30 px: rows generous / ungenerous villagers; columns genome shown / genome hidden; cells **7 of 8**, **7 of 8**, **2 of 3**, **1 of 3**
- Motion: **counting-dynamic-scale** (`hyperframes-animation/rules/counting-dynamic-scale.md`) — proxy `0→7` + scale `0.5→1` share 1.2 s, `power2.out`, `tabular-nums`, `Math.round`; suffix slides after the count (no `back.out`, film forbids bounce). Then still.

Freeze-detect records **4.2 s** of still card (67.733–71.933) after the count, which is ≥ 4 s. Caption-2 at 71.911 then breaks the freeze window; the card itself stays until the quote at 74.265 (local 8 s). Quote card unchanged.

### 2. Scene 5 “0 of 8 traits expressed” was the same full-bleed table

Dropped B4. Designed card: headline “0 of 8” (120 px ember), sub-line “inherited temperaments that reached behaviour”, 2×4 grid of generosity / voice / thrift / curiosity / temper / loyalty / boldness / caution, each with a muted “no”. Fade 0.45 s from local 12 s, then holds 12.45–16.395 = **3.95 s ≥ 3 s**. The s5-zero corner badge is gone; the card carries C6.

### 3. Corner badges

One component in s3 / s5 / s7: Inter 34 px, ink `#e9dfc8` on `rgba(20,18,15,0.92)`, 1 px accent border, pill radius, `white-space: nowrap`. Left 32 px. Top 32 px on s3 (sits in the margin above the laptop, not on the site strip). Top 56 px on s5 B1 and s7 B3 so the site status line (“Season N · Day D · …”) stays visible above the pill. Kept “158 of ~350 turns: failed eats” on B1 and “64×” on s3. Dropped “7 of 8 gave” (the card now carries it). S7 “same hamlet, genome removed: 7 of 8 gave too” uses the same pill.

### 4. Scene 4 control line

Yield 0.6 slopes 0.503→0.434 (n = 20). Plotted **yield 1.0** from `replicate-20260907-1807/aggregate.json` (n = 20) as the steady control. Labels “yield 0.5 · 40 repeats” and “yield 1.0 · 20 repeats”. On-screen claim: “metabolism falls under scarcity (yield 0.5); holds steady with plenty (yield 1.0)”. C4 updated. Narration unchanged.

Same y-map as S3: `y = 70 + (0.56 − v) × (450 / 0.31)`, x = `80 + gen × 130`. Re-derived means (field `courtship[i].traitMeansByGeneration.metabolism`):

**yield 0.5** `replicate-y0.5-20260907-181338` n = 40:

| gen | mean |
|---|---|
| 0 | 0.498611 |
| 1 | 0.489236 |
| 2 | 0.448264 |
| 3 | 0.417708 |
| 4 | 0.386806 |
| 5 | 0.365972 |
| 6 | 0.343750 |
| 7 | 0.322222 |
| 8 | 0.286458 |

**yield 1.0** `replicate-20260907-1807` n = 20 (now plotted):

| gen | mean |
|---|---|
| 0 | 0.502778 |
| 1 | 0.515972 |
| 2 | 0.495139 |
| 3 | 0.503472 |
| 4 | 0.497222 |
| 5 | 0.500000 |
| 6 | 0.502778 |
| 7 | 0.499306 |
| 8 | 0.490278 |

Ctrl path: `M80.0,153.1 L210.0,133.9 L340.0,164.2 L470.0,152.1 L600.0,161.1 L730.0,157.1 L860.0,153.1 L990.0,158.1 L1120.0,171.2`. Yield 0.5 path unchanged.

### 5. No looped footage

ffprobe of `public/footage/` before setting `data-duration`:

| file | duration (s) | window | play |
|---|---|---|---|
| A3.mp4 | 9.266667 | s3 local 4–12 (8 s) | one `<video>`, `data-media-start="0"`, `data-duration="8"` |
| B1.mp4 | 7.033008 | s5 local 0–6 | one `<video>`, `data-media-start="0"`, `data-duration="6"` |
| B3.mp4 | 9.300000 | s7 local 0–8 | one `<video>`, `data-media-start="0"`, `data-duration="8"` |

Removed A3’s four copies, B1’s second copy, B3’s second copy. Protected windows stay as S3 §2. Render extracted **6** videos (A1, A2, A3, B1, B2, B3) — B4 and C1 no longer placed.

### 6. Remaining QA ACCEPT WITH FIXES items

- **Fix 1 (t ≈ 62–74):** designed cards, not the duplicated expression table. C1 was not re-captured; it is unused.
- **Fix 2 (t ≈ 66.3–74.3 and 82.3–90.3):** 92% opaque pills. S6 badge removed. S7 badge no longer ghosts “REPLAY VERIFIED” / season text through the fill.
- **Nice-to-have:** S4 means re-derived against the JSON (tables above) and the flat arm is now yield 1.0.

### 7. STORYBOARD.md

`videos/lineage-experiment-01/STORYBOARD.md` — seven `## Frame N` blocks, `status: built`, `src: compositions/sN-….html`, voice-override start/duration, beat sentences, claims by id, protected footage windows as rendered (B4/C1 dropped).

## Claims on screen

| id | text on screen | source | shown at |
|---|---|---|---|
| C1 | 12 villagers · 5 rooms · 30 genes → 12 traits | plans/lineage.md §2–§3 | s2 cards |
| C2 | every ten days a generation passes | plans/lineage.md §2 | s2 line from local 7.8 s |
| C3 | 64× speed | site speed chip + overlay pill | s3 pill + A1/A2 chrome |
| C4 | metabolism falls under scarcity (yield 0.5); holds steady with plenty (yield 1.0); yield 0.5 · 40 repeats; yield 1.0 · 20 repeats; 8 generations | lineage-a-report.md; aggregates above | s4 title, claim, legend |
| C5 | 158 of ~350 turns: failed eats (gate 1) | lineage-b-report.md Gate 1 | s5 pill 1.5–5.0 s local |
| C6 | 0 of 8 traits expressed | lineage-b-report.md Gate 2 / Gate 3 | s5 card 12–16.395 s local |
| C7 | 7 of 8 gave (surplus + visible hunger, DNA on) | lineage-b-report.md Offline probes | s6 headline + table “genome shown / generous” |
| C8 | 7 of 8 gave with the genome removed | same | s6 table “genome hidden / generous”; s7 pill |
| C9 | quote “I stand by my people, and Arin is starving. I can spare a meal's grain before I work again.” — Xan Ember | artifacts/lineage/probes/synth-low-dnaon-*.md | s6 quote 8–16 s local |
| C10 | github.com/swapp1990/luna-island | public repo | s7 end card 8–14 s local |
| C11 | 2 of 3 (low-generosity, surplus + visible hunger, DNA on) | lineage-b-report.md Offline probes | s6 table “genome shown / ungenerous” |
| C12 | 1 of 3 (low-generosity, surplus + visible hunger, DNA off) | same | s6 table “genome hidden / ungenerous” |

No other authored numerals. Footage still carries the live UI’s own numbers (untouched recordings).

## Final per-scene start / duration (unchanged after voice override)

| scene | start | dur | end |
|---|---|---|---|
| s1-title | 0.000 | 8.864 | 8.864 |
| s2-setup | 8.864 | 12.427 | 21.291 |
| s3-hamlet | 21.291 | 15.000 | 36.291 |
| s4-generations | 36.291 | 13.579 | 49.870 |
| s5-minds | 49.870 | 16.395 | 66.265 |
| s6-finding | 66.265 | 16.000 | 82.265 |
| s7-coda | 82.265 | 14.000 | 96.265 |

Host `data-duration="96.265"`. Encoded video stream 96.266667 s (inside 88–100 s).

## Lint

First pass: 1 error `unclosed_tag_swallowed_element` on s6 (`<span id="s6-count">` split across lines). Closed the tag. Second pass:

```
◆  Linting lineage-experiment-01/8 files

  ⚠ nested_media_start_basis_ambiguous  (3 findings: s3-a2, s3-a3, s5-b2)
    Fix: Keep data-start if composition-local.

◇  0 error(s), 3 warning(s)
```

The three warnings are scene-local `data-start` on nested `<video>` (A2 at 8, A3 at 4, B2 at 6). Not converted to `data-hf-media-start-basis="global"`. Loop-copy warnings from S3 are gone.

## Check

`npx hyperframes check --json --snapshots` — exit 0.

```
ok: true
lint:     { ok: true, errorCount: 0, warningCount: 3 }
runtime:  { ok: true, errorCount: 0, findings: 0 }
layout:   { ok: true, errorCount: 0, findings: 0, duration: 96.265,
            samples: [5.348, 16.044, 26.74, 37.436, 48.133, 58.829, 69.525, 80.221, 90.917] }
motion:   { ok: true, enabled: false }
contrast: { ok: true, checked: 29, passed: 29,
            samples: [5.348, 26.74, 48.133, 69.525, 90.917] }
```

Check is structural only. Picture evidence is the sheet, stills, and freeze list.

## Render

```
npx hyperframes@0.8.36 render --quality high --output out/lineage-experiment-01-16x9.mp4
```

Exit 0. Excerpt:

```
durationSeconds: 96.265, totalFrames: 2888
videoCount: 6
… 2888/2888 frames, captureMode=drawelement
◇  out/lineage-experiment-01-16x9.mp4
   25.3 MB · 1m 36.3s video · rendered in 1m 58.7s
```

## ffprobe (verbatim)

Video stream:

```json
{
  "codec_name": "h264",
  "width": 1920,
  "height": 1080,
  "r_frame_rate": "30/1",
  "duration": "96.266667",
  "nb_frames": "2888"
}
```

Audio stream:

```json
{
  "codec_name": "aac",
  "sample_rate": "48000",
  "channels": 2,
  "duration": "96.266000",
  "nb_frames": "4514"
}
```

Format: duration `96.266667`, size `26504172`, bit_rate `2202562`.

## Freeze detect (`ffmpeg -vf freezedetect=n=0.001:d=2.5`)

Mapped to scenes. Protected footage windows that must not freeze: A1 21.291–29.291, A3 25.291–33.291, A2 29.291–36.291, B1 49.870–55.870, B2 55.870–61.870, B3 82.265–90.265.

| freeze_start | freeze_end | dur (s) | scene | note |
|---|---|---|---|---|
| 3.300 | 8.067 | 4.77 | s1 | title hold — expected |
| 11.000 | 14.167 | 3.17 | s2 | cards hold — expected |
| 17.933 | 21.300 | 3.37 | s2 | generation line hold into s3 cut — expected |
| 37.167 | 42.133 | 4.97 | s4 | chart still (after draw-in) — expected |
| 42.200 | 46.567 | 4.37 | s4 | chart still; caption change split the window — expected |
| 46.567 | 49.900 | 3.33 | s4 | chart still to s5 — expected |
| 67.733 | 71.933 | 4.20 | s6 | designed card still after count-up **≥ 4 s** — required |
| 75.067 | 80.733 | 5.67 | s6 | quote hold ≥ 5 s — expected |
| 90.800 | 95.200 | 4.40 | s7 | end card — expected |

No freeze inside any protected **footage** window. s3, s5 B1/B2, and s7 B3 are clean.

s5 card (61.870–66.265) does not trip the 2.5 s detector: fade ends ~62.32, caption-6 starts 64.444, so the still card is split into 2.12 s + 1.82 s by the caption swap. The card itself holds 3.95 s (stills `s5-card.png` at 64.5; contact-sheet row 6 cells at t≈62–65 are the same 0-of-8 layout).

s6 card hold: freeze 4.20 s ≥ 4 s, then caption-2/3 change pixels in the lower third; card remains until the quote.

## Contact sheet (1 fps, `tile=10x10`, 3200×1800)

`ffmpeg -y -i out/lineage-experiment-01-16x9.mp4 -vf "fps=1,scale=320:-1,tile=10x10" out/lineage-experiment-01-16x9-sheet.png`

Cells t = 0 … ~96 s left-to-right, top-to-bottom. Last cells of row 9 are black 10×10 pads, not missing footage.

**s1 (row 0, t≈0–8).** Dark `#14120f`. Kicker, gold rule, question held. Captions cycle. No footage.

**s2 (row 0 last + row 1, t≈9–21).** 12 / 5 / 30→12 cards, then the generation line. No black, no bounce.

**s3 (rows 2–3, t≈21–36).** Protected A1 21.3–29.3: laptop feed advancing (season/day chrome changes across cells), 64× pill top-left, not overlapping the laptop status strip. Protected A3 25.3–33.3: phone frame, uncropped, single play of the 9.27 s source (no loop jump). Protected A2 29.3–36.3: ultrawide bloodlines, moving. No freeze, no black.

**s4 (row 3 end + row 4, t≈36–50).** Chart draws; teal yield-1.0 stays high, ember yield-0.5 falls. Legend “yield 0.5 · 40 repeats” / “yield 1.0 · 20 repeats”. Claim line matches C4. Still from ~t=39.

**s5 (rows 5–6, t≈50–66).** Protected B1 49.9–55.9: extinction log moving; “158 of ~350 turns: failed eats” pill below the season strip, opaque. Protected B2 55.9–61.9: Xan Ember card, genome readable. Local 12–16.4: designed “0 of 8” card, 2×4 “no” grid, held across several cells. No raw markdown table.

**s6 (row 6 end + row 7, t≈66–82).** Count-up visible (a cell shows “3” mid-count, then “7 of 8 gave”). Card + 2×2 table held. Quote from t≈74, Georgia italic, C9, held. No C1 table, no “7 of 8 gave” corner badge.

**s7 (rows 8–9, t≈82–96).** Protected B3 82.3–90.3: two-panel compare, cells change (dialogue / starving rows differ across tiles), not a freeze. Pill “same hamlet, genome removed: 7 of 8 gave too”, opaque, season line visible above it. End card t≈90–96, C10, held. Last two/three cells of the grid are tile padding.

Captions stay in the lower-third band on every cell that has one.

## Stills

| file | t (s) | what it is |
|---|---|---|
| `out/stills/s1.png` | 4.432 | question held |
| `out/stills/s2.png` | 15.077 | three setup cards |
| `out/stills/s3.png` | 28.791 | laptop A1 + phone A3, 64× pill |
| `out/stills/s4.png` | 43.080 | chart complete; yield 1.0 flat, 0.5 falling |
| `out/stills/s5.png` | 58.067 | Xan Ember / B2 |
| `out/stills/s5-card.png` | 64.5 | designed 0 of 8 card (hold) |
| `out/stills/s6.png` | 74.265 | quote fade-in at local 8.0 (opacity ~0) |
| `out/stills/s6-card.png` | 70 | designed 7 of 8 card (hold, after count) |
| `out/stills/s6-countend.png` | 68 | same card just after suffix lands |
| `out/stills/s7.png` | 89.265 | B3 compare, pill, footage moving vs t=86 |
| `out/stills/s7-badge.png` | 86 | B3 pill, no header ghosting |

## Motion rules cited

- **counting-dynamic-scale** — s6 headline `0→7` in 1.2 s, paired scale, suffix after the count.
- **svg-path-draw** — s4 polylines, 1.6 s, `power2.out` (unchanged).
- Title / card / quote / pill **fade + 24–40 px rise**, `fromTo`, `power2.out`, 0.4–0.8 s. No bounce.

## Anything not fixed, and why

- **9:16 cut** still not built (S3 stretch; this dispatch did not require it).
- **Three `nested_media_start_basis_ambiguous` warnings** remain: A2/A3/B2 `data-start` is composition-local. Same class as S3, fewer because the loop copies are gone.
- **C1 was not re-shot.** The designed card replaces it. The recording is still the Gate-2 expression table.
- **s5 card does not produce a ≥2.5 s freeze-detect hit** because caption-6 at 64.444 splits the hold. The card is still for 3.95 s; confirmed on the sheet and `s5-card.png`.
- **s6.png midpoint** is the quote’s first frame (opacity 0). Use `s6-card.png` / the sheet for the finding beat.

No gate failed after the one lint tag fix. Duration 96.267 s.
