---
id: plan-14-settings-add-modal-captain-s-order-post-mission-combined-mode
---

# Plan 14 — Settings add-modal (Captain's order, post-mission) — COMBINED mode

Team Lead, 2026-07-06. Branch `ship-wave1-settings-modal` off `ship-wave1` @ a8e8617.
Order: interactive ADD flow for settings — modal with search + multiselect, per-type value
inputs, scope picker, ONE batched write per target through the EXISTING package-7 rails.
Clean minimal version; detailed correctMe specs come later — no speculative extras.

## Scope

**Backend (`packages/settings-manager`):**
- `src/catalog.ts` (new): the searchable catalog. `SETTINGS_CATALOG: CatalogEntry[]` derived
  from the same docs table `schema.ts` was typed from (fetched 2026-07-06): `{key, kind,
  description, enumValues?, defaultValue}` for every addable known top-level key (excludes
  `$schema` and `permissions` — the object; the permissions surface is covered by rule
  templates below, plus one `permissions.defaultMode` enum entry since it is the one nested
  key with a closed documented value set). `RULE_TEMPLATES: RuleTemplate[]`: `{id, label,
  rule (editable pattern prefill), defaultList: allow|deny|ask, description}` — bash-prefix,
  bash-exact, read-path, edit-path, webfetch-domain, mcp-server, mcp-tool, bare-tool.
  A test asserts every catalog key exists in `KNOWN_TOP_LEVEL` with the same kind (catalog
  can never drift from the validator).
- `src/editor.ts`: `computeAddSettings(currentText|undefined, additions)` (pure, sibling of
  `computeAdditiveRules`): additions = `{values?: Record<string,unknown>,
  defaultMode?: string, permissions?: {allow?/deny?/ask?}}`. Sets/overwrites exactly the
  requested top-level keys, sets `permissions.defaultMode` when given, appends missing rules
  additively. POST-CHECK mirror of the package-7 invariants: only requested keys differ,
  original rule lists survive as prefixes, `values.permissions` refused. Overwriting an
  existing key is allowed — the diff modal makes it visible; `changedKeys` reports
  added-vs-overwritten so the UI can badge it.
- `src/station.ts`: `GET /api/settings-manager/catalog` → `{settings, ruleTemplates, modes}`;
  `POST /api/settings-manager/add/preview` `{scope, project?, additions}` → same write-target
  guard, `computeAddSettings` → `previewEdit` → `{newContent, preview, changedKeys,
  addedRules}`. Apply stays the EXISTING `/apply` (baseHash ticket, header, backups, atomic,
  typed refusals) — rails untouched.

**Frontend (`packages/chartroom-ui` settings slice, wave-developer):** "Add settings" button
(effective-view header) → `AddSettingsModal`: search box (case-insensitive substring over
key+description+template label, ArrowUp/Down + Enter to toggle, Esc closes), multiselect list
with checkboxes grouped Settings/Permission rules; selected panel with per-kind inputs
(boolean toggle, enum select, string/number, string-list editor, editable rule text +
allow/deny/ask select); scope picker reusing writable-scope rules (project/local need the
page's project); "Preview & apply" → `/add/preview` → the EXISTING DiffModal/useDiffFlow →
`/apply` → effective view + scopes refresh (existing `onChanged` path). Tests per flow.

**Acceptance:** new phase in `acceptance/settings-manager.mjs` driving the modal's exact API
chain against the real spawned hull: catalog → add/preview (2 keys + 1 rule + defaultMode,
one batched newContent) → apply → GET effective shows all additions attributed → second
add/preview overwriting a key shows it in changedKeys/diff. Changelog fragment. Full turbo
gates (workspace floor 1123+ at 8684b1c) + deck-boot green. Rebuild ship dist + UI bundle
last so the running Deck restarts onto it.

## Out of scope (per "no speculative extras")
Fuzzy-ranking beyond substring; editing/removing existing values (the scope editor owns
that); multi-target batching across several files in one confirm (scope picker = one target,
one write); catalog entries for other nested keys; new dependencies (none needed).

## Risks
- Catalog descriptions are doc-derived summaries (same provenance as schema.ts); wrong-shape
  values are still blocked by the existing schema rail at preview/apply.
- Overwrite-vs-add semantics: made explicit via `changedKeys` badges + diff, flagged here
  rather than guessed as refusal (Captain can tighten in correctMe).

## Deviations
(appended if reality forces changes)
