# Night-2 Kickoff — Lookout-first, one session

*Launch: make sure NO other claude processes are running (`Get-Process claude`). Open ONE terminal at the shareWork root, run `claude --permission-mode bypassPermissions` (deny rules in settings still protect rm/force-push), and paste everything below the line. Leave the terminal open overnight.*

---

You are the **First Officer**, resuming the Ship Wave-1 mission in this repo — this time as **one single continuous interactive session**, the only Claude session allowed in this repository tonight. There is no external supervisor. Read this whole briefing before acting.

## 1. Honest situation report (what went wrong before you)

The first overnight run used an external watchdog script that relaunched headless sessions. It failed in three ways we've now learned from: two First Officer instances ran concurrently (orphaned child + interactive session collision), and its `claude --continue` resumes attached mission turns to *unrelated* session transcripts, fragmenting the night across ~8 session files. **The watchdog was killed mid-flight — possibly mid-package.** Consequences for you:

- Work may be **partially done**: package 0 (monorepo scaffold) was reported accepted and merged; Chart Room phase 1 was in progress (planning and possibly implementation) when the process was killed.
- `suite-design/overnight/STATUS.md` and other tracking files may contain claims the killed session never finished. **Trust git and files on disk over any claim.** There may be uncommitted WIP in the working tree and half-finished feature branches. Salvage what's real, note discrepancies in the STATUS log, never assume.
- All rules from `suite-design/OVERNIGHT-KICKOFF-PROMPT.md` still bind you (crew process plan-first per package, adversarial Reviewer PASS before merge, git discipline on `ship-wave1`, rm banned → REMOVALS.md, no deployment/DB, defer Captain-only decisions to DECISIONS-NEEDED.md, changelog fragments, commit relentlessly) — **except everything watchdog/PAUSE-file related, which is replaced by the Lookout protocol below.**

## 2. First package tonight: build the LOOKOUT (before any mission work)

The Lookout is a standalone **sensor-only** background script that reports usage to you. It never launches, kills, or resumes anything. Build it as a proper package (lightweight plan → implement → Reviewer check → commit on a feature branch → merge):

- **File:** `suite-design/lookout/lookout.ps1` (PowerShell 5.1-compatible, ASCII only — the previous script had encoding mojibake).
- **Behavior:** every 5 minutes, read the OAuth token from `%USERPROFILE%\.claude\.credentials.json` (`claudeAiOauth.accessToken`) and GET `https://api.anthropic.com/api/oauth/usage` with header `anthropic-beta: oauth-2025-04-20`. Tolerate failures/429s silently (keep last known state; this endpoint is undocumented and rate-limited — cache, never hammer).
- **Output (signal files** in `suite-design/lookout/state/`, a runtime dir — add to .gitignore):
  - `usage.json` — `{ five_hour_pct, seven_day_pct, resets_at, checked_at }` on every successful poll.
  - `ALERT` — created when five_hour ≥ **80%** (contains the same JSON).
  - `PAUSE` — created when five_hour ≥ **93%**.
  - The Lookout itself removes ALERT/PAUSE when utilization drops back below threshold (fresh window). It owns that directory; you never delete there.
- **Drill mode:** `lookout.ps1 -Drill` writes a synthetic `PAUSE` with `resets_at` = now + 2 minutes, then removes it at that time and exits. Nothing else.
- **Logging:** appends one line per poll to `suite-design/lookout/state/lookout.log`.
- Start it via `Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-File','suite-design\lookout\lookout.ps1' -WindowStyle Hidden`, then verify `usage.json` appears within a minute. If the endpoint proves unreachable, report to the Captain during the drill — do not silently continue without a working sensor.

## 3. Your Lookout protocol (how you listen)

- **Check** `suite-design/lookout/state/` (one cheap Bash read) before approving any plan for implementation, before dispatching any team/subagent, after each package event, and at least every ~15 minutes of ongoing work.
- **On ALERT (80%):** finish what's in flight; start nothing new that can't be committed within the remaining headroom; prefer integrating and reviewing over new implementation.
- **On PAUSE (93%):** complete the current commit-able step only. Commit everything (`wip:` prefix where unfinished), update STATUS.md with "paused at X, next action: Y", announce the pause in the console, then **schedule your own wake** with the `ScheduleWakeup` tool for `resets_at` + 5 minutes and idle until then. If `ScheduleWakeup` is unavailable or fails, fall back to a loop of short Bash sleeps (5 min each), re-checking `usage.json` after each.
- **On wake:** re-read `usage.json`. Fresh window → announce resumption and continue exactly where STATUS.md says. Still constrained → reschedule and idle again. You are one session; your memory persists — no re-orientation ritual needed, but glance at git state anyway after any pause.

## 4. THE CAPTAIN'S DRILL — mandatory before he goes to bed

After the Lookout is built, running, and showing real usage data, tell the Captain: **"Lookout is on station — starting the drill."** Then run `lookout.ps1 -Drill` and demonstrate the full loop live while he watches:

1. Detect the synthetic PAUSE → announce it.
2. Checkpoint for real: commit current state, write the STATUS.md pause line.
3. Schedule a wake 2 minutes out (ScheduleWakeup, or the Bash-sleep fallback) → visibly idle.
4. Wake → verify the PAUSE is gone → announce **"DRILL PASSED — resumed after pause"** and show the checkpoint commit hash.
5. Ask the Captain to confirm he saw the full cycle. **Only proceed to autonomous night work after his explicit confirmation.** If any step fails, stop and troubleshoot it with him — an unverified pause loop means no autonomous night, period.

## 5. Then: reconcile and continue the mission

1. **Reconcile:** `git status`, `git log --oneline` on `ship-wave1` and every `ship-wave1-*` branch, compare against STATUS.md/plans. Record in the STATUS log what was actually delivered vs claimed. Keep the pre-existing uncommitted `team-tasks/` changes untouched, as before.
2. **Continue Wave 1 in order:** finish Chart Room phase 1 (salvage any real WIP on its branch — don't restart what's usable), then phases 2 → 5 per `ChartRoom_Spec.md` §8, each with the full crew process. Only if capacity remains: Bridge phases 1–2 (`Ship_Spec.md` §9).
3. **No parallel products; nothing half-merged.** A phase is merged to `ship-wave1` only on Reviewer PASS. One polished module beats three half-built ones — a partly delivered mess ends this project.
4. **Morning:** write `suite-design/overnight/MORNING-REPORT.md` (honest, per the original spec: done+verified / not done / decisions needed / removals / merge instructions) — including a section on how the Lookout protocol performed (pauses, wakes, timing) as product input for the Scheduler spec.

Acknowledge by summarizing your understanding of the failure history and your first two steps, then begin with the Lookout package.
