# 00b-progress-tracking — Developer report

Package: 00b-progress-tracking (Captain's Order 1, mission tooling)
Branch: `ship-wave1` directly (FO-authorized exception; not pushed)
Date: 2026-07-05T13:24:00+02:00

## What was done

1. **`suite-design/overnight/progress.json`** — created. 14 entries (ids 0–13) matching the
   PLAN.md queue table, each `{ id, title, status, stage_progress, difficulty,
   remaining_guess_h, updated_at, note }`.
   - Stage mapping used (deterministic): pending 0 / planning 15 / plan approved 25 /
     implementing 60 / in review 80 / PASS+merged 100 / parked freezes.
   - Backfill: #0 Charter the crew = PASS+merged, 100, S, 0h, note "charter + mission
     context + dry-runs, merged 5da7b59/ae1d0b7". #1 Housekeeping + dogfood = plan
     approved, 25, S, 1.5h, note "plan approved with .chartroomignore direction;
     implementing next".
   - #2–13: pending, 0, difficulty null (set at plan approval per protocol),
     remaining_guess_h per FO guesses: 2→4, 3→6, 4→3, 5→3, 6→4, 7→4, 8→4, 9→2,
     10→3, 11→3, 12→5, 13→3.
   - #3 carries the Order 1 amendment note (Voyage tab).

2. **`suite-design/overnight/render-progress.mjs`** — created. Plain Node ESM, zero deps
   (`node:fs`, `node:path`, `node:url` only). Reads progress.json, writes PROGRESS.md:
   - per-package 10-char unicode bar (█/░) + percentage,
   - difficulty badge (`[S]`…`[XL]`, `[?]` when unset),
   - remaining-hours guess label,
   - grouped sections: Done / In flight / Pending / Parked (parked = status "parked",
     freezes at stored stage_progress),
   - overall difficulty-weighted 20-char mission bar (weights S=1 M=2 L=3 XL=5,
     unplanned counts as M), plus summed remaining-hours guess,
   - last-updated stamp = max updated_at across entries.

3. **Ran the renderer** — `node suite-design/overnight/render-progress.mjs` →
   `Wrote ...\PROGRESS.md (mission 5%)`. Output verified by inspection: 1 done,
   1 in flight, 12 pending, mission bar 5%, ~45.5h guessed remaining, stamp
   2026-07-05T13:24:00+02:00.

4. **`suite-design/overnight/PLAN.md`** — queue item 3 row appended with:
   "AMENDED (Captain Order 1): Deck also gets a 'Voyage' tab rendering progress.json
   live (file-watched)."

5. **`suite-design/overnight/CAPTAIN-INBOX.md`** — Order 1 heading marked
   `[read: 2026-07-05T13:24:00+02:00, adopted]`.

## Commits (on ship-wave1, not pushed)

- `96d064d` chore(marathon): adopt progress tracking per Captain Order 1
  (progress.json, render-progress.mjs, PROGRESS.md)
- `e6cf6fc` docs(marathon): amend queue item 3 with Voyage tab, mark Order 1 adopted
  (PLAN.md, CAPTAIN-INBOX.md)

No AI attribution in commit messages. Only the files above were staged; the many
unrelated working-tree modifications from the in-flight session were left untouched.

## Build/test evidence

No package code touched — mission-tooling only. Renderer executed successfully
(exit 0, output above), which is the script's functional test. No deletions, no
new dependencies, `team-tasks/` untouched.

## Deviations

None. All five dispatch items completed as specified.
