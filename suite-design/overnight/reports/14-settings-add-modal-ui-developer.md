---
id: package-14-settings-add-modal-deck-ui-slice-developer-report
---

# Package 14 — settings add-modal, Deck UI slice — Developer report

Developer, 2026-07-06. Branch `ship-wave1-settings-modal` (shared main worktree, never switched).
Plan: `suite-design/overnight/plans/14-settings-add-modal-plan.md` (Frontend section).

## What was built (packages/chartroom-ui only)

1. **`src/api/client.ts`** (+75 lines, appended into the settings section before `postSettings`):
   - Types mirroring the backend (`catalog.ts` / `editor.ts` shapes, duplicated locally per the
     file's convention): `SettingsCatalogKind`, `SettingsCatalogEntry`, `SettingsRuleTemplate`,
     `SettingsCatalogResponse`, `SettingsAdditions`, `SettingsAddPreviewResponse`.
   - `fetchSettingsCatalog()` → `GET /api/settings-manager/catalog`.
   - `previewSettingsAdd({scope, project?, additions})` → `POST /api/settings-manager/add/preview`
     via the existing `postSettings` (so the `x-ship-deck: 1` header and `SettingsApiError`
     typed-body handling ride along automatically).

2. **`src/settings/AddSettingsModal.tsx`** (new, single file — no extra subcomponents needed):
   - Loads the catalog once on mount; search input autofocused.
   - Case-insensitive substring filter: settings over key + description, templates over label
     (exactly the dispatch spec).
   - One scrollable list, two groups: "Settings" (key, kind chip via `settings-chip`,
     description, `managed-only` warning chip via `settings-chip--err`) and "Permission rules"
     (label + defaultList chip + description). Checkbox multiselect, any number.
   - Keyboard: ArrowUp/ArrowDown move a highlight over the flat filtered list (settings then
     rules), Enter toggles the highlighted item — bound to the search input so Enter inside the
     value textareas still inserts newlines; Esc closes, bound at the modal root (bubbles from
     any focused field).
   - Selected panel below the list with per-kind inputs prefilled from `defaultValue`:
     boolean → checkbox toggle; enumValues → select; number → number input; string → text
     input; string-array → one-item-per-line textarea; object/array/string-or-boolean/any →
     JSON textarea validated client-side (must parse; kind `object` must parse to a plain
     object). Rule selections: editable rule text prefilled from `template.rule` + an
     allow/deny/ask select prefilled from `defaultList`. Field issues render inline and disable
     the submit button.
   - `permissions.defaultMode` routes to `additions.defaultMode`, never `additions.values`;
     rules go to `additions.permissions.<list>`; empty lists/objects are omitted from the
     payload.
   - Scope picker user/project/local; project/local options disabled without a page project
     (same rule + markup as ScopeEditor/TemplatePacks); hint shown when gated.
   - "Preview & apply" → `previewSettingsAdd` → `flow.openWithPreview` (the EXISTING
     DiffModal/useDiffFlow rail, exactly like TemplatePacks) with title
     `Add to <scope> settings (N added[, M overwritten][, K rule(s) appended])` — overwrites
     visible in the diff-modal header. On applied: closes the add modal and fires the page
     refresh. `validation.ok=false` → DiffModal's existing Apply block, nothing extra.
     Preview-step errors surface inside the add modal (role=alert) and it stays open.

3. **`src/settings/SettingsPage.tsx`** (wiring only): `addOpen` state, an "Add settings"
   `btn-brass` button in the page header next to the project picker/schema chip, and the modal
   mounted before `{flow.modal}` (so the DiffModal overlay stacks on top) with
   `project={projectArg} flow={flow} onApplied={refresh}`.

4. **`src/styles/base.css`** (appended, reusing the settings/brass vars): `.add-settings`,
   `__search`, `__list` (scrollable), `__group`, `__row`/`--active`, `__row-label`, `__key`,
   `__desc`, `__selected`, `__item`, `__textarea`, `__bool`, `__hint`, `__issue`, `__footer`.

5. **`test/settings/AddSettingsModal.test.tsx`** (new, 13 tests): client module mocked exactly
   like SettingsPage.test.tsx; a Harness mounts the modal with the REAL `useDiffFlow` so the
   preview → DiffModal → apply chain is exercised end to end. Covers: both groups render with
   kind/managed-only chips; search filters both groups (key, description, label,
   case-insensitive); ArrowDown/ArrowUp + Enter toggle selection (both groups, toggle-off too);
   Esc closes; boolean/enum/number → correct `additions.values` payload; defaultMode routing;
   rule selections → `permissions.deny`/`ask` with edited text; invalid JSON blocks submit with
   a visible issue; scope options gated without a project and `{scope:'local', project}` sent
   with one; full chain sends `newContent` + `baseHash` from the add-preview, fires the refresh
   callback once, closes both dialogs, and the diff-modal header shows
   "1 added, 1 overwritten, 1 rule(s) appended"; preview-step error stays in the modal.

## Evidence (all run in packages/chartroom-ui at 2f52fdc)

- `npx vitest run test/settings/AddSettingsModal.test.tsx` → 13/13 pass.
- `npx vitest run` → **27 files, 223 tests, all pass** (was 210 before this package's slice —
  no existing test touched or broken).
- `npx eslint .` → exit 0, no findings.
- `pnpm --filter chartroom-ui build` → tsc --noEmit + vite build green
  (pre-existing >500 kB chunk-size warning only).

## Commits (path-scoped adds only, `git add packages/chartroom-ui/...`)

- `f5130e1` feat(deck-ui): settings catalog + add/preview client helpers
- `26c0e94` feat(deck-ui): add-settings modal - search, multiselect, per-kind inputs, scope picker
- `353eddf` feat(deck-ui): wire Add settings button + refresh into SettingsPage
- `2f52fdc` test(deck-ui): cover add-settings modal flows

## Deviations / notes

- None from the plan. Two interpretation calls, both minimal-side:
  - `string-or-boolean` kind (not named in the per-kind input list) uses the JSON textarea
    path (parse-only validation), same as `any` — its catalog defaultValue `'disable'`
    prefills as `"disable"`.
  - added/overwritten surfaced in the DiffModal title (dialog aria-label/header), the
    dispatch's "or diff-modal header" option — no extra UI invented.
- Nothing deleted, no new dependencies, no files outside packages/chartroom-ui touched.
  Team Lead's parallel files (settings-manager backend, acceptance) untouched by my adds.
