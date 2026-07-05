# Package 3 — Chart Room Phase 3: Editor (Milkdown, round-trip, image paste, Ctrl+K)

**Team Lead session.** Branch: `ship-wave1-cr-phase-3` (verified checked out, do not switch/create branches).
Status: plan awaiting First Officer approval. **No implementation, no `npm`/`pnpm install`, no stub files beyond
this document, no `git commit`.**

Spec source: `suite-design/ChartRoom_Spec.md` §3 (editing — full fidelity, no shortcuts), §7 (stack), §8 build-order
item 3 (authoritative acceptance line), §9 (DoD), §10 (out of scope). Phase-1 code read in full:
`src/{repo,frontmatter,id,markdown,link-paths,index-schema,indexer,resolver,fix-links,check}.ts`. Phase-2 code
read in full: `src/daemon/{server,registry,repo-state,backlinks,watcher}.ts`, `src/daemon/routes/{repos,docs}.ts`,
`chartroom-ui/src/{App.tsx,api/client.ts,components/{DocView,Sidebar,LlmBlock,DirectiveFallback}.tsx}`.

---

## 0. Scope recap (so approval is against the right bar)

Phase 3 = **the editor only**: Milkdown in-place WYSIWYG editing of the doc body, a hard byte-identical
round-trip requirement on untouched content (enforced by a serialization test suite — a named, required
deliverable, not optional), image paste → `assets/<doc-id>/<timestamp>.png` → index registration, and a Ctrl+K
fuzzy link picker inserting the id-carrying link format. Acceptance (Build Order §8 item 3, literal): **"edit-save
cycle produces zero diff on untouched lines; pasted image self-heals after `git mv`."**

Explicitly **not** phase 3 (confirmed by re-reading §0/§10 of the task brief against the spec):
- `:::ask-me`/checklist write-back, `:::actions`, human-action inbox — phase 4. The editor treats these
  directive blocks as **opaque prose it must not corrupt**, never as interactive UI (see §4).
- MCP server, `chart-room` skill, `PostToolUse` hook — phase 5.
- Inline frontmatter-bound input fields (Meta-Bind style) — spec §10, confirmed out of scope; this plan builds
  **no** UI for editing frontmatter values, only the existing byte-offset-safe frontmatter *isolation* (never
  touching its bytes on a body-only edit, §5).
- Multi-user/collaborative editing — spec §10, confirmed out of scope; no CRDT/OT, no Yjs, no presence, no
  concurrent-edit conflict resolution. Single local user, single browser tab assumed. (Two tabs open on the
  same doc racing a save is a known, accepted limitation — last-write-wins, no lock — noted in §11.)
- Anything phase 2 already built (viewer rendering, backlinks, tombstone display, TOC, collapsing) — reused
  verbatim. This plan adds an **edit mode** alongside `DocView`'s existing **read mode**; it does not rewrite
  `DocView`, `Sidebar`, `App.tsx`'s routing, the daemon's repo/registry/watcher plumbing, or any phase-1 CLI
  logic. New code composes with what exists rather than replacing it.
- Phase 1's CLI/indexer/resolver internals are consumed (imported types, reused helper functions where the
  `chartroom` package already exports them) but not modified, except where §6/§8 below explicitly calls out a
  new daemon route file — no existing phase-1 file's behavior changes.

---

## 1. Research findings

All package versions below were verified against the live npm registry today (2026-07-05) via direct
`registry.npmjs.org` fetches (not summarized secondhand, not recalled from training data) — marked
**[verified]**. Milkdown's actual API shape (not just version numbers) was cross-checked against
milkdown.dev's docs, the Milkdown/milkdown GitHub repo, GitHub Discussions, and DeepWiki's architecture pages —
marked **[verified via docs/discussions]** where I found concrete code shape, **[assumed/judgment]** where the
docs were thin and I made a call to be confirmed empirically by the Developer (this happens more than I'd like
for Milkdown specifically — see the honesty note in §1.1).

### 1.1 Milkdown's actual current package shape — decision: `@milkdown/kit`, not `@milkdown/crepe` **[verified]**

- `@milkdown/kit` **7.21.2** (published ~1 month ago) is Milkdown's "all-in-one" package: it re-exports
  `@milkdown/core`, `@milkdown/ctx`, `@milkdown/utils`, `@milkdown/transformer`, `@milkdown/preset-commonmark`,
  `@milkdown/preset-gfm`, `@milkdown/plugin-{listener,clipboard,upload,slash,tooltip,block,cursor,history,
  indent,trailing,diff,streaming}`, `@milkdown/components`, `@milkdown/prose`. Milkdown's own docs describe this
  as the modern recommended entry point (superseding the old pattern of installing `@milkdown/core` +
  `@milkdown/preset-commonmark` + `@milkdown/theme-nord` as separate top-level installs, which is what most
  *stale* tutorials/blog posts online still show — flagging explicitly since this is exactly the kind of thing
  likely to be wrong from training-data recall alone).
- `@milkdown/crepe` **7.21.2** is a *different*, higher-level product: an opinionated, batteries-included
  "Notion-like" editor with its own built-in toolbar/theme/slash-menu, designed for "drop in and go," not for
  deep structural customization. **Decision: use `@milkdown/kit` (composable primitives via `Editor.make().use(...)`),
  not Crepe.** Phase 3's requirements — a custom opaque-passthrough node type for directive/frontmatter blocks
  (§4), a custom image-upload endpoint wired to Chart Room's own asset/id scheme (§7), and full control over what
  gets serialized when (§3) — all need low-level control over the node schema and the parse/serialize pipeline
  that Crepe's packaged-editor shape is not designed to expose. This mirrors phase 2's own "reject the
  all-in-one, use the composable pieces" judgment call (e.g. hand-rolled `rehype-sectionize` over a canned
  collapse plugin) — same spirit, not guessed blind.
- `@milkdown/react` **7.21.2** — peer deps `react: "*"`, `react-dom: "*"` (confirmed via the live registry
  metadata, not assumed) — compatible with the React **19.2.7** already pinned by `chartroom-ui`'s `package.json`
  from phase 2, no version bump needed. Exposes `useEditor(callback)` + `<Milkdown />` (also seen as
  `<ReactEditor editor={editor} />` in older docs/examples — **the exact current component export name needs a
  five-minute empirical check at implementation start**, flagged honestly rather than guessed, since Milkdown's
  own documentation site (milkdown.dev) render its content client-side and did not yield readable prose through
  automated fetching during this research pass — I was only able to confirm API shapes via GitHub
  Discussions/DeepWiki/registry metadata, not the canonical docs pages themselves. This is a real, named gap —
  see §1.7).
- `@milkdown/plugin-upload` — bundled inside `@milkdown/kit` at the same `7.21.2`, not a separate top-level
  install. Its own dependencies (`@milkdown/core`, `@milkdown/ctx`, `@milkdown/exception`, `@milkdown/prose`,
  `@milkdown/utils`) are all themselves inside the kit bundle too — confirmed via direct registry fetch, no
  version-mismatch risk from mixing a standalone `plugin-upload` install against a different kit version (a real
  footgun with Milkdown's many-small-packages structure that this decision avoids entirely by installing exactly
  one top-level package: `@milkdown/kit` + `@milkdown/react`).

### 1.2 Milkdown's markdown round-trip mechanism — **the single highest-risk unknown, addressed head-on**

