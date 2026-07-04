# The Bridge — Design Spec (v1)

> **Naming update (later same day):** the suite itself is now **The Ship**; this product (fleet glue + console) is **the Bridge**. Service names `ship-*` in this doc are kept — they read as "the Ship's ledger" etc. See `Suite-Architecture_and_Website_Spec.md` for the canonical naming table.

**Prepared for:** Ondřej · **Date:** 4 July 2026
**Status:** decision-complete for v1, ready to implement.
**Context:** product #2 of the suite (see `Product-Suite_Research-Synthesis.md` §1). Companion specs: `ChartRoom_Spec.md`. The Ship is the fleet glue for Claude Code — it observes and unblocks sessions; it never hosts them.

---

## 1. What it is

Four small services + one Claude Code plugin that together give you: a persistent cross-project **ledger** (synced across your computers via Team Tasks), an automatic conflict-free **changelog**, one **human-action inbox** to unblock everything from one page, a thin fleet **console**, and — via the plugin — the **Crew**: out-of-the-box subagentic behavior with per-project scrutiny presets, so you never repeat setup instructions.

## 2. Architecture principles

- **Observe, don't host.** Sessions are hosted by Claude Code's native supervisor (`claude agents`). The Ship reads `claude agents --json`, `~/.claude/jobs/`, `~/.claude/tasks/`, and JSONL transcripts (`~/.claude/projects/`), and receives events via **http hooks** installed by the plugin (`PermissionRequest`, `Notification`, `Stop`, `SessionStart/End`, `TaskCreated/TaskCompleted`).
- **Separate processes** (decision): each module is a standalone service with its own port and storage. Integration = HTTP/MCP contracts only. Shared conventions live in one tiny package: `~/.suite/services.json` port registry + common event shapes. The Ship's inbox *pulls* Chart Room's questions via Chart Room's API; Chart Room knows nothing about the Ship.
- **Native primitives over custom engines.** Approval memory = native permission rules. Crew = native subagents + agent teams. Profiles = native settings. If Anthropic ships a native equivalent of a module, that module gets deleted, not defended.

## 3. Ledger (service: `ship-ledger`)

- SQLite (WAL) in `~/.ship/ledger.db`, exposed as an **MCP server** (agents read/write) + HTTP API (UI, other services).
- Item: `id, title, spec_md, project, status, priority, source (human|agent|native-mirror), session_refs[], created_at, updated_at`.
- Native Agent Teams task files (`~/.claude/tasks/`) are **mirrored in** via `TaskCreated/TaskCompleted` hooks — never written back.
- **Schema deliberately aligned with Team Tasks' `tasks` table.** Two consequences:
  - **Cross-computer sync (core requirement):** "promote" pushes an item to your *personal team* on the hosted Team Tasks; the Ship on another machine pulls it. Team Tasks is the cloud spine of the suite — solo sync now, team handoff later, same tables.
  - **Promote to team:** the same action targeting a real team board hands the item to teammates (full Team Tasks flow: claim → work → review).
- Ledger keeping is **automatic out of the box** (see §7): items and status changes flow from hooks without any agent effort or human discipline.

## 4. Changelog (service: `ship-log`)

- **Capture (automatic):** on `Stop`/`SessionEnd` hooks — session id, project, git delta (branch, commits, files touched), plus a Haiku-summarized "what happened" from the transcript tail. Cost: cents/day.
- **Storage — both forms (decision):**
  - SQLite in `~/.ship/log.db` = truth, powers the cross-project rollup.
  - **In-repo fragment files** = the shareable form: `changelog/entries/<date>--<slug>--<session>.md`. **One file per entry, only ever created, never edited → merge conflicts structurally impossible** (towncrier/changesets pattern — this replaces the append-one-doc approach that keeps causing conflicts today). Chart Room renders the directory as one timeline; `ship log build` compiles a committed CHANGELOG.md on demand (e.g. at release).
- **Rollup:** daily digest = one Haiku call over the day's entries across all projects — "what did all sessions across all repos do today." Served in the console + available as an MCP tool (the Quartermaster's primary food).

## 5. Human-action inbox (service: `ship-inbox`)

