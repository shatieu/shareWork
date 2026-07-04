# Product Suite — Research Synthesis (July 2026)

**Prepared for:** Ondřej · **Date:** 4 July 2026
**Inputs:** 4 parallel deep-research passes (mine) + your two reports (*Working Better with Claude*, *Enhancing Claude Interaction and Workflow*) + existing local docs (Ship-vs-Platform verdict, Staleness Toolkit).
**Scope:** the whole broadened suite. ShareWork/team-tasks becomes one small part.

---

## 0. The one strategic headline

Anthropic shipped a lot in the last 6 months: **Agent View** (`claude agents` — cross-project TUI dashboard, Haiku per-session summaries, dispatch, peek/reply to permission prompts, worktrees, supervisor daemon, `--json`), **Agent Teams** (shared task list + inter-agent mailbox, session-scoped), **Remote Control** (phone approval — single session only), **Channels** (Telegram/Discord plugins with permission relay), **Routines** (cloud-scheduled prompts), **plugins/marketplaces** (the native unit for sharing skills/agents/hooks with on/off toggles), and **hooks with `http` handlers** including `PermissionRequest` — a sanctioned way for an external server to receive and answer every permission prompt from every session.

**Consequence:** everything in this suite should be a *thin layer on native surfaces* (`claude agents --json`, hooks, JSONL transcripts at `~/.claude/projects/`, Agent SDK, plugins) — not a parallel orchestration engine. Terragon (cloud fleet) and Crystal (desktop console) both died in early 2026 when Anthropic shipped the native equivalent. The durable gaps are all in the *cross-project, cross-session glue* Anthropic doesn't do.

⚠️ **Tension with your second research doc:** it proposes LangGraph as the orchestration core, BullMQ+Redis for queueing, and Helicone/Langfuse for telemetry. All three are the right answers *if you're building an agent platform from scratch* — and the wrong ones on top of Claude Code:
- **LangGraph** would reimplement what Agent Teams + subagents + `--agent` profiles already do, and you'd lose the native tooling (skills, hooks, permissions) in the process.
- **BullMQ+Redis** adds a Redis dependency to a local dev tool — hostile to "very easy setup." SQLite covers it.
- **Helicone (proxy) only sees API-key traffic.** Claude Code on Pro/Max uses OAuth — a proxy gateway never sees those calls. Local JSONL transcripts + built-in OTel are the correct telemetry sources.

---

## 1. The Ship (fleet console + behavioral layer)

