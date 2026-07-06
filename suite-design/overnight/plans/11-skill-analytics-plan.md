---
id: package-11-skill-analytics-trio-specs-a-2
---

# Package 11 — Skill Analytics (Trio_Specs §A)

**Mode:** combined plan+implement (Captain's wrap-up order 2026-07-06 09:35).
**Branch:** `ship-wave1-analytics` off `ship-wave1` @ fb11758, ISOLATED worktree
(main worktree held by package 9). **TL:** this session.

## Scope

"ccusage for skills": which skills/agents/slash-commands actually fire, what they cost
in tokens, which are dead weight. Collector + CLI + JSON station endpoint + self-contained
console panel component.

1. **`packages/skill-analytics`** (canonical name, Suite-Architecture §3) — collector
   library, SQLite store, CLI bin, Deck station:
   - `src/transcripts.ts` — enumerate `~/.claude/projects/*/*.jsonl` (claudeDir override
     for tests; the real dir is READ-ONLY, never written).
   - `src/parse.ts` — pure per-line JSONL parser → typed events. Verified layout (probed
     real transcripts on this machine, 2026-07-06):
     - skill: `assistant` line, `message.content[]` block `{type:'tool_use', name:'Skill',
       input:{skill, args?}}` → **proactive** invocation.
     - slash command: `user` line whose text contains `<command-name>/x</command-name>`
       (+ `<command-message>`/`<command-args>`) → **explicit** invocation.
     - agent: `tool_use` name `Agent` (legacy `Task` accepted), `input.subagent_type`
       (default `general-purpose`).
     - usage: `message.usage` = input_tokens / output_tokens /
       cache_creation_input_tokens / cache_read_input_tokens; `message.model`;
       line-level `timestamp` (ISO), `sessionId`, `cwd`, `gitBranch`, `isSidechain`.
     - Non-message line types (`attachment`, `file-history-snapshot`, `mode`, …) and
       malformed lines are skipped tolerantly.
   - `src/db.ts` — WAL SQLite at `~/.ship/skill-analytics.db` (homeDir override; mirrors
     ship-log's db.ts pattern): `file_cursors` (path PK, byte offset, size, mtime),
     `invocations` (kind skill|agent|command, name, trigger proactive|explicit, project,
     cwd, session_id, ts, date, tokens_in/out/cache_create/cache_read, model),
     `schema_meta`.
   - `src/collect.ts` — **incremental** collector: per-file byte cursor; file shrunk or
     replaced → reparse from 0 (dedupe by delete-and-reinsert per session_id+file slice
     is overkill; v1 dedupes by unique (file, line_no) key). Zero config.
   - `src/attribution.ts` — token cost per invocation, documented **heuristic**: an
     invocation opens an attribution window; every subsequent assistant message's usage
     in the same file accrues to the most recent open invocation; the window closes at
     the next real user prompt (non-tool-result) or next invocation. Unattributed usage
     is dropped (generic cost dashboards are explicitly out of scope).
   - `src/installed.ts` — installed-skill census for dead-skill detection: dir scan of
     `~/.claude/skills/*/SKILL.md` + `<project cwd>/.claude/skills/*` for every project
     seen in transcripts + `~/.claude/plugins` cache skills (best-effort, existence only,
     never reads skill content).
   - `src/report.ts` — aggregations: counts per name (global + per-project), proactive vs
     explicit ratio, token totals, first/last seen, per-day trend, dead skills (installed
     & silent ≥ N days, default 30).
   - `src/cli.ts` — bin `skill-analytics`: `collect`, `report [--json] [--project <p>]
     [--days <n>]` (ccusage-style table default), `dead [--days <n>]`, `--claude-dir` /
     `--home-dir` overrides.
   - `src/station.ts` — `createSkillAnalyticsStation()`: **no `tab`** (package 9 owns
     console UI routing). Routes: GET `/api/skill-analytics/summary|skills|dead`,
     POST `/api/skill-analytics/collect` (x-ship-deck header required, runs incremental
     collect), GET `/api/skill-analytics/health`. Contract `getSummary` offered for the
     console station.
2. **`packages/chartroom-ui/src/skillanalytics/SkillAnalyticsPanel.tsx`** — self-contained
   mountable panel (fetches summary, renders counts/ratio/dead list; collect button).
   NEW FILES ONLY in chartroom-ui (+ test). **No App.tsx / TabBar edits** — package 9
   collision rule; FO/pkg-9 mounts it later.
3. **`packages/ship/src/commands/serve.ts`** — line-additive only: one import + one
   station in the array (LAST edit; rebase expected if package 9 lands first).
4. Acceptance script `packages/skill-analytics/acceptance/skill-analytics.mjs`:
   synthesized real-shaped fixture transcripts (never committed real ones) → collect →
   CLI table+JSON → station endpoint asserts.
5. Changelog fragment `suite-design/overnight/changelog/entries/2026-07-06--skill-analytics.md`.

## Out of scope (explicit)

- USD cost estimates (price tables churn; token counts are the v1 cost metric — spec's
  own out-of-scope excludes generic token/cost dashboards; ccusage/OTel own that).
- Native OTel skill events (FR #35319) — collector/analyzer split keeps the swap seam.
- Team/hosted analytics; any upload. Console tab routing (package 9's file).
- Watching/daemon mode — collect runs on demand (CLI, station start, POST /collect).

## Privacy rails (hard)

Parser extracts ONLY: tool names, skill/agent/command identifiers, usage numbers,
timestamps, cwd/project, session ids. Never persists prompt/message text, tool inputs
beyond the skill/agent name, or file contents. Local SQLite only, no network. Real
`~/.claude/projects` opened read-only.

## Test plan / gates

- Unit: parse (all verified line shapes + malformed), collect (incremental cursor,
  truncation), attribution windows, report aggregations + dead-skill, installed census,
  station routes (CSRF header, health), CLI smoke via execFile. UI: panel render test
  (jsdom, mocked fetch), matching existing chartroom-ui test pattern.
- Floors: full `pnpm turbo build lint test` green in worktree; suite counts recorded
  from base tree first — no package may drop below its base count.
- Acceptance (spec line): fixtures → collector → CLI report shows per-skill counts,
  proactive/explicit ratio, token attribution, dead skill → same numbers from
  `/api/skill-analytics/summary`.

## Deviations (logged during implementation, 2026-07-06)

1. `packages/ship/package.json` + `pnpm-lock.yaml` also edited (line-additive
   `skill-analytics: workspace:*` dep) — unavoidable for the serve.ts import; both are
   shared with package 9, same rebase expectation as serve.ts.
2. Trailing-partial-line handling added to the collector (a line without a trailing
   newline is left for the next run) — transcripts are appended live; without this a
   half-written record would be lost forever by the advancing cursor.
3. Panel CSS ships as a component-scoped stylesheet (`skillanalytics.css`) instead of
   `styles/base.css` — base.css is package 9 collision territory.

## Risks

- serve.ts conflict with package 9 → expected, line-additive, rebase on FO ask.
- Attribution is a heuristic (documented in code + README); exactness needs native
  events (watch item).
- Transcript format is undocumented/CLI-version-dependent → parser is
  tolerant-by-default and unit-locked to the empirically verified shapes.
