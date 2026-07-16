---
id: scheduler-the-lookout
---

# scheduler — the Lookout

Quota-aware graceful pause for long-running Claude Code sessions (Trio_Specs §C), the
productized form of the prototype that ran the 2026-07-05/06 overnight mission
(`suite-design/lookout/lookout.ps1` + `guard.ps1`). Control is inverted: **the session is
primary; the Lookout is its instrument.** The sensor only measures and writes signal
files; the session reads them and pauses gracefully; the **waiter** (`lookout wait`) is a
background task the session itself spawns, whose exit output nudges that same session
when the usage window has renewed and it took no action. Policy lives in
`packages/reset-detector`; this package is the `lookout` bin plus file/spawn plumbing.

## The loop, end to end

1. **Init (once per repo):**

   ```
   lookout init
   ```

   Mints a pinned session uuid, writes `.ship/lookout/config.json` and a default
   `resume-prompt.txt` (edit it for your mission — the waiter appends it verbatim to its
   continue nudge), and prints the launch command.

2. **Launch the mission pinned to that id — never bare `claude`:**

   ```
   claude --session-id <uuid-from-init>
   ```

   Why: bare `claude --continue` resumes "most recently touched session in the
   directory". On 2026-07-05 that appended mission turns into a foreign transcript
   (8 fragmented session files in one night). The pinned id keys the mission lock, and
   the optional guard fallback resurrects ONLY via `--resume <pinned id>`.

3. **Take the mission lock at session start** (agent-side, see the `graceful-pause`
   skill): `lookout lock acquire`. Two supervisor sessions ran concurrently twice in one
   night before this existed; the lock makes "attach read-only or stand down"
   deterministic instead of forensic. CLI-acquired locks are heartbeat-governed (each
   `lookout` call is its own short-lived process, so a recorded CLI pid would be
   meaningless): run `lookout lock heartbeat` on your alive-touch cadence (≤ 25 min;
   stale after 30) and `lookout lock release` on clean exit — release marks the file
   `released`, never deletes it. Library callers with a long-lived process get pid-fast
   reaping on top (dead pid = stale immediately). Stale and released locks are reaped by
   the next acquire. The waiter reads the lock's heartbeat as a session-activity signal.

4. **Spawn the waiter — this is the primary flow.** At session start, the session runs
   `lookout wait` as a background task (in Claude Code: a `Bash` call with
   `run_in_background: true`). No Task Scheduler, no cron, no second `claude` process,
   nothing per-machine:

   ```
   lookout wait [--grace-minutes 10] [--fresh-below-pct 20] [--max-hours 24]
   ```

   The waiter polls every `pollSeconds` (default 300 s) and:

   - **keeps the sensor honest** — if `usage.json` is missing or stale (≥ 12 min) it
     runs a sensor tick itself, so there is always one canonical fresh signal path;
   - **arms** on the current usage window (`resets_at` rounded to the minute — the
     endpoint jitters sub-seconds between polls, so window identity is never string
     equality);
   - **detects the renewal** — the window key changed, or (secondary signal) the pct
     collapsed below `--fresh-below-pct` on an unchanged key after the armed window was
     seen burning ≥ 80 % (the floor stops a false fire when the waiter arms inside an
     already-fresh window);
   - **waits out the grace period** (default 10 min, polling tightened to 60 s): if
     session activity appears — a git commit, an `activityDirs` mtime, or a LOCK
     heartbeat — the session woke itself (e.g. its own `ScheduleWakeup` survived), and
     the waiter **re-arms silently** on the new window instead of double-nudging;
   - **fires**: no activity through the grace period → it prints the continue nudge and
     exits 0. The harness delivers that exit output to the session that spawned it —
     the message IS the wake-up:

     ```
     LOOKOUT CONTINUE — usage window renewed (five_hour 2%, was window 20260709-1000, now 20260709-1500); no session activity for 10 min since renewal.
     Re-read the signal files under .ship/lookout and your mission checkpoint, then resume the queue.
     <your resume-prompt.txt, verbatim>
     ```

   Safety: a `WAITER` pid file makes the waiter single-instance (a second `lookout wait`
   on the same state dir refuses at startup — the only non-zero exit); `--max-hours`
   (default 24) makes it expire loudly with a "respawn me" message rather than being
   trusted to be immortal; every arm/renewal/re-arm/continue is logged to `wait.log`;
   errors never break the loop and never shorten the poll interval. Respawn the waiter
   whenever you handle a PAUSE — a fresh one costs nothing and refuses if one is alive.

