---
id: report-03-captains-deck-ui-developer
---

# Package 03 — Captain's Deck — UI developer report (plan §4.6 + UI parts of §3.1, phase 1 only)

- **Who/where:** wave-developer, isolated worktree on `scratch/deck-ui` (cut from `ship-wave1-deck`
  @ 824c194). Files touched: `packages/chartroom-ui/` only.
- **Outcome:** DONE. 4 commits, build + lint + tests green.

## Gates (all run in the worktree, `packages/chartroom-ui`)

- `pnpm build` (tsc --noEmit + vite build): **PASS** (`✓ built in 261ms`; pre-existing >500 kB
  chunk warning from Milkdown, unchanged).
- `pnpm lint` (eslint .): **PASS**, zero findings.
- `pnpm test` (vitest, jsdom): **PASS — 172 tests / 20 files** (regression floor was 144/16 at
  824c194; +28 new tests, 0 existing tests modified or lost; `test/Sidebar.test.tsx` still green).

Baseline note: at 824c194 the UI suite initially showed 2 collection failures purely because the
`chartroom` workspace dep had no `dist/` (its `./interactive-blocks` export). `pnpm --filter
chartroom build` emits dist and the suite is 144/144 green — the chartroom **tsc failure at that
commit is pre-existing backend-parallel work** (`src/station.ts` can't resolve `suite-conventions`;
`serve.ts` uses `start`/`stop` not yet on `ChartroomStation`) and is NOT touched by me (outside my
file ownership).

## What was built (per dispatch)

1. **`src/App.tsx` re-authored** — "THE SHIP — CAPTAIN'S DECK" chrome + CompassMark + breadcrumbs;
   TabBar wired to `GET /api/hull/stations` (fetch failure ⇒ single-tab Docs mode; Voyage tab
   appended only when `GET /api/voyage` answers); single `parseHash` (dedupe fixed); routes
   `#/repo/<id>[/doc/<key>]` + `#/inbox` (Docs tab, deep-link compatible, auto-select-first-repo
   kept, never hijacks `#/voyage`) + new `#/voyage`; claude chip (disabled + tooltip when no active
   repo, busy spinner, success/error toast with ~4 s auto-dismiss AND manual dismiss — the WIP
   never-dismissing toast is fixed); error display; body = RepoTree rail | paper main (right rail
   omitted per phase-1 allowance); localStorage persistence (expanded repos, rail collapsed);
   last-docs-hash memory when tab-switching. Merged-tree `DocView`/`InboxPage` signatures kept
   verbatim (phase 2 untouched: DocView/InboxPage/DocEditor/AskMeBlock/BacklinksPanel unedited).
2. **`src/components/TabBar.tsx`** (new) — typed `DeckTab[]`, role=tablist/tab, aria-selected,
   active class, onSelect.
3. **`src/voyage/VoyagePage.tsx` + `ProgressBar.tsx` + `DifficultyBadge.tsx` + `StageSection.tsx`**
   (new, presentational pieces reusable by the Bridge ledger) — fetch + SSE (`event: voyage`) with
   feature-detected 5 s poll fallback (`typeof EventSource === 'undefined'` ⇒ poll-only, which is
   what jsdom tests exercise; SSE error also arms the poll); sections In flight / Pending / Done /
   Parked via the dispatch's deterministic status mapping; per-item progress bar, [S]/[M]/[L]/[XL]/
   [?] badge, "~Nh left", note, updated_at; overall difficulty-weighted bar (S=1 M=2 L=3 XL=5,
   null=M, weighted mean — formula duplicated locally per dispatch; daemon owns canonical).
4. **`src/components/RepoTree.tsx`** salvaged from f34c297 with §3.1 fixes: register footer +
   `onOpenRegister` prop removed (parked feature); paddingLeft/marginLeft indent inconsistency
   fixed (single `indentOf()` paddingLeft scale); tree ARIA added (role=tree/treeitem/group,
   aria-expanded/aria-selected); per-repo hover "❯" claude button kept; badges split into red
   `.badge-alert` (brokenLinkCount) + new amber `.badge-needs` (needsYouCount).
