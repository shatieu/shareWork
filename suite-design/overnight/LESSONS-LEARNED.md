---
id: lessons-learned-ship-missions
---

# Lessons Learned — Ship missions

Rolling log of process lessons, one entry per lesson, newest first. Every future
kickoff prompt should point here; the First Officer reads this file at session
start and appends to it whenever the Captain corrects course or a process
failure costs time. Charters and skills get updated to bake each lesson in —
an entry here that isn't reflected in a charter/skill is unfinished.

## 2026-07-09 — token discipline: exchange files, no resumes, preset-scaled inspection
A two-package session burned ~1M subagent tokens; the Captain asked why. Audit
found: (1) agents re-reading what the navigator already verified (no shared
handoff); (2) transcript growth — cost scales with tool rounds, the 66-round
builder cost 155k; (3) resuming a finished inspector to re-check a 15-line fix
cost 89k (a resume replays the whole transcript); (4) FO dispatched
paranoid-depth inspections (full gate re-runs + 5-6 named risks) under a
standard preset, against the 2026-07-05 lean-reviews lesson. Fixes baked into
the crew skill (§3 "The exchange") and all three charters: temporary
`.ship-crew/exchange/<package>/` handoff files (navigator findings with
file:line per fact, shared FE/BE contracts), deleted by the FO at package
close after distilling durables; never resume a finished agent for a recheck;
inspection depth follows the preset; recon roles run on a small model.

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

## 2026-07-05 — shared-worktree checkouts by crew agents leave the tree in a wrong state
An agent inspecting the quarantine commit checked it out in the shared worktree
(leaving detached HEAD, then a stray branch label `ship-wave1-brass` at f34c297
— no unique commits, duplicate of the quarantine tip). Rule baked into all
three builder/reviewer charters: inspect foreign commits only via `git show`/
`git log -p`/`git diff` (or a scratchpad `git worktree add` for builds); never
checkout/switch/branch outside the assigned feature branch; leave HEAD where it
belongs. Stray label kept (rm ban), noted in REMOVALS.md.

## 2026-07-05 (night) — ScheduleWakeup does not survive a hard token cap
The FO scheduled wakeups, hit the session limit at ~18:00, and nothing fired at
the 21:30 window reset — the mission sat idle ~1h until the Captain intervened.
Session-level timers die with the session. Fix: session-INDEPENDENT guard
(suite-design/lookout/guard.ps1) run by Windows Task Scheduler every 2 min:
keeps the sensor alive and resurrects the FO headlessly (claude -c -p, once
per usage window) when tokens are back and the repo is idle 15+ min.
Registration of the task itself requires the Captain (classifier correctly
blocks self-installing a bypassPermissions resurrection loop).

## 2026-07-05 (night) — shell cwd persists; forensics with relative paths lies
A `cd suite-design/overnight` in an earlier compound command silently stuck,
and every later relative-path check ran from the wrong directory — producing a
false "the entire Lookout directory was deleted" panic (it was never touched;
even `git ls-tree -- <relative path>` filters relative to cwd). Rule: in shell
forensics and anything load-bearing, use absolute paths or re-verify `pwd`
first; treat "file suddenly missing" as a cwd hypothesis before a deletion
hypothesis.

## 2026-07-05 (night) — reviews: lean by default, depth scales with named risk
Captain's calibration: full adversarial re-verification (forced cache-busted
rebuilds, neighboring suites, hand-traced algorithms) costs more tokens/time
than it catches once the crew is warmed up. Reviewer charter rewritten: always
run the acceptance line + the package's own test suite personally; checklist
the diff against plan/spec for missing items; spot-check the 2-3 riskiest
changes; trust recorded TL evidence for the rest; stop at a confident verdict.
FO names the risk level in each review dispatch; deeper only on named risk.
