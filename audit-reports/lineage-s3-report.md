# LINEAGE-S3 report — board-room film

HyperFrames `/general-video`, `flow: automation`. 16:9 master rendered. Independent reviewer QAs the sheet; publication stays a user gate.

## Files

Project root: `videos/lineage-experiment-01/`

| path | role |
|---|---|
| `BRIEF.md` | brief (written exactly as dispatched) |
| `index.html` | host 1920×1080, `data-composition-id="main"`, duration 96.265 s |
| `compositions/s1-title.html` … `s7-coda.html` | seven templated sub-comps |
| `public/vo/s1.wav` … `s7.wav` | Kokoro `am_michael` @ 0.95 |
| `public/footage/A1.mp4` … `C1.mp4` | S2 recordings, copied in |
| `fonts/inter-latin-*.woff2`, `fonts/georgia.ttf`, `fonts/georgiai.ttf` | local type (no network) |
| `out/lineage-experiment-01-16x9.mp4` | master |
| `out/lineage-experiment-01-16x9-sheet.png` | 1 fps contact sheet, `tile=10x10` |
| `out/stills/s1.png` … `s7.png` | midpoint stills |

Not written: anything outside this directory except this report. No `git` commands (dispatch).

**BRIEF.md path:** `videos/lineage-experiment-01/BRIEF.md`

## TTS

**Provider:** local Kokoro-82M via `npx hyperframes tts -v am_michael -s 0.95`.

First call failed (quoted):

```
Speech synthesis failed: The kokoro-onnx package is not installed.
Run: pip install kokoro-onnx soundfile
(or point HYPERFRAMES_PYTHON at a venv python that has them)
```

Retry with `HYPERFRAMES_PYTHON` = Windows Store Python 3.12 (which already had `kokoro_onnx` + `soundfile`) succeeded. No media-use fallback. No paid/network TTS.

| file | ffprobe duration (s) | scene dur = max(planned, voice+0.8) |
|---|---|---|
| `public/vo/s1.wav` | 8.064000 | 8.864 |
| `public/vo/s2.wav` | 11.626667 | 12.427 |
| `public/vo/s3.wav` | 10.880000 | 15.000 |
| `public/vo/s4.wav` | 12.778667 | 13.579 |
| `public/vo/s5.wav` | 15.594667 | 16.395 |
| `public/vo/s6.wav` | 14.442667 | 16.000 |
| `public/vo/s7.wav` | 12.906667 | 14.000 |

Captions: one clip per sentence; duration proportional to character count across that scene's voice file.

## Final per-scene start / duration (after voice override)

| scene | start | dur | end | on screen |
|---|---|---|---|---|
| s1-title | 0.000 | 8.864 | 8.864 | title + question (held still after 1.3 s) |
| s2-setup | 8.864 | 12.427 | 21.291 | 12 / 5 / 30→12 cards; generation line from 7.8 s local |
| s3-hamlet | 21.291 | 15.000 | 36.291 | A1 0–8, A3 4–12 (looped; source 2.433 s), A2 8–15 |
| s4-generations | 36.291 | 13.579 | 49.870 | metabolism chart; still after 2.15 s (draw 1.6 s from 0.55) |
| s5-minds | 49.870 | 16.395 | 66.265 | B1 0–6, B2 6–12, B4 12–16.395 |
| s6-finding | 66.265 | 16.000 | 82.265 | C1 0–8, quote 8–16 |
| s7-coda | 82.265 | 14.000 | 96.265 | B3 0–8, end card 8–14 |

Host `data-duration="96.265"`. Encoded video stream 96.266667 s.

A3 / B1 / B3 / C1 sources are shorter than their protected windows. Each is looped with a second (or fourth) `<video>` copy, `data-media-start="0"`, so the window is moving footage rather than a freeze.

## Scene 4 means (plotted; check against JSON)

Field: `courtship[i].traitMeansByGeneration.metabolism` (no `.summary` wrapper on these aggregates). Mean across seeds per generation.