5. **`src/api/client.ts`** — fragment salvage only: `docKeyOf`; `RepoSummary` + `docCount`/
   `brokenLinkCount`/`needsYouCount`; `openClaudeSession` POST with `x-ship-deck: 1` CSRF header;
   new `fetchHullStations()`, `fetchVoyage()` + `HullStation`/`VoyageItem`/`VoyageResponse` types
   (duplicated locally per file convention). Merged stricter `DocDetail.id/key` typing kept.
   Parked fragments (fetchActivity/fetchSearch/fetchFsList/registerRepoRequest) NOT brought over.
6. **`index.html` + `src/styles/base.css`** — brass/dark design system salvaged; **Google Fonts
   `<link>` (and preconnects) removed — local font stacks only**; inline SVG favicon + theme-color
   kept; title now "The Ship — Captain's Deck". Extended in the same visual grammar with tab-bar,
   voyage, toast-brass/dismiss, chip spinner, amber badge, and a compatibility layer for
   merged-tree components the WIP css never styled (DocView header/edit toggle, DocEditor toolbar,
   InboxPage list, link-picker modal, question widgets) so phase-1 renders don't regress visually.

## Tests added (28)

- `test/TabBar.test.tsx` (4): render, active state (class + aria-selected), onSelect ids,
  standalone single-tab mode.
- `test/RepoTree.test.tsx` (9): ARIA tree semantics, toggle, select emits docKey (id and path key),
  active row, red/amber badges, claude button callback + busy, indent regression, no-register-
  footer guard, collapsed rail.
- `test/voyage/VoyagePage.test.tsx` (7): sectionOf mapping against real progress.json statuses;
  missionProgress weighting (fixture: S@100 + XL@60 + null@0 ⇒ 50%); section grouping render;
  bar widths + aria-valuenow (overall 50, item 60); 5 s poll applies fresh data + stale chip;
  first-fetch error state then poll recovery.
- `test/App.test.tsx` (8): standalone Docs-only; hull mode appends Voyage + tab click routes;
  hull-without-voyage stays Docs-only; `#/voyage` deep link (not hijacked by auto-select);
  auto-select-first-repo; chip disabled + tooltip with no repo; busy state during in-flight POST;
  success toast 4 s auto-dismiss (fake timers); error toast manual dismiss. Client module mocked.

## Deviations / notes for the FO

- No 10 s dashboard polling (WIP had it for the parked activity feed): repos/inbox counts refresh
  on mount and after every save via `handleSaved`. Deliberate simplification; trivial to add later.
- Voyage tab renders full-body (no RepoTree rail) — the rail is repo/doc-scoped chrome and the
  dispatch allowed omitting the third region.
- Chrome inbox entry: small `inbox` chip (with open count) in the top chrome replaces the merged
  shell's nav button so `#/inbox` stays reachable without the parked NeedsYouPanel.
- CSS font stacks still *name* IBM Plex first (pure local lookup, zero network); the remote fetch
  is what was removed. Swap the names out too if the Captain wants byte-identical rendering
  everywhere.
- `Sidebar.tsx`/`RepoSwitcher.tsx` are no longer imported but NOT deleted/edited; their tests stay
  green. REMOVALS.md is FO-owned tracking — please log the supersession there on merge.
- `VoyageItem.id` used as React key — contract says unique per item.

## Commits on `scratch/deck-ui` (cherry-pick ready, chartroom-ui only)

1. `feat(chartroom-ui): brass Deck design system, local-fonts index.html, deck client endpoints`
2. `feat(chartroom-ui): Deck shell -- TabBar, voyage view, RepoTree, re-authored App chrome`
3. `test(chartroom-ui): TabBar, RepoTree, VoyagePage, and App shell suites`
4. (this report)