**What's confirmed [verified via DeepWiki architecture pages, GitHub Discussions, and Milkdown's own registry
dependency graph]:**
- Milkdown is built on ProseMirror (the rich-text document/schema/view engine) + the remark/unified ecosystem
  (`remark-parse` for markdown → mdast, `remark-stringify` for mdast → markdown). The bridge package
  (`@milkdown/transformer`) exposes `ParserState.create()` (markdown string → ProseMirror doc, driven by each
  loaded node/mark schema's `parseMarkdown` matcher) and `SerializerState.create()` (ProseMirror doc → markdown
  string, driven by each schema's `toMarkdown` runner).
- This means Milkdown's whole-document serialization is, structurally, **exactly the same class of tool as
  phase 1's own `markdown.ts` pipeline** (`unified` + `remark-parse` + `remark-gfm`) — a real AST, not a
  heuristic string-diff or a naive rich-text-to-markdown guesser. That's the good news the spec's own framing
  half-anticipates ("Milkdown... markdown-first").
- **The bad news, confirmed by how `remark-stringify` (the library actually doing the byte-production, one layer
  under Milkdown) is documented and widely known to behave:** it is a **canonicalizing** serializer, not a
  format-preserving one. Round-tripping arbitrary input markdown through `remark-parse` → `remark-stringify`
  reliably normalizes things a human author's original bytes may have used differently: bullet marker character
  (`*`/`-`/`+` → one configured default), ordered-list marker/delimiter style, emphasis marker (`_`/`*`), fence
  character/length for code blocks, heading style (ATX `##` vs. setext underline — Milkdown's presets default to
  ATX, but an input file authored with setext-style H1/H2 would be silently rewritten to ATX on any
  whole-document re-serialization), blank-line/list-tightness conventions, and link-title-attribute quote style
  (`"..."` vs `'...'` vs `(...)`- parenthesized). **None of this is a Milkdown bug — it's what `remark-stringify`
  is designed to do, and Milkdown does not turn it off by default.** This is precisely the "phantom diff" failure
  mode the spec names explicitly, and it is a real, structural property of the underlying library, not a
  hypothetical edge case.
- Milkdown does expose a `remarkStringifyOptionsCtx` (confirmed via search results, not directly read from
  source) that lets a plugin configure some of `remark-stringify`'s knobs (bullet character, fence style, etc.)
  globally. **This can make Milkdown's own output internally *consistent*, but it cannot make Milkdown's output
  match an arbitrary *pre-existing* repo file's original byte-for-byte style** — a real repo's markdown (like
  every file already in `suite-design/`) was authored by hand across months by different tools/habits and will
  not uniformly already match whatever single canonical style `remarkStringifyOptionsCtx` is set to. Any
  whole-document re-serialization of an existing file — even with zero user edits — would very likely rewrite
  bullet markers, heading styles, etc. across the *entire* file the moment it's opened and saved once. **This
  confirms the spec's own warning is correct and is not overblown; a naive "just use Milkdown's whole-document
  serializer" implementation would fail phase 3's acceptance criterion on essentially every real pre-existing
  doc in this monorepo, immediately.**
- **Also confirmed as a second, independent risk**, not just a style-normalization one: Milkdown's default
  presets (`preset-commonmark`, `preset-gfm`) have **no knowledge of `remark-directive` syntax**
  (`:::llm{...}`/`:::human{...}`/`:::ask-me{...}` container directives, already live in real docs since phase 2
  added directive *rendering* to the read-only viewer). Feeding a doc containing a directive block through
  Milkdown's default parser would, at best, mis-parse the `:::name{attrs}` fence lines as literal paragraph text
  (garbling the directive syntax into visible prose in the editor) and, on save, serialize back something that
  is **not** the original directive block — a correctness bug, not just a cosmetic one, and one the task brief
  explicitly warns about ("it does not need to specially understand phase-4 directive semantics beyond not
  corrupting them on round trip"). The same applies to the YAML frontmatter block itself (Milkdown's presets
  don't parse frontmatter either) and to raw HTML blocks if any exist. Milkdown *does* expose a `$remark` utility
  (confirmed via GitHub Discussions: `const remarkDirective = $remark(id, () => directivePlugin)`) for adding
  arbitrary remark plugins to its own parse pipeline, and a `$node` utility for defining custom ProseMirror node
  schemas with their own `parseMarkdown`/`toMarkdown` hooks — **these are the exact primitives phase 3's
  round-trip strategy needs (§3), not just a documentation curiosity.**

### 1.3 Round-trip strategy verdict up front (design detailed fully in §3)

Given §1.2's findings, **neither of the two extremes the task brief posed is acceptable as-is**:
- *Pure whole-document Milkdown serialization on save* → fails immediately on real files (bullet/heading style
  rewrites) and actively corrupts directive/frontmatter blocks Milkdown's presets don't understand.
- *Pre-normalize the whole repo to Milkdown's canonical style once, then trust whole-document serialization
  forever after* → would require an additional deliberate one-time repo-wide reformatting commit (a real,
  disruptive diff across every doc, for cosmetic reasons only) **and still does not solve the directive/
  frontmatter corruption problem**, since that's not a style-normalization issue — Milkdown's default presets
  cannot round-trip syntax they cannot parse, no matter how "canonical" the rest of the file is.

**Decision: block-level diff-and-splice, mirroring phase 1's `fix-links.ts` byte-offset discipline exactly —
detailed in §3.** This is the "hybrid" the task brief invited, landing decisively on the diff-based end of the
spectrum rather than the whole-document-serialization end, precisely because of the directive/frontmatter
finding above, not only the cosmetic-normalization one.

### 1.4 Ctrl+K fuzzy link picker — `fuse.js` **[verified]**

- `fuse.js` **7.4.2** (current, actively maintained, zero-dependency, the de facto standard lightweight fuzzy
  search library for exactly this "fuzzy search over a small in-memory list of records" use case). Used
  client-side over the already-fetched `GET /api/repos/:repoId/docs` list (`DocSummary[]` — `{id, path, title}`,
  same shape `Sidebar.tsx` already consumes from phase 2, reused verbatim, §6). No server-side search endpoint
  needed — the doc list for one repo is small (this is a docs-management tool, not a search engine over
  millions of records) and phase 2 already fetches the full list on repo switch.
- Modal UI: **hand-rolled**, no new modal/dialog library. `chartroom-ui` has zero existing modal precedent to
  reuse (checked — `App.tsx`/`Sidebar.tsx`/`DocView.tsx` have no dialog/overlay component today), but a
  fuzzy-search-list-with-keyboard-nav modal is a well-understood ~80-120 line component (text input + filtered
  list + arrow-key/Enter handling + Escape-to-close + a `<dialog>` element or a fixed-position overlay div) —
  not worth a dependency (rejected candidates: `cmdk` — a real, well-regarded command-palette library, but pulls
  in its own opinionated styling/behavior assumptions for a feature this small; `react-modal`/`radix-ui dialog`
  — heavier than needed for one modal with no portal/focus-trap edge cases beyond what a native `<dialog>`
  element already gives for free). **Flagged for First Officer sign-off in §11** since `cmdk` is a legitimate
  alternative if a richer command-palette feel is wanted later (phase 4/5 could plausibly want a broader
  command palette, not just a link picker) — recommending hand-rolled for now, cheap to swap later, not a
  one-way door.

### 1.5 Mounting Milkdown into React — `@milkdown/react`'s `useEditor` + `Editor.make()` **[verified via GitHub Discussions example, current API generation]**

Confirmed pattern (current major, `@milkdown/kit`-based, not the old `@milkdown/core` + separate preset
imports style many older tutorials show):
```tsx
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { listenerCtx, listener } from '@milkdown/kit/plugin/listener';
import { useEditor, Milkdown } from '@milkdown/react';

function useDocEditor(initialMarkdown: string, onMarkdownChange: (md: string) => void) {
  return useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialMarkdown);
      })
      .use(listener)
      .config((ctx) => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) onMarkdownChange(markdown);
        });
      })
      // .use(commonmark) / .use(gfm) / custom $node, $remark plugins — see §3/§4
  );
}
```
- `<Milkdown />` (current component export name per `@milkdown/react`'s own module, superseding an older
  `<ReactEditor editor={editor} />` shape seen in some cached examples/older major versions) is rendered inside
  a `MilkdownProvider` — **flagged as needing a five-minute empirical confirmation at implementation start**
  (see §1.1's honesty note): the exact provider/component export names for the `7.21.x` generation specifically
  should be checked against `node_modules/@milkdown/react/lib/index.d.ts` the moment the dependency is actually
  installed, before writing `DocEditor.tsx` for real, rather than trusting this research pass's secondhand
  reconstruction as gospel. This is a cheap, low-risk verification step, not a design gap — noted so the
  Developer doesn't silently assume my example above is letter-perfect.
- Pulling the *current* markdown out on demand (for the block-diff save path, §3) uses `editor.action((ctx) => {
  const view = ctx.get(editorViewCtx); const serialize = ctx.get(serializerCtx); return serialize(view.state.doc); })`
  — confirmed shape via search results — rather than relying solely on the `listenerCtx.markdownUpdated`
  callback's most-recent value (both are used: the listener drives a lightweight "dirty" indicator / debounced
  autosave trigger, §6.3; the on-demand `action()` pull is what actually runs at save time, so the save path
  never depends on whatever the last listener callback happened to capture).

### 1.6 Image paste interception — `@milkdown/plugin-upload`'s `uploadConfig` **[verified via package existence + registry deps; exact config shape needs empirical confirmation]**

- `@milkdown/plugin-upload` (bundled in `@milkdown/kit`) intercepts paste and drop events that carry file data
  and calls a configurable `uploader(files, ctx) => Promise<Node[]>` — confirmed the plugin exists and its
  purpose (triggers upload on paste/drop, per its own package description and the referenced Milkdown docs page)
  but the **exact TypeScript shape of the config context key (commonly `uploadConfig`, per convention with other
  Milkdown plugins exposing a `pluginNameConfig` ctx) was not confirmed from a readable docs page** (milkdown.dev
  did not yield parseable content through automated fetching this session — see §1.1). **Decision: treat the
  precise config API as a Developer-stage spike item**, not a designed-and-locked interface — the plan's
  contract at the *application* layer is fixed and does not depend on getting Milkdown's exact plugin-upload
  config shape right on the first try:
  1. Intercept `paste`/`drop` at the React component level (a plain DOM `onPaste`/`onDrop` handler on the editor
     container, **not** relying on `@milkdown/plugin-upload`'s own interception if its config shape proves
     fiddly to wire correctly) — read `event.clipboardData.items`/`event.dataTransfer.files` for image MIME
     types, `event.preventDefault()` to stop Milkdown/ProseMirror's own default paste handling for image data
     specifically (text/markdown paste continues through normal ProseMirror paste handling, unaffected).
  2. `POST` the image bytes to the new daemon upload endpoint (§7).
  3. On success, insert a Markdown image node (`![alt](relativeHref)`) at the current cursor position via a
     ProseMirror/Milkdown command (`ctx.get(editorViewCtx)` + a plain `insertNode`/`replaceSelection` transaction
     — standard ProseMirror, not Milkdown-specific, low risk).
  - **This hand-rolled-interception fallback is deliberately the primary design**, with `@milkdown/plugin-upload`
    as a nice-to-have simplification *if* its config shape turns out to be as simple as expected once the
    Developer stage actually has the package installed and its `.d.ts` in hand — flagged so a Developer doesn't
    stall trying to force-fit an uncertain plugin API when a ~30-line hand-rolled DOM event handler achieves the
    exact same acceptance criterion with zero API-shape risk.

### 1.7 Honest gap: Milkdown's own docs site was not fully readable this session

`milkdown.dev`'s pages (`/docs/api/plugin-upload`, `/docs/api/preset-gfm`, `/docs/recipes/react`, etc.) render
their substantive content client-side; automated fetching this session returned only navigation/header/footer
scaffolding, not the actual API reference prose, across multiple attempts. Everything in §1.1-§1.6 above that
carries **[verified]** is confirmed either via the live npm registry (version numbers, dependency graphs — hard
facts) or via GitHub Discussions/DeepWiki/the package's own README-adjacent search-result text (real content,
just not the canonical docs page). Everything marked **[assumed/judgment]** or flagged as "needs empirical
confirmation" is exactly that — a reasoned best-effort reconstruction, not a guess presented as fact, and each
one is designed so that being *slightly* wrong about an exact export name or config key costs the Developer a
few minutes checking a `.d.ts` file, not a redesign. **Recommendation: the Developer stage's very first task
should be a 30-60 minute throwaway spike** — install `@milkdown/kit`+`@milkdown/react`, render the most minimal
possible editor, and confirm the exact `useEditor`/`<Milkdown/>`/`MilkdownProvider` import shape and the
`plugin-upload` config key — **before** writing the "real" `DocEditor.tsx`/`ImagePasteHandler` against assumed
APIs. This is the same spirit as phase 1's own §10 risk #3 ("spike the exact mdast node shape... before writing
the real version").

---

## 2. Package/file placement — no new package, extends both existing ones

Unlike phase 2 (which added a whole new `chartroom-ui` package), phase 3 is additive within the **two existing**
packages — no new workspace member, no `pnpm-workspace.yaml`/`turbo.json` changes.

- `packages/chartroom` gains: one new daemon route file (image upload, §7), asset-path helpers reused from
  phase-1 concepts (id-based resolution, not new logic), and export surface additions so `chartroom-ui` can
  import the specific pure functions it needs for block-diffing (see §3.4 on the cross-package boundary — this
  is the one place this plan *does* touch phase-1/2's package boundary, deliberately, and is called out for
  sign-off in §11).
- `packages/chartroom-ui` gains: the editor component tree, the round-trip engine (block segmentation + diff +
  splice), the Ctrl+K modal, the image-paste handler, and an edit/view mode toggle wired into the existing
  `App.tsx`/`DocView.tsx` composition.

---

## 3. The byte-identical round-trip strategy (the crux of this plan)

### 3.1 Core mechanism: block-level diff-and-splice against the original raw text

This directly mirrors phase 1's `fix-links.ts` discipline (compute a set of `{start, end, text}` splices against
the **original raw string**, apply them back-to-front so earlier offsets stay valid, never re-render the whole
file) — extended from "one splice per stale link" to "one splice per changed top-level block."

