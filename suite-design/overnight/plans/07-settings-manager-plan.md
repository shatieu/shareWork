---
id: plan-07-settings-manager-trio-specs-b-combined-mode
---

# Plan 07 — Settings Manager (Trio_Specs §B) — COMBINED mode

Team Lead plan, 2026-07-06. Branch `ship-wave1-settings` off `ship-wave1` @ 78a1fbd.
Brief by design (wrap-up order 09:35); implementation follows immediately.

## 1. Scope

New package `packages/settings-manager` (canonical name, Architecture spec §3) mounted as a hull
station + Deck "Settings" tab, in the spec's build order: **simulator → editor with rails →
template packs → inbox integration**.

Out of scope (spec-explicit or parked): enterprise managed-settings authoring; settings sync;
marketplace-repo versioning of template packs (packs ship in-package v1; repo location parked in
DECISIONS-NEEDED); live-generated schema from the installed CC binary (no supported extraction
mechanism — v1 ships a structural validator behind a provider seam; parked in DECISIONS-NEEDED);
CLI-args scope simulation (not readable from files — surfaced as an explicit caveat, never guessed).

## 2. Verified facts (code.claude.com/docs/en/settings + /en/permissions, fetched 2026-07-06)

- Scopes + precedence (highest→lowest): **managed → CLI args → local → project → user**. Windows
  managed path `C:\Program Files\ClaudeCode\managed-settings.json` (ProgramData legacy dead ≥2.1.75).
- **Permission arrays (allow/deny/ask) MERGE across scopes; everything else overrides** by precedence.
- Rule evaluation: **deny → ask → allow, first match wins; specificity never reorders**. No match →
  behavior governed by effective `defaultMode` (default/acceptEdits/plan/auto/dontAsk/bypassPermissions).
- Bash/PowerShell rules: `*` glob at any position, spans spaces; trailing ` *` enforces word
  boundary (prefix + space-or-EOS); `:*` suffix ≡ trailing ` *` (end-of-pattern only); compound
  commands split on `&& || ; | |& &` + newlines, every subcommand must match independently;
  wrapper stripping (`timeout time nice nohup stdbuf`, bare `xargs`). PowerShell case-insensitive
  + alias canonicalization (aliases NOT modeled v1 — caveat emitted).
- Read/Edit rules: gitignore semantics; anchors `//`=fs-root, `~/`=home, `/`=**settings-source
  dir** (scope-dependent!), bare/`./`=cwd; bare filename matches at any depth; Windows paths
  normalized to `/c/...` POSIX form before matching.
- WebFetch `domain:`: case-insensitive; leading `*.` = any-depth subdomain (not apex); elsewhere
  `*` matches within one dot-delimited label only.
- MCP: `mcp__server`, `mcp__server__tool`, `mcp__server__*`. Param rules `Tool(param:value)`
  (deny/ask only; `*` wildcard in value; omitted param never matches). Tool-name globs in
  deny/ask only (`*`, `mcp__*`).

## 3. File-level design

**`packages/settings-manager/`** (scaffold cloned from ship-inbox: tsup-less tsc build, vitest,
eslint, `bin/settings-manager`):
- `src/scopes.ts` — scope discovery/read (user/project/local/managed for this OS). Read-only.
  Malformed file = reported per-scope error, excluded from merge, never coerced.
- `src/schema.ts` — structural validator: known top-level keys type-checked (docs table),
  permissions shape strict, unknown keys ⇒ warnings not errors (CC ignores unknowns). Provider
  seam for the future live-generated schema.
- `src/merge.ts` — effective settings: scalar override by precedence + permission-array merge,
  **per-key/per-rule source attribution** (scope + file path).
- `src/rules.ts` — rule parser + per-tool matchers implementing §2 exactly. Unsupported syntax
  ⇒ rule listed as `unevaluated` in the verdict (never silently non-matching — a skipped deny
  must be visible).
- `src/simulator.ts` — `simulate(scopes, call)` → `{behavior, decidingRule?{rule,scope,file},
  mode?, caveats[], unevaluated[]}`. **Provably read-only**: module imports no write APIs
  (asserted by a source-scan test) + behavioral test (byte/mtime snapshot unchanged).
- `src/diff.ts` — dependency-free LCS line diff → unified-diff text + hunk structure.
- `src/editor.ts` — THE RAILS (generalizes ship-inbox settings-writer, per-requirement tests):
  1. validate-before-touch (JSON parse + schema of BOTH current and next);
  2. malformed current file ⇒ typed refusal (`SettingsEditError`), target byte-identical;
  3. diff preview mandatory: `preview()` returns diff + `baseHash` (sha256 of current bytes);
     `apply()` requires that hash — file drifted ⇒ typed 409 refusal, no write;
  4. timestamped backup to `~/.suite/settings-backups/<stamp>--<sanitized-target>.json` before
     replace (homeDir injectable);
  5. atomic same-dir tmp + rename;
  6. JSON round-trip re-verification before replace. Plus `removeAllowRule()` (revoke): exact
     one-rule-removal post-check, same rails. Restore = apply of a backup's bytes through the
     same preview/apply gate.