One page aggregating everything that needs a human, across all projects:
- **Permission requests** — `PermissionRequest` http hooks → queue → approve/deny from the page; the hook's JSON response resolves the prompt inside the session. Works against vanilla sessions, no wrapper CLI.
- **Agent questions** — `Notification: agent_needs_input` events + unanswered `ask-me` blocks pulled from Chart Room's API.
- **Human-action items** — open `:::actions` blocks (via Chart Room).
- **"Always allow" (decision):** writes a **native permission rule** into that project's `.claude/settings.local.json`. Per-project by construction, enforced by Claude Code itself, Ship stores nothing, visible later in the settings manager. No custom rule engine.
- Phone access v1 = this same page over Tailscale. The voice bridge (product #3) later drives this same queue — built once.

## 6. Console (service: `ship-console`)

Thin fleet view: sessions from `claude agents --json` (state, `waitingFor`, Anthropic's own Haiku row summaries), ledger sidebar, inbox badge, daily rollup, dispatch box (shells out to `claude agents`). **Most sherlockable module — kept deliberately thin**; if Anthropic ships a GUI Agent View, delete this and keep §3–5. Config-matrix UI (plugins × projects, toggle/sync) lands here in a later phase.

## 7. The Crew (Claude Code plugin: `ship-crew`)

Installing the plugin is joining the Ship: it carries the subagents, skills, http hooks (§2), and settings defaults. Metaphor: **Captain** = you. **First Officer** = the session you talk to. **Crew** = the FO's agents.

**Roles (subagent definitions):**
- **First Officer** — orchestrator, the only one you address; runs as the session's main agent (`--agent first-officer` / `agent` setting). Assembles the crew per the project's scrutiny preset, delegates, integrates, reports.
- **Navigator** — research & context gathering.
- **Shipwright** — implementation.
- **Inspector** — review, tests, lint gates.
- **Devil's Advocate** — critical opponent; argues against the plan before implementation.
- **Quartermaster** — **not a bookkeeper** (bookkeeping is automatic, §3–4). The long-term memory: reads the ledger + changelog + rollups (via MCP), keeps long-horizon tasks in mind, tracks overall progress, answers the Captain ("where are we with the auth rework?"), flags drift ("in_progress for 9 days", "this contradicts what we shipped Tuesday"), and can propose or drive next development. Invocable ad hoc from any session or the console.

**Scrutiny presets** — one word per project in `.claude/settings.json` → `"ship": { "scrutiny": "standard" }`, read by the FO at `SessionStart`. Say "help with X" anywhere and the right crew assembles silently; override per session verbally ("go rigorous on this one").

| Preset | Crew & gates |
|---|---|
| `solo` | FO works directly. Ledger/changelog still automatic (non-optional floor). |
| `standard` | Navigator → Shipwright → Inspector pipeline. No plan gate (decision: trust the crew; that's what the Inspector is for). |
| `rigorous` | + Devil's Advocate before implementation + **plan-approval gate** (Captain approves plan before code). |
| `paranoid` | rigorous + Inspector pass required before FO may report done — enforced by a `Stop` hook (`decision: block`), not politeness. |

Custom presets = named role-lists + gate flags in plugin config.

## 8. Stack

Node 20+ / TypeScript. Fastify per service. better-sqlite3 (WAL). `@modelcontextprotocol/sdk`. React + Vite (console + inbox UIs; ledger/log are headless + rendered in console). Haiku via Agent SDK for summaries. No Redis, no external DB. `npx ship up` starts all services (each also runs standalone: `npx ship-inbox` etc.). Plugin distributed via the suite's git marketplace repo.

## 9. Build order (phases, each shippable)

1. **Plugin skeleton + hooks + changelog capture.** ship-crew plugin installing http hooks; ship-log capturing Stop/SessionEnd → SQLite + fragment files. Acceptance: two sessions in different repos produce fragments + a daily rollup.
2. **Ledger + MCP + native mirror.** ship-ledger service, MCP tools, TaskCreated/TaskCompleted mirroring. Acceptance: an agent creates/updates ledger items via MCP; native team tasks appear as mirrored items.
3. **Inbox.** PermissionRequest queue + approve/deny + "always allow"→settings.local.json; agent questions; Chart Room pull. Acceptance: a vanilla session's permission prompt is answered from the browser; "always allow" writes a native rule that suppresses the next prompt.
4. **Crew.** Subagent definitions, FO orchestration skill, scrutiny presets + SessionStart wiring, plan gate (rigorous), Stop-hook enforcement (paranoid), Quartermaster with ledger/log MCP access. Acceptance: fresh project + plugin + one settings line → "help with X" assembles the right crew with zero further setup; Quartermaster answers a cross-week progress question correctly.
5. **Console + Team Tasks sync.** Fleet view over `claude agents --json`; promote/pull ledger items via Team Tasks API (personal team). Acceptance: item promoted on computer A appears in the Ship on computer B.

## 10. Definition of done (v1)

- Ledger + changelog happen with zero human discipline in every plugin-enabled project.
- Everything needing a human across all projects is on one inbox page; approvals resolve live sessions; remembered approvals are native rules.
- Crew presets deliver the no-repetition subagentic default; Quartermaster answers long-horizon questions from real ledger/changelog data.
- Fragments never conflict; rollup answers "what happened today across everything."
- Each service runs standalone; Chart Room integration is pull-only over HTTP; killing any one service degrades, never breaks, the others.

## 11. Out of scope (v1)

Voice bridge (product #3 — drives the same inbox queue). Settings-manager UI (separate product; inbox only *writes* native rules). Config-matrix UI (console phase 2). Reviewer quorum/multi-human flows (Team Tasks' territory). Anything that hosts or wraps sessions.
