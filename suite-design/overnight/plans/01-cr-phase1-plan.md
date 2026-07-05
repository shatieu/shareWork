# Package 1 — Chart Room Phase 1: Indexer + CLI + Resolution + Pre-commit Hook

**Team Lead session.** Branch: `ship-wave1-cr-phase-1` (verified checked out, do not switch/create branches).
Status: plan awaiting First Officer approval. **No implementation, no `npm`/`pnpm install`, no stub files beyond this document.**

Spec source: `suite-design/ChartRoom_Spec.md` §8.1 (build order), read against §2 (link/ID system) and §7 (stack).

---

## 0. Scope recap (so approval is against the right bar)

Phase 1 = the foundation only: a CLI package that can index a repo's markdown docs into a gitignored
JSON index, resolve ids/paths against it, repair stale links, and enforce/normalize link hygiene via a
pre-commit hook — with **zero automatic commits and zero diff noise in files not already staged**.

Explicitly **not** phase 1 (confirmed by re-reading §7/§8 against current repo state):
- Fastify daemon, chokidar live watcher, multi-repo registry (`~/.chartroom/repos.json`) — phase 2.
- Milkdown WYSIWYG editor, image paste flow — phase 3.
- `remark-directive` blocks (`:::ask-me`, `:::llm`/`:::human`, `:::actions`) — phase 4.
- MCP server, `chart-room` skill, `PostToolUse` hook, `llms-txt` — phase 5.
- Staleness rules beyond basic link/id integrity (`ttl_days`, `sources:` freshness, orphan detection) — phase 2 per spec §6.
- `vscode-markdown-languageservice` — see §1.2 below; deferred, not installed this phase.

Phase 1 operates **single-repo, cwd-scoped** (nearest ancestor containing `.git`, defaulting to
`process.cwd()`). The multi-repo registry is a phase-2 daemon concern (§3 of the spec); nothing here
should invent registry plumbing early.

---

## 1. Research findings

### 1.1 Frontmatter parsing/writing — decision: gray-matter for reads, surgical string patch for writes

Searched npm-compare/npmtrends and gray-matter's own docs. Findings:
- `gray-matter` is the de facto standard (battle-tested, used by Astro/VitePress/Gatsby/etc.), parses
  YAML/JSON/TOML frontmatter into `{ data, content }`. Good enough for **read-only** extraction of
  `id`, `title`, and (later) `ttl_days`/`sources`.
- `gray-matter`'s `stringify()` round-trips through `js-yaml` dump — it does **not** guarantee
  byte-identical output for untouched frontmatter (key quoting/formatting can change, comments in the
  YAML block are not preserved). Given the spec's explicit anxiety about "phantom diffs" (stated for
  the Milkdown editor in §3, but the same discipline must apply here), **no write path in phase 1 may
  call `matter.stringify`**.
- `remark-frontmatter` (unified/remark AST plugin) parses frontmatter as an opaque `yaml` AST node —
  useful for *locating* the frontmatter block's byte offsets inside the file, not for parsing the YAML
  itself (that's still `gray-matter`/`js-yaml`'s job).
- **Decision:** use `gray-matter` to *read* `data`/`content` and to detect "does this doc have an
  `id:` field." All *writes* (injecting a missing `id:` line, rewriting a stale link path) are done by
  slicing/splicing the **original raw file string** at exact byte offsets — never regenerating the
  file from a parsed object. See §5.3 (id injection) and §6.2 (link rewrite) for the exact mechanism.

### 1.2 `vscode-markdown-languageservice` — decision: defer to phase 2/3

- Confirmed via npm/GitHub: it's a full language-service package (`createLanguageService`,
  `getEditForFileRenames`, workspace-wide rename/diagnostics) designed for editor/LSP integration —
  it wants a workspace file-watcher/document-provider wired in, which is a phase 2 (daemon/chokidar)
  and phase 3 (editor) concern, not a standalone CLI concern.
- Phase 1's resolution algorithm is a small, custom, spec-defined 5-step order (§2.4) against our own
  flat JSON index — reusing an LSP library for this would be both overkill and would obscure the
  "an agent using nothing but Read/Grep" design north star (§1) with a black-box dependency.
- **Decision:** do not add this dependency in phase 1. Revisit in phase 2 (daemon-side link discovery)
  or phase 3 (editor Ctrl+K picker / rename-on-move UX), where its `getEditForFileRenames` API maps
  much more directly to those features.

### 1.3 Pre-commit hook mechanism — decision: plain `.git/hooks/pre-commit` shim, no Husky/lint-staged

- Researched current (2026) guidance: `pre-commit.com`'s own docs and multiple lightweight-hook
  write-ups confirm the "no framework" pattern — a single executable file at `.git/hooks/pre-commit`,
  no repo-wide config, easiest to reason about and remove.
- Husky/lint-staged both solve "operate on staged content without disturbing unstaged edits" via a
  **stash-based** approach (stash unstaged hunks, run tools against the working tree, unstash). That's
  necessary for tools that only know how to edit working-tree files (e.g. Prettier). We don't need it:
  git lets us read/write the **index blob directly** (`git show :<path>`, `git hash-object -w`,
  `git update-index --cacheinfo`) without ever touching the working tree, which is strictly safer for
  the "files not already staged must show zero diff" requirement — see §6.2.
