# UBC village population — primary review, 2026-09-07

Local preview: http://127.0.0.1:5281/?view=overview
Source: `art/meadow-harbor-rebuild/completion/`. This is the detailed Meadow Harbor visual scene, separate from the playable town/wild simulation.

## Delivered scope

12 independently animated identical UBC male residents: six walkers on three clear route segments, four people in two conversations, one observer, one worker using a small timber support. Sixteen existing static background residents remain: eight seated, six dockside, two elevated workshop workers. The old 45 static ground-row placements were replaced.

Grok CLI implemented all runtime/asset/test changes. Primary Codex chose and reviewed spatial placements, examined real animation poses, identified integration/continuity defects, reviewed the surgical integration diff, and performed final browser QA. Source UBC GLB remains unchanged; one shared 6,324,496-byte derivative retains four UAL clips. There is no garment simulation in this pass.

## Spatial decisions and real scene verification

- Real mesh terrain sampling, building/site and prop footprints, path width, inland clearance, and a 12-degree slope limit form the initial collision/clearance layer. This is not a full physics world or general navigation system.
- Approved route segments: lower_loop 15.75m, market_west 31m, western_lane 21.07m. The market route starts 3m later to separate the walking corridors. No unchecked push-away correction remains.
- Actual loaded-scene sample of all 12 actors for 180 seconds at 0.1-second intervals: minimum horizontal centre separation 0.760m; largest displacement per sample 0.131m. All route and social placement checks pass. This covers those routes and this time interval, not arbitrary future navigation.
- At corners, heading differences across +/-0.00001m are at most 0.00111 degrees, eliminating the former ~15.8-degree snap.
- Inspected overview, market conversations, walking, and worker side views in Codex's in-app browser. The worker's low timber support is aligned under the hands, and the original clip kneels and rises continuously.
- Live frames and clip times advance. Pause holds time; resume continues from the paused/sought pose. Free camera and reference reset work.
- No startup/shader errors in final loaded scene. Sampled live rendering was approximately 16.7ms/frame on this machine; this is not a general performance guarantee.

## Checks

Primary ran from completion:

- `node tests/villager-routes.test.mjs` — PASS, including route exclusions, movement/corner continuity, three-minute spacing, required asset clips and independent skeletons.
- `node tests/farm-layout.test.mjs` — PASS.
- `node tests/harbor-clearance.test.mjs` — PASS.
- `node ../../../node_modules/vite/bin/vite.js build --config vite.config.mjs` — PASS.

Logs: `.tmp/ubc-primary-routes-test.log`, `.tmp/ubc-primary-farm-test.log`, `.tmp/ubc-primary-harbor-test.log`, `.tmp/ubc-primary-build.log`.

Review frames: `art/meadow-harbor-rebuild/completion/review/ubc-village-walk-2026-09-07.png` and `ubc-village-worker-2026-09-07.png`.

## Next layers

This is staged, deterministic village activity, not autonomous task selection. Keep these accepted rigs and motions as the baseline. Next add destination/task states and interaction targets; add navigation when residents need arbitrary routes. Foot IK/contact locking is still needed for convincing close-up movement on uneven terrain; this pass limits slopes and grounds the root, so minor foot sliding or gaps can remain. Clothing can attach to the same canonical skeleton later, starting with skinned garments. Full cloth simulation is a separate layer.

No deployment was performed; the published site is unchanged. Local preview depends on the running development server. No edits to the playable simulation or garment source files. A garment-task handoff is at `art/garmentcode/ACTIVE-HANDOFF.md`.

Final DEV follow-camera correction was implemented by Grok in `villagers-ubc.js`: it now uses the real render camera (`context.camera`) and preserves the authoring reference camera. Primary reloaded the live scene and visually verified follow distance 4.6m and eye height 1.55m above the actor root. Final build rechecked after this correction.