**yield 0.5** `replicate-y0.5-20260907-181338/aggregate.json` n = 40:

| gen | mean |
|---|---|
| 0 | 0.4986 |
| 1 | 0.4892 |
| 2 | 0.4483 |
| 3 | 0.4177 |
| 4 | 0.3868 |
| 5 | 0.3660 |
| 6 | 0.3438 |
| 7 | 0.3222 |
| 8 | 0.2865 |

**yield 0.6** `replicate-20260907-1809/aggregate.json` n = 20:

| gen | mean |
|---|---|
| 0 | 0.5028 |
| 1 | 0.5042 |
| 2 | 0.5007 |
| 3 | 0.4833 |
| 4 | 0.4604 |
| 5 | 0.4549 |
| 6 | 0.4493 |
| 7 | 0.4458 |
| 8 | 0.4340 |

Yield 1.0 (`replicate-20260907-1807`, n = 20) was computed and **not plotted**: 0.5028, 0.5160, 0.4951, 0.5035, 0.4972, 0.5000, 0.5028, 0.4993, 0.4903. The 0.6 arm is not visually flat; 1.0 is flatter. Chart uses the two named aggregates.

## Claims on screen

| id | text on screen | source | shown at |
|---|---|---|---|
| C1 | 12 villagers · 5 rooms · 30 genes → 12 traits | plans/lineage.md §2–§3 | s2 cards (`12` / `5` / `30 → 12` + labels) |
| C2 | every ten days a generation passes | plans/lineage.md §2 | s2 line from local 7.8 s |
| C3 | 64× speed | site speed chip in footage | s3 overlay chip + A1/A2 chrome |
| C4 | metabolism falls at yield 0.5; flat at yield ≥ 0.6; 40 seeds per arm; 8 generations | lineage-a-report.md; aggregates above | s4 title + subtitle + axis/legend |
| C5 | 158 of ~350 turns: failed eats (gate 1) | lineage-b-report.md Gate 1 | s5 overlay 1.5–5.0 s local (held ≥ 3 s) |
| C6 | 0 of 8 traits expressed | lineage-b-report.md Gate 2 / Gate 3 | s5 overlay 12.4–16.395 s local (held ≥ 3 s) |
| C7 | 7 of 8 gave (surplus + visible hunger, DNA on) | lineage-b-report.md Offline probes | s6 overlay 1–8 s local |
| C8 | 7 of 8 gave with the genome removed | same | s7 overlay 1–8 s local (“same hamlet, genome removed: 7 of 8 gave too”) |
| C9 | quote “I stand by my people, and Arin is starving. I can spare a meal's grain before I work again.” — Xan Ember | artifacts/lineage/probes/synth-low-dnaon-*.md (quoted in B report) | s6 quote card 8–16 s local (held 8 s ≥ 5 s) |
| C10 | github.com/swapp1990/luna-island | public repo | s7 end card 8–14 s local (held 6 s) |

Authored overlays add no other numerals. The **recorded site footage** (B4, C1, B2, A1–A3, B3) still contains the live UI’s own numbers (expression table, grain, satiety, hashes). Footage is played untouched, per the brief.

## Lint (after first HTML pass + one error fix)

First pass: 1 error `gsap_exit_missing_hard_kill` on `#s5-stage-b2`, plus 10 `nested_media_start_basis_ambiguous` warnings. Added `tl.set` hard kills on s5 stage exits and s3 laptop/phone exits. Re-lint:

```
◆  Linting lineage-experiment-01/8 files

  ⚠ nested_media_start_basis_ambiguous  (10 findings: s3-a2, s3-a3a–d, s5-b1b, s5-b2, s5-b4, s6-c1b, s7-b3b)
    Fix: Keep data-start if composition-local.

◇  0 error(s), 10 warning(s)
```

The ten warnings are scene-local `data-start` on nested `<video>` (the documented default). Not converted to `data-hf-media-start-basis="global"`.

## Check

`npx hyperframes check --json --snapshots` — exit 0.

