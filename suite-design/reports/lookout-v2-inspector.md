---
id: inspector-evidence-lookout-v2-waiter-skills-2026-07-09
---

# Inspector evidence — Lookout v2 waiter + skills (2026-07-09)

Verdict: **PASS** (after re-inspection — see the dated section at the bottom). The initial pass
was FAIL on one CLI acceptance miss (unknown flag not rejected); the fix was applied and verified
live. Original FAIL evidence is kept below for the record.

## Gates run personally

| Gate | Command | Result |
|---|---|---|
| reset-detector build | `pnpm build` (tsc) | clean |
| reset-detector tests | `pnpm test` (vitest) | 7 files, 67 tests, all pass |
| reset-detector lint | `pnpm lint` (eslint) | clean, exit 0 |
| scheduler build | `pnpm build` (tsc) | clean |
| scheduler tests | `pnpm test` (vitest) | 6 files, 41 tests, all pass (incl. test/wait.test.ts, 7 tests) |
| scheduler lint | `pnpm lint` (eslint) | clean, exit 0 |

Note: I rebuilt both packages before exercising `dist/cli.js`, so I cannot attest whether the
pre-existing dist was stale; all CLI evidence below is against a fresh build of current src.

## Behavioral acceptance (a)–(e)

Driven via the injected-clock/sleep harness in `packages/scheduler/test/wait.test.ts`
(runs I executed, not report claims):

- (a) arm on current window — asserted (`actions[0].kind === 'arm'`, log "armed on window 20260709-1000").
- (b) renewal → 10-min grace, no activity → CONTINUE with exact text: test asserts the full
  first line `LOOKOUT CONTINUE — usage window renewed (five_hour 2%, was window 20260709-1000, now 20260709-1500); no session activity for 10 min since renewal.` — pct, old key, new key all
  present — plus the second line and the verbatim `resume-prompt.txt` appended. Exit path returns 0
  (cli.ts:180).
- (c) activity during grace → silent re-arm, no exit — tests "re-arms silently when the session
  wakes itself during grace" and "counts the LOCK heartbeat as session activity"; the later second
  renewal still fires, reporting the re-armed key as "was".
- (d) second waiter with live pid refuses — unit test, plus a LIVE run: spawned
  `dist/cli.js wait --state-dir sd2` in background, second invocation printed
  "another waiter is already running (PID 19776 …) — refusing to start a second one", exit 1.
- (e) maxHours expiry — test asserts `LOOKOUT WAITER EXPIRED`, "respawn", "lookout wait", pid file removed.

## CLI checks (live, scratchpad state dirs only)

- `lookout help` — USAGE printed, mentions `wait` + all three flags with correct defaults; exit 0.
- Unknown command (`lookout frobnicate`) — exit 2. Good.
- Bad flag value (`wait --grace-minutes abc`) — "--grace-minutes must be a positive number", exit 2. Good.
- **Unknown flag (`wait --bogus-flag --state-dir sd1`) — DOES NOT exit 2.** The flag is silently
  swallowed and the wait loop starts (process still running at 6 s; killed by timeout, exit 124).
  Root cause: `parseFlags` (packages/scheduler/src/cli.ts:48-79) puts any unrecognized `--x` into
  `bools` and never errors. Corollaries: `lookout wait --help` starts the 24 h loop instead of
  printing usage (the `case '--help'` at cli.ts:101 is unreachable — `--help` never lands in
  positional), and a typo'd flag (`--grace-mintues 30`, `--maxhours 1`) silently runs with defaults.
  For an unattended background waiter this is a real footgun, and it is an explicit acceptance line
  in the dispatch ("unknown flag → exit 2").

## Named risks

- r1 (equal-key pct-collapse false fire on fresh-window start): defended and proven. `arm` seeds
  `armedPeakPct` from the current pct; secondary renewal requires `armedPeakPct >= collapseFromPct`
  (80). Green tests: "pct below freshBelowPct alone is NOT a renewal when the window never burned",
  "pct collapse without peak tracking (armedPeakPct null) is NOT a renewal", plus jitter-across-minute
  non-renewal. Peak is max-tracked only while armed and not in grace (wait.ts:231-233). Could not defeat it;
  residual: a spurious endpoint dip 80→<20 on an unchanged key after 10 idle min fires an early
  nudge — low harm, by design.