- `src/templates.ts` + `templates/*.json` — packs: `safe-web-dev`, `read-only-audit`,
  `ci-headless`, `crew-defaults`. Apply = additive permission merge composed onto preview/apply.
- `src/station.ts` — `createSettingsManagerStation()`: tab `{id:'settings', title:'Settings'}`;
  routes `/api/settings-manager/*`: `scopes`, `effective`, `simulate` (all read-only),
  `file`, `preview`, `apply`, `backups`, `restore`, `templates`, `templates/preview`,
  `always-allowed`, `revoke`. Mutations require `x-ship-deck` header (hull CSRF posture).
  **Write-target guard**: user scope always writable; project/local scopes only for directories
  the chartroom station registers (new contract, below) — no arbitrary-path writes from a browser.
  Managed + CLI scopes are never writable.
- `src/cli.ts` — minimal standalone bin: `effective [--project <dir>]`, `simulate <tool> [spec]`.
- `test/` — per-module suites (see §5).

**Touched elsewhere (small, tested):**
- `packages/chartroom/src/station.ts` — add contract `listRepoDirs(): {id,name,absPath}[]`.
- `packages/ship-inbox` — add contract `alwaysAllowedRules(): {rule, cwd, decidedAt,
  backupPath?}[]` (query over decided rows with `always_allow_rule`) for origin+date labels.
- `packages/ship/src/commands/serve.ts` — mount the station; hull/integration test updates.
- `packages/chartroom-ui` — `src/settings/` page (scope panel, effective view incl. hooks/env
  keys, simulator test-bench, editor with diff-preview modal, templates, always-allow list with
  one-click revoke); `App.tsx` route `#/settings`; `api/client.ts` helpers; tests.
- pnpm-lock/workspace only as needed for the new package (no new external deps).

## 4. FO-named risk → rails mapping

Every write path = `editor.ts` only (station has zero direct fs writes; enforced by review of
imports + tests). Per-requirement dedicated tests: atomic (tmp+rename, no partial file on
injected rename failure), backup-before-replace, validate-before-replace, diff+hash gate (no
silent write; drift ⇒ 409), malformed ⇒ typed refusal with byte-identical file. Simulator
read-only proven by source-scan + snapshot tests.

## 5. Test plan + gates

Floors hold: chartroom 269→(+contract test), chartroom-ui 180→+, ship 15→+, ship-log 81,
suite-conventions 35, ship-ledger 35, ship-inbox 51→+. New package target ≥60 tests: rules.ts
matrix straight from §2 docs facts (each bullet ⇒ cases), merge attribution, editor rails
per-requirement, station routes incl. guard/header/409 paths, templates, CLI smoke. Full
`pnpm turbo build lint test` green. Acceptance script `acceptance/settings-manager.mjs`: boots a
hull with temp scopes, proves the spec line — *"would `Bash(rm -rf ./dist)` be allowed right now
and which rule in which file decides"* — then a rails apply with diff+backup+restore round-trip.

## 6. Risks / honest limits

- Rule engine is a faithful-but-partial model (hooks, sandbox auto-allow, built-in read-only Bash
  set, workspace-trust gating, PS aliases, symlink dual-check not modeled) — every gap is an
  explicit `caveats[]` entry in verdicts, and README documents them.
- Editor cannot fix an already-malformed file by design (refusal rail); recovery path = restore
  a backup. Documented.
- Simulator treats CLI-arg scope as "not simulatable" caveat.

## 7. Deviations

1. **Malformed-target refusal gained an explicit recovery opt-in.** §3 rail 2 said "malformed
   current file ⇒ typed refusal" and §6 named "restore a backup" as the recovery path — but a
   restore is itself a write onto the malformed file, so an absolute refusal would leave NO way
   back (deleting is banned). `applyEdit` therefore refuses by default (409, byte-identical) and
   accepts an explicit `overwriteMalformedBase: true` that still backs up the corrupt bytes
   first. Tested both ways; surfaced in the UI as a clearly-labeled recovery step.
2. **Backup fetch route is `GET /backup?id=` (querystring), not `/backups/:id`** — backup ids
   embed the sanitized origin path and exceed Fastify's default 100-char path-param ceiling
   (empirical 414 in tests).
3. **Editor preserves the caller's bytes verbatim** (round-trip-verified) rather than
   re-serializing — the diff the human confirmed is exactly what lands on disk.
4. **Cross-package acceptance updates:** `ship` deck-boot and `ship-inbox` inbox-queue asserted
   `stations.length === 4`; mounting the new station makes it 5. Both updated, both re-run green.
