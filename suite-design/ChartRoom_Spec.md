---
id: chart-room-design-spec-v1
---

# Chart Room — Design Spec (v1)

**Prepared for:** Ondřej · **Date:** 4 July 2026
**Status:** decision-complete for v1, ready to implement.
**Context:** first product of the suite (see `Product-Suite_Research-Synthesis.md` §5). Local-first markdown management + display suite. Open source, npx-installable, part of the suite monorepo as an independent package.

---

## 1. What it is

A global local daemon + browser UI + CLI + MCP server over the markdown docs of any number of registered repos. It makes MD docs: **viewable and editable pretty in the browser** (full-fidelity WYSIWYG), **interactive** (forms/questions/checklists that write back to the file), **portable** (ID-based self-healing links that survive moves, renames, and different folder structures across machines), and **agent-effective** (Claude resolves everything via plain Read/Grep, plus CLI/MCP/skill/hook).

Design north star: *every mechanism must work for an agent using nothing but Read and Grep on raw files.* All tooling is acceleration, never a dependency.

---

## 2. The link/ID system (the novel core)

### 2.1 Identity
- Every managed doc carries a frontmatter `id:` — short, human-readable, unique per repo (e.g. `auth-arch`). Committed; it IS the identity.
- Assignment: `chartroom init` assigns ids to all existing docs (derived from title/filename, one deliberate commit). New docs: id added on first save in the viewer, or by the pre-commit hook for docs created outside it.

### 2.2 Link format
```md
See the [auth spec](../arch/auth.md "id:auth-arch") and ![diagram](assets/auth/flow.png)
```
- Normal markdown link; **path = hint** (best-known location, renders on GitHub), **title attribute = truth** (`id:<id>`).
- Renders correctly in any markdown tool (title shows as tooltip). Fully visible to Claude in a plain Read.
- Local images/assets are tracked like docs (registered in the index by content hash + path), so image links self-heal too. Remote URLs pass through untouched.

### 2.3 The index
- `.docs/index.json` per repo — **gitignored**, rebuilt any time from frontmatter by the watcher or `chartroom index`. Flat JSON at a well-known path so agents can Read/Grep it with zero tooling.
- Shape: `{ docs: { "<id>": { path, title, headings[], outbound[] } }, assets: { "<hash>": { path } }, deleted: { "<id>": { lastPath, deletedAt } } }`.
- `deleted` = tombstones: a vanished doc's id is recorded; the viewer renders inbound links as "missing (was docs/x.md, gone since …)"; `resolve` returns a structured error, never a silent 404.

### 2.4 Resolution order (viewer, CLI, MCP — identical)
1. id lookup in index → 2. path as written → 3. unique filename match → 4. fuzzy title match (flagged as guess) → 5. tombstone / not-found.

### 2.5 Repair semantics (no git pollution)
- Runtime resolution always goes via id, so a stale committed path breaks **nothing**. No automatic commits, ever.
- **Lazy normalization:** the pre-commit hook rewrites stale paths *only in files already staged* — repairs ride along inside meaningful commits. Zero extra commits, zero diff noise in untouched files.
- `chartroom fix-links` = explicit repo-wide cleanup for a deliberate commit. Watcher detects out-of-band moves (`git mv`, agent `mv`) by id reappearing at a new path and updates the index instantly.

---

## 3. Viewer & editor

- **Global daemon** (`chartroom serve`): registry of repos in `~/.chartroom/repos.json`, one chokidar watcher per repo, one browser UI (localhost) with a repo switcher. Single process for all repos — this is also where the human-action inbox lives (§4.3).
- **Reading:** GFM + Mermaid + frontmatter panel; images rendered inline from relative paths and URLs; **collapsible sections** (per heading); **auto-generated TOC/outline sidebar**; backlinks panel (from index `outbound` inverted); dark mode.
- **Editing — full fidelity, no shortcuts:** Milkdown (ProseMirror, markdown-first) full-document WYSIWYG editing in place. Hard requirement: **byte-identical round-trip on untouched content**, enforced by a serialization test suite (the known failure mode of MD WYSIWYG is phantom diffs — treat any round-trip diff as a release blocker).
- **Image paste:** clipboard paste saves to `assets/<doc-id>/<timestamp>.png` (folder configurable), inserts the relative link, registers the asset in the index.
- **Link insertion:** Ctrl+K → file-picker modal, fuzzy search over index (title/id/path), inserts the id-carrying link format.

---

## 4. Interactive blocks (v1 = blocks only; inline frontmatter-bound fields deferred)

Parsed via `remark-directive`. Three directives + native GFM checkboxes:

### 4.1 `:::ask-me` — questions answered in the browser
```md
:::ask-me{id="q-03" type="choice"}
Which auth strategy for the MCP server?
- [ ] PAT tokens
- [ ] OAuth 2.1
- [ ] Both
:::
```
- Question schema **reuses the existing ask-human skill's SCHEMA.md types** (choice, free text, rating, ranking, comparison, attachments) — one schema across the suite.
- **Answers are written into the block in the doc** (decision: in-doc, self-documenting): the block gains an answer line (`> **Answer** (2026-07-04, Ondřej): Both — PAT now, OAuth later.`) and `answered="true"` on the directive. The doc becomes its own decision record; agents read answers with plain Read.