```
ok: true
lint:     { ok: true, errorCount: 0, warningCount: 10 }
runtime:  { ok: true, errorCount: 0, findings: 0 }
layout:   { ok: true, errorCount: 0, findings: 0, duration: 96.265,
            samples: [5.348, 16.044, 26.74, 37.436, 48.133, 58.829, 69.525, 80.221, 90.917] }
motion:   { ok: true, enabled: false }
contrast: { ok: true, checked: 19, passed: 19,
            samples: [5.348, 26.74, 48.133, 69.525, 90.917] }
```

Check passing is structural only. Picture evidence is the contact sheet and stills below.

## Render

```
npx hyperframes render --quality high --output out/lineage-experiment-01-16x9.mp4
```

From the project directory. Exit 0. Excerpt:

```
Rendering lineage-experiment-01 → out/lineage-experiment-01-16x9.mp4
   30fps · high · auto workers (16 cores detected)
   GPU: browser GPU (auto-detect)
  … 2888/2888 frames, captureMode=drawelement
  100%  Render complete
   33.7 MB · 1m 36.3s video · rendered in 2m 22.7s
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

Format: duration `96.266667`, size `35373424`, bit_rate `2939619`.

Video stream duration 96.266667 s (not the container). 1920×1080, 30 fps. Inside 88–100 s.

## Contact sheet (1 fps, `tile=10x10`, 3200×1800)

`ffmpeg -y -i out/lineage-experiment-01-16x9.mp4 -vf "fps=1,scale=320:-1,tile=10x10" out/lineage-experiment-01-16x9-sheet.png`

Cells are t = 0 … ~96 s left-to-right, top-to-bottom (10 per row). Last cells of row 9 are black pads from the 10×10 tile on a 96 s clip — not missing footage.

**s1 (row 0, t≈0–8).** Dark `#14120f` card. Kicker “Luna Island · Experiment 01” and gold rule, then the question “Can an AI villager inherit a personality?” held still across cells 3–8. Captions cycle: “Experiment one.” → “We asked a simple question.” → genome/parents sentence. Caption sits in the lower third, not clipped. t=0 is a fade-in (kicker still rising). No footage.

**s2 (row 0 last cell + row 1, t≈9–21).** Three rounded cards: ember “12 / villagers”, then “5 / rooms”, then “30 → 12 / genes to traits”. They stay up once they have arrived. Bottom caption walks the four sentences; the last cells of row 1 show “Every ten days, a generation passes.” The generation line itself is the same sentence, ink-2, under the cards (visible once local 7.8 s ≈ global 16.7, mid-to-late row 1). No black, no bounce.

**s3 (row 2–3, t≈21–36).** Protected A1 21.3–29.3: laptop-framed 1920×1080 feed at 64×, playhead moving, chronicle lines changing, family tree filling — not a freeze, not black. 64× chip top-left. Protected A3 25.3–33.3: phone-aspect rounded frame on the right, `object-fit: contain` (390×844 uncropped); feed text readable; loops (source is 2.43 s). Protected A2 29.3–36.3: ultrawide bloodlines go full-bleed (tree + trait grid); phone still overlays until ~33.3 then drops. Captions: sixty-four times speed, then “The feed is what they did.”, then “The tree is who they became.” (voice ends ~32.2; last ~4 s of s3 is picture without a caption).

**s4 (row 3 end + row 4, t≈36–50).** Chart draws: teal yield-0.6 line high and shallower, ember yield-0.5 line falling. Axis: “start” / “8 generations” / “metabolism”. Legend “yield 0.6” / “yield 0.5”. Subtitle “falls at yield 0.5 · flat at yield ≥ 0.6 · 40 seeds per arm”. From ~t=39 the two lines are complete and hold still through t=49. Captions: scarcity, eight generations, “Forty repeats.”, “The physics works.”

