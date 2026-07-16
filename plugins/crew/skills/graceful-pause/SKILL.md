---
id: graceful-pause-the-session-side-lookout-protocol
name: graceful-pause
description: Quota-aware graceful pause for long autonomous sessions using the Lookout's signal files -- start/verify the sensor, take the mission lock, spawn the `lookout wait` waiter that nudges this session when the usage window renews, read ALERT/PAUSE mechanically, and checkpoint at PAUSE. Use at session start of any long-running or orchestrated mission, before every major dispatch/approval, and whenever ALERT/PAUSE handling is needed.
---

# graceful-pause -- the session-side Lookout protocol

The Lookout (`packages/scheduler`, bin `lookout`) is a sensor-only poller: it measures
usage and writes signal files; it never controls anything. **You** -- the session -- read
its signals and act. The waiter (`lookout wait`) is your wake-up channel across window
resets. This skill is the operating procedure, distilled from the overnight mission that
proved every rule in it (suite-design/overnight/LESSONS-LEARNED.md).

## Signals (one canonical path)

State dir: `.ship/lookout/` in the repo (configurable; whatever `lookout status` says).

- `usage.json` -- `{ five_hour_pct, seven_day_pct, resets_at, checked_at }`
- `ALERT` / `PAUSE` -- marker files; PRESENCE is the signal, they self-clear when usage
  drops back under threshold (defaults: ALERT >= 80, PAUSE >= 93 five_hour_pct)
- `lookout.log` -- one line per poll

Never read any other usage.json copy elsewhere in the repo -- a stale duplicate once fed
a session hours-old data. One path, always.

## Session start

1. `lookout init` if the repo has no `.ship/lookout/config.json` yet. Edit
   `.ship/lookout/resume-prompt.txt` to your mission (where your tracking files live,
   how to re-orient) -- the default is generic on purpose, and it is the text the waiter
   will hand back to you.
2. **Take the mission lock:** `lookout lock acquire`. If it refuses ("mission already
   owned"), another session owns this repo -- attach read-only or stand down; do NOT
   work around it. Heartbeat with `lookout lock heartbeat` on your alive-touch cadence
   (<= 25 min; the lock and the waiter's idle gate both key off session silence).
3. Verify the sensor is fresh (`usage.json` `checked_at` within ~2 poll intervals). If
   stale/absent, start it detached: `lookout watch` in the background. Re-verify a
   fresh poll landed before dispatching anything.
4. **Spawn the waiter:** run `lookout wait` as a background Bash task
   (`run_in_background: true`). When a background task exits, the harness delivers its
   output back to the session that spawned it -- that delivery IS your wake-up. The
   waiter watches for the usage window renewing; if you take no action through the
   grace period it prints `LOOKOUT CONTINUE -- ...` plus your resume-prompt.txt and
   exits 0. No Task Scheduler, no cron, no per-machine human step in the default flow.

   `lookout wait [--grace-minutes n] [--fresh-below-pct n] [--max-hours n]
   [--state-dir d]` -- defaults: grace 10 min, fresh-below 20 pct, max 24 h. It is
   single-instance (pid-guarded): a second spawn refuses rather than double-firing. At
   `--max-hours` it exits asking to be respawned.

## The mechanical rule (non-negotiable)

Decisions key ONLY on signal files present at the moment of dispatch:

- **No ALERT** -> dispatch normally, whatever the pct trend looks like.
- **ALERT present** -> finish in-flight work; start no new package-level work; cheap
  bookkeeping (status notes, commits, push) is allowed.
- **PAUSE present** -> checkpoint (below), then idle until reset.

Never pre-empt a threshold that has not fired. Never extrapolate burn rates into a
self-imposed hold -- parallel-agent spikes flatten the moment you go quiet, and being
interrupted by PAUSE is a normal, cheap event (commits are insurance). Idle-by-choice
is the expensive failure; when in doubt, continue and commit more often. Check signals
before every dispatch/approval, at every work-unit boundary, and ~every 15 minutes
during long waits.

## Checkpoint + pause (PAUSE raised)

1. Let in-flight work finish and its commits stand; start nothing new.
2. Write a checkpoint to your tracking file: current position, the exact resume
   instruction (what to dispatch next, which plan, which branch), approvals already
   given. Commit; push if the worktree is yours to push.
3. **Verify the waiter is alive** (the background task is still running); if not,
   respawn `lookout wait` -- the waiter is your wake-up guarantee. A native
   `ScheduleWakeup` (`resets_at` + 5 min, chained hourly if clamped) stays allowed as
   best-effort belt-and-braces, but it is optional: a session-level timer dies at a
   hard token cap (a mission sat idle an hour learning this); the waiter does not.
4. `lookout lock heartbeat`, then idle.

## On the LOOKOUT CONTINUE notification

When the waiter task completes with `LOOKOUT CONTINUE -- ...`: re-read the signals,
re-read your checkpoint, resume the queue from it. If you already woke by other means
(your own ScheduleWakeup, a human nudge) and acted, the waiter detects the activity
and re-arms or stands down silently -- if a CONTINUE still arrives after you have
resumed, ignore it; never treat it as a second resume instruction.

## The guard (optional deep fallback)

`lookout guard` is the one layer that survives the terminal itself being closed: a
per-machine, HUMAN-installed Task Scheduler/cron tick (`lookout guard install --print`
prints the commands; never self-install) that resurrects the pinned session headlessly.
It is NOT part of the default protocol -- opt in only for missions that must outlive
the terminal; see the packages/scheduler README.

## Crew interaction

Subagents never watch the Lookout -- only the orchestrating session does. Do not add
signal checks to worker dispatches; keep workers committing so a mid-flight PAUSE
loses nothing. On clean mission end: `lookout lock release` and let the waiter expire
or stop it.
