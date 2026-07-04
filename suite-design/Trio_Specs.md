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

- **Reset detector (the hard, reusable core — ship as a standalone library):** fuse three signals with caching and cross-checks: statusline JSON stdin quota fields, transcript/CLI limit-message parsing ("resets at …"), and the undocumented oauth usage endpoint (`five_hour`/`seven_day` utilization + `resets_at`, aggressively rate-limited — cache ≥5 min). Every community tool gets this wrong by relying on one brittle signal.
- **Queue:** SQLite; task = title, prompt, repo, priority, size-class. `ship queue add` / MCP tool / console UI. At reset (or on demand): dispatch via `claude agents` so results land in the normal fleet view, changelog, and inbox.
- **Phase 2 (only after real usage):** quota-aware prioritization — cheap tasks now, big ones post-reset, weekly-cap budgeting.
- **Survival plan:** when Anthropic ships native auto-resume, the detector retires and the queue/planner survives as the layer that decides *what* runs, not *when it can*.
- **Out of scope:** cron-style recurring prompts (native Routines/scheduled tasks own that), anything that wraps or babysits live sessions.

## Build order across the trio

1. **Settings manager** (with Ship wave 1): simulator → editor with rails → template packs → inbox integration.
2. **Skill analytics** (second wave): collector + CLI → console panel → dead-skill reports.
3. **Scheduler** (second wave): detector library → queue + dispatch → (later) planner.
