---
id: plan-deck-onboarding-wizard-folder-picker
---

# Plan — Deck onboarding wizard + folder picker

Captain directives (2026-07-09): repo setup must be doable from the Deck UI —
a flow/wizard, folder selection instead of typing absolute paths, and the
wizard must be reachable for ALREADY-registered repos, not only at add time.
Captain approved adding the `scheduler` workspace package as a chartroom
dependency (library import of `initConfig`; scheduler is not a station, so
station isolation holds).

Decision note: this revives the quarantined `GET /api/fs/list` directory
browser (parked on wip-quarantine-2026-07-05 as a security rail, logged in
suite-design/overnight/DECISIONS-NEEDED.md). The Captain's folder-picker
directive is the Captain-level approval that parking asked for. Posture
unchanged: 127.0.0.1 bind + host allowlist + x-ship-deck header; hardening
kept: directories only, dot-dirs and node_modules skipped, roots view.

## API contract (chartroom station routes, all CSRF-guarded via DECK_CLIENT_HEADER)

1. `GET /api/fs/list?path=<abs>` → `{ path, parent, entries: [{ name, path,
   isGitRepo }] }`. Empty/absent path → roots (win32: drive letters; else
   home + `/`). Directories only. 404 unreadable path, 403 missing header.
2. `GET /api/repos/:id/setup` → audit, no mutation:
   `{ repoId, items: [{ id, label, state: 'present'|'missing'|'partial',
   kind: 'auto'|'human', detail, command? }] }`
   Items (the canonical checklist, one list):
   auto: chartroom-init (frontmatter ids + .docs/index.json + pre-commit
   hook), chartroom-skill, agent-hook (incl. settings merge), chartroomignore
   (template if absent), claude-md-section (marker-guarded append),
   gitignore-entries (`.ship/`, `.docs/`, `.ship-crew/`), ship-scrutiny
   (mergeSettingsJson pattern, default `standard`), lookout-init
   (scheduler `initConfig` — approved dep).
   human (command string included): plugin-marketplace-add, plugin-install
   (ship-crew --scope project), mcp-ship-ledger, mcp-ship-log (commands per
   plugins/crew/README.md).
3. `POST /api/repos/:id/setup` body `{ apply: [itemIds] }` → applies the
   selected AUTO items idempotently (each composes an existing implementation:
   runInit, installSkill, installAgentHook, mergeSettingsJson-style writes,
   initConfig). Returns `{ results: [{ id, ok, detail }] }`. Human item ids in
   `apply` → 400.
4. `POST /api/repos/:id/setup/run` body `{ itemId }` → spawns a detached
   terminal running that HUMAN item's server-generated command (clone the
   claude-session.ts spawn shape + env hygiene + SpawnLike seam). Never runs
   client-supplied strings.

New module `packages/chartroom/src/setup/repo-setup.ts`: `auditRepoSetup
(repoRoot)` + `applyRepoSetup(repoRoot, itemIds)` — route handlers stay thin;
register in register-routes.ts with injectable seams for tests.

## FE (packages/chartroom-ui)

- FolderPickerModal: breadcrumb + directory list from `/api/fs/list`,
  isGitRepo badge, select button; opened from a Browse button in
  AddRepoModal (path input stays as the power-user path).
- SetupWizard (follow useDiffFlow/DiffModal preview→apply precedent,
  base.css tokens): phase 1 audit checklist (auto items pre-checked when
  missing/partial; present items shown green, unchecked); phase 2 apply with
  per-item results; phase 3 human steps with copy + "run in terminal"
  buttons and a Re-audit button.
- Entry points: (a) success pane of AddRepoModal → "Set up this repo" opens
  the wizard; (b) every repo card in RepoOverview gets a Set up action —
  already-registered repos are first-class.
- client.ts: fsListRequest, repoSetupAudit, repoSetupApply, repoSetupRun,
  DECK_CLIENT_HEADER on mutating calls, existing error convention.

## Verification

- chartroom vitest route tests (scratch repo via mkdtempSync, fake seams,
  403/404 negatives, apply idempotency — second apply is a no-op).
- ship acceptance: new `acceptance/setup-wizard.mjs` replaying the wizard's
  fetch sequence against a spawned hull (pattern: add-repo-ui.mjs), chained
  in `test:acceptance`.
- Bundle: `pnpm --filter chartroom-ui build` → `pnpm --filter ship build` →
  `pnpm --filter ship build:ui-bundle`; manual smoke on the running Deck.

## Build split (parallel, non-overlapping)

- Shipwright BE: packages/chartroom (setup module, 3 routes + fs-browse,
  register-routes wiring, station.ts, package.json scheduler dep, tests)
  + ship acceptance script.
- Shipwright FE: packages/chartroom-ui only (components, client, css).
- Integrator/inspector: bundle rebuild, suites, acceptance, live Deck smoke.
