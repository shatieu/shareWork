---
id: ship-vs-the-coworking-platform-vs-getbetter-research-strategic-verdict
---

# Ship vs. the Coworking Platform (vs. getBetter) — Research & Strategic Verdict

**Prepared for:** Ondřej
**Date:** 30 June 2026
**Question on the table:** You now have a second idea ("Ship") that feels close to the first one (the multi-human "Coworking Platform" from the earlier research). Do they stay separate, or bundle into one? What already exists, and what's actually worth building?

> **How to read this:** the brief, non-technical verdict is right below. Everything after Section 1 is the evidence and the detail.

---

## 1. The short version (no technical detail)

You actually have **three** distinct ideas, not two:

- **Ship** — a *single-player* cockpit: help *you* run many Claude Code sessions across many projects, never lose context when you switch computers, keep your docs and their links from going stale, and remember where every project stands.
- **The Coworking Platform** (the earlier doc) — a *multi-player* product: hand work to *other people's* Claudes, with a review/approval gate, teams, and later public projects.
- **getBetter** — a *personal coaching companion* to beat procrastination. Different universe (your psychology, not your code). I'd keep it entirely separate.

**My honest verdict in three sentences.** Don't merge Ship and the Platform into one app, and don't build them as two unrelated codebases either — build **one shared core ("the spine")** and ship **Ship first** as the single-player tool, then grow the Platform as Ship's *multiplayer mode* on that same spine. Ship and the Platform are the **same product at two scales**: the Platform's "worker → reviewer" is literally Ship's "Captain approves Crew," except the crew member is *someone else's* agent. getBetter is a separate product that happens to share one ingredient (a memory-driven "coach") — keep its codebase separate.

**The single most important strategic fact from the research:** Anthropic *already ships* the two headline pieces of Ship — `claude agents` (one window over all your sessions, with reply/approve-on-behalf) and **agent teams** (a lead session that delegates to teammate sessions, with a shared task list and a plan-approval gate). So the parts of Ship that feel most exciting to build — the orchestrator and the multi-session dashboard — are the parts most likely to be **eaten by Anthropic ("sherlocked")**. The parts they are *not* doing, and that you should anchor on, are the **boring durable ones**: persistent cross-project memory, an audit log of who-approved-what, folder-independent document links that don't break across machines, and safe project relocation. Those also happen to be the exact things both Ship *and* the Platform need — i.e., the spine.

**What I'd actually build first (smallest defensible slice):** the **document + reference engine** (your "Chart Room") — folder-independent, ID-backed live links with agent-callable rename/move/delete that fixes every reference automatically — plus a **dual log/memory** (one per-project, one personal-across-projects). Wire it into your own Claude Code over MCP and let it ride on Anthropic's native agent teams. It fixes your three stated pains directly, it's the least likely to be sherlocked, and both bigger products are built on top of it.

---

## 2. The three projects, precisely scoped

| | **Ship** | **Coworking Platform** | **getBetter** |
|---|---|---|---|
| **User mode** | Single developer + *their own* fleet of agents | Multiple people, each with *their own* agents | One person, alone |
| **Core job** | Orchestrate my sessions, remember my projects, keep my setup/docs portable | Hand off & review work *across people* | Beat procrastination, build agency |
| **Trust boundary** | All inside *my* machines/account | *Crosses* people — needs tenancy, secure handoff, RLS | Just me |
| **Shape** | Local-first tool + optional FE, MCP servers | Multi-tenant SaaS (Vercel + Supabase) | PWA, already scaffolded (Next.js/Neon) |
| **"Review" means** | I approve my own Crew | A *different person* reviews before "done" | n/a |
| **Domain** | Dev productivity | Dev (and creative) collaboration | Personal wellbeing |

The tell that Ship and the Platform belong on one spine: **you wrote the same requirement into both** — *"share MD documented projects which have live links not dependent on the local folder structure."* That sentence appears in the Platform brief (as the "portable package") and is the entire premise of Ship's Chart Room. When the same hard primitive shows up in two products, build it once.

