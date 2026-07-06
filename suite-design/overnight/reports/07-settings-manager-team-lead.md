---
id: 07-settings-manager-team-lead-report-combined-plan-implement
---

# 07-settings-manager — Team Lead report (combined plan+implement)

Date: 2026-07-06. Branch `ship-wave1-settings` off `ship-wave1` @ 78a1fbd.
Plan: `suite-design/overnight/plans/07-settings-manager-plan.md` (deviations logged in its §7).
Spec: `Trio_Specs.md` §B. One session death mid-package (session limit after the rules-matrix
commit); resumed cleanly from git + plan, no work lost.

## What shipped

**`packages/settings-manager`** (new, canonical name per Architecture spec §3):

| Module | Job |
|---|---|
| `src/scopes.ts` | scope discovery/read (managed per-OS path, user, project, local); malformed = surfaced error, excluded, never coerced |
| `src/merge.ts` | effective settings: permission arrays MERGE across scopes, scalars override by precedence; per-rule/per-key `{scope, file}` attribution + shadowed values |
| `src/rules.ts` | rule grammar: bare/`(*)`, Bash+PowerShell globs (word-boundary ` *`, `:*` suffix, mid-pattern `*` spanning spaces), compound splitting (`&& \|\| ; \| \|& &` newlines, quote-aware), wrapper stripping (`timeout time nice nohup stdbuf`, bare `xargs`), gitignore path anchors (`//`, `~/`, `/`=settings-source, cwd; win32→`/c/` normalization), WebFetch domain wildcards, MCP server/tool rules, `Tool(param:value)` deny/ask rules, tool-name globs (deny/ask only; unanchored allow globs reported as CC-skipped) |
| `src/simulator.ts` | deny→ask→allow first-match; compound = per-subcommand across the whole rule set; no-match → effective defaultMode explained; caveats + unevaluated always surfaced |
| `src/editor.ts` | THE RAILS (below) + `computeRemoveAllowRule` (subtractive post-check) + `computeAdditiveRules` (additive post-check) + backups with `.meta.json` origin sidecars |
| `src/schema.ts` | structural validator behind a `SchemaProvider` seam (live-generated schema parked in DECISIONS-NEEDED); unknown keys warn, wrong shapes block |
| `src/diff.ts` | dependency-free LCS line diff + unified format |
| `src/templates.ts` + `templates/*.json` | safe-web-dev, read-only-audit, ci-headless, crew-defaults (versioned data files) |
| `src/station.ts` | Deck station, tab `settings`; routes `/api/settings-manager/*`; CSRF header on mutations; write-target guard (chartroom `listRepoDirs` contract + standalone allowlist; managed/CLI never writable) |
| `src/cli.ts` | standalone READ-ONLY bin (`effective`, `simulate`) — no CLI write flag by design (would bypass the diff rail) |

**Cross-package (all tested):** chartroom `listRepoDirs` contract; ship-inbox
`listAlwaysAllowedRules` db fn + `alwaysAllowedRules` contract; `ship serve` mounts the station;
deck-boot + inbox-queue acceptance scripts updated for 5 stations. **Deck UI:** Settings tab in
chartroom-ui (simulator bench, effective view, rails editor with diff modal, template packs,
always-allowed + revoke, backups) — see `reports/07-settings-manager-ui-developer.md`.

## FO-named risk — evidence per rail

Every write path is `editor.ts` (station has zero other fs writes). Dedicated tests
(`test/editor.test.ts` 20, `test/station.test.ts` 16, plus live acceptance):

1. **Validate before touch**: invalid JSON / schema violation → typed 400, file byte-identical.
2. **Diff before apply**: `applyEdit` demands the sha256 `baseHash` ticket from `previewEdit`;
   drift (concurrent writer between preview and apply) → typed 409 `base-drift`, zero writes,
   no backup, no tmp residue — proven byte-identical.
3. **Malformed = typed refusal, byte-identical** (409 `malformed-target`); explicit
   `overwriteMalformedBase` recovery path backs up the corrupt bytes first (plan deviation 1 —
   an absolute refusal would have left no way back since restore is itself a write).
4. **Timestamped backups** under `~/.suite/settings-backups/` + origin sidecar; same-ms
   collision suffixes; never deleted; restore rides the same preview/apply gate.
5. **Atomic**: unique same-dir tmp + rename; no-op apply writes nothing.
6. **JSON round-trip** verified before replace.

**Simulator provably read-only**: (a) source-scan test — `simulator/merge/rules.ts` contain no
`node:fs` import and no write API tokens; (b) behavioral test + live acceptance — byte+mtime
snapshot across `loadScopes`+`simulate` identical, including over the spawned hull.

## Verification (all fresh this session)

- settings-manager: **103 unit/station tests** green; tsc clean; eslint clean.
- Floors, each fresh-run this session (not cache-trusted): chartroom **270** (269+1),
  chartroom-ui **200** (180+20, UI developer's Deck slice — see
  `reports/07-settings-manager-ui-developer.md`), ship **16** (15+1), ship-inbox **52** (51+1),
  ship-log **81**, suite-conventions **35**, ship-ledger **35**. Full
  `pnpm turbo run build lint test`: **26/26 tasks successful** (repo total 792 tests).
- **Acceptance `acceptance/settings-manager.mjs`: PASS, 27/27** against a real spawned
  `ship serve` (isolated home, registered scratch repo): spec question → DENY with
  `Bash(rm *)` @ project settings.json named; read-only proof; 403/409/byte-identical rails
  walk; backup holds original bytes; template additive (seeded rules + unknown keys verbatim);
  revoke removes exactly one rule; CLI exit 1 on deny.
- `ship` deck-boot acceptance: PASS (5 stations, Settings tab). `ship-inbox` inbox-queue: PASS.

## Honest limits (stated, not hidden)

- Rule engine models the documented grammar (docs fetched 2026-07-06, cited per-test); NOT
  modeled: PreToolUse hooks, sandbox auto-allow, built-in read-only Bash set, workspace trust,
  PowerShell alias canonicalization, symlink dual-path checks, gitignore `!`/`[...]` — each is
  an explicit verdict caveat or `unevaluated` entry, never a silent skip. Fidelity vs the real
  CC engine is doc-derived, not differential-tested against the binary (a differential harness
  would cost API spend; candidate for a later researcher pass).
- CLI-args scope is not file-backed → permanent caveat. MDM/registry-delivered managed settings
  are not readable → caveat when the managed file is absent.
- Live-generated schema + marketplace pack home: parked in DECISIONS-NEEDED (seams built).
- `ship serve` uses real-home scopes; the hull's Host-guard/CSRF/loopback posture is the
  boundary, same as ship-inbox's settings writer.

## Commits (this branch)

See `git log ship-wave1..ship-wave1-settings` — plan, core lib, core tests, station+contracts,
UI (developer), acceptance+changelog+report. No merges, no pushes, `team-tasks/` untouched,
nothing deleted (REMOVALS.md untouched — nothing needed removal).
