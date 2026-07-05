---
id: removals-awaiting-captain-s-approval
---

# Removals awaiting Captain's approval

Deletion is banned tonight. Anything that should be removed (dead file, wrong path, superseded stub) is logged here instead, never deleted.

Format: path — reason — logged by which package.

- `packages/chartroom/spike.mjs` — throwaway mdast-node-shape research script (plan §10 risk #3, confirming remark link sub-position availability before writing the real link-repair code). Harmless (excluded from `tsconfig`'s `include`, from eslint via an explicit ignore, and from the published `files` list) but is dead scaffolding left in a "done" deliverable, flagged by the phase-1 adversarial Reviewer. — logged by Chart Room phase 1
- `packages/chartroom-ui/test/editor/_spike.test.ts` — throwaway Milkdown-API-spike test file (phase 3 plan §1.7's recommended "30-60 minute Developer-stage spike before writing the real DocEditor.tsx" step). Left deliberately uncommitted (never staged, never part of any phase-3 commit) per the mission's own working-rules instruction ("spike/throwaway findings noted in a commit message even if the spike code itself isn't committed") — its findings are written up in the `e427a36`/`a0ecd2e` commit messages instead. It is currently untracked in the working tree; harmless if left (all 5 of its tests pass, it just duplicates coverage already in `roundTrip.test.ts` more thoroughly), but should be deleted before this branch merges since it was never meant to be a permanent deliverable. — logged by Chart Room phase 3
- `packages/chartroom-ui/src/components/DirectiveFallback.tsx` — orphaned by phase 4's `DocView.tsx` wiring: it used to be the renderer for both the `ask-me` and `actions` directive tag names (phase 2's placeholder pending phase 4), and phase 4 replaces both entries in `DocView`'s `components` map with `AskMeBlock`/`ActionsBlock` respectively (plan §0/§4.3, "replacing DirectiveFallback for just those two tag names"). No remaining call site references it anywhere in `chartroom-ui/src` or `test` (verified by grep). Harmless if left (an unreferenced component, still compiles and lints clean, not part of any public API), but is now dead code in a "done" deliverable — left in place per the mission's no-delete rule rather than removed. — logged by Chart Room phase 4
- 2026-07-05 16:50 FO: `suite-design/overnight/usage.json` (untracked) is a STALE duplicate of the canonical Lookout signal (`suite-design/lookout/state/usage.json`), dead since 02:58. Not deleted per rm-ban; flagged for Captain cleanup. Do not read it.
