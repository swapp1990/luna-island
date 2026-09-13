# Dispatch LINEAGE-S3 — The board-room film (HyperFrames, narrated)

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents. NEVER run any `git` command. No LLM calls except local TTS. Do not edit anything outside `videos/lineage-experiment-01/**` and `audit-reports/lineage-s3-report.md`. If a gate will not go green after 3 distinct fix attempts, STOP and report honestly. You build and validate; an independent reviewer QAs the render; the user approves publication.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `plans/lineage-showcase.md` §1 and §4 (the film is specified there: scenes, narration, register, gates), `audit-reports/lineage-s2-report.md` and `artifacts/lineage-site/recordings/shots.json` (what footage exists, with measured durations), and `audit-reports/lineage-b-report.md` §"Offline probes" (the numbers you will put on screen).

Read the HyperFrames contract before writing any HTML, in this order (paths on disk):
`C:/Users/swapp/.claude/skills/hyperframes-core/SKILL.md`,
`…/hyperframes-core/references/minimal-composition.md`,
`…/hyperframes-core/references/sub-compositions.md`,
`…/hyperframes-core/references/tracks-and-clips.md`,
`…/hyperframes-core/references/variables-and-media.md` (§ Media rules: video muted, audio separate with an `id`, never nest a timed `<video>` in a timed plain wrapper, never `crossorigin`),
`…/hyperframes-core/references/determinism-rules.md`,
`…/hyperframes-cli/SKILL.md` (init, lint, check, render, preview),
`…/media-use/references/audio.md` (voiceover + word timestamps),
`…/hyperframes-animation/SKILL.md` (motion rules; keep motion calm).

## What this dispatch builds

A 16:9 1920×1080 narrated, captioned film of 88–100 s in which a calm scientist explains Experiment 01 to a non-technical board: the question, the setup, the hamlet running fast on phone, desktop, and ultrawide, eight generations of measured drift, then the language-model runs, the finding, and an honest coda. Footage is the recorded `/lineage` site (S2). Charts are drawn from the run data. Every number on screen is a declared claim (§5). Output: `videos/lineage-experiment-01/out/lineage-experiment-01-16x9.mp4`, its 1 fps contact sheet, `ffprobe` numbers, and a report. A 9:16 cut is a stretch goal (§8).

## 1. Scaffold and brief

```bash
npx hyperframes init videos/lineage-experiment-01 --non-interactive --example=blank --skill=general-video
```

Then write `videos/lineage-experiment-01/BRIEF.md` exactly:

```markdown
---
workflow: general-video
flow: automation
storyboard: no
message: "AI villagers act on what they can see, not on what they are told they are"
destination: x-feed, youtube
aspect: 1920x1080
language: en
audience: non-technical decision makers
length: 88-100s
angle: scientist-to-board experiment report
---

## Intent

A calm scientist reports Experiment 01 of Luna Island's Lineage track to a board that does not
know what a prompt or a gene locus is. One idea per beat, plain words, honest about failure.
The user's words: "like how they do it in movies to a executive board members with no technical
knowledge", "clean, understandable", "show the runs as a visual website, record it, edit it,
then show the analysis results", "responsive for desktop and wider screen as well".

## Assets

- artifacts/lineage-site/recordings/A1.mp4 — hamlet at 64x, desktop 1920x1080, feed; scene 3
- artifacts/lineage-site/recordings/A3.mp4 — phone 390x844 feed at 8x; scene 3 inset
- artifacts/lineage-site/recordings/A2.mp4 — ultrawide 3440x1440 bloodlines at 64x; scene 3
- artifacts/lineage-site/recordings/B1.mp4 — extinction run, failed eats; scene 5
- artifacts/lineage-site/recordings/B2.mp4 — Xan Ember villager card at 1x; scene 5
- artifacts/lineage-site/recordings/B4.mp4 — analysis table 0 of 8, held; scene 5
- artifacts/lineage-site/recordings/C1.mp4 — probe table 7 of 8, held; scene 6
- artifacts/lineage-site/recordings/B3.mp4 — compare DNA on vs off at 64x; scene 7
- artifacts/lineage/replicate-y0.5-20260907-181338/aggregate.json — drift numbers for scene 4
- artifacts/lineage/replicate-y0.6-*/aggregate.json (if present) — the flat control for scene 4

## Customizations

- Narration: local Kokoro voice, one calm narrator, no music.
- Captions: burned, one line per narration sentence, held for the sentence's spoken duration.
- Charts: inline SVG drawn with GSAP, numbers hardcoded from the JSON above and declared in the spec.

## Notes

- Palette and type from the /lineage site: bg #14120f, ink #e9dfc8, ink-2 #a99c82, ember #e07a3a,
  teal #4fb3a6, gold #d4a437; Inter for UI, Georgia for quotes. No stock imagery, no 3D.
- Footage plays untouched inside device-shaped frames; never crop the phone footage.
```