**Step-by-step, for a single doc's edit session:**

1. **On load** (`GET /api/repos/:repoId/docs/:docId` already returns `raw` — phase 2, unmodified): the client
   parses `raw` with a remark pipeline that is a **strict superset** of phase-1's `markdown.ts` pipeline —
   `remark-parse` + `remark-gfm` + `remark-frontmatter` (already phase-1 deps) **+ `remark-directive`** (already
   a `chartroom-ui` dep since phase 2's `DocView.tsx`) — into a full document AST. `readFrontmatter`'s existing
   byte-offset logic (phase 1, `frontmatter.ts`, reused conceptually — reimplemented locally per the established
   phase-2 precedent of not cross-package-importing `chartroom` internals into `chartroom-ui`, §3.4) isolates
   the frontmatter block's byte range once, up front — **the frontmatter block is never handed to Milkdown at
   all, in any form**, exactly like phase 2's `DocView.tsx::stripFrontmatter` already does for rendering. This
   satisfies "the editor must not touch the YAML frontmatter block's bytes on a body-only edit" (task brief §3)
   by construction: the frontmatter bytes are sliced off before editing starts and spliced back verbatim,
   unconditionally, on every save (§3.5) — not diffed, not compared, just never touched.
2. **Segment the body** (everything after the frontmatter block) into an ordered list of **top-level blocks** —
   the direct children of the mdast root node (`heading`, `paragraph`, `list`, `blockquote`, `code`,
   `table` (gfm), `thematicBreak`, `html`, `containerDirective`/`leafDirective`/`textDirective` (remark-directive
   — this is what makes `:::llm`/`:::human`/`:::ask-me`/`:::actions` blocks each their own single top-level
   block, correctly recognized as one atomic unit even though Milkdown's own parser doesn't understand their
   syntax) — each with its own `{start, end}` byte-offset range from the AST (same `position.start.offset`/
   `position.end.offset` fields phase-1's `markdown.ts` already relies on for link-splicing).
3. **Classify each block** as either:
   - **"Prose" (editable in Milkdown)** — `heading`, `paragraph`, `list`, `blockquote`, `code`, `table`,
     `thematicBreak` — the node types Milkdown's `preset-commonmark` + `preset-gfm` natively understand.
   - **"Opaque" (non-editable passthrough in Milkdown)** — `html`, `containerDirective`, `leafDirective`,
     `textDirective`, and (defensively) **any node type not recognized as a known prose type** — a strict
     allowlist, not a denylist, so a future/unusual markdown construct this plan's author didn't anticipate
     defaults to "opaque and protected" rather than "silently handed to Milkdown and possibly mangled." This is
     a deliberate safety-first design choice worth the Reviewer's attention.
4. **Build the Milkdown document** by concatenating: for each prose block, its **original raw text verbatim**
   (handed to Milkdown's real parser, which will parse+render it normally, fully editable); for each opaque
   block, a **custom Milkdown/ProseMirror node** (`$node`-defined, §3.2) whose only content is the original raw
   text stored as a node attribute, rendered read-only/non-editable in the WYSIWYG view (e.g. a shaded box with
   a "not editable in this view" label and the raw text shown verbatim/monospace) — this is what makes phase 4's
   directive blocks (and any raw HTML) provably impossible to corrupt in phase 3: the editor literally cannot
   mutate their content, by construction, not by convention.
5. **On save**, re-segment Milkdown's *current* document state back into the same ordered block list (walking
   the live ProseMirror doc's top-level children — opaque nodes are trivially "their stored attr text, unchanged,
   always" by construction; prose nodes are serialized individually via Milkdown's `SerializerState`/
   `serializerCtx`, one block's node subtree at a time, **not the whole document at once**).
6. **Per-block comparison, mirroring §1.2's canonicalization finding:** for each **prose** block, compute
   `canonical(original) = serialize(parse(originalBlockRawText))` **once, at load time** (a parse+serialize
   round-trip of just that block's own original text, using the same Milkdown serializer that will run at save
   time) and compare it against `canonical(current) = serialize(currentBlockNode)` at save time.
   - If `canonical(original) === canonical(current)`: **nothing the block's own semantic content changed**
     (remark-stringify is deterministic/idempotent for a given AST — verified as a reasonable structural
     assumption since it's a pure function of the mdast tree with no hidden state, not empirically re-verified
     against every edge case this session, see §10 risk #1's mitigation) → **splice back the block's original
     raw bytes, untouched, not the canonical/re-serialized form.** This is the exact mechanism that makes
     "untouched content" byte-identical even though Milkdown's serializer would happily normalize it if asked —
     the trick is never actually writing the normalized form for blocks the user didn't touch.
   - If they differ: the user made a real edit inside this block → splice in `canonical(current)` (the fresh
     serialization) for exactly this block's `{start, end}` range, nothing else.
   - **Opaque blocks are never compared or re-serialized at all** — their original raw bytes are spliced back
     unconditionally on every save, exactly like the frontmatter block (§3.1 step 1). There is no code path by
     which an opaque block's bytes could change in phase 3, which is the strongest possible guarantee against
     corrupting phase-4-reserved directive syntax.
7. **Block insertion/deletion/reordering** (user adds a new paragraph, deletes one, drags to reorder — Milkdown
   supports all of these as normal ProseMirror editing): detected by a straightforward **ordered-list diff**
   between the original block list and the current block list (Myers-diff-style LCS matching on
   `canonical(original_i)` vs `canonical(current_j)` pairs — a small, well-tested, dependency-free ~40-60 line
   algorithm, same "hand-roll a small well-tested primitive rather than add a diffing library for one narrow use"
   judgment call phase 1/2 already made repeatedly for comparably-scoped problems). Matched-unchanged blocks
   splice back original bytes (step 6's untouched case); matched-but-different blocks splice in new
   serialization; unmatched-in-original blocks (new content) are inserted as fresh serialized text at the
   correct position; unmatched-in-current blocks (deleted content) are simply omitted from the reassembled
   output. The reassembly itself is a **linear join of ordered pieces**, not a byte-offset splice against the
   *original* string once insertions/deletions are involved (a pure insert/delete can't be expressed as
   in-place splices against fixed original offsets the way an in-place edit can) — so the final save-time
   reconstruction is: "frontmatter (verbatim) + join(ordered list of [original bytes | new bytes] per matched/
   inserted block, separated by the original blank-line convention between blocks, itself unchanged for adjacent
   untouched pairs)."
8. **Blank lines and file-final newline between/after blocks are preserved from the original text**, not
   re-derived from Milkdown's own list-tightness conventions — the segmentation step (§3.1.2) captures each
   block's own `{start, end}` *and* the raw text of the gap between consecutive blocks' offsets (whitespace/
   blank lines), which is itself treated as its own "opaque, always-verbatim" splice unit whenever both
   neighboring blocks are unchanged. This closes a real gap that a naive "just join blocks with `\n\n`" approach
   would introduce (a repo using a single blank line between paragraphs vs. two would get silently normalized).

### 3.2 The opaque-passthrough node — Milkdown `$node` definition

A single custom Milkdown node type, `chartroomOpaqueBlock` (name chosen defensively distinct from any real
CommonMark/GFM node name), defined via `$node` (from `@milkdown/kit/utils`, §1.2):
- **Schema:** `atom: true` (ProseMirror "this node has no directly editable inline content" — confirmed real
  ProseMirror concept, §1.2), `attrs: { raw: { default: '' } }`, block-level (`group: 'block'`).
- **`parseMarkdown`:** matches any mdast node type in the "opaque" classification (§3.1 step 3) — not registered
  via the individual node's own semantic matcher (Milkdown doesn't have a "match anything unrecognized" hook
  out of the box, so this plan explicitly enumerates the opaque type names: `html`, `containerDirective`,
  `leafDirective`, `textDirective`, plus a documented fallback discussed in §10 risk #4 for the "truly unknown
  node type" case) and stores the node's own original source slice (computed by the app's own segmentation
  step, §3.1.2 — **not** re-derived from Milkdown's own re-serialization, since Milkdown wouldn't know how to
  serialize a directive node correctly anyway) into the `raw` attr.
- **`toMarkdown`:** trivial — emit `node.attrs.raw` verbatim. In practice **this runner is never actually
  exercised for the "untouched" case** (§3.1 step 6 always uses the app-level original-bytes splice for opaque
  blocks, bypassing Milkdown's serializer entirely for them) — it exists so the node schema is well-formed and
  so `canonical(current)` computation for *adjacent prose blocks* (which need Milkdown to serialize the whole
  live doc consistently, even though only the touched blocks' output is actually used) doesn't throw on
  encountering an opaque node it doesn't know how to stringify.
- **NodeView (React/DOM rendering):** a simple non-editable `<pre>`/styled box showing the raw directive/HTML
  text, with a small label ("not editable here — phase 4/5 concern" for directives, "raw HTML" for `html`
  nodes) — cosmetic only, not load-bearing for the round-trip guarantee (the guarantee comes from `atom: true` +
  the app-level "always splice original bytes" rule, not from the visual treatment).

### 3.3 Why not the "normalize-then-trust-whole-doc-serialization" alternative

Documented explicitly per the task brief's request to justify the choice, not just assert it (§1.3 already
previews this; restated here with the full reasoning now that §3.1/§3.2 exist for contrast):
- It requires an upfront, disruptive, cosmetic-only reformatting commit across the entire existing doc corpus —
  a real cost with no functional benefit, and one that fights the "no repair ever creates a commit or pollutes a
  diff of an untouched file" principle phase 1 already established as a hard project-wide value.
- It does not solve the directive/frontmatter/HTML corruption problem at all — that's a parser-capability gap,
  not a style-normalization gap, and persists no matter how "canonical" the rest of the file already is.
- It provides weaker guarantees over time: every doc, forever, is one accidental Milkdown-side change (e.g. a
  future Milkdown major version tweaking `remark-stringify` defaults) away from a repo-wide phantom-diff
  incident, since the *entire* file's fidelity depends on Milkdown's whole-document output matching byte-for-byte
  forever. The block-diff strategy's fidelity guarantee for untouched blocks depends on nothing about Milkdown's
  serializer being stable release-to-release — untouched blocks are never run through the serializer's *output*
  being trusted at all, only through an *equality check* against itself (idempotency), which is a much weaker,
  safer assumption.
- The block-diff approach additionally gives the *touched* side of the acceptance line a real benefit the
  whole-document approach can't: a genuinely edited paragraph produces a diff scoped to that paragraph, not a
  diff touching every list marker in the file — directly serving the spec's "minimal diff on a real edit"
  expectation (task brief item 2's second requirement), not just the "zero diff on no-op" one.

### 3.4 Cross-package boundary note (flagged, not hidden)

Unlike phase 2 (which deliberately duplicated small helpers rather than touch phase-1's package boundary), phase
3's block-segmentation logic needs the *exact same* mdast-offset-extraction primitives phase-1's `markdown.ts`
already implements (`parseDocument`, offset-bearing node walks) **plus** `remark-directive` support phase-1's
pipeline doesn't have. Two options, both viable, flagged for a quick First Officer call rather than guessed:
- **(a) Duplicate again** (phase 2's established precedent): a `chartroom-ui`-local `segmentBlocks.ts` with its
  own `unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter).use(remarkDirective)` pipeline (all
  four are already `chartroom-ui` deps as of phase 2 or newly added here) and its own offset-walking code,
  structurally similar to but not imported from `markdown.ts`.
- **(b) Export phase-1's offset-walking primitives** from `chartroom`'s public surface (a package `exports`
  map addition) and import them into `chartroom-ui`, since this is no longer a "15-line duplication" (phase 2's
  TOC case) but a more substantial, correctness-sensitive piece of logic (byte-offset extraction across 7+ node
  types, used for a round-trip guarantee, not just cosmetic TOC rendering) where duplication risks the two
  copies silently drifting apart over time.
- **My recommendation: (b)**, specifically because §3.1's mechanism is *the* correctness-critical piece of this
  entire phase, and phase 1's `markdown.ts` offset logic (`findUrlOffset`, `toLinkNodeInfo`'s position handling)
  already had one documented empirical false-start (plan §10 risk #3, phase 1) — reusing the *tested, proven*
  implementation is safer than re-deriving equivalent logic a second time under a new phase's time pressure.
  This is the one place this plan intentionally deviates from phase 2's "never touch phase 1/2 files" instinct,
  and only additively (a new `exports` entry / a new re-exported function, zero behavior change to any existing
  export). **Flagged in §11 for explicit sign-off** since it's a real, if small, precedent-setting choice.

---

## 4. Frontmatter handling in the editor

Fully covered by §3.1 step 1: the frontmatter block's byte range is computed once via the same
`FRONTMATTER_RE`-anchored logic phase-1's `frontmatter.ts` and phase-2's `DocView.tsx::stripFrontmatter` both
already use (a third, local reimplementation in the editor's segmentation module, or reused via the same
export-surface decision as §3.4 — same call, bundled into that one decision rather than a second separate one).
The frontmatter block is **never** parsed into Milkdown, never rendered as editable content, and its exact
original bytes are unconditionally prepended to every save's reconstructed output. A body-only edit therefore
cannot touch a single frontmatter byte, structurally, matching phase 1's own discipline exactly (task brief's
explicit ask). No UI is built for viewing/editing frontmatter values in phase 3 (out of scope per spec §10 —
Meta-Bind-style inline fields are explicitly deferred; a read-only frontmatter summary already exists nowhere in
phase 2 either, so this plan doesn't need to reconcile with an existing display).

---

## 5. Save path design

### 5.1 New daemon endpoint: `PUT /api/repos/:repoId/docs/:docId`

- **Request body:** `{ raw: string }` — the client sends the **already-reconstructed full file content**
  (frontmatter + spliced body, per §3), computed entirely client-side. The daemon does **not** run any
  block-diffing itself — it is a dumb, trusted write of exactly the bytes the client computed. This keeps the
  round-trip-correctness logic in one place (client, §3, unit-tested in isolation, §9) rather than duplicated
  or re-derived server-side.
- **Server-side validation (the daemon is not *fully* blind-trusting, a few cheap safety checks):** (a) `docId`
  resolves to a known doc in the current in-memory index (`state.index.docs[docId]`) — 404 otherwise, same
  pattern as the existing `GET .../docs/:docId` route; (b) the resolved absolute path is still inside
  `repo.absPath` (defensive, mirrors `@fastify/static`'s own traversal guard already relied on in phase 2 —
  belt-and-suspenders since `doc.path` here comes from the trusted index, not user input, so this is a
  low-probability check, included anyway per the project's general safety posture); (c) a byte-size sanity cap
  (configurable, generous default e.g. 10MB) to reject a pathologically huge/corrupt payload rather than silently
  writing it — not a real security boundary (this is a local-only, loopback-bound daemon per phase 2's own
  design, spec §1's single-user framing), just cheap defensive hygiene.
- **Write mechanism:** plain `writeFileSync` to the doc's absolute path (no atomic-temp-then-rename dance here,
  unlike `index-schema.ts::writeIndex` — a doc file write is a single, small, human-initiated action, not a
  machine-rebuilt cache; a crash mid-write losing one edit is an acceptable, unremarkable risk for a local
  single-user tool, same risk profile as any text editor's save, not something phase 1/2 engineered around
  either for user-facing doc mutation). **This is the first code in the entire Chart Room project that writes to
  a `*.md` file from the daemon/UI side** (phase 1's CLI mutates files too, but never the daemon) — worth the
  Reviewer's attention as a real "first of its kind" moment, not a routine addition.
- **Response:** `{ ok: true }` on success, or a 4xx/5xx with an error message. The client's own state (its
  in-memory "original block list" for future diffing) is reset to the just-saved content after a successful
  save, so a second consecutive save without further edits is correctly a no-op against the new baseline.

### 5.2 Explicit Save (not autosave) — decision

**Explicit Save button + `Ctrl+S`/`Cmd+S` keybind**, not autosave-on-blur/debounce. Reasoning:
- An explicit save gives the user a clear moment to decide "commit this edit" — important for a tool whose
  entire pitch is "never surprise the git diff." Autosave-on-debounce would mean partial/mid-thought edits get
  written to disk (and thus become visible to `git diff`) before the user has finished a coherent thought,
  which is a worse experience for exactly the audience this tool targets (someone watching their working tree
  diff carefully).
- Simpler interaction with phase-1's pre-commit hook and phase-2's chokidar watcher (§5.3) — one write per
  deliberate user action is far easier to reason about for feedback-loop avoidance than an unpredictable stream
  of debounced writes racing the watcher's own debounce window.
- **Flagged for First Officer confirmation in §11** — autosave is a legitimate, commonly-expected editor UX
  (Milkdown's own ecosystem examples often show live markdown-updated syncing), and could be layered on later
  without redesigning the save path (the same `PUT` endpoint serves both), but explicit save is the safer
  starting default given this project's specific "never surprise the diff" ethos.

### 5.3 Feedback-loop avoidance with chokidar (phase 2's watcher)

This is a real, concrete risk correctly flagged by the task brief, addressed as follows:
- The `PUT` save handler, after a successful `writeFileSync`, **directly calls `repo-state.ts::rebuild(repoRoot)`
  itself** (the same function phase 2's chokidar `onRebuild` callback calls) and swaps the in-memory `RepoState`
  immediately — the UI's post-save response can therefore reflect the fresh index/backlinks/check state
  synchronously, without waiting for the watcher's ~200ms debounce to notice the write and rebuild
  independently.
- **The watcher will *also* fire** (chokidar sees the same file `change` event, unavoidably, since it's watching
  the whole repo tree) roughly 100-300ms later and trigger its own `rebuild()` — this is **not a bug to
  suppress, just a harmless redundant rebuild**: `buildFreshIndex` is a pure, idempotent function of the
  filesystem's current state; running it twice in quick succession in response to one real change produces the
  same result both times, and the in-memory state swap (§4.2 phase-2 design, "the reference is swapped, not
  mutated in place") means no reader ever observes a torn/partial state either way. **Decision: do not add any
  save-triggered watcher-suppression mechanism** (e.g. a "just wrote this path, ignore the next event for it"
  flag) — it would be extra complexity purely to avoid a wasted ~10-50ms recompute of a small JSON index, with a
  real risk of the suppression flag itself becoming a source of missed-update bugs (e.g. if a *different*
  concurrent write to the same path legitimately needs to be picked up). This is a considered "the naive
  approach is already fine" call, not an oversight — flagged in §10 as a low-severity, explicitly-accepted risk
  rather than silently hoped to be fine.
- **No infinite loop risk:** the daemon write is a single, terminating event (`writeFileSync` once per Save
  click); chokidar's own rebuild never itself writes back to any `*.md` file (phase 2 confirmed read-only
  end-to-end, and this plan's new endpoint is the *only* write path, triggered only by an explicit user action,
  never by a rebuild) — there is no code path by which a rebuild could trigger another write, so the "watcher
  triggers reindex, does reindex feedback into another write" loop the task brief worries about structurally
  cannot occur here, by construction (rebuild is read-only, full stop).
- **Interaction with phase 1's pre-commit hook:** none, directly — the hook only runs at `git commit` time,
  operating on whatever's staged at that moment, completely decoupled from when/how the working-tree file got
  its current content (editor save vs. any other tool). A doc saved via the editor, then `git add`-ed, then
  committed, goes through the hook exactly as if it had been edited in any other text editor — no special-casing
  needed, confirmed by re-reading `hook.ts`'s actual mechanism (blob-level operation on `git show :path`,
  agnostic to how the working tree file arrived at its current bytes).

---

## 6. Image paste design

### 6.1 New daemon endpoint: `POST /api/repos/:repoId/docs/:docId/assets`

- **Request:** `multipart/form-data` (single file field) or a raw binary body with a `Content-Type` header
  identifying the image type (`image/png` primarily, per spec's literal `assets/<doc-id>/<timestamp>.png`
  wording — **decision: always re-encode/save as `.png` regardless of the pasted image's original format**,
  matching the spec's literal naming pattern rather than inventing multi-format support the spec doesn't ask
  for; clipboard-pasted images from screenshots/browsers are `image/png` in the overwhelming common case anyway,
  confirmed by how OS clipboard image paste conventionally works — not re-verified against every OS this
  session, flagged as a low-risk assumption in §10).
- **Server-side logic:**
  1. Resolve `docId` → `doc.path` via the current index (same lookup as the save endpoint, §5.1).
  2. Compute the asset folder: `assets/<doc-id>/` **relative to the repo root** (spec's literal wording,
     §3/§8 build order — not relative to the doc's own directory; **flagged as a specific reading worth
     confirming**, since "configurable folder" per spec §3 could plausibly mean "relative to the doc" instead —
     recommend the spec's literal `assets/<doc-id>/<timestamp>.png` phrasing as repo-root-relative, matching how
     phase-1's `index.assets` already tracks arbitrary asset paths without assuming a fixed relationship to any
     one doc, but this is a real interpretation call, not a hard fact — see §11).
  3. Filename: `<timestamp>.png` where `timestamp` is a sortable, collision-resistant string (e.g.
     `Date.now()` in milliseconds, or an ISO-8601-with-colons-stripped string — either works; **no new
     dependency needed**, plain `Date.now().toString()` is simplest and sufficient for a single-user local tool
     where true concurrent-paste collision within the same millisecond is not a realistic scenario worth
     defending against).
  4. Write the file (`mkdirSync(..., {recursive: true})` + `writeFileSync`, same primitives already used
     throughout `chartroom`).
  5. **Register the asset in the index** — reusing phase-1's *exact* existing asset-registration logic
     (`indexer.ts::collectAssets`, which already sha256-hashes any image file referenced by a doc body and
     records it in `index.assets[hash] = {path}`) rather than inventing new asset-tracking: the moment the save
     endpoint (§5.1) is subsequently called with the doc's new body containing `![...](assets/<doc-id>/
     <timestamp>.png)`, the very next `rebuild()` (§5.3, triggered synchronously by that save) already re-runs
     `collectAssets` and picks the new asset up automatically, with zero new indexing code needed in this
     endpoint at all. **The upload endpoint's only job is: write bytes to disk, return the relative href for
     the client to insert into the document; it does not itself touch `.docs/index.json`.**
  6. **Response:** `{ href: string }` — the relative href the client should insert as the image link, computed
     server-side via phase-1's own `link-paths.ts::computeExpectedHref(doc.path, assetPath)` (reused verbatim,
     not reimplemented) so the inserted link is correct relative to the *editing* doc's own directory from the
     very first paste, never requiring a subsequent `fix-links` pass to correct it.

### 6.2 Client-side paste handler

Covered at the mechanism level in §1.6. On successful upload, the returned `href` is inserted as a Markdown
image node (`![](href)`, empty alt text initially — the user can type alt text afterward via normal editing) at
the cursor position, exactly as if the user had typed the markdown by hand — this is genuinely just "insert a
new prose block/inline node," so it flows through §3's ordinary "new content" diff path (§3.1 step 7), no special
casing needed in the round-trip engine for images specifically.

### 6.3 "Self-heals after `git mv`" — reusing phase 1/2's existing id-based resolution, not new logic

The acceptance criterion's literal wording: a pasted image, once committed, must continue to resolve correctly
even after the *doc* (not necessarily the asset itself) is moved via `git mv`. This is **already solved by
existing phase-1/phase-2 machinery, with zero new logic**:
- `index.assets` is keyed by **content hash** (`sha256`), not by path (phase 1, `indexer.ts::collectAssets`,
  unmodified) — so if the asset file itself is moved/renamed, the indexer's next rebuild re-hashes and finds it
  again under the same hash key regardless of path, and any doc's outbound image link gets marked `stale` by the
  existing `outbound[].stale` computation (§ phase 1 §5 step 4) the same way a stale doc-to-doc link would.
- However, **image links do not carry an `id:` title attribute** the way doc-to-doc links do (`![alt](href)` has
  no title-attribute slot in the same way `[text](href "id:...")` does for prose links) — so image links are
  **not** currently covered by `fix-links.ts`'s repair mechanism (which only repairs links with a
  `title="id:<id>"` marker, §1's `computeLinkFixes`, confirmed by re-reading the function — it explicitly skips
  any link without a parseable `id:` title). **This is a real, pre-existing gap phase 3 inherits, not one it
  introduces** — flagged plainly rather than silently worked around:
  - When the **doc** moves (the acceptance criterion's literal case) but the **asset stays in
    `assets/<doc-id>/`** (its own root-relative path, unaffected by the doc's move, per §6.1's decision to make
    the asset folder repo-root-relative rather than doc-relative): the image href, if written as a *relative*
    path from the doc's original location, would break after the doc moves — **unless** the href is computed
    (and, more importantly, *re-computed on load*) relative to the *doc's current location* each time, which is
    exactly what `computeExpectedHref` already does for any relative path given a `(fromPath, targetPath)` pair.
    **Decision: extend `fix-links.ts`'s scope, minimally, to also repair image hrefs whose target resolves via
    the asset hash map** — a small, additive change to an existing phase-1 file (the *first* modification this
    plan makes to a phase-1 file's logic, distinct from the additive-export decision in §3.4) — specifically:
    for each image node in a doc, look up its resolved absolute path's content hash against `index.assets`; if
    found under a *different* path than what's currently written, treat it exactly like a stale doc link and
    splice in the corrected relative href. This closes the actual gap the acceptance criterion is testing for,
    using the existing byte-splice mechanism (§ phase 1 `computeLinkFixes`), rather than inventing an id-carrying
    image-link format the spec never asked for.
  - **Flagged for explicit sign-off in §11**: this is a real, if small, behavior change to `fix-links.ts` (a
    phase-1 file), needed specifically to make the phase-3 acceptance line ("pasted image self-heals after
    `git mv`") literally true rather than accidentally true only in the specific case where the asset folder
    happens to still resolve correctly. Alternative considered and rejected: leave `fix-links.ts` untouched and
    rely on the pre-commit hook's *doc*-move lazy-normalization already covering "the doc moves, its own outbound
    links get corrected on next staged commit" (§ phase 1 §9) — this alternative is **not sufficient** on its own
    for images, because the hook's existing correction path is keyed off `targetId` (only present on id-carrying
    doc-to-doc links), so it silently skips every image link today, doc move or not — meaning without this small
    extension, the acceptance criterion would only pass by coincidence (e.g. the test happening to construct
    hrefs that remain valid), not by design.

---

## 7. Ctrl+K link picker

- **Trigger:** `Ctrl+K`/`Cmd+K` keydown captured at the editor container level (React `onKeyDown`, checked
  against `event.key === 'k' && (event.ctrlKey || event.metaKey)`, `event.preventDefault()` to stop any browser
  default), opens the modal (§1.4).
- **Data source:** the already-fetched `DocSummary[]` list for the current repo (`GET
  /api/repos/:repoId/docs`, phase 2, unmodified) — `fuse.js` indexes `{title, path, id}` per entry (weighted:
  title highest, then path, then id — a reasonable default worth the Reviewer's eyeball, not empirically tuned
  this session).
- **Selection → insertion:** on picking a doc, compute the correct relative href from the *currently open* doc's
  path to the target doc's path via `computeExpectedHref` (phase 1's `link-paths.ts`, reused — same reasoning as
  §6.1's asset-href computation: this logic must live in exactly one place, reused everywhere a relative href
  is computed, never re-derived) and insert `[<link text>](<href> "id:<targetId>")` at the cursor — **link
  text**: if the user has text selected at Ctrl+K time, use that as the link text (standard "select text, Ctrl+K
  to linkify" UX); otherwise default to the target doc's title. This exactly matches phase 1's link format
  (§2.2 of the spec), so the freshly inserted link is immediately picked up by the next `chartroom check`/
  `fix-links` run and by phase 2's backlinks computation with zero special-casing anywhere else in the system.
- **Keyboard nav:** arrow up/down to move selection, Enter to confirm, Escape to close without inserting — the
  ~80-120 line hand-rolled component from §1.4.
- **Test:** §9 covers insertion correctness (right href computed, right id-carrying format) as a pure-function
  unit test, independent of the modal's DOM/keyboard-interaction plumbing (which gets a lighter jsdom/RTL smoke
  test only, matching phase 2's own "DocView.test.tsx does DOM-level assertions, extractToc.test.ts does pure
  logic" split).

---

## 8. Files to create/modify (both packages)

### `packages/chartroom` (existing package)

| Path | Change | Purpose |
|---|---|---|
| `src/daemon/routes/doc-save.ts` | new | `PUT /api/repos/:repoId/docs/:docId` (§5.1) |
| `src/daemon/routes/doc-assets.ts` | new | `POST /api/repos/:repoId/docs/:docId/assets` (§6.1) |
| `src/daemon/server.ts` | modify | wire the two new route modules into `buildServer` (additive, alongside existing `registerReposRoute`/`registerDocsRoutes` calls) |
| `src/fix-links.ts` | modify | extend `computeLinkFixes` to also repair image hrefs via the asset hash map (§6.3) — the one behavior change to existing phase-1 logic, flagged §11 |
| `src/markdown.ts` (or a new `src/block-offsets.ts`) | modify/new | export whatever offset-walking primitives §3.4's decision (b) settles on reusing from `chartroom-ui` — exact shape resolved at Developer stage once §11's sign-off lands |
| `package.json` | modify | add an `exports` map entry (or extend an existing one) exposing the primitives from the line above, if §3.4 option (b) is approved |
| `test/fix-links.test.ts` | modify | add image-href-repair-via-asset-hash test cases alongside existing link-repair cases |
| `test/daemon/doc-save.test.ts` | new | Fastify `.inject()` tests: successful save writes the file and updates in-memory state; unknown docId 404s; oversized payload rejected |
| `test/daemon/doc-assets.test.ts` | new | `.inject()` tests: upload writes `assets/<doc-id>/<timestamp>.png`, returns the correct relative href; a subsequent doc save + rebuild registers the asset in `index.assets` |
| `acceptance/editor-round-trip.mjs` | new | Standalone scratch-repo script proving the phase-3 acceptance line (§9.2) |

### `packages/chartroom-ui` (existing package)

| Path | Change | Purpose |
|---|---|---|
| `src/editor/segmentBlocks.ts` | new | Parses raw body into ordered top-level blocks with byte offsets + prose/opaque classification (§3.1 steps 1-3) |
| `src/editor/opaqueNode.ts` | new | `$node`-defined `chartroomOpaqueBlock` schema + NodeView (§3.2) |
| `src/editor/roundTrip.ts` | new | The block-diff-and-splice engine: builds the initial Milkdown doc from segmented blocks, and on save, re-segments the live doc, does the LCS-style match + per-block canonical comparison, and reassembles the final file text (§3.1 steps 5-8) — the single most heavily-tested file in this phase (§9) |
| `src/editor/DocEditor.tsx` | new | `@milkdown/react` `useEditor` wiring (§1.5): mounts Milkdown fed the segmented/opaque-node-substituted content, exposes `getCurrentMarkdownDoc()` for the save path, houses the Ctrl+K keydown listener and the paste/drop handler |
| `src/editor/LinkPickerModal.tsx` | new | Ctrl+K fuzzy modal (§1.4/§7) — `fuse.js` search + keyboard nav + insertion |
| `src/editor/insertLink.ts` | new | Pure function: `(currentDocPath, targetDoc, selectedText?) → markdown link string` (§7), unit-tested independent of the modal UI |
| `src/editor/ImagePasteHandler.ts` | new | Paste/drop interception + upload POST + insertion (§6.2) |
| `src/api/client.ts` | modify | add `saveDoc(repoId, docId, raw)` and `uploadAsset(repoId, docId, blob)` typed wrappers (additive, alongside existing `fetchRepos`/`fetchDocs`/`fetchDoc`/`rawAssetUrl`) |
| `src/components/DocView.tsx` | modify | add an edit-mode toggle (button/keybind) that swaps the read-only `ReactMarkdown` render for `DocEditor` over the same `detail` prop; on successful save, re-fetches the doc detail and returns to (or stays in) edit mode with the new baseline |
| `src/App.tsx` | modify | thread a save-completion callback so a successful save can trigger `fetchDoc`/`fetchDocs` refresh (mirrors the existing `useEffect` re-fetch pattern already present for route changes) |
| `test/editor/segmentBlocks.test.ts` | new | Pure unit tests: correct block boundaries + prose/opaque classification for headings, lists, code, tables, directive blocks, raw HTML, frontmatter exclusion |
| `test/editor/roundTrip.test.ts` | new | **The named required round-trip test suite** (§9.1) |
| `test/editor/insertLink.test.ts` | new | Pure unit tests for the Ctrl+K insertion format |
| `test/editor/ImagePasteHandler.test.ts` | new | Mocked-fetch unit test: paste event → correct upload call → correct markdown insertion |
| `package.json` | modify | add `@milkdown/kit`, `@milkdown/react`, `fuse.js` as runtime deps; `remark-frontmatter` as a new runtime dep (needed for §3.1's segmentation pipeline, not previously a `chartroom-ui` dependency) |

No files are created by this Team Lead session — this table is the Developer stage's shopping list, same
convention as phase 1 §3 and phase 2 §3.

---

## 9. Test plan

### 9.1 The round-trip serialization test suite — the named required deliverable

`test/editor/roundTrip.test.ts` (`chartroom-ui`), built from a fixture corpus covering every construct the task
brief explicitly names, each as its own fixture file (or fixture string) under
`test/editor/fixtures/*.md`:
- Headings (ATX, mixed levels; a setext-style fixture specifically, to prove it survives untouched rather than
  being silently rewritten to ATX).
- Lists (bulleted with each of `-`/`*`/`+` markers as separate fixtures — proving marker style is preserved
  when untouched, and is **not** forced to a single canonical marker across the whole file); ordered lists;
  nested lists; tight vs. loose (blank-line-separated) lists as distinct fixtures.
- Code blocks (fenced with backtick and tilde fences, with and without an info string/language tag).
- Links (inline `(href "title")`, including the `id:` format; reference-style; autolinks) and images.
- Frontmatter (present with various key orderings/quoting styles; absent entirely — both must round-trip via
  the "never touched" mechanism, §3.1 step 1/§4).
- GFM tables (multiple column-alignment configurations) and GFM task-lists.
- `:::llm`/`:::human`/`:::ask-me` directive blocks with attributes, and a raw HTML block — proving the opaque
  node path (§3.2) leaves them byte-identical.

**Two assertion classes per fixture, run against every fixture:**
1. **No-op round trip:** load the fixture, immediately "save" without any simulated edit → assert output
   **is exactly `===` the original fixture text** (not "equivalent," not "semantically the same" — literal
   string equality, character for character, matching the spec's own "byte-identical" wording precisely).
2. **Minimal-diff single edit:** load the fixture, apply one targeted simulated edit to exactly one block
   (e.g., change one word inside one paragraph, or check one task-list box) → assert (a) the edited block's new
   text reflects the change, (b) **every other line in the file is byte-identical to the original** (asserted by
   splitting both old/new text into lines and diffing them — a real line-level diff assertion, not just "the
   file differs somewhere," proving the edit didn't ripple into unrelated blocks).

A combined **all-fixtures-in-one-file** test (concatenating several fixture types into a single realistic
multi-construct document, e.g. simulating a real `suite-design/*.md` doc's actual shape) is also included, since
per-construct isolation tests alone wouldn't catch a bug specific to *adjacency* (e.g., a directive block
immediately followed by a heading with no blank line between them — an edge case worth its own explicit fixture).

### 9.2 Image-paste-then-`git mv`-self-heals test

`acceptance/editor-round-trip.mjs` (`packages/chartroom`, mirrors phase 1/2's disposable-scratch-git-repo
acceptance pattern exactly): scaffold a scratch repo with one doc; drive the save endpoint (via `buildServer` +
`.inject()`, no real browser, same "prove the data path through the real route code" pattern as phase 2's own
acceptance script) to (a) upload a fake PNG buffer via the assets endpoint, (b) save the doc with a body
containing `![](assets/<doc-id>/<timestamp>.png)`, (c) `git add -A && git commit`, (d) `git mv` the **doc** (not
the asset) to a new directory, (e) run `chartroom fix-links --write` (or the equivalent programmatic call) and
assert the image href in the moved doc's new content correctly points at the asset's actual location relative to
its new directory, (f) assert the rendered/resolved image path is fetchable (i.e., `existsSync` on the resolved
absolute path from the corrected relative href) — proving §6.3's `fix-links.ts` extension actually closes the
gap it claims to close, end-to-end, not just at the unit level.

### 9.3 Ctrl+K insertion test

`test/editor/insertLink.test.ts` — pure function tests: correct relative href for same-directory / nested /
sibling-directory doc pairs (reusing `computeExpectedHref`'s own already-tested behavior, just exercising the
call site); correct `id:` title-attribute format; correct fallback to target title when no text is selected;
correct use of selected text when present.

### 9.4 Acceptance script — the Build Order's literal line, end to end

`acceptance/editor-round-trip.mjs` (same script as §9.2, extended) additionally drives: (a) load a scratch doc's
raw content through the full `segmentBlocks` → Milkdown-doc-build → immediate "save with no edits" path (via a
headless/non-DOM exercise of `roundTrip.ts`'s pure functions — **not** a real browser; see §10 risk #2 for the
honest limitation this carries, matching phase 2's own precedent of flagging "no real-browser proof" rather than
silently overclaiming one) → assert the resulting file bytes match the pre-edit bytes exactly; (b) the image
self-heal flow (§9.2). Together these two prove, at the data/logic level, the literal acceptance sentence: "edit
save cycle produces zero diff on untouched lines; pasted image self-heals after `git mv`."

### 9.5 Spec acceptance criteria → verification mapping

| Spec acceptance criterion (§8 item 3) | How this plan verifies it |
|---|---|
| "edit-save cycle produces zero diff on untouched lines" | `roundTrip.test.ts`'s no-op assertion (§9.1.1) across every fixture type + the acceptance script's headless full-cycle proof (§9.4a) |
| "...on a real single-block edit, only that content changes" (implicit, task brief item 2) | `roundTrip.test.ts`'s minimal-diff assertion (§9.1.2) |
| "pasted image self-heals after `git mv`" | `doc-assets.test.ts` (upload mechanics) + acceptance script §9.2/§9.4b (end-to-end through `fix-links.ts`'s new image-repair path) |
| Frontmatter never touched on body-only edit | `segmentBlocks.test.ts` (frontmatter excluded from segmentation) + `roundTrip.test.ts` fixtures that include frontmatter |
| Directive/HTML blocks never corrupted | `segmentBlocks.test.ts` (opaque classification) + `roundTrip.test.ts`'s directive/HTML fixtures (§9.1) |
| Ctrl+K inserts correct id-carrying format | `insertLink.test.ts` (§9.3) |
| No inline frontmatter-input-field UI, no collab editing built | Confirmed by design (§0) — Reviewer should grep the diff for any CRDT/Yjs/websocket-presence code or any frontmatter-value-editing UI component, expect to find none |

---

## 10. Risks (riskiest first)

1. **[Riskiest] The block-diff-and-splice round-trip engine (§3) is entirely hand-designed for this plan — there
   is no off-the-shelf library doing "diff a ProseMirror doc against a pristine parse of the original text and
   splice only the changed ranges back into the original string."** This is conceptually the same category of
   risk phase 1 flagged for its blob-vs-working-tree git plumbing (§10 risk #1 there) and phase 2 flagged for
   its hand-rolled `rehype-sectionize` — a real, load-bearing piece of custom logic with no library to lean on.
   Mitigation: §9.1's fixture-based test suite is deliberately broad (every named construct + an adjacency/
   combined-document test) specifically because this is where a subtle bug would hide (e.g., an off-by-one in
   the "gap between blocks" whitespace-preservation logic, §3.1 step 8) — this is the test suite the Reviewer
   should scrutinize hardest, more than any other file in this phase.
2. **Milkdown's exact plugin/component API surface for the `7.21.x` generation was not fully confirmed from
   canonical docs this session** (§1.1/§1.7's honesty note) — the `<Milkdown/>` vs. `<ReactEditor/>` component
   name, the exact `$remark`/`$node` import paths (`@milkdown/kit/utils` vs. `@milkdown/utils` re-exported
   through the kit), and `@milkdown/plugin-upload`'s config key shape are all "verified to exist, not verified
   letter-perfect." Mitigation: §1.7's recommended 30-60 minute Developer-stage spike, done *before* writing
   `DocEditor.tsx`/`opaqueNode.ts` "for real" against assumed APIs — flagged honestly rather than presented as
   settled, per the task brief's explicit instruction to say so if something is assumed rather than confirmed.
3. **The `canonical(original) === canonical(current)` idempotency assumption (§3.1 step 6) is a reasonable
   structural inference (remark-stringify is a pure function of the mdast tree), not empirically stress-tested
   against Milkdown's actual output this session.** If Milkdown's serializer turns out to be *not* perfectly
   idempotent for some construct (e.g., a table with unusual cell-content whitespace, or a nested-list edge
   case), the failure mode is a **false "this block changed" detection** (over-eager re-serialization of a
   technically-untouched block) — annoying (a spurious diff) but **not** silent data corruption, since the
   fallback is always "write Milkdown's own valid serialization of the block," never "write something wrong."
   This asymmetry (fail toward "extra diff noise," never toward "corrupted content") is a deliberate property of
   the design, not an accident — worth the Reviewer confirming it holds once real fixtures are run against the
   real library in the Developer stage.
4. **The opaque-node classification (§3.1 step 3) is a strict allowlist of known prose types**, defensively
   defaulting anything unrecognized to "opaque" — this is safe (never corrupts unknown content) but means any
   markdown construct not in the allowlist becomes **entirely non-editable** in phase 3's editor, which could
   surprise a user editing a doc containing, say, a footnote-definition syntax or math blocks (`remark-math`,
   not currently a dependency anywhere in the project) — not a correctness bug, but a UX gap worth noting
   explicitly rather than discovering by surprise. Low severity: the existing viewer (phase 2) doesn't render
   these specially either, so this isn't a regression, just an unaddressed edge case.
5. **Explicit-save-not-autosave (§5.2) is a UX judgment call**, not a spec mandate either way — low risk of being
   "wrong," but a real product decision worth a quick confirmation rather than silent adoption, since it's the
   kind of thing a First Officer/Captain might have a strong opinion on that's cheap to accommodate now and
   costly to redesign later (the save-triggered-rebuild wiring in §5.3 would need rework if autosave's higher
   write frequency were added later, though the underlying `PUT` endpoint itself would not need to change).
6. **The `fix-links.ts` extension for image-href repair (§6.3) is the one behavior change to existing phase-1
   code in this plan.** Low risk in isolation (additive, narrowly scoped, exercised by both a new unit test
   class and the acceptance script), but it's the kind of "we're touching code the mission said was already
   done" moment that deserves explicit Reviewer attention rather than being buried in a file-change table.
7. **Two browser tabs open on the same doc, one saves while the other has unsaved edits** — last-write-wins,
   no conflict detection, no warning. Explicitly out of scope per spec §10's multi-user/collab exclusion, but
   worth naming as the concrete shape that exclusion takes in practice (a single user with two tabs open is not
   "multi-user" in the collaborative-editing sense, but the failure mode is the same silent-overwrite one) —
   low severity for a single-local-user tool, not a design gap this plan needs to close.
8. **No automated real-browser smoke test for the editor's actual DOM/keyboard interaction** (Ctrl+K opening,
   paste event firing, Milkdown mounting without a console error) — same honest limitation phase 2 flagged for
   its own viewer (§9 risk #1 there), extended here to the editor. Recommending the same resolution: a manual
   Reviewer QA pass (run `chartroom serve`, open a doc, edit it, paste an image, hit Ctrl+K) rather than adding
   Playwright, consistent with phase 2's precedent — but flagging again since phase 3's interactive surface
   (keyboard shortcuts, clipboard events, a mounted third-party rich-text editor) is meaningfully larger than
   phase 2's read-only rendering, so the case for eventually adding a real browser test is stronger here than it
   was in phase 2. **Needs First Officer sign-off**, same open question as phase 2's, now compounding.

---

## 11. Needs First Officer / Captain decision

1. **New dependencies** (per the standing "never add dependencies without asking" rule): `@milkdown/kit`
   (^7.21.2), `@milkdown/react` (^7.21.2), `fuse.js` (^7.4.2) as new `chartroom-ui` runtime deps;
   `remark-frontmatter` (^5.0.0, matching phase 1's already-pinned version) as a new `chartroom-ui` runtime dep
   (needed for the segmentation pipeline, §3.1 — `chartroom-ui` currently has `remark-gfm`/`remark-directive`/
   `remark-parse`/`unified`/`unist-util-visit` from phase 2 but not `remark-frontmatter`). No dev-dependency
   additions beyond what phase 2 already installed (same `vitest`/`jsdom`/`@testing-library/*` stack covers the
   new tests). **Considered and rejected:** `@milkdown/crepe` (§1.1, wrong abstraction level for this phase's
   customization needs), `cmdk` (§1.4, heavier than needed, hand-rolled modal recommended instead), a dedicated
   diffing library for the block-matching LCS logic (§3.1 step 7, small enough to hand-roll per the project's
   established "don't add a dependency for ~50 lines" precedent).
2. **Round-trip strategy itself (§3)** — this is the plan's central judgment call. I'm recommending block-level
   diff-and-splice with opaque-node passthrough for directive/frontmatter/HTML, explicitly rejecting both
   "trust Milkdown's whole-document serializer" and "normalize the repo once, then trust it forever" as
   insufficient (§1.2/§3.3) given the real, confirmed finding that Milkdown's default presets don't understand
   `remark-directive` syntax at all. Please confirm this reading of the risk (not just the chosen mitigation)
   before the Developer stage — if I've misjudged how severe the canonicalization/directive-corruption risk
   actually is in practice, the whole design changes.
3. **Cross-package boundary: exporting phase-1 offset-walking primitives for `chartroom-ui` to import (§3.4)**
   — the one place this plan proposes touching phase-1 files' public surface (additively) rather than
   duplicating, breaking phase 2's own established "never touch phase 1/2 files" precedent for a specific,
   justified reason (correctness-critical logic, not cosmetic). Please confirm this is acceptable, or direct a
   return to duplication if the precedent matters more than the reuse benefit here.
4. **`fix-links.ts` behavior extension for image-href repair (§6.3)** — the one actual behavior change (not just
   export-surface addition) to existing phase-1 code, needed to make "pasted image self-heals after `git mv`"
   literally true for the doc-moves case rather than true by coincidence. Please confirm this small, additive,
   test-covered change to a "already implemented" file is acceptable.
5. **Asset folder path semantics: `assets/<doc-id>/` repo-root-relative vs. doc-directory-relative (§6.1)** —
   spec §3's "folder configurable" wording doesn't pin this down; I've defaulted to repo-root-relative (matches
   the spec's literal example path shape most directly) but this is an interpretation call, not a hard fact.
6. **Explicit Save vs. autosave-on-blur/debounce (§5.2)** — recommending explicit Save + Ctrl+S, given this
   project's "never surprise the git diff" ethos, over the arguably more common autosave pattern many WYSIWYG
   markdown editors default to. Confirm or override.
7. **Hand-rolled Ctrl+K modal vs. `cmdk` (§1.4)** — recommending hand-rolled for now (cheap, no new dependency,
   easy to swap later), flagging `cmdk` as the natural upgrade if phase 4/5 wants a broader command-palette feel
   later. Confirm hand-rolled is fine for this phase.
8. **No automated real-browser smoke test for the editor** (§10 risk #8) — same open question phase 2 raised,
   now with a larger interactive surface (keyboard shortcuts, clipboard/paste events, a third-party rich-text
   library) making the case for eventually adding Playwright somewhat stronger than it was for the read-only
   viewer. Recommend the same manual-QA-pass resolution as phase 2 for now; flagging the compounding case for
   revisiting this globally rather than per-phase.
9. Per the mission's standing rule: **never `rm`/delete anything.** Nothing found this session needing removal
   or logging to `REMOVALS.md` — phase 3 is additive to phases 1-2's merged code except for the two explicitly
   flagged, narrow, test-covered changes in items 3-4 above.
10. `team-tasks/` is never referenced or touched anywhere in this plan — confirmed by design, not by omission.

---

## 12. Definition of DONE mapping (for the Reviewer, once implemented)

| DoD item (spec §9 / Build Order §8 item 3) | How satisfied |
|---|---|
| Milkdown in-place editing | §1.1/§1.5/§8 — `@milkdown/kit` + `@milkdown/react`, `DocEditor.tsx` mounted as an edit-mode alongside `DocView` |
| Byte-identical round-trip on untouched content | §3 (block-diff-and-splice design) + §9.1 (fixture test suite, the named required deliverable) |
| Round-trip serialization test suite exists and passes | `chartroom-ui/test/editor/roundTrip.test.ts` (§9.1), `pnpm --filter chartroom-ui test` green |
| Image paste → `assets/<doc-id>/<timestamp>.png`, registered in index | §6.1 (upload endpoint) + §6.2 (client handler) + reuse of phase-1's `collectAssets` (zero new indexing logic) |
| Ctrl+K link picker, fuzzy search, id-carrying link format | §7 (`LinkPickerModal.tsx` + `insertLink.ts`), format matches spec §2.2 exactly |
| Acceptance: "edit-save cycle produces zero diff on untouched lines" | §9.1.1 (no-op fixture assertions) + §9.4a (headless full-cycle acceptance script) |
| Acceptance: "pasted image self-heals after `git mv`" | §9.2/§9.4b (acceptance script, exercising the new `fix-links.ts` image-repair path, §6.3) |
| Frontmatter untouched on body-only edit | §3.1 step 1/§4 (never parsed into Milkdown, always spliced back verbatim) |
| No corruption of phase-4-reserved directive blocks | §3.1 step 3/§3.2 (opaque-node passthrough, atom+never-serialized-for-real) |
| No inline frontmatter-input UI, no collab editing | Confirmed by design (§0) — Reviewer should grep the diff for CRDT/Yjs/websocket-presence code and frontmatter-value-editing UI, expect none |
| Builds clean | `pnpm --filter chartroom build`, `pnpm --filter chartroom-ui build` (tsc + vite build), `turbo run build` |
| Lint passes | Existing package-scoped `eslint.config.mjs` in both packages, `turbo run lint` clean |
| Tests pass | `vitest run` in both packages — all §9 unit tests green |
| No write path added beyond the two new endpoints | Reviewer should grep the diff for `writeFileSync`/`fs.write*` calls — expect exactly the doc-save endpoint (§5.1) and the asset-upload endpoint (§6.1), nothing else new |