- r2 (heartbeat mtime vs field): the waiter parses the LOCK's `heartbeatAt` FIELD
  (scheduler/src/wait.ts:162), never file mtime; `touchLock` writes ISO now into that field
  (lock.ts:147); invalid parse → NaN → ignored. Consistent.
- r3 (stdout purity): cli.ts prints nothing before `runWaitLoop` returns; loop logs go to
  `wait.log` via `appendLog`; sensor/state/guard/oauth contain zero `console.*`/stdout writes;
  git probe uses `stdio: ['ignore','pipe','ignore']`. Empirically: two live waiter runs
  (incl. a real self-sense tick) produced 0 bytes of output before kill.
- r4 (stale pid after crash): liveness is pid-only (`process.kill(pid, 0)`, wait.ts:57-64);
  `startedAt` recorded but not used. Pid-reuse after a crash would falsely refuse the next waiter.
  Acceptable per dispatch; noted. Dead-pid reap is unit-tested; SIGKILL leaves the WAITER file
  (finally can't run) and the next spawn reaps it.
- r5 (workspace link): scheduler imports `decideWaitTick`/`WaitAction`/`DEFAULT_WAIT_POLICY` from
  `reset-detector` (workspace:*); tsc build, vitest, and the live dist CLI all resolved them.

## Skills / docs

- `plugins/crew/skills/setup/SKILL.md` — Mode A checklist matches the plan's canonical list item
  for item (Chart Room 6 items, crew plugin/scrutiny/gitignore, MCP human-only, lookout init +
  resume prompt, mission scaffold); Mode B matches the spec-anatomy list including all failure modes.
- `graceful-pause` and `.claude/skills/lookout` — mutually consistent; flags and defaults
  (grace 10 / fresh-below 20 / max 24, `--grace-minutes`/`--fresh-below-pct`/`--max-hours`/`--state-dir`)
  verified against DEFAULT_WAIT_POLICY (reset-detector/src/wait.ts:44-49), DEFAULT_WAIT_CONFIG
  (config.ts:54) and the USAGE text — not against the reports. ALERT 80 / PAUSE 93 claims match
  DEFAULT_THRESHOLDS (types.ts:48). Guard correctly demoted to opt-in fallback in both.
- README rewritten around the waiter as primary flow; consistent with code.

## Minor observations (non-blocking)

- `lookout --help` prints USAGE but exits 2 (falls into the `command === undefined` path).
- If a user configures `activityDirs` to include the state dir, the waiter's own `wait.log`
  writes would count as session activity and suppress the nudge — worth a doc caveat.
- Refusal message goes to stdout (fine — it is the delivered outcome).

## Re-inspection 2026-07-09 (after orchestrator fix to packages/scheduler/src/cli.ts)

Fix reviewed via `git diff`: `parseFlags` gains a `knownBools` allowlist
(`--json`, `--once`, `--print`, `--force`, `--help`) and throws `unknown flag: <arg>` for anything
unrecognized (caught in `main` → exit 2); the three waiter value flags joined `takesValue`; a
top-level `--help` check before the command switch prints USAGE and returns 0.

Gates re-run: `pnpm build` clean, `pnpm test` 41/41 green, `pnpm lint` exit 0.

Live against rebuilt dist (scratchpad state dirs):

| Invocation | Expected | Got |
|---|---|---|
| `wait --bogus-flag` | exit 2 | exit 2, `unknown flag: --bogus-flag` (loop never starts) |
| `wait --help` | usage, exit 0 | USAGE (mentions `lookout wait`), exit 0 |
| `wait --grace-mintues 30` (typo) | exit 2 | exit 2, `unknown flag: --grace-mintues` |
| `--help` (top level) | exit 0 | exit 0 (was 2 pre-fix — minor observation also resolved) |
| `guard install --print` | exit 0 | exit 0, schtasks/cron commands printed |
| `init --session-id <uuid> --mode pause` | exit 0 | exit 0 |
| `lock acquire` / `lock release --force` | exit 0 | exit 0 / exit 0 |
| `status --json` | exit 0 | exit 0, valid JSON with sessionId |

No legitimate invocation broke. Verdict: **PASS**.
