# Package 2 — Chart Room Phase 2: Viewer (read-only)

**Team Lead session.** Branch: `ship-wave1-cr-phase-2` (verified checked out, do not switch/create branches).
Status: plan awaiting First Officer approval. **No implementation, no `npm`/`pnpm install`, no stub files beyond this document.**

Spec source: `suite-design/ChartRoom_Spec.md` §8 build-order item 2 (authoritative acceptance line), read against
§2 (link/ID system — phase 1, reused verbatim), §3 (viewer/editor, viewer-only slice), §6 (staleness — scoped
down per task brief), §7 (stack), §10 (out of scope). Phase-1 code read in full:
`packages/chartroom/src/{repo,frontmatter,markdown,link-paths,index-schema,indexer,resolver,check,cli}.ts` +
`src/commands/*.ts`, `acceptance/git-mv-resolution.mjs`.

---

## 0. Scope recap (so approval is against the right bar)

Phase 2 = a **read-only** browser viewer over one or more registered repos' markdown docs, served by a local
daemon (`chartroom serve`). Literal deliverables (Build Order §8 item 2): daemon, repo registry, pretty
rendering, TOC, collapsing, backlinks, images (path+URL), `:::llm`/`:::human` rendering, missing-link tombstone
display. Acceptance: **browse two registered repos in one UI; broken link shows tombstone info.**

