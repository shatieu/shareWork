---
id: chapel-tab-fe-shipwright-evidence-2026-07-09-branch-ship-wave1
---

# chapel-tab — FE shipwright evidence (2026-07-09, branch ship-wave1)

Scope: packages/chartroom-ui only, per `.claude/plans/deck-chapel-tab.md` FE section and
`.ship-crew/exchange/chapel-tab/findings.md` pointers. No commits (dispatch forbade git acts).

## What was built

### src/api/client.ts — chapel client block (after fetchVoyage)
- `ChapelApiError` (Error + `status`) so the UI branches on the session route's 501 without
  string-matching; every chapel call throws it with the server's `{error}` body parsed through
  the existing `setupErrorFrom` reader (comment widened to name chapel).
- `fetchChapelBrief()` → GET /api/chapel/brief (`{brief, updatedAt}`, nulls are 200s)
- `fetchChapelProjects()` → GET /api/chapel/projects (`{projects: [{id, updatedAt}]}`)
- `fetchChapelProject(id)` → GET /api/chapel/projects/:id (id URL-encoded)
- `chapelConfess(text, project?)` → POST /api/chapel/confess (`project` key omitted when unset)
- `chapelOpenSession()` → POST /api/chapel/session (no body)
- `DECK_CLIENT_HEADER` (`x-ship-deck: 1`) rides EVERY chapel call, GETs included (setup-wizard
  route-family convention, plan §API contract).

### src/chapel/ChapelPage.tsx + src/chapel/chapel.css
- Brief pane: bare `ReactMarkdown` + `remarkGfm` (CompareQuestion precedent — NOT DocView's
  directive pipeline). No brief yet → friendly "The Chaplain has not kept his brief yet." pane;
  the confession box keeps working (tested).
- Dossiers: list (id + updatedAt) → click fetches the dossier → same markdown renderer with a
  "← all dossiers" back button; fetch failure shows the `{error}` message without leaving the list.
- Confession box: textarea + optional project `<select>` fed by /api/chapel/projects + Confess
  button (disabled on empty/whitespace, trims before send); 201 → success toast + textarea
  cleared; failure → error toast with the server `{error}` message, text kept for retry.
- Open Chaplain session button: disabled while pending ("session opening…"); 501 → the returned
  message shown (role=alert) and the button stays disabled (contract absent won't self-heal);
  other failures → error toast, button re-enabled.
- Toasts reuse the existing `.toast-brass` / `.toast-rust` classes; chapel.css is BEM-ish on
  base.css tokens (brass panel grammar, voyage-view proportions), imported by ChapelPage per the
  setup.css precedent.

### src/App.tsx — CHAPEL_TAB wired exactly like VOYAGE_TAB (findings :39/:56/:72/:152-175/:195-196/:141-148/:510-511)
- `CHAPEL_TAB` const, `CHAPEL_ROUTE = '#/chapel'`, `'chapel'` in the DeckRoute tab union +
  `parseHash`.
- Tab-discovery effect: after the station list lands, voyage + chapel probes run in
  `Promise.all`; each resolving appends its tab (chapel probe = `fetchChapelBrief()` resolves —
  its routes are always registered under a hull, so 200-with-null still shows the tab).
- `handleSelectTab`: chapel branch sets the hash; the docs-restore guard literals now exclude
  `CHAPEL_ROUTE` alongside `VOYAGE_ROUTE`/`INBOX_ROUTE`. `lastDocsHashRef` exclusion is
  structural (`route.tab === 'docs'` guard — 'chapel' never matches).
- Breadcrumb `chapel` crumb + `<ChapelPage />` render branch.

## Tests added / extended (existing vitest+RTL setup only, no new frameworks)
- test/api/chapelClient.test.ts (10): header on every call incl. GETs, exact URLs/bodies,
  project-key omission, id encoding, `{error}` parsing, 501 → ChapelApiError{status,message},
  empty-body fallback message.
- test/chapel/ChapelPage.test.tsx (12): markdown brief (gfm table proof), empty-brief pane with
  working confession, brief error, dossier list→viewer→back, dossier 404, empty dossiers,
  confess success/disabled/error-retry, session pending/501-disable/500-re-enable.
- test/App.test.tsx (+4, now 18): chapel tab discovery (null-brief 200), no tab when probe
  rejects, voyage+chapel both appended, #/chapel deep link not hijacked.

## Gates (all run from repo root)
- `pnpm --filter chartroom-ui build` → tsc --noEmit + vite build ✅ (pre-existing >500 kB chunk
  warning only)
- `pnpm --filter chartroom-ui lint` → eslint clean ✅
- `pnpm --filter chartroom-ui test` → 35 files, 293 tests, all pass ✅
  (targeted re-run: chapelClient 10 + ChapelPage 12 + App 18 = 40 pass)

## Deviations
- None from the plan's FE section. Judgment calls within scope: `ChapelApiError` added for the
  501 branch (plan requires showing the 501 message; status-carrying error is the non-string-
  match way); session button stays disabled after a 501 (plan: "disabled state on 501 with the
  message shown") while also disabling during pending per the dispatch wording — both readings
  satisfied.
