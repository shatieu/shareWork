---
id: lookout-the-fo-s-usage-guard-protocol
name: lookout
description: First Officer usage-guard protocol for long autonomous missions -- start/verify the Lookout sensor, take the mission lock, spawn the `lookout wait` waiter that nudges this session when the usage window renews, read signals mechanically, and checkpoint at PAUSE. Use at mission start, before every package dispatch/approval, and whenever ALERT/PAUSE handling is needed.
---

# Lookout -- the FO's usage-guard protocol

The Lookout (`packages/scheduler`, bin `lookout`) is a sensor-only poller: it
measures usage and writes signal files; it never controls anything. The First
Officer reads its signals and acts; the waiter (`lookout wait`) is the wake-up
channel across window resets. The old PowerShell prototype
(`suite-design/lookout/*.ps1` and its `state/` dir) is retired -- kept for
history only; never run it or read its state.

## Signals (one canonical path)

State dir: `.ship/lookout/` in the repo (whatever `lookout status` says).

- `usage.json` -- `{ five_hour_pct, seven_day_pct, resets_at, checked_at }`
- `ALERT` / `PAUSE` -- marker files; PRESENCE is the signal, self-clearing when
  usage drops back under threshold (defaults: ALERT >= 80, PAUSE >= 93
  five_hour_pct)
- `lookout.log` -- one line per poll

Never read any other usage.json copy elsewhere in the repo -- a stale duplicate
once fed a session hours-old data (LESSONS-LEARNED.md). One path, always.

## Session start

1. `lookout init` if the repo has no `.ship/lookout/config.json` yet. Edit
   `.ship/lookout/resume-prompt.txt` to the mission (tracking-file locations,
   how to re-orient) -- it is the text the waiter hands back to you.
2. **Take the mission lock:** `lookout lock acquire`; if it refuses, another
   session owns this repo -- stand down, do not work around it. Heartbeat with
   `lookout lock heartbeat` every <= 25 min while alive.
3. Verify the sensor is fresh (`usage.json` `checked_at` within ~2 poll
   intervals); if stale/absent, start `lookout watch` detached and re-verify a
   fresh poll landed before dispatching anything.
4. **Spawn the waiter:** `lookout wait` as a background Bash task
   (`run_in_background: true`). Its exit output is delivered back to THIS
   session by the harness -- that is the CONTINUE nudge. On window renewal with
   no session activity through the grace period it prints
   `LOOKOUT CONTINUE -- ...` plus resume-prompt.txt and exits 0; if the session
   was active it re-arms silently. Defaults: grace 10 min, fresh-below 20 pct,
   max 24 h (`--grace-minutes`, `--fresh-below-pct`, `--max-hours`,
   `--state-dir`). Single-instance, pid-guarded. No Task Scheduler, no cron.
5. Verify the working branch contains the Lookout config + mission files (a
   branch cut from a stale point once silently missed them).

## The mechanical dispatch rule (non-negotiable)

Decisions key ONLY on signal files present at the moment of dispatch:

- **No ALERT** -> dispatch normally, whatever the pct trend looks like.
- **ALERT present** -> finish in-flight work; start no new package-level work;
  cheap bookkeeping (status notes, commits, push) is allowed.
- **PAUSE present** -> checkpoint (below), then idle until reset.

Never pre-empt a threshold that has not fired. Never extrapolate burn rates
into a self-imposed hold -- parallel-agent spikes flatten the moment you go
quiet, and being interrupted by PAUSE is a normal, cheap event (commits are
insurance). Idle-by-choice is the expensive failure; when in doubt, continue
and commit more often. Check signals before every dispatch/approval, at every
package boundary, and ~every 15 minutes during long waits.

## Checkpoint + pause (PAUSE raised)

1. Let in-flight workers' commits stand; start nothing new.
2. Write a checkpoint to the mission tracking file (STATUS): current package,
   exact resume instruction (what to dispatch, which plan, which branch,
   approvals already given). Commit; push the integration branch if no worker
   holds the worktree.
3. **Verify the waiter is alive** (the background task is still running);
   respawn `lookout wait` if not -- the waiter is the wake-up guarantee.
   `ScheduleWakeup` (`resets_at` + 5 min, chained hourly if clamped) stays
   allowed as best-effort belt-and-braces, but it is optional: a session-level
   timer dies at a hard token cap; the waiter does not.
4. `lookout lock heartbeat`, then idle.

## On the LOOKOUT CONTINUE notification

Re-read the signals, re-read the checkpoint, resume the queue from it. If you
already woke by other means and acted, the waiter re-arms or stands down
silently -- ignore any stale CONTINUE; never treat it as a second resume
instruction.

## The guard (optional deep fallback)

`lookout guard` survives the terminal itself being closed: a per-machine,
HUMAN-installed Task Scheduler/cron tick (`lookout guard install --print`
prints the commands; never self-install). Not part of the default protocol;
see the packages/scheduler README.

## Interaction with the crew

Crew agents never watch the Lookout -- only the FO does. Do not add signal
checks to worker dispatches; keep workers committing early and often so a
mid-flight PAUSE loses nothing. On clean mission end: `lookout lock release`
and let the waiter expire or stop it.
