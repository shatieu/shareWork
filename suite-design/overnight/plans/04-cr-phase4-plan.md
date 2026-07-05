---
id: package-4-chart-room-phase-4-interactive-blocks-inbox
---

# Package 4 — Chart Room Phase 4: Interactive blocks + inbox

**Team Lead session.** Branch: `ship-wave1-cr-phase-4` (verified checked out, do not switch/create branches).
Status: plan awaiting First Officer approval. **No implementation, no `npm`/`pnpm install`, no stub files beyond
this document, no `git commit`.**

Spec source: `suite-design/ChartRoom_Spec.md` §4 (interactive blocks — §4.1 `:::ask-me`, §4.2 `:::llm`/`:::human`
already built, §4.3 checklists/`:::actions`/inbox), §8 build-order item 4 (authoritative acceptance line), §5
(agent surface — phase 5, read for context only), §9 (DoD), §10 (out of scope). `.claude/skills/ask-human/SCHEMA.md`
read in full (the real question-type vocabulary), plus `bin/server.mjs` and `template/page.html.tmpl` (how that
skill validates/renders each type today). Phase-1 code read in full: `markdown.ts`, `index-schema.ts`, `check.ts`,
`fix-links.ts`, `link-paths.ts`. Phase-2 code read in full: `daemon/{server,repo-state,registry,watcher}.ts`,
`daemon/routes/{repos,docs}.ts`, `components/{DocView,LlmBlock,HumanBlock,DirectiveFallback,TombstoneBadge}.tsx`,
`App.tsx`, `api/client.ts`. Phase-3 code read in full: `daemon/routes/doc-save.ts`, `editor/{segmentBlocks,roundTrip,
opaqueNode}.ts`. `DECISIONS-NEEDED.md`'s Package 2/3 sections read for precedent on what the First Officer has
already approved/overridden (cross-package exports, dependency approvals, scope-reading calls).

---

## 0. Scope recap (so approval is against the right bar)

