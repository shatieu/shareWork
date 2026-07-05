# Lookout Build & Real-World Test — scoped prompt

*Launch: ONE terminal at the shareWork root, `claude --permission-mode bypassPermissions`, paste everything below the line. This session builds and proves the Lookout — NOTHING else. The mission kickoff comes afterwards as a separate prompt.*

---

Your entire scope tonight: build the **Lookout** — a standalone usage sensor — and prove it works **against real data, with the Captain participating**. You will not touch, resume, or reason about any other mission work in this repo. When the test passes, you stop and wait.

## 1. What the Lookout is

A standalone PowerShell script, sensor-only: it measures Claude usage and writes signal files. It never launches, kills, resumes, or controls anything. Build spec:

- **File:** `suite-design/lookout/lookout.ps1`. PowerShell 5.1-compatible, **ASCII characters only** (a previous script shipped with UTF-8 mojibake — avoid).
- **Parameters:** `-PollSeconds` (default 300), `-AlertAt` (default 80), `-PauseAt` (default 93), `-StateDir` (default `suite-design/lookout/state`).
- **Loop:** read the OAuth token from `%USERPROFILE%\.claude\.credentials.json` (`claudeAiOauth.accessToken`); GET `https://api.anthropic.com/api/oauth/usage` with header `anthropic-beta: oauth-2025-04-20`. On success write `state/usage.json`: `{ five_hour_pct, seven_day_pct, resets_at, checked_at }`. On failure (429/network): keep last state, log, never hammer — this endpoint is undocumented and rate-limited, so respect the poll interval strictly.
- **Signals (owned by the Lookout, you never delete them):** create `state/ALERT` when `five_hour_pct >= AlertAt`; create `state/PAUSE` when `>= PauseAt` (each containing the current usage JSON); **remove** them when usage drops back below the threshold (window reset).
- **Log:** append one line per poll to `state/lookout.log` (`timestamp pct resets_at [ALERT|PAUSE|ok|error <reason>]`).
- `state/` is runtime data: add it to `.gitignore`. The script itself is committed on a feature branch (`ship-wave1-lookout`) with a short plan note and a self-review before you commit — but keep ceremony light; this is a ~100-line script, correctness of the polling and threshold/removal logic is what matters. **No deletions anywhere in the repo, no touching other files beyond the .gitignore append.**

## 2. The REAL test — no mocks, no synthetic signals, the Captain is the load generator

There is no drill mode. Every step below runs on live data. Narrate each step clearly in the console so the Captain can follow.

1. **Baseline.** Start the Lookout (`Start-Process ... -WindowStyle Hidden`) with default thresholds and `-PollSeconds 60` for the test. Within ~2 minutes verify `usage.json` exists and contains plausible live data. Report to the Captain: *"Lookout on station. Current 5-hour usage: X%, resets at HH:MM."* If the endpoint is unreachable or returns garbage, STOP and troubleshoot with the Captain — no working sensor, no test, no autonomous night.
2. **Arm the real trigger.** Stop the Lookout and restart it with `-PauseAt` set to **baseline + 1** (e.g. baseline 34% → `-PauseAt 35`), still `-PollSeconds 60`. This means the REAL threshold logic will fire from REAL usage growth — the exact code path the mission will rely on.
3. **Hand over to the Captain:** *"Trigger armed at X+1%. Go use Claude somewhere else — claude.ai or Claude Code in a DIFFERENT directory (never this repo) — and the shared 5-hour window will climb. I'm now pausing and watching."*
4. **Pause and watch — your own real waiting loop.** Enter your pause-wait behavior: check `state/` roughly every minute (short Bash sleeps; if the native `ScheduleWakeup` tool is available, use it for the waits so it gets exercised too). Do no other work while waiting — this waiting IS the test of your pause behavior.
5. **Trigger.** When the Captain's activity pushes usage past the threshold, the Lookout must create `state/PAUSE` on its own. The moment you detect it, announce loudly: *"TEST TRIGGERED — PAUSE received at Y% (baseline X%, threshold X+1%). Trigger latency: [time between usage.json crossing and your detection]."* Log the evidence (the usage.json content and lookout.log tail).
6. **Demonstrate the recovery arithmetic.** Compute and report the wake time you WOULD schedule in a real pause (`resets_at` + 5 min) and state plainly: *"In mission mode I would checkpoint, schedule wake for HH:MM, and idle. The wake-check loop is the same one you just watched in step 4 — only the wait is longer."* (An actual wait-for-reset can't be compressed into tonight; say so honestly rather than faking it.)
7. **Stand down to real thresholds.** Restart the Lookout with defaults (`-AlertAt 80 -PauseAt 93 -PollSeconds 300`). Confirm `PAUSE` gets removed by the Lookout itself once thresholds no longer apply (this verifies the removal path with real data too).
8. **Ask the Captain for his verdict.** PASS requires: he personally saw the trigger fire from his own usage, the latency was acceptable, and signals were created AND cleaned by the Lookout alone. If he says PASS: commit, merge `ship-wave1-lookout` → `ship-wave1`, write a changelog fragment, and report **"Lookout proven on real data — standing by for mission kickoff."** Then stop. Do not start, resume, or plan any mission work — the mission kickoff (including the honest history of the previous run) arrives as a separate prompt.

If anything fails at any step: stop, show the evidence, fix it with the Captain, re-run the failed step. No proceeding past a failed step, no simulated substitutes.
