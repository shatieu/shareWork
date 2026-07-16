---
id: evidence-docs-skills-shipwright-setup-skill-lookout-v2-skill-rewrites
---

# Evidence -- docs/skills shipwright (setup skill + lookout-v2 skill rewrites)

Date: 2026-07-09. Branch: ship-wave1 (no git commands run, per dispatch).
Plan: .claude/plans/suite-repo-onboarding-and-lookout-v2.md

## Files written

1. plugins/crew/skills/setup/SKILL.md (NEW)
2. plugins/crew/skills/graceful-pause/SKILL.md (REWRITE around the waiter)
3. .claude/skills/lookout/SKILL.md (REWRITE off the ps1 prototype onto the
   lookout bin + waiter)

## What was verified

- **Frontmatter parses**: the harness hot-loaded both `ship-crew:setup` and the
  repo-local `lookout` skill mid-session with the new descriptions -- proof the
  YAML frontmatter is valid and the descriptions register. graceful-pause keeps
  its existing frontmatter shape (id + name + description) with the `id:` line
  intact byte-for-byte: `graceful-pause-the-session-side-lookout-protocol`.
- **ASCII only**: `LC_ALL=C grep -n '[^ -~]'` over all three files -- zero
  non-ASCII bytes (em-dashes replaced with `--` throughout).
- **No stale prototype references**: grep for `lookout.ps1` and
  `suite-design/lookout/state` across the three files returns only the
  deliberate "retired prototype, kept for history, never run it" note in the
  lookout skill's intro.
- **No contradiction between the two protocol skills** (graceful-pause vs
  .claude/skills/lookout): the mechanical rule section is word-identical
  (No ALERT -> dispatch; ALERT -> no new package work; PAUSE -> checkpoint;
  never pre-empt; idle is the expensive failure; ~15-min signal checks); both
  name `.ship/lookout/` as the one canonical path; both spawn `lookout wait`
  via `run_in_background: true` at session start with defaults grace 10 min /
  fresh-below 20 pct / max 24 h, single-instance pid-guarded; both demote
  ScheduleWakeup to optional best-effort and the guard to a one-paragraph
  opt-in human-installed fallback; both keep "crew never watches signals" and
  `lookout lock release` on clean end. The only deltas are audience-scoped:
  the repo-local skill adds the branch-freshness check (LESSONS-LEARNED
  2026-07-04/05) and the retired-prototype note.
- **Checklist matches the plan**: Mode A items map 1:1 to the plan's
  "Canonical per-repo setup" list (Chart Room registry/index/init/ignore/
  install-skill/install-agent-hook/CLAUDE.md section; crew plugin enablement +
  ship.scrutiny + .gitignore triple; per-machine MCP as human-only citing
  plugins/crew/README.md; `lookout init`; mission scaffold). Mode B matches
  the plan's canonical spec anatomy, the kickoff-prompt anatomy, and the
  failure-mode list, each failure mode citing
  suite-design/overnight/LESSONS-LEARNED.md.
- **CLI surface referenced only per the agreed contract**: `lookout wait
  [--grace-minutes n] [--fresh-below-pct n] [--max-hours n] [--state-dir d]`,
  CONTINUE-on-exit semantics, silent re-arm on activity, max-hours respawn
  message. Existing subcommands (init/watch/status/lock/guard) verified
  against packages/scheduler/README.md; no packages/ files touched.

## Deviations

None. Dispatch followed as written; no scope beyond the three files + this
report.