Phase 4 = **interactive blocks + inbox only** (Build Order §8 item 4, literal): `:::ask-me` (reusing the
ask-human skill's real schema types) + GFM checkbox write-back + `:::actions`; a cross-repo human-action inbox
page. Acceptance (literal): **"agent writes an ask-me block via file edit; human answers in browser; answer
lands in the doc; agent reads it back."**

Explicitly **not** phase 4 (confirmed against the task brief's own scope-discipline section):
- MCP server, `chart-room` skill, `PostToolUse` hook, `llms-txt` — phase 5. Nothing in this plan adds a CLI verb,
  an MCP tool, or a skill file.
- `:::llm`/`:::human` rendering (phase 2) and the Milkdown body editor (phase 3) — reused verbatim, not touched
  except where §3.5 below documents one narrow, additive extension.
- Inline frontmatter-bound input fields (Meta-Bind style) — spec §10, confirmed out of scope; no UI is built for
  editing frontmatter values.
- The Ship's fleet-approval-queue integration — spec §4.3 explicitly frames the inbox as "the seam" for this to
  plug in *later*. This plan builds the inbox as a self-contained Chart Room feature (aggregation logic + API +
  UI page) with no outbound call, webhook, or config surface pointing at any external Ship system.
- Any CLI-level validation additions to `chartroom check` (e.g. duplicate ask-me/actions directive-id detection
  across a repo) — considered in §11, deliberately deferred, not built.
- Attachments on ask-me answers — the real ask-human schema supports a per-question `attachments` array; this
  plan deliberately does not build attachment upload/storage for ask-me answers in v1 (see §1.3, §11 item 5).

---

## 1. Research findings

### 1.1 The spec-example-vs-real-schema type mismatch — resolved explicitly, not guessed

Spec §4.1's own example directive is `:::ask-me{id="q-03" type="choice"}`, and its prose says the schema "reuses
the existing ask-human skill's SCHEMA.md types (choice, free text, rating, ranking, comparison, attachments)."
`.claude/skills/ask-human/SCHEMA.md` (read in full) defines the real, enforced type vocabulary — validated at
runtime by `bin/server.mjs`'s own `KNOWN_TYPES` set — as exactly: **`single-select`, `multi-select`, `text`,
`yesno`, `rating`, `ranking`, `compare`**. None of these is literally `"choice"`. Comparing the spec's loose
paraphrase against the real schema, term by term:

| Spec's word (§4.1 prose) | Real schema type | Notes |
|---|---|---|
| `choice` (used literally as `type="choice"` in the spec's own example) | `single-select` (primary reading) or `multi-select` | The example's body ("PAT tokens / OAuth 2.1 / Both") is a *pick-one* question in spirit, matching `single-select` most directly. `multi-select` is the real type for a "check all that apply" ask-me block. |
| `free text` | `text` | Direct rename, no ambiguity. |
| `rating` | `rating` | Matches verbatim. |
| `ranking` | `ranking` | Matches verbatim. |
| `comparison` | `compare` | Direct rename, no ambiguity. |
| `attachments` | *not a type at all* | In the real schema, `attachments` is a per-question **capability** (`allowAttachment`, default `true`) producing an `attachments: []` array in `answers.json` for *any* question type — not a seventh question type. The spec's own list conflates a capability with a type, a second, independent inaccuracy beyond the `choice`/`single-select` naming gap. |

**Decision (not a guess, an explicit resolution):**
1. `type="choice"` is treated as a **backward-compatible alias for `single-select`** — a small `TYPE_ALIASES` map
   (`{ choice: 'single-select', 'free-text': 'text', comparison: 'compare' }`) normalizes any of these legacy/
   loose names to their real schema equivalent at parse time, so the spec's own literal §4.1 example keeps
   working unmodified, verbatim, forever — this repo's own spec file is itself a "real doc" this system must not
   break.
2. Going forward, the **real schema names are the documented, canonical vocabulary** — `single-select`,
   `multi-select`, `text`, `yesno`, `rating`, `ranking`, `compare` — all seven implemented (§4), not just the
   five the spec's prose happens to enumerate.
3. `attachments` is **not implemented as a question type** in this phase (there is no seventh type). Whether
   *per-question attachment capability* (the real schema's actual `attachments` feature) is wanted for ask-me
   answers at all is a separate, explicit scope call — see §1.3 and §11 item 5. Silently inventing a fictitious
   "attachments" question type, or silently pretending the spec's five-item list is the complete real vocabulary,
   would both have been guesses; this plan does neither.
4. An unrecognized `type` value (after alias normalization) renders a graceful, non-crashing fallback (§4.4) —
   never throws, matching the project's established defensive posture (`DirectiveFallback`, `check.ts`'s
   tolerant-parsing precedent).

### 1.2 No new npm dependencies expected for parsing — a genuine, verified finding, not an assumption

- `packages/chartroom-ui` already depends on `remark-directive` (^4.0.0) and `remark-gfm` (^4.0.1) — both used
  today by `DocView.tsx` (viewer rendering) and `segmentBlocks.ts` (phase 3's editor). Container-directive
  attribute parsing (`:::ask-me{id="..." type="..."}` → `containerDirective.attributes: Record<string,string>`)
  and GFM task-list checkbox state (`listItem.checked: boolean | null`) are both **already produced by pipelines
  this project runs today** — confirmed by reading `remark-gfm`'s well-established task-list-item extension
  behavior (sets `checked` on the `listItem` mdast node) and `remark-directive`'s own attribute-parsing behavior
  (already exercised end-to-end by `DocView.tsx`'s `llm`/`human` rendering, which reads `tldr`/`assignee` off
  directive attributes today).
- **A genuinely useful, verified-by-grep finding:** `packages/chartroom` (the *daemon* package, not the UI)
  **already lists `remark-directive` (^4.0.0) and `remark-directive-rehype` (^1.0.0) as its own dependencies**
  (`package.json`, carried over from phase 2's dependency table) — but grepping the entire `packages/chartroom/src`
  tree turns up **zero actual imports** of `remark-directive` anywhere server-side today (only a comment
  reference in `markdown.ts`'s header). `markdown.ts`'s own processor (`unified().use(remarkParse).use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])`) already includes `remark-gfm` (used for `extractHeadings`/`extractLinks`
  today) but not `remark-directive`. **This means the daemon-side dependency this phase needs for directive
  parsing is already installed and approved, just unused** — phase 4 needs zero new top-level dependency
  approvals for parsing on either side of the package boundary. `remark-directive-rehype` (hast conversion) is
  **not needed server-side** at all (the daemon only needs the raw mdast tree with offsets, never a rendered
  hast/HTML representation) and stays unused server-side, exactly as it is today.
- **No new client-side rendering dependency needed either.** The seven question-type widgets (§4) are hand-built
  React components using plain HTML form controls (radio/checkbox inputs, a native `<input type="range">` for
  rating, plain buttons for yes/no, native drag events + up/down buttons for ranking — mirroring
  `page.html.tmpl`'s own implementation choices almost exactly, see §4.6) — no new UI library.

### 1.3 Attachments — scoped out of ask-me v1, not silently dropped

The real ask-human schema's `attachments` capability (paste/upload a file per question, surfaced in
`answers.json` as a path array) has no clean home in Chart Room's in-doc-markdown answer format: the answer is a
single human-readable blockquote line spliced into the doc (§3.5), not a session directory with an
`attachments/` folder the way `ask-human`'s own flow has. The Build Order's literal phase-4 acceptance line does
not mention attachments at all. **Decision: attachments are out of scope for this plan's ask-me implementation.**
A natural, cheap extension exists if wanted later — reuse phase 3's already-built `POST .../docs/:docId/assets`
upload endpoint (writes to `assets/<doc-id>/<timestamp>.png`, already registered in the asset index) and
reference the resulting path from within the answer blockquote text (`![attached](assets/q-03/173....png)`) —
but building this now would be scope creep past the literal acceptance line. Flagged explicitly in §11 item 5
rather than silently omitted.

### 1.4 `remark-gfm`'s checkbox representation — confirmed structural fact, not re-derived

A GFM task-list item (`- [ ] text` / `- [x] text`) parses to a `listItem` mdast node with `checked: true | false`
(non-task-list items have `checked: null`/`undefined`). The literal `[ ]`/`[x]` substring is **consumed during
parsing and not retained as its own node** — `remark-gfm` only exposes the boolean via `checked`, matching how
`segmentBlocks.ts` already only needs node *types* and offsets, never a magic "checkbox node." The write-back
mechanism (§3) therefore locates the bracket substring by a narrow regex over the *item's own already-known
source slice* (`raw.slice(item.position.start.offset, ...)`, bounded to the first ~10 characters after the list
marker), exactly mirroring `fix-links.ts::computeLinkFixes`'s own "no separate url node offset → locate the
literal substring within the whole node's known slice" fallback technique (`markdown.ts`'s `findUrlOffset`,
reused as a design pattern, not as code).

---

## 2. Package/file placement — extends both existing packages, one new shared server-side module

No new workspace package (matches phase 3's precedent — phase 4 is additive within `packages/chartroom` +
`packages/chartroom-ui`).

- **`packages/chartroom` gains** a new shared module (`src/interactive-blocks.ts`, §3) plus three new daemon
  route files (checkbox toggle, ask-me answer, inbox aggregation) and a `RepoState`/`rebuild()` extension.
- **`packages/chartroom-ui` gains** the interactive-block React components (`AskMeBlock`, `ActionsBlock`, seven
  question-type widgets, a shared clickable `Checkbox` override) and a new inbox page/route — and **imports
  `interactive-blocks.ts`'s extraction/classification logic directly from `chartroom`** rather than duplicating
  it a third time (§2.1).

### 2.1 A new, and larger, cross-package **runtime-code** export — flagged prominently

Phase 3 (approved, `DECISIONS-NEEDED.md`) already established one precedent for `chartroom-ui` importing from
`chartroom` across the package boundary: `AstNode` — but that import is **type-only** (`import type`), fully
erased at build time, carrying zero browser-runtime risk (confirmed explicitly in phase 3's own Developer-stage
findings, which is exactly why a *second*, non-type-only cross-package import in that same session — reusing
`link-paths.ts::computeExpectedHref`, which transitively pulls in `node:path` — broke a real `vite build` at
runtime and had to be reimplemented as a pure-string local module, `chartroom-ui/src/editor/relativeHref.ts`).

Phase 4's `interactive-blocks.ts` needs to be **actual shared executable logic**, not just a type, because both
sides need to agree byte-for-byte on: what counts as an ask-me/actions directive, how a `type="choice"` alias
normalizes, how choices/checkbox ordinals are numbered, and how an answer is formatted — any drift between a
server-side copy and a client-side copy would silently produce two different opinions about the same document.
**Decision: export it for real, as executable code**, via a new `chartroom` package.json `exports` subpath
(`"./interactive-blocks"`, alongside the existing `"./markdown"`), imported directly (not `import type`) by
`chartroom-ui`. This is safe against phase 3's own confirmed failure mode specifically because
`interactive-blocks.ts`'s only dependencies are `unified`/`remark-parse`/`remark-gfm`/`remark-directive` — the
exact same packages `chartroom-ui` **already bundles itself** today (`DocView.tsx`, `segmentBlocks.ts`) with zero
Node-builtin usage anywhere in that dependency chain (no `node:fs`/`node:path`/`node:crypto`, unlike the
`link-paths.ts` case that broke). **Still, per the explicit lesson phase 3 wrote down** ("any cross-package
import that will execute inside `chartroom-ui`'s browser bundle needs to be verified against a real `vite build`,
not just `tsc`"), this plan requires the Developer stage's first checkpoint to be **a real `vite build` of
`chartroom-ui` immediately after wiring this import**, inspecting the output bundle for any unexpected Node-shim
stub, before building the seven question components on top of it. **Flagged for explicit First Officer sign-off
in §11 item 1** — this is a real, if well-justified, escalation from "export a type" (phase 3, approved) to
"export and bundle real logic" (this phase), and deserves the same scrutiny phase 3's own export decision got.

---

## 3. Write-back mechanism design (the crux)

### 3.1 The question this section answers

Three distinct user actions need to turn into correct, surgical byte changes in a doc's raw file:
1. Clicking a plain GFM checkbox in the **read-only viewer** (`DocView`, not the Milkdown editor).
2. Checking/unchecking a `:::actions` item (also in the read-only viewer).
3. Submitting an answer to a `:::ask-me` question (also in the read-only viewer).

None of these happen inside Milkdown/`DocEditor.tsx` — the task brief is explicit that a checkbox click in
`DocView` "shouldn't require mounting the full Milkdown editor," and phase 3's own opaque-node design (§3.2 of
its plan) already made `:::ask-me`/`:::actions` blocks **non-editable inside Milkdown by construction** (`atom:
true`, raw text only, never parsed). This phase's write-back therefore needs an entirely separate mechanism from
phase 3's `PUT .../docs/:docId` full-file save path — not a variant of it.

### 3.2 Decision: a new, narrow, server-side single-block PATCH mechanism — not a reuse of phase 3's client-side reconstruction path

**Rejected alternative: reuse phase 3's `roundTrip.ts` (client recomputes the whole file, calls the existing
`PUT`).** Concretely rejected, not just "the other option," for three independent reasons:
1. **Architectural leakage.** Phase 3 deliberately confines all Milkdown machinery (`Editor.make()`, the
   commonmark/gfm presets, the opaque node schema) to edit mode only — `DocView`'s read-only render path has
   *never* imported anything from `chartroom-ui/src/editor/*`. Reusing `roundTrip.ts::reconstructFile` from view
   mode would require instantiating a (possibly headless) Milkdown `Editor` on every single checkbox click just
   to get a `parse`/`serialize` pair capable of producing a valid full-file reconstruction — real overhead
   (Milkdown/ProseMirror schema construction is not free) for an action that should feel instantaneous, and it
   reintroduces the exact coupling phase 2/3's package design went out of its way to avoid.
2. **Staleness risk is structurally worse for the reuse path.** Phase 3's `PUT` trusts a full-file string the
   client assembled from whatever `detail.raw` snapshot it loaded at edit-open time. A checkbox click from
   `DocView` (which is *always* showing the last-fetched snapshot, potentially stale relative to concurrent
   activity — another `:::actions` toggle, a chokidar-observed external edit) reusing that same "send the whole
   file" contract would silently clobber any other change that landed on disk since the client's last fetch —
   worse than phase 3's own already-accepted "two Milkdown tabs" risk (§10 risk #7 there), because here the
   *common* case (many small checkbox interactions scattered over a session, from a page that isn't actively
   being edited) makes a stale-whole-file overwrite far more likely to actually happen in practice, not just a
   rare double-tab edge case.
3. **A single-block PATCH is *more* consistent with the project's own established discipline, not less.** Every
   prior phase's write path (the pre-commit hook's lazy normalization, `fix-links.ts::computeLinkFixes`,
   `computeImageFixes`) is a **server-side, freshly-re-parsed, narrowly-scoped splice against the file currently
   on disk** — never a client-trusted whole-file replacement. Phase 3's `PUT .../docs/:docId` is the one
   deliberate exception (justified there because Milkdown's own live-editing session genuinely needs to reason
   about the *whole* document as it's edited) — but that justification does not apply to a single checkbox click
   from a page that has no live editing session open at all. Re-adopting the "re-read fresh, locate narrowly,
   splice narrowly" pattern for phase 4 is the more consistent design, not a deviation invented for convenience.

**Decision, in full:** three new, narrow daemon endpoints, all following the same shape — **the client sends only
a stable *address* plus the new value; the daemon re-reads the file fresh from disk, re-parses it with
`interactive-blocks.ts`'s pipeline, locates the exact node by that address, computes a minimal splice against the
current on-disk bytes (never the client's possibly-stale copy), writes it, and rebuilds** (same `rebuild()` +
`repo.setState()` pattern `doc-save.ts` already established, phase 3 plan §5.3, reused verbatim):

- **`PATCH /api/repos/:repoId/docs/:docId/checkbox`** — body `{ scope: { directiveId: string | null, index:
  number }, checked: boolean, expectedCurrent: boolean }`. Handles **both** a bare, undirected GFM checklist item
  (`scope.directiveId: null`, `index` = that checkbox's 0-based ordinal in whole-document order — the "free"
  checklist write-back spec §4.3's first bullet describes) **and** a `:::actions` item (`scope.directiveId` =
  that directive's own `id` attribute, `index` = the checkbox's ordinal *within that directive's own body* —
  always `0` for the common one-item-per-directive shape, §4.5, but not hard-coded to `0` so a directive
  containing more than one checkbox degrades gracefully rather than being unaddressable). One endpoint, one
  addressing scheme, covers both spec bullets with zero special-casing between them.
- **`PATCH /api/repos/:repoId/docs/:docId/ask-me`** — body `{ directiveId: string, value: <type-shaped>, author?:
  string }`. Locates the `containerDirective` node named `ask-me` whose `attributes.id === directiveId`,
  formats a human-readable answer line (§3.6), and splices the **entire directive block's own `{start, end}`
  span** with a freshly reconstructed version of just that block's text (§3.5) — never touching anything outside
  that one block.
- **`GET /api/inbox`** — read-only aggregation across all registered repos (§5), no write.

**Optimistic-concurrency guard (a deliberate, small strengthening beyond phase 3's pure "last write wins"):**
every mutating request carries the client's belief about the *current* state of the thing it's changing
(`expectedCurrent` for checkboxes; ask-me answers are simply rejected with `409` if the directive already carries
`answered="true"` — see §3.6). The daemon re-derives the actual current state from the fresh on-disk re-parse and
returns `409 Conflict` on a mismatch, rather than blindly overwriting. This is strictly *more* correct than phase
3's accepted last-write-wins posture for the editor (§10 item 7 below explains why full equivalence isn't
possible across all three write paths at once) — cheap to implement (one extra comparison per request) given the
daemon is re-parsing fresh from disk anyway for every request in this design.

### 3.3 `interactive-blocks.ts` — the shared extraction/classification/splice module

`packages/chartroom/src/interactive-blocks.ts` (new), mirroring `segmentBlocks.ts`'s role in phase 3 (the single
most correctness-critical new file in this phase) but scanning-and-splicing rather than full-document
segmentation:

- Its own `unified().use(remarkParse).use(remarkGfm).use(remarkDirective)` pipeline (matching
  `segmentBlocks.ts`'s pipeline choice exactly, reused as a pattern, built independently server-side since
  `markdown.ts`'s own processor doesn't include `remark-directive`, §1.2).
- `extractInteractiveBlocks(raw: string): { askMe: AskMeQuestion[]; actions: ActionsItem[]; checkboxes:
  CheckboxRef[] }` — a single pass over the parsed tree producing:
  - **`AskMeQuestion`** per `containerDirective` named `ask-me`: `{ directiveId, type (normalized via
    `TYPE_ALIASES`, §1.1), prompt, choices?, min?, max?, minLabel?, maxLabel?, placeholder?, allowOther?,
    answered: boolean, answerText?: string, blockRange: OffsetRange }`. `prompt` = the text of the first
    non-list top-level child inside the directive body (paragraph/heading); if none is found, a defensive
    placeholder (`"(untitled question)"`) is used rather than throwing. `choices` (for `single-select`/
    `multi-select`/`ranking`/`compare`) are derived from the directive body's own list, §4.
  - **`ActionsItem`** per `containerDirective` named `actions`: `{ directiveId, label, checked, blockRange }`
    (§4.5).
  - **`CheckboxRef`** for every `listItem` with `checked !== null/undefined` **anywhere in the document**
    (bare or nested inside a directive), each carrying its resolved `scope` (`{ directiveId, index }` — `null`
    directiveId + whole-document ordinal for a bare item; the enclosing directive's id + within-directive
    ordinal otherwise) and its own `{start, end}` — this is the single source of truth both the daemon's
    checkbox-toggle route and the client's `Checkbox` override component key off of (the client only *displays*
    ordinals computed the identical way, via the identical imported function, so there is no drift risk, §2.1).
- `applyCheckboxToggle(raw: string, scope: CheckboxScope, checked: boolean): { newText: string; before: boolean }
  | undefined` — locates the matching `CheckboxRef`, finds the `[ ]`/`[x]`/`[X]` bracket's middle character via a
  bounded regex over that item's own source slice (§1.4), and returns the raw text with exactly that one
  character replaced (`' '` ↔ `'x'`) — a genuine single-character-range splice, the narrowest possible write in
  this whole project. Returns `undefined` if no such scope/index exists (the route maps this to `404`).
- `applyAskMeAnswer(raw: string, directiveId: string, answerLine: string): { newText: string } | undefined` —
  locates the matching `AskMeQuestion`'s `blockRange`, reconstructs that block's own text with (a) `
  answered="true"` inserted into the opening fence's attribute list (a string replace of the fence line's final
  `}` with ` answered="true"}`) and (b) the formatted answer blockquote line (§3.6) appended as a new paragraph
  immediately before the closing `:::` fence (with a blank line inserted first if the preceding line isn't
  already blank) — then splices that **whole reconstructed block string** back into the original raw text at the
  original `{start, end}` span. Nothing outside that span is touched, by construction (same "one splice, applied
  against fresh offsets, over the original string" discipline as `fix-links.ts`).
- `TYPE_ALIASES`, `KNOWN_TYPES` (mirroring `ask-human/bin/server.mjs`'s own validation set, §1.1), and
  `formatAnswerText(question, value)` (§3.6) are all exported alongside these, unit-tested independently.

**One additive, small change to phase-1's `AstNode` (`markdown.ts`):** the shared `AstNode` interface (already
exported for phase 3's reuse) gains one new optional field, `checked?: boolean | null`, so
`interactive-blocks.ts` can read GFM checkbox state off the same shared node contract rather than defining a
fourth parallel type. Zero behavior change to any existing consumer (an unused optional field on a type is not a
runtime change) — same category of low-risk additive change as phase 3's own `AstNode` export itself. Flagged in
§11 for the same reason phase 3 flagged its export decision: touching a phase-1 file's public type, even
additively, deserves a quick nod.

### 3.4 `RepoState`/`rebuild()` extension — precomputed, not scanned per-request

Rather than having `GET /api/inbox` re-read and re-parse every doc in every registered repo on every request
(a real, if probably-small-in-practice, cost that would scale with total doc count across all repos), `repo-
state.ts::rebuild()` is extended to also compute `interactiveBlocks: RepoInteractiveIndex` (a
per-doc-id map of that doc's `extractInteractiveBlocks()` result) at the same point it already computes
`backlinks`/`check` — i.e., on daemon startup and on every chokidar-triggered or save-triggered rebuild (phase
2 §4.2, phase 3 §5.3, both unmodified mechanisms). This costs one extra `readFileSync` + parse pass per doc per
rebuild (rebuilds already do a full `buildFreshIndex` pass over every doc's content for links/headings, so this
is proportionally small additional work on an already-doc-count-scaling operation, not a new order of growth) and
means `GET /api/inbox` is a **pure in-memory aggregation** over already-computed state across all registered
`RepoRuntime`s — no new re-parsing on the read path at all, and the checkbox/ask-me PATCH routes' own
`rebuild()` call (which they must do anyway to keep `check`/`backlinks` fresh, exactly like `doc-save.ts`) is what
keeps this cache current, with no separate invalidation logic needed.

### 3.5 How `:::ask-me`'s answer format lands exactly per spec §4.1

Spec's literal example: the block gains an answer line (`> **Answer** (2026-07-04, Ondřej): Both — PAT now,
OAuth later.`) and `answered="true"` on the directive. Both are produced by `applyAskMeAnswer` (§3.3) operating
**only within the directive's own already-known `{start, end}` span** — the rest of the file is never touched,
by construction, matching every prior phase's splice discipline. Date is the server's current date, formatted
`YYYY-MM-DD` (matching the spec example's own format, not an ISO timestamp — a small, deliberate readability
choice). Author is resolved as: the client-supplied `author` field if present, else `os.userInfo().username`
server-side (§3.6/§11 item 4 — the client-side capture mechanism for a friendlier display name than an OS login
is a UX call flagged for sign-off, not hard-required for correctness).

### 3.6 Answer-value formatting — `formatAnswerText(question, value)`

A pure, unit-tested function turning a type-shaped answer value into the spec's human-readable blockquote text:
- `single-select`/`compare`/`yesno`: the chosen option's **label** (not its raw `value` slug) — e.g. `"Both"`.
- `multi-select`: comma-joined labels — e.g. `"PAT tokens, OAuth 2.1"`.
- `rating`: the number, with its configured bounds for context — e.g. `"8/10"`.
- `ranking`: the final order's labels, numbered — e.g. `"1. Performance 2. Developer experience 3. Cost"`.
- `text`: the raw text, verbatim.

This keeps the in-doc record genuinely "self-documenting" (spec §4.1's own framing: "the doc becomes its own
decision record; agents read answers with plain Read") — an agent reading the raw answer line gets prose, not a
JSON blob it has to cross-reference against a separate choices array.

### 3.7 Already-answered blocks cannot be re-answered or hand-corrected via Chart Room's own editor — a real, named limitation

Once `answered="true"` is set, `interactive-blocks.ts`'s route rejects a second answer attempt with `409` (kept
simple — one question, one answer, matching the spec's own single-answer-line framing, rather than silently
overwriting or accumulating multiple answer lines). Separately, and more structurally: phase 3's opaque-node
design (`atom: true`) makes `:::ask-me` blocks **entirely non-editable inside Milkdown** — so a human who
answered wrong has **no in-app way to correct it**, not even by opening the doc in the WYSIWYG editor (the block
is inert there by design). The only fix is hand-editing the raw file with an external text editor. This is a
genuine product gap worth the First Officer's attention (§11 item 6), not something this plan silently works
around by, say, making ask-me blocks conditionally editable in Milkdown (which would reopen phase 3's
carefully-closed "directive syntax Milkdown can't parse" corruption risk for exactly the blocks that most need
protecting, since they now also carry a hand-formatted answer line).

---

## 4. Question-type rendering

### 4.1 In-doc markdown shape per type — how `choices`/bounds are authored

`remark-directive` attributes are flat string key/value pairs — no arrays, no nesting. Anything list-shaped
(`choices`) must live in the directive's **body** as ordinary markdown; anything scalar (`min`/`max`/
`placeholder`) lives as an **attribute** on the opening fence. Per type:

| Type | Attributes used | Body shape | `choices`/value source |
|---|---|---|---|
| `single-select` / `multi-select` | `id`, `type`, `allowOther?` | A GFM task list (`- [ ] Label`) | Each list item → `{value: slug(label), label}`. **The item's own authored checked-state is read as a `suggested` pre-fill hint, never as a persisted answer** (§4.2) — the checklist inside an ask-me block is never wired to the generic checkbox-toggle endpoint. |
| `text` | `id`, `type`, `placeholder?` | Optional plain paragraph (used as `suggested` prefill text) | n/a |
| `yesno` | `id`, `type` | None needed beyond the prompt paragraph | n/a |
| `rating` | `id`, `type`, `min?`, `max?`, `minLabel?`, `maxLabel?` | None needed | n/a |
| `ranking` | `id`, `type` | A GFM **ordered** list (`1. Label`) | Item order = suggested initial ranking; the source list itself is never rewritten — only the final `> **Answer**` line records the outcome (§3.6), keeping "checklist enumerates, blockquote records" consistent across every type. |
| `compare` | `id`, `type` | A GFM (unordered) list where each item's own nested block content supplies `context` | Each top-level list item's inline text → `label`; any nested paragraph/code-block content under that item → `context`, kept as **real nested mdast**, not re-parsed through a hand-rolled mini-markdown regex the way `page.html.tmpl` has to (a genuine improvement available for free, since `chartroom-ui` already has a full remark/react-markdown pipeline on hand). |

`prompt` (every type) = the first non-list top-level content inside the directive body (§3.3).

### 4.2 Two distinct interaction models — stated explicitly to avoid ambiguity

1. **Immediate-persist checkbox toggle** (bare GFM checklists, §4.3's first spec bullet; `:::actions` items,
   §4.5) — click, PATCH fires immediately, no separate confirm step. Backed by `PATCH .../checkbox` (§3.2).
2. **Compose-then-submit ask-me answer** (all seven question types, mirroring `page.html.tmpl`'s own "fill in
   the form, click one Submit button" UX) — the question widget holds local, uncommitted React state; nothing is
   written to the doc until the human clicks "Submit answer" for that question, which calls `PATCH .../ask-me`
   once with the fully composed value. **The GFM checklist inside a `single-select`/`multi-select` ask-me block
   is never itself wired to the checkbox-toggle endpoint** — it is purely a declarative options list rendered by
   the question widget (§4.4), not an interactive checklist in its own right, even though it's authored with
   identical `- [ ]` syntax to a real, independently-clickable checklist elsewhere in the same doc.

### 4.3 Component tree

- **`AskMeBlock.tsx`** (new, replaces `DirectiveFallback` for the `ask-me` tag in `DocView`'s `components` map):
  receives the pre-parsed `AskMeQuestion` object (from `extractInteractiveBlocks`, run once per doc render in
  `DocView`, §4.7 — **not** react-markdown's own `children`/attribute props for this directive, since the
  structured `choices`/`min`/`max` shape needed for correct widget selection isn't recoverable from react-
  markdown's default nested-element rendering of the directive's body). If already answered (`answered: true`),
  renders the stored answer read-only (prompt + the answer line, no interactive widget). Otherwise dispatches to
  one of seven per-type widgets by `question.type`, or a graceful "unknown question type" fallback (§1.1 item 4)
  for anything `TYPE_ALIASES`/`KNOWN_TYPES` doesn't recognize.
- **`ActionsBlock.tsx`** (new, replaces `DirectiveFallback` for the `actions` tag): a thin wrapper — small
  "Action" badge/label plus the directive's own checklist rendered through the **same shared `Checkbox`**
  component bare checklists use (§4.5) — no structured pre-pass needed for this one (unlike `AskMeBlock`, its
  body genuinely is just a clickable checklist, nothing richer).
- **`Checkbox.tsx`** (new) — the shared clickable-checkbox override, wired into `DocView`'s `components` map for
  the standard `li`/`input[type=checkbox]` GFM task-list rendering (currently unhandled/default-disabled in
  react-markdown's own output). Reads its own ordinal via a render-order counter matching
  `extractInteractiveBlocks`'s own `CheckboxRef` numbering exactly (both driven by the same imported function,
  §2.1 — no drift), calls `toggleCheckbox` (new `api/client.ts` wrapper) on click, optimistic local UI update with
  rollback on a `409`/error response.
- **Seven question widgets** (`src/components/questions/*.tsx`) — `SingleSelectQuestion` (radio group + optional
  "Other" text field, mirrors `page.html.tmpl::renderSingleSelect`), `MultiSelectQuestion` (checkbox group +
  optional "Other", mirrors `renderMultiSelect`), `TextQuestion` (textarea, mirrors `renderText`), `YesNoQuestion`
  (three toggle buttons, mirrors `renderYesNo`), `RatingQuestion` (native `<input type="range">` + live value
  display, mirrors `renderRating`), `RankingQuestion` (drag-reorder list + up/down buttons, mirrors
  `renderRanking`'s exact interaction model), `CompareQuestion` (a card grid, click-to-select, mirrors
  `renderCompare`). Each is a **fresh React implementation** — `page.html.tmpl` is a static HTML string with
  vanilla-JS DOM manipulation baked into `bin/server.mjs`'s templating; it cannot be imported into a React tree,
  only its *UX/behavior* mirrored, exactly as the task brief anticipated. The mirroring is close enough that a
  human familiar with `ask-human`'s own browser flow would recognize each widget immediately.

### 4.4 What "reusing the ask-human skill's rendering logic" concretely means here

Per the task brief's explicit ask to reuse where practical rather than reinvent question-type UI from scratch:
every widget's **behavioral contract** (which control type per schema type, what `suggested` pre-fills, how
`allowOther` adds a write-in field, how ranking drag-and-drop reorders, how compare cards toggle a single
selection) is taken directly from `page.html.tmpl`'s already-working implementation, read function-by-function
during this research pass (§ citations above name the exact `render*` functions mirrored). What is **not**
reused is any literal code — the vanilla-JS DOM-builder (`el(...)`) has no React equivalent worth preserving,
and CSS is reworked to match `chartroom-ui`'s own `base.css` (light/dark mode via `prefers-color-scheme`,
already established there) rather than porting `page.html.tmpl`'s inline `<style>` block verbatim.

---

## 5. `:::actions` design

### 5.1 Resolving a second, smaller spec ambiguity: one directive per action item, not one directive wrapping a list

Spec §4.3's wording — "`:::actions` block = human-action items with ids, checkable" — is read two ways: (a) a
single `:::actions{...}` directive wraps a *list* of several human-action items, each needing its own id
(requiring a new, not-yet-invented inline-id markdown convention per list item, since `remark-directive`
attributes only exist at the block level); or (b) **each `:::actions{id="..."}` directive *is* one human-action
item**, directly mirroring `:::ask-me{id="..."}`'s own one-directive-one-question shape. **Decision: reading
(b).** It requires no new inline-id syntax invention (a real complexity/risk `remark-directive`'s attribute model
doesn't support natively), is structurally symmetric with the already-built `:::ask-me` convention, and satisfies
the spec's literal words exactly as written ("human-action items" = the directive blocks themselves, plural
across a doc; "with ids" = each carries the directive's own `id` attribute; "checkable" = its body's checkbox is
clickable) without requiring a bigger, invented data model. Example:

```md
:::actions{id="deploy-approval"}
- [ ] Approve production deploy of v2.3
:::
```

Flagged explicitly in §11 item 3 as an interpretive call, same spirit as §1.1's type-name resolution — not
guessed silently.

### 5.2 Why this doesn't need its own structured pre-pass

Because an actions item's body genuinely is just a checklist (not a rich per-type widget the way ask-me needs),
`ActionsBlock` renders its `children` through the ordinary react-markdown pipeline with the shared `Checkbox`
override already wired in (§4.3) — the directive wrapper only exists to (a) carry a stable `id` for inbox
addressing (§6) and (b) render a small visual "this is a human action" affordance. `interactive-blocks.ts` still
extracts a structured `ActionsItem` per directive (§3.3) — needed by the inbox (§6), which must aggregate
"unchecked" state without asking the browser to render anything.

---

## 6. Human-action inbox

### 6.1 Aggregation logic

`GET /api/inbox` (new, `packages/chartroom/src/daemon/routes/inbox.ts`) iterates **every** `RepoRuntime` in the
full `repos` array already passed into `buildServer` (server.ts already threads this list to every route
registrar — no new plumbing needed to reach "all registered repos" from one route module) and, for each repo,
reads `repo.getState().interactiveBlocks` (§3.4, already computed, no re-parsing on this path) and collects:
- every `AskMeQuestion` with `answered === false`,
- every `ActionsItem` with `checked === false`,

into one flat, cross-repo list: `{ repoId, repoName, docId, docPath, kind: 'ask-me' | 'actions', directiveId,
label (question's `prompt` or action's own text), type? (ask-me only) }`. No filtering/pagination logic beyond
this (matches the project's "don't overbuild" precedent — phase 2's registry deliberately shipped without an
`unregister` command for the same reason) — a flat list is enough to satisfy "aggregate... into the daemon's
human-action inbox page."

### 6.2 UI page

`src/inbox/InboxPage.tsx` (new) — a new hash route (`#/inbox`, added to `App.tsx`'s existing `ROUTE_RE`/
`parseHash`/`navigateTo` trio, additively) rendering the flat list grouped by repo, each item deep-linking to
`#/repo/<repoId>/doc/<docId>` (reusing `App.tsx`'s existing navigation, so clicking an inbox item lands the human
directly on the doc containing the unanswered question/unchecked action, scrolled to... — no auto-scroll-to-
directive is built in this phase, a small, acceptable UX gap given the acceptance line doesn't require it, noted
not engineered around). A small nav entry (e.g. a persistent "Inbox (N)" link/badge in the existing
`RepoSwitcher`/app shell chrome) surfaces the page without requiring the human to know the `#/inbox` URL exists.

---

## 7. Files to create/modify (both packages)

### `packages/chartroom` (existing package)

| Path | Change | Purpose |
|---|---|---|
| `src/interactive-blocks.ts` | new | Shared extraction/classification/splice module (§3.3) — the single most heavily-tested file this phase |
| `src/markdown.ts` | modify | add `checked?: boolean \| null` to the exported `AstNode` interface (§3.3, additive) |
| `src/daemon/routes/doc-checkbox.ts` | new | `PATCH /api/repos/:repoId/docs/:docId/checkbox` (§3.2) |
| `src/daemon/routes/doc-ask-me.ts` | new | `PATCH /api/repos/:repoId/docs/:docId/ask-me` (§3.2) |
| `src/daemon/routes/inbox.ts` | new | `GET /api/inbox` (§6.1) |
| `src/daemon/repo-state.ts` | modify | `rebuild()` also computes `interactiveBlocks` per doc (§3.4) |
| `src/daemon/server.ts` | modify | wire the three new route modules into `buildServer` (additive, alongside existing registrations) |
| `package.json` | modify | add `"./interactive-blocks"` to the `exports` map (no new runtime deps, §1.2) |
| `test/interactive-blocks.test.ts` | new | Unit tests: extraction/classification correctness, checkbox/ask-me splice byte-fidelity (§8.1) |
| `test/daemon/doc-checkbox.test.ts` | new | `.inject()` tests: toggle success, 409 on stale `expectedCurrent`, 404 on unknown scope |
| `test/daemon/doc-ask-me.test.ts` | new | `.inject()` tests: answer success (correct blockquote + `answered="true"`), 409 on already-answered, 400 on type-shape mismatch |
| `test/daemon/inbox.test.ts` | new | `.inject()` test across 2+ scratch repos, mixed answered/unanswered/checked/unchecked fixtures |
| `acceptance/ask-me-round-trip.mjs` | new | The Build Order's literal acceptance line, end-to-end (§8.4) |

### `packages/chartroom-ui` (existing package)

| Path | Change | Purpose |
|---|---|---|
| `src/components/AskMeBlock.tsx` | new | Dispatches to the seven question widgets or answered-read-only view (§4.3) |
| `src/components/ActionsBlock.tsx` | new | Thin wrapper + shared `Checkbox` for its own body (§5.2) |
| `src/components/Checkbox.tsx` | new | Shared clickable-checkbox override wired into `DocView`'s `components` map (§4.3) |
| `src/components/questions/SingleSelectQuestion.tsx` | new | Radio group + optional "Other" (§4.3) |
| `src/components/questions/MultiSelectQuestion.tsx` | new | Checkbox group + optional "Other" |
| `src/components/questions/TextQuestion.tsx` | new | Textarea |
| `src/components/questions/YesNoQuestion.tsx` | new | Yes/No/Unsure toggle buttons |
| `src/components/questions/RatingQuestion.tsx` | new | `<input type="range">` + live value |
| `src/components/questions/RankingQuestion.tsx` | new | Drag-reorder + up/down buttons |
| `src/components/questions/CompareQuestion.tsx` | new | Card grid, click-to-select |
| `src/components/DocView.tsx` | modify | pre-parse via imported `extractInteractiveBlocks` (§4.7); wire `ask-me`→`AskMeBlock`, `actions`→`ActionsBlock` (replacing `DirectiveFallback` for just these two tag names — `llm`/`human` untouched); wire `Checkbox` into `components` for bare task-list rendering |
| `src/api/client.ts` | modify | add `toggleCheckbox(repoId, docId, scope, checked, expectedCurrent)`, `submitAskMeAnswer(repoId, docId, directiveId, value, author?)`, `fetchInbox()` typed wrappers (additive) |
| `src/inbox/InboxPage.tsx` | new | Inbox page (§6.2) |
| `src/App.tsx` | modify | add `#/inbox` route + a small nav entry to reach it |
| `test/interactive/AskMeBlock.test.tsx` | new | jsdom+RTL: each question type renders its correct widget; answered blocks render read-only |
| `test/interactive/Checkbox.test.tsx` | new | jsdom+RTL: click toggles optimistic UI state, calls the mocked API wrapper with the correct scope |
| `test/interactive/questions/*.test.tsx` | new | Per-widget behavior (radio single-select, "Other" write-in, rating slider bounds, ranking reorder, compare card selection) |
| `test/inbox/InboxPage.test.tsx` | new | Renders a fixture inbox response, asserts grouping + deep-link hrefs |

No files are created by this Team Lead session — this table is the Developer stage's shopping list, same
convention as phases 1-3's own plans.

---

## 8. Test plan

### 8.1 Unit tests — write-back splice byte-fidelity (matching phase 1/3's rigor)

`test/interactive-blocks.test.ts` (`chartroom`), fixture-driven, mirroring `roundTrip.test.ts`'s own
"no-op vs. targeted-edit, assert everything else byte-identical" discipline:
- **Checkbox toggle:** a doc with several checkboxes (bare + inside one `:::actions` block) → toggling one via
  `applyCheckboxToggle` changes **exactly one character** (assert via a line-level diff of before/after, same
  technique `roundTrip.test.ts` already uses) and correctly reports `before` for the concurrency-check callers.
  Toggling a checkbox at an out-of-range `index` returns `undefined` (no partial/corrupt write).
- **Ask-me answer:** a doc with an unanswered `:::ask-me{id="q-03" type="choice"}` block (proving the alias
  normalization, §1.1) plus unrelated surrounding content → `applyAskMeAnswer` produces `answered="true"` on the
  fence line, an appended `> **Answer** (...): ...` line inside the block, and **byte-identical content outside
  the block's own span** (asserted the same line-diff way). A second call against an already-`answered="true"`
  block is rejected by the *route* layer (§8.2), but the pure function itself is also tested to confirm it still
  correctly locates an already-answered block's span (used by the route to detect the conflict in the first
  place).
- **Extraction correctness:** every question type's `choices`/`min`/`max`/`prompt` extraction against hand-built
  fixtures covering all seven real types plus the `choice`/`free-text`/`comparison` legacy aliases (§1.1) and one
  deliberately-unknown `type="bogus"` fixture (asserts graceful fallback shape, never a thrown exception).
- **`formatAnswerText`:** one fixture per type, asserting the exact human-readable string shapes documented in
  §3.6.

### 8.2 Daemon route tests (`.inject()`, matching phase 2/3's own pattern — no real TCP socket)

`doc-checkbox.test.ts`, `doc-ask-me.test.ts`: success cases (file actually changes on disk, response reflects
fresh state); `409` on a stale `expectedCurrent`/an already-answered ask-me block; `404` on an unknown `docId` or
an unresolvable `scope`/`directiveId`; a byte-size/shape validation test mirroring `doc-save.ts`'s own defensive
posture (reject a malformed body rather than crash).

`inbox.test.ts`: two scratch repos registered (temp-`HOME`-scoped registry, never touching the real
`~/.chartroom/repos.json` — same discipline as phase 2's own acceptance script), each with a mix of
answered/unanswered ask-me and checked/unchecked actions fixtures → `GET /api/inbox` returns exactly the
unanswered/unchecked subset, correctly attributed to the right repo/doc.

### 8.3 Component tests (jsdom + RTL, matching phase 2/3's `DocView.test.tsx`/`roundTrip.test.ts` split)

Per-widget behavioral tests (§7's table) plus `AskMeBlock.test.tsx`'s dispatch-by-type coverage and
`Checkbox.test.tsx`'s click→API-call wiring (mocked `fetch`, not a real daemon) — same "pure logic gets a pure
test, DOM interaction gets a lighter jsdom smoke test" split phase 2 established.

### 8.4 Acceptance script — the Build Order's literal line, end to end

`acceptance/ask-me-round-trip.mjs` (`packages/chartroom`, mirrors the disposable-scratch-git-repo pattern every
prior phase's acceptance script already uses): scaffold a scratch repo with one doc containing an unanswered
`:::ask-me{id="q-03" type="single-select"}` block with a two-item checklist (simulating "agent writes an ask-me
block via file edit" — the script itself performs this file edit, standing in for the agent) → drive
`PATCH .../ask-me` via `buildServer()` + `.inject()` (simulating "human answers in browser," proven at the API/
data layer per the same honest "no real browser" caveat every prior phase's acceptance script has carried,
§9 risk #6) → assert the on-disk file now contains the correct `answered="true"` attribute and answer blockquote
line (simulating "answer lands in the doc") → re-read the file via plain `readFileSync` (simulating "agent reads
it back" — the literal, spec-mandated proof that this works with nothing but a raw file read, no daemon/API
involved for this last step) and assert the answer text is present and correctly formatted. This is the single
script proving the entire acceptance sentence, four clauses in sequence, matching how phase 1's own
`git-mv-resolution.mjs` proves its acceptance line clause-by-clause.

### 8.5 Spec acceptance criteria → verification mapping

| Spec acceptance criterion (§8 item 4) | How this plan verifies it |
|---|---|
| "agent writes an ask-me block via file edit" | Acceptance script's own scratch-repo setup step (§8.4) — a plain file write, no Chart Room tooling involved, matching the spec's own "works via Read/Grep/edit alone" north star |
| "human answers in browser" | `doc-ask-me.test.ts` (API layer) + `AskMeBlock.test.tsx`/per-widget tests (rendering/interaction layer) — see §9 risk #6 for the honest "no real browser" limitation this combination carries, same caveat every prior phase's plan named |
| "answer lands in the doc" | `interactive-blocks.test.ts`'s splice-fidelity assertions + acceptance script's on-disk read-back (§8.4) |
| "agent reads it back" | Acceptance script's final plain `readFileSync` step (§8.4) — deliberately not going through any API for this step, matching the literal wording |
| GFM checkbox write-back ("free") | `doc-checkbox.test.ts` + `Checkbox.test.tsx` |
| `:::actions` checkable, ids | `ActionsBlock.test.tsx`-equivalent coverage inside the `Checkbox`/`AskMeBlock` suites + `inbox.test.ts`'s actions-item aggregation case |
| Cross-repo inbox aggregation | `inbox.test.ts`'s two-scratch-repo case |
| No corruption of unrelated content on any write | Line-level diff assertions in `interactive-blocks.test.ts` (§8.1), same technique as phase 3's `roundTrip.test.ts` |

---

## 9. Risks (riskiest first)

1. **[Riskiest] `interactive-blocks.ts`'s extraction/splice logic is entirely hand-designed, same risk category as
   phase 3's `roundTrip.ts`.** No library does "locate a directive/checkbox by a stable address in a freshly
   re-parsed tree and splice narrowly." Mitigation: the fixture-based test suite (§8.1) is deliberately broad
   (all seven types + both legacy aliases + an unknown-type fallback + adjacency-style "unrelated content stays
   byte-identical" assertions) — this is the file the Reviewer should scrutinize hardest, per the same standing
   instruction phase 3's own risk #1 established.
2. **Three write paths can now race each other, not two.** Phase 3 already accepted "two Milkdown tabs, last
   write wins" as a named, low-severity risk (its own §10 risk #7). This phase adds `PATCH .../checkbox` and
   `PATCH .../ask-me` as two *more* independent writers of the same files. The optimistic-concurrency check
   (§3.2) protects a checkbox/ask-me write against *another* checkbox/ask-me write, and against an external
   change (chokidar-observed), but **does not** protect against a concurrent Milkdown `PUT` full-file save
   racing a checkbox toggle — a human editing a doc's prose in one tab while another tab (or their own earlier
   click) toggles a checkbox could still have the `PUT`'s stale-at-load-time full-file content silently overwrite
   the checkbox change, or vice versa, depending on write order. This is a genuine, not-fully-solved hazard,
   named plainly rather than implied-solved by the 409 mechanism — worth explicit First Officer attention (§11
   item 7).
3. **Cross-package runtime-code export (`chartroom/interactive-blocks` into `chartroom-ui`'s browser bundle,
   §2.1) is a real escalation from phase 3's type-only export precedent**, and phase 3 itself already hit one
   concrete browser-bundle breakage from a similar-looking but Node-dependent cross-package import
   (`link-paths.ts`). This plan's dependency chain is verified dependency-free of Node builtins by inspection,
   but "verified by inspection" is exactly what phase 3's own postmortem says isn't enough — a real `vite build`
   check is mandated as the Developer stage's first checkpoint (§2.1), not optional.
4. **The `:::actions` = one-directive-per-item interpretation (§5.1) could be the wrong reading of a genuinely
   ambiguous spec sentence.** If the Captain actually intended a single `:::actions` block to wrap many
   independently-addressable items, this plan's addressing scheme (directive-id + within-directive index) still
   *technically* supports that shape (an actions directive with several checkboxes, indices `0..n`), just without
   any way to assign each item its own separate stable `id` the way ask-me questions have — items would only be
   addressable by position, which drifts if the list is reordered by hand-editing. Low-to-medium severity; easy
   to extend later (an inline id convention could be added) without redesigning the endpoint shape.
5. **No answer-editing/correction path for a wrong ask-me answer (§3.7).** A real, named product gap: once
   answered, a mistake can only be fixed by hand-editing the raw file outside Chart Room entirely. Deliberately
   not "solved" by this plan (solving it well would require either reopening Milkdown's opaque-node protection
   for exactly the highest-value-to-protect blocks, or building a separate "edit answer" browser affordance
   neither the spec nor the acceptance line asks for) — flagged for a product decision (§11 item 6), not silently
   left as an apparent oversight.
6. **No automated real-browser smoke test**, the same honest limitation every prior phase's plan named (phase 2
   §9 risk #1, phase 3 §10 risk #8) — now with a *third* consecutive phase's interactive surface (seven new
   widget types, drag-reorder, immediate-persist clicks) stacking on top of Ctrl+K/paste/Milkdown's own surface
   from phase 3. The case for eventually adding Playwright (or finally getting a working `claude-in-chrome`
   session for a real manual pass, which the phase-2/3 Reviewer attempts both recorded as unavailable at the
   time) is now compounding across three phases in a row — flagged again, more insistently, in §11 item 8.
7. **Attachments dropped from ask-me v1 (§1.3) despite the spec's own prose literally naming them** as part of
   the reused schema. Low severity given the Build Order's literal acceptance line doesn't require them, but
   worth a plain, direct confirmation rather than assuming silence means agreement.
8. **Inbox aggregation cost scales with total doc count across all registered repos on every rebuild** (§3.4) —
   low risk at anything resembling this project's own current scale (a handful of repos, tens of docs), flagged
   as a future-optimization note (e.g., only re-scanning a doc's interactive blocks when its content hash
   changes, rather than every rebuild) rather than something worth engineering against pre-emptively.

---

## 10. Definition of DONE mapping

| DoD item (spec §9 / Build Order §8 item 4) | How satisfied |
|---|---|
| `ask-me` (ask-human schema) works | §1.1 (mismatch resolved), §4 (all seven real types + two legacy aliases rendered), §3 (write-back) |
| GFM checkbox write-back | §3.2/§3.3 (`PATCH .../checkbox`, single-character splice), §4.2 item 1 |
| `:::actions` | §5 (one-directive-per-item design), reuses the shared checkbox mechanism |
| Cross-repo human-action inbox page | §6 (aggregation logic + `GET /api/inbox` + `InboxPage.tsx`) |
| Acceptance: "agent writes an ask-me block via file edit" | §8.4 acceptance script step 1 |
| Acceptance: "human answers in browser" | §8.4 step 2 (API-level) + §8.3 (rendering/interaction-level) — see §9 risk #6 for the honest browser-testing limitation |
| Acceptance: "answer lands in the doc" | §8.1/§8.4 (splice-fidelity + on-disk assertion) |
| Acceptance: "agent reads it back" | §8.4's final plain-`readFileSync` step |
| No corruption of unrelated content on any write | §8.1's line-diff assertions, same discipline as every prior phase |
| `:::llm`/`:::human` rendering, Milkdown editor untouched except the one additive `AstNode` field | Confirmed by design (§0/§3.3) — Reviewer should grep the diff for any change to `LlmBlock.tsx`/`HumanBlock.tsx`/`opaqueNode.ts`/`roundTrip.ts`, expect none |
| Builds clean | `pnpm --filter chartroom build`, `pnpm --filter chartroom-ui build` (tsc + vite build, including the §2.1 real-`vite-build` checkpoint), `turbo run build` |
| Lint passes | Existing package-scoped `eslint.config.mjs` in both packages, `turbo run lint` clean |
| Tests pass | `vitest run` in both packages — all §8 unit/route/component tests green |
| No new npm dependencies | Confirmed by design (§1.2) — Reviewer should diff both `package.json`s and expect only an `exports` map addition to `chartroom`'s, no new `dependencies`/`devDependencies` entries in either package |

---

## 11. Needs First Officer / Captain decision

1. **Cross-package runtime-code export (`chartroom/interactive-blocks` → `chartroom-ui`'s browser bundle, §2.1).**
   A real escalation from phase 3's approved type-only export precedent. I judge it safe (verified
   Node-builtin-free dependency chain) but it needs the same explicit sign-off phase 3's own export decision got,
   plus a mandated real-`vite-build` checkpoint at the start of the Developer stage rather than trusting
   inspection alone (phase 3's own postmortem is the reason for this caution, not a hypothetical).
2. **The spec-example-vs-real-schema type-name mismatch resolution (§1.1)** — `type="choice"` treated as a
   backward-compatible alias for `single-select`, all seven real schema types implemented as the canonical
   vocabulary, `attachments` recognized as not-a-type-at-all rather than invented as a fictitious seventh type.
   Please confirm this reading before the Developer stage; getting this wrong changes which types actually need
   widgets built.
3. **`:::actions` = one directive per action item, not one directive wrapping a list of many (§5.1).** A real
   interpretive call on a genuinely ambiguous spec sentence, chosen for symmetry with `:::ask-me`'s own shape and
   to avoid inventing a new inline-id markdown convention. Confirm or override before implementation — reversing
   this later would change the addressing scheme and the inbox's per-item identity model.
4. **Author-name capture for the `> **Answer** (date, author): ...` line (§3.5).** No existing mechanism in this
   project captures a "who is the human" identity anywhere. Recommending: an optional client-supplied `author`
   (captured once via a simple prompt, cached in `localStorage`, no new dependency) with a server-side
   `os.userInfo().username` fallback if the client doesn't supply one. A product/UX call, not a hard requirement
   — confirm or propose a different default.
5. **Attachments on ask-me answers — deferred, not built (§1.3).** The real schema supports them; the spec's own
   prose names them; the literal acceptance line doesn't require them. Confirm deferring is acceptable, or
   request the cheap extension (reusing phase 3's existing asset-upload endpoint, referencing the result from
   the answer blockquote text) be included now instead.
6. **No answer-correction path once `answered="true"` is set (§3.7).** A genuine, if narrow, product gap —
   confirm this is acceptable for v1 (fix by hand-editing the raw file outside Chart Room) or direct a specific
   resolution (e.g., allow re-answering by relaxing the `409`, at the cost of the doc accumulating multiple
   answer lines over time unless further designed).
7. **Optimistic-concurrency `409`s protect checkbox/ask-me writes against each other and against external
   changes, but not against a concurrent Milkdown full-file `PUT` save (§9 risk #2).** This is named as an open,
   not-fully-solved hazard rather than presented as solved. Confirm this residual risk is acceptable for v1
   (matching the project's existing "single local user, last-write-wins is an accepted risk class" posture from
   phase 3) or flag if a stronger cross-write-path guard is wanted (would need real design work beyond this
   plan's scope, e.g. a shared in-memory file-version counter all three write paths check against).
8. **No automated real-browser smoke test, third phase in a row (§9 risk #6).** The case for finally resolving
   this — either a working `claude-in-chrome` manual pass during Reviewer stage, or adding Playwright as a
   one-time investment — is now compounding across phases 2, 3, and this one. Recommend this be the phase where
   it's actually resolved one way or the other, rather than deferred a fourth time.
9. Per the mission's standing rule: **never `rm`/delete anything.** Nothing found this session needing removal
   or logging to `REMOVALS.md` — this plan is additive to phases 1-3's merged code except for the two small,
   explicitly-flagged additive changes (§3.3's `AstNode.checked` field, §2.1's new `exports` subpath), neither of
   which changes any existing behavior.
10. `team-tasks/` is never referenced or touched anywhere in this plan — confirmed by design, not by omission.

---

## 12. Note on this Team Lead session's own tool access

This plan was written directly to `suite-design/overnight/plans/04-cr-phase4-plan.md` by a planning-only session
with file-write access restricted to this single path — no implementation files, dependency installs, or commits
were made, per this session's own operating constraints.