## 2. Structure

`index.html` is the host (1920×1080, `data-composition-id="main"`), seven sub-compositions in `compositions/s1-title.html` … `s7-coda.html`, each a `<template>` sub-comp with its own paused timeline registered under its own id. Videos live INSIDE their scene sub-comp (sub-comps are exempt from the nested-timing rule). Narration is one `<audio id="vo-sN">` per scene at the host root with the scene's `data-start`. Captions are text clips inside each scene, one per sentence, timed from the TTS word timestamps.

Planned timing (seconds; voice duration overrides after §4, then shift later scenes so nothing overlaps; hold-still minimums are hard):

| scene | start | dur | on screen | held still ≥ | footage window (protected, plays uninterrupted) |
|---|---|---|---|---|---|
| s1 title | 0 | 5 | "Luna Island · Experiment 01" then "Can an AI villager inherit a personality?" | 4.0 s for the question | — |
| s2 setup | 5 | 12 | diagram: 12 villagers · 5 rooms · 30 genes → 12 traits; "every ten days the elders leave and their children arrive" | each label 2.5 s | — |
| s3 hamlet fast | 17 | 15 | A1 in a laptop frame (0–8 s), A3 in a phone frame overlapping from 4 s, A2 full-bleed ultrawide from 8 s | captions 3 s each | A1 0–8, A3 4–12, A2 8–15 |
| s4 eight generations | 32 | 12 | line chart: metabolism cohort mean by generation, courtship arm, yield 0.5 (falls) vs yield ≥ 0.6 (flat); axis labels; "40 seeds per arm" | chart complete and still 4 s | — |
| s5 minds | 44 | 16 | B1 (0–6) with counter "158 of ~350 turns: failed eats"; B2 (6–12) with the DNA paragraph readable; B4 (12–16) "0 of 8 traits expressed" | counter 3 s; table 3 s | B1 0–6, B2 6–12, B4 12–16 |
| s6 finding | 60 | 16 | C1 (0–8) "7 of 8 gave"; then the quote card "I stand by my people, and Arin is starving." — Xan Ember (8–16) | quote 5 s | C1 0–8 |
| s7 coda | 76 | 14 | B3 compare (0–8) "same hamlet, genome removed: 7 of 8 gave too"; end card (8–14): "Next: a world with inequality they can see" / github.com/swapp1990/luna-island | end card 6 s | B3 0–8 |

## 3. Narration (verbatim; one `<audio>` per scene; captions are these sentences)

- s1: "Experiment one. We asked a simple question. If you give an AI villager a genome, does it act like its parents?"
- s2: "Twelve villagers. Five rooms. Each carries thirty genes that set twelve traits: half in their bodies, half in their temperament. Every ten days, a generation passes."
- s3: "Here is the hamlet running at sixty-four times speed, on a phone, a laptop, and a wide screen. The feed is what they did. The tree is who they became."
- s4: "With no AI at all, just simple instincts, scarcity did what scarcity does. Over eight generations the fast metabolisms disappeared. Forty repeats. The physics works."
- s5: "Then we gave them language minds. The first hamlet starved in ten days: the model read half a grain as a meal. Two sentences of facts fixed that. They lived. But their inherited temperaments never showed. Zero of eight."
- s6: "So we asked one villager, holding spare grain, while showing him a starving neighbour. Seven of eight gave. The minds were never lazy. They act on what they can see, and we had shown them nothing worth being generous about."
- s7: "With the genome removed, they gave just as often. The trait is not in their behaviour yet. Next: a world with inequality they can see, and a genome that costs something to follow."

## 4. Voice and captions

Use the media-use audio engine with the local Kokoro provider:

```bash
node C:/Users/swapp/.claude/skills/media-use/audio/scripts/audio.mjs --request videos/lineage-experiment-01/audio_request.json --out videos/lineage-experiment-01/audio_meta.json
```