**What exists:** Agent View covers ~60% natively (see §0). OSS/commercial: vibe-kanban (26.8k★, kanban→agents, board exposed as MCP — best "ledger" prior art; Bloop shut down, now community-run), Omnara (YC, mobile push + one-tap approvals), Happy (E2EE mobile client), claudecodeui (web UI auto-discovering sessions from `~/.claude/projects/`), CCManager, Conductor (Mac), Nimbalyst (Crystal's closed-source successor).

**Genuine gaps nothing covers:**
1. **Cross-project persistent ledger** — native task lists are per-session/team; a durable SQLite ledger (exposed as MCP, fed by `TaskCreated/TaskCompleted` hooks, mirroring `~/.claude/tasks/`) that sessions, teams, and the human all share is unbuilt.
2. **Global rollup: "what did all 12 sessions across 4 repos do today, as a changelog"** — per-row summaries exist, fleet digest doesn't. Cheap to build (Stop hooks + JSONL + git log → daily digest), durable.
3. **Fleet-wide remote approval** — Remote Control is single-session. `PermissionRequest` http-hook → central queue → approve from phone works against *vanilla* sessions, no wrapper CLI. (Highest sherlock risk of the three.)
4. **Declarative subagentic mode** — an installable plugin: orchestrator subagent (run via `claude agents --agent orchestrator` / `agent` setting) + team-spawning skills + settings. Assemble from native primitives, don't build an engine.

**Config sharing across projects:** plugins + a private git marketplace repo ARE the mechanism (skills/agents/hooks/MCP bundled, versioned, per-plugin enable/disable). What's missing is only the **matrix UI** (skills × projects, toggle, sync) — build that small; skip bash-copy scripts entirely.

**Verdict:** Build = ledger + rollup changelog + fleet approval queue + the config-matrix UI, all reading native surfaces. Adopt = Agent View for session hosting, plugins for distribution. Fork-candidates for UI chrome: vibe-kanban, claudecodeui.

---

## 2. Voice bridge (phone ↔ session fleet)

**What exists:** Happy (OSS, E2EE relay, voice agent per session via ElevenLabs — MIT, self-hostable server), Omnara (commercial, conversational voice mode, per-session), AgentWire (rough OSS proof of exactly your idea: browser push-to-talk → tmux session routing → TTS back), native `/voice` (terminal push-to-talk, input-only), Remote Control mobile (**no voice at all** — open issue #29399), Channels (permission relay via chat).

**The gap — nobody does fleet-by-voice:** "what's everyone doing?" → spoken digest → "tell the auth one to ship it" → "approve session 3's bash command." Also unexplored: voice approval *safety semantics* (read the command aloud, verbal confirmation for destructive ops).

**Architecture consensus (my research + your doc agree):** phone (thin app/PWA, WebRTC) → voice agent (**ElevenLabs Agents** with client tools / multi-context WS — fastest path; Pipecat/LiveKit later for self-hosted privacy) → thin relay (or Tailscale, no relay) → **laptop daemon on the Agent SDK** using `canUseTool` for permission interception. Never PTY-scrape. Key insight from Happy: keep the voice agent's context separate from session transcripts — summarize before TTS, raw transcripts are unspeakable.

**Verdict:** Build the fleet-state model + summarize-for-speech layer + voice approval flow; adopt ElevenLabs, Happy's relay/E2EE design, ccgram's Allow/Deny/Always/Defer vocabulary. Anthropic will ship mobile dictation soon — the defensible layer is *conversational fleet orchestration*, not speech-to-text.

---

## 3. claude-peers (session-to-session messaging)

Already exists and is in your folder: louislva/claude-peers-mcp (broker on :7899 + SQLite, instant push via the channel protocol). Native Agent Teams mailbox is session-scoped — cross-session/cross-project messaging remains a real gap (open FR #28300).

**Verdict:** Adopt/fork rather than rewrite. Fold into the Ship as the messaging substrate (same SQLite as the ledger), keep publishable standalone. Watch: requires `--dangerously-load-development-channels` — fragile flag, may change.

---

## 4. ask-human, reports, human-action checklists

Your ask-human skill already does browser-form clarifications locally, and Team Tasks has the hosted variant (`request_clarification` MCP tool + inline form). The generalization — a **human-action inbox**: one local page aggregating all pending questions, approvals, and human-required checklist items across all sessions — doesn't exist anywhere and composes naturally with §1's approval queue and §5's write-back forms (agent writes a form block into an MD; you answer in the browser; answer lands in the file where the agent reads it). That last pattern is a genuinely novel human↔agent channel no product ships.

---

## 5. MD management & display suite — **the biggest open niche**

**Nothing combines** browser editing + write-back interactive elements + ID-based self-healing links + agent/MCP access. Closest: SilverBullet (browser live-edit, Space Lua widgets, in-app link repair — but **no stable IDs** (open issue #1652), no MCP, personal-wiki architecture, mid-rewrite churn); Obsidian (everything but desktop-captive); Basic Memory (MCP-native markdown KB, no UI); Emanote (folder-independent slug links, publish-only); Dendron (frontmatter IDs, dead); docfx (UID xrefs, .NET-walled).

**The killer feature is exactly your instinct:** every existing auto-repair (VS Code, Obsidian, Foam, SilverBullet) only works when the move happens *inside that tool*. A `git mv` or an **agent's `mv`** breaks everything. Frontmatter ID + repo-local index + resolver (id → slug → filename → fuzzy) + codemod-on-move + tombstones for deleted docs, robust to out-of-band moves, is unclaimed territory — and it's precisely what agents need, since they move files via shell.

**Build recipe (validated by both my research and your doc):** thin Node server; **vscode-markdown-languageservice** (MIT — link discovery/rename/diagnostics for free); remark/unified + `remark-directive` for `:::ask-me` / `::checklist` interactive blocks (your doc's exact pipeline — steal Obsidian Meta Bind's binding syntax, it's the best-designed DSL); Milkdown or Tiptap for browser WYSIWYG that round-trips to MD; chokidar watcher maintaining the slug index; same core exposed as **stdio MCP + CLI** (mirror Basic Memory's tool shapes so agents feel at home); speak Obsidian-compatible syntax (wikilinks, frontmatter, `^block-ids`); emit llms.txt from the ID index as a free feature. Staleness rules from the existing Staleness Toolkit doc plug in as remark lint rules.

**Verdict:** Build. Least sherlock risk in the whole suite, both of your reports independently converged on it, and your Ship-vs-Platform doc already named it the defensible spine ("Chart Room"). Timing is right: the "markdown files as agent memory substrate" trend is cresting.

---

## 6. Settings manager

Permission surface tripled in 2026 (5 merged scopes, deny-beats-specific-allow footgun, hooks-as-permissions, sandboxing, auto mode, MCP allowlists). Half-tools exist (native `/permissions` TUI, claude-settings.nl, awesome-claude-code-toolkit's "Resolved" view) but nobody ships the killer feature: **cross-scope effective-permission simulator** ("would `rm -rf` be allowed right now, and which rule in which file decides?") + curated template packs ("safe web dev", "read-only audit", "CI headless"). Official JSON schema is chronically stale — a live validator has real value.

**Verdict:** Build small, OSS, fast-follow posture (Anthropic keeps absorbing the pain that motivates it). Second-tier priority.

---

## 7. Usage analytics

Cost/token dashboards are **occupied ground**: ccusage owns the personal CLI, OTel + Grafana dashboards exist, Anthropic serves teams natively (analytics dashboard + Analytics API). Don't compete there.

**The wedge: skill/agent/command trigger analytics.** No native support, hot open FRs (#35319, #51115), existing trackers are toy-grade. Skill invocations DO appear in JSONL transcripts — transcript parsing (à la ccusage) is the reliable collection path. "Which skills fire, proactive vs slash, token cost per skill, dead-skill detection" = a `ccskills` tool, possibly contributed as a ccusage extension for instant distribution.

**Verdict:** Adopt ccusage/OTel for cost; build the skill-analytics wedge narrowly. (Helicone/Langfuse from your doc don't apply — see §0.)

---

## 8. Scheduler & auto-continue

**Highest sherlock risk.** Anthropic shipped four scheduling flavors in ~6 months (Desktop scheduled tasks, `/loop` + Cron tools, cloud Routines, Cowork schedules) and native auto-resume-on-limit-reset looks like a when-not-if (FRs #18980/#47276 …). Community tools (Claude-Autopilot, claude-code-queue, CCAutoRenew) all scrape CLI output — brittle.

**The defensible slice** if any: **quota-aware dispatch** — queue with priorities that knows the 5h/weekly windows ("run cheap tasks now, big ones right after reset") + a hardened reset-time detector (statusline stdin + transcript + the flaky oauth usage endpoint, fused) as a reusable library. SQLite-backed, not Redis.

**Verdict:** Thin adopt/wrap. Design so it survives native auto-resume by becoming the *planner* on top. Lowest build priority.

---

## 9. Suite architecture, packaging, hosting

- **Independence + integration:** each product standalone (own npx installer), integrating via shared *conventions*, not a shared runtime: (a) SQLite files under `~/.<suite>/` (ledger, peers, queue can share one DB), (b) MCP as every tool's agent-facing interface, (c) plugin/marketplace as the distribution channel for the behavioral parts, (d) the MD suite's slug-resolver as the shared doc layer.
- **Repo shape:** a monorepo (pnpm workspaces + turborepo) publishing independent packages gives you shared TS configs/CI/contracts with independent versioning — easier than N repos while products are young; split out later if any takes off. (Your call — question below.)
- **Vercel project:** rename → becomes the suite's landing/docs site + hosts the genuinely-hosted parts (Team Tasks stays one; the voice relay could be another). Everything else = downloadables (npx) + a plugin marketplace repo. Open source throughout, self-hostable.

## Decisions (4 July 2026)

Substrate: **thin on native Claude Code surfaces** (no custom engine). Repo: **monorepo, independently installable packages**. Voice: **ElevenLabs first**, payload-minimized. Deep dives: all areas, starting with the MD suite.

## 10. Priority ranking (defensibility × demand × sherlock risk)

| # | Product | Verdict | Sherlock risk |
|---|---|---|---|
| 1 | **MD suite** (browser edit + write-back forms + ID self-healing links + MCP) | Build — open niche, spine of everything | Low |
| 2 | **Ship glue**: cross-project ledger + rollup changelog + human-action inbox | Build thin on native surfaces | Low-Med |
| 3 | **Voice fleet bridge** | Build the fleet layer; adopt ElevenLabs/Happy patterns | Medium |
| 4 | **Skill analytics** (`ccskills`) | Build narrow, maybe as ccusage extension | Medium |
| 5 | **Settings manager** (effective-permission simulator + templates) | Build small | Medium |
| 6 | **Fleet remote approval** | Build small (hooks-based) — or fold into 2+3 | High |
| 7 | **Scheduler/auto-continue** | Thin wrap; quota-aware planner only | Highest |
| — | claude-peers | Adopt/fork existing OSS | — |
| — | Config sharing | Adopt plugins/marketplaces; build only matrix UI | — |
