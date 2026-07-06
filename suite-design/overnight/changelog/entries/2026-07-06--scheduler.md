---
id: scheduler-productization-lookout-trio-specs-c
date: 2026-07-06
package: 10-scheduler
branch: ship-wave1-scheduler
---

# Scheduler productization — the Lookout (Trio_Specs §C)

The overnight mission's hand-run usage-guard loop, productized so any repo can run it.

- **`packages/reset-detector`** (new): the standalone pure library — cached oauth usage
  source (≥ 5 min, keep-last-good on failure, never hammer), limit-message + statusline
  parsers, three-signal fusion with cross-window disagreement flag, **jitter-proof window
  keys** (resets_at + 30 s → UTC minute; the patch that ended 5-resurrections-per-window),
  pause/spend threshold evaluation, and the pure guard decision: sensor-freshness →
  token gate (< 20 %) → idle gate (30 min, paired with the ≤ 25-min alive-touch
  heartbeat) → once-per-window dedup → session-pinned `--resume` command (never
  `--continue`) with `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`.
- **`packages/scheduler`** (new, bin **`lookout`**): sensor (`watch`/`once`) writing
  `usage.json` + self-clearing `ALERT`/`PAUSE` under `.ship/lookout/`; guard harness
  (`guard --once` for Task Scheduler/cron — marker written BEFORE spawn, refuses without
  a pinned session id); `init` mints the session uuid and prints the pinned launch line;
  **mission lock** (`lock acquire|status|heartbeat|release`) — refuses while live, reaps
  stale (dead pid or aged heartbeat), release marks-not-deletes; `guard install --print`
  prints the per-machine schtasks/cron registration and never executes it.
- **`plugins/crew/skills/graceful-pause/SKILL.md`** (new): the session-side protocol —
  mechanical ALERT/PAUSE dispatch rule, checkpoint procedure, ScheduleWakeup as best
  effort only (it dies at hard caps; the guard is the guarantee), lock + heartbeat
  contract.
- Evidence: 84 new vitest cases + a 22-check deterministic acceptance script replaying
  jittered usage sequences (zero network, zero scheduler registration, zero real spawns);
  full turbo gates green with all prior floors intact.
- Out of scope, per spec build order: the SQLite task queue + dispatch (next slice),
  budget-capped spend mode, desktop notifications.