- **Decision:** no new dependency for the hook mechanism. `chartroom init` writes a small Node-shebang
  script to `.git/hooks/pre-commit` that `require()`s the built CLI's hook entrypoint directly
  in-process (no subprocess spawn, no PATH/npx resolution needed). This is the same "shebang-executable
  hook file" trick historically used by Husky v4 before it moved to its own manager — we're taking the
  mechanism without the dependency.

### 1.4 CLI argument parsing / test runner — pragmatic picks, flagged for approval, not installed yet

- **`commander`** for subcommand/flag parsing (`init|index|resolve|fix-links|check`) — small, no
  transitive bloat, the de facto standard for Node CLIs. Alternative considered: hand-rolled `process.argv`
  parsing (zero deps) — rejected, not worth the correctness risk (flag parsing, `--help` text) for a
  tool whose whole pitch is agent-usability.
- **`vitest`** for unit/integration tests — matches the Node20+/TS/ESM stack, fast, no config ceremony,
  and `turbo.json`'s existing `test` task (`outputs: coverage/**`) already anticipates it.
- **`unified` + `remark-parse` + `remark-gfm` + `remark-frontmatter` + `unist-util-visit`** for
  *read-only* AST walks (heading extraction, link/image node discovery with correct byte offsets,
  correctly ignoring link-like text inside fenced code blocks — a plain regex would false-positive
  there). Never used to stringify a whole file back (see §1.1).
- All of these are **proposed, not installed** — see §9 "New dependencies requiring approval."

---

## 2. Package location & naming

