---
name: lookout
description: First Officer usage-guard protocol for long autonomous missions — start/verify the Lookout sensor, read its signals mechanically, checkpoint and schedule wakeups across usage-window resets. Use at mission start, before every package dispatch/approval, and whenever ALERT/PAUSE handling is needed.
---

# Lookout — the FO's usage-guard protocol

The Lookout is a sensor-only PowerShell poller. It never controls processes;
the First Officer reads its signals and acts. This skill is the FO's operating
procedure for it.

## Sensor

- Script: `suite-design/lookout/lookout.ps1` (defaults: poll 300s, ALERT 80,
  PAUSE 93 — thresholds on `five_hour_pct`).
- State (canonical, runtime-only, gitignored): `suite-design/lookout/state/`
  - `usage.json` — `{ five_hour_pct, seven_day_pct, resets_at, checked_at }`
  - `ALERT`, `PAUSE` — marker files, self-clearing when pct drops back under
  - `lookout.log` — one line per poll
- Ignore any other usage.json copies elsewhere in the repo — stale duplicates
  have burned a session before (see LESSONS-LEARNED.md).

## Session start

1. Verify freshness: `usage.json` `checked_at` within ~2 poll intervals of now.
2. If stale/absent, start the sensor in the background:
   `powershell -ExecutionPolicy Bypass -File suite-design/lookout/lookout.ps1`
   (run detached / as a background task; it loops forever). Re-verify a fresh
   poll landed before dispatching anything.
3. Verify the working branch contains the Lookout + mission files.

## The mechanical dispatch rule (non-negotiable)

Decisions key ONLY on signal files present at the moment of dispatch:

- **No ALERT file** → dispatch normally, whatever the pct trend looks like.
- **ALERT present** → finish in-flight work; start no new package-level
  dispatches; cheap bookkeeping (STATUS, progress, push) is allowed.
- **PAUSE present** → checkpoint (below), then idle until reset.

Never pre-empt a threshold that has not fired. Never extrapolate burn rates
into a hold — parallel-agent spikes flatten the moment you go quiet, and a
package interrupted by PAUSE is a normal, cheap event (commits are insurance;
checkpoint and resume). Self-imposed idle is the expensive failure. When in
doubt between continuing and idling: continue, commit more often.

Check signals: before every approval/dispatch, at every package boundary, and
roughly every 15 minutes during long waits.

## Checkpoint + pause procedure (PAUSE raised)

1. Let in-flight workers' commits stand; do not start new work.
2. Append a checkpoint to `suite-design/overnight/STATUS.md`: current package,
   exact resume instruction (what to dispatch, which plan, which branch,
   approvals already given), and push the integration branch if no worker
   holds the worktree.
3. `ScheduleWakeup` — target `resets_at` + 5 min. The tool clamps to 3600s
   max, so chain hourly wakeups: each wake re-checks signals; if still
   pre-reset, schedule again with the same prompt; if reset, resume the queue
   from the STATUS.md checkpoint.
4. The wakeup prompt must be self-contained: point to STATUS.md, the signal
   paths, and the resume dispatch.

## Interaction with the crew

Crew agents never watch the Lookout — only the FO does. Do not add signal
checks to worker dispatches; instead keep workers committing early and often
so a mid-flight PAUSE loses nothing.
