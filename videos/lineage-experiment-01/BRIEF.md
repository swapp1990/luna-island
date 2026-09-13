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
- artifacts/lineage/replicate-y0.5-20260907-181338/aggregate.json — scene 4 falling line: mean over `courtship[*].summary?.traitMeansByGeneration.metabolism ?? courtship[*].traitMeansByGeneration.metabolism` per generation (n = 40)
- artifacts/lineage/replicate-20260907-1809/aggregate.json — scene 4 flat control at yield 0.6 (n = 20), same field
- artifacts/lineage/replicate-20260907-1807/aggregate.json — optional second control at yield 1.0 (n = 20)

## Customizations

- Narration: local Kokoro voice, one calm narrator, no music.
- Captions: burned, one line per narration sentence, held for the sentence's spoken duration.
- Charts: inline SVG drawn with GSAP, numbers hardcoded from the JSON above and declared in the spec.

## Notes

- Palette and type from the /lineage site: bg #14120f, ink #e9dfc8, ink-2 #a99c82, ember #e07a3a,
  teal #4fb3a6, gold #d4a437; Inter for UI, Georgia for quotes. No stock imagery, no 3D.
- Footage plays untouched inside device-shaped frames; never crop the phone footage.
