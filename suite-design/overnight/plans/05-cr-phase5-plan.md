# Package 5 — Chart Room Phase 5: Agent surface polish (MCP server, skill, hook, CLAUDE.md line, llms-txt)

**Team Lead session.** Branch: `ship-wave1-cr-phase-5` (verified checked out, do not switch/create branches).
Status: plan awaiting First Officer approval. **No implementation, no `npm`/`pnpm install`, no stub files beyond
this document, no `git commit`.**

Spec source: `suite-design/ChartRoom_Spec.md` §5 (agent surface, full read), §8 build-order item 5 (authoritative
acceptance line), §6 (staleness — read against §8 items 2 and 5, see §0.1 below), §9 (DoD), §10 (out of scope).
Phase-1 code read in full: `cli.ts`, `resolver.ts`, `index-schema.ts`, `check.ts`, `indexer.ts`,
`install-hook.ts`, `hook.ts`. Phase-2/3 code read: `daemon/server.ts`, `daemon/repo-state.ts`,
`daemon/routes/{repos,docs}.ts`. Phase-4 code read in full: `interactive-blocks.ts`,
`daemon/routes/{doc-ask-me,doc-checkbox,inbox}.ts`, `daemon/repo-state.ts`'s phase-4 extension.
`.claude/skills/ask-human/SKILL.md` read in full (real local skill-authoring convention). `DECISIONS-NEEDED.md`
read in full (all four prior packages' approved decisions and tracked follow-ups). `team-tasks/src/app/api/
[transport]/route.ts` read in full (the repo's one other real MCP server, for local-convention comparison, §1.1
— read-only, never modified). `@modelcontextprotocol/sdk`'s actual installed `.d.ts` files (via
`team-tasks/node_modules/@modelcontextprotocol/sdk`, version **1.26.0** installed / **1.29.0** current on the
live npm registry, checked today) read directly for `McpServer`, `StdioServerTransport`,
`StreamableHTTPServerTransport` shapes — real verified API surface, not recalled from training data (§1.1).
Claude Code's own hooks reference fetched live for the exact `PostToolUse` settings.json schema and stdin/stdout
JSON shapes (§1.4). `llms.txt`'s convention researched live (§1.5). Basic Memory's MCP tool set researched;
exact schemas could not be fetched (404 on the one docs page found) — flagged honestly, not guessed (§1.2).

---

## 0. Scope recap (so approval is against the right bar)

Phase 5 = **agent surface polish only**, per Build Order §8 item 5's literal text: MCP server, `chart-room`
skill, `PostToolUse` hook, CLAUDE.md template line, `llms-txt`. Acceptance (literal): **"a fresh Claude Code
session in a Chart-Room repo resolves a moved doc and answers flow end-to-end without human path-fixing."**

Explicitly **not** phase 5:
- Anything phases 1-4 already built (CLI, viewer, editor, interactive blocks/inbox) — reused verbatim. This
  phase adds a thin agent-facing layer *on top of* existing logic (`resolver.ts`, `index-schema.ts`,
  `interactive-blocks.ts`, `repo-state.ts`) — it does not rebuild, re-derive, or duplicate any of it.
- `team-tasks/` — read once for research (§1.1), never modified.
- Anything from spec §10's out-of-scope list (inline frontmatter fields, multi-user editing, publishing/static
  export, vector search, Ship integration beyond the inbox seam) — already excluded by every prior phase.
- **Staleness-rule growth** (`ttl_days`/`sources:` freshness gates, orphan detection) — see §0.1, a full,
  explicit re-investigation of the ambiguity the task brief called out, not a repeat of phase 2's shrug.

### 0.1 The staleness-scope ambiguity — investigated, not guessed, conclusion: genuine spec gap, not phase 5's job

The task brief asks me to resolve this explicitly rather than pattern-match phase 2's precedent. Here is the
actual textual evidence, read line by line:

- Spec **§6**'s own header literally reads: `## 6. Staleness (phase 2, plugs into existing research)` — its body
  says `chartroom check` should "grow" `ttl_days`/`sources:` freshness gates and orphan detection. This
  sentence, read in isolation, tags the work **phase 2**, not phase 5.
- Spec **§8 item 2** (phase 2's actual Build Order acceptance line): "Viewer (read-only)... Acceptance: browse
  two registered repos in one UI; broken link shows tombstone info." **No mention of `ttl_days`, `sources:`, or
  orphan detection anywhere in this sentence.**
- Spec **§8 item 5** (phase 5's actual Build Order acceptance line, quoted in full in this task's brief above):
  "MCP server, `chart-room` skill, `PostToolUse` hook, CLAUDE.md template, `llms-txt`. Acceptance: a fresh Claude
  Code session in a Chart-Room repo resolves a moved doc and answers flow end-to-end without human
  path-fixing." **Also no mention of `ttl_days`, `sources:`, orphan detection, or "staleness" in any form.**
- Spec **§10** (out of scope for v1) parenthetically tags "staleness dashboard (phase 2)" as excluded from v1 —
  a *second*, independent place the spec's own prose gestures at phase 2 for this topic, while simultaneously
  saying v1 doesn't need to build the dashboard at all.
- Phase 2's own plan (`02-cr-phase2-plan.md` §0/§11 item 3) already found and named exactly this same
  inconsistency for its own phase, read it narrowly (tombstone display only, no `ttl_days`/`sources:`/orphan
  detection), and got that narrow reading **explicitly approved** by the First Officer
  (`DECISIONS-NEEDED.md` "Package 2... plan review," bullet 3: "Approved: phase 2 implements only tombstone
  display... This is a First Officer scope-reading call, not a Captain-level question").

**Conclusion, stated plainly:** I read this as a **genuine spec gap**, not a phase-5 responsibility, and not
something to silently build or silently drop a second time. Walking every Build Order acceptance line in the
spec (items 1 through 5, §8), **staleness-rule-growth (`ttl_days`/`sources:` freshness gates, orphan detection)
is mentioned in prose exactly once (§6's header/body) and tagged, in that same prose, to phase 2 — but it never
appears in *any* literal Build Order acceptance line, including phase 2's own**. This is different from, say,
phase 4's `:::actions` ambiguity (a genuinely *interpretable* sentence where a reading had to be chosen) — this
is a case where the feature was never actually assigned to a Build Order item's acceptance criteria at all,
despite being narratively promised in §6. It is not phase 5's job to inherit an orphaned promise phase 2 was
tagged for and explicitly declined (with sign-off) to build. **I am not building any staleness-rule growth in
this plan** (no `ttl_days`/`sources:` parsing, no orphan detection, no dashboard surfacing them), and I am
flagging this named gap for the Captain in §12 as something the *whole mission*, not just phase 5, should decide
what to do with — most likely candidates being "accept as a deliberately-dropped v1 feature, revisit in a v1.1"
or "assign it explicitly to a phase 6 if the Captain still wants it," neither of which is a call a Team Lead
plan should make unilaterally for a feature that was never actually in this phase's own acceptance line.

---

## 1. Research findings

### 1.1 MCP server — `@modelcontextprotocol/sdk`, verified against its actual installed `.d.ts` files, not recalled

- **Current published version: `1.29.0`** (checked live against the npm registry today, 2026-07-05).
  `team-tasks/node_modules/@modelcontextprotocol/sdk` has **`1.26.0`** installed (a few minor versions behind,
  from `team-tasks/package.json`'s own `^1.26.0` range) — both read directly, not assumed. Recommending
  `^1.29.0` for `chartroom`'s own new dependency (current, not artificially pinned behind `team-tasks`'s
  independent lockfile).
- **High-level API confirmed by reading the installed `.d.ts` directly** (`server/mcp.d.ts`): `McpServer` is the
  class to use (not the lower-level `Server`) — construct once with `new McpServer({name, version})`, register
  tools via `registerTool(name, {title, description, inputSchema, outputSchema?, annotations?}, callback)` (the
  modern, non-deprecated API — the older `.tool(...)` overloads are marked `@deprecated` in the actual shipped
  types), then `.connect(transport)` to attach it to **any** transport. `inputSchema`/`outputSchema` accept a
  Zod raw shape (`ZodRawShapeCompat`) — **`zod` is a new dependency this plan needs to add** (confirmed as an
  actual `dependencies` entry of the SDK itself, `^3.25 || ^4.0`, so `chartroom` needs its own direct `zod`
  dependency to define tool schemas, not just a transitive one).
- **Two transports for the same `McpServer` instance — the spec's own §5 phrasing ("stdio (per-repo) and served
  by the daemon (HTTP)") is confirmed to be exactly this, not a hand-rolled bridge:**
  - `StdioServerTransport` (`server/stdio.d.ts`, confirmed by direct read) — wraps `process.stdin`/`stdout`,
    zero configuration needed beyond `new StdioServerTransport()`. This is what `chartroom mcp` (new hidden CLI
    command, §2) constructs and `.connect()`s to a repo-scoped `McpServer` instance when Claude Code (or any MCP
    client) launches it as a subprocess per its own `.mcp.json`/`claude mcp add` configuration (§6).
  - `StreamableHTTPServerTransport` (`server/streamableHttp.d.ts`, confirmed by direct read) — a **Node-native**
    transport (its doc comment literally says it's "a thin wrapper around
    `WebStandardStreamableHTTPServerTransport`... provides compatibility with Node.js HTTP server
    (IncomingMessage/ServerResponse)"), constructed with `{ sessionIdGenerator: (...) => string | undefined }`
    and driven via `transport.handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown):
    Promise<void>`. **This is the key finding that resolves the spec's own ambiguity:** Fastify's `request.raw`/
    `reply.raw` **are** the underlying Node `IncomingMessage`/`ServerResponse` objects (standard, well-known
    Fastify behavior — not new research needed to confirm this specific fact) — so a new Fastify route
    (`app.all('/api/repos/:repoId/mcp', async (request, reply) => transport.handleRequest(request.raw,
    reply.raw, request.body))`) is a **direct, first-class SDK-supported bridge**, not a hand-rolled
    JSON-RPC-over-HTTP reimplementation. **Decision: one `McpServer` instance's tool definitions, attached to
    two transport instances** — a `StdioServerTransport` for `chartroom mcp` (CLI, single-repo, spawned
    per-session) and a `StreamableHTTPServerTransport` per registered repo mounted into the existing daemon
    (`server.ts`, alongside the existing REST API routes, §2/§7) — exactly the spec's own §5 wording, now backed
    by a concrete, verified mechanism rather than an assumption.
  - **Session mode decision:** `sessionIdGenerator: undefined` (**stateless mode**, confirmed by the SDK's own
    doc comment: "If not provided, session management is disabled"). Chosen over stateful mode because every
    one of this plan's five tools (§3) is a pure, fast, idempotent read (or a read-only status check) with no
    multi-step/long-running server-initiated push needed — stateful mode's benefit (resumable streams, an
    `EventStore` for replay) solves a problem this plan doesn't have, and stateless mode means the HTTP MCP
    route needs zero new in-memory session-tracking state in the daemon, matching the project's consistent
    "don't build machinery nothing asks for yet" posture (phase 2's registry, phase 4's inbox, both cited this
    same discipline in their own plans).
- **`@hono/node-server` and `express` are transitive dependencies of the SDK itself** (confirmed by reading
  `@modelcontextprotocol/sdk`'s own `package.json` directly, inside `team-tasks/node_modules`) — `chartroom`
  needs **only** `@modelcontextprotocol/sdk` and `zod` as new direct dependencies for this; no separate HTTP
  framework glue package.
- **`team-tasks`'s own MCP server (`route.ts`, read in full, never modified) is a different shape, not directly
  reusable, but confirms one important thing:** it uses `mcp-handler` (**`1.1.0`**, verified) — a *Next.js
  App-Router-specific* adapter (`createMcpHandler`, `withMcpAuth`) that wraps the same underlying
  `@modelcontextprotocol/sdk` for a serverless/edge-friendly Next.js route handler, plus its own bearer-token
  auth layer (`access_tokens` table lookup) that has no analogue in Chart Room (local-first, single-user,
  no accounts). **`mcp-handler` is the wrong tool for `chartroom`'s daemon** (it targets Next.js's Request/
  Response Web-standard shape, not a long-running Fastify process) — but it's useful, confirmed evidence that
  **this monorepo already has one working precedent of "the same MCP tool definitions served over HTTP for a
  remote agent to connect to,"** validating that the general shape (one MCP server, HTTP-reachable) is a
  known-good pattern here, just implemented with the framework-appropriate low-level SDK pieces for a Fastify
  process rather than `mcp-handler`'s Next.js-specific wrapper. No auth layer is added for Chart Room's HTTP MCP
  transport (§9 risk #3 — local-first single-user tool, loopback-only daemon, matching every prior phase's own
  "no auth needed, this binds 127.0.0.1 only" posture).

### 1.2 Basic Memory's tool shapes — confirmed to exist, exact schemas NOT confirmed, flagged honestly rather than guessed

A web search confirms Basic Memory (`basicmachines-co/basic-memory`) is a real, actively-documented local MCP
server exposing tools including `read_note`, `search_notes`, `write_note`, `edit_note`, `build_context`,
`recent_activity`, `list_directory`, `list_memory_projects` (per its own GitHub/docs pages' summaries). **I
attempted to fetch its actual MCP-tools-reference page for the literal input/output JSON Schema shapes
(`docs.basicmemory.com/guides/mcp-tools-reference/`) and got a live `404`** — the page either moved or the URL
found via search is stale. I am **not** guessing a schema I could not confirm. What this does support, at the
level of confidence the search results actually provide: Basic Memory's tools are named as verbs over a
markdown-notes domain (`read_note`, `search_notes`) rather than nouns, and are split into pure-read tools vs.
explicit write tools (`write_note`/`edit_note` are named and scoped separately from read tools) — a general
shape, not a literal signature. **Practical conclusion for this plan:** Chart Room's five tool names/shapes are
already dictated verbatim by spec §5 itself (`resolve`, `read_doc(id)`, `search`, `list_unanswered_questions`,
`answer_status(question_id)`) — none of these names exist in Basic Memory's own vocabulary at all (Basic Memory
has no concept of id-resolution, ask-me questions, or answer-status checks — those are Chart-Room-specific
concepts with no Basic-Memory analogue to "mirror"). "Mirror Basic Memory's tool shapes where sensible" is
therefore satisfiable only in the *general* sense already reflected in this plan's design (§3): read-only tools
return structured JSON directly (not a wrapped prose blob), tool descriptions are written for an agent audience
in plain imperative language, and no destructive/mutating tool is exposed via MCP (mirroring Basic Memory's own
read/write tool-naming split by *not* exposing an MCP "answer this question" write tool at all — see §3.5).
**Flagged for the Captain/First Officer in §12**: if literal Basic Memory schema-mirroring is wanted, someone
with working access to `docs.basicmemory.com` (or its GitHub source directly) should fetch the real reference
before the Developer stage — I could not get further than a `404` this session.

### 1.3 `chart-room` skill — real local convention read in full, not invented

`.claude/skills/ask-human/SKILL.md` (read in full, quoted structure): YAML frontmatter (`name`, `description`,
`allowed-tools`), an H1 matching the skill name, a one-paragraph pitch, a "When to use this" section, a
numbered "Steps" section, and a closing "Notes" section (portability, dependency-free claims, cross-references
to a related mechanism in the same repo — ask-human's own Notes section explicitly cross-references
`team-tasks`'s hosted MCP tools as a "when running as a teammate's agent" alternative to the local skill, exact
same kind of cross-reference `chart-room`'s own skill needs for its MCP-vs-CLI-fallback story, §3.6). **Decision:
match this shape exactly** rather than inventing a new one. Unlike `ask-human` (a session-initiated, one-shot
workflow skill: "hand the human a form, wait, read answers"), `chart-room` is an **always-relevant background
behavior** skill — its trigger condition is closer to "any time you're about to Read/Write/link a markdown doc
in a repo that has Chart Room set up" than a one-off command. Content outline (full prose deferred to the
Developer stage, per this Team Lead's own file-write restriction — outline only):
1. **When to use this** — triggers on: the repo has a `.docs/index.json` (checkable via a plain `Read`/`Glob`),
   or its `CLAUDE.md` contains the template line (§5), or the human/task mentions "chart room"/"resolve this
   doc link." Not a one-shot invocation like `/ask-human` — a standing behavioral instruction.
2. **Resolving a dead path** — the exact sequence: try the path as given first (cheap, common case still
   works); on failure, `Read .docs/index.json` directly (zero tooling, matches the spec's own north star) or,
   if the CLI/MCP tools are available, `chartroom resolve <id-or-path>` / the MCP `resolve` tool — three
   equivalent options in decreasing order of "works with nothing installed" to "fastest," explicitly presented
   as options, not a hard requirement to use any specific one (matches spec §1's "every mechanism must work for
   an agent using nothing but Read and Grep... all tooling is acceleration, never a dependency").
3. **Writing links** — always in the `[text](path "id:<id>")` format (§2.2), never a bare path-only link, when
   the target doc is Chart-Room-managed (has a frontmatter `id:`); a short worked example.
4. **`:::llm`/`:::human` conventions** — when authoring a block only agents need, use `:::llm{tldr="..."}`; treat
   any `:::human` block's body as decorative/skippable when reading for token efficiency (an explicit
   instruction to *skip* reading `:::human` bodies closely — the actual token-saving behavior spec §4.2 promises
   but which a viewer-rendering phase alone cannot teach an agent to do; this skill is the first place that
   instruction can actually live).
5. **Posting a question, checking back for an answer** — write a `:::ask-me{id="..." type="..."}` block via a
   normal file edit (no tooling required to *write* one — it's plain markdown); to check whether it's been
   answered later, either re-`Read` the file directly (the `answered="true"` attribute plus the `> **Answer**`
   line are both plain visible text, §4.1 spec) or call the MCP `answer_status(question_id)` tool / `chartroom
   check` if available, again presented as an accelerant, not a requirement.
6. **Notes** — cross-reference to `ask-human` (this repo's other skill) for the "ask a human something with no
   pre-existing doc/directive context" case (a plain multi-question form) versus `chart-room`'s in-doc
   `:::ask-me` blocks for "a question that belongs embedded in a specific doc's own decision record" — these
   are complementary, not redundant, and the skill should say so explicitly (matching `ask-human`'s own Notes
   section's precedent of naming its own relationship to `team-tasks`'s MCP tools).

### 1.4 `PostToolUse` hook — schema fetched live from Claude Code's own docs today, not recalled

Fetched `code.claude.com/docs/en/hooks` directly (§ citation in header). Confirmed, concrete facts:
- **`settings.json` shape:** `{ "hooks": { "PostToolUse": [ { "matcher": "Read", "hooks": [ { "type": "command",
  "command": "<path>" } ] } ] } }`. `matcher` filters on `tool_name`; `"Read"` for an exact match (this project
  only ever wants to react to `Read`, never `Write`/`Edit`/others).
- **stdin JSON to the hook script:** includes `tool_name`, `tool_input` (`{ file_path: string }` for `Read`),
  `tool_response`. **Critical, load-bearing fact confirmed by the fetch:** on a failed `Read` (file not found),
  `tool_response` is **a plain string containing an error message** — there is **no separate `isError`/
  `error_state` boolean field** to branch on. The hook must detect failure by string-shape heuristics against
  `tool_response` (§4), not a structured error flag.
- **The exact wording of that error string for a real missing-file `Read` in this actual Claude Code build was
  NOT independently reproduced this session** (this is a planning-only session with no ability to trigger a
  live failing `Read` and inspect the raw hook stdin payload) — the fetched docs page's own example
  (`"Error: file not found"`) is presented as illustrative, not necessarily the literal production string.
  **Flagged explicitly, same spirit as phase 3's Milkdown-API spike precedent**: the Developer stage's first
  step for this hook must be an empirical spike — actually trigger a failing `Read` of a nonexistent `.md` path
  in a real Claude Code session and capture the *actual* `tool_response` string shape from a real hook
  invocation (e.g. a hook script that dumps its raw stdin to a temp file) — **before** writing the "real"
  detection heuristic, rather than hard-coding a guessed substring match and discovering it never fires.
- **What a `PostToolUse` hook can hand back, confirmed field-by-field:** top-level `decision: "block"` hides the
  tool's result from Claude entirely (requires exit `0`); `hookSpecificOutput.additionalContext` (a string)
  injects a system-reminder-style note into Claude's context **without** hiding the original tool result;
  `hookSpecificOutput.updatedToolOutput` replaces the tool's result outright. **`PostToolUse` cannot block the
  tool call itself** (it already ran) — confirmed directly from the docs' own exit-code table ("PostToolUse: no
  [blocking]... the tool already ran"); exit code `2` behaves identically to exit code `1` for this specific
  event (both are "non-blocking error" — only `PreToolUse`/`Stop`-family events get real blocking semantics
  from exit `2`).
- **Decision: use `additionalContext` only, never `decision: "block"`, for this hook.** Reasoning: Claude already
  sees the real (if unhelpfully-worded) error string from the failed `Read` regardless of what this hook does —
  additively layering a resolve-guidance note next to that real error preserves more information than hiding it
  behind a `block` and replacing it with a synthetic message would. This also matches the project's own
  standing "never silent, always additive" tombstone philosophy (spec §2.3: "never a silent 404") applied one
  level up the stack, to the hook layer rather than just the index/resolver layer.
- **Detection heuristic (to be finalized empirically per the flag above), sketched now for planning purposes:**
  fire only when `tool_name === "Read"`, `tool_input.file_path` ends in `.md`, and `tool_response` (a string)
  matches a small, conservative allowlist of known Claude-Code error phrasings (e.g. containing `"not found"`/
  `"does not exist"`/`"ENOENT"`, case-insensitively) **and** does not look like plausible real markdown content
  (a defensive floor: a real doc's content beginning with one of those phrases as prose is a vanishingly
  unlikely false positive, but the check should stay conservative and degrade to doing nothing rather than
  ever misfire on a successful Read whose content happens to contain the word "error").
- **How the hook actually resolves, once it fires** — two designs considered:
  1. **Spec-literal, static-text version:** the hook just emits a fixed `additionalContext` string ("path not
     found — resolve via `.docs/index.json` / `chartroom resolve`"), per spec §5's own literal wording. Zero
     risk, zero new failure surface, but leaves the actual resolving work to Claude's next turn.
  2. **Stronger, recommended version:** the hook script (Node, no framework — same posture as phase 1's
     `hook.ts`) **actually calls the resolution logic itself** — shell out to `chartroom resolve <basename-or-
     best-guess-path> --json` (subprocess, not an in-process `import()` — see next bullet for why) — and, if it
     resolves, includes the concrete corrected path/id directly in `additionalContext` ("this file may have
     moved; the doc `<title>` is now at `<path>` (id: `<id>`) — try reading that instead"), making the
     correction closer to instant rather than making Claude perform a second round of tool calls to look it up
     itself. **Decision: implement version 2, recommend it, but flag it in §12** — it's a real, if small,
     escalation past spec §5's literal wording ("reply... resolve via .docs/index.json / chartroom resolve" —
     phrased as *pointing Claude at* the mechanism, not necessarily *invoking* the mechanism *for* Claude) —
     worth a quick nod before the Developer stage builds the richer version, since reverting to the simpler
     static-text version is trivial if preferred.
- **Subprocess, not in-process `import()`, and why this is different from phase 1's pre-commit hook:** phase
  1's `install-hook.ts` (§9.4 of its own plan) deliberately chose in-process `import()` over a subprocess *for
  the git pre-commit hook specifically* to avoid PATH/npx resolution uncertainty **at commit time**, a
  latency-and-reliability-sensitive path that fires on every single commit. A `PostToolUse` hook firing only on
  a *failed* `Read` of an `.md` path is a rare event by construction (most Reads succeed) — the few-hundred-ms
  overhead of spawning `npx chartroom resolve` as a real subprocess is immaterial here, and a subprocess call is
  simpler to reason about, gracefully degradable (if `chartroom`/`npx` isn't resolvable on this machine at all,
  the subprocess just fails silently and the hook falls back to emitting nothing — never blocking, never
  crashing the session), and doesn't require the hook script to know an absolute `dist/hook.js`-style path the
  way the git-hook shim does. This is a deliberate, reasoned deviation from phase 1's own precedent, not an
  inconsistency — flagged as such for the Reviewer.
- **Installation mechanism:** a new CLI command, `chartroom install-agent-hook` (mirroring `chartroom init`'s
  existing `installHook()` pattern for the *git* hook, §7.4 of phase 1's plan, but targeting `.claude/
  settings.json` instead of `.git/hooks/pre-commit`) — merges a `PostToolUse`/`Read` entry into the adopting
  repo's `.claude/settings.json` (creating the file if absent; if a `PostToolUse` array already exists for
  other matchers, appends rather than clobbers — same "never clobber, always merge/append" discipline phase 1's
  git-hook installer already established for a *different* hook file, reused as a design pattern here) and
  writes the actual hook script to `.claude/hooks/chartroom-post-tool-use.mjs` (a small, standalone,
  dependency-free Node script — it only needs `node:child_process` to shell out to `chartroom resolve`, nothing
  else).

### 1.5 `llms.txt` convention — researched live, confirmed shape, one deliberate reading choice flagged

Live search confirms `llms.txt` (proposed by Jeremy Howard, 2024, `llmstxt.org`) is a plain-Markdown file:
H1 (project/site name) → blockquote one-line summary → optional detail paragraphs → H2-headed sections of
bullet-point links, each `- [Title](URL): short description`. The "most common 2026 pattern" per the search is
`llms.txt` (index) + `llms-full.txt` (full-text dump) as a pair. **One deliberate reading choice, flagged rather
than silently assumed:** the convention as popularly documented targets a *hosted website* (URLs resolving over
HTTP, meant for a public site's root). Chart Room manages a **local git repo's** markdown docs, not a hosted
site — there is no canonical public URL per doc in the general case. **Decision: `chartroom llms-txt` emits
repo-relative markdown paths as the link targets** (`- [Title](suite-design/ChartRoom_Spec.md)`), the pragmatic
local-repo reading of the same convention (an agent or tool consuming this file locally can resolve a relative
path directly; the convention's *spirit* — "a curated, structured index of what's here and why" — is preserved
even though the *literal* "public URL" framing doesn't apply to a private local repo). Only `llms.txt` is built
(single index file), not a companion `llms-full.txt` — the spec's own §5 line calls it a "bonus" feature ("emits
an `llms.txt` from the index for free"), and a full-text dump duplicating every doc's entire body into one giant
file is a meaningfully bigger, unasked-for feature, not a natural "for free" extension of the index the way the
index-only file is. Flagged for confirmation in §12 (cheap either way, cheap to add `llms-full.txt` later if
wanted).

---

## 2. Package/file placement

No new workspace package — matches phases 3/4's precedent (additive within the two existing packages). Phase 5
touches **only `packages/chartroom`** (the daemon + CLI package) — `packages/chartroom-ui` (the browser viewer/
editor) has **no phase-5 changes at all**: MCP/skill/hook/CLAUDE.md/llms-txt are all agent-facing, not
browser-facing, surfaces. This is the first phase since phase 2 that adds nothing to `chartroom-ui` — worth
noting explicitly since every phase 2-4 plan touched both packages.

- **`packages/chartroom/src/mcp/`** (new directory): `server.ts` (builds one `McpServer` instance with all five
  tools, parameterized by a repo-scope accessor — see §3.7 for why the same tool-registration code serves both
  the stdio-per-repo and HTTP-per-registered-repo cases), `tools.ts` (the five tool implementations as plain,
  independently unit-testable functions the `McpServer` registration wires up thinly, mirroring the project's
  consistent "thin route/registration layer over a pure, testable function" split — `check.ts`/`resolver.ts`
  are the same shape one layer down).
- **`packages/chartroom/src/commands/mcp.ts`** (new): `chartroom mcp` — builds a single-repo `McpServer`,
  connects a `StdioServerTransport`, never exits until the client closes stdin (long-running foreground
  process, exactly like every other MCP stdio server).
- **`packages/chartroom/src/daemon/routes/mcp.ts`** (new): mounts the HTTP MCP transport per registered repo at
  `/api/repos/:repoId/mcp`, reusing the same `tools.ts` functions against that repo's already-live
  `RepoRuntime`/`RepoState` (§3.7) — no new re-parsing, same "reuse the daemon's already-computed state" pattern
  `inbox.ts`/`docs.ts` already established.
- **`packages/chartroom/src/llms-txt.ts`** (new): pure function `buildLlmsTxt(repoRoot, index): string` (§5).
- **`packages/chartroom/src/commands/llms-txt.ts`** (new): `chartroom llms-txt [--out <path>]` CLI wrapper.
- **`packages/chartroom/src/install-agent-hook.ts`** (new): writes/merges `.claude/settings.json`'s
  `PostToolUse` entry + the hook script file (§1.4/§4).
- **`packages/chartroom/skill-template/chart-room/SKILL.md`** (new, *templated content shipped inside the
  package*, not installed anywhere by default): the actual skill file content (§1.3), copied into an adopting
  repo's own `.claude/skills/chart-room/` by a new `chartroom install-skill` command (§6) — **not** written
  directly into *this* monorepo's own `.claude/skills/` by this plan (see §6's explicit reasoning for why
  dogfooding onto `shareWork` itself is treated as a separate, flagged decision, not an automatic side effect of
  building the feature).
- **`packages/chartroom/src/commands/install-skill.ts`** (new): `chartroom install-skill` — copies the
  packaged skill template into the target repo's `.claude/skills/chart-room/SKILL.md` (creates the directory,
  refuses to silently overwrite a differently-authored file already at that path — same "refuse to clobber,
  print instructions" discipline as phase 1's git-hook installer, reused as a pattern).
- **`.mcp.json`** (template snippet, documented in the skill/README, not force-written by any command this
  plan builds — see §6's reasoning: registering an MCP server in a specific consuming repo's `.mcp.json` is a
  per-repo, human-reviewable config choice, not something a CLI command should silently mutate the way a
  gitignored index file can be).

No files are created by this Team Lead session — this table (fully repeated with purposes in §7) is the
Developer stage's shopping list, same convention as phases 1-4's own plans.

---

## 3. The five MCP tools — design

All five share one repo-scoping convention: **the stdio transport (`chartroom mcp`) is always single-repo,
scoped to the cwd's git root at process start** (matching every other phase-1 CLI command's own "cwd-scoped,
nearest ancestor `.git`" convention, reused verbatim, no new discovery logic) — none of the five tools take a
`repoId` parameter over stdio. **The HTTP transport (`/api/repos/:repoId/mcp`) is scoped by the URL's own
`:repoId` segment**, exactly like every existing REST API route — the same `tools.ts` functions are called
either way, just handed a different `RepoState`-shaped accessor (§3.7).

### 3.1 `resolve(query: string)`

Thin wrapper over `resolver.ts::resolve(index, query)` (phase 1, unmodified, imported directly — `chartroom`'s
own package, no cross-package export concern here since this is all within one package). **Freshness:** the
HTTP-transport path reads the daemon's already-live, chokidar-kept-fresh `RepoState.index` (zero extra work,
same reuse pattern as every phase-2+ REST route); the stdio-transport path (no daemon necessarily running)
calls `runCheck(repoRoot)` (phase 1's `check.ts`, already does a full fresh rebuild + write-back as a side
effect, the same "always-fresh" rule every CLI command already follows) once per tool invocation — cheap for a
single repo, matches `chartroom resolve`'s own CLI behavior exactly, so the MCP tool and the CLI command give
identical answers by construction (they call the same underlying `resolve()` against an equally-fresh index).
Returns the `ResolveResult` union verbatim (JSON) — no reshaping, so `matchType: 'tombstone'`/`'not-found'`/
`'fuzzy'` (with `guess: true`) are all visible to the calling agent exactly as the CLI's own `--json` output
already presents them (one shared vocabulary across CLI, MCP, and the raw index — the spec's own north star).

### 3.2 `read_doc(id: string)`

Resolves `id` against `index.docs[id]` (id lookup only — **not** the full 5-step resolver; an agent calling
`read_doc` is expected to already have a specific id, typically from a prior `resolve` or `search` call or from
reading a link's own `title="id:..."` attribute directly). Returns `{ id, path, title, headings, raw }` — `raw`
is the file's current full text (`readFileSync`, same "already-known-safe, inside-repoRoot path from the index"
non-traversal-risk reasoning `docs.ts`'s existing REST route already relies on, §4.1 of phase 2's plan). If the
id is not found in `docs` but is a tombstone, returns the tombstone shape (`{ matchType: 'tombstone', lastPath,
deletedAt }`) rather than an MCP tool error — consistent with the whole project's "never a silent 404, always a
structured answer" philosophy applied at the MCP layer too. If the id is neither a live doc nor a tombstone,
returns `{ matchType: 'not-found' }` (again, a structured result, not a thrown MCP error — an agent should be
able to branch on this in its own tool-use turn rather than parse an error string).

### 3.3 `search(query: string, limit?: number)`

**Design, justified:** no full-text/content search — reuses and extends `resolver.ts`'s already-existing,
already-tested Dice-coefficient token-overlap heuristic (§6.1 step 4 of phase 1's own plan), scored against
**both** a doc's `title` **and** its `headings[]` array (both already present in `index.docs[id]`, zero new
index fields needed), returning the top `limit` (default 10) docs by combined score, each as
`{ id, path, title, score }`. This is a genuine, deliberate scope decision, not a placeholder: Chart Room's own
design north star (spec §1: "every mechanism must work for an agent using nothing but Read and Grep... all
tooling is acceleration, never a dependency") already gives an agent a first-class, zero-setup way to search
full document *bodies* — literal `Grep`. An MCP `search` tool that also indexed and searched raw content would
be a second, redundant full-text engine (real complexity: it would need its own tokenizer/ranking over
potentially large bodies, not the existing constant-time title/heading lookup) duplicating what `Grep` already
does for free, for the specific, narrower job **this** tool is actually suited to: "help me find the *right
doc* by topic/title when I don't already know its id" — a **discovery** aid over the index's own already-small,
already-in-memory metadata, not a **content** search engine. Flagged in §12 as a scope call, cheap to extend
later (headings/title-only search is a strict subset of a hypothetical future body-search tool, no redesign
needed to add one later).

### 3.4 `list_unanswered_questions()`

Scoped to **`:::ask-me` questions only**, not `:::actions` checklist items — a deliberate reading of the spec's
own tool name and its sibling tool's signature (`answer_status(question_id)` — singular "question," matching
the ask-me vocabulary exactly; `:::actions` items are never called "questions" anywhere in spec §4.3, and have
no per-item "answer," only a checked/unchecked boolean, a structurally different shape from an ask-me answer).
Thin wrapper reusing phase 4's own `interactiveBlocks`/`extractInteractiveBlocks` machinery, filtered to a
single repo's own docs (stdio: builds this by calling `extractInteractiveBlocks` against each doc it reads
itself, same cost profile as `repo-state.ts::rebuild()`'s own per-doc loop, phase 4 §3.4, reused as a pattern;
HTTP: reads the daemon's already-computed `RepoState.interactiveBlocks` directly, zero extra parsing, same
reuse `inbox.ts` already established). Returns `{ docId, docPath, directiveId, prompt, type }[]` — the same
shape `inbox.ts`'s own `askMe`-kind items already carry, minus the multi-repo `repoId`/`repoName` fields (single-
repo scope makes those redundant here). **Deliberately not** also surfacing `:::actions` items under this tool
name — an agent wanting those already has the browser inbox (phase 4) or could Read/Grep for `:::actions`
directives directly; adding a second, differently-shaped item kind under a tool literally named
"...*questions*" would be a naming/shape mismatch worth avoiding, not a missing feature (flagged in §12 for a
quick confirm, trivial to add a sixth tool later if actually wanted).

### 3.5 `answer_status(question_id: string)`

**Read-only, by design — this is a status *check*, never an answer-*submission* tool.** Locates the `:::ask-me`
directive with `directiveId === question_id` across the repo's docs (single match expected; if 2+ docs
independently reuse the same author-chosen directive id — a real possibility since ask-me ids are hand-authored
strings, not globally unique index keys — returns an explicit `{ matchType: 'ambiguous', matches: [...] }`
result rather than guessing which one the caller meant, mirroring phase 4's own `doc-ask-me.ts` route's already-
established "fail loudly, don't guess" precedent for exactly this same ambiguity). Returns
`{ matchType: 'found', answered: boolean, answerText?: string, docId, docPath }` or
`{ matchType: 'not-found' }`. **No MCP tool exists to *submit* an answer** — deliberately, matching spec §5's
own five-tool list exactly as written (there is no sixth "submit_answer" tool named anywhere in the spec) and
matching the spec's own described flow ("post questions as `ask-me` blocks and check back... for in-doc
answers" — the *posting* is a plain file edit an agent already knows how to do with `Write`/`Edit`, no new tool
needed; *answering* is explicitly a human-in-the-browser action per spec §4.1, never an agent action). This is
also the same read/write split Basic Memory's own tool naming convention suggests (§1.2) — read tools are
exposed over MCP, the one write action in this whole flow (a human clicking submit in the browser, phase 4's
existing `PATCH .../ask-me` route) is deliberately **not** duplicated as an agent-triggerable MCP tool, since an
agent submitting its own answer to its own question would defeat the entire "human answers, in-doc, in the
browser" point of the feature.

### 3.6 What "resolves a moved doc... without human path-fixing" means for these five tools together

The acceptance line's mechanism, concretely, tool by tool: an agent given a now-stale relative path first tries
a normal `Read` (fails, triggers the `PostToolUse` hook's `additionalContext` nudge, §1.4/§4) — or, if it
already knows to check the id-based system per the skill (§1.3), calls `resolve(<id-or-old-path>)` directly,
gets back `{ matchType: 'id', path: '<new-path>' }`, and re-`Read`s the corrected path — all **without** a human
manually telling it where the file went. The "answers flow end-to-end" half: the agent posts a `:::ask-me` block
via a plain file edit, a human answers in the browser (phase 4, unmodified), and the agent later calls
`answer_status(question_id)` (or just re-`Read`s the file) to see `answered: true` plus the recorded answer text
— again, no human relaying the answer back to the agent out-of-band. §9 discusses honestly what can and can't
be automated-proof of this specific sentence.

### 3.7 One shared tool-implementation layer, two thin registration call sites — avoiding a fork

`tools.ts`'s five functions are written against a small, local interface (`ToolRepoContext`:
`{ getIndex(): ChartRoomIndex; getInteractiveBlocks(): Record<string, InteractiveBlocks>; readDocRaw(path):
string }`) rather than directly against either `RepoRuntime` (the daemon's own type, phase 2) or a bespoke
stdio-only rebuild function. `src/commands/mcp.ts` (stdio) constructs a `ToolRepoContext` whose three methods
call `runCheck`/`extractInteractiveBlocks`/`readFileSync` freshly (cwd-scoped, matching every CLI command's own
"always-fresh" rule, §6.3 of phase 1's plan); `src/daemon/routes/mcp.ts` (HTTP) constructs one whose three
methods just read the already-live `RepoRuntime.getState()` fields directly (zero extra work, matching every
existing REST route's own reuse pattern). **This is the single design decision that keeps `tools.ts` a single,
independently unit-testable module** (fixture-driven tests against a hand-built `ToolRepoContext`, no daemon or
git repo needed at all for the bulk of the tool-logic test suite, §8.1) **rather than two parallel
implementations that could silently drift** — the same "one shared pure module, two thin call sites" shape
phase 2's `check.ts`-reuse and phase 4's `interactive-blocks.ts`-reuse both already established as this
project's standing convention.

---

## 4. The `PostToolUse` hook — concrete design

Covered in research depth at §1.4. Summary of the concrete mechanism:

1. **Detection** (in `.claude/hooks/chartroom-post-tool-use.mjs`, a standalone Node script, zero npm
   dependencies — reads its own stdin as one JSON blob, same "no framework" posture as every other hook-shaped
   mechanism this project has built): fire only on `tool_name === 'Read'`, `tool_input.file_path` ending in
   `.md`, and `tool_response` (a string) matching a small, conservative not-found-phrasing allowlist (§1.4) —
   **this allowlist must be empirically verified against a real triggered failure at the start of the Developer
   stage**, not shipped as a guess (§1.4's flag, restated here as a hard requirement, not a nice-to-have).
2. **Resolution attempt:** shell out (`node:child_process.execFileSync`, or async `execFile` — a design detail
   for the Developer stage, not a Team-Lead-level call) to `chartroom resolve <candidate> --json`, where
   `<candidate>` is derived from `tool_input.file_path` (basename, and/or made repo-relative if it's absolute
   and inside the repo root — the exact derivation is a small, testable pure function, `deriveResolveCandidate
   (filePath, repoRoot)`, unit-tested independently of the hook's stdin-plumbing/subprocess-spawning parts).
3. **Graceful degradation, every step:** if `chartroom` isn't resolvable at all (not installed, not on PATH, not
   a chartroom-managed repo), the subprocess call fails — caught, and the hook exits `0` with **no** output at
   all (a truly silent no-op, never surfacing a hook-internal error to the user/agent) rather than ever risking
   breaking or noisily interrupting an unrelated session. This mirrors the whole project's standing "tooling is
   acceleration, never a dependency, and never allowed to make things worse than doing nothing" ethos (spec §1)
   applied at the hook layer.
4. **Output, on a successful resolve:** exit `0` with
   `{ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '<guidance text>' } }` on stdout —
   never `decision: 'block'` (§1.4's reasoning). The guidance text includes the resolved path/id when the
   spike-informed "stronger" design (§1.4) is built, or the spec's literal static text otherwise (§12 decision
   point).
5. **Installation:** `chartroom install-agent-hook` (new CLI command) writes the hook script file and merges
   the `settings.json` `PostToolUse` entry, refusing to silently clobber an unrelated existing `PostToolUse`
   entry for a different matcher (appends to the array instead) — same non-destructive-merge discipline as
   phase 1's git-hook installer, applied to a JSON config file instead of a shell script this time.

---

## 5. CLAUDE.md template line

A short, concrete snippet a repo adopting Chart Room would add to its own `CLAUDE.md` (final exact wording is a
Developer-stage copy-editing detail, not a Team-Lead-level design decision, but the shape/content it must convey
is fixed here):

```markdown
## Chart Room (managed markdown docs)

This repo's markdown docs are managed by Chart Room. Doc links carry a hidden `id:` (see the link's
title attribute, `"id:<id>"`) that survives moves/renames — if a linked path 404s, don't ask the human where
it went: read `.docs/index.json` directly, or run `chartroom resolve <id-or-path>`. See the `chart-room` skill
for the full workflow (id-based links, `:::llm`/`:::human` blocks, `:::ask-me` questions).
```

This is deliberately short (the skill carries the full workflow detail, §1.3) — CLAUDE.md's own job here is just
the "don't panic on a 404, here's where to look" pointer, matching this repo's own root-`CLAUDE.md`-equivalent
convention of pointing at skills rather than duplicating their content inline.

---

## 6. `chartroom install-skill` / dogfooding decision — flagged explicitly, not assumed

A real, non-obvious question this plan surfaced during research (§1.3's file-placement note): **should this
phase also install the finished skill/hook/`.mcp.json` config into `shareWork`'s own `.claude/` and run
`chartroom init` for real against `suite-design/`'s own docs**, so the acceptance line can be demonstrated live
in *this* monorepo rather than only in a disposable scratch repo? Investigated, not guessed:

- **Confirmed by direct inspection this session:** `shareWork` has **no** `.docs/index.json` anywhere yet, no
  installed git pre-commit hook, and `suite-design/ChartRoom_Spec.md` itself carries no frontmatter `id:` — i.e.
  **Chart Room has never actually been dogfooded on this monorepo's own docs, through all four prior phases.**
  Every acceptance script across phases 1-4 (correctly, per each phase's own plan) operates entirely inside
  disposable `fs.mkdtempSync` scratch repos, never the real `shareWork` tree.
- **Decision for this plan: do not make dogfooding-onto-`shareWork` an automatic side effect of building phase
  5.** Running `chartroom init` against the real `suite-design/` tree is a real, visible, repo-wide mutation
  (injecting `id:` frontmatter into every existing spec doc, installing a real git hook, modifying real
  `.claude/settings.json`/`skills/` content) — exactly the kind of "never silently commit/mutate the real repo"
  boundary every prior phase's plan has been careful to respect (acceptance scripts always use scratch repos;
  §11 of the phase-4 plan is explicit that "nothing found this session needing removal... this plan is
  additive... to phases 1-3's merged code," i.e. even *additive* changes to real files get named, not just
  destructive ones). **This is a decision above a Team Lead's remit, not a guess I'm resolving myself** — flagged
  in §12 for the Captain: dogfooding Chart Room onto `shareWork`'s own `suite-design/` docs would make the
  acceptance line's "fresh Claude Code session in a Chart-Room repo" demonstrable *in this actual repo*, which
  is arguably the most convincing possible proof — but it's also a one-way, repo-wide door (once `chartroom
  init` assigns ids and a hook is installed here, that's a real, permanent change to how this repo's own docs
  are versioned) that shouldn't be taken as a side effect of a CLI-feature-building phase without explicit
  sign-off.
- **What this plan does instead:** `chartroom install-skill` and `chartroom install-agent-hook` are built as
  **general-purpose commands any adopting repo can run**, and this phase's own acceptance script (§9) exercises
  them against a **disposable scratch repo**, exactly matching every prior phase's own discipline. If the
  Captain wants `shareWork` itself dogfooded, that's a one-line follow-up command invocation *after* this
  phase's code is reviewed/merged, not something baked into the plan's own file list.

---

## 7. Files to create/modify

### `packages/chartroom` (existing package)

| Path | Change | Purpose |
|---|---|---|
| `src/mcp/tools.ts` | new | Five pure, testable tool-implementation functions against a small `ToolRepoContext` interface (§3.7) |
| `src/mcp/server.ts` | new | Builds one `McpServer` (name/version, five `registerTool` calls delegating to `tools.ts`) given a `ToolRepoContext` factory |
| `src/mcp/repo-context.ts` | new | `ToolRepoContext` interface + the two concrete constructors (stdio: fresh-rebuild-per-call; HTTP: reads live `RepoRuntime` state) — §3.7 |
| `src/commands/mcp.ts` | new | `chartroom mcp` — stdio transport, single cwd-scoped repo |
| `src/daemon/routes/mcp.ts` | new | `ALL /api/repos/:repoId/mcp` — `StreamableHTTPServerTransport`, stateless mode, wired per registered repo |
| `src/daemon/server.ts` | modify | register the new MCP route module alongside existing route registrations (additive) |
| `src/llms-txt.ts` | new | `buildLlmsTxt(repoRoot, index): string` pure function (§1.5) |
| `src/commands/llms-txt.ts` | new | `chartroom llms-txt [--out <path>]` |
| `src/install-agent-hook.ts` | new | Merge/write `.claude/settings.json`'s `PostToolUse` entry + hook script file (§4) |
| `src/commands/install-agent-hook.ts` | new | `chartroom install-agent-hook` CLI wrapper |
| `src/install-skill.ts` | new | Copy the packaged skill template into a target repo's `.claude/skills/chart-room/SKILL.md`, refuse-to-clobber semantics (§6) |
| `src/commands/install-skill.ts` | new | `chartroom install-skill` CLI wrapper |
| `skill-template/chart-room/SKILL.md` | new | The actual skill content (§1.3 outline; full prose written at Developer stage) |
| `hook-template/chartroom-post-tool-use.mjs` | new | The hook script template `install-agent-hook.ts` copies into a target repo's `.claude/hooks/` (§4) |
| `src/cli.ts` | modify | wire the four new subcommands (`mcp`, `llms-txt`, `install-agent-hook`, `install-skill`) into the existing `commander` program, additive |
| `package.json` | modify | add `@modelcontextprotocol/sdk` (^1.29.0), `zod` (^3.25 or ^4.0, matching the SDK's own peer range) as runtime deps (§9) |
| `test/mcp/tools.test.ts` | new | Unit tests for all five tools against hand-built `ToolRepoContext` fixtures (no filesystem/daemon needed) |
| `test/mcp/repo-context.test.ts` | new | Both constructors, against a scratch git repo (stdio path) and a mocked `RepoRuntime` (HTTP path) |
| `test/daemon/mcp-route.test.ts` | new | `.inject()`-driven real MCP-protocol round trip (a real `Client` from the SDK, connected over the daemon's own HTTP route via `.inject()`'s underlying transport or a real ephemeral `.listen()` — see §8.2 for exactly which) |
| `test/llms-txt.test.ts` | new | Fixture index → exact expected `llms.txt` content |
| `test/install-agent-hook.test.ts` | new | Fresh install, merge-into-existing-`PostToolUse`-array, refuse-to-clobber-unrelated-content cases |
| `test/install-skill.test.ts` | new | Fresh install, refuse-to-clobber cases |
| `test/hooks/deriveResolveCandidate.test.ts` | new | Pure function unit tests (§4 step 2) |
| `acceptance/agent-surface-e2e.mjs` | new | The Build Order's literal acceptance line, mechanically proven end-to-end (§9) |
| `README.md` | modify | Document the four new commands + MCP/skill/hook setup instructions |

No files are created by this Team Lead session — this table is the Developer stage's shopping list, same
convention as phases 1-4's own plans.

---

## 8. Test plan

### 8.1 Unit tests

- **`tools.test.ts`:** each of the five tools against hand-built `ToolRepoContext` fixtures (no filesystem/git
  needed for the bulk of these) — `resolve` across all `ResolveResult` variants (id/path/filename/fuzzy/
  tombstone/not-found, reusing `resolver.test.ts`'s own fixture style); `read_doc` for a live id, a tombstoned
  id, and an unknown id; `search` ranking against a small multi-doc fixture (title match beats a weaker heading
  match, an empty query returns an empty/graceful result, not a crash); `list_unanswered_questions` against a
  mixed answered/unanswered fixture (only unanswered surfaced, `:::actions` items never appear even when
  present in the fixture); `answer_status` for a found-answered, found-unanswered, not-found, and a deliberately
  **ambiguous** (two docs sharing a directive id) fixture, asserting the `{ matchType: 'ambiguous' }` shape
  rather than a guess.
- **`deriveResolveCandidate.test.ts`:** absolute-inside-repo path → repo-relative; already-relative path →
  unchanged; a path outside the repo root entirely → a defined, safe fallback (basename only), never a thrown
  error or a path-traversal-shaped output.
- **`llms-txt.test.ts`:** a fixture index with 3-4 docs → exact-string assertion of the generated `llms.txt`
  (H1/blockquote/H2/bullet-per-doc shape, §1.5), including one doc with no `title` (falls back to filename stem,
  reusing the same fallback the index itself already establishes at build time — no new title-fallback logic
  invented here).
- **`install-agent-hook.test.ts`** / **`install-skill.test.ts`**: fresh install into an empty scratch dir;
  re-running is idempotent (no duplicate `PostToolUse` array entries on a second `install-agent-hook` run,
  detected via the same "marker comment" idempotency-detection convention phase 1's git-hook shim already
  established, `hook-template`'s own file getting a matching marker); an existing, unrelated `PostToolUse`
  matcher entry in `settings.json` is preserved untouched, the new one appended alongside it; an existing,
  differently-authored file already at `.claude/skills/chart-room/SKILL.md` is not clobbered (refuses, prints
  instructions, same discipline as phase 1's git-hook-collision handling).

### 8.2 MCP protocol-level integration test — a real `Client`, not just a function call

`test/daemon/mcp-route.test.ts`: rather than only unit-testing `tools.ts`'s plain functions (which proves the
*logic* but not that the actual MCP wire protocol/route wiring works), this test constructs a real
`@modelcontextprotocol/sdk` `Client` and drives an actual `initialize` → `tools/list` → `tools/call` round trip
against the daemon's real HTTP MCP route. Given `StreamableHTTPServerTransport.handleRequest` needs real
Node `IncomingMessage`/`ServerResponse` objects (§1.1) rather than Fastify's own `.inject()` fake request/reply
pair, this test uses a **real ephemeral `.listen({port: 0})`** (the one exception to this project's otherwise
consistent "`.inject()`, never a real socket" testing convention, phase 2 §1.1) plus the SDK's own
`StreamableHTTPClientTransport` pointed at `http://127.0.0.1:<port>/api/repos/<id>/mcp` — flagged explicitly as
the one new testing pattern this phase introduces, and why (§9 risk #2). Asserts: `tools/list` returns exactly
the five expected tool names with schemas; a `tools/call` for `resolve` against a scratch repo with a `git mv`'d
doc returns the corrected path; a `tools/call` for `answer_status` against an unanswered fixture question
returns `answered: false`.

### 8.3 Acceptance script — the mechanical half, proven end-to-end; the "fresh session" half, honestly not automatable

`acceptance/agent-surface-e2e.mjs` (mirrors every prior phase's disposable-scratch-repo pattern):

1. Scaffold a scratch git repo with 2-3 docs (one with a pending `:::ask-me{id="q-01" type="yesno"}` block).
2. Run `chartroom init` (assigns ids), `chartroom install-agent-hook`, `chartroom install-skill` — assert all
   three artifacts exist on disk with the expected content/idempotency markers.
3. `git mv` a doc to a new path (real `git mv`, staged).
4. Connect a real MCP `Client` (§8.2's mechanism) to a `chartroom mcp` **stdio subprocess** spawned against this
   scratch repo (a second, complementary proof to §8.2's HTTP-transport test — the CLI transport is exercised
   here specifically, spawned as a real child process via `node:child_process.spawn`, talking real stdio
   JSON-RPC, not `.inject()`-equivalent) → call `resolve(<old-id>)` → assert the corrected new path comes back.
5. Simulate a human's browser answer (reuse phase 4's `applyAskMeAnswer` directly against the doc's raw text,
   same technique phase 4's own acceptance script uses to "simulate a human answers in browser" step) → call
   `answer_status('q-01')` over the same MCP connection → assert `answered: true` and the correct answer text.
6. Run `chartroom llms-txt` → assert the emitted file lists all (non-deleted) docs including the moved one at
   its corrected path.
7. Exit `0` if every assertion passes.

**What this script proves, stated precisely:** every mechanical piece (CLI commands, MCP tools over both
transports, the installed skill/hook files existing with correct content, `llms-txt` output) genuinely works,
end-to-end, driven by real protocol clients wherever the SDK offers one — this is a **materially stronger**
automated proof than "call an internal function and check its return value," because it's the same wire
protocol a real Claude Code session actually speaks.

**What this script does *not*, and structurally cannot, prove — stated honestly, not overclaimed:** the Build
Order's own acceptance sentence is about **a fresh Claude Code session's own behavior** — that it actually
*chooses* to call `resolve`/notice the hook's guidance/use the skill's instructions correctly, unprompted, when
given a task that hits a moved doc. That is a claim about an LLM's own judgment in a live session, not a claim
about whether the underlying tools function correctly. **No script this Team Lead can design proves an agent
*will* behave a certain way** — only that the tools it *would* use, if it chooses to, work correctly. This is a
genuinely different category of acceptance criterion than every prior phase's (all of which were pure
code-correctness claims), and I'm naming that difference explicitly rather than quietly writing a script that
looks like it covers the sentence and calling it done. **Recommended resolution (§12):** the Reviewer stage (or
the Captain) does one real, live pass — open an actual fresh Claude Code session in the scratch repo this
acceptance script builds (with `.mcp.json` pointed at the installed `chartroom mcp` stdio command, the skill and
hook both installed), give it a task that requires reading a doc whose path was moved and checking an
`:::ask-me` answer, and observe whether it self-corrects without being told where the file went — the same
"automated proof of the mechanism + one honest manual pass for the behavioral claim" split phases 2-4 already
established for real-browser QA, applied here to a real *agent* session instead of a real *browser* tab.

### 8.4 Spec acceptance criteria → verification mapping

| Spec acceptance criterion (§8 item 5) | How this plan verifies it |
|---|---|
| MCP server (stdio + HTTP, five tools) | `tools.test.ts` (logic) + `mcp-route.test.ts` (real `Client` over HTTP) + acceptance script step 4 (real `Client` over stdio) |
| `chart-room` skill | `install-skill.test.ts` (file lands correctly, idempotent, no clobber) + acceptance script step 2 |
| `PostToolUse` hook | `install-agent-hook.test.ts` + `deriveResolveCandidate.test.ts` — see §9 risk #1 for the empirical-verification gap this can't close alone |
| CLAUDE.md template line | Documented in README; no automated test needed (it's static prose a human copies in, not executable) |
| `llms-txt` | `llms-txt.test.ts` + acceptance script step 6 |
| "resolves a moved doc... without human path-fixing" (mechanical half) | Acceptance script steps 3-4 (real `git mv` + real MCP `resolve` call returning the corrected path) |
| "...and answers flow end-to-end" (mechanical half) | Acceptance script step 5 (`answer_status` reflecting a simulated human answer) |
| "a fresh Claude Code session... without human path-fixing" (behavioral half) | **Not automatable** — §8.3's honest limitation; recommended one live manual pass, same category as phases 2-4's real-browser QA gap |

---

## 9. Risks (riskiest first)

1. **[Riskiest] The `PostToolUse` hook's failure-detection heuristic is unverified against a real Claude Code
   Read-failure payload.** §1.4 flags this explicitly: the fetched docs page's example string
   (`"Error: file not found"`) is illustrative, not confirmed as the literal production wording. If the real
   string looks different (a different phrasing, a stack-trace-shaped string, a path-quoting difference), the
   allowlist-based detection could simply never fire, silently defeating the entire hook feature while looking
   correct in every unit test (which necessarily tests against a *simulated* `tool_response` string, not a real
   one). **Mandatory first Developer-stage step:** a real empirical spike — trigger an actual failing `Read` in
   a live Claude Code session and capture the real stdin payload a hook receives — before finalizing the
   detection regex, exactly matching the standing precedent phase 3's Milkdown-API spike established for
   "verify the exact shape before betting the design on an assumed one."
2. **The new HTTP MCP integration test (`mcp-route.test.ts`) is the first test in this whole project that needs
   a real `.listen()` socket rather than Fastify's `.inject()`**, because `StreamableHTTPServerTransport` is
   built around real Node `IncomingMessage`/`ServerResponse` objects, not `.inject()`'s synthetic pair. This is
   a small, deliberate, justified exception (§8.2) but is a genuine new source of port-conflict flakiness class
   this project has otherwise entirely avoided since phase 2 explicitly chose `.inject()` specifically to
   sidestep this — worth the Reviewer's attention as a new pattern, not a silent regression to less-safe testing
   practice (mitigated by `port: 0`, i.e. OS-assigned ephemeral port, standard flakiness-avoidance practice).
3. **No authentication on the HTTP MCP transport.** Consistent with every prior phase's "loopback-only,
   single-local-user, no accounts" posture (the daemon already binds `127.0.0.1` only, phase 2 §4.3) — but
   worth naming plainly since MCP-over-HTTP is nominally a "remote agent connects" shape (`team-tasks`'s own
   MCP server, §1.1, *does* have real bearer-token auth, precisely because it's genuinely remote/multi-tenant).
   Chart Room's HTTP MCP transport is not remote-accessible by design (no port-forwarding/exposed-to-network
   story exists anywhere in this spec), so this is a correct, not a missing, design choice — flagged so it's a
   confirmed judgment, not an oversight.
4. **Ambiguous `:::ask-me` directive ids across a single repo's docs are structurally possible** (author-chosen
   strings, not enforced-unique index keys) — `answer_status`'s `{ matchType: 'ambiguous' }` result (§3.5)
   surfaces this rather than silently guessing, but it does mean an agent calling `answer_status` on a
   colliding id gets a less-useful "which one?" answer instead of a direct one. Same risk class phase 4's own
   `doc-ask-me.ts` route already accepted for its own PATCH endpoint (§9 risk of that phase's own plan) — not a
   new risk this phase invents, just a second surface exposed to the same pre-existing possibility.
5. **`search`'s title/heading-only scope (§3.3) could disappoint an agent expecting real full-text search** —
   low severity given it's a deliberate, justified, and reversible scope decision (Grep already covers the body-
   search case per the spec's own north star), but worth the Captain's explicit confirmation (§12) since "search"
   is a strong word that could set a wrong expectation if not documented clearly in the tool's own MCP
   `description` field (a Developer-stage wording detail flagged here so it isn't forgotten).
6. **The behavioral half of the acceptance line cannot be automated, by construction, not by this plan's own
   shortfall** (§8.3) — named plainly rather than papered over with a script that merely *looks* like it proves
   the full sentence. This is the same honesty standard prior phases applied to real-browser QA (phases 2-4),
   now applied to a fundamentally different, harder-to-close gap: proving *an agent's own behavior*, not just a
   rendered pixel.
7. **Dogfooding Chart Room onto `shareWork` itself is explicitly not done by this plan** (§6) — the strongest
   possible proof of the acceptance line (a real Claude Code session, in *this* actual repo, hitting a real
   moved doc) is deliberately deferred to an explicit Captain decision rather than taken as a default action,
   given it's a one-way, repo-wide mutation. Low risk *to this plan's own correctness*, but worth naming since it
   means the mission's own repo won't automatically become a live showcase of its own final feature without a
   further, explicit step.
8. **Zero `chartroom-ui` changes this phase (§2)** means nothing about the browser-based viewer/editor is
   touched, retested, or at risk from this phase's changes at all — stated as a genuine, low-risk-inducing
   fact, not a gap (this phase's acceptance line doesn't involve the browser in any way).

---

## 10. Definition of DONE mapping

| DoD item (spec §9 / Build Order §8 item 5) | How satisfied |
|---|---|
| MCP server (stdio + HTTP) | §1.1/§3/§7 — one `McpServer`, two transports, both SDK-native, verified against real installed types |
| `chart-room` skill | §1.3/§6/§7 — packaged template + `chartroom install-skill`, matching the real local `ask-human` convention |
| `PostToolUse` hook | §1.4/§4/§7 — `chartroom install-agent-hook`, empirical verification mandated as the Developer stage's first step |
| CLAUDE.md template line | §5 — short pointer to the skill, documented in README |
| `llms-txt` | §1.5/§7 — `chartroom llms-txt`, index-derived, local-repo-relative reading of the convention |
| Acceptance: mechanical half (resolve a moved doc, answers flow end-to-end) | §8.2/§8.3 — real `Client`s over both transports, real `git mv`, real simulated human answer |
| Acceptance: behavioral half ("a fresh Claude Code session... without human path-fixing") | **Honestly not automatable** — §8.3/§9 risk #6; recommend one live manual pass at Reviewer stage |
| Builds clean | `pnpm --filter chartroom build` (tsc), `turbo run build` |
| Lint passes | Existing package-scoped `eslint.config.mjs`, `turbo run lint` clean |
| Tests pass | `vitest run` — all §8.1/§8.2 tests green |
| No new dependencies beyond the approved list | `@modelcontextprotocol/sdk` + `zod` only (§9 dependency list below) — Reviewer should diff `package.json` and expect nothing else new |
| No `chartroom-ui` changes | Confirmed by design (§2) — Reviewer should expect an empty diff in that package entirely |
| Staleness-rule growth not built | §0.1 — confirmed by design; flagged as a genuine spec gap for the Captain, not silently built or dropped a second time |

---

## 11. New dependencies needing approval

**`packages/chartroom` (runtime):** `@modelcontextprotocol/sdk` (^1.29.0, verified current on the live npm
registry today; `team-tasks` independently uses `^1.26.0`, both are the same real package, no conflict since
these are two entirely separate `package.json`s/lockfiles in a pnpm workspace), `zod` (^3.25 or ^4.0, matching
the SDK's own declared peer/dependency range exactly — needed to define the five tools' `inputSchema`s via
`registerTool`).

**No new dev dependencies** — testing the new HTTP MCP route (§8.2) reuses the SDK's own `Client`/
`StreamableHTTPClientTransport` (already part of `@modelcontextprotocol/sdk`, no separate test-client package
needed) and Node's built-in `node:http`/ephemeral-port `.listen()`, no new test-only library.

**Explicitly considered and rejected:** `mcp-handler` (§1.1 — a Next.js-specific adapter, wrong shape for a
long-running Fastify daemon process); a hand-rolled JSON-RPC-over-HTTP bridge (§1.1 — unnecessary, the SDK's
own `StreamableHTTPServerTransport` already accepts raw Node req/res objects, which Fastify already exposes via
`request.raw`/`reply.raw`); `get-port`-style dependency for the new integration test's ephemeral port (`port: 0`
is a zero-dependency, standard Node/OS mechanism, same "don't add a dependency for a two-line need" precedent
phase 2's own plan already established for its own port-selection logic).

None are paid services, telemetry, or make network calls at runtime (both are local, MIT/permissive, and the
HTTP MCP transport never leaves `127.0.0.1`). Listed explicitly per the standing approval gate.

---

## 12. Needs First Officer / Captain decision

1. **Staleness-rule-growth (`ttl_days`/`sources:`, orphan detection) — a genuine spec gap, not phase 5's job
   (§0.1).** Never assigned to any literal Build Order acceptance line (not phase 2's, not phase 5's), despite
   being narratively promised in spec §6. I am not building it in this plan. **This needs a mission-level
   decision** (not just a phase-5 scope call): accept it as a deliberately-dropped v1 feature (my
   recommendation, given neither phase that was ever plausibly "it" actually claims it), or explicitly assign it
   to a future phase/v1.1 pass if the Captain still wants it built.
2. **MCP transport design (§1.1)** — one `McpServer`, `StdioServerTransport` (CLI) + `StreamableHTTPServerTransport`
   in stateless mode (daemon), both SDK-native. Confirm the stateless-mode choice (no session/resumability
   machinery) is acceptable, or request stateful mode if a future feature needs server-initiated pushes.
3. **Basic Memory tool-shape mirroring — could not be verified past a `404` (§1.2).** Confirm the "mirror only
   in general shape, not literal signature" reading is acceptable, or have someone with better access fetch the
   real reference before the Developer stage if literal mirroring genuinely matters.
4. **`PostToolUse` hook's resolution strength (§1.4/§4)** — recommending the "stronger" version (the hook
   actually calls `chartroom resolve` and includes the concrete corrected path in `additionalContext`) over the
   spec's more literal "just point at the mechanism" static-text wording. Confirm, or direct the simpler static
   version.
5. **The exact failure-detection string/heuristic for the `PostToolUse` hook is unverified (§1.4/§9 risk #1)** —
   requires a live empirical spike as the Developer stage's mandatory first step, not a design decision I can
   make now. Flagging so it isn't skipped under time pressure.
6. **`search`'s title/heading-only scope, not full-text body search (§3.3).** Recommending this reading (Grep
   already covers body search, per the spec's own design north star) — confirm or request a broader body-search
   design instead (would need real additional design work: a content tokenizer/index, not a small extension).
7. **`list_unanswered_questions` scoped to `:::ask-me` only, not `:::actions` items (§3.4).** Confirm this
   reading of the tool's own name, or request a sixth tool / a broader shape if `:::actions` items should also
   be MCP-visible.
8. **Dogfooding Chart Room onto `shareWork` itself — explicitly deferred, not done by this plan (§6).** The
   strongest possible live proof of the acceptance line would come from running `chartroom init` +
   `install-skill` + `install-agent-hook` against this actual monorepo's own `suite-design/` docs, but that's a
   real, one-way, repo-wide mutation I'm not taking as a default action. Confirm whether this should happen (as
   an explicit follow-up command invocation, not baked into this plan) before or shortly after Developer-stage
   merge.
9. **The acceptance line's behavioral half cannot be automated (§8.3/§9 risk #6).** Recommend one live manual
   pass (a real fresh Claude Code session against the acceptance script's scratch repo, with `.mcp.json`/skill/
   hook all installed, given a task that exercises the moved-doc-plus-pending-question scenario) at Reviewer
   stage — the same "automated proof of mechanism + one honest manual pass for the harder claim" split already
   established for real-browser QA in phases 2-4, now applied to agent behavior instead of browser rendering.
10. **`llms.txt` only, no companion `llms-full.txt` (§1.5).** Matches the spec's own "bonus... for free" framing;
    confirm, or request the full-text companion file too (cheap to add, same index-driven generation approach).
11. Per the mission's standing rule: **never `rm`/delete anything.** Nothing found this session needing removal
    or logging to `REMOVALS.md` — this plan is additive to phases 1-4's merged code in every file it touches
    (§7's table is 100% new files plus small, named, additive modifications to `cli.ts`/`server.ts`/`package.json`
    — no existing file's behavior changes).
12. `team-tasks/` is read once for research (§1.1) and never modified anywhere in this plan — confirmed by
    design, not by omission.

---

## 13. Whole-mission honesty check — is Chart Room actually "done" per spec §9 after this phase?

The task brief asks me to say plainly if I find anything suggesting the overall project isn't really done even
after phase 5, rather than declaring victory prematurely. Two concrete things surfaced by this session's own
research, stated directly:

1. **Spec §9's own DoD line — "ask-me / checklist / llm blocks work end-to-end with a real Claude Code
   session" — has, across all five phases including this one, never actually been verified with a real Claude
   Code session.** Every phase's acceptance proof (including this plan's own §8.3) is an automated script
   driving APIs/CLIs/MCP clients directly. This is not a phase-5-specific gap — it's a mission-wide one, visible
   now because phase 5's own acceptance line is the first one to *name* "a fresh Claude Code session" explicitly
   in its literal wording, making the gap impossible to paper over quietly the way it could be waved past in
   phases 1-4's more code-centric acceptance lines. If the Captain wants spec §9's DoD taken literally, **a real
   live Claude Code session against the finished product, doing the full loop (moved doc, id-based link,
   `:::ask-me` question, human answer, agent reading it back) has never actually happened**, across the whole
   mission, not just tonight.
2. **Chart Room has never been dogfooded on its own home repo (§6).** `shareWork` itself — the repo housing
   `packages/chartroom`, `suite-design/`, and every spec doc this mission has been implementing against all
   night — has no `.docs/index.json`, no installed hook, and no doc carrying a Chart-Room `id:`, despite being
   exactly the kind of repo Chart Room is built to manage. This doesn't block calling v1 "feature-complete" (spec
   §9's own bullets are about the *product's* capabilities, not about whether this specific monorepo adopts its
   own tool), but it does mean the most natural, lowest-effort way to actually *prove* v1 is done — turn Chart
   Room on for real, on the docs that describe Chart Room itself — has not happened, and is worth doing before
   anyone treats "v1 done" as more than "the code that would make it done has been written and unit/integration
   tested."

Neither of these is a phase-5 implementation gap to fix in this plan — they're honest, mission-level observations
this Team Lead session is specifically asked to surface rather than suppress.

---

## 14. Note on this Team Lead session's own tool access

This plan was written directly to `suite-design/overnight/plans/05-cr-phase5-plan.md` by a planning-only session
with file-write access restricted to this single path — no implementation files, dependency installs, or
commits were made, per this session's own operating constraints.
