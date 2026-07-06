---
id: settings-manager-trio-specs-b-simulator-editor-rails-template-packs
date: 2026-07-06
package: 07-settings-manager
branch: ship-wave1-settings
---

# Settings manager (Trio_Specs §B) — simulator, editor rails, template packs

Visual manager for Claude Code settings + permissions across scopes, pulled forward per the
cross-trio build order. New Deck **Settings** tab + standalone read-only CLI.

- **`packages/settings-manager`** (new): scope loader (managed/local/project/user, documented
  per-OS managed paths, malformed scopes excluded + surfaced, never coerced); effective-settings
  merge with per-rule/per-key **source attribution** (permission arrays merge across scopes,
  scalars override by precedence — semantics verified against live docs 2026-07-06).
- **Simulator (the centerpiece)**: answers *"would `Bash(rm -rf ./dist)` be allowed right now —
  and which rule in which file decides?"* Deny → ask → allow first-match; Bash glob/word-boundary/
  `:*` rules, compound-command splitting, wrapper stripping, gitignore path anchors (incl. the
  `/`=settings-source subtlety), WebFetch domain wildcards, MCP + param rules. **Provably
  read-only**: no `node:fs` in the evaluation modules (source-scan test) + byte/mtime snapshot
  proof. Unmodeled syntax is returned as `unevaluated`, honest limits as `caveats` — never
  silently skipped.
- **Editor rails (non-negotiable)**: every write flows through one module — validate-before-touch
  (structural schema behind a provider seam; unknown keys warn, wrong shapes block), mandatory
  diff preview whose `baseHash` ticket gates apply (drift = typed 409), malformed target = typed
  refusal byte-identical (explicit backed-up recovery opt-in), timestamped backups under
  `~/.suite/settings-backups/` with origin sidecars, atomic same-dir tmp+rename, JSON round-trip.
  Each rail has dedicated tests.
- **Template packs**: `safe-web-dev`, `read-only-audit`, `ci-headless`, `crew-defaults` —
  additive apply (post-verified: original prefix + only requested rules) through the same rails.
- **Ship integration**: ship-inbox's new `alwaysAllowedRules` contract labels inbox-written
  rules with origin + date; one-click revoke = subtractive edit post-verified to remove exactly
  one rule. Chartroom's new `listRepoDirs` contract gates which project dirs the editor may
  touch (403 otherwise); managed + CLI scopes are never writable.
- **Deck Settings tab** (chartroom-ui): simulator test bench, effective view with scope badges,
  scope editor behind the diff modal, template packs, always-allowed list with revoke, backups.
- Acceptance (`acceptance/settings-manager.mjs`, real spawned `ship serve`, isolated home):
  spec question answered with deciding rule + file, read-only proof, full rails walk (403/409/
  byte-identical refusals, backup + restore), template + revoke round-trips, CLI exit-code 1 on
  deny — all green.
