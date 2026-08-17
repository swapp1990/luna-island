# Dispatch P3-10c — Azimuth rescue: fix the 3 occluded shots, touch nothing that works

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash only. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. This is a micro-revision of your P3-10b framing code in `src/render/scene.ts` (+ photographer if needed).

## The problem (orchestrator-verified on the v2 reel)

9/12 stills pass. The 3 fails share one cause — the fixed SE azimuth:

- **03** (Mira & Joss grow close): pair hidden behind a house; a quarry slab is the visual hero.
- **07** (Tama examines the home): two foreground houses, neither obviously the subject; card sits on a roof.
- **12** (Ansel commissions a house): two giant foreground villagers; the site is a corner post.

## The fix — a FALLBACK, never a new default

1. After posing the default SE shot, run a **subject-visibility check**: raycast from camera to the subject anchor (and, for pairs, to BOTH agents' heads; for places, to 2–3 points on the place mesh — e.g. center + roof peak). Ignore grass-height hits as in v2. Subject "clear" = all rays reach within a small epsilon.
2. If clear → keep the SE shot (the 9 good stills must reproduce **pixel-comparable**: same azimuth, same distance).
3. If occluded → try a fixed, deterministic candidate list of azimuths (e.g. SE ± 30°, ± 60°, SW, NE, NW — a hardcoded ordered array, no randomness), first candidate whose visibility check passes wins; if none pass, pick the one with the most visible ray hits and also raise elevation one notch. Non-subject agents standing within ~1 tile of the camera ray may additionally be treated as occluders for pair/place shots (that's shot 12's disease).
4. For `discovery:examined` with a place target (shot 07's disease): the examined place — by id — is the ray target and hero; if another same-kind mesh sits closer to camera than the subject on the default azimuth, that counts as occlusion and triggers the search.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `e2e/photo.spec.ts --retries=0` passes; zero `src/sim/` changes; `utilityBrain.ts` SHA unchanged.
2. Re-shoot `artifacts/soak-1786938450347-world.json` (zero LLM calls). In the report, a 12-row table: azimuth used (default vs rescued) + pass/fail per the P3-10b criteria. **Rows 01/02/04/05/06/08/09/10/11 must show `default` azimuth** — if the rescue engaged on a previously-good shot, that's a bug in the visibility check; fix it, don't reframe them.
3. 03, 07, 12 must now pass (subject obviously the protagonist). If one is unrescuable by azimuth alone, say why with the geometry.

## Final report

**CHANGED** / **GATES** / **REEL v3 TABLE** (12 rows: azimuth, verdict) / **KNOWN GAPS**.