`audio_request.json`: `{ "provider": "kokoro", "lang": "en", "speed": 0.95, "lines": [ {"id":"s1","text":…}, … ], "bgm": { "mode": "none" } }`. Copy the produced voice files into `videos/lineage-experiment-01/public/vo/`. Use `voices[].duration_s` to set each scene's real duration = max(planned, voice + 0.8) and `voices[].words[]` to time each caption clip to its sentence. If Kokoro is unavailable, try `npx hyperframes tts --help` for the CLI's local voice; if neither works, build captions from the planned timings, leave the `<audio>` elements out, and report `voice: unavailable` with the exact error. Never use a paid or network TTS.

Caption style: Inter 40 px, ink on a 60% `#14120f` band at the lower third, max 2 lines, appear with a 0.2 s fade, no word-by-word animation. One caption per sentence.

## 5. Claims on screen (declared before rendering; copy this table into the report)

| id | text on screen | source |
|---|---|---|
| C1 | 12 villagers · 5 rooms · 30 genes → 12 traits | plans/lineage.md §2–§3 |
| C2 | every ten days a generation passes | plans/lineage.md §2 |
| C3 | 64× speed | site speed chip in footage |
| C4 | metabolism falls at yield 0.5; flat at yield ≥ 0.6; 40 seeds per arm; 8 generations | audit-reports/lineage-a-report.md verdict table; replicate aggregate.json |
| C5 | 158 of ~350 turns: failed eats (gate 1) | lineage-b-report.md "Gate 1" |
| C6 | 0 of 8 traits expressed | lineage-b-report.md "Gate 2", "Gate 3" |
| C7 | 7 of 8 gave (surplus + visible hunger, DNA on) | lineage-b-report.md "Offline probes" |
| C8 | 7 of 8 gave with the genome removed | same |
| C9 | quote "I stand by my people, and Arin is starving. I can spare a meal's grain before I work again." — Xan Ember | artifacts/lineage/probes/synth-low-dnaon-*.md |
| C10 | github.com/swapp1990/luna-island | public repo |

Nothing else numeric may appear. Read the aggregate JSON to draw scene 4; if the yield-0.6 replicate is absent, draw yield 0.5 only and label it, and say so in the report.

## 6. Design

Dark, quiet, editorial. Background `#14120f`; text `#e9dfc8`; secondary `#a99c82`; one accent per scene (ember for the hamlet, teal for data, gold for the villager). Inter for titles and captions, Georgia for the quote. Device frames are simple rounded rectangles with a 1 px `rgba(233,223,200,.18)` border, no bezels or notches. Motion: fades and 24–48 px rises only, `power2.out`, 0.4–0.8 s; charts draw in with stroke-dashoffset over 1.6 s. Nothing bounces. Read `hyperframes-animation/SKILL.md` and cite the rule names you used in the report.

## 7. Gates (run in this order; paste outputs)

1. `npx hyperframes lint` after the first HTML pass; fix everything it reports.
2. `npx hyperframes check` — must pass. Its pass is NOT evidence of a correct picture (it has passed on black frames); it is only the structural gate.
3. `npx hyperframes render --quality high --output out/lineage-experiment-01-16x9.mp4` from the project directory.
4. Measure the encoded file: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames,duration -of json out/lineage-experiment-01-16x9.mp4` and the audio stream the same way. Record duration (video stream, not container), dimensions, fps.
5. Contact sheet at 1 fps: `ffmpeg -y -i out/lineage-experiment-01-16x9.mp4 -vf "fps=1,scale=320:-1,tile=10x10" out/lineage-experiment-01-16x9-sheet.png`. Open it and check every protected footage window shows moving footage (no black, no frozen frame), every caption is inside the safe area, and the end card is legible. Write what you saw per scene; do not summarise.
6. Extract one still per scene at its midpoint with `ffmpeg -ss <t> -i … -frames:v 1 out/stills/sN.png` and list them.
7. Read-only evidence: `git status --short` shows changes only under `videos/lineage-experiment-01/` and the report.

## 8. Stretch (only after §7 is fully green and reported): 9:16 cut

`index-vertical.html` at 1080×1920 reusing the same sub-comps with a `data-variable-values` layout switch or vertical variants in `compositions/vertical/`. Phone footage full-bleed, desktop footage letterboxed, captions at 48 px. Same gates. If you do not reach it, say so in one line.

## 9. Report (`audit-reports/lineage-s3-report.md`)

Files; BRIEF.md path; TTS provider used and per-scene voice durations; final per-scene start/duration table (after voice override); the claims table from §5 with a "shown at" column; lint/check/render/ffprobe outputs verbatim; the contact-sheet observations per scene; stills list; motion rules cited; stretch status; questions for main.
