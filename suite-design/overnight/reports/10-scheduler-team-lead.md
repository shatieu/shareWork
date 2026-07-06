---
id: package-10-scheduler-team-lead-report
---

# Package 10 (scheduler) — Team Lead report

**Verdict: IMPLEMENTED, self-verification green.** Branch `ship-wave1-scheduler`
(worktree `<scratchpad>/wt-scheduler`), 4 commits off fresh `ship-wave1` @ 78a1fbd
(== origin at branch time). Combined mode per Captain's 09:35 wrap-up order; plan
written first (`plans/10-scheduler-plan.md`), then implemented; no deviations from plan
except one mid-build design fix (lock semantics, §Deviations).

## Commits

1. `f78131c` feat(reset-detector): standalone library (50 tests)
2. `3f5bae9` feat(scheduler): `lookout` bin — sensor, guard, mission lock (34 tests + acceptance)
3. `35fd05f` feat(crew): graceful-pause skill (new dir only, zero shared-file edits — pkg 8 collision avoidance)
4. `25b3809` docs(scheduler): changelog fragment (`changelog/entries/2026-07-06--scheduler.md`)

## What shipped (spec §C product shape, dispatch scope)

- `packages/reset-detector` — pure, zero-runtime-dep: oauth source (cache ≥5 min,
  keep-last-good on failure, never hammer), limit-message + statusline parsers,
  three-signal fusion with disagreement flag, jitter-proof window keys (+30 s → UTC
  minute; the 2026-07-06 guard patch), pause/spend threshold evaluation,
  `decideGuardAction` (freshness → pct<20 → 30-min idle paired with ≤25-min heartbeat →
  once-per-window → `--resume <pinned id>` never `--continue`, with
  `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`; refuses without sessionId).
- `packages/scheduler` (bin `lookout`) — `init` (mints uuid, prints pinned launch),
  `once`/`watch` sensor writing prototype-shape `usage.json` + self-clearing
  ALERT/PAUSE to `.ship/lookout/` (spec's path), `guard --once` (marker BEFORE spawn),
  `guard install --print` (print-only registration — the documented per-machine human
  step; never executes), `lock acquire|status|heartbeat|release`, `status`. README is
  the full runbook incl. decommission checklist from uninstall.ps1 learnings.
- `plugins/crew/skills/graceful-pause/SKILL.md` — session-side protocol: mechanical
  dispatch rule, checkpoint procedure, ScheduleWakeup-dies-at-hard-caps → guard is the
  guarantee, lock + heartbeat contract, one canonical signal path.
- Root `.gitignore`: added `.ship/` (runtime-only signal path).

## Evidence (all fresh-run in the isolated worktree)

- `turbo run test --force` (uncached): 19/19 tasks green. Floors exact:
  chartroom 269, chartroom-ui 180, ship 15, ship-log 81, suite-conventions 35,
  ship-ledger 35, ship-inbox 51. New: reset-detector 50, scheduler 34 (84 new).
- `turbo run build` 12/12, `turbo run lint --force` 16/16 (0 errors, 0 warnings after
  fixing one unused-var + one mjs-global).
- Acceptance `packages/scheduler/acceptance/scheduler-accept.mjs`: **22/22 PASS**,
  deterministic — simulated usage sequences incl. resets_at jitter across the minute
  boundary (16:29:59.9 / 16:30:00.1 / …): sensor ok→ALERT→PAUSE→self-clear; exactly ONE
  resurrection decision + ONE marker across 4 jittered guard ticks; new window fires
  again; refuse without sessionId; lock acquire/refuse-live/stale-reap/release-not-unlink.
  Zero network, zero Task Scheduler registration, zero real spawns (per dispatch).
- CLI smoke (real processes): `init` → `lock acquire` → `status` (live, exit 1) →
  `heartbeat` → `release` → `status` (released) round trip; `guard install --print`
  emits correct machine-specific schtasks + cron lines.
- `team-tasks/` diff vs HEAD: empty. No deletions (marker self-clear is product
  behavior on its own gitignored runtime state, not a repo deletion).

## Deviations from plan (visible, argued)

- **Lock liveness reworked mid-build** after the CLI smoke exposed that a CLI-acquired
  lock records the transient CLI pid (dead at command exit → instantly reapable).
  Fix: pid 0 = pid-untracked, heartbeat-governed (stale default 30 min, pairing with
  the ≤25-min alive-touch contract); ownership for heartbeat/release accepts sessionId;
  library callers with real pids keep the spec's fast dead-pid reaping. Tested both modes.
- Crew PreToolUse hook NOT wired into `plugins/crew/hooks/hooks.json` (planned as
  out-of-scope): package 8 owns those files concurrently; the hook snippet is documented
  in the scheduler README step 5 instead.

## NOT proven (stated plainly)

- The live oauth endpoint (undocumented): fetch/cache/failure logic is tested against
  fakes only; no real network call was made this package. The prototype proved the
  endpoint itself on 2026-07-05 live usage.
- A real headless `claude --resume` resurrection spawn via `defaultSpawnDetached`
  (cmd.exe path on Windows): argv/env composition is asserted everywhere, but actually
  spawning a bypassPermissions session was deliberately not done. First real mission run
  should watch `guard.log`/`resurrect-out.log` once a human registers the task.
- Long-run `lookout watch` wall-clock behavior (loop tested with injected sleeper).

## Parked

- DECISIONS-NEEDED: 2 FYI defaults (generic package names fixed by Suite-Architecture
  §3 — nautical rename is one `git mv` away; repo-local `.ship/lookout/` default vs
  Bridge's `~/.ship/` home convention). Nothing blocking.
- No CAPTAIN-TODO entry: guard registration is per-mission opt-in, not a pending
  integration step for this repo (Captain decommissioned the prototype task this morning).

## For the FO

Merge-ready: `ship-wave1-scheduler`, 4 commits, no shared-file overlap with packages
7/8/12/13 except root `.gitignore` (+2 lines, additive) and `pnpm-lock.yaml` (two new
importer sections, additive — trivial conflict if another package also adds one; take
both sides or re-run `pnpm install`). Plan + this report live in the main worktree
uncommitted per parallel-wave tracking-edits rule.