### 4.2 `:::llm` / `:::human` — audience blocks (novel, cheap, high value)
```md
:::llm{tldr="Auth uses short-lived JWTs; refresh via /token; keys in KMS"}
…dense context only an agent needs…
:::
```
- Viewer shows the human TLDR, full body collapsed behind it. Agents reading raw files get everything.
- `:::human` = decorative/human-only content; the shipped skill instructs agents to skip its body (token savings). Both are plain directives — degrade to visible text in any other renderer.

### 4.3 Checklists & human actions
- Plain GFM task lists (`- [ ]`) are clickable in the viewer and write back to the file — free.
- `:::actions` block = human-action items with ids; unanswered `ask-me` + unchecked `actions` across all registered repos aggregate into the daemon's **human-action inbox** page — the seam to the Ship (fleet approval queue plugs into the same inbox later).

---

## 5. Agent surface (first-class, not add-on)

- **CLI:** `chartroom init | index | resolve <id-or-path> | fix-links | check` (check = link integrity + missing ids + staleness rules; non-zero exit for hooks/CI).
- **MCP server:** stdio (per-repo) and served by the daemon (HTTP) — tools: `resolve`, `read_doc(id)`, `search`, `list_unanswered_questions`, `answer_status(question_id)`. Mirror Basic Memory's tool shapes where sensible.
- **Skill (`chart-room`):** teaches agents: resolve dead paths via `.docs/index.json` or `chartroom resolve`; write links in id format; use `:::llm`/`:::human` conventions; post questions as `ask-me` blocks and check back for in-doc answers (this replaces/absorbs ask-human's server flow when Chart Room is present).
- **Hook:** `PostToolUse` snippet — on failed Read of an `.md` path, reply "path not found — resolve via .docs/index.json / chartroom resolve". Makes id-resolution self-correcting even when the skill doesn't fire.
- **CLAUDE.md template line** shipped for repos adopting Chart Room.
- Bonus: `chartroom llms-txt` emits an `llms.txt` from the index for free.

## 6. Staleness (phase 2, plugs into existing research)

`chartroom check` grows the rules from `Staleness-Linters-MCPs_Toolkit.md`: `remark-validate-links` for anchors, frontmatter `ttl_days`/`sources:` freshness gate, orphan detection (no inbound links), all surfaced in the viewer dashboard + as CI exit codes. No new research needed — adopt the toolkit doc's stack as-is.

---

## 7. Stack

Node 20+ / TypeScript. Fastify (daemon + API). chokidar (watcher). unified/remark + `remark-directive` (+ `remark-frontmatter`, `remark-gfm`). **vscode-markdown-languageservice** (MIT) for link discovery/rename machinery. Milkdown for WYSIWYG. `@modelcontextprotocol/sdk` for MCP. better-sqlite3 only for daemon-internal state (inbox cache); the per-repo index stays JSON (agent-readable). React + Vite for the UI. No Redis, no external DB, no cloud dependency. `npx chartroom serve` must work from zero config.

## 8. Build order (phases, each shippable)

1. **Indexer + CLI + resolution + pre-commit hook.** `init/index/resolve/fix-links/check`, tombstones, lazy normalization. Acceptance: `git mv` a doc → agent resolves it via CLI and via raw index Read; staged commit normalizes only staged files.
2. **Viewer (read-only).** Daemon, repo registry, pretty rendering, TOC, collapsing, backlinks, images (path+URL), `:::llm`/`:::human` rendering, missing-link tombstone display. Acceptance: browse two registered repos in one UI; broken link shows tombstone info.
3. **Editor.** Milkdown in-place editing with round-trip suite, image paste → assets, Ctrl+K link picker. Acceptance: edit-save cycle produces zero diff on untouched lines; pasted image self-heals after `git mv`.
4. **Interactive blocks + inbox.** `ask-me` (ask-human schema) + GFM checkbox write-back + `:::actions`; cross-repo human-action inbox page. Acceptance: agent writes an ask-me block via file edit; human answers in browser; answer lands in the doc; agent reads it back.
5. **Agent surface polish.** MCP server, `chart-room` skill, PostToolUse hook, CLAUDE.md template, `llms-txt`. Acceptance: a fresh Claude Code session in a Chart-Room repo resolves a moved doc and answers flow end-to-end without human path-fixing.

## 9. Definition of done (v1)

- `npx chartroom serve` from zero config; repos registered; docs browsable/editable in browser with full round-trip fidelity.
- Links survive `git mv`, agent `mv`, cross-machine clone into a different folder structure — resolved by id everywhere (viewer, CLI, MCP, raw grep).
- No repair ever creates a commit or pollutes a diff of an untouched file.
- ask-me / checklist / llm blocks work end-to-end with a real Claude Code session.
- Ships as an independent package in the suite monorepo; MIT; self-hostable by default (it's local-first — nothing to host).

## 10. Explicitly out of scope (v1)

Inline frontmatter-bound input fields (Meta-Bind style); multi-user/collab editing; publishing/static-site export; vector search; staleness dashboard (phase 2); Ship integration beyond the inbox seam.
