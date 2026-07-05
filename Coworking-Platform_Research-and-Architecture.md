---
id: agent-coworking-platform-research-solution-architecture
---

# Agent Coworking Platform — Research & Solution Architecture

**Prepared for:** Ondřej
**Date:** 30 June 2026
**Purpose:** Decide whether to build, and how. Part 1 surveys what already exists (so we don't reinvent the wheel). Part 2 maps your requirements to that prior art and isolates the real gaps. Part 3 is the proposed architecture and build plan on Vercel + Supabase.

---

## 0. Executive summary

### What you want (the vision, restated)

A private (later public) platform where people collaborate on tasks — mostly **code**, but also docs, books, art, research — by handing the work off to **their own Claude Code / AI agents**. Concretely it must:

- Package and hand over a **spec + rules + setup + Claude skills + (optionally, securely) env vars** so an agent can be stood up on **another person's machine** and continue the work.
- Broadcast **who is working on what** (presence / claiming / locking) so collaborators don't collide.
- Let workers **submit results / reports**, and track **progress**.
- Act as a shared **to-do / task board**.
- Provide a **PR-review-style review gate for *any* kind of work** — a **worker** produces, a **reviewer** (human or another person's Claude) approves before a task is "done."
- Support **private team spaces** now, **inviting other teams** soon, and **public projects** (open worker/reviewer pools) later.
- Imagined shape: server + DB + state machine + an **MCP server** that securely exposes tasks and a place to hand back results. Host on **Vercel + Supabase**, with a web frontend.

### What already exists (the wheel — reuse, don't rebuild)

The pieces of your system mostly exist as *separate* mature building blocks:

- **AI-agent task boards / orchestrators** already nail the single-user loop of *plan → run agent in isolated workspace → review diff → merge*: **vibe-kanban**, **Conductor**, **Claude Squad**, **Crystal→Nimbalyst**, **Sculptor**, plus cloud background agents (Cursor, OpenAI Codex cloud, Google Jules, Devin). **Backlog.md** is the closest "review-any-work, non-code, git-native task board." **None** of these models multiple *humans each running their own agent*.
- **Portable agent context is basically a solved, standardized file format**: **GitHub Spec Kit** / **Amazon Kiro** define the spec→plan→tasks document chain; **AGENTS.md** (Linux Foundation standard, 60k+ repos) carries rules; the **Agent Skills `SKILL.md`** standard (16+ tools) carries reusable capabilities; **`.claude/`** carries Claude-specific setup. Your "portable task package" is an assembly of these, not an invention.
- **MCP already has a native, experimental Tasks primitive** (async "dispatch work → poll for result" with auth-context binding) — the protocol-level backbone for exposing tasks/results to agents.
- **Human-in-the-loop / approval mechanics are everywhere**: LangGraph `interrupt()` + **Agent Inbox** (a copyable 4-action reviewer vocabulary), CrewAI, Microsoft Agent Framework, OpenAI Agents SDK, **HumanLayer**. The whole industry converged on *interrupt → durably persist → human approves/edits/rejects → resume*.
- **Durable execution is a commodity**: **Vercel Workflows** went **GA 16 Apr 2026** (durable, encrypted step I/O, native to your stack) — plus Temporal, Inngest as alternatives.
- **The Vercel + Supabase build platform is first-party-ready for exactly this**: multi-tenant SaaS starters (Makerkit, Vercel Platforms), Supabase **Auth + RLS + Realtime Presence + Vault**, **MCP servers on Vercel** via `mcp-handler` with **OAuth**, **Supabase's own OAuth 2.1 server** (agent authenticates as your user, RLS auto-applies), **Vercel Sandbox** (GA) to run untrusted agent code, and marketplace security (WAF, BotID, Arcjet, Upstash).

### What is NOT covered (your real whitespace — this is what you build)

No single product in 2026 does the combination you're describing. The genuinely novel parts:

1. **Multi-human teams where each member runs their own agent.** Every existing tool is "one human + N agents." None broadcasts **presence/claiming across people**, and none has an "invite another team" or "public project anyone can join" primitive.
2. **A review gate as a multi-actor state machine for *any* deliverable.** Existing HITL is *single-actor, intra-run* tool approval; existing review is *code PR* review. A generalized **worker → reviewer → done** flow that applies equally to a book chapter, a research report, or an art asset — with role/team permissions and (for public projects) reviewer quorums — has no turnkey prior art.
3. **Secure spec + rules + skills + (encrypted) env handoff to *someone else's* machine.** Cloud agents provision *their own* sandbox from *your* account; local tools run on the operator's own box. Packaging a portable, **secret-referencing** (not secret-containing) "agent setup kit" for a *different person* to continue the work is unsolved — and the security guidance (NSA/CISA MCP, the April 2026 Vercel env-var incident) is explicit that raw secrets must never reach the agent's context.
4. **Non-code work as a first-class citizen** of all the above.

### Bottom line / verdict

**Build it — your instinct on the architecture is broadly correct** (server + DB + state machine + MCP, on Vercel + Supabase). Refine it in four ways: (a) **assemble** the portable-context layer from existing standards rather than inventing a format; (b) **build your own task state machine on Supabase Postgres** but lean on **Vercel Workflows** for the long-lived "pending review" durability instead of hand-rolling timers; (c) **never hand raw env to agents** — use a Vault + short-lived-token broker; (d) treat the **multi-human + review-any-work + secure-handoff** triad as your differentiator and the only part with no off-the-shelf answer. A thin MVP is realistic because ~70% of the stack is reusable.

---

## Part 1 — The landscape (research findings)

This space is moving fast and consolidating. A durability caveat worth stating up front: in 2026 alone **vibe-kanban's company (Bloop) shut down** (the tool went community-maintained), **Crystal became Nimbalyst**, and **Terragon shut down and open-sourced**. Pick prior art to *learn from* carefully; some of it is already orphaned.

### 1.1 AI coding-agent orchestration tools & task boards

The category splits into (a) **local multi-agent runners** that put a GUI/TUI over Claude Code/Codex/Gemini and give each task its own git worktree or container; (b) **cloud "background agents"** that clone your repo into a sandbox and open a PR; and (c) **markdown/git-native task boards** for agents. Almost all are **single-developer-centric** — the "team" is one human plus their fleet of agents, not multiple humans each driving their own agent.

| Tool | What it is | Multi-human team? | Review workflow? | Non-code? | OSS / self-host | Status (2026) |
|---|---|---|---|---|---|---|
| **vibe-kanban** (Bloop) | Kanban board + workspace runner for many agents; inline diff review → PR; ships an MCP server | No (shared content, not per-person presence) | Yes — diff + inline comments → PR | No | Apache-2.0, ~27k★, self-host | **Bloop shut down Apr 2026**; now community-maintained, local-only |
| **Conductor** (Melty Labs) | macOS app, parallel agents in worktrees; GitHub + Linear | **No — explicitly single-user** | Yes — per-workspace diff | No | Closed, free (BYO sub), Mac-only | Active; team features only "planned" |
| **Claude Squad** | tmux TUI managing many CLI agents in worktrees | No | Manual diff per session | No | AGPL-3.0, ~8k★, self-host | Active, mature |
| **Crystal → Nimbalyst** | Desktop app, parallel sessions + **kanban**, edits markdown/mockups/diagrams; **Team plan in development** | Crystal no; **Nimbalyst Team plan (real-time collab, shared session handoffs) unreleased** | Yes — inline diff + kanban | **Partial** (markdown, mockups) | MIT desktop | Crystal deprecated Feb 2026; Nimbalyst active |
| **Sculptor** (Imbue) | Parallel agents in **Docker containers**; syncs into local repo | No | Review before commit | No | Source-available, self-host | Research preview |
| **claude-flow / "Ruflo"** | Multi-*agent* "hive-mind" meta-harness over Claude Code | Orchestrates agents, not humans | Agent-level, not human PR gate | Code-focused | OSS, ~58–62k★ | Very active (framework, not product) |
| **Backlog.md** | Markdown/git-native task board; tasks as `.md`; CLI + web + **MCP server** | Via git only (no live presence) | **Yes — explicit Definition-of-Done + 3 human review checkpoints** | **Yes — `--no-git`, any project** | MIT, ~6k★, in-repo | Active, mature |
| **Cursor / OpenAI Codex cloud / Google Jules / Devin** | Cloud agents clone repo → work in sandbox → open PR; parallel instances | Seat-based teams; collab via GitHub, not agent-presence | Yes — PR review | No | Closed SaaS | Mainstream |
| **Claude Code "Agent Teams"** (Anthropic, official) | A lead session delegates to teammate sessions sharing a **task list w/ statuses, dependency tracking, file locking**; reusable **reviewer roles** | Multiple *agents*, one human | Reviewer-as-subagent (agent reviews agent) | No | Built into Claude Code (experimental flag) | Experimental |

**Closest existing things — and exactly what they still don't do.** **vibe-kanban** is closest in *shape* (board + agent-run + review + MCP + self-host) but is code/PR-only, single-user, has no secure cross-machine handoff, and its company just shut down. **Backlog.md** is closest on *review-any-work + non-code + git/MCP-native task model* but is a task *store*, not an orchestrator — no agent execution, no presence/locking across humans, no secrets. **Claude Code Agent Teams** is closest on *coordination primitives* (shared task list, file locking, reviewer roles) but coordinates agents under one operator, not multiple humans across machines. **Nimbalyst** is the only one publicly building multi-human team features — and that tier is unreleased. Your concept is essentially *Backlog.md's review model × vibe-kanban's board+run+review × a real multi-human team/presence layer × secure portable spec+env handoff* — and that combination does not exist as one product.

### 1.2 Spec / task handoff & portable agent context

By mid-2026 "spec-driven development" is the dominant pattern and the portable-context layer is **standardized file conventions + MCP for anything dynamic**. This is good news: your "portable task package" is mostly *assembly of existing standards*, not new format design.

| Building block | What it is | MCP? | Multi-user? | OSS | Role in your package |
|---|---|---|---|---|---|
| **Task Master** (claude-task-master) | Ingests a PRD → dependency-aware task graph; "project manager for your agent" | **Yes** (recommended integration) | Weak (local, file-in-repo, "tags") | MIT **+ Commons Clause** (can't resell as a service) | Borrow the **task-decomposition + MCP-surface design**; not the platform |
| **GitHub Spec Kit** | `constitution.md` (rules) + `spec.md → plan.md → tasks.md`; 30+ agent integrations, no lock-in | Drives agents | No (files in repo) | MIT | The **canonical spec-package format** to copy |
| **Amazon Kiro** | Spec-first IDE: `requirements.md` (EARS) → `design.md` → `tasks.md` | In-IDE | Closed | No (proprietary) | Confirms the spec-doc triplet pattern |
| **AGENTS.md** | Open standard for portable agent **rules** (Linux Foundation AAIF; 60k+ repos) | — | Repo-scoped | Open standard | The **rules** half. ⚠️ Claude Code reads `CLAUDE.md`, not `AGENTS.md` — symlink `CLAUDE.md → AGENTS.md` |
| **Agent Skills (`SKILL.md`)** | Open standard for reusable capabilities (16+ tools: Claude Code, Cursor, Codex, Gemini…) | Skills can call MCP | Repo/user scope | Open standard | The **skills** half — "build once, use across agents" |
| **`.claude/` dir** | Subagents, settings, slash commands, allowed tools, MCP pointers | Claude Code is an MCP client | Personal vs project scope | Format open | The **setup** half — commit and it travels |
| **MCP Tasks primitive** (spec 2025-11-25) | Native async tasks: call returns `taskId`; client polls `tasks/get`/`result`; lifecycle `working→input_required→completed/failed/cancelled`; **auth-context binding mandatory** | It *is* MCP | Auth-bound, multi-tenant-safe | Open spec | **Protocol-level backbone** for exposing tasks/results. ⚠️ Experimental, being moved to an extension — pin versions |
| **Session-handoff skills** (handoff/handover, ADK pause-resume) | Compress a session into a machine-readable handoff doc (goal, files, commands, verification, assumptions, blockers, next safe action) | Some ship as hooks | Local | Mixed MIT | Template for **what the handoff doc must contain** |

**Takeaway:** the spec→plan→tasks chain (Spec Kit/Kiro), `AGENTS.md` rules, `SKILL.md` skills, and `.claude/` setup are all *plain files that travel with a repo* — exactly how portability is achieved today. None of them carry **secrets** (by design) or **multi-tenant task state** — those are yours. The MCP Tasks primitive already specifies the exact "dispatch → poll for result" contract and (critically) mandates **auth-context binding** (reject cross-tenant task access), which is the multi-tenant isolation most single-user tools skip.

### 1.3 Secure secrets / env handoff to a remote agent

This is your highest-risk surface and the security mood hardened in 2026 (the **19 Apr 2026 Vercel incident** potentially exposed customer env vars — "sensitive"-flagged vars were protected; **NSA/CISA published MCP security guidance** on 2 Jun 2026). Consensus best practice: **anything that lands in the LLM's context is eventually extractable**, so credentials must be **brokered, just-in-time, scoped, short-lived, and never seen by the model**.

| Option | Model | OSS / SaaS | Fit for "hand env to a remote agent" |
|---|---|---|---|
| **Supabase Vault** | Encrypted-at-rest secrets in Postgres (AEAD/libsodium); key held outside SQL; read via `service_role`-only RPC | OSS extension + managed | **The at-rest store** in your stack. Not by itself a JIT broker — pair with a broker endpoint |
| **Infisical** | OSS secrets platform; **dynamic/short-lived secrets**, **Agent Vault** (credential proxy between agent and secret) + **MCP endpoint governance** | **OSS (MIT) + cloud, self-host** | **Best purpose-built fit** for the "broker between agent and secret" shape; self-host alongside Supabase |
| **Doppler** | Managed SecretOps; runtime injection; published MCP secrets architecture | SaaS only | Strong DX/reference; external dependency |
| **HashiCorp Vault** | Identity-based **dynamic secrets**, per-request, auto-expiring | OSS core + HCP | Gold standard for JIT; heavier to operate |
| **1Password Service Accounts** | `op run`/`op inject` inject secrets without writing `.env`; Unified Access for agents (Mar 2026) | SaaS | Good if team already lives in 1Password |
| **SOPS + age** | Encrypt *values* in YAML/JSON/ENV committed to git; recipient's `age` key decrypts | OSS | The **encrypted-in-package** leg for offline/air-gapped handoff; human holds the key, never the agent |
| **Vercel Sensitive Env Vars** | Per-project key, value non-readable after creation, auto-redacted in logs | Platform feature | Use for **your platform's own** secrets — *not* as the agent-handoff mechanism (still plaintext at runtime) |

**Recommended pattern (this is the architecture target):** store team secrets **encrypted in Supabase Vault**; put a **broker** in front (self-hosted **Infisical Agent Vault**, or a thin broker you build). When a worker accepts a task, the MCP server hands the agent a **short-lived, task-scoped capability token**, *not* the secret. At execution time the agent's tooling (an `op run`-style wrapper, or an MCP tool that performs the privileged call **server-side**) exchanges that token for the real credential **just-in-time, outside the prompt**, uses it, discards it — the model only ever sees "operation succeeded." Follow the MCP rules: **no token passthrough** (your server does the exchange and validates audience), bind every task and fetch to the team/auth context, tight TTLs, log every fetch, redact outputs. Use **SOPS + age** only for the rare case where an encrypted secret must physically travel in an offline package.

### 1.4 Multi-agent frameworks, human-in-the-loop & review state machines

The whole industry converged on one HITL pattern: **interrupt → durably persist full state → human approves/edits/rejects out-of-band → resume the *same* run** (not a new turn). But almost all of it is **single-actor, intra-run tool approval** — one human approves one tool call mid-run. Your need — a **worker** actor produces a deliverable, a **different reviewer** actor approves it, with team/role permissions, before "done" — is closer to PR-review / content-approval than to a tool-call gate, and it has **no turnkey prior art**.

| Framework / tool | What it gives you | HITL approval? | Durable state? | OSS / self-host | Verdict for your review gate |
|---|---|---|---|---|---|
| **LangGraph + Agent Inbox** | Graph state machine, `interrupt()`, Postgres checkpointers; **Agent Inbox** = a reviewer-queue UI with a 4-action vocabulary (`accept` / `edit` / `respond` / `ignore`) | Yes (flagship) | Yes (checkpointer) | MIT | **Reuse as per-task worker runtime**; **copy Agent Inbox's 4-action vocabulary** for your reviewer UI |
| **CrewAI** | Role-Goal agents; hierarchical process where a **manager delegates + validates results** | Yes (triggers, guardrails) | Flows; weaker persistence | MIT core | Reference for **roles + "manager validates output"** = your reviewer concept |
| **Microsoft Agent Framework 1.0** | Merged AutoGen+SK (Apr 2026); orchestration patterns + checkpointing + pause/resume | Yes, first-class | Yes | MIT | Reference (heavier, .NET/Azure-leaning) |
| **OpenAI Agents SDK** | Agents, **handoffs**, guardrails, `needsApproval` + resumable `state` | Yes (clean approve/reject/resume lifecycle) | You persist `state` | OSS | **Copy the approval lifecycle pattern**; supply your own store |
| **HumanLayer** | `require_approval` / `human_as_tool`, routing to Slack/email, escalations, timeouts, webhooks | Yes — its whole purpose | Some | Apache-2.0 SDK | ⚠️ **Company pivoted to an IDE in 2026** — *mine the API shape, don't depend on it* |
| **Temporal** | Best-in-class durable execution; **Signals** inject human decisions; durable timers for approval deadlines | Yes (signal-based cookbook) | **Best-in-class** | OSS + Cloud | Reference; **heavy infra, doesn't fit Vercel+Supabase cleanly** |
| **Inngest / AgentKit** | `step.sleep` / `waitForEvent` durable steps, serverless-native | `waitForEvent` enables approval-wait | Yes | OSS + cloud | Serverless durable alternative |
| **Vercel Workflows** | **GA 16 Apr 2026** — durable, long-running, **encrypts step inputs/outputs**, pause for extended periods, state across deployments | Pause/resume + hooks | **Yes, native to your stack** | Managed (Vercel) | **Primary durability layer for "pending review" timers/escalation** — native, no extra infra |
| **AG-UI / CopilotKit** | Protocol streaming agent state to UI + pause-for-input/edit events | Protocol-level pause | No (transport) | MIT-style | Reuse for the live board + reviewer UI sync (or just use Supabase Realtime) |

**Three non-negotiable rules from approval-workflow best practice**, worth baking in from day one: (1) the reviewer's **APPROVE must happen *before* the side effect** that publishes/merges, not after; (2) **guard every transition transactionally** (state check + unique constraint + idempotency key) because two reviewers *will* click at once; (3) **forbid worker == reviewer** (you can't review your own deliverable). HumanLayer pivoting away from its approval API in 2026 is the key signal here: **the review state machine is yours to build** (a few hundred lines over Supabase Postgres), reusing only the *mechanisms* — Agent Inbox's action vocabulary, Vercel Workflows for durable waits, Supabase Realtime/AG-UI for the live board.

### 1.5 The Vercel + Supabase build platform

**Verdict: Vercel + Supabase is a strong, well-trodden fit**, and both vendors shipped first-party primitives aimed squarely at multi-tenant SaaS + remote MCP servers + agent workloads within the last 12 months. Recommended shape: a **Next.js (App Router) app on Vercel** for FE + API; **Supabase Postgres as system-of-record + state-machine store** with **RLS for tenant isolation**; **Supabase Realtime Presence/Broadcast** for "who's working on what"; **Supabase Vault** for secrets; the **MCP server as a Next.js route** via `mcp-handler` (Streamable HTTP), secured with **OAuth** where **Supabase's own OAuth 2.1 server** is the authorization server (agent authenticates as your Supabase user; **RLS auto-applies**).

**Starter templates (don't start from blank):**

| Template | Includes | License / cost | Fit |
|---|---|---|---|
| **Makerkit (Next.js Supabase SaaS, Turbo)** | Supabase auth + **teams/orgs + per-seat billing + RLS multitenancy**, 60+ UI components, admin | Commercial one-time (~$299 Pro / ~$599 Team); Lite is free/OSS | **Highest fit** — closest to your team/roles/RLS/invite feature set |
| **Vercel Platforms Starter Kit** (`vercel/platforms`) | Multi-tenant Next.js 15, **subdomain/custom-domain routing** via middleware | MIT, free | **High for multi-tenant routing** ("public projects" on subdomains); not Supabase-wired, no billing/RBAC |
| **MCP-with-Next.js template** | `mcp-handler` MCP server skeleton, Streamable HTTP | MIT, free | **Directly the skeleton** for your task/result MCP server |
| **Supabase + Next.js App Router auth template** | Cookie-based SSR auth | MIT, free | Minimal official baseline if you don't buy Makerkit |

> ⚠️ Naming trap: Vercel's "B2B Multi-Tenant Starter Kit" is actually **Stack Auth + Redis, not Supabase**; and `vercel/nextjs-subscription-payments` is **archived (read-only since Jan 2025)**. Prefer Makerkit or assemble from current Supabase examples.

**Supabase building blocks (with the gotchas that matter):**

- **Auth:** email/OAuth/magic-link, MFA, **enterprise SSO (SAML)** for "invite other teams" (SAML needs Pro+, ~$0.015/SSO-MAU). Third-party auth (Clerk/WorkOS/Auth0) supported if you keep identity outside Supabase but still use RLS.
- **RLS multitenancy:** `accounts` + `memberships` tables; add `org_id` to every tenant table; **enable RLS on every table, `WITH CHECK` on writes**. Performance gotcha: **embed `org_id`/role into the JWT** (custom access-token hook) and **index `org_id`/`user_id`** — Supabase documents **>100×** speedups; wrap `auth.uid()`/`auth.jwt()` so they evaluate once per query.
- **Realtime:** use **Presence** for slow-changing "user X is on task Y" state (persisted in channel, auto join/leave), **Broadcast** for high-frequency pings ("result submitted"). **Never `track()` on every tick** — it floods the channel. Gate channel joins with **RLS on `realtime.messages`**. Free = 200 concurrent connections; Pro = 500+ (plan around *peak* concurrency).
- **Vault:** AEAD encryption, key managed outside SQL; read only via `service_role` RPC; disable statement logging while in use.

**MCP-on-Vercel (the supported path, current status):**

- Use **`mcp-handler`** (npm; formerly `@vercel/mcp-adapter`, Apache-2.0) — drops an MCP server onto `app/api/[transport]/route.ts`. **Pin `@modelcontextprotocol/sdk` ≥ 1.26.0** (earlier versions have a known vuln).
- Transport: **Streamable HTTP** (Vercel reports >50% CPU reduction vs SSE); runs on **Fluid Compute** (tuned for MCP's bursty/idle pattern, scale-to-near-zero).
- **OAuth:** wrap with **`withMcpAuth(handler, verifyToken, { required: true, requiredScopes: [...] })`**; expose **`/.well-known/oauth-protected-resource`** so clients discover the authorization server. **Bring an AS** — Vercel ships one-click examples for **Better Auth, Clerk, Descope, Stytch, WorkOS**, or use **Supabase's OAuth 2.1 server** (beta, free during beta; agent authenticates as your user, **RLS auto-applies** — elegant). Implement **Resource Indicators (RFC 8707)** so tokens are scoped to *your* server. The **MCP auth flow:** agent discovers your AS → OAuth 2.1 + PKCE → user approves → scoped bearer token → calls your `/api/mcp` → `verifyToken` resolves user/tenant → tools run under RLS. Scope tools like `tasks:read`, `results:submit`.

**Vercel Marketplace / first-party security & infra to reuse (not rebuild):**

| Integration | First-party? | Solves |
|---|---|---|
| **Vercel WAF / Firewall** | Yes | L7 rules + **rate limiting** on MCP/task routes; DDoS |
| **Vercel BotID** (Kasada) | Yes | Invisible bot filtering on signup + agent-facing endpoints (no CAPTCHA) |
| **Vercel Sandbox** | Yes (**GA Jan 2026**) | **Run untrusted / agent-generated code in Firecracker microVMs** — no access to your env/DB |
| **Vercel Workflows** | Yes (**GA Apr 2026**) | **Durable execution** for your long-lived task/review flow |
| **Arcjet** | Marketplace | All-in-one programmable security (bot, rate limit, AI protection) if you may leave Vercel |
| **Upstash Redis / QStash** | Marketplace | Serverless rate limiting (`@upstash/ratelimit`) + job queue for fanning work to agents |
| **WorkOS AuthKit** | Marketplace | Enterprise **SSO/SCIM** ("invite other teams") + spec-compatible **OAuth 2.1 AS for MCP** |
| **Clerk / Stytch / Descope** | Marketplace | Hosted identity, each with a published Vercel MCP OAuth example |

---

## Part 2 — Gap analysis: requirement → prior art → what you build

This is the "what's available vs what's not covered" mapped to *your* feature list.

| Your requirement | Closest existing prior art | Reuse | The gap you build |
|---|---|---|---|
| **Task board / to-do list** | Backlog.md, vibe-kanban, Linear | Data model + UX patterns | Multi-tenant, multi-human, with the review states below |
| **Hand over spec + rules + setup + skills** | Spec Kit, AGENTS.md, `SKILL.md`, `.claude/` | **Use the standards directly** | A *bundler/installer* that serializes them into a portable, versioned package and reconstitutes them on another machine |
| **Securely hand over env vars** | Supabase Vault, Infisical, SOPS+age, broker pattern | Vault + broker pattern | A **task-scoped, short-lived-token broker** so the agent never sees raw secrets |
| **Expose tasks / submit results to agents** | **MCP Tasks primitive**, `mcp-handler` on Vercel | Protocol + adapter | Your task semantics, tenant binding, and the result→review trigger on top |
| **"Who is working on what" (presence/locking)** | Supabase Realtime Presence; Claude Code Agent Teams file-locking | Realtime Presence + claim/lock rows | **Presence across *humans*** (not agents under one operator) + task claiming/leasing |
| **Progress tracking** | LangGraph state, AG-UI streaming | Heartbeats + status events | Surfacing remote-agent progress to the team board |
| **PR-review for *any* work (worker→reviewer→done)** | LangGraph/Agent Inbox vocabulary, CrewAI manager-validates, content-approval SaaS | Reviewer action vocabulary + durable waits | **The multi-actor, role/team-permissioned review state machine for arbitrary deliverables** — *your core differentiator, no turnkey prior art* |
| **Let my Claude review what they hand in** | Claude Code reviewer subagents; `/review` skills | Reviewer-agent prompts/skills | Wiring a reviewer's *own* agent to the deliverable + diff/report via MCP |
| **Private teams → invite other teams → public projects** | Makerkit teams/RLS, WorkOS SSO, Vercel Platforms subdomains | Multitenancy + SSO + routing | Cross-team invites + public worker/reviewer pools + **reviewer quorum** for public "done" |
| **Mostly code, sometimes docs/books/art/research** | Backlog.md (`--no-git`), Nimbalyst (markdown/mockups) | Generic "artifact" abstraction | First-class non-code deliverables flowing through the *same* review gate |

**Reading of the table:** roughly 70% is assembly of mature, mostly-free building blocks. The ~30% that is *yours* clusters into four things, and they're the things worth your time: **(1)** the multi-human team/presence/claiming layer, **(2)** the review-any-work state machine, **(3)** the portable-package bundler/installer, **(4)** the secret broker. Everything else (auth, billing, RLS, realtime transport, MCP transport, durable execution, untrusted-code sandboxing, bot/rate-limit protection) is bought or pulled off a shelf.

---

## Part 3 — Proposed solution architecture

### 3.0 Is your imagined architecture right?

**Yes — server + DB + state machine + MCP server, on Vercel + Supabase, is the correct shape.** Four refinements:

1. **Don't invent a portable-context format** — assemble Spec Kit + AGENTS.md + `SKILL.md` + `.claude/` and ship a bundler.
2. **Build the task state machine on Supabase Postgres**, but use **Vercel Workflows** (GA, native, encrypts step I/O) for the *durable long-lived parts* (a task can sit "in review" for days; reminders/escalation/timeouts) instead of hand-rolling cron/timers.
3. **Never put raw env in the agent's context** — Vault + short-lived-token broker, model-blind.
4. **You may expose tasks via the MCP `Tasks` primitive later, but build your own task state now** — the primitive is experimental and being demoted to an extension. Your MCP server can start with plain tools (`get_next_task`, `submit_result`) and adopt the Tasks lifecycle when it stabilizes.

### 3.1 High-level shape

```
┌────────────────────────────────────────────────────────────────────┐
│  VERCEL (Next.js App Router)                                         │
│                                                                      │
│  • Web frontend ─ board, task detail, reviewer "inbox", presence     │
│  • REST/Server Actions ─ app API for the FE                          │
│  • MCP server  /api/[transport]  (mcp-handler, Streamable HTTP)      │
│        └─ withMcpAuth → verifies OAuth token, resolves user+tenant   │
│  • Vercel Workflows ─ durable task/review lifecycle, SLA timers      │
│  • Vercel Sandbox ─ optional: run untrusted worker code / checks     │
│  • WAF + BotID ─ rate-limit & bot-protect signup + MCP routes        │
└───────────────┬──────────────────────────────────┬─────────────────┘
                │                                    │
        OAuth 2.1 (PKCE)                     Postgres / Realtime / Vault
                │                                    │
┌───────────────▼──────────────┐      ┌──────────────▼──────────────────┐
│  SUPABASE AUTH (OAuth 2.1 AS) │      │  SUPABASE                        │
│  • agents authenticate as a   │      │  • Postgres: tasks, state,       │
│    user; RLS auto-applies      │      │    events (audit), teams, RBAC  │
│  • (or WorkOS for ent. SSO)    │      │  • RLS = tenant isolation        │
└───────────────────────────────┘      │  • Realtime: presence/broadcast  │
                                        │  • Vault: encrypted secrets      │
                                        └───────────────┬──────────────────┘
                                                        │ short-lived, scoped token
                                                        ▼
                                            SECRET BROKER (Infisical Agent
                                            Vault, or thin custom endpoint)
                                                        │ JIT inject, model-blind
                                                        ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  WORKER MACHINES (each person's own Claude Code / agent)             │
   │  • MCP client points at /api/mcp                                      │
   │  • pulls a "portable task package" (spec+rules+skills+setup+refs)     │
   │  • works, heartbeats progress, submits result + report               │
   └─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Frontend + API | **Next.js (App Router) on Vercel** | One deploy target; MCP route co-located; Server Actions |
| Starter base | **Makerkit (Supabase SaaS)** or assemble from Supabase examples + Vercel Platforms | Teams/orgs/RLS/billing out of the box |
| DB + system of record | **Supabase Postgres** | RLS multitenancy, realtime, Vault, in one place |
| AuthN/Z for humans | **Supabase Auth** (+ **WorkOS** later for enterprise SSO/cross-team) | Native; WorkOS adds SCIM/SSO for "invite other teams" |
| AuthN/Z for agents (MCP) | **Supabase OAuth 2.1 server** as the MCP authorization server | Agent authenticates *as the user*, RLS applies automatically |
| MCP server | **`mcp-handler`** on Vercel, Streamable HTTP, `withMcpAuth` | Supported path; pin SDK ≥ 1.26.0 |
| Durable task/review lifecycle | **Vercel Workflows** (primary) | GA, native, encrypts step I/O, long pauses |
| Task state machine | **Custom, on Postgres** (tasks + append-only `task_events`) | Domain logic; no turnkey option exists |
| Presence / live board | **Supabase Realtime** (Presence + Broadcast) | Native; RLS-gated channels |
| Secrets at rest | **Supabase Vault** | In-stack, AEAD |
| Secret handoff to agents | **Broker + short-lived token** (Infisical Agent Vault, or custom) | Model never sees raw secret |
| Untrusted code execution | **Vercel Sandbox** | Firecracker isolation, no env/DB access |
| Abuse protection | **Vercel WAF + BotID** (or Arcjet) + **Upstash** rate limit | Protect signup + MCP endpoints |
| Reviewer UI vocabulary | Copy **Agent Inbox**: approve / approve-with-edits / request-changes / reject | Proven 4-action model |

### 3.3 Data model sketch (Supabase Postgres, all RLS-enabled)

- **`accounts`** — personal accounts keyed by `auth.users.id`; team accounts as their own UUID.
- **`memberships`** — `(account_id, user_id, role)` where role ∈ `owner | admin | worker | reviewer | viewer`. Drives RLS and the worker/reviewer permission split.
- **`projects`** — belongs to an account; `visibility ∈ private | invited | public`.
- **`project_invites`** — cross-team / external invites (later: WorkOS SSO).
- **`tasks`** — `id, project_id, title, body, artifact_kind (code|doc|book|art|research), state, current_assignee, lease_expires_at, package_ref, created_by`.
- **`task_events`** — **append-only audit log**: `(task_id, actor_id, effective_role, prev_state, next_state, action, payload_json, evidence_ref, created_at)`. This is the source of truth for "how far did they get" and "who did what."
- **`deliverables`** — submitted results: `(task_id, worker_id, kind, location_ref [git PR / file / URL], report_md, checks_json, submitted_at)`.
- **`reviews`** — `(deliverable_id, reviewer_id, decision, comments_md, decided_at)`; `reviewer_id <> worker_id` enforced.
- **`secrets`** — Vault-backed; only **references** ever leave the server.
- **`presence`** — ephemeral, lives in Realtime channels, not a table.

RLS pattern: every tenant table carries `account_id`/`project_id`; policies match against `org_ids` embedded in the JWT (custom access-token hook); index those columns.

### 3.4 The task lifecycle state machine (worker → reviewer → done)

The same machine works for code, docs, books, art, or research — only `artifact_kind` and the "checks" differ.

```
DRAFT ─▶ READY ─▶ CLAIMED ─▶ IN_PROGRESS ─▶ IN_REVIEW ─┬─▶ APPROVED ─▶ DONE
                    │             │              │       ├─▶ CHANGES_REQUESTED ─▶ IN_PROGRESS
                    └─(release)───┘              │       └─▶ REJECTED
                                   BLOCKED ◀─────┘
                                   (timeout/escalate ▶ ESCALATED)
```

- **DRAFT** — created with its portable package attached; not yet open. → READY
- **READY** — on the board as available; a worker can claim. → CLAIMED
- **CLAIMED** — assigned to a worker (machine/agent id + **lease** recorded); secrets provisioned via broker. → IN_PROGRESS / READY (lease expiry releases it — this is your locking)
- **IN_PROGRESS** — remote agent running; **heartbeats** stream to the board. → IN_REVIEW (submit) / BLOCKED / READY (abandon)
- **IN_REVIEW** — *the gate.* Deliverable + report queued to a reviewer (≠ worker; role/team checked). A **Vercel Workflow** runs the SLA timer (remind → escalate → auto-expire). Reviewer actions: **APPROVE → APPROVED**, **APPROVE_WITH_EDITS → APPROVED** (edits logged), **REQUEST_CHANGES → CHANGES_REQUESTED**, **REJECT → REJECTED**.
- **APPROVED** — review passed; **this is the gate before any publish/merge side effect**. → DONE
- **DONE** — terminal success. *(Public projects: require N approvals — a quorum guard on APPROVE.)*
- **CHANGES_REQUESTED / BLOCKED / ESCALATED / REJECTED** — rework, dependency wait, SLA breach, terminal failure.

Every transition writes one `task_events` row and is **guarded transactionally** (state check + idempotency key). Permission to fire a transition = f(role, team, project visibility).

### 3.5 The MCP server surface (what a worker's agent sees)

Hosted at `/api/mcp` on Vercel, OAuth-protected, tenant-scoped. Start with plain tools; adopt the MCP `Tasks` lifecycle later.

- `list_available_tasks(project?, kind?)` → tasks in READY the caller may claim.
- `claim_task(task_id)` → transition to CLAIMED, returns a **lease** + the **portable task package** (or a signed download URL).
- `get_task(task_id)` → full spec, rules, acceptance criteria, current state.
- `report_progress(task_id, summary, percent?, artifacts?)` → heartbeat → board.
- `request_secret(task_id, name)` → returns a **short-lived scoped token**, *not* the value (broker exchanges it JIT, server-side).
- `submit_result(task_id, location_ref, report_md, checks)` → creates `deliverable`, transitions to IN_REVIEW.
- `get_review_feedback(task_id)` → reviewer comments if CHANGES_REQUESTED.
- *(Reviewer side, for "let my Claude review")* `list_pending_reviews()`, `get_deliverable(id)`, `submit_review(id, decision, comments)`.

Scopes: `tasks:read`, `tasks:claim`, `results:submit`, `reviews:write`, `secrets:request`. Enforce per-tool via `requiredScopes`.

### 3.6 The portable task package (the "agent setup kit")

A signed, versioned bundle the platform delivers to a worker and reconstitutes on their machine. Contents (all existing standards):

1. **Rules** — `constitution.md` (non-negotiables) + `AGENTS.md`, with **`CLAUDE.md` symlinked → `AGENTS.md`** so Claude Code reads it.
2. **Spec chain** — `spec.md → plan.md → tasks.md` (Spec-Kit shape) with the assigned task, dependencies, and a machine-readable **definition of done**.
3. **Skills** — the relevant `SKILL.md` folders to pre-load.
4. **Setup** — `.claude/` (subagents, settings, allowed tools, MCP pointer) + a deterministic env manifest (devcontainer/Nix/scripts) so the agent boots identically anywhere.
5. **Handoff doc** — goal, source of truth, files touched, commands run, verification output, assumptions, blockers, **next safe action** (so resumed work doesn't replay a transcript).
6. **Secret *references*, not values** — broker token endpoints / `op://`-style paths the agent redeems JIT.
7. **Task identity + submit handle** — the MCP `task_id` + the `submit_result` surface, auth-context-bound.

A small **CLI/installer** (`npx <yourtool> pull <task>`) materializes this into a working directory and points Claude Code at the MCP server.

### 3.7 Secrets / env handoff flow (model-blind)

1. Team stores secrets **encrypted in Supabase Vault** (read only via `service_role` RPC).
2. Worker's agent calls `request_secret(task_id, name)` → MCP server checks task scope + membership → issues a **short-lived, task-scoped capability token** (not the secret).
3. At execution, the agent's wrapper (or an MCP tool that performs the privileged action **server-side**) exchanges the token JIT for the credential, uses it, discards it. The model sees only "ok."
4. Every exchange is logged; tokens are audience-bound (RFC 8707); no passthrough. **Infisical Agent Vault** can be the broker if you don't want to build it. **SOPS+age** only for offline packages, where the *human* holds the `age` key.

### 3.8 Presence / "who is working on what"

Supabase Realtime **Presence** per project channel: each worker tracks `{user, task_id, state, last_heartbeat}`. The board subscribes and renders live. Use **Broadcast** for transient events ("result submitted", "review decided"). Gate channel joins with RLS on `realtime.messages` so presence respects tenant boundaries. The `lease_expires_at` on CLAIMED tasks is the *authoritative* lock (presence is the *display*); a Vercel Workflow reaps expired leases back to READY.

### 3.9 "PR-review for any work"

For **code**, `location_ref` is a git branch/PR and `checks` can include CI/tests (optionally run in **Vercel Sandbox**); the reviewer (or their Claude) diffs and decides. For **docs/books/art/research**, `location_ref` is a file/URL and the deliverable carries a **report** (what changed, why, how to verify) plus optional rendered previews; the reviewer's agent reads the artifact + report via `get_deliverable` and posts a decision via `submit_review`. **Same state machine, same audit log, same gate** — the only difference is the artifact adapter and the "checks." This generality is the product.

### 3.10 Teams, invites, public projects, permissions

- **Private team** = an `account` with `memberships`. RLS isolates everything.
- **Invite another team** = `project_invites` granting a second account roles on a project; **WorkOS SSO/SCIM** when you need enterprise onboarding.
- **Public projects** = `visibility = public`: anyone can register, claim READY tasks as a **worker**, and submit; **trusted reviewers** gate `DONE`, optionally with a **quorum** (N approvals) and reputation. Protect public endpoints with **BotID + rate limits**. Subdomain/custom-domain routing via the **Vercel Platforms** pattern.

---

## Part 4 — Build plan / roadmap

Sequenced so each phase ships something usable. The **MVP cut line is after Phase 2.**

**Phase 0 — Foundations (week 1–2).** Stand up Next.js on Vercel + Supabase from Makerkit (or assemble). Get **accounts, memberships, RLS, a private project, and a basic task board** (DRAFT/READY/IN_PROGRESS visible). Embed `org_id`/role in JWT; index tenant columns. No agents yet.

**Phase 1 — MCP handoff loop, code-only (week 3–5).** Add the **MCP server** (`mcp-handler`, `withMcpAuth`, Supabase OAuth as AS). Implement `list_available_tasks / claim_task / get_task / report_progress / submit_result`. Build the **portable-package bundler + `npx … pull` installer** (rules + spec + skills + `.claude/` + handoff doc, secret *references* stubbed). A worker's Claude Code can now claim a task, work, and submit. Tasks move READY → CLAIMED → IN_PROGRESS → IN_REVIEW.

**Phase 2 — Review state machine + presence (week 5–8) → MVP.** Implement the full state machine with the **append-only `task_events`** audit log and transactional guards (incl. worker≠reviewer). Build the **reviewer inbox UI** (Agent Inbox's 4 actions) and the reviewer-side MCP tools so a reviewer's *own* Claude can analyze a deliverable. Wire **Vercel Workflows** for review SLA timers/escalation and lease reaping. Add **Supabase Realtime Presence** for the live "who's working on what" board. **This is a usable private tool for you + friends.**

**Phase 3 — Secret broker (week 8–10).** Add **Supabase Vault** + the **short-lived-token broker** (`request_secret`), or drop in **Infisical Agent Vault**. Now env can be handed over safely.

**Phase 4 — Non-code artifacts + cross-team (week 10–13).** Generalize `deliverable` to `artifact_kind` (doc/book/art/research) with per-kind preview/report adapters — all through the same gate. Add **`project_invites`** for inviting other teams; add **WorkOS** if enterprise SSO is needed.

**Phase 5 — Public projects (week 13+).** `visibility=public`, open worker pool, **reviewer quorum + reputation**, **BotID + WAF rate limits**, **Vercel Sandbox** for untrusted worker code, subdomain routing. Abuse/trust hardening throughout.

---

## Part 5 — Key risks & open decisions

**Risks / watch-items**

- **MCP `Tasks` primitive is experimental** and being moved to an extension — don't hard-depend; own your task state, expose plain tools first.
- **Don't build on orphaned prior art** — vibe-kanban's company shut down, Crystal→Nimbalyst, Terragon dead. Learn from them; don't fork as a foundation.
- **Secrets are the highest-risk surface** — the April 2026 Vercel env-var incident + NSA/CISA MCP guidance both say raw secrets must never reach agent context. The broker is non-negotiable, not a "later."
- **Realtime scaling** — plan around *peak* concurrent connections (Free 200 / Pro 500+); presence floods if you `track()` too often.
- **Untrusted code in public projects** — must run in Vercel Sandbox (or equivalent), never your functions.
- **Vendor lock-in** — Supabase OAuth-for-MCP and Vercel Workflows are both young (beta / GA-2026). Keep the state machine in your own Postgres so you can swap the durability/auth layer.

**Open product decisions (worth settling before Phase 1)**

1. **Worker agent freedom:** require Claude Code specifically, or any AGENTS.md-compatible agent (Codex/Cursor/Gemini)? The standards make "any agent" cheap; Claude-only is simpler to support first.
2. **Token/cost model:** you mentioned handing off when "lacking tokens." Decide **BYO-key per worker** (each person's agent uses their own Anthropic key — simplest, fairest) vs a pooled/credited model.
3. **Build vs buy the secret broker:** Infisical (faster, self-host) vs custom (fewer dependencies).
4. **Identity:** Supabase Auth only, or Supabase + WorkOS from the start if enterprise/cross-team is near-term.
5. **Reviewer trust for public projects:** how reviewers are vetted, quorum size, reputation — design later but reserve the schema now.

---

## Appendix — Resources

**AI coding-agent orchestration & boards**

- [BloopAI/vibe-kanban (GitHub)](https://github.com/BloopAI/vibe-kanban) · [Bloop shutdown post](https://www.vibekanban.com/blog/shutdown) · [Nimbalyst: what happens to vibe-kanban users](https://nimbalyst.com/blog/vibe-kanban-after-bloop-whats-next/)
- [Conductor (conductor.build)](https://www.conductor.build/) · [Docs](https://docs.conductor.build/)
- [smtg-ai/claude-squad (GitHub)](https://github.com/smtg-ai/claude-squad)
- [stravu/crystal (GitHub)](https://github.com/stravu/crystal) · [Nimbalyst](https://nimbalyst.com/) · [Pricing (Team plan in dev)](https://nimbalyst.com/pricing/)
- [Sculptor — Imbue](https://imbue.com/blog/sculptor-announce) · [imbue-ai/sculptor (GitHub)](https://github.com/imbue-ai/sculptor)
- [ruvnet/ruflo (claude-flow) (GitHub)](https://github.com/ruvnet/ruflo)
- [MrLesk/Backlog.md (GitHub)](https://github.com/MrLesk/Backlog.md)
- [Claude Code Agent Teams — official docs](https://code.claude.com/docs/en/agent-teams) · [Shared task list / file locking explainer](https://www.mindstudio.ai/blog/claude-code-agent-teams-shared-task-list)
- [Cursor Cloud Agents 2026 guide](https://www.buildfastwithai.com/blogs/cursor-cloud-agents-development-environments-2026) · [OpenAI Codex Cloud](https://developers.openai.com/codex/cloud) · [Google Jules](https://jules.google/) · [Devin pricing](https://devin.ai/pricing/)

**Spec / task handoff, portable context & MCP**

- [eyaltoledano/claude-task-master (GitHub)](https://github.com/eyaltoledano/claude-task-master)
- [github/spec-kit (GitHub)](https://github.com/github/spec-kit) · [Spec Kit docs](https://github.github.com/spec-kit/) · [Microsoft: spec-driven development with Spec Kit](https://developer.microsoft.com/blog/spec-driven-development-spec-kit)
- [Kiro Specs (docs)](https://kiro.dev/docs/specs/)
- [AGENTS.md (official)](https://agents.md/) · [Symlink AGENTS.md → CLAUDE.md (SSW.Rules)](https://www.ssw.com.au/rules/symlink-agents-to-claude)
- [Anthropic — Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [SKILL.md open standard](https://www.agensi.io/learn/agent-skills-open-standard) · [Claude Code subagents (docs)](https://code.claude.com/docs/en/sub-agents)
- [MCP Tasks specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) · [2026 MCP roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [handoff: move context between agent sessions](https://www.aihero.dev/skills-handoff) · [softaworks session-handoff](https://github.com/softaworks/agent-toolkit/blob/main/skills/session-handoff/README.md)

**Secrets / env handoff & MCP security**

- [Supabase Vault (docs)](https://supabase.com/docs/guides/database/vault) · [supabase/vault (GitHub)](https://github.com/supabase/vault)
- [Infisical — managing secrets in MCP servers](https://infisical.com/blog/managing-secrets-mcp-servers) · [Infisical vs Doppler](https://infisical.com/infisical-vs-doppler)
- [Doppler — MCP credential security best practices](https://www.doppler.com/blog/mcp-server-credential-security-best-practices)
- [HashiCorp — static vs dynamic secrets](https://developer.hashicorp.com/vault/tutorials/get-started/understand-static-dynamic-secrets) · [Why short-lived credentials](https://www.hashicorp.com/en/blog/why-we-need-short-lived-credentials-and-how-to-adopt-them)
- [SOPS (getsops/sops)](https://github.com/getsops/sops)
- [1Password Service Accounts (docs)](https://developer.1password.com/docs/service-accounts/get-started/)
- [Vercel — sensitive environment variables (docs)](https://vercel.com/docs/environment-variables/sensitive-environment-variables) · [Vercel April 2026 incident analysis (GitGuardian)](https://blog.gitguardian.com/vercel-april-2026-incident-non-sensitive-environment-variables-need-investigation-too/)
- [NSA/CISA — MCP Security Design (CSI, 2 Jun 2026, PDF)](https://media.defense.gov/2026/Jun/02/2003943289/-1/-1/0/CSI_MCP_SECURITY.PDF)

**Multi-agent, HITL, review & durable execution**

- [LangGraph interrupts (docs)](https://docs.langchain.com/oss/python/langgraph/interrupts) · [Durable execution (docs)](https://docs.langchain.com/oss/python/langgraph/durable-execution)
- [langchain-ai/agent-inbox (GitHub — HumanInterrupt schema)](https://github.com/langchain-ai/agent-inbox) · [HumanInterrupt reference](https://reference.langchain.com/python/langgraph.prebuilt/interrupt/HumanInterrupt)
- [CrewAI docs](https://docs.crewai.com/)
- [Microsoft Agent Framework 1.0](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/) · [microsoft/agent-framework (GitHub)](https://github.com/microsoft/agent-framework)
- [OpenAI Agents SDK — guardrails & approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
- [humanlayer/humanlayer (GitHub)](https://github.com/humanlayer/humanlayer) · [HumanLayer pivot to CodeLayer (analysis)](https://starlog.is/articles/ai-dev-tools/humanlayer-humanlayer)
- [Temporal — human-in-the-loop AI agent](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)
- [Inngest AgentKit](https://agentkit.inngest.com/concepts/agents)
- [AG-UI protocol (CopilotKit)](https://docs.ag-ui.com/introduction)
- [Approval workflows: a developer's guide (state machine + audit)](https://letmepost.dev/blog/approval-workflows)

**Vercel + Supabase build platform**

- [Vercel — deploy MCP servers](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) · [vercel/mcp-handler (GitHub)](https://github.com/vercel/mcp-handler) · [Authorization doc](https://github.com/vercel/mcp-handler/blob/main/docs/AUTHORIZATION.md) · [Building efficient MCP servers (blog)](https://vercel.com/blog/building-efficient-mcp-servers)
- [Supabase — MCP authentication (docs)](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) · [OAuth 2.1 server (docs)](https://supabase.com/docs/guides/auth/oauth-server) · [OAuth 2.1 feature page](https://supabase.com/features/oauth2-1-server)
- [Supabase — Realtime Presence](https://supabase.com/docs/guides/realtime/presence) · [Broadcast](https://supabase.com/docs/guides/realtime/broadcast) · [Broadcast/Presence authorization (blog)](https://supabase.com/blog/supabase-realtime-broadcast-and-presence-authorization)
- [Makerkit — Next.js Supabase SaaS](https://makerkit.dev/docs/next-supabase-turbo) · [Supabase RLS best practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [vercel/platforms (GitHub)](https://github.com/vercel/platforms) · [Platforms Starter Kit (blog)](https://vercel.com/blog/platforms-starter-kit)
- [Vercel Workflows — durable execution GA (blog)](https://vercel.com/blog/a-new-programming-model-for-durable-execution) · [Workflows (docs)](https://vercel.com/docs/workflows)
- [Vercel Sandbox GA (blog)](https://vercel.com/blog/vercel-sandbox-is-now-generally-available) · [Sandbox (docs)](https://vercel.com/docs/sandbox)
- [Vercel WAF rate limiting (docs)](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) · [BotID (docs)](https://vercel.com/docs/botid)
- [WorkOS AuthKit — MCP (docs)](https://workos.com/docs/authkit/mcp) · [DCR vs CIMD in MCP (WorkOS blog)](https://workos.com/blog/dynamic-client-registration-dcr-mcp-oauth)
- [MCP Authorization spec (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

---

*Research method: four parallel web-research streams (orchestration tools; spec/handoff & MCP; HITL/review/durable execution; Vercel+Supabase) plus independent verification of the load-bearing claims (vibe-kanban shutdown, Vercel Workflows GA, Supabase OAuth-for-MCP). Where a fact drives an architecture decision it is linked above. Treat beta/GA-2026 features (Supabase OAuth server, Vercel Workflows/Queues) as fast-moving — re-confirm at build time.*

