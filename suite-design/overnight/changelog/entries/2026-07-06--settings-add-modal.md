---
id: settings-add-modal-captain-s-order-search-multiselect-add-flow-over-the-rails
date: 2026-07-06
package: 14-settings-add-modal
branch: ship-wave1-settings-modal
---

# Settings add-modal (Captain's order) — search + multiselect add flow over the rails

Interactive ADD flow for the Deck's Settings tab: pick any number of settings and permission
rules from a searchable catalog, fill typed values, land them as ONE batched write per target
file through the package-7 rails unchanged.

- **`packages/settings-manager`**: `src/catalog.ts` — searchable catalog of every addable known
  top-level key (type, description, enum values where the documented set is closed, prefill,
  managed-only flags; a test pins it to the schema validator so it can never drift) + 8
  permission-rule templates (bash prefix/exact, read/edit paths, webfetch domain, mcp
  server/tool, bare tool) + `permissions.defaultMode` as the one nested entry.
  `computeAddSettings` — pure batch computation (set/overwrite keys, set defaultMode, append
  rules additively) with post-checks proving nothing outside the request changed; reports
  added-vs-overwritten keys so overwrites are visible before apply. Routes: `GET /catalog`,
  `POST /add/preview` (same write-target guard + typed refusals). Apply stays the existing
  `/apply` — baseHash ticket, backup, atomic replace, schema rail (which now surfaces its
  structured issues in previews instead of a flattened message).
- **Deck UI (chartroom-ui)**: "Add settings" button → modal with autofocused search
  (substring over keys/descriptions/templates, ArrowUp/Down + Enter, Esc), grouped multiselect,
  per-kind value inputs (toggle / enum select / number / string / list / validated JSON),
  editable rule text + allow/deny/ask select, scope picker, then the EXISTING diff modal →
  apply → effective view refresh.
- Acceptance (phase 6, real spawned hull): catalog → batched add/preview (2 keys + defaultMode
  + 1 rule) → one apply → effective attribution verified → overwrite reported before apply.