Explicitly **not** phase 2 (confirmed by re-reading §3/§6/§10 against the Build Order's actual phase-2 line):
- Milkdown/WYSIWYG editing, image paste, Ctrl+K link picker — phase 3. Nothing in this plan writes to any doc
  file, ever. Byte-fidelity/phantom-diff risk (spec §3's editor worry) **does not apply to phase 2 at all** —
  worth stating plainly since it's the headline risk of the whole ChartRoom project and phase 2 sidesteps it
  entirely by construction.
- `:::ask-me`/checklist write-back, `:::actions`, human-action inbox — phase 4. `remark-directive` will still
  *parse* any `:::ask-me`/`:::actions` blocks present in real docs (it doesn't discriminate by directive name),
  but phase 2 renders them via an inert fallback (children rendered plain, no special UI), never their write-back
  semantics. See §6.4.
- MCP server, `chart-room` skill, `PostToolUse` hook, `llms-txt` — phase 5.
- **A full staleness dashboard.** Spec §6's header says "Staleness (phase 2...)" and §10 also parenthetically
  tags "staleness dashboard (phase 2)" as out-of-scope-for-v1 — but the Build Order's actual, authoritative
  phase-2 acceptance line (§8 item 2) does **not** mention `ttl_days`, `sources:`, orphan detection, or a
  dashboard at all — only "missing-link tombstone display." This is a real spec inconsistency (§6/§10's loose
  phase-2 labels vs. §8's precise build-order text), not something I'm resolving by guessing the bigger scope.
  **This plan implements only tombstone display** (reusing phase 1's `check.ts`/`indexer.ts` `deleted` map
  verbatim) and explicitly does **not** implement `ttl_days` freshness gates, `sources:` checks, or orphan
  detection in the viewer. Flagged again in §11 for Captain/First Officer sign-off.
- Multi-repo registry persistence beyond what "browse two registered repos in one UI" needs — see §5, kept to
  a flat JSON file + one CLI verb, no UI-side add/remove/rename management surface.
- Any modification to phase-1 doc files. Phase 2 is read-only end to end: the daemon reads, chokidar watches,
  the UI renders. No write path exists in this plan.

---

## 1. Research findings

All package versions below were verified against the live npm registry today (2026-07-05), not recalled from
training data — noted per-line as **[verified]**. Where I made an architectural judgment call without an
authoritative external source, it's marked **[assumed/judgment]**.

### 1.1 Daemon HTTP layer — Fastify **[verified]**

- `fastify` **5.9.0** — current major already used implicitly by the spec (§7 names "Fastify"); confirmed this
  is the latest published major, not a stale assumption.
- `@fastify/static` **9.1.3** — serves the built UI bundle (prefix `/`) *and*, registered a second/third/…time
  (once per registered repo, prefix `/api/repos/<repoId>/raw/`, `root: <repoRoot>`), serves raw doc/image bytes
  directly from each repo's working tree. Chosen deliberately over hand-rolling a raw-file route: `@fastify/static`
  already solves both problems a hand-rolled route would need to get right itself — **path-traversal guarding**
  (it rejects `../` escapes out of the box) and **correct `Content-Type` by extension** (internal `mime`
  handling) — so phase 2 needs zero new logic for either. Multiple registrations of the same plugin require
  `decorateReply: false` on all but the first (documented `@fastify/static` requirement to avoid a
  `reply.sendFile already exists` decoration conflict) — flagged here so the Developer doesn't rediscover this
  the hard way.
- No `@fastify/cors` needed — the UI is always served same-origin from the same daemon process (no separate
  dev-server-vs-daemon-origin CORS problem in production; in dev, Vite's own proxy config handles cross-port
  API calls, see §1.2).
- Fastify's built-in `app.inject()` testing helper (no separate library) is used for **all** phase-2 backend
  tests instead of spinning a real TCP listener — it exercises the exact same route/plugin code path minus the
  socket, is Fastify's own recommended testing pattern, and avoids port-conflict flakiness entirely. This is
  also used by the phase-2 acceptance script (§8.2) rather than a real `.listen()` + `fetch()`.

### 1.2 File watching — chokidar, version pinned to v4, not the newer v5 **[verified, judgment]**

- `chokidar` **5.0.0** exists (published 2025-11-25) but requires `engines.node >= 20.19.0`.
- `chokidar` **4.0.3** (published 2024-12-18, mature/stable) requires only `engines.node >= 14.16.0`.
- Phase 1's `packages/chartroom/package.json` already declares `"engines": { "node": ">=20" }` — not
  `>=20.19`. Picking v5 would silently tighten that floor repo-wide the moment phase 2 adds it as a dependency.
  **Decision: pin to `chokidar ^4.0.3`**, the safer, longer-proven major, and explicitly avoid the node-floor
  bump. Flagged in §7 for approval alongside the rest of the dependency list; noting v5 exists in case the
  First Officer would rather standardize on latest-and-bump-engines instead — a legitimate call either way, not
  guessed silently.
- Usage pattern: one `chokidar.watch(repoRoot, { ignored, ignoreInitial: true, awaitWriteFinish: {
  stabilityThreshold: 100 } })` per registered repo (not a single global watcher over `~/.chartroom` or similar
  — each repo's watcher is independent so one repo's churn never triggers rebuilds in another). On any
  `add`/`change`/`unlink`/`addDir`/`unlinkDir` event, a hand-rolled ~200ms debounce (plain `setTimeout`, no new
  dependency — rejected `lodash.debounce`/similar as unnecessary for one call site) collects the burst and
  triggers exactly one `buildFreshIndex` + `writeIndex` + backlinks recompute for that repo.
- **Ignore strategy — deliberately does *not* touch phase-1's `repo.ts`.** `repo.ts`'s `BUILTIN_SKIP_DIRS`
  set and its `.gitignore`-aware `ignore()` instance are both **not exported** (private module-level values).
  Rather than adding an `export` keyword to a phase-1 file (a real, if trivial, touch to code the mission says
  is "already implemented... do not redo"), the daemon's chokidar `ignored` option gets its own small, duplicated
  literal list (`.git`, `node_modules`, `.turbo`, `dist`, `coverage`, `.docs`) as a glob-ignore function. This is
  acceptable duplication because chokidar's ignore option only needs to be a *cheap over-approximation* — its
  only job is "don't bother waking up the rebuild for obviously-irrelevant churn"; the actual source of truth for
  "what counts as a doc" is `buildFreshIndex`'s own `discoverDocFiles` call (fully `.gitignore`-aware already),
  which re-filters correctly on every rebuild regardless of what chokidar over-fired on. Worst case of the
  duplication drifting is a few extra harmless rebuild triggers, never a correctness bug. Noted as a minor,
  optional future cleanup (exporting `BUILTIN_SKIP_DIRS` from `repo.ts`) in §11, not required for this phase.

### 1.3 Rendering stack — react-markdown + remark-directive family **[verified]**

- `react-markdown` **10.1.0** — renders markdown to React elements; accepts `remarkPlugins`/`rehypePlugins`
  arrays and a `components` map for overriding/adding element renderers (including arbitrary custom tag names,
  needed for `:::llm`/`:::human` — see §1.4).
- `remark-gfm` **4.0.1** (already a phase-1 dependency; reused unmodified — GFM tables/task-lists/strikethrough
  for "pretty rendering").
- `remark-directive` **4.0.0** — parses `:::name{attrs}` container/leaf/text directives into mdast
  `containerDirective`/`leafDirective`/`textDirective` nodes. **New to phase 2** (phase 1 never touched
  directive syntax, confirmed by grep — phase 1's `markdown.ts` pipeline is `remark-parse` + `remark-gfm` +
  `remark-frontmatter` only).
- `remark-directive-rehype` **1.0.0** — converts any parsed directive node straight into a hast element using
  the directive's name as the tag (`llm`, `human`, `ask-me`, `actions`, whatever's present) and its attributes
  as element properties, so `remarkPlugins: [remarkGfm, remarkDirective]` + `rehypePlugins` order
  `[remarkDirectiveRehype-equivalent-as-a-remark-plugin... ]` — **correction while researching**: `remark-directive-rehype`
  is itself a *remark* plugin (it runs on the mdast tree, before the mdast→hast conversion react-markdown does
  internally), not a rehype plugin despite the name; it must go in `remarkPlugins` **after** `remarkDirective`
  in the array (`[remarkGfm, remarkDirective, remarkDirectiveRehype]`). Verified its own dependencies are small
  and safe (`hastscript ^9`, `unist-util-map ^4` — both standard unified-ecosystem micro-packages, not deep
  transitive risk). Version `1.0.0` is its first stable release — flagged as a maturity risk in §9 risk list,
  with a documented ~15-line hand-rolled fallback plan if it proves unsuitable during implementation (directly
  reading `node.name`/`node.attributes` off the directive mdast nodes and setting `hName`/`hProperties` in a
  tiny custom remark plugin — the same technique `remark-directive-rehype` itself uses).
- `rehype-slug` **6.0.0** — well-established (github-slugger-based), adds a stable `id` to every heading
  element. Used for anchor ids that both the TOC sidebar and the collapsing plugin (§1.5) key off of.
- **Considered and rejected:** `remark-collapse` (**0.1.2** — pre-1.0, looks unmaintained, wrong shape for what's
  needed anyway — it collapses whole *documents* behind one summary, not per-section); `remark-flexible-toc`
  (**1.2.6**, viable, but rejected to avoid an extra dependency when the same TOC data is trivially derivable
  from a heading-with-depth pre-pass using packages already being added for other reasons — see §1.6).
- Considered and **deferred, not added**: `mermaid` (**11.16.0**, verified real/current). Spec §3's general
  "Reading" bullet lists "GFM + Mermaid," but the Build Order's literal phase-2 acceptance line does not mention
  diagrams at all. This is the same category of scope ambiguity as staleness (§0) — flagged explicitly in §11
  rather than guessed. My recommendation: defer Mermaid out of phase 2 (it's a real, non-trivial ~/11MB
  dependency, not "pretty rendering" in the minimal sense the acceptance line asks for), but it's cheap to add
  later as an isolated `components: { code: ... }` override with no architectural knock-on effects, so deferring
  costs nothing.

### 1.4 Custom directive tag rendering via react-markdown's `components` map **[verified via react-markdown 10.x API]**

`react-markdown`'s `components` prop accepts any lowercase key and maps it to a React component receiving the
hast element's properties as props plus `children` — this works for the non-standard tag names
`remark-directive-rehype` produces (`llm`, `human`) exactly the same way it works for standard tags (`h1`, `img`,
`a`, ...). No additional dependency needed for this mechanism; it's core `react-markdown`/`hast-util-to-jsx-runtime`
(**2.3.6**, verified) behavior.

### 1.5 Section collapsing — hand-rolled rehype plugin using native `<details>`/`<summary>` **[judgment]**

No suitable off-the-shelf "wrap markdown sections into collapsible regions" plugin was found in the ecosystem
search (checked `rehype-sectionize` — doesn't exist on npm; `remark-collapse` — wrong shape, low maturity, see
§1.3). **Decision: hand-roll a small (~40-60 line) rehype plugin** (`src/rehype/rehype-sectionize.ts` in
`chartroom-ui`) that does a single linear pass over the hast root's children: on each heading node encountered,
start a new `<details open><summary>{heading}</summary>...</details>` wrapper and push every subsequent sibling
into it until the next heading of equal-or-shallower depth. Nesting (an h2 following an h1) naturally produces
nested `<details>` by recursing the same grouping rule one level per depth-jump. This is a strong design choice
over a custom-JS-state toggle component: `<details>`/`<summary>` are native, accessible, keyboard-operable,
require zero React state, and are trivially unit-testable as pure hast-tree assertions (no DOM/React rendering
needed for the core logic, only the html output shape). Default: sections start **open** (this is a browsing
tool, not a docs site optimizing initial paint — nothing in the spec mandates default-collapsed, and open-by-
default matches the phase-1 precedent of "small hand-rolled heuristic, safe default, cheap to flip later").
Known limitation, noted not fixed: a document containing genuine nested `<section>` HTML (raw HTML blocks) could
interact oddly with the plugin's flat top-level assumption — real repos overwhelmingly don't do this; flagged as
a documented edge case, not a blocker.

### 1.6 TOC generation — independent pre-pass, not tied to React's render cycle **[judgment]**

Rather than collecting TOC entries via a mutable ref during `react-markdown`'s JSX render pass (a common but
fiddly pattern requiring careful reset-per-render + `useEffect` synchronization), phase 2 runs a **separate,
pure, testable pre-pass** over the raw markdown using the *same* remark stack already being added
(`unified().use(remarkParse).use(remarkGfm).use(remarkDirective)`, parse-only, never stringified) to walk heading
nodes and their depth via `unist-util-visit` (already a phase-1 dependency, reused unmodified) — a small,
~15-line function in `chartroom-ui`, structurally similar to (but not imported from) phase-1's
`markdown.ts::extractHeadings`, extended to also capture `depth` and a slug computed identically to
`rehype-slug`'s own algorithm (github-slugger; `rehype-slug`'s underlying slug library, `github-slugger`, can be
imported standalone for this — confirmed it's `rehype-slug`'s own dependency, not a new top-level addition to
request separately). **Why not import phase-1's `markdown.ts` directly:** it's plumbing for `packages/chartroom`
(the Node CLI), and while its actual imports (`unified`/`remark-parse`/`remark-gfm`/`remark-frontmatter`/
`unist-util-visit`) are all browser-safe, importing across packages here would pull `chartroom-ui` into a
dependency direction that's architecturally backwards (UI depending on the CLI tool package) and would need
`chartroom`'s `package.json` to expose these internals via a public export map it doesn't have. A small,
deliberate ~15-line duplication is cheaper and cleaner than that. Not touching `index-schema.ts`'s
`DocEntry.headings: string[]` shape at all for this — that field remains phase-1's exact original shape
(depth-less; still used only for phase 1's own fuzzy-match resolver), so **zero phase-1 schema changes are
needed anywhere in this plan** — TOC data is derived independently, client-side, from the raw doc content the
daemon already serves.

### 1.7 UI toolchain — Vite + React **[verified]**

- `vite` **8.1.3**, `@vitejs/plugin-react` **6.0.3** (confirmed compatible major pairing by checking both were
  published in the same recent window; SWC-based `@vitejs/plugin-react-swc` **4.3.1** also exists as an
  alternative — sticking with the Babel-based plugin since this is a small app, build-speed isn't a concern,
  and it's the more conventional/lower-surprise default).
- `react` / `react-dom` **19.2.7** (current).
- No client-side router added. **Decision:** use hash-based navigation (`#/repo/<repoId>/doc/<docId>`) with
  plain `useState`/`useSyncExternalStore`-on-`hashchange` — no `react-router` dependency needed for a
  single-page repo-switcher + doc-view app, and it sidesteps a real architectural question for free: the hash
  fragment never reaches the server, so `@fastify/static`'s default "serve `index.html` for `/`" behavior
  already handles deep-link refreshes correctly with **zero** SPA-fallback/wildcard-route configuration on the
  Fastify side. Flagged as a simplification worth the Reviewer's attention, not a limitation — it's strictly
  less server complexity for equivalent UX at this scale.

### 1.8 Test-rendering the UI without a real browser **[judgment, flagged]**

- `jsdom` **29.1.1** vs `happy-dom` **20.10.6** — both viable vitest DOM environments; picking `jsdom` (the
  long-standing default most vitest/RTL docs assume, marginally slower but more spec-complete than happy-dom,
  and this suite has no perf-sensitive test volume that would justify the trade).
- `@testing-library/react` **16.3.2** + `@testing-library/jest-dom` **6.9.1** — render actual `chartroom-ui`
  components in a vitest+jsdom environment and assert on DOM text/structure (e.g., "tombstone info is visible"),
  without needing a real browser tab or Playwright. See §8.2 for exactly how this composes with the Fastify
  `.inject()` tests into the phase-2 acceptance proof, and §9 risk #1 for the honest limitation of this approach
  (it does not prove the real Vite production bundle boots correctly in an actual browser).

---

## 2. Package location & naming

**Decision: two packages**, not one, not a bare subfolder.

1. **`packages/chartroom`** (existing phase-1 package) gains the **daemon** (Fastify server, registry, chokidar
   watchers, API routes) and two new CLI subcommands (`serve`, `register`) — this is where `npx chartroom serve`
   has to live, since the spec is explicit that `serve` is a subcommand of the *same* `chartroom` binary
   (§7/§9: "`npx chartroom serve` must work from zero config"), not a separately-installed tool.
2. **`packages/chartroom-ui`** (new, `"private": true`, never published/npx-installed on its own) — the
   React+Vite frontend. Built independently (`vite build`), its `dist/` output gets copied into
   `packages/chartroom`'s own `dist/public/` as a build step, so that publishing **only** `packages/chartroom`
   to npm ships a fully self-contained package — `npx chartroom serve` must work from a bare `npm install
   chartroom` with no sibling monorepo packages present, which is only true if the UI's compiled static assets
   physically live inside `chartroom`'s own published `dist/`.

**Why not fold the UI into `packages/chartroom/ui/` as a non-workspace nested project instead:** that would need
either a `pnpm-workspace.yaml` glob change (`packages/chartroom/ui` added alongside `packages/*`/`plugins/*`) or
a separate, un-pnpm-managed `npm install` step inside that folder — both messier than a sibling package that
already matches the existing `packages/*` glob with **zero** workspace-config changes. Turbo's existing
`dependsOn: ["^build"]` for the `build` task already expresses "build my workspace dependencies first" the
moment `chartroom`'s `package.json` lists `"chartroom-ui": "workspace:*"` as a (dev)dependency — no `turbo.json`
changes needed either.

**Flagged for First Officer confirmation** (structural call, same spirit as phase 1's package-naming flag, not
a blocker): this two-package split vs. a single package with two build toolchains side by side. I judge the
split cleaner (matches how many CLI-with-embedded-webview tools structure their monorepos: server package
depends on a UI package purely as a build-time asset), but it's a real architectural choice worth a quick
sign-off before the Developer stage, since it sets the pattern phases 3–5 will likely extend.

- `packages/chartroom-ui/package.json` name: `"chartroom-ui"` (unscoped, matches `chartroom`'s own unscoped
  convention; `"private": true` so accidental `npm publish` is impossible).
- `packages/chartroom-ui/tsconfig.json` **does not extend** the root `tsconfig.base.json`. That base config is
  Node-oriented (`module`/`moduleResolution: "NodeNext"`), fundamentally incompatible with Vite's expected
  `moduleResolution: "bundler"` + DOM lib + `jsx: "react-jsx"` app config. **Flagged explicitly**: this is a
  deliberate, justified deviation from package 0/1's "always extends `tsconfig.base.json`" convention, not an
  oversight — worth the Reviewer double-checking the reasoning holds rather than silently accepting a
  convention break.

---

## 3. Files to create (plan-only; not created yet)

### `packages/chartroom` additions

| Path | Purpose |
|---|---|
| `src/daemon/registry.ts` | Reads/writes `~/.chartroom/repos.json` (§5): `listRepos()`, `registerRepo(absPath)` (idempotent, dedup by resolved absolute path) |
| `src/daemon/repo-state.ts` | Per-repo in-memory state: current `ChartRoomIndex` + computed backlinks map + last `CheckResult` (reuses `check.ts::runCheck` verbatim); `rebuild(repoRoot)` |
| `src/daemon/backlinks.ts` | Pure function `computeBacklinks(index: ChartRoomIndex): Record<string, BacklinkEntry[]>` — inverts every doc's `outbound[].targetId` into `{id, path, title}` entries keyed by the target id (§6.3) |
| `src/daemon/watcher.ts` | chokidar wiring: one watcher per registered repo root, hand-rolled 200ms debounce, calls `repo-state.rebuild()` on settle |
| `src/daemon/server.ts` | Fastify app factory: registers UI static mount + per-repo raw-asset static mounts + API routes; exported `buildServer(registry)` so both `commands/serve.ts` and tests can construct it without `.listen()` |
| `src/daemon/routes/repos.ts` | `GET /api/repos` → `[{id, name, absPath}]` |
| `src/daemon/routes/docs.ts` | `GET /api/repos/:repoId/docs` (list), `GET /api/repos/:repoId/docs/:docId` (single doc: entry + raw content + backlinks + filtered brokenLinks) |
| `src/commands/serve.ts` | `chartroom serve [--port]` — loads registry, builds server, starts watchers, `.listen()`, prints URL |
| `src/commands/register.ts` | `chartroom register [path]` — resolves git root of `path` (default cwd), calls `registerRepo` |
| `test/daemon/backlinks.test.ts` | Unit tests for backlink inversion (§8.1) |
| `test/daemon/registry.test.ts` | Unit tests for registry read/write/idempotent-register |
| `test/daemon/server.test.ts` | Fastify `.inject()` integration tests: repo list, doc fetch, tombstone data shape, raw asset fetch, path-traversal rejection |
| `acceptance/two-repo-browse.mjs` | Phase-2 acceptance script (§8.2) |
| `package.json` | Add `fastify`, `@fastify/static`, `chokidar`, `remark-directive`, `remark-directive-rehype` as runtime deps (§7); `chartroom-ui: workspace:*` as a devDependency (build-order wiring only) |
| `scripts/copy-ui-dist.mjs` | Build-step script: copies `../chartroom-ui/dist` → `./dist/public`; invoked by `package.json`'s `build` script after `tsc` |

### `packages/chartroom-ui` (new package)

| Path | Purpose |
|---|---|
| `package.json` | `"private": true`; React 19 + Vite 8 deps (§7) |
| `vite.config.ts` | Vite + `@vitejs/plugin-react`; dev-mode proxy of `/api` to the daemon's port |
| `tsconfig.json` | Standalone (not extending root base — §2), DOM lib, `moduleResolution: bundler`, `jsx: react-jsx` |
| `vitest.config.ts` | `environment: 'jsdom'` |
| `index.html` | Vite entry |
| `src/main.tsx` | React root mount |
| `src/App.tsx` | Top-level shell: repo switcher + hash-route dispatch (§1.7) |
| `src/api/client.ts` | Typed `fetch` wrapper for the daemon's `/api/*` endpoints |
| `src/components/RepoSwitcher.tsx` | Repo list/switcher UI |
| `src/components/Sidebar.tsx` | Doc list + TOC (consumes §1.6's pre-pass output) |
| `src/components/DocView.tsx` | Renders one doc: `ReactMarkdown` with `remarkPlugins: [remarkGfm, remarkDirective, remarkDirectiveRehype]`, `rehypePlugins: [rehypeSlug, rehypeSectionize]`, `components` map (headings, `img`, `a`, `llm`, `human`, directive fallback) |
| `src/components/TombstoneBadge.tsx` | Renders "missing (was `<lastPath>`, gone since `<deletedAt>`)" for a broken/tombstoned outbound link (§6.5) |
| `src/components/BacklinksPanel.tsx` | Renders the backlinks list for the current doc |
| `src/components/LlmBlock.tsx` / `HumanBlock.tsx` | `:::llm` (collapsed body behind visible tldr) / `:::human` (plain passthrough) renderers |
| `src/components/DirectiveFallback.tsx` | Inert passthrough renderer for any other directive name (`ask-me`, `actions`, …) — phase-4 blocks degrade to plain visible content, never crash (§0) |
| `src/rehype/rehype-sectionize.ts` | Hand-rolled collapsing plugin (§1.5) |
| `src/toc/extractToc.ts` | Heading+depth+slug pre-pass (§1.6) |
| `src/styles/base.css` | Minimal styling incl. `prefers-color-scheme` dark mode |
| `test/rehype-sectionize.test.ts` | Pure hast-tree assertions (no DOM/React needed) |
| `test/extractToc.test.ts` | Pure function unit tests |
| `test/DocView.test.tsx` | jsdom+RTL: renders a fixture doc, asserts tombstone text, backlinks list, collapsed `:::llm` tldr, directive fallback for an unrecognized directive |
| `README.md` | What this package is, that it's build-only/private, how it's consumed by `chartroom` |

No files are created by this Team Lead session — this table is the Developer stage's shopping list, same
convention as phase 1's plan §3.

---

## 4. Daemon design

### 4.1 What it serves

- **Static UI** — `@fastify/static` mounted at `prefix: '/'`, `root: dist/public` (copied from `chartroom-ui`'s
  build, §2/§3). Default "serve `index.html` for unmatched `/` requests" behavior handles hash-route deep links
  with no extra config (§1.7).
- **Raw repo bytes** — one additional `@fastify/static` registration per registered repo, `prefix:
  '/api/repos/<repoId>/raw/'`, `root: <repoRoot>`, `decorateReply: false` (all but the very first
  registration). Serves both doc source (an alternate path to fetch a `.md` file's bytes directly) and, more
  importantly, **images** — the UI rewrites any relative image `href` in rendered markdown into
  `/api/repos/<repoId>/raw/<repo-relative-path>` (computed client-side by joining the current doc's directory
  with the written href, mirroring exactly the relative-path convention phase-1's `link-paths.ts::
  computeExpectedHref` already encodes for links — same mental model, not new logic to invent). URL images
  (`http(s)://…`) pass through untouched, per spec §2.2/§3.
- **JSON API:**
  - `GET /api/repos` → registry contents (§5).
  - `GET /api/repos/:repoId/docs` → `[{id, path, title}]` for every doc with an id, plus unidentified docs
    (id: null) — mirrors phase-1's `index.docs` + `index.unidentified` shape directly, no reshaping needed
    beyond flattening to an array.
  - `GET /api/repos/:repoId/docs/:docId` → `{ doc: DocEntry, raw: string, backlinks: BacklinkEntry[],
    brokenLinks: BrokenLinkIssue[] }` — `raw` is the file's current bytes (`readFileSync` against the already-
    known, already-inside-repoRoot path from the index, so no user-supplied-path traversal risk here at all);
    `brokenLinks` is `check.ts::runCheck(repoRoot).brokenLinks` **filtered to `path === doc.path`** — i.e. this
    endpoint is the literal, direct reuse point for "broken link shows tombstone info" (§0/§6.5) — phase 2 adds
    **zero** new tombstone-detection logic, it only surfaces what `check.ts` (phase 1, unmodified) already
    computes.

### 4.2 chokidar watch strategy

Covered in depth in §1.2. Summary: one watcher per registered repo root, debounced rebuild via
`buildFreshIndex` (phase 1, unmodified) + `writeIndex` (keeps `.docs/index.json` on disk current too, same
"always-fresh" side effect phase 1's `resolve`/`check`/`fix-links`/hook already rely on) + a backlinks
recompute (§6.3) + a fresh `runCheck` (for updated tombstone/broken-link data), all stored in that repo's
in-memory `repo-state.ts` slot, replacing the previous snapshot atomically (no readers ever see a half-updated
state — the in-memory reference is swapped, not mutated in place).

### 4.3 How `npx chartroom serve` boots this

`chartroom serve [--port <n>]` (default port: first free port starting from e.g. 4317, found via a small
hand-rolled "try listen, on EADDRINUSE try next" loop — **not** adding the `get-port` npm package (verified,
**7.2.0**, trivial) for a two-line loop; flagged as a considered-and-rejected micro-dependency, matching phase
1's own "don't add a dependency for 20 lines" precedent):
1. `registry.listRepos()` — reads `~/.chartroom/repos.json`, creates the directory/empty file if missing.
2. For each registered repo: initial `buildFreshIndex` + `writeIndex` + backlinks + check (§4.2, first run).
3. `buildServer(registry, repoStates)` — registers all static mounts + API routes (all registered repos' raw-
   asset mounts are known and fixed at this point, §5's "restart to pick up new registrations" tradeoff).
4. Start chokidar watchers (§4.2) — one per repo, kept running for the process lifetime.
5. `.listen({ port, host: '127.0.0.1' })` (loopback-only — this is a local-first, single-user tool per spec §1;
   no reason to bind `0.0.0.0`). Print the URL to stdout.
6. `open` (verified **11.0.0**) is **not** added as a dependency for auto-launching a browser tab — printing
   the URL and letting the user click it is simpler, one fewer dependency, and avoids platform-specific
   quirks; flagged as a nice-to-have the First Officer can request if wanted, not assumed.

---

## 5. Repo registry design

**Minimal, per the task brief's explicit "not overbuilt" instruction.**

- `~/.chartroom/repos.json` — flat JSON: `{ repos: [{ id: string, absPath: string, addedAt: string }] }`. `id`
  is a filesystem-safe slug derived from the repo directory's basename, de-duplicated with a numeric suffix on
  collision (same pattern as phase-1's `id.ts` collision suffixing, reused conceptually not literally — this is
  a different id namespace, repo-ids vs. doc-ids, kept deliberately separate rather than accidentally conflated).
- **One new CLI verb:** `chartroom register [path]` — resolves `path`'s (default: cwd's) git root via phase-1's
  `findGitRoot` (reused verbatim), adds it to the registry if not already present (dedup by resolved absolute
  path, not by id) — idempotent, safe to re-run.
- **No `unregister` command in this phase** — trivial to add later (five-minute change), deliberately deferred
  to avoid scope creep per the task brief; if the First Officer wants it included now for symmetry, flagging
  it's cheap to add, not a design blocker.
- **No UI-side registration surface** — registering a repo is CLI-only. The daemon reads the registry file
  **once, at `chartroom serve` startup**; a repo registered while `chartroom serve` is already running requires
  a restart to appear (documented limitation, not live-reloadable). This keeps all `@fastify/static` mounts
  static/fixed-at-boot (§4.1), sidestepping Fastify's "avoid registering plugins after `.listen()`" caution
  entirely, rather than building a live-reload-the-registry mechanism nobody asked for. The acceptance
  criterion's natural flow (register both repos, *then* `chartroom serve`) never exercises this limitation.
- This satisfies "browse two registered repos in one UI" exactly: `chartroom register ./repoA && chartroom
  register ./repoB && chartroom serve` → one process, one port, a repo switcher in the UI listing both.

---

## 6. Rendering design

### 6.1 Pretty markdown rendering
`react-markdown` with `remarkPlugins: [remarkGfm, remarkDirective, remarkDirectiveRehype]`,
`rehypePlugins: [rehypeSlug, rehypeSectionize]` (§1.3–1.5), fed the doc's `raw` string from the API response
verbatim (frontmatter block included — `remark-frontmatter` is **not** added to the UI's parse pipeline, since
react-markdown doesn't need to *render* the YAML block, just skip it; a lightweight separate frontmatter-strip
using the same `FRONTMATTER_RE`-style leading-block regex phase-1's `frontmatter.ts` uses, reimplemented as a
2-line helper in `chartroom-ui` — not imported cross-package for the same reason as §1.6 — strips it before
handing content to `react-markdown`, and the stripped `title`/`id` fields are read directly from the already-
parsed `DocEntry`/API response instead, so the UI never needs its own YAML parser dependency at all).

### 6.2 TOC + collapsing
Covered fully in §1.5/§1.6. Sidebar renders the `extractToc` pre-pass output as a nested, clickable outline
(`<a href="#<slug>">`); `DocView`'s rendered `<details>` sections share the exact same `id` (via `rehype-slug`)
so TOC links and in-document anchors always agree.

### 6.3 Backlinks
`computeBacklinks(index)` (new, `src/daemon/backlinks.ts`) inverts `index.docs[id].outbound[].targetId` — for
every doc `A` with an outbound link whose `targetId === B`, push `{id: A's id, path: A.path, title: A.title}`
into `backlinks[B]`. Computed once per index rebuild (on daemon startup and on every chokidar-triggered rebuild,
§4.2), stored alongside the index in `repo-state.ts`, sliced per-doc when serving `GET
/api/repos/:repoId/docs/:docId`. Pure, ~15-line function, straightforward to unit test in isolation (§8.1)
without needing a real repo on disk.

### 6.4 Images (path + URL)
Relative hrefs → rewritten client-side to `/api/repos/:repoId/raw/<resolved-repo-relative-path>` (§4.1); URL
images pass through untouched (a custom `img` component in `DocView`'s `components` map does this one string
check + rewrite, nothing more).

### 6.5 `:::llm` / `:::human` rendering
- `LlmBlock`: renders the directive's `tldr` attribute prominently and *always visible*; wraps `children`
  (the block's full body) in a native `<details>` (same native-collapse mechanism as §1.5, reused, not a second
  implementation) so it's collapsed by default with a "show full context" toggle — matches spec §4.2's "viewer
  shows the human TLDR, full body collapsed behind it" exactly.
- `HumanBlock`: renders `children` plainly, no collapsing, no special chrome — per spec §4.2, the "skip this"
  instruction is a phase-5 agent-skill concern, not a viewer-rendering concern; the viewer shows it like normal
  content.
- `DirectiveFallback`: any directive name that isn't `llm`/`human` (i.e. `ask-me`, `actions`, or anything else)
  renders its children in a neutral, unstyled wrapper — degrades gracefully exactly as spec §4.2's closing line
  promises ("degrade to visible text in any other renderer"), with zero write-back/interactive behavior (§0).

### 6.6 Missing-link tombstone display
The `brokenLinks` array already computed by phase-1's `check.ts::runCheck` (unmodified — this is the single
biggest reuse point in the whole plan) is threaded straight through the API response (§4.1) to
`TombstoneBadge`, which renders, for each broken outbound link in the current doc: link text as written, plus
either "missing (was `<lastPath>`, gone since `<deletedAt>`)" (tombstone case) or "missing (id `<targetId>` not
found)" (not-found case) — matching the spec's exact "never a silent 404" framing (§2.3) in the UI, not just
the CLI.

---

## 7. New dependencies needing approval (per the "never add dependencies without asking" rule)

All verified live against the npm registry today (§1), not guessed:

**`packages/chartroom` (runtime):** `fastify` (^5.9.0), `@fastify/static` (^9.1.3), `chokidar` (^4.0.3),
`remark-directive` (^4.0.0), `remark-directive-rehype` (^1.0.0).
**`packages/chartroom` (dev):** `chartroom-ui` (`workspace:*`, build-order wiring only, never itself
published).

**`packages/chartroom-ui` (runtime):** `react` (^19.2.7), `react-dom` (^19.2.7), `react-markdown` (^10.1.0),
`remark-gfm` (^4.0.1, same version already used by phase 1 — kept in lockstep deliberately),
`remark-directive` (^4.0.0), `remark-directive-rehype` (^1.0.0), `rehype-slug` (^6.0.0).
**`packages/chartroom-ui` (dev):** `vite` (^8.1.3), `@vitejs/plugin-react` (^6.0.3), `typescript` (^5.7.3,
matching phase 1), `vitest` (^3.0.4, matching phase 1), `jsdom` (^29.1.1), `@testing-library/react` (^16.3.2),
`@testing-library/jest-dom` (^6.9.1), `@types/react` / `@types/react-dom` (matching React 19), `eslint` +
`typescript-eslint` (matching phase 1's package-scoped lint convention).

**Explicitly considered and rejected** (noted so a Developer doesn't second-guess and add them anyway):
`mermaid` (§1.3, deferred — flagged in §11), `remark-collapse` (§1.3, wrong shape/low maturity), `get-port`
(§4.3, 2-line loop not worth a dependency), `open` (§4.3, print-URL is simpler), `react-router`/any router
(§1.7, hash-nav is enough at this scale), `remark-flexible-toc` (§1.6, TOC derivable from packages already
being added).

None are paid services, telemetry, or make network calls at runtime (chokidar/fastify/react-markdown/etc. are
all local, MIT/permissive). Listing explicitly per the approval gate, same as phase 1's §9/§12.

---

## 8. Test plan

### 8.1 Unit tests
- **`backlinks.test.ts`** (`packages/chartroom`): hand-built in-memory `ChartRoomIndex` fixtures (no filesystem)
  — a doc with no inbound links → empty backlinks array; two docs linking to a third → both appear in the
  third's backlinks; a doc linking to a tombstoned/not-found id → contributes no backlink entry (only links
  resolving to a live `docs[id]` count).
- **`registry.test.ts`**: register once → one entry; register the same absolute path twice → still one entry
  (idempotent); register two different paths that happen to share a basename → distinct ids via collision
  suffixing; registry file created if `~/.chartroom/` doesn't exist (using a temp `HOME`-equivalent override
  for the test, not the real user home directory).
- **`server.test.ts`** (Fastify `.inject()`, §1.1): `GET /api/repos` returns both registered fixture repos;
  `GET /api/repos/:id/docs/:docId` for a doc with a stale/tombstoned outbound link returns `brokenLinks`
  containing the tombstone's `lastPath`/`deletedAt`; a raw-asset request with a path-traversal attempt
  (`../../../etc/passwd`-style) is rejected (proves `@fastify/static`'s built-in guard is actually wired
  correctly, not just assumed).
- **`rehype-sectionize.test.ts`** (`chartroom-ui`, pure hast assertions, no DOM): a flat sequence of
  heading/paragraph hast nodes at mixed depths → asserts the correct nested `<details>` structure; a document
  with no headings at all → unchanged passthrough (no spurious wrapping).
- **`extractToc.test.ts`**: heading depth/slug extraction against hand-written markdown fixtures, including a
  duplicate-heading-text case (asserts slug de-duplication, matching `rehype-slug`'s own de-dup convention so
  the two never disagree).
- **`DocView.test.tsx`** (jsdom + RTL, §1.8): renders a fixture doc prop (shaped exactly like the API's
  `docs/:docId` response) and asserts: tombstone text is present for a broken link; the `:::llm` block's tldr is
  visible while its body is inside a `<details>` (closed by default); an unrecognized directive (`:::ask-me`)
  renders its plain text content without throwing or producing empty output; backlinks panel lists the expected
  entries.

### 8.2 Acceptance proof — "browse two registered repos in one UI; broken link shows tombstone info"

Two-layer proof, deliberately **not** using a real browser/Playwright (see honest limitation in §9 risk #1):

1. **`acceptance/two-repo-browse.mjs`** (`packages/chartroom`, mirrors phase-1's disposable-scratch-repo
   pattern in `acceptance/git-mv-resolution.mjs`, adapted): scaffolds **two** separate throwaway `git init`
   scratch repos (`fs.mkdtempSync`), each with a couple of docs; in one repo, `git mv`/delete a target doc to
   produce a real tombstone entry (reusing exactly the same tombstone-creation mechanism phase 1's own
   acceptance script and `indexer.test.ts` already exercise) and leave a link to it. Registers both repos into
   a **temp-`HOME`-scoped** registry file (never touches the real user's `~/.chartroom/repos.json`). Builds the
   Fastify server via `buildServer()` and drives it entirely through `.inject()` (no real port): asserts (a)
   `GET /api/repos` lists both scratch repos; (b) the doc-with-the-broken-link's `GET .../docs/:docId` response
   includes a `brokenLinks` entry with `matchType: 'tombstone'` and the correct `lastPath`. This proves the
   **data half** of the acceptance line, end-to-end through the real HTTP route/plugin code path, for real
   registered repos, without a browser.
2. **`DocView.test.tsx`** (§8.1, already in the unit suite) proves the **rendering half** — that this exact
   shape of API response, when handed to the real `DocView` React component, produces visible tombstone text in
   the DOM (via jsdom), not just that the JSON contains the right field. Combined, (1)+(2) prove "broken link
   shows tombstone info" without needing to launch a real browser tab, and (1) alone proves "browse two
   registered repos in one UI" at the routing/data level (both repos are reachable through one running server
   process).

### 8.3 Spec acceptance criteria → verification mapping

| Spec acceptance criterion (§8 item 2) | How this plan verifies it |
|---|---|
| "browse two registered repos in one UI" | Acceptance script step (1): `GET /api/repos` via `.inject()` lists both scratch repos through one `buildServer()` instance; `registry.test.ts` proves registration plumbing itself |
| "broken link shows tombstone info" | Acceptance script step (2) (API-level `brokenLinks` shape) + `DocView.test.tsx` (rendering-level DOM assertion) — see §9 risk #1 for what this does *not* prove |
| (implicit) daemon/registry/watcher wiring works | `server.test.ts` + `backlinks.test.ts` + `registry.test.ts` |
| (implicit) directive rendering doesn't crash on unknown/phase-4 directives | `DocView.test.tsx`'s `:::ask-me` fallback case |
| (implicit) TOC/collapsing produce correct structure | `extractToc.test.ts` + `rehype-sectionize.test.ts` |

---

## 9. Risks (riskiest first)

1. **[Riskiest, flagged honestly] No real-browser smoke test in this plan.** §8.2's two-layer proof (Fastify
   `.inject()` + jsdom/RTL component rendering) proves the data pipeline and the rendering *logic* both work,
   but it does **not** prove the actual built Vite production bundle boots correctly in a real browser (e.g., a
   `vite.config.ts` misconfiguration, a bundling error, a runtime-only browser API misused somewhere, an asset-
   path mismatch between dev and the copied `dist/public`). The task brief explicitly said to flag rather than
   guess here: **I'm recommending the Reviewer do one manual pass** — run `chartroom serve` for real (or use
   the `claude-in-chrome`/browser tooling available in this environment) and click through both repos once —
   rather than adding Playwright as a new dependency for phase 2 to automate this, since the acceptance line's
   literal wording doesn't mandate automated browser testing and Playwright is a heavy dependency for one
   phase. **Needs First Officer sign-off** either way (manual QA pass acceptable, or add Playwright — listed
   again in §11).
2. **`remark-directive-rehype`'s maturity** (v1.0.0, first stable release, small but real dependency) — §1.3's
   hand-rolled fallback (a ~15-line custom remark plugin doing the same `hName`/`hProperties` assignment
   directly) is the documented contingency if it proves unsuitable mid-implementation; flagging so the
   Developer doesn't stall rediscovering this.
3. **The tsconfig split** (§2: `chartroom-ui` not extending `tsconfig.base.json`) breaks an established
   monorepo convention from packages 0/1. Justified (Vite bundler-mode resolution vs. Node NodeNext resolution
   are genuinely incompatible), but worth the Reviewer explicitly confirming this reasoning rather than treating
   it as an oversight during review.
4. **Registry "restart to pick up new registrations" limitation** (§5) — a real, if minor, UX rough edge
   (register a third repo while `chartroom serve` is already running → invisible until restart). Low risk
   given the acceptance line's natural flow doesn't hit it, but worth a one-line note in the eventual README so
   it's not mistaken for a bug.
5. **Path-traversal correctness for the raw-asset mounts is delegated entirely to `@fastify/static`'s own
   guarding** (§1.1/§4.1) rather than hand-verified per-request logic in this codebase. Low risk (it's a
   widely-used, actively maintained official Fastify plugin, not an obscure library), but `server.test.ts`'s
   explicit traversal-attempt test (§8.1) exists specifically so this assumption is checked, not just trusted.
6. **chokidar debounce window (200ms) is a guessed constant**, not derived from any spec requirement or
   measurement — low risk (only affects perceived reindex latency after a file change, never correctness, since
   `buildFreshIndex` is always re-run in full on settle), but flagged as a tunable the Reviewer/First Officer
   may want to adjust.

---

## 10. Definition of DONE mapping (for the Reviewer, once implemented)

| DoD item (spec §9 / Build Order §8 item 2) | How satisfied |
|---|---|
| `npx chartroom serve` from zero config | `chartroom serve` boots registry (creating it if absent) + daemon + watchers with no required flags (§4.3) |
| Daemon, repo registry | §4, §5 — Fastify daemon + `~/.chartroom/repos.json` + `chartroom register` |
| Pretty rendering, TOC, collapsing | §6.1, §6.2 — `react-markdown` pipeline + `extractToc` + `rehype-sectionize` |
| Backlinks | §6.3 — `computeBacklinks`, unit-tested in isolation (§8.1) |
| Images (path+URL) | §6.4 — client-side href rewrite to the per-repo raw static mount; URL images pass through |
| `:::llm`/`:::human` rendering | §6.5 — `LlmBlock`/`HumanBlock`, `remark-directive` + `remark-directive-rehype`, new to phase 2 |
| Missing-link tombstone display | §6.6 — direct reuse of phase-1 `check.ts::runCheck`'s `brokenLinks`, zero new detection logic |
| Acceptance: browse two registered repos in one UI; broken link shows tombstone info | §8.2 two-layer proof (`.inject()` API test + `DocView` RTL render test) — see §9 risk #1 for the one thing it doesn't prove |
| Builds clean | `pnpm --filter chartroom build` (tsc + `copy-ui-dist.mjs`), `pnpm --filter chartroom-ui build` (vite build); `turbo run build` picks up the dependency order via `workspace:*` |
| Lint passes | Package-scoped `eslint.config.mjs` in both packages, `turbo run lint` clean |
| Tests pass | `vitest run` in both packages — all §8.1 unit tests green |
| No staleness dashboard / `ttl_days` / orphan detection built | Confirmed by design — §0/§6.6 scope only tombstone display, nothing else from spec §6 |
| No write path anywhere | Confirmed by design — Reviewer should grep the diff for any `writeFileSync`/`fs.write*` call against a *doc* path (writes to `.docs/index.json` via phase-1's own `writeIndex` are expected and fine; a write to any `*.md` file would be a scope violation) |

---

## 11. Needs First Officer / Captain decision

1. **Two-package split (`packages/chartroom` + new `packages/chartroom-ui`)** — my recommendation (§2), not a
   guess, but a real structural choice that sets precedent for phases 3–5's editor UI work. Please confirm
   before the Developer stage.
2. **New dependencies** (§7's full list) — same approval gate as phase 1. Flagging `chokidar ^4.0.3` vs. the
   newer `^5.0.0` (§1.2) as a specific sub-decision: v4 is the safer/lower-risk pick I'm recommending, but v5 is
   the current major if the First Officer would rather standardize on latest and bump `engines.node` to
   `>=20.19` repo-wide.
3. **Staleness scope ambiguity** (§0) — spec §6's header and §10's parenthetical both loosely tag "staleness
   (dashboard)" as "phase 2," but the Build Order's literal phase-2 acceptance line only asks for tombstone
   display. This plan implements **only** tombstone display and explicitly does not build `ttl_days`/`sources:`
   freshness gates or orphan detection in the viewer. Please confirm this reading is correct before
   implementation, since getting this wrong either direction (over-building a dashboard nobody asked for this
   phase, or under-building if the Captain actually meant §6 to apply now) wastes a full Developer cycle.
4. **Mermaid diagram rendering** (§1.3) — mentioned in spec §3's general "Reading" bullet, absent from the
   Build Order's literal phase-2 line. Recommend deferring; confirm or override.
5. **No automated real-browser smoke test** (§9 risk #1) — recommend a manual Reviewer QA pass over adding
   Playwright as a new dependency for this phase. Confirm acceptable, or approve adding Playwright instead.
6. **`chartroom register`/`unregister` CLI surface minimalism** (§5) — confirm CLI-only registration (no
   `unregister`, no UI-side add) is sufficient for this phase's acceptance bar, or request `unregister` be added
   now for symmetry (cheap either way).
7. Per the mission's standing rule: **never `rm`/delete anything.** Nothing found this session needing removal
   or logging to `REMOVALS.md` — phase 2 is purely additive to phase 1's merged code (no phase-1 file is
   modified by this plan; §1.2 explicitly chose duplication over exporting a phase-1 private constant, and §1.6
   explicitly chose duplication over cross-package import, specifically to keep phase-1's files untouched).
8. `team-tasks/` is never referenced or touched anywhere in this plan — confirmed by design, not by omission.

---

## 12. Note on this Team Lead session's own tool access

This plan was produced by a read-only planning session with no file-write tool available — the plan text above
was returned in-conversation rather than written directly to
`suite-design/overnight/plans/02-cr-phase2-plan.md`. The orchestrating process (First Officer) persisted this
content to that path itself before the next stage (First Officer review) proceeded against the actual file on
disk.
