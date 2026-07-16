---
id: deck-onboarding-wizard-fe-shipwright-evidence
---

# Deck onboarding wizard — FE shipwright evidence

Role: shipwright (frontend) · Plan: `.claude/plans/deck-onboarding-wizard.md` (FE section)
Scope: `packages/chartroom-ui/**` only. Date: 2026-07-09. Branch: ship-wave1 (no commits made — dispatch forbade git commit/checkout/branch).

## Verdict

DONE — all FE plan bullets implemented; build + lint + tests green. No BE dependency: built purely against the plan's API contract with mocked fetch in tests.

## Gates (run locally, full commands)

| Gate | Command | Result |
| --- | --- | --- |
| Build | `pnpm --filter chartroom-ui build` (tsc --noEmit + vite build) | GREEN — `✓ built in 290ms`; only the pre-existing >500 kB chunk-size warning |
| Lint | `pnpm --filter chartroom-ui lint` (eslint .) | GREEN — zero findings |
| Tests | `npx vitest run` | GREEN — 33 files, 267 tests passed (was 30 files / ~250 before; 3 new test files, 2 extended) |

## Files

New:
- `packages/chartroom-ui/src/components/FolderPickerModal.tsx` — breadcrumb (clickable ancestors + "computer" roots crumb), directory list from `GET /api/fs/list`, `isGitRepo` badge (`fs-row__git`), single-click highlight, double-click descend, Select returns highlighted entry's path (else the browsed directory). Loading (`register-modal__loading`) + `role="alert"` error states; error never strands the user (crumbs derive from the *requested* path). Exports pure `crumbsOf()` for tests.
- `packages/chartroom-ui/src/setup/useSetupWizard.tsx` — wizard state rail mirroring `useDiffFlow`'s shape (nullable state object, stable callbacks, `modal` element the host mounts once). Phases audit → apply → human; pre-check = auto ∧ state≠present; re-audit resets and refetches.
- `packages/chartroom-ui/src/setup/SetupWizard.tsx` — presentational modal: phase 1 checklist grouped Auto/Human with state chips (present=green `--ok`, partial=amber brass, missing=red rust), detail lines, human commands in `<code>`; phase 2 per-item ok/fail result rows (failures never hide other rows) + wholesale-error `role="alert"` with "← back to checklist"; phase 3 remaining (non-present) human items with copy + "run in terminal" (`repoSetupRun`) + re-audit loop. Esc/✕/overlay close per modal convention.
- `packages/chartroom-ui/src/setup/setup.css` — per-feature stylesheet (skillanalytics.css precedent), base.css tokens only.
- `packages/chartroom-ui/test/FolderPickerModal.test.tsx` (7 tests), `test/setup/SetupWizard.test.tsx` (6), `test/api/setupClient.test.ts` (7).

Modified:
- `packages/chartroom-ui/src/api/client.ts` — `fsListRequest(path?)`, `repoSetupAudit(repoId)`, `repoSetupApply(repoId, ids)`, `repoSetupRun(repoId, itemId)`; local interfaces `FsEntry`/`FsListResponse`/`RepoSetupItem`/`RepoSetupAuditResponse`/`RepoSetupApplyResponse`/`RepoSetupRunResponse` matching the plan contract verbatim; shared `{error}`-body reader (register convention). `x-ship-deck` header on ALL four calls, GETs included (plan: whole route family CSRF-guarded — fs/list explicitly "403 missing header").
- `packages/chartroom-ui/src/components/AddRepoModal.tsx` — path input kept as power-user path; `browse…` button (btn-brass) opens FolderPickerModal (selection fills the input); success pane gains "Set up this repo" (btn-rust primary; Done demoted to btn-brass) → new required `onSetup(repo)` prop; Esc handler yields to the stacked picker.
- `packages/chartroom-ui/src/components/RepoOverview.tsx` — per-card ⚙ "Set up" action (`repo-card__setup`, left of the claude chip) → `onSetup(repoId)` prop (Captain directive: already-registered repos are first-class).
- `packages/chartroom-ui/src/App.tsx` — `useSetupWizard` mounted next to the AddRepoModal mount; `handleOpenSetup(repoId, name?)` wired to both entry points; AddRepoModal `onSetup` closes the add modal then opens the wizard.
- `packages/chartroom-ui/src/styles/base.css` — `register-modal__pathrow`, `folder-picker__crumb*`, `folder-picker__entries/list`, `fs-row--active`, `repo-card__setup` (reuses the existing quarantine-era `fs-row__*`/`register-modal__*` block).
- `packages/chartroom-ui/test/AddRepoModal.test.tsx`, `test/RepoOverview.test.tsx` — new required props + 4 new cases (setup handoff, browse→select fill, Esc-closes-picker-only, card setup action).

## Plan-bullet trace

1. FolderPickerModal (breadcrumb, /api/fs/list, git badge, Browse in AddRepoModal, path input stays) — done, tested (roots view, descend, ancestor/roots crumb nav, 404 recovery, git badge, select semantics).
2. SetupWizard 3 phases per useDiffFlow/DiffModal precedent, base.css tokens — done, tested (pre-check rule, grouped render, apply ids sent exactly, ok/fail rows, human copy/run, re-audit fresh-data loop, audit-failure retry).
3. Entry points: AddRepoModal success pane + every RepoOverview card — done, tested; both funnel through `handleOpenSetup` in App.tsx.
4. client.ts helpers + DECK_CLIENT_HEADER + `{error}` convention — done; fetch-level contract tests assert URL/method/header/body shapes and error parsing (incl. 400 human-id-in-apply).

## Assumptions / deviations (named)

- **Contract nullability assumption**: `FsListResponse.path`/`parent` typed `string | null` (null on the roots view / at a root) — the plan doesn't state nullability; BE shipwright should confirm. UI handles both.
- **`repoSetupRun` response** typed `{ ok: true }` (contract omits the response shape; mirrors `openClaudeSession`).
- **`x-ship-deck` on GETs** (fs/list, setup audit): the dispatch's conventions note said "mutating calls", but the plan contract explicitly 403s fs/list without the header and marks all four routes CSRF-guarded — plan contract wins. Harmless if the BE ignores it on GETs.
- **Success-pane button order**: "Set up this repo" is now the rust primary; "Done" demoted to brass — a visual-hierarchy call, labels/handlers unchanged.
- Select button semantics: with nothing highlighted it returns the directory being browsed (disabled on the roots view with no pick) — the plan says only "Select button returns the absolute path".
- No commits made (dispatch: do not run git commit); working tree changes only.
