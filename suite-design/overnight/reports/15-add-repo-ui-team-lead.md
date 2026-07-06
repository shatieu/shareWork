---
id: package-15-add-repo-repos-overview-landing-team-lead-report
---

# Package 15 — Add repo + repos-overview landing — Team Lead report

Branch `ship-wave1-add-repo` off `ship-wave1` (fd9da1e), 5 commits (96ca97c..eb5fa0f), MAIN worktree.
Combined plan+implement per wrap-up order; scope amended mid-flight by FO relay (Captain): the Deck's
default route becomes a tracked-repos overview carrying the Add-repo button. Plan:
`suite-design/overnight/plans/15-add-repo-ui-plan.md` (amended in place, deviation-free otherwise).

## Which version shipped (my call, per dispatch)
**The minimal validated-path version.** The quarantined `routes/fs.ts` folder browser did NOT ship, in any
form — the FO security rail makes it shippable only with substantial new hardened backend surface
(unauthenticated full-filesystem enumeration otherwise), which is out of proportion to the order. The
minimal version needs **zero backend change**: `POST /api/repos/register` (v1.1) already carries the
`x-ship-deck` CSRF guard, resolves the git root server-side (`findGitRoot`), 400s non-repo paths with a
readable `{error}`, and dedups via `alreadyRegistered`. Salvaged from quarantine f34c297: the modal SHELL
only (overlay/Esc/done-pane/add-another structure of `RegisterRepoModal.tsx`, rewritten around a path
input); the `.register-modal` CSS was already on `ship-wave1`. No `git checkout` of quarantine files was
needed — shell re-typed, fs parts left behind.

## What was built
- `chartroom-ui/src/api/client.ts`: `registerRepoRequest()` — POST with CSRF header, readable error parse.
- `chartroom-ui/src/components/AddRepoModal.tsx`: path input → register → success pane / role=alert error.
- `chartroom-ui/src/components/RepoOverview.tsx`: card grid at bare `#/` — name, path, docCount,
  broken-links/needs-you badges, per-card Claude button, `+ add repo`. Pure render of `GET /api/repos`.
- `App.tsx`: auto-select-first-repo REMOVED (root = overview; docs-tab fallback → `#/`; crumb `repos`);
  add-repo entry points: tree head `+ add`, overview button, no-repos empty-state CTA (CLI hint kept).
  On success: refresh + expand + navigate + toast.
- `base.css`: additive styles (`.repo-tree__add`, `.register-modal__input/__label`, `.repo-overview*`, `.repo-card*`).
- `ship/acceptance/add-repo-ui.mjs` (+ wired into `test:acceptance`): spawns the REAL `ship` CLI over a
  scratch home, replays the modal's exact fetches.

## Evidence (all run this session, exit codes checked)
- `pnpm turbo build lint test`: **45/45 tasks green**. Forced full test re-run: **1169 tests passing
  workspace-wide** (floor 1151 at e468077 holds; +14 from this package: AddRepoModal 7, RepoOverview 4,
  registerRepo contract 3; App suite reworked 9→14, RepoTree 9).
- Acceptance `add-repo-ui.mjs`: **14/14 ok, exit 0** — boot repo in `/api/repos` with card stats; `GET /`
  serves Deck; modal-exact POST with a NESTED path resolves to git root, `alreadyRegistered:false`; repo
  appears in `/api/repos` (2 entries, docCount 1) and serves `beta-doc` immediately (no restart);
  re-register → `alreadyRegistered:true`; non-repo path → 400 `{error: "not a git repository (or any
  parent…)"}` and nothing registered; POST without `x-ship-deck` → **403**. One teardown fix: wait for
  child exit before scratch rmSync (Windows EPERM race), cleanup failure never fails the run.
- `deck-boot.mjs`: still green, exit 0.
- Dist rebuilt for FO restart: `chartroom-ui/dist` (vite), `ship/dist` + `ship/dist/public` (copy-ui-dist),
  `chartroom/dist/public`. The RUNNING Deck at 127.0.0.1:4317 still serves the old bundle until the FO
  restarts it — restart is the FO's act, not done here.

## Not proven / notes
- **No real-browser click-through**: the flow is proven at component level (jsdom, modal's exact fetches)
  and at HTTP level (spawned hull, byte-identical requests) — but no human/browser drove the live Deck UI.
  One manual glance after the FO restart is cheap insurance.
- **No "last activity" stat on the cards**: nothing shipped serves it (`GET /api/repos` has
  docCount/brokenLinkCount/needsYouCount only; the quarantine's `activity.ts` never landed). Per the
  "no new heavy stats" rail I did not build it. Flag to Captain only if he expected it.
- FO tracking edits to `progress.json`/`PROGRESS.md` were present in the shared worktree — left
  uncommitted (they ride to the next merge boundary). `team-tasks/` untouched. Nothing removed
  (REMOVALS.md untouched; scratch tmp dirs of acceptance scripts are the scripts' own, per precedent).
- Changelog fragment: `suite-design/overnight/changelog/entries/2026-07-06--add-repo-ui.md`.
