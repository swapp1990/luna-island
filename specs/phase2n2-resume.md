# Dispatch N2-resume — finish the juice layer from partial state

A previous implementer session was interrupted externally (not its fault) partway through **specs/phase2n2-juice-layer.md**. Read that spec FIRST and in full — its role rules, scope guard (RENDER/UI ONLY, zero `src/sim/` edits), and gates all apply to you verbatim.

Partial edits from the interrupted session are ALREADY ON DISK (uncommitted): modified `src/App.tsx`, `src/loop.ts`, `src/render/agents.ts`, `src/render/overlays.ts`, `src/render/scene.ts`, `src/render/terrain.ts`, `src/ui/Ticker.tsx`; new `src/render/fx.ts`, `src/ui/PortraitDock.tsx`, `e2e/juice.spec.ts`. Some files may be mid-edit and broken.

Your job:
1. Review the partial work against the original spec — keep what's good, repair what's broken, finish what's missing. Do not start over unless a file is truly unsalvageable.
2. Get `npm run build` green, then complete the remaining scope items.
3. Run ALL gates from the original spec (build, 39/39 vitest untouched, e2e including juice.spec, purity + zero-sim-edit check via `git status --porcelain src/sim/` being empty, the three screenshots).
4. Final report in the original spec's exact structure, plus one line noting which partial pieces you kept vs rewrote.
