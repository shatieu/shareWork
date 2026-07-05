---
id: report-00-charter-mission-context-writer
---

# Report 00 - Charter / Mission-Context Writer

Date: 2026-07-05. Branch: ship-wave1. Task: write MISSION-CONTEXT.md, commit it
with the four crew charter files and the two Captain files.

## What was verified by direct inspection
- Root `package.json`: pnpm@10.34.4, node >=20, turbo 2.x scripts (build/lint/dev/
  test via turbo, prettier format). `pnpm-workspace.yaml`: `packages/*`, `plugins/*`.
  `turbo.json` and `tsconfig.base.json` present at root.
- `packages/`: chartroom (CLI/indexer/daemon, bin `chartroom`, exports ./markdown
  and ./interactive-blocks) and chartroom-ui (private React+Vite+Milkdown frontend,
  dist copied into chartroom's dist/public per its own package.json description).
- `plugins/`: only README.md at this time.
- `team-tasks/`: Captain's Next.js app; kept out of scope everywhere.
- Spec headings skimmed via grep on H1/H2:
  - ChartRoom_Spec.md: secs 1-10, build order sec 8 (phases 8.1-8.5 confirmed via
    overnight/PLAN.md package table referencing 8.1..8.5).
  - Ship_Spec.md: sec 3 Ledger, 4 Changelog, 5 Inbox, 6 Console, 7 Crew plugin,
    8 Stack, 9 Build order, 10 DoD, 11 Out of scope.
  - Trio_Specs.md: sec A Skill Analytics, B Settings Manager, C Scheduler,
    plus a cross-trio build-order section.
  - Locker_Spec.md: "The Sea Chest (formerly Locker)", secs 1-8, build order sec 7.
  - VoiceBridge_Spec.md: "The Comm (formerly Voice Bridge)", secs 1-11.
  - Suite-Architecture_and_Website_Spec.md: sec 1 naming, 2 system map, 3 monorepo,
    4 Harbor, 5 website, 6 sequencing, 7 suite DoD.
- Tracking files confirmed present under suite-design/overnight/: PLAN.md,
  STATUS.md, DECISIONS-NEEDED.md, REMOVALS.md, CAPTAIN-INBOX.md, CAPTAIN-TODO.md,
  plans/ (00-05 plans), changelog/entries. reports/ created by this task.
- Lookout: suite-design/lookout/lookout.ps1 + state/ (usage.json, lookout.log
  currently; ALERT/PAUSE are marker files that appear on signal, per briefing).
- Charter files present: .claude/agents/wave-developer.md, wave-researcher.md,
  wave-reviewer.md, wave-team-lead.md.

## Output
- Wrote suite-design/overnight/MISSION-CONTEXT.md: 65 lines, ASCII-only verified
  with grep -P '[^\x00-\x7F]' (no matches). Covers repo layout, spec map with
  section numbers, tracking files, branch model, Lookout, parking protocol,
  quality bar.

## Notes / risks
- lookout/state/ did not contain ALERT or PAUSE files at inspection time; brief
  describes them as signal markers as directed by the briefing.
- Chart Room phase numbering (8.1-8.5) taken from PLAN.md's spec refs; the spec's
  sec 8 is titled "Build order (phases, each shippable)".
- Commit scope restricted to: MISSION-CONTEXT.md, four .claude/agents/wave-*.md,
  CAPTAIN-INBOX.md, CAPTAIN-TODO.md. Many other worktree modifications left
  untouched and uncommitted. This report file itself is NOT committed (not in the
  allowed commit list).
