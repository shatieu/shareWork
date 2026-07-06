---
id: package-11-skill-analytics-team-lead-report-combined-plan-implement
---

# Package 11 — Skill Analytics — Team Lead report (combined plan+implement)

**Verdict: IMPLEMENTED, self-verified green — rebased onto cc0a3bf.** 7 commits on
`ship-wave1-analytics` (9ddd5f6..ff0b02d, base cc0a3bf after the FO-ordered rebase round;
originally 6 commits off fb11758), built in the isolated worktree
`<scratchpad>/wt-analytics`. Not merged, not pushed (FO's act).

## Deliverables (plan: `suite-design/overnight/plans/11-skill-analytics-plan.md`)

- `packages/skill-analytics` — new package, canonical name per Suite-Architecture §3:
  - `src/parse.ts` — pure tolerant JSONL line parser, locked to shapes **verified
    empirically against real `~/.claude/projects` transcripts on this machine**
    (read-only probes, 2026-07-06): `Skill` tool_use `{skill}` = proactive; `Agent`
    (legacy `Task`) tool_use with `subagent_type` (default `general-purpose`);
    `<command-name>/x</command-name>` user lines = explicit; `message.usage` token
    fields; `sessionId`/`cwd`/`timestamp`/`isSidechain` line metadata.
  - `src/collect.ts` — incremental collector: byte cursor per file in SQLite, appended
    bytes only, truncation → drop+reparse, trailing partial line deferred, attribution
    windows survive runs via `file_cursors.open_invocation_id`.
  - `src/db.ts` — WAL SQLite `~/.ship/skill-analytics.db` (homeDir override everywhere;
    ship-log pattern). Identifiers + numbers ONLY — privacy-locked by unit test
    (message text provably never lands in any table).
  - `src/attribution` (in collect) — documented heuristic: invocation opens window →
    later assistant usage accrues → real non-sidechain user prompt closes; sidechain
    subagent usage accrues to the spawning Agent invocation.
  - `src/installed.ts` — dead-skill census: user/project/plugin-cache scopes (plugin
    layout `plugins/cache/<mkt>/<plugin>/<ver>/skills/<name>/SKILL.md` verified on disk).
  - `src/report.ts` — per-name counts (skill+command kinds merged by name), proactive vs
    explicit ratio, token totals, per-day trend, dead skills, one `Summary` payload
    shared by CLI and endpoint.
  - `src/cli.ts` — `skill-analytics collect | report [--json|table] | dead`, ccusage-style
    table, `--home-dir`/`--claude-dir` overrides.
  - `src/station.ts` — headless station (NO tab — package 9 owns tab routing):
    GET `/api/skill-analytics/summary|skills|dead|health`, CSRF-gated POST `/collect`,
    `getSummary` contract, initial collect off the boot path.
- `packages/chartroom-ui/src/skillanalytics/SkillAnalyticsPanel.tsx` + scoped
  `skillanalytics.css` — self-contained mountable panel, raw fetches (not shared
  api/client.ts), NEW FILES ONLY in chartroom-ui. Deliberately unmounted.
- `packages/ship`: serve.ts line-additive import + station in array; package.json dep +
  lockfile (deviation 1 — shared with pkg 9, rebase expected on all three).
- Changelog fragment `changelog/entries/2026-07-06--skill-analytics.md` (committed on branch).
- README with metrics, attribution heuristic, privacy rails, OTel swap seam (FR #35319).

## Evidence (all fresh runs in the worktree)

- **Gates:** `turbo build lint` 28/28 tasks green; `turbo test --force` (no cache)
  28/28, **1102 tests total, 0 failures**. Floors hold by construction: untouched
  packages identical to base (chartroom 270, ship-log 88, ship 16, settings-manager 103,
  etc. all pass); chartroom-ui 202 = base 200 + 2 new; skill-analytics +33 new.
- **Acceptance script** (`packages/skill-analytics/acceptance/skill-analytics.mjs`): 6/6 —
  fixtures → collector (incremental proven: run2 = 0 new, append = 1 new) → CLI
  table+JSON (counts, 2:1 ratio, 151 attributed input tokens, dead skill) → station
  endpoint returns identical numbers; collect POST 403 without `x-ship-deck`.
- **Live proof on real data:** CLI vs this machine's real transcripts (read-only, temp
  store): 210 transcripts, 74,373 lines, **610 invocations in 1.1 s**; second run 0 new
  (incremental); real ratios surfaced (e.g. a skill at 88% proactive) and real
  never-fired project skills flagged dead.
- **Live hull boot:** `ship serve --port 4390` → 7 stations mounted
  (`..., settings-manager, skill-analytics`), `/api/skill-analytics/health` +
  `/summary?days=7` (289 invocations) served; `/api/hull/stations` shows skill-analytics
  with no tab. Process killed after; side effect: real `~/.ship/skill-analytics.db` now
  exists (intended product behavior — dogfooding).

## Not proven / notes

- Panel renders only under jsdom tests — it is unmounted by design until package 9/FO
  wires it into the Console tab (one-line mount: `<SkillAnalyticsPanel />`).
- Attribution is a heuristic (documented in code/README); exact per-skill cost needs
  native OTel skill events — collector/analyzer split keeps that swap seam.
- Legacy `Task` tool name accepted but only synthetically tested (no old transcripts on
  this machine used it).
- Subagent scratch DIRECTORIES beside the `.jsonl` files are not scanned (non-recursive
  by design; inline sidechain lines ARE handled). If separate sidechain transcript files
  exist on other machines, they'd be missed — v1 accepted.
- USD pricing deliberately out (token counts are the cost metric; ccusage owns $).
  No Captain-only decisions surfaced; DECISIONS-NEEDED untouched.
- Chart Room hook injected frontmatter ids into README + changelog fragment (expected).

## Rebase round (FO-ordered, 2026-07-06 ~14:45) — DONE

`ship-wave1` advanced to cc0a3bf (package 9 console merged). Rebased; resolved the expected
serve.ts conflict to register **eight stations** (ship-console AND skill-analytics); lockfile
consistent after `pnpm install` (no drift). Updated `packages/ship/acceptance/deck-boot.mjs`:
expects 8 stations incl. tab-less skill-analytics + new `/api/skill-analytics/health`
through-the-hull assertion — re-run after `build:ui-bundle`: **all assertions passed**.
Console-tab mount DONE (trivial + testable, per FO invitation): `<SkillAnalyticsPanel />`
mounted at the bottom of `ConsolePage.tsx` (import + one element); package 9's
`ConsolePage.test.tsx` gained a global-fetch stub returning an empty summary (keeps its exact
alert/table assertions valid) plus a positive "Skill analytics heading" assertion.
Post-rebase gates fresh: turbo build/lint green; `turbo test --force` 15/15 packages,
**1123 tests, 0 fail** (chartroom-ui 210 = merged base 208 + 2 mine; ship 17; ship-console 11
— all floors hold); my acceptance 6/6. "Panel unmounted" is REMOVED from the not-proven list:
the panel now renders in the Console tab and is asserted in package 9's own suite.
