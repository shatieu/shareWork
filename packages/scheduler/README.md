---
id: scheduler-the-lookout
---

# scheduler — the Lookout

Quota-aware graceful pause for long-running Claude Code sessions (Trio_Specs §C), the
productized form of the prototype that ran the 2026-07-05/06 overnight mission
(`suite-design/lookout/lookout.ps1` + `guard.ps1`). Control is inverted: **the session is
primary; the Lookout is its instrument.** The sensor only measures and writes signal
files; the session reads them and pauses gracefully; the guard is the session-independent
fallback for hard token caps. Policy lives in `packages/reset-detector`; this package is
the `lookout` bin plus file/spawn plumbing.

## The loop, end to end

1. **Init (once per repo):**

   ```
   lookout init
   ```

   Mints a pinned session uuid, writes `.ship/lookout/config.json` and a default
   `resume-prompt.txt` (edit it for your mission), and prints the launch command.

2. **Launch the mission pinned to that id — never bare `claude`:**

   ```
   claude --session-id <uuid-from-init>
   ```

   Why: bare `claude --continue` resumes "most recently touched session in the
   directory". On 2026-07-05 that appended mission turns into a foreign transcript
   (8 fragmented session files in one night). The guard resurrects ONLY via
   `--resume <pinned id>` and refuses if no id is configured.

3. **Take the mission lock at session start** (agent-side, see the `graceful-pause`
   skill): `lookout lock acquire`. Two supervisor sessions ran concurrently twice in one
   night before this existed; the lock makes "attach read-only or stand down"
   deterministic instead of forensic. CLI-acquired locks are heartbeat-governed (each
   `lookout` call is its own short-lived process, so a recorded CLI pid would be
   meaningless): run `lookout lock heartbeat` on your alive-touch cadence (≤ 25 min;
   stale after 30) and `lookout lock release` on clean exit — release marks the file
   `released`, never deletes it. Library callers with a long-lived process get pid-fast
   reaping on top (dead pid = stale immediately). Stale and released locks are reaped by
   the next acquire.

4. **Start the sensor** (any of: the session itself, the guard's auto-relaunch, or you):

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

5. **The session reacts gracefully** (the `graceful-pause` skill in the Crew plugin):
   at ALERT prefer finishing over starting; at PAUSE checkpoint (commit + status note),
   schedule a native wakeup as best effort, and idle. Signal checks are cheap file
   existence tests — an optional `PreToolUse` hook can surface them automatically:

   ```json
   { "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command",
     "command": "node -e \"const fs=require('fs');if(fs.existsSync('.ship/lookout/PAUSE'))console.log(JSON.stringify({systemMessage:'Lookout PAUSE is raised: checkpoint and idle until reset.'}))\"" }] }] } }
   ```

6. **The guard guarantees the wake-after-reset** — because `ScheduleWakeup` dies with
   the session at a hard token cap (the mission sat idle ~1 h on 2026-07-05 until this
   existed). An external scheduler runs:

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
   keyed on `resets_at` rounded to the minute (the endpoint jitters sub-seconds between
   polls; exact-string dedup fired 5 resurrections in one window on 2026-07-06) and is
   written BEFORE the spawn (a crash in between loses one resurrection; the reverse order
   can fork two supervisors into one repo).

## Per-machine registration (the human step — deliberately not automated)

```
lookout guard install --print
```

prints the exact `schtasks` (Windows, per-user, no admin) and cron lines for THIS
machine's node and paths. It never executes them: a resurrection loop that runs
`--permission-mode bypassPermissions` must be installed by a human, on purpose (the
permission classifier correctly blocks an agent self-installing one — LESSONS-LEARNED
2026-07-05). Decommission: delete the task/cron line, stop the sensor process, and note
the task outlives what it spawned — a still-running resurrected session keeps running
until you stop it. Stale `ALERT`/`PAUSE`/`resurrected-*` files are inert.

Add `.ship/` to the repo's `.gitignore` — everything under the state dir is runtime-only.

## Commands

| Command | What |
| --- | --- |
| `lookout init` | mint pinned session id, write config + resume prompt, print launch line |
| `lookout once` / `lookout watch` | one sensor poll / the sensor loop (signal-only, controls nothing) |
| `lookout guard --once` | one guard tick (what the scheduler runs) |
| `lookout guard install --print` | print registration commands, never executes |
| `lookout lock acquire\|status\|heartbeat\|release` | mission lockfile (refuses live, reaps stale, release ≠ delete) |
| `lookout status` | signals + config + lock, as JSON |

## What v1 deliberately is not

No task queue/dispatch yet (next slice per the spec's build order: detector → queue →
planner), no budget-capped spend mode (binary pause/spend only), no desktop
notifications, and never anything that wraps or babysits live sessions. When native
auto-resume ships, the detector retires and the queue layer survives (spec's survival
plan).