5. **Start the sensor** (optional when the waiter runs — it self-senses; still useful
   for dashboards and the PreToolUse hook):

   ```
   lookout watch
   ```

   Polls the undocumented oauth usage endpoint every 300 s (= the cache floor; it is
   aggressively rate-limited — on failure it keeps the last signal files untouched and
   sleeps the full interval) and writes to `.ship/lookout/`:

   - `usage.json` — `{ five_hour_pct, seven_day_pct, resets_at, checked_at }`
   - `ALERT` (default ≥ 80) / `PAUSE` (default ≥ 93) — presence-is-signal markers,
     self-clearing when the pct drops back under (proven live: the prototype raised and
     cleared PAUSE on real usage with ~2 s latency)
   - `lookout.log` — one line per poll

   **This is the one canonical signal path.** Stale duplicate copies elsewhere burned a
   session once; point everything at the same state dir. `mode: "spend"` in config.json
   (or `lookout init --mode spend`) suppresses PAUSE for the paid extra-usage economy;
   ALERT still fires.

6. **The session reacts gracefully** (the `graceful-pause` skill in the Crew plugin):
   at ALERT prefer finishing over starting; at PAUSE checkpoint (commit + status note),
   confirm the waiter is alive (respawn `lookout wait` if not), and idle — the waiter's
   exit output brings you back. Signal checks are cheap file existence tests — an
   optional `PreToolUse` hook can surface them automatically:

   ```json
   { "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command",
     "command": "node -e \"const fs=require('fs');if(fs.existsSync('.ship/lookout/PAUSE'))console.log(JSON.stringify({systemMessage:'Lookout PAUSE is raised: checkpoint and idle until reset.'}))\"" }] }] } }
   ```

## Optional deep fallback (survives terminal death)

The waiter lives and dies with the terminal that spawned it. If you need a wake-up
guarantee that survives the whole terminal being closed, the guard still exists: an
external scheduler runs

```
lookout guard --once
```

every ~2 minutes. Each tick: relaunch the sensor if `usage.json` is stale (≥ 12 min);
then, only when tokens are clearly back (`five_hour_pct < 20`) AND the repo has been
idle ≥ 30 min (newest of last git commit / configured `activityDirs` mtimes — the
30-min threshold pairs with the session's ≤ 25-min alive-touch heartbeat, so a living
session can never look dead), resurrect headlessly:

```
claude --resume <pinned-id> -p <resume-prompt> --permission-mode bypassPermissions
```

with `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` (print mode otherwise kills
still-running background workers ~600 s after the turn's final text — observed killing
a developer agent mid-build), **at most once per usage window**: the dedup marker is
keyed on `resets_at` rounded to the minute and written BEFORE the spawn (a crash in
between loses one resurrection; the reverse order can fork two supervisors into one
repo).

Know the cost before opting in: the guard needs per-machine registration (a human
step, deliberately — a loop running `bypassPermissions` must be installed on purpose;
the permission classifier correctly blocks an agent self-installing one), and it
resurrects via a NEW headless claude process instead of talking to the session that is
already open. That trade-off is exactly why the waiter is now the default.
`lookout guard install --print` prints the exact `schtasks` (Windows, per-user, no
admin) and cron lines for this machine's node and paths — it never executes them.
Decommission: delete the task/cron line, stop the sensor process, and note the task
outlives what it spawned. Stale `ALERT`/`PAUSE`/`resurrected-*` files are inert.

Add `.ship/` to the repo's `.gitignore` — everything under the state dir is runtime-only.

## Commands

| Command | What |
| --- | --- |
| `lookout init` | mint pinned session id, write config + resume prompt, print launch line |
| `lookout wait` | the waiter: background task whose exit output is the continue nudge (single-instance, self-sensing, `--max-hours` expiry) |
| `lookout once` / `lookout watch` | one sensor poll / the sensor loop (signal-only, controls nothing) |
| `lookout guard --once` | one guard tick (optional deep fallback; needs per-machine registration) |
| `lookout guard install --print` | print registration commands, never executes |
| `lookout lock acquire\|status\|heartbeat\|release` | mission lockfile (refuses live, reaps stale, release ≠ delete) |
| `lookout status` | signals + config + lock, as JSON |

## What v2 deliberately is not

No task queue/dispatch yet (next slice per the spec's build order: detector → queue →
planner), no budget-capped spend mode (binary pause/spend only), no desktop
notifications, and never anything that wraps or babysits live sessions. When native
auto-resume ships, the detector retires and the queue layer survives (spec's survival
plan).