getBetter is the odd one out on every axis. Treat it as a separate product. (Its *idea* of a memory-driven coach that nudges you forward could, much later, inform a "First Mate as coach" mode in Ship — but the code and the design philosophy, especially its anti-shame rules, are purpose-built for personal use and shouldn't be entangled with developer tooling.)

---

## 3. What's already out there (Q1)

Researched in five areas. Headline: **the plumbing mostly exists and is consolidating fast; the durable gaps are in persistence, document-link integrity, and cross-machine portability.**

### 3.1 One window over many sessions + an orchestrator that delegates — *mostly solved, by Anthropic itself*

The "one human, many live agent sessions" category reorganized in early 2026 and Anthropic now ships **two native answers** that overlap Ship heavily:

- **`claude agents` (agent view)** = your "Bridge." One screen lists every background session across projects (Needs input / Working / Completed), with a **peek panel that shows the exact pending question and lets you reply or pick an option *without attaching* — i.e., real "approve on behalf."** A supervisor process keeps sessions alive across shell close / sleep.
- **agent teams (experimental)** = your "First Mate + Crew." A **lead** session spawns **teammates** (each with its own context), coordinated by a **shared task list + file-locking + a mailbox**, and a **plan-approval gate** (a teammate waits in read-only plan mode until the lead approves). The lead keeps a lean context — exactly your First Mate.

Third-party tools (Conductor, Vibe Kanban, Claude Squad, Nimbalyst/Crystal, Pane, claude-flow→ruflo) do similar things with nicer review UIs or OSS/self-host, but the category is **churning hard** (Bloop/Vibe-Kanban shut down, Crystal→Nimbalyst, Terragon dead, claude-flow renamed after an Anthropic trademark conversation). 

**What nobody ships — native or third-party:** a **persistent, queryable cross-session memory + an audit log of approvals/interventions** ("who approved what, on whose behalf, when, why"). Native task lists persist, but there is no decision log, and native agent teams **can't even resume teammates** after `/resume`. That hole is Ship's wedge.

### 3.2 Porting your Claude across machines — *a real gap, partially patched by a cottage industry*

Anthropic ships **no native sync** of your Claude Code setup (settings, rules, skills, subagents, MCP config) and **no portable export of session history**. Remote Control (drive your terminal from your phone) and Claude.ai *chat* memory export exist but **don't cover Claude Code**. A crowd of community tools (claude-sync, ccms, claude-repath, the harnez relocation script, etc.) patch it roughly; none is a clean one-click port.

Your two pains are both **confirmed and severe**:
- *Switching computers loses settings* → no cloud sync; DIY dotfiles only.
- *Different folder structure breaks references* → **confirmed and dangerous**: Claude Code keys session history to the project folder's **absolute path**; move or rename the folder and **all sessions silently orphan**, and resuming an orphaned session can **overwrite it with blank history, permanently.** The encoding is lossy and the paths hide in ~7 stores across Claude Code and Codex.

**Defensible slice:** not "copy my settings" (Anthropic may ship cloud sync within a year), but **"relocate a project and keep its history, memory, and references intact, across machines and OSes, without leaking secrets."** That's nontrivial and unowned.

### 3.3 The Scribe + dual log (memory) — *the engine exists; the dual-log product doesn't*

Active memory curation (summarize/prune/promote, not append-only) is **table stakes in 2026**, not novel: Claude Code's own background **AutoDream** sub-agent already does orient→consolidate→prune with an index-plus-pointers design; **Letta** (git-backed memory, sleep-time agents, isolated worktrees) and **basic-memory** (markdown knowledge graph + `memory-reflect`/`memory-defrag`/`memory-lifecycle` skills, MCP-native) are essentially a Scribe you can assemble today. Claude Code even added **per-subagent memory scoped to user *or* project** — the native hook for your two logs.

**What's genuinely under-served:** the **dual-log *semantics*** you described — a *personal, cross-project* Captain's Log (priorities, intent, open threads, preferences) vs an *objective, per-project* Ship's Log (decisions + rationale + architecture) — plus **"on fresh start, pull only the active, relevant subset."** The closest thing in the wild is an *open feature request*, not a product. So: **reuse the curation engine, build only the thin dual-log + relevance-load layer.**

### 3.4 The Chart Room (markdown docs + reference integrity + live links) — *the combination is a real gap; the most defensible piece of Ship*

The pieces are solved in silos: **Obsidian/Foam/Dendron/Logseq** do automatic rename-updates-all-backlinks and folder-independent links (Obsidian by unique basename; Logseq/Dendron by content-addressed IDs), and ship graph views — **but that logic lives in the desktop GUI, not a headless API**, and wikilinks aren't portable to GitHub. **Linters** (lychee, remark-validate-links, markdownlint, Vale) only *detect* broken links and bad naming. **Markdown MCP servers** (obsidian-mcp, basic-memory, engraph) give agents read/write/search — but **almost none expose a rename-with-reference-refactor tool**, and graph views have **no programmatic API**.

**The combination nobody ships:** *(1) agent-callable, deterministic move/rename/delete that rewrites every reference + (2) folder-independent ID-backed links + (3) a reference graph with an API + (4) doc/naming linting* — behind one backend serving both an MCP agent and a human UI. That precise bundle is **not buyable**, it directly kills your stale-reference pain, and it's the **least sherlockable** thing in either project (Anthropic builds coding agents, not a PKM/doc engine).

### 3.5 The multi-human collaboration core (from the earlier doc) — *no turnkey prior art*

Recapping the first report: the **worker→reviewer review gate for *any* kind of work**, **presence/claiming across *people***, **secure spec+env handoff to someone else's machine**, and **teams→invite→public projects** have no single existing product. Build-it territory, on Vercel + Supabase, reusing Supabase Auth/RLS/Realtime/Vault, `mcp-handler`, Vercel Workflows, and Vercel Sandbox.

---

## 4. What's worth building (Q2) — opinionated, tiered

Ranked by *(defensibility × your actual pain × low sherlock-risk)*.

**Tier 1 — Build. These are durable, under-served, and you personally need them.**

1. **The document + reference engine ("Chart Room").** Folder-independent, **ID-backed** live links; **deterministic, agent-callable** move/rename/delete that rewrites every reference and reports what changed; a reference graph with an API; built-in link + naming linting. One backend, two front doors (MCP for agents, UI for you). *This is the crown jewel* — both products need it, it's the least sherlockable, and it directly fixes "different folder structure makes references stale."
2. **The persistence layer: a dual log + a decision/approval changelog.** *Ship's Log* (per-project: status, decisions, rationale, architecture) and *Captain's Log* (personal, cross-project: priorities, open threads, preferences), with relevance-filtered fresh-start loading — **and an append-only audit log of approvals/interventions**. The audit log is the single thing native orchestration and every competitor lack.
3. **Project relocation + reference repair (the defensible half of "port your Claude").** Move/rename a project (or move to a new machine/OS) and keep history, memory, and in-document references intact, without leaking secrets. Builds on the same reference engine as #1.

**Tier 2 — Build *thin*, on top of Anthropic's native primitives. Do NOT reimplement.**

4. **The First Mate / Bridge orchestration**, but only as an opinionated glue layer over `claude agents` + agent teams + your persistence layer — never as your own session-runner/worktree-manager/dashboard. The durable value you add is the *changelog + memory*, not the plumbing.
5. **The Scribe**, assembled from existing curation engines (basic-memory skills, or Claude Code subagent memory + AutoDream-style tricks). Build the *policy and the dual-log wiring*, not the curation algorithm. Make its prune policy treat decisions/rationale as *promote-and-archive, never delete*.

**Tier 3 — Build later: the multiplayer expansion.**

6. **The Coworking Platform** — review-any-work state machine, teams/tenancy, secure secret broker, presence-across-people, public worker/reviewer pools. Defensible but heavy; it should reuse the Tier-1 spine, so it comes *after* the spine exists and you've dogfooded Ship.

**Tier 4 — Keep separate.**

7. **getBetter** — different domain, already scaffolded, ship it on its own.

**Explicitly DON'T build** (high sherlock risk — Anthropic ships or will ship these): a multi-session monitoring dashboard, the orchestrator-delegates-to-workers mechanism, git-worktree isolation, checkpoints/rewind, raw config file-copying. Ride on them.

---

## 5. Merge or separate, and how to scope it (Q3) — the verdict

**Three products, one shared core. Sequence on the core; never build them in parallel, and never fuse Ship and the Platform into a single app.**

```
                         ┌──────────────────────────────────────────┐
                         │            THE SPINE (build once)          │
                         │                                            │
                         │  • Doc + reference engine (Chart Room):    │
                         │    folder-independent ID links, agent-      │
                         │    callable refactor, graph API, linting    │
                         │  • Dual-log memory + decision/approval      │
                         │    audit changelog                          │
                         │  • Portable project package + relocation/   │
                         │    reference-repair                         │
                         │  • MCP backbone (tasks, logs, comms)        │
                         └───────────────┬───────────────┬────────────┘
                                         │               │
                  rides on native        │               │  multi-tenant, crosses people
                  agent teams / agent view│               │
                                         ▼               ▼
                 ┌───────────────────────────┐   ┌────────────────────────────┐
                 │   SHIP  (build FIRST)      │   │  COWORKING PLATFORM (later)│
                 │   single-player cockpit    │   │  multiplayer / SaaS        │
                 │  = spine                    │   │  = spine                    │
                 │  + thin First Mate/Bridge   │   │  + teams/tenancy (RLS)      │
                 │    glue over native teams   │   │  + review-any-work gate     │
                 │  + portability UX           │   │  + secure secret broker     │
                 │  + Chart Room UI            │   │  + presence across people   │
                 │  (local-first + optional FE)│   │  + public worker/reviewer   │
                 └───────────────────────────┘   └────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────────┐
   │  getBetter — SEPARATE product (personal coaching companion). No code shared.│
   └──────────────────────────────────────────────────────────────────────────┘
```

**Why this and not full merge:** the killer risk is scope. Ship alone is four hard subsystems; the Platform is four more; the trust boundaries are fundamentally different (*my machines* vs *strangers*), which forces different architectures (local-first daemon vs multi-tenant cloud). A single app that is simultaneously both will ship neither.

**Why this and not full separation:** Ship and the Platform share their *hardest, most-defensible* primitives — the doc/reference engine, the logs/audit, the portable package, the MCP backbone. Building those twice wastes your effort and guarantees the data models drift apart. And conceptually they're the same machine: a "Crew member" in Ship generalizes to a "worker" in the Platform; "Captain approves Crew" generalizes to "reviewer approves worker."

**Concrete allocation:**
- **Spine (shared library/services):** Chart Room engine, dual-log + audit, portable-package + relocation, MCP servers (your Harbor/Archives/Helm map here).
- **Ship = spine + thin orchestration glue (over native agent teams) + portability UX + Chart Room UI.** Local-first, optional FE.
- **Platform = spine + tenancy/teams + review-any-work state machine + secret broker + cross-person presence + public pools.** Hosted on Vercel + Supabase (per the earlier doc).
- **getBetter = standalone.**

---

## 6. How this fits the earlier research (compatibility)

The first report designed the **Coworking Platform**. Ship is the **single-player foundation that report didn't cover** — and it slots in cleanly:

| Earlier doc (Platform) | Ship equivalent | Relationship |
|---|---|---|
| Portable task **package** (spec+rules+skills+setup+refs) | Ship's "share projects with live links" + portability | **Same artifact** — build in the spine |
| `task_events` **audit log** | Ship's **decision/approval changelog** | Same primitive; Ship needs it single-player too |
| Worker → **Reviewer** → Done state machine | "Captain approves **Crew**" / plan-approval | Same machine; Platform makes the reviewer a *different person* |
| **Presence** across people (Supabase Realtime) | Crew status on the Bridge | Generalize Ship's presence to multi-user |
| Secret **broker** (Vault + short-lived tokens) | Ship's "securely hand over env" | Identical need; Platform adds cross-person trust |
| MCP server on Vercel (`mcp-handler`) | Harbor / Archives / Helm | Same backbone; Ship may run some locally |

So nothing in the earlier doc is wasted — Ship is its **inner loop**, and the Platform is Ship **opened up to other people**. The Vercel + Supabase stack, the MCP-on-Vercel auth model (Supabase OAuth 2.1 server → agents authenticate as a user, RLS applies), Vercel Workflows for durable review waits, and the secret-broker pattern all still stand for the Platform tier.

---

## 7. Honest risks & what I'd do next

**Risks, bluntly:**
- **Scope is the existential threat.** Three products, ~8 hard subsystems, one of you. The classic failure here is building infrastructure forever and never dogfooding. getBetter's own plan nailed the antidote: *"validate the bare loop first."* Apply it to Ship.
- **Sherlock risk on the exciting part.** The orchestrator/dashboard is what's fun to build and what Anthropic is actively eating. Discipline: build *on* agent teams, not a clone of them.
- **Don't run a local-first tool and a multi-tenant SaaS build at the same time.** Pick the single-player spine first.
- **Portability's config-sync half may evaporate** if Anthropic ships cloud sync — anchor portability on relocation/reference-repair, which they're not doing.
- **A note on cost/motivation:** you mentioned handing off work when "low on tokens." Decide the model early — for Ship it's just *your* keys; for the Platform, **BYO-key per worker** is the simplest and fairest.

**Recommended sequence (smallest defensible slices first):**
1. **Spine slice 1 — Chart Room engine + Ship's Log/Captain's Log**, exposed over MCP, used by *your own* Claude Code, riding on native agent teams. Ship it to yourself; fix your stale-reference + lost-context pain this month. (Mirrors getBetter's "prove the bare loop.")
2. **Spine slice 2 — portable package + relocation/reference-repair.** Now you can move projects and machines without breakage.
3. **Ship product — thin First Mate/Bridge glue + the audit changelog + a real UI.** Only after the spine earns its keep daily.
4. **Platform — multiplayer expansion** on the spine (the earlier doc's architecture), once you want friends in.
5. **getBetter — finish independently**, whenever; it's not blocked by any of this.

**One thing to decide before slice 1** (it shapes everything): is Ship **Claude-only** (simpler, but inherits "Claude-only" and competes head-on with first-party) or **agent-agnostic** via AGENTS.md (more defensible vs Anthropic, but more surface and competes with Conductor/Vibe-Kanban)? For a POC, Claude-only is the right call; design the spine's interfaces so agent-agnostic is a later config, not a rewrite.

---

## 8. Resources

**Native multi-session orchestration & sherlock signal**

- [Claude Code — agent view (`claude agents`)](https://code.claude.com/docs/en/agent-view) · [agent teams](https://code.claude.com/docs/en/agent-teams) · [run agents in parallel](https://code.claude.com/docs/en/agents) · [checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Anthropic — enabling Claude Code to work more autonomously](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously) · [multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Conductor](https://www.conductor.build/) · [Nimbalyst (ex-Crystal)](https://nimbalyst.com/) · [Pane](https://github.com/dcouple/Pane) · [ruflo (ex-claude-flow)](https://github.com/ruvnet/ruflo) · [Best multi-agent coding tools 2026 (taxonomy)](https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/)

**Porting / sync across machines**

- [Claude Code — the `.claude` directory](https://code.claude.com/docs/en/claude-directory) · [memory](https://code.claude.com/docs/en/memory) · [settings](https://code.claude.com/docs/en/settings) · [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Issue #41344 — moving a directory breaks all sessions](https://github.com/anthropics/claude-code/issues/41344) · [#38469 — relocatable project folders](https://github.com/anthropics/claude-code/issues/38469) · [#3575 — symlinked settings break permissions](https://github.com/anthropics/claude-code/issues/3575)
- [harnez — fix broken project paths (the 7 stores)](https://harnez.ai/posts/fix-broken-project-paths/) · [claude-sync](https://github.com/tawanorg/claude-sync) · [claude-repath](https://github.com/xPeiPeix/claude-repath) · [chezmoi vs Stow for Claude Code](https://www.hsablonniere.com/dotfiles-claude-code-my-tiny-config-workshop--95d5fr/)

**Agent memory (Scribe + dual-log)**

- [Claude Code memory](https://code.claude.com/docs/en/memory) · [subagents (isolated context)](https://code.claude.com/docs/en/sub-agents) · [memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) · [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [Claude Code AutoDream explained](https://zenvanriel.com/ai-engineer-blog/claude-code-autodream-memory-consolidation-guide/)
- [Letta — Context Repositories (git-based agent memory)](https://www.letta.com/blog/context-repositories/) · [sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime/)
- [basic-memory](https://github.com/basicmachines-co/basic-memory) · [basic-memory-skills (reflect/defrag/lifecycle)](https://github.com/basicmachines-co/basic-memory-skills) · [mem0 — state of agent memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Survey of agent memory frameworks (Graphlit)](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks) · [personal-vs-project memory gap (feature request)](https://github.com/zilliztech/memsearch/issues/337)

**Markdown reference integrity & folder-independent links (Chart Room)**

- [Obsidian — internal links & rename behavior](https://help.obsidian.md/links) · [basename "shortest path" resolution](https://forum.obsidian.md/t/even-with-shortest-path-when-possible-in-link-format-setting-and-unique-filename-path-ob-insertes-full-path-in-links-sometimes/86778) · [graph view has no API](https://forum.obsidian.md/t/graph-rendering-api/73378)
- [Foam](https://github.com/foambubble/foam) · [Dendron refactor + note IDs](https://wiki.dendron.so/notes/srajljj10V2dl19nCSFiC/) · [Logseq block UUIDs](https://discuss.logseq.com/t/what-are-id-links-vs-block-ids-vs-page-ids/1318)
- [lychee](https://github.com/lycheeverse/lychee) · [remark-validate-links](https://github.com/remarkjs/remark-validate-links) · [Vale](https://vale.sh/)
- [cyanheads/obsidian-mcp-server (no rename tool)](https://github.com/cyanheads/obsidian-mcp-server) · [engraph (graph + REST + MCP)](https://github.com/devwhodevs/engraph) · [Penfield verify-and-repair](https://github.com/penfieldlabs/obsidian-wikilink-types/blob/main/prompts/verify-and-repair.md)

*(The earlier report — `Coworking-Platform_Research-and-Architecture.md` — holds the full Vercel + Supabase + MCP architecture for the Platform tier.)*

---

*Method: four parallel web-research streams (native orchestration & sherlock risk; Claude portability/sync; agent memory; markdown reference integrity), each verifying current mid-2026 facts against primary sources, plus a read of the getBetter plan. Opinions are mine and flagged as such; treat experimental/preview features (agent teams, Remote Control, AutoDream) as fast-moving.*