**s5 (row 5–6, t≈50–66).** Protected B1 49.9–55.9: hamlet feed, failed-eat activity, overlay “158 of ~350 turns: failed eats” held several cells. Protected B2 55.9–61.9: Xan Ember card, genome paragraph readable (“You hunger slowly… you stand by your people…”), feed of his give. Protected B4 61.9–66.3: analysis table, overlay “0 of 8 traits expressed”. Captions: language minds → starved / half a grain → two sentences of facts → “They lived.” → temperaments never showed → “Zero of eight.” Table cells in the footage itself carry extra UI numbers (untouched recording).

**s6 (row 6 end + row 7, t≈66–82).** Protected C1 66.3–74.3: analysis/probes panel, overlay “7 of 8 gave”. Footage is the held table (mostly static because the shot is a hold — not a black frame; playhead and overlay present). t=74–82: quote card, Georgia italic, full C9 text, gold “— Xan Ember”, held. Captions: spare grain / starving neighbour → “Seven of eight gave.” → never lazy → act on what they can see.

**s7 (row 8–9, t≈82–96).** Protected B3 82.3–90.3: ultrawide compare, two hamlets side by side (`object-fit: contain`, both columns visible), overlay “same hamlet, genome removed: 7 of 8 gave too”. Cells change (scroll/playhead), not a single freeze. t=90–96: end card “Luna Island · Experiment 01” / “Next: a world with inequality they can see” / gold `github.com/swapp1990/luna-island`, held six seconds, legible. Last caption is the Next sentence. Final two/three cells of the 10×10 grid are black tile padding.

Captions stay inside the lower-third band on every cell that has one.

## Stills (scene midpoints)

| file | t (s) | what it is |
|---|---|---|
| `out/stills/s1.png` | 4.432 | question held; caption on genome/parents |
| `out/stills/s2.png` | 15.077 | three cards; genes sentence (generation line not yet; arrives 16.66) |
| `out/stills/s3.png` | 28.791 | laptop A1 + phone A3, 64×, hamlet running |
| `out/stills/s4.png` | 43.080 | chart complete and still |
| `out/stills/s5.png` | 58.067 | Xan Ember card (B2), genome readable |
| `out/stills/s6.png` | 74.265 | quote card (C9) just taking the frame |
| `out/stills/s7.png` | 89.265 | B3 compare (scene midpoint is still in the 0–8 s footage window) |

## Motion rules cited

- **svg-path-draw** — metabolism polylines, `getTotalLength()` dasharray/dashoffset, 1.6 s, `power2.out` (no `back.out`).
- Title / card / quote / claim **fade + 24–40 px rise**, `fromTo`, `power2.out`, 0.4–0.8 s. No catalog rule matches a calm fade-rise without bounce; **waterfall-entry** (binary opacity, no fade) and **spring-pop-entrance** (`back.out`) were not used.
- Caption fades 0.2 s opacity only.
- Device frames: opacity crossfade 0.4–0.5 s, then `tl.set` hard kill (lint `gsap_exit_missing_hard_kill`).
- Nothing bounces. No `repeat: -1`. No CSS `transform` on GSAP-tweened properties.

## Stretch

9:16 cut not built. 16:9 gates are green; vertical variants were left for a later pass.

## Questions for main

1. Yield 0.6 (n=20) still slopes 0.503→0.434; yield 1.0 is the actually-flat series. Chart follows the two named aggregates. Want 1.0 on the “≥ 0.6” line instead?
2. C4 says “40 seeds per arm”; the 0.6 control is n=20. Keep the claim text?
3. B4/C1 (and the rest of the site footage) print many undeclared UI numbers. Overlay claims are clean; the recordings are untouched. Crop/grade the analysis shots, or accept the live table?
4. A3 is 2.43 s, looped to fill the 8 s phone window. Intended?
5. `git status` not run here (dispatch: no git). Working tree also contains HyperFrames scaffold files (`AGENTS.md`, `CLAUDE.md`, `package.json`) under `videos/lineage-experiment-01/`.
6. First TTS needed `HYPERFRAMES_PYTHON` at Python 3.12; default PATH Python did not have `kokoro-onnx`.
