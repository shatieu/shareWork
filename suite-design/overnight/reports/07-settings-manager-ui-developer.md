---
id: package-07-settings-manager-deck-ui-slice-developer-report
---

# Package 07 — Settings Manager — Deck UI slice (Developer report)

Developer, 2026-07-06. Branch `ship-wave1-settings`. Scope: `packages/chartroom-ui` ONLY
(plan 07 §3, chartroom-ui bullet; Trio_Specs §B). Team Lead owns everything else.

## Commits

- `ffc5e59` feat(deck-ui): Settings tab — simulator, effective view, railed editor, packs,
  always-allowed, backups (13 files, +2353)
- `478be5f` test(deck-ui): settings tab suites (3 files, 20 tests)

Both committed with path-scoped adds (`packages/chartroom-ui/src`, `.../test`). No merges,
no pushes, nothing deleted, no new dependencies.

## Files

New `src/settings/`:
- `SettingsPage.tsx` — page shell: project picker (localStorage `chartroom.settings.project`,
  bootstrap: unscoped /scopes → restore persisted selection if still registered, else first
  project), section order simulator → effective → editor → packs → always-allowed → backups,
  ONE shared diff-flow whose modal renders at page root.
- `Simulator.tsx` — centerpiece. Tool picker (Bash/PowerShell/Read/Edit/Write/WebFetch/
  free-text), context-appropriate arg field (command/path/url/raw JSON input), verdict card:
  big colored behavior (deny=rust, allow=green, ask=amber/brass, default=neutral with mode),
  deciding rule + scope badge + source file (full path in title attr), explanation line,
  compound supportingRules, collapsible caveats + unevaluated lists (always present, never
  hidden), notes.
- `EffectiveView.tsx` — deny/ask/allow groups in evaluation order with scope badges + source
  files, additionalDirectories when nonempty, defaultMode with source + shadowed values,
  other-keys table (key, winning JSON, scope, shadowed count), excluded-scope alert,
  per-scope file list with exists/writable/error/validation chips.
- `ScopeEditor.tsx` — writable-scope picker (project/local disabled without a project),
  loads via GET /file into a monospace textarea; the ONLY exit is "Preview diff". No direct
  save path exists in the component (spec rail).
- `DiffModal.tsx` — the one write gate: +/- colored ops, blocking validation errors (Apply
  disabled), advisory warnings, unchanged short-circuit, malformed-target recovery checkbox
  ("Overwrite the malformed target file … a timestamped backup … is still taken first"),
  base-drift error + "Reload & re-preview" button.
- `useDiffFlow.tsx` — shared preview→apply rail: `openEdit` (server preview then modal) and
  `openWithPreview` (templates/revoke previews from their own endpoints); apply always sends
  the preview's `baseHash`; SettingsApiError codes map to modal recoveries.
- `TemplatePacks.tsx` — card per pack (name, version, description, allow/deny/ask counts),
  per-pack scope select, "Apply to <scope>" → /templates/preview → same modal → /apply with
  preview.baseHash + response.newContent.
- `AlwaysAllowed.tsx` — entries with rule, project/cwd, "written by ship-inbox on <date>";
  one-click Revoke → /revoke/preview → modal → /apply (scope local, project = entry.cwd).
  `available:false` → "Inbox station not mounted" empty state.
- `BackupsSection.tsx` — list (createdAt, targetPath, bytes), view content; Restore maps
  entry.targetPath onto a writable scope via the /scopes paths (normalized, case/separator
  insensitive) and runs the backup bytes through the SAME preview/apply rail; unresolvable →
  read-only view with an explicit note, no write-target guessing.
- `ScopeBadge.tsx` — scope chip + SourceFile (basename shown, abs path in title).

Touched:
- `src/api/client.ts` — appended settings-manager section only: 12 typed fetch helpers
  (scopes/effective/simulate/file/preview/apply/backups/backup/templates/templates-preview/
  always-allowed/revoke-preview), `SettingsApiError {status, code}` parsed from the station's
  `{error, code}` bodies, `postSettings` carries `x-ship-deck: 1` (required on /apply,
  harmless on read-only POSTs).
- `src/App.tsx` — `#/settings` route exactly like `#/voyage`: SETTINGS_ROUTE const, parseHash
  case, handleSelectTab case, breadcrumb, body render. Tab itself comes from
  /api/hull/stations — nothing hardcoded; auto-select-first-repo cannot hijack the deep link
  (pre-existing `tab === 'docs'` guard).
- `src/styles/base.css` — appended `.settings*`/`.scope-badge*`/`.diff-line*` block reusing
  the existing brass variables; reuses `.btn-brass`, `.modal__close`, `.ship-inbox__btn`,
  `.app-shell__error`.

New `test/settings/`: `SettingsPage.test.tsx` (14), `AppSettingsRoute.test.tsx` (3),
`client.test.ts` (3).

## Test evidence (all run 2026-07-06, in packages/chartroom-ui)

- `npx vitest run` → **Test Files 24 passed (24), Tests 200 passed (200)** — floor was 180,
  +20 new, zero existing tests touched or broken.
- `npx eslint .` → clean (exit 0, no output).
- `pnpm --filter chartroom-ui build` → tsc --noEmit + vite build green
  (`dist/assets/index-CIwEk3iC.js 808.62 kB`; chunk-size warning pre-existing).

Dispatch-required tests, all present and passing:
1. simulator deny verdict with deciding rule + file (+ WebFetch arg-switch case);
2. effective view grouping with scope badges (+ defaultMode/shadowed/scope-file chips);
3. editor: no Apply button anywhere pre-preview; apply carries the preview baseHash
   (component level) and the `x-ship-deck` header + baseHash body (fetch level);
4. 409 base-drift → alert + "Reload & re-preview" → re-preview → apply with fresh hash;
5. template preview→apply flow (pack card, scope, newContent + preview.baseHash);
6. revoke flow (origin+date label, /revoke/preview, apply scope local/project=cwd);
7. App routes `#/settings` when the hull lists the tab; deep link not hijacked; tab absent
   without the station.
Extra: schema-violation blocks Apply; malformed-target recovery checkbox sends
`overwriteMalformedBase:true`; backups restore-through-modal + unresolvable read-only
fallback; project-picker persistence.

## Deviations

None from the dispatch. Notes:
- Deck header is attached to all settings POSTs (simulate/preview too), not just /apply —
  station only requires it on /apply; harmless and future-proof.
- Simulate POST body sends `command`/`path`/`url` only when nonempty (station zod accepts
  optional), raw JSON input is validated client-side before send (object required).
- Backup→scope mapping uses the /scopes paths for the CURRENT project selection (as the
  dispatch specifies); a backup from a different registered project shows read-only with a
  note telling the human to switch projects.
