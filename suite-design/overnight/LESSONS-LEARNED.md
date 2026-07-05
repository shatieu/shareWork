---
id: lessons-learned-ship-missions
---

# Lessons Learned — Ship missions

Rolling log of process lessons, one entry per lesson, newest first. Every future
kickoff prompt should point here; the First Officer reads this file at session
start and appends to it whenever the Captain corrects course or a process
failure costs time. Charters and skills get updated to bake each lesson in —
an entry here that isn't reflected in a charter/skill is unfinished.

## 2026-07-05 — Lookout dispatch is mechanical, never preemptive
FO idled at a package boundary at 79% five_hour with NO ALERT raised,
extrapolating a burn spike its own (already finished) parallel dry-runs caused.
Cost ~1h until the Captain intervened. Rule: dispatch decisions key ONLY on
signal files present at dispatch time; never pre-empt an unfired threshold;
interrupted-by-PAUSE is cheap (commits + checkpoint + resume), idle is the
expensive failure. Baked into: `.claude/skills/lookout/SKILL.md`,
MARATHON-KICKOFF-PROMPT amendment, `.claude/agents/first-officer.md`.

## 2026-07-05 — FO must not commit while a worker holds the worktree
Subagents share one working directory; a Team Lead on a feature branch means
the FO's "ship-wave1 bookkeeping commit" silently lands on the feature branch
(happened: 56c538d rode ship-wave1-dogfood). Rule: FO commits only at package
boundaries, or accepts the commit travels with the package's merge.

## 2026-07-05 — .claude/agents definitions hot-load only after a harness refresh
Charters written mid-session were not immediately dispatchable as
`subagent_type` (dispatch errored), but became available later in the same
session after a harness refresh. Rule: check the available-types list; use the
chartered type when listed, otherwise dispatch `general-purpose` with a
first-line "read .claude/agents/<charter>.md and adopt it as your complete
role definition" preamble. Never block on a missing type. Feed into the Crew
package.

## 2026-07-05 — one canonical signal path, kill stale copies
Two usage.json files existed (old `suite-design/overnight/usage.json`, stale
since 02:58, vs live `suite-design/lookout/state/usage.json`). A session
checking the wrong one reads hours-stale data. Canonical: `suite-design/
lookout/state/`. Stale copies get flagged in REMOVALS.md, never trusted.

## 2026-07-05 — the 30-line report contract works; enforce it in every dispatch
5/5 chartered dry-runs and packages honored verdict-first <=30-line reports
with evidence written to files. Context survived a full package cycle with the
FO reading zero source files. Keep the contract line in every charter and
every ad-hoc dispatch.

## 2026-07-04/05 (night session, carried forward) — branch off fresh ship-wave1
A feature branch cut from a stale point silently missed the Lookout files.
Always branch off up-to-date ship-wave1; verify mission files exist on the
working branch at session start.
