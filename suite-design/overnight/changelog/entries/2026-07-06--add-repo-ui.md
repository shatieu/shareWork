---
id: add-repo-repos-overview-landing-captain-s-order
date: 2026-07-06
package: 15-add-repo-ui
branch: ship-wave1-add-repo
---

# Add repo + repos-overview landing (Captain's order)

The Deck can finally take a repo aboard without a terminal, and landing on the Deck now shows
the fleet of tracked repos instead of jumping into the first one.

- **Add-repo modal**: `+ add` in the Local-repos rail, on the overview, and in the no-repos
  empty state. A validated path input over the existing `POST /api/repos/register` (v1.1 live
  registration) — the daemon resolves the git root itself (any folder inside a repo works),
  rejects non-repo paths with the readable error shown in the modal, dedups already-registered
  repos, and serves + watches the new repo immediately, no restart. On success the shell
  refreshes, expands, and navigates to the new repo.
- **Security rail honored**: the quarantined `/api/fs/list` folder browser stays parked — no
  filesystem enumeration endpoint ships; the modal is a pure client of the CSRF-guarded
  register route (`x-ship-deck`).
- **Tracked-repos overview**: the bare `#/` route renders one card per registered repo (name,
  path, doc count, broken-link / needs-you badges, per-card Claude-session button) straight
  from `GET /api/repos` — no new stats endpoints. Card click lands in that repo's Docs. The
  old auto-select-first-repo jump is gone; Docs-tab fallback goes to the overview.
- 14 new UI tests (modal, overview, shell wiring, fetch contract); new `add-repo-ui.mjs`
  acceptance replaying the modal's exact fetches against a real spawned hull (register via
  nested path, live doc serve, 400 readable error, 403 CSRF).
