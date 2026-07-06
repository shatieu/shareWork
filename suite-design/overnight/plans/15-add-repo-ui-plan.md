---
id: plan-15-add-repo-ui-deck
---

# Plan 15 — Add repo + repos-overview landing (Deck)

Captain's order: "I am missing add repo to the ship." + scope addition (FO relay, mid-package): the Deck's
default route (`#/`, what `http://127.0.0.1:4317/` lands on) becomes a **tracked-repos overview** — one card
per registered repo (name, path, cheap stats already served by `GET /api/repos`), click-through to that
repo's Docs, with the Add-repo button living on the overview. Branch `ship-wave1-add-repo` off `ship-wave1`
(fd9da1e). Combined plan+implement per wrap-up process.

## Decision: minimal validated-path version ships; the fs.ts folder browser does NOT
The quarantined `routes/fs.ts` (f34c297) exposes unauthenticated full-filesystem enumeration; the FO rail
says it may only ship hardened (CSRF + Host allowlist + rooted enumeration). That is new backend attack
surface out of proportion to the order. The minimal version needs **zero backend change**: `POST
/api/repos/register` (v1.1, live-registration proven) already does CSRF (`x-ship-deck`), server-side git-root
discovery via `findGitRoot(resolvePath(path))`, readable 400 on non-repo paths, 501 without a registrar, and
`alreadyRegistered` dedup. The modal shell (overlay, Esc, done-state, "register another") is salvaged from
the quarantined `RegisterRepoModal.tsx`; the fs-browsing body is replaced by a validated path input.
The `.register-modal` CSS already exists on `ship-wave1` in `base.css` — reused.

## Files
- `packages/chartroom-ui/src/api/client.ts` — add `RegisterRepoResult` + `registerRepoRequest(path)`:
  POST `/api/repos/register`, `Content-Type` + `x-ship-deck` headers, parse `{error}` body into a readable Error.
- `packages/chartroom-ui/src/components/AddRepoModal.tsx` — NEW (salvaged shell): labeled path input,
  Enter/button submit (disabled when blank), spinner while registering, `role=alert` error, success pane with
  "Done" / "add another…", Esc + overlay-click + ✕ close.
- `packages/chartroom-ui/src/components/RepoTree.tsx` — `onAddRepo` prop; `+ add` button in the panel head.
- `packages/chartroom-ui/src/App.tsx` — modal open state; `Add repo…` button in the no-repos empty state
  (CLI hint retained); on success: refresh dashboards, expand + navigate to the new repo, brass toast.
- `packages/chartroom-ui/src/styles/base.css` — `.register-modal__input`, `.repo-tree__add`, empty-state button, `.repo-overview` card grid. Additive only.

## Repos-overview landing (scope addition)
- Stats source: `GET /api/repos` already returns `docCount`, `brokenLinkCount`, `needsYouCount` per repo —
  those are the overview's stats. **No last-activity field exists anywhere shipped** (the quarantine's
  `daemon/activity.ts` never landed); per the "no new heavy stats" rail the overview ships without it.
- `packages/chartroom-ui/src/components/RepoOverview.tsx` — NEW: "Tracked repos" header + Add-repo button,
  card grid (brass avatar, name, path, doc count, broken-links / needs-you badges, per-card open-Claude),
  card click → `#/repo/:id`.
- `packages/chartroom-ui/src/App.tsx` — the auto-select-first-repo effect is REMOVED: the bare `#/` route now
  renders `RepoOverview` as the Docs-tab center pane (tree rail stays). Docs-tab fallback (no remembered doc
  hash) goes to `#/` (overview) instead of repos[0]. Root breadcrumb reads `repos`. The no-repos empty state
  keeps the CLI hint and gains the Add-repo CTA (it is the overview's zero state).
- Tests: `RepoOverview.test.tsx` (cards render real summaries, click-through, add button); App tests updated —
  root renders overview instead of auto-selecting repos[0].
- Acceptance addendum: the spawned-hull script asserts `/` serves the Deck shell and `GET /api/repos` carries
  the overview's card data for both repos after live registration (the overview is a pure client render of
  exactly that payload).

## Tests (component + route)
- NEW `test/AddRepoModal.test.tsx`: submit calls API with trimmed path; success pane + onRegistered;
  400 error surfaced via role=alert and recoverable; blank input disabled; Esc closes; add-another resets.
- NEW `test/api/registerRepo.test.ts`: fetch-level contract — method/headers/body; `{error}` body becomes the Error message.
- `test/RepoTree.test.tsx` + `test/App.test.tsx`: add-button wiring; empty state opens modal; registered repo appears after refresh.
- Route side unchanged — existing `packages/chartroom` register-route tests stand as the route bar.

## Acceptance
NEW `packages/ship/acceptance/add-repo-ui.mjs` (deck-boot pattern): spawn the REAL `ship` CLI over a scratch
home with one pre-registered repo; replay the modal's exact fetch (headers + body) to register a second
scratch git repo; assert it appears in `GET /api/repos` and serves its doc immediately; assert the modal's
error path (non-repo path → 400 `{error}`) and the CSRF 403 without the header. Wire into `test:acceptance`.

## Gates / verification
turbo build+lint+test green; workspace test floor ≥1151 (at e468077) holds and rises; `deck-boot.mjs` still
green; rebuild `chartroom-ui` bundle + `ship` dist at the end so the FO can restart the live Deck onto it;
changelog fragment `suite-design/overnight/changelog/2026-07-06--add-repo-ui.md`.

## Out of scope / risks
- Folder browsing (fs.ts) stays parked on quarantine — revisit only as a hardened package if the Captain asks.
- No Captain-only decisions identified; if the input-not-browser UX disappoints, that is a follow-up order, not a guess.
