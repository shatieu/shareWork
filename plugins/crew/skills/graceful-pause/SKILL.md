---
id: graceful-pause-the-session-side-lookout-protocol
name: graceful-pause
description: Quota-aware graceful pause for long autonomous sessions using the Lookout's signal files -- start/verify the sensor, take the mission lock, read ALERT/PAUSE mechanically, checkpoint at PAUSE, and survive hard token caps via the guard harness. Use at session start of any long-running or orchestrated mission, before every major dispatch/approval, and whenever ALERT/PAUSE handling is needed.
---

# graceful-pause — the session-side Lookout protocol

The Lookout (`packages/scheduler`, bin `lookout`) is a sensor-only poller: it measures
usage and writes signal files; it never controls anything. **You** — the session — read
its signals and act. This skill is the operating procedure, distilled from the overnight
mission that proved every rule in it (suite-design/overnight/LESSONS-LEARNED.md).

## Signals (one canonical path)

State dir: `.ship/lookout/` in the repo (configurable; whatever `lookout status` says).

- `usage.json` — `{ five_hour_pct, seven_day_pct, resets_at, checked_at }`
- `ALERT` / `PAUSE` — marker files; PRESENCE is the signal, they self-clear when usage
  drops back under threshold (defaults: ALERT ≥ 80, PAUSE ≥ 93 five_hour_pct)
- `lookout.log` — one line per poll

Never read any other usage.json copy elsewhere in the repo — a stale duplicate once fed
a session hours-old data. One path, always.

## Session start

1. `lookout init` if the repo has no `.ship/lookout/config.json` yet; note the printed
   session id. The mission MUST run pinned: `claude --session-id <that id>` — this is
   what lets the guard `--resume` you and nobody else after a hard cap.
2. Edit `.ship/lookout/resume-prompt.txt` to your mission (where your tracking files
   live, how to re-orient). The default is generic on purpose.
3. **Take the mission lock:** `lookout lock acquire`. If it refuses ("mission already
   owned"), another session owns this repo — attach read-only or stand down; do NOT
   work around it. Heartbeat with `lookout lock heartbeat` on your alive-touch cadence
   (≤ 25 min; the lock and the guard's idle gate both key off a 30-min silence).
4. Verify the sensor is fresh (`usage.json` `checked_at` within ~2 poll intervals). If
   stale/absent, start it detached: `lookout watch` in the background. Re-verify a
   fresh poll landed before dispatching anything.

## The mechanical rule (non-negotiable)

Decisions key ONLY on signal files present at the moment of dispatch:

- **No ALERT** → dispatch normally, whatever the pct trend looks like.
- **ALERT present** → finish in-flight work; start no new package-level work; cheap
  bookkeeping (status notes, commits, push) is allowed.
- **PAUSE present** → checkpoint (below), then idle until reset.

Never pre-empt a threshold that has not fired. Never extrapolate burn rates into a
self-imposed hold — parallel-agent spikes flatten the moment you go quiet, and being
interrupted by PAUSE is a normal, cheap event (commits are insurance). Idle-by-choice
is the expensive failure; when in doubt, continue and commit more often. Check signals
before every dispatch/approval, at every work-unit boundary, and ~every 15 minutes
during long waits.

## Checkpoint + pause (PAUSE raised)

1. Let in-flight work finish and its commits stand; start nothing new.
2. Write a checkpoint to your tracking file: current position, the exact resume
   instruction (what to dispatch next, which plan, which branch), approvals already
   given. Commit; push if the worktree is yours to push.
3. `lookout lock heartbeat`, then schedule a native wakeup (`ScheduleWakeup`,
   `resets_at` + 5 min, chained hourly if clamped) as BEST EFFORT — and rely on it for
   nothing: **a session-level timer dies with the session at a hard token cap** (a
   mission sat idle an hour learning this). The guard harness is the guarantee.
4. Idle. On wake (either path): re-read the signals, re-read your checkpoint, resume.

## The guard harness (survives what you cannot)

`lookout guard --once` under Task Scheduler/cron (every ~2 min) keeps the sensor alive
and — when tokens are back, the repo is ≥ 30 min quiet, and it has not yet fired this
window — resurrects you headlessly via `claude --resume <pinned id>`. Registration is a
per-machine HUMAN step by design (`lookout guard install --print` prints the exact
commands; never self-install a bypassPermissions loop — ask the human). Your only
obligations to it: commit early and often, keep your tracking file current, and touch
the repo (heartbeat/commit) at least every 25 min while alive so it never mistakes you
for dead.

## Crew interaction

Subagents never watch the Lookout — only the orchestrating session does. Do not add
signal checks to worker dispatches; keep workers committing so a mid-flight PAUSE
loses nothing. On clean mission end: `lookout lock release`.
