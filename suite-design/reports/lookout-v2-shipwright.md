---
id: lookout-v2-waiter-shipwright-evidence-report
---

# Lookout v2 waiter -- shipwright evidence report

Date: 2026-07-09. Branch: ship-wave1 (edited in place, no git commands run, per dispatch).
Plan: `.claude/plans/suite-repo-onboarding-and-lookout-v2.md`, Workstream 2.

## Verdict

DONE. All items implemented; tests, builds, and lint green on both packages.

## Evidence (all run 2026-07-09)

| Check | Result |
| --- | --- |
| `pnpm -C packages/reset-detector test` | 67 passed (7 files) -- includes 17 new `wait.test.ts` tests |
| `pnpm -C packages/scheduler test` | 41 passed (6 files) -- includes 7 new `wait.test.ts` loop tests |
| `pnpm -C packages/reset-detector build` (tsc) | clean |
| `pnpm -C packages/scheduler build` (tsc) | clean |
| `pnpm -C packages/{reset-detector,scheduler} lint` (eslint) | clean, both |
| Live CLI smoke (built dist) | refusal path exit 1 with "another waiter is already running (PID ...)"; `--grace-minutes -5` exit 2; USAGE mentions `lookout wait` |
| Loop smoke (vitest, injected clock) | arm -> renewal -> 10-min grace at 60 s polls -> continue; exact three-part message asserted, incl. resume-prompt.txt appended |

## Files

New:
- `packages/reset-detector/src/wait.ts` -- pure `decideWaitTick` + `WaitPolicy`/`WaitAction`
- `packages/reset-detector/test/wait.test.ts`
- `packages/scheduler/src/wait.ts` -- `runWaitLoop` (WAITER pid single-instance, self-sense via
  `runSensorOnce`, wait.log audit, 60 s grace tightening, maxHours expiry, clean-stdout contract)
- `packages/scheduler/test/wait.test.ts`

Modified:
- `packages/reset-detector/src/index.ts` -- export wait module
- `packages/scheduler/src/state.ts` -- `waitLogFile` + `waiterPidFile` in `statePaths` (additive only)
- `packages/scheduler/src/config.ts` -- `wait: WaitConfig` (WaitPolicy + `maxHours: 24`), merged in
  `loadConfig` like thresholds/guard (additive only)
- `packages/scheduler/src/cli.ts` -- `wait` command, `--grace-minutes/--fresh-below-pct/--max-hours`
  flags, USAGE rewritten (wait primary, guard under "Optional deep fallback")
- `packages/scheduler/src/index.ts` -- export `runWaitLoop` etc.
- `packages/scheduler/README.md` -- waiter documented as the primary flow; guard demoted to
  "Optional deep fallback (survives terminal death)"

## Deviations from the dispatch (all small, all deliberate)

1. `WaitInput` gained an optional `armedPeakPct` field and `WaitPolicy` a fourth field
   `collapseFromPct` (default 80). The dispatch's secondary renewal signal ("pct collapsed on an
   equal key") requires knowing the armed window had actually burned; without that floor, arming
   inside an already-fresh window (the normal session-start case, pct < 20 at spawn) would
   false-fire a renewal on the next tick. Window-key change remains the primary signal; both
   choices are documented in `wait.ts` comments and unit-tested (false-fire case included).
2. `defaultIsPidAlive` (4 lines) is duplicated in scheduler/src/wait.ts rather than exported from
   lock.ts -- lock.ts was not on the may-touch list.
3. The `wait` CLI prints nothing at startup (only the outcome message): the background task's
   stdout is delivered verbatim to the spawning session, so startup chatter would ride in front of
   "LOOKOUT CONTINUE". Startup is logged to wait.log instead.

Nothing blocked; guard/sensor/lock logic untouched (guard tests still pass unmodified).
