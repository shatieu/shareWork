# The Trio — Skill Analytics · Settings Manager · Scheduler (v1 specs)

**Prepared for:** Ondřej · **Date:** 4 July 2026
**Status:** decision-complete. Context: products #4–6 of the suite (see `Product-Suite_Research-Synthesis.md` §6–8). Sequencing decision: **settings manager pulled forward** (its simulator/management screen supports the Ship inbox's "always allow" flow); analytics + scheduler are second wave after Chart Room / Ship / Voice Bridge.

---

## A. Skill Analytics *(standalone in suite — decision)*

**What:** "ccusage for skills" — which skills/agents/commands actually fire, what they cost, which are dead weight.

- **Collection:** parse JSONL transcripts (`~/.claude/projects/`) — the only reliable source (hook payloads don't carry skill names cleanly; API proxies never see OAuth traffic). Incremental parsing with a cursor per file; zero config.
- **Metrics v1:** trigger counts per skill/agent/slash-command, per project + global; **proactive vs explicit-slash ratio** (measures whether skill *descriptions* work); token cost attributed per skill invocation; **dead-skill detection** (installed but silent for N days — feeds the config-matrix later: "these 12 skills are dead weight in project Y"); trends over time.
- **Output:** npx CLI report (ccusage-compatible table/JSON formats) + a JSON endpoint the Ship console renders as a dashboard panel.
- **Watch item:** FR #35319 (native OTel skill events). Architecture split = collector vs analyzer, so native events swap the collector and the analysis layer survives.
- **Out of scope:** generic token/cost dashboards (ccusage/OTel own that ground), team/hosted analytics.

## B. Settings Manager *(pulled forward; full editor v1 — decision)*

**What:** visual manager for Claude Code settings + permissions across all five scopes, with the effective-permission simulator as the centerpiece.

- **Simulator (killer feature):** load managed → CLI → local → project → user scopes, show the merged effective result, and answer *"would `Bash(rm -rf ./dist)` be allowed right now — and which rule in which file decides?"* Deny-beats-specific-allow and array-merge semantics made visible. Doubles as a test bench: type any hypothetical tool call, see the verdict + deciding rule.
- **Full editor (decision — with non-negotiable rails):** freeform rule/settings editing across scopes. Rails: **atomic writes** (temp file + rename), **timestamped backups** of every touched file (`~/.suite/settings-backups/`, one-click restore), **schema validation against the installed CC version before any write** (live-generated, not the chronically stale published schema), **diff preview on every apply** — no silent writes, ever. A corrupted settings.json is the one unforgivable bug.
- **Template packs:** curated permission groups ("safe web dev", "read-only audit", "CI headless", the Ship's crew defaults) versioned in the suite's marketplace repo; apply-with-diff to any scope.
- **Ship integration:** inbox-written "always allow" rules appear here labeled with origin + date; revocable in one click.
- **Also:** hooks/MCP-allowlist/sandbox settings visualized (the 2026 permission surface, not just allow/deny arrays).
- **Out of scope v1:** enterprise managed-settings authoring; multi-machine settings sync (the dotfiles problem — separate concern).

## C. Scheduler *(detector + plain queue v1 — decision)*

**What:** prepare tasks in advance, fire them when the limit window resets. Deliberately thin; designed to be demoted gracefully when native auto-resume ships.

> **Product shape (5 July 2026, Ondřej — this supersedes the watchdog-centric framing): the LOOKOUT.**
> Control is inverted: **the session is primary; the Lookout is its instrument.** You launch Claude Code normally and tell it what to do; the session (via a Crew skill) launches the Lookout — a small background process that ONLY measures usage and writes threshold alerts (e.g. 75/90/98%, plus `resets_at`) to signal files under `.ship/lookout/`. It never launches, kills, or resumes anything.
> The session listens (hook surfaces alerts: `PreToolUse` check or Notification) and reacts gracefully: at warn thresholds it prefers finishing over starting; at the pause threshold it completes the current commit-able step, checkpoints (commits + status note), **schedules its own wake via the native `ScheduleWakeup` tool for `resets_at` + margin**, idles, and resumes on wake — one continuous session, no external controller, works identically for interactive and long-running use.
> The watchdog pattern from night one remains only as the **harness fallback** for headless runs where a hard limit can kill the process before a graceful pause (external relaunch + resume-from-tracking-files). Deliverables: `lookout` binary (poller + signal files + optional desktop notification), Crew hook + `graceful-pause` skill, harness script. Same reset-detector library under both.
>
> **Original note (context, watchdog era):** the overnight watchdog (`overnight-watchdog.ps1` + the PAUSE protocol in `OVERNIGHT-KICKOFF-PROMPT.md`) is the working prototype of this product and the pain point is confirmed first-hand. Wanted as a proper suite feature: **quota-aware graceful pause** — at a configurable threshold (~90%) stop *starting* new work, let in-flight work finish and checkpoint, exit cleanly, auto-resume on window refresh. Applies to any long-running/orchestrated session, not just overnight runs. Design ingredients proven by the prototype: usage poller → PAUSE signal file → agent-side "check before every dispatch" contract → supervisor waits for `resets_at` → resume with re-orientation from tracking files. To think through properly later (deferred while tired): where the agent-side contract lives (Crew plugin hook vs skill), PAUSE-checking as a `PreToolUse`/`TaskCreated` hook instead of prompt discipline, multi-session coordination (fleet-wide pause via Bridge), and harvesting "Scheduler learnings" notes from overnight runs. **Mission lock (learned twice on night one, 5 July 2026):** two First Officer sessions ran concurrently twice in one night — once from a Ctrl+C-orphaned watchdog child, once from an interactive session opened beside the watchdog's resume. Both times an agent *detected it forensically* (foreign edits, duplicate processes) and stood down — good behavior, wrong mechanism. The feature needs a deterministic **mission lockfile**: `overnight/LOCK` with PID + session id + heartbeat timestamp; every mission session takes it at start or refuses to run ("mission already owned by PID X, started HH:MM — attach read-only or stand down"); watchdog checks/reaps stale locks (dead PID or heartbeat older than N min) before relaunching. Also fixes the orphan problem: the watchdog should kill its own child's process tree on Ctrl+C (PowerShell `finally` + `Stop-Process -Id $child -Force` / job objects). **Third night-one learning — session pinning:** bare `claude --continue` resumes "most recently touched session in the directory," so an unrelated interactive session became the resume target and mission turns were appended into a foreign transcript (8 fragmented session files in one night). Any supervisor/Lookout harness must mint a session id up front (`--session-id <uuid>`, stored) and always `--resume <that-id>` — never `--continue`. Silver lining confirmed in practice: because continuity lives in git + STATUS.md rather than conversation memory, the work itself never fragmented. **Extra-usage reconciliation:** the feature must support both economies via a switch — *pause mode* (free: stop new work at threshold, wait for reset) and *spend mode* (paid: keep working into Anthropic extra usage). Prototype has the binary switch (`-AllowExtraUsage`); the full feature wants a budget-capped middle mode ("spend up to $X extra, then pause"), per-task-class overrides (cheap tasks may spend, big ones wait for free window), and spend visibility in the console. Open question: extra-usage spend is not readable from the oauth utilization endpoint — needs a cost-tracking source (transcript token counts × API rates, or Anthropic billing API if available).

- **Reset detector (the hard, reusable core — ship as a standalone library):** fuse three signals with caching and cross-checks: statusline JSON stdin quota fields, transcript/CLI limit-message parsing ("resets at …"), and the undocumented oauth usage endpoint (`five_hour`/`seven_day` utilization + `resets_at`, aggressively rate-limited — cache ≥5 min). Every community tool gets this wrong by relying on one brittle signal.
- **Queue:** SQLite; task = title, prompt, repo, priority, size-class. `ship queue add` / MCP tool / console UI. At reset (or on demand): dispatch via `claude agents` so results land in the normal fleet view, changelog, and inbox.
- **Phase 2 (only after real usage):** quota-aware prioritization — cheap tasks now, big ones post-reset, weekly-cap budgeting.
- **Survival plan:** when Anthropic ships native auto-resume, the detector retires and the queue/planner survives as the layer that decides *what* runs, not *when it can*.
- **Out of scope:** cron-style recurring prompts (native Routines/scheduled tasks own that), anything that wraps or babysits live sessions.

## Build order across the trio

1. **Settings manager** (with Ship wave 1): simulator → editor with rails → template packs → inbox integration.
2. **Skill analytics** (second wave): collector + CLI → console panel → dead-skill reports.
3. **Scheduler** (second wave): detector library → queue + dispatch → (later) planner.