- Path: `packages/chartroom/` (matches `packages/README.md`'s stated first tenant from package 0).
- `package.json` `name`: `"chartroom"` (unscoped — required for the spec's `npx chartroom serve` UX,
  §7/§9). **Flagged in §10 for Captain confirmation** — nothing is published tonight, this only affects
  the local `name` field, trivially renamed later, but public unscoped npm names are a naming decision
  the kickoff prompt says never to guess on.
- `bin`: `{ "chartroom": "./dist/cli.js" }`.
- ESM throughout (`"type": "module"`), extends root `tsconfig.base.json`, own `eslint.config.mjs`
  (package-scoped, not shared — consistent with package 0's §6.5 rationale: a Node CLI's lint rules
  differ from the eventual Vite/React UI package).
- `turbo.json`'s existing `build`/`lint`/`test` tasks need zero changes — `packages/chartroom` becomes
  the first real member exercising them (package 0 left this proof honestly deferred).

---

## 3. Files to create (plan-only; not created yet)

| Path | Purpose |
|---|---|
| `packages/chartroom/package.json` | Package manifest: name `chartroom`, bin, deps (§9), scripts (`build`, `lint`, `test`, `dev`→tsc watch) |
| `packages/chartroom/tsconfig.json` | Extends root `tsconfig.base.json`; sets `outDir: dist`, `rootDir: src` |
| `packages/chartroom/eslint.config.mjs` | Flat config: `@eslint/js` recommended + `typescript-eslint`, package-scoped |
| `packages/chartroom/vitest.config.ts` | Test runner config (node environment, coverage → `coverage/**` matching `turbo.json`) |
| `packages/chartroom/README.md` | Usage note: install, `chartroom init/index/resolve/fix-links/check`, hook behavior, index shape summary |
| `packages/chartroom/src/cli.ts` | Entrypoint; `commander` program wiring the 5 subcommands + hidden `hook-pre-commit` |
| `packages/chartroom/src/repo.ts` | Repo-root discovery (`findGitRoot(cwd)`), doc-file discovery (walk, respecting `.gitignore` + a small built-in ignore list: `node_modules`, `.git`, `.turbo`, `dist`) |
| `packages/chartroom/src/frontmatter.ts` | Read (gray-matter wrapper: `readFrontmatter(raw) -> {data, bodyStart}`) + surgical write helpers (`injectId(raw, id) -> string`, byte-offset-safe) |
| `packages/chartroom/src/markdown.ts` | Remark pipeline (parse+gfm+frontmatter) read-only AST walk: extract headings, outbound link nodes (with `{href, titleAttr, position}`), image nodes |
| `packages/chartroom/src/id.ts` | Id generation: slugify(title \|\| filename stem), collision-suffix (`-2`, `-3`, …) against a given set of existing ids |
| `packages/chartroom/src/index-schema.ts` | TypeScript types for the index shape (§4) + `readIndex`/`writeIndex` (JSON, gitignored path `.docs/index.json`) |
| `packages/chartroom/src/indexer.ts` | Full-repo scan → build fresh `docs`/`assets` maps; diff against previous `.docs/index.json` to compute tombstones/move-detection/resurrection (§5) |
| `packages/chartroom/src/resolver.ts` | The 5-step resolution algorithm (§6.1), pure function over an in-memory index + query string |
| `packages/chartroom/src/fix-links.ts` | Repo-wide (or scoped-to-a-file-list) stale-link rewrite using AST byte offsets (§6.2), shared by `fix-links` command and the pre-commit hook |
| `packages/chartroom/src/hook.ts` | Pre-commit hook logic: staged-file discovery, index-blob-safe id-injection + link-rewrite, re-stage (§7) |
| `packages/chartroom/src/install-hook.ts` | Writes `.git/hooks/pre-commit` shim (chain-safe, §7.4), called by `init` |
| `packages/chartroom/src/check.ts` | Read-only integrity check: broken links, tombstoned links, missing ids (§8) |
| `packages/chartroom/src/commands/init.ts` | `chartroom init` command (§8.1) |
| `packages/chartroom/src/commands/index.ts` | `chartroom index` command (§8.2) |
| `packages/chartroom/src/commands/resolve.ts` | `chartroom resolve` command (§8.3) |
| `packages/chartroom/src/commands/fix-links.ts` | `chartroom fix-links` command (§8.4) |
| `packages/chartroom/src/commands/check.ts` | `chartroom check` command (§8.5) |
| `packages/chartroom/test/id.test.ts`, `frontmatter.test.ts`, `resolver.test.ts`, `indexer.test.ts`, `fix-links.test.ts`, `hook.test.ts` | Unit tests (§11.1) |
| `packages/chartroom/acceptance/git-mv-resolution.mjs` | Standalone Node script proving the spec's phase-1 acceptance line end to end (§11.2) — committed, runnable via `node acceptance/git-mv-resolution.mjs` |
| `packages/chartroom/acceptance/README.md` | What the acceptance script proves, how to run it |
| `suite-design/overnight/changelog/entries/<date>--cr-phase1.md` | Changelog fragment (written by the Lead after Reviewer PASS, not now) |

No files are created by this Team Lead session — this table is the implementation shopping list for
the Developer stage, post-approval.

---

## 4. `.docs/index.json` schema (full)

Gitignored (per-repo), rebuilt from frontmatter/content by `chartroom index` (and implicitly, freshly
in-memory, by `resolve`/`check`/`fix-links`/the hook — see §6.3 "always-fresh" rule).

```ts
interface ChartRoomIndex {
  /** schema version, bump on breaking shape changes so a stale index.json is detected, not misread */
  version: 1;
  /** ISO 8601 timestamp of last full rebuild */
  generatedAt: string;
  docs: {
    [id: string]: {
      /** repo-root-relative, forward-slash-normalized, e.g. "suite-design/ChartRoom_Spec.md" */
      path: string;
      /** frontmatter `title:` if present, else first H1, else filename stem */
      title: string;
      /** heading text in document order, for fuzzy-title matching and future TOC use */
      headings: string[];
      /** every outbound doc/asset link found in the body, in document order */
      outbound: Array<{
        /** the id this link points to, if it carries `title="id:<id>"` */
        targetId?: string;
        /** the literal href/path as written in the file right now */
        hrefAsWritten: string;
        /** true if hrefAsWritten no longer matches the current resolved path for targetId */
        stale: boolean;
      }>;
    };
  };
  assets: {
    /** key = sha256 content hash, so a moved/renamed asset is recognized as the same asset */
    [hash: string]: {
      /** repo-root-relative, forward-slash-normalized */
      path: string;
    };
  };
  /** tombstones: an id that no longer resolves to any doc on disk */
  deleted: {
    [id: string]: {
      lastPath: string;
      deletedAt: string; // ISO 8601
    };
  };
}
```

Notes:
- `docs`/`deleted` are keyed by id (per spec §2.3); a doc with **no** `id:` frontmatter is *not*
  entered into `docs` (it can't be looked up by id) but is still scanned for `check`'s "missing id"
  rule and is still resolvable by path/filename (resolution steps 2–3 don't need an id).
- `assets` is populated only from images actually referenced by at least one doc body (no independent
  filesystem crawl of arbitrary binary files) — keeps phase 1's asset tracking minimal per §1 scope
  notes; full asset lifecycle (paste, folder config) is phase 3.
- `version` field is new relative to the spec's one-line shape in §2.3 — added so a future schema
  change can detect+ignore a stale-shape index.json instead of crashing on unexpected keys. Low-risk,
  additive, not a Captain-level decision.

---

## 5. Indexing algorithm

1. **Discover repo root:** walk up from cwd until a `.git` directory is found; error (exit 1) if none.
2. **Discover doc files:** walk the tree from repo root, skipping `.git`, `node_modules`, `.turbo`,
   `dist`, `coverage`, and anything matched by the repo's `.gitignore` (parsed via a minimal gitignore
   matcher — reuse `.gitignore`'s own patterns, don't invent a second ignore file). Collect all `*.md`
   files.
3. **Parse each doc:** read raw text; `gray-matter` → `{data, content}`. Extract `id` (if present),
   `title` (frontmatter `title:` → else first `# ` heading in `content` → else filename stem).
   Remark-parse `content` (gfm+frontmatter-aware) for: heading text list, link nodes (with href +
   `title` attribute + byte position), image nodes (href + byte position).
4. **Resolve link targets for the `outbound`/`stale` fields:** for each link node whose `title`
   attribute matches `id:<id>`, look up `<id>` in the **fresh** `docs` map being built this pass (two
   passes needed: pass 1 builds `id -> path` for every doc; pass 2 computes `outbound[].stale` by
   comparing `hrefAsWritten` against the now-known current path for `targetId`).
5. **Assets:** for each image node whose href is a local relative path (not `http(s)://`), if the
   referenced file exists on disk, sha256 its bytes, add/update `assets[hash] = {path}`. If it doesn't
   exist, no assets entry (surfaced instead by `check` as a broken image link).
6. **Diff against the previous `.docs/index.json`** (if one exists on disk) to compute tombstones and
   detect moves vs. deletions — see §7 (move/tombstone lifecycle) for the exact rule; this is the same
   diff logic reused by `chartroom index`, `resolve`, `check`, `fix-links`, and the pre-commit hook.
7. **Write** the new index atomically (write to `.docs/index.json.tmp`, rename over the target) so a
   crash mid-write never leaves a corrupt/partial index for an agent to Read.
8. `chartroom index` **never mutates doc files** — it only ever reads and writes `.docs/index.json`.
   File mutation (id injection, link repair) is exclusively `init`, `fix-links`, and the hook's job.

---

## 6. Resolution algorithm & CLI: `resolve`

### 6.1 Resolution order (exactly per spec §2.4)

Given a query string `q` (an id or a path) and a fresh index:

1. **id lookup:** if `q` is a key in `docs`, return `{matchType: "id", path: docs[q].path, id: q}`.
2. **path as written:** if `q` (normalized, repo-root-relative) matches some `docs[id].path` exactly,
   return `{matchType: "path", path: q, id}`.
3. **unique filename match:** if `basename(q)` matches exactly one doc's `basename(path)` across the
   whole index, return `{matchType: "filename", path: <that doc's path>, id}`. If more than one doc
   shares that filename, this step does **not** match (ambiguous) — fall through.
4. **fuzzy title match:** compare `q` (and its filename-without-extension, title-cased/slug-normalized)
   against every doc's `title` using a small edit-distance/token-overlap heuristic (e.g. Dice
   coefficient on lowercased word sets — no new fuzzy-matching dependency, ~20 lines). If the best
   score clears a conservative threshold and is unambiguous (best score meaningfully higher than
   runner-up), return `{matchType: "fuzzy", path, id, guess: true}`.
5. **tombstone / not-found:** if `q` matches a key in `deleted`, return
   `{matchType: "tombstone", lastPath, deletedAt}`. Otherwise `{matchType: "not-found"}`.

### 6.2 Link repair mechanism (shared by `fix-links` and the hook)

For a given file's raw text and its remark-parsed link nodes:
- For each link node with a `targetId` (from `title="id:<id>"`) where the current resolved path for
  `targetId` differs from `hrefAsWritten` (accounting for the *relative* path from this file's own
  directory to the target — hrefs are relative, index paths are repo-root-relative, so the comparison
  computes the expected relative href fresh each time via `path.relative`):
  - Splice the raw string: replace exactly the href substring at `[node.position.start.offset,
    node.position.end.offset)` — actually more precisely, replace only the **href portion** inside the
    parenthesis of the parsed link node (remark gives sub-positions for `url` vs the whole node in
    `mdast-util-from-markdown`'s node — falls back to a targeted regex anchored at the node's overall
    offset range if sub-position isn't exposed cleanly, verified during implementation) — leaving the
    link text, the `title="id:..."` attribute, and every other byte of the file untouched.
- Never re-run remark-stringify on the whole file. Never touch the frontmatter block in this pass.
- Return `{changed: boolean, newText: string, changes: Array<{targetId, oldHref, newHref}>}` for
  reporting (`fix-links --dry-run`) or application.

### 6.3 "Always-fresh" rule

`resolve`, `check`, `fix-links`, and the hook **all rebuild the index in memory** (§5 steps 1–6) before
doing their work — they never trust a possibly-stale `.docs/index.json` on disk for correctness (they
still *write* the refreshed index back to disk as a side effect, keeping the on-disk copy current for
"raw index Read" too). This directly satisfies the acceptance line's two halves: `chartroom resolve`
sees the post-`git mv` state (fresh in-memory scan), and a subsequent raw `Read`/`cat .docs/index.json`
also sees it (because the fresh scan was written back).

### 6.4 `chartroom resolve <id-or-path>` — CLI spec

- **Input:** one positional arg (id or path, relative or absolute — absolute is normalized to
  repo-root-relative first). Optional `--json` (default: human-readable one-line summary; `--json`
  emits the full structured result for scripting).
- **Output (stdout):** the resolution result object (§6.1 shapes).
- **Exit codes:** `0` = resolved via id/path/filename (exact) or via fuzzy match (still resolved, but
  `guess: true` is in the JSON so a script can treat it specially — chose not to fail exit code on a
  guess since it *did* produce a usable candidate; this is a Team-Lead judgment call, cheap to flip
  later, not escalated). `3` = tombstone (structured "gone" result, per spec §2.3 "never a silent
  404"). `4` = not-found. `1` = usage/fatal error (not a repo, fs error).

---

## 7. Tombstone handling & move/deletion lifecycle

**Rule (this is the crux the task called out explicitly):** an id's presence is checked by *existence
in the fresh scan*, never by *path*. So:

- **Move** (`git mv`, plain `mv`, agent edits the file to a new location, id frontmatter travels with
  it): the fresh scan (§5 step 3) finds the same `id` at a new path. The diff step (§5 step 6) sees
  `id` present in both old and new index snapshots → **updates `docs[id].path` in place, no tombstone
  entry is created or touched.** This is the "move, not deletion" case from the task brief.
- **Deletion** (file removed, or its `id:` frontmatter line removed/corrupted): the fresh scan no
  longer finds that `id` anywhere. The diff step sees an `id` present in the *previous* index snapshot
  but absent from the *fresh* one → moves it into `deleted[id] = {lastPath: <old path>, deletedAt: now}`
  and removes it from `docs`.
- **Resurrection** (the id reappears later — e.g. `git revert`, restoring from a backup, undoing an
  accidental deletion): fresh scan finds it again → removed from `deleted`, added back to `docs` with
  its (possibly new) current path. No special-casing needed; it falls out of "diff previous vs fresh"
  naturally.
- **First-ever index build** (no previous `.docs/index.json` exists): every doc found is new, `deleted`
  starts empty. No tombstones are invented for docs that were never previously indexed.
- Tombstones are **never created by `git mv` inside the same commit/working-tree state** — the
  diff always runs against whatever the *previous on-disk index* last recorded, and a move is, by
  definition, "same id, different path," which is the in-place-update branch above, not the
  removed-from-fresh-scan branch. This is the mechanism, not a promise layered on top — worth stating
  plainly since it's easy to get backwards.

---

## 8. Other CLI command specs

### 8.1 `chartroom init`
- **Purpose:** one-time (but safely re-runnable) bootstrap — assign ids to every existing doc missing
  one, build the first index, install the pre-commit hook.
- **Steps:** discover doc files (§5 step 2) → for each doc without `data.id`, generate one (§ id.ts:
  slugify title/filename, de-duplicate against ids assigned so far in this run + any already in the
  index) → **surgically inject** `id: <value>` into the file (into existing frontmatter block if
  present; otherwise prepend a new `---\nid: <value>\n---\n\n` block) → write the file (real mutation,
  this is the one deliberate commit the spec calls for) → run a full index build (§5) → call
  `installHook()` (§7.4) unless `--no-hook` passed.
- **Idempotent:** re-running only touches docs still missing an id; docs that already have one are
  left byte-for-byte alone.
- **Output:** summary line count ("assigned N ids, indexed M docs, hook installed/already present").
- **Exit codes:** `0` success (including "nothing to do"). `1` fatal (not a git repo, fs error).

### 8.2 `chartroom index`
- **Purpose:** rebuild `.docs/index.json` from scratch, no file mutation. Covered fully in §5.
- **Output:** summary ("indexed N docs, M assets, K tombstones"). `--json` prints the full index to
  stdout too (in addition to writing the file) for scripting.
- **Exit codes:** `0` success, `1` fatal fs/repo error.

### 8.3 `chartroom resolve <id-or-path>` — see §6.4.

### 8.4 `chartroom fix-links [--write] [--dry-run] [files...]`
- **Purpose:** explicit, repo-wide (or optionally scoped to given files) stale-link cleanup for a
  deliberate commit (spec §2.5).
- **Default (report-only, matches `eslint --fix`/`prettier --write` convention — First Officer
  correction, see DECISIONS-NEEDED.md): bare `chartroom fix-links` behaves exactly like `--dry-run`** —
  rebuild index (§5), for every doc file, compute §6.2's repair for stale outbound links, print a
  diff-like report, make **no** file changes. An explicit `--write` flag is required to actually apply
  the changes and write files. `--dry-run` is accepted as an explicit synonym for the default (no-op
  flag, kept for discoverability/scripts that pass it explicitly) but is never required to avoid
  mutation — the no-flag case is already safe.
- **Output:** list of `{file, targetId, oldHref, newHref}` changes found (reported under the default/
  `--dry-run` path, or applied and reported under `--write`).
- **Exit codes:** `0` = ran successfully (whether or not anything needed fixing). `1` = fatal error.
  (Deliberately not "non-zero if changes were needed" — that's `check`'s job, not this command's.)

### 8.5 `chartroom check`
- **Purpose:** read-only integrity gate for hooks/CI (spec §5). Phase 1 scope = link integrity +
  missing ids only; staleness rules (`ttl_days`, orphans) are explicitly phase 2 (spec §6) and must
  **not** be implemented here even partially, to avoid half-building a rule set the phase-2 Team Lead
  then has to reconcile.
- Rebuild index (§5). Report: (a) every outbound link whose `targetId` resolves to `tombstone` or
  `not-found`; (b) every doc missing an `id:` field; (c) duplicate ids (two files claiming the same
  `id:` — a scan-time error, first-seen-wins is not acceptable, must be flagged loudly).
- **Output:** human-readable list by default, `--json` for CI.
- **Exit codes:** `0` = clean. `1` = one or more issues found. `2` = fatal (not a repo, fs error).

---

## 9. Lazy normalization / pre-commit hook — exact design

This is **the riskiest part of the whole plan** — see §10 risk write-up for why.

### 9.1 What must be true
- Only files **already staged** for commit get their stale link paths rewritten.
- Files not staged are **byte-identical** before and after the hook runs (zero diff noise).
- New docs staged without an `id:` get one assigned (spec §2.1's "or by the pre-commit hook for docs
  created outside it").
- The hook **never creates a commit itself** — it only edits the content of the commit-in-progress
  (by rewriting the git index directly) or aborts (non-zero exit) on unrecoverable error.

### 9.2 Mechanism: operate on the git index blob, not the working tree

1. `git diff --cached --name-only --diff-filter=ACMR -M` → list of staged paths (added/copied/
   modified/renamed, rename-detected so a `git mv` shows the new path directly).
2. Filter to `*.md`.
3. For each staged path `p`:
   a. Read the **staged blob content**, not the working-tree file: `git show :p` (this is exactly
      what's about to be committed, independent of any unstaged edits sitting in the working tree on
      top of it).
   b. Rebuild a fresh index in memory (§5) using the **working tree** for every *other* file (the
      working tree is the best available view of "where things currently are" for resolving targets)
      but this file's own staged content for computing `p`'s own outbound links / missing-id state.
   c. Compute: (i) if missing `id:`, inject one (§8.1's injection helper) into the staged content;
      (ii) stale-link repairs (§6.2) against the staged content.
   d. If the staged content changed: write the new blob straight into the git object store
      (`git hash-object -w --stdin` fed the new content) and point the index entry at it
      (`git update-index --cacheinfo 100644 <new-blob-sha> p`) — **the working tree file is only
      touched if `git diff --name-only p` (unstaged-vs-staged) is empty**, i.e. `p` has no partial
      staging in flight; in that common case we also write the same new content to the working-tree
      file so `git status` shows a clean, consistent tree post-commit. If `p` *is* partially staged
      (unstaged hunks exist on top of the staged snapshot), we deliberately **do not** touch the
      working-tree file — only the index blob is updated — and the hook prints a one-line note:
      `chartroom: normalized staged content of <p>; working tree has additional unstaged edits, run
      'chartroom fix-links' after your next commit to sync.` This avoids ever clobbering a hunk the
      user hasn't chosen to commit yet.
4. After processing all staged `.md` files, rebuild `.docs/index.json` on disk (cache refresh only,
   gitignored, not part of the commit).
5. Exit `0` to let the commit proceed (this hook only repairs, it never blocks a commit in phase 1 —
   blocking behavior, if ever wanted, belongs to `check` wired in separately, not conflated here).

### 9.3 Why blob-level, not stash-based (lint-staged style)
Stashing unstaged changes, running a tool against the working tree, then popping the stash is exactly
the failure-prone part of Husky/lint-staged (merge conflicts on stash pop, partial-stash edge cases).
Since our edits are narrow (one file's content, computed from its own staged blob, no external
formatter needing a real working directory), we can skip the stash entirely and write directly to the
object store. This is more precise than what the popular tools do, not less — worth calling out as a
design win, not just "no dependency."

### 9.4 Hook installation: chain-safe shim
`chartroom init` writes `.git/hooks/pre-commit` (or, if a **different**, non-Chart-Room hook already
exists there, refuses to overwrite and prints instructions to chain manually — see §10 open question
about monorepo hook composability with `team-tasks/`'s own future tooling). The shim:
```
#!/usr/bin/env node
// chartroom:managed-pre-commit-hook (marker comment, makes re-runs of `init` idempotent/detectable)
import('<repo-root>/packages/chartroom/dist/hook.js').then(m => m.runPreCommitHook());
```
`<repo-root>` is computed at install time (absolute path baked in — acceptable since hooks are
per-clone, never committed/shared via git themselves; `.git/hooks/` is not versioned). In-process
`import()` avoids any PATH/npx resolution uncertainty inside a hook's minimal environment. `hook.ts`'s
`runPreCommitHook()` must `process.exit(0)` explicitly at the end (imported ESM modules don't
auto-exit) and `process.exit(1)` on unrecoverable fatal error (fs failure, not "found something to
fix").

---

## 10. Risks (riskiest first) & judgment calls

1. **[Riskiest] The staged-blob-vs-working-tree mechanism (§9.2) is the one piece of this plan with no
   existing library to lean on** — it's hand-rolled git plumbing (`hash-object`, `update-index`,
   `diff --cached`). Getting the partial-staging edge case wrong (case where a file has both staged
   and unstaged hunks) risks exactly the "diff noise" bug the spec is most worried about. Mitigation:
   the test plan (§11.1) includes a **dedicated partial-staging test** (stage half a file's changes via
   `git add -p`-equivalent, leave the rest unstaged, run the hook, assert working tree unstaged hunk is
   untouched and only the index blob changed) as a first-class test, not an afterthought.
2. Fuzzy title matching (§6.1 step 4) has no spec-mandated algorithm or threshold — "flagged as a
   guess" is the only hard requirement. A hand-rolled Dice-coefficient/token-overlap heuristic is a
   judgment call; low risk because it's explicitly advisory (`guess: true`) and never silently treated
   as authoritative — but worth the Reviewer double-checking the threshold isn't so loose it produces
   confident-looking wrong guesses.
3. Byte-offset link rewriting (§6.2) assumes remark/mdast exposes usable sub-node positions for the
   URL portion of a link distinct from the whole link node. This needs to be confirmed empirically
   during implementation (spike the exact mdast node shape for `[text](href "title")` before writing
   the "real" version) — if sub-positions aren't clean, fall back to a regex anchored at the whole
   link node's offset range (still safe, still doesn't touch unrelated bytes, just slightly more
   fragile against unusual link syntax). Flagging so the Developer doesn't discover this is undecided
   halfway through and stall.
4. `.gitignore`-aware doc discovery (§5 step 2) needs a real gitignore-pattern matcher, not just a
   fixed exclude list — for the acceptance script's temp-repo fixtures this barely matters (few files),
   but for `check`/`init` run against a real repo, missing this would make Chart Room needlessly slow
   or, worse, index generated/ignored content. A small well-tested gitignore-glob library (e.g. `ignore`
   on npm) is the pragmatic choice over hand-rolling gitignore syntax — added to §9's dependency list,
   flagged for approval alongside the others.
5. Hook installation collision with any *other* tool's future root `.git/hooks/pre-commit` (see §7.4
   and §12 open question) — deliberately not solved by inventing a hook-chaining framework in phase 1;
   solved by "refuse to clobber + tell the human," which is safe but manual.

---

## 11. Test plan

### 11.1 Unit tests
- **`id.test.ts`:** slugify behavior, collision suffixing (`-2`, `-3`), stability (same title → same
  slug given empty existing-id set).
- **`frontmatter.test.ts`:** `injectId` into (a) a file with no frontmatter at all, (b) a file with an
  existing frontmatter block missing `id:`, (c) idempotency (already has `id:` → no-op, byte-identical
  return). Explicit byte-identical assertion on untouched surrounding content in all three cases.
- **`resolver.test.ts`:** all 5 resolution steps individually (id hit; path-as-written hit; unique
  filename hit; ambiguous filename → falls through, doesn't false-match; fuzzy hit with `guess: true`;
  tombstone; not-found) against hand-built in-memory index fixtures (no filesystem needed).
- **`indexer.test.ts`:** move-without-tombstone (same id, path A → path B between two scans, asserts no
  `deleted` entry appears); true deletion (id vanishes, asserts tombstone appears with correct
  `lastPath`); resurrection (id reappears after being tombstoned, asserts `deleted` entry removed);
  duplicate-id detection; missing-id doc excluded from `docs` but still discoverable by path.
- **`fix-links.test.ts`:** stale link gets rewritten to the correct relative href; non-stale links
  untouched; frontmatter block byte-identical after a link-only fix; a link inside a fenced code block
  is correctly *not* rewritten (proves the AST-offset approach beats naive regex).
- **`hook.test.ts`:** the **partial-staging test** from Risk #1 (§10) as its own explicit case, plus:
  fully-staged file gets both index blob and working tree updated; missing-id staged new file gets an
  id injected into the staged blob; a `.md` file that is *not* staged is completely untouched (no read
  even attempted beyond the initial `git diff --cached --name-only` listing).

### 11.2 Acceptance script (spec's phase-1 acceptance line, committed under `packages/chartroom/acceptance/`)

`acceptance/git-mv-resolution.mjs` — a standalone Node script (run via `node acceptance/git-mv-resolution.mjs`,
also wired as `pnpm --filter chartroom test:acceptance` or similar), operating entirely inside a
disposable `fs.mkdtempSync` scratch directory with its own throwaway `git init` — **never touches the
real shareWork repo tree**, so no `rm`/deletion constraint is ever at stake and no real spec doc risks
getting an id injected by accident. Steps:

1. Scaffold a scratch git repo with 2–3 markdown docs, each already carrying an `id:` (simulating
   post-`init` state) and one doc linking to another via the `[text](path "id:target-id")` format.
2. Run `chartroom index` (via the built CLI) → assert `.docs/index.json` exists and is well-formed.
3. `git mv docs/a.md docs/sub/a.md` (real git mv, staged automatically by git).
4. Run `chartroom resolve <id-of-a>` (via CLI) → assert JSON output's `path === "docs/sub/a.md"`,
   `matchType === "id"`.
5. Raw-Read `.docs/index.json` from disk (`fs.readFileSync` + `JSON.parse`, no CLI involved — this is
   the "via raw index Read" half of the acceptance line) → assert `docs["<id-of-a>"].path ===
   "docs/sub/a.md"`.
6. Stage an **unrelated** third doc's edit (a real content change) plus leave doc B's link to doc A
   stale (pointing at the old pre-move path) — stage doc B too. Leave a fourth doc entirely untouched
   in the working tree.
7. Invoke the pre-commit hook logic directly (import `runPreCommitHook` rather than going through a
   real `git commit`, so the script can inspect intermediate state) → assert: doc B's staged blob now
   has the corrected relative path to doc A; the untouched fourth doc's working-tree bytes are
   identical to before (`fs.readFileSync` diff-checked); **no commit was created** (`git log` count
   unchanged).
8. Exit `0` if every assertion passes, non-zero with a clear message on first failure (this script *is*
   the Reviewer's acceptance gate, per the mission's Definition of DONE).

### 11.3 Spec acceptance criteria → verification mapping

| Spec acceptance criterion (§8.1) | How this plan verifies it |
|---|---|
| "`git mv` a doc → agent resolves it via CLI" | Acceptance script step 4 (`chartroom resolve`), plus `indexer.test.ts` move-without-tombstone unit case |
| "...and via raw index Read" | Acceptance script step 5 (direct `fs.readFileSync` + `JSON.parse`, no CLI) |
| "staged commit normalizes only staged files" | Acceptance script steps 6–7 (unrelated staged doc gets fixed, untouched doc is byte-identical), plus `hook.test.ts`'s partial-staging + not-staged cases |
| (implicit) "no repair ever creates a commit" (spec §2.5 / §9 DoD) | Acceptance script step 7 asserts `git log` count unchanged; `hook.ts` never calls `git commit` anywhere in its implementation (Reviewer should grep the diff for this) |
| (implicit) tombstones vs moves distinguished (spec §2.5 watcher note, task brief) | `indexer.test.ts` move-without-tombstone + true-deletion + resurrection cases |

---

## 12. Needs First Officer / Captain decision

These are judgment calls I am **not** resolving myself — listed here rather than guessed:

1. **Package name `"chartroom"` (unscoped) on npm.** Nothing publishes tonight, but the `package.json`
   name field is a naming decision the kickoff prompt explicitly says never to guess on
   ("Never guess on: ... publishing/naming"). Defaulting to the spec's own `npx chartroom` wording
   (§7/§9) as the conservative, spec-literal choice — flag for explicit confirmation before any future
   publish step, not before continuing implementation (nothing publishes in phase 1).
2. **New npm dependencies to approve before the Developer stage installs anything** (per the mission's
   plan-approval gate, and per the Captain's own standing rule to never add dependencies without
   asking): `gray-matter`, `unified`, `remark-parse`, `remark-gfm`, `remark-frontmatter`,
   `unist-util-visit`, `commander`, `ignore` (gitignore-pattern matching, §10 risk #4) as runtime deps;
   `vitest`, `@types/node`, `eslint` + `typescript-eslint` (`@eslint/js`) as dev deps. None are paid
   services or telemetry — all local, MIT/permissive, zero network calls — but listing explicitly per
   the approval gate rather than having a Developer silently `pnpm add` them.
3. **Monorepo pre-commit hook composability.** `.git/hooks/pre-commit` is a single repo-global file.
   This repo also contains `team-tasks/` (a separate npm project) which might one day want its own
   pre-commit hook. Phase 1's design (§9.4) refuses to clobber an existing unrelated hook and prints
   manual-chaining instructions, but does not build a real multi-hook chaining mechanism. Is that
   acceptable for now, or should phase 1 invest in a tiny chaining shim (run every `*.chartroom-hook.js`
   file found in some convention dir)? Recommend deferring the chaining mechanism unless/until
   `team-tasks/` actually needs a hook — but flagging since it's a monorepo-wide concern, not just
   Chart Room's.
4. **`fix-links`'s default write behavior.** §8.4 makes `--write` the *implicit default* (no flag needed
   to apply changes) rather than requiring an explicit `--write` to mutate files, on the reasoning that
   invoking `fix-links` at all signals intent to fix. This is a minor UX/safety trade-off (a typo'd
   `chartroom fix-links` with no `--dry-run` mutates files repo-wide) worth a quick gut-check rather
   than silently shipping either way.

---

## 13. Definition of DONE mapping (for the Reviewer, once implemented)

| DoD item | How satisfied |
|---|---|
| Builds clean | `pnpm --filter chartroom build` (tsc) succeeds, `turbo run build` picks it up as the first real buildable package |
| Lint passes | package-scoped `eslint.config.mjs`, `turbo run lint` clean |
| Tests pass | `vitest run` — all §11.1 unit tests green |
| Acceptance script | `node packages/chartroom/acceptance/git-mv-resolution.mjs` exits 0 (§11.2) |
| Usage note | `packages/chartroom/README.md` — install + all 5 commands + hook behavior summary |

Nothing in this package touches `team-tasks/` or deletes/renames anything without logging it in
`REMOVALS.md` first (nothing found needing removal during this research pass).
