---
id: package-10-scheduler-productization-trio-specs-c
---

# Package 10 — Scheduler productization (Trio_Specs §C)

**Mode:** combined plan+implement (Captain's wrap-up order 2026-07-06 09:35).
**Branch:** `ship-wave1-scheduler`, isolated worktree. **TL:** this session.

## Scope

Productize the battle-tested Lookout (this very mission's `suite-design/lookout/*.ps1`) so
any repo can run what this mission ran by hand. Deliverables per spec §C product shape +
dispatch:

1. **`packages/reset-detector`** — the standalone library (Suite-Architecture §3 names it):
   pure, zero-runtime-dep TypeScript. OAuth usage source (cache ≥5 min, never hammer on
   failure), statusline-JSON + limit-message parsers, signal fusion, threshold evaluation
   (ALERT 80 / PAUSE 93 defaults, pause-vs-spend mode switch), **jitter-proof window key**
   (resets_at +30 s → truncate to minute — the 2026-07-06 guard patch that fixed 5
   resurrections/window), and a **pure guard decision function** (sensor-freshness →
   relaunch; five_hour_pct < 20 gate; 30-min idle gate paired with the ≤25-min alive-touch
   heartbeat contract; once-per-window marker dedup; session-pinned resurrect command:
   `--resume <sessionId>`, never `-c`/`--continue`; `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`
   in the spawn env — the print-mode bg-kill patch).
2. **`packages/scheduler`** — bin **`lookout`** (spec §C names the binary), depends on
   reset-detector. Subcommands: `init` (mints session uuid, writes config, prints the
   pinned `claude --session-id <uuid>` launch line), `once`/`watch` (sensor: writes
   `usage.json` + self-clearing `ALERT`/`PAUSE` markers + log under `.ship/lookout/` —
   spec's signal path; dir configurable), `guard --once`/`guard` (harness fallback:
   keeps sensor alive, resurrects headlessly at most once per window; marker written
   BEFORE spawn), `guard install --print` (prints exact schtasks/cron registration lines,
   **never executes** — registration is the documented per-machine step), `lock
   acquire|status|heartbeat|release` (mission lockfile: PID + sessionId + heartbeat;
   refuses when live, reaps stale = dead PID or heartbeat > N min; release overwrites,
   never unlinks), `status`. README = full runbook incl. registration, heartbeat contract,
   decommission steps (learnings from `uninstall.ps1`).
3. **`plugins/crew/skills/graceful-pause/SKILL.md`** — agent-side protocol, productized
   from `.claude/skills/lookout/SKILL.md` + LESSONS-LEARNED: mechanical dispatch rule
   (signals only, never extrapolate), checkpoint procedure, ScheduleWakeup-does-not-
   survive-hard-caps → guard is the fallback, one canonical signal path, mission lock at
   session start. **New directory only** — no edits to `hooks/hooks.json` or any shared
   crew file (package 8 owns `plugins/crew` concurrently; collision avoidance).
4. Changelog fragment `suite-design/overnight/changelog/entries/2026-07-06--scheduler.md`.

## Out of scope (explicit)

- SQLite task queue + `claude agents` dispatch (spec build order: "detector library →
  queue + dispatch"; queue is the next slice).
- Budget-capped spend mode / per-task-class overrides (spec defers; binary
  pause-vs-spend switch IS in — proven `-AllowExtraUsage` equivalent).
- Crew PreToolUse/Notification hook wiring (shared-file collision with package 8; the
  scheduler README documents the hook snippet for users instead).
- Desktop notifications ("optional" in spec). Real Task Scheduler/cron registration.

## Design notes

- reset-detector keeps ALL policy pure + injectable (clock, fetch, fs probes) →
  deterministic tests; scheduler owns I/O (spawn, files) behind thin wrappers.
- Signal-file shape stays mission-compatible: `{ five_hour_pct, seven_day_pct,
  resets_at, checked_at }`; markers self-clear when pct drops (proven live 07-05).
- Guard resurrect refuses without a configured sessionId (session-pinning lesson) and
  logs why; no silent `-c` fallback.
- No new external runtime deps (CLI is hand-rolled argv parsing; uuid via
  `node:crypto.randomUUID`). Dev deps mirror siblings (vitest, eslint, tsc).

## Test plan / acceptance

- Vitest suites in both packages (target ≥40 combined): window-key jitter dedup,
  threshold set/clear + spend-mode suppression, oauth cache + failure keep-last,
  parsers, guard decision matrix (fresh/stale sensor, pct gates, idle gates, marker
  present, missing sessionId), lock acquire/refuse/stale-reap/heartbeat, state I/O.
- `acceptance/scheduler-accept.mjs` (deterministic, zero network, zero scheduler
  registration): replays simulated usage sequences incl. jittered resets_at
  (06:29:59.9 vs 06:30:00.1 across polls) through sensor+guard → asserts exactly ONE
  resurrection decision per window, ALERT/PAUSE raise + self-clear lifecycle, resurrect
  argv contains `--resume <id>` + env ceiling 0, lock refuses second acquire and reaps
  stale.
- Full `pnpm turbo build lint test` green in the worktree; floors hold (chartroom 269,
  chartroom-ui 180, ship 15, ship-log 81, suite-conventions 35, ship-ledger 35,
  ship-inbox 51).

## Risks / decisions

- Package names `reset-detector`/`scheduler` are generic but fixed by
  Suite-Architecture §3; both `private: true`. Nautical rename ("when they ship") is a
  Captain call later — FYI, not blocking.
- State dir default is repo-local `.ship/lookout/` per spec §C (mission prototype used
  `suite-design/lookout/state/`); configurable. FYI appended to DECISIONS-NEEDED.
- oauth endpoint remains undocumented — library treats it as best-effort source with
  keep-last-good semantics; that behavior is tested, the live endpoint is not (stated
  plainly in the report as not-proven).
