---
id: skill-analytics
---

# skill-analytics

"ccusage for skills" (Trio_Specs §A): which skills, agents and slash-commands actually fire,
what they cost in tokens, and which are dead weight.

## How it works

- **Collector** parses the local Claude Code transcripts (`~/.claude/projects/*/*.jsonl`) —
  the only reliable source for skill names. Incremental: a byte cursor per file in the store;
  after the first pass only appended bytes are read. Zero config.
- **Store**: SQLite at `~/.ship/skill-analytics.db` (WAL). One row per invocation.
- **CLI**: `skill-analytics collect | report [--json] [--project <p>] [--days <n>] | dead [--days <n>]`.
  `report`/`dead` run an incremental collect first (disable with `--no-collect`).
- **Station**: mounted into `ship serve` as `skill-analytics` (no Deck tab — the console owns
  tab routing). Routes: `GET /api/skill-analytics/summary|skills|dead|health`,
  `POST /api/skill-analytics/collect` (requires the `x-ship-deck` header). In-process contract:
  `getSummary`. The ready-to-mount dashboard face lives in
  `packages/chartroom-ui/src/skillanalytics/SkillAnalyticsPanel.tsx`.

## Metrics (v1)

- Trigger counts per skill/agent/slash-command, per project and global.
- **Proactive vs explicit ratio**: a `Skill` tool_use = the model reached for it (proactive);
  a typed `/command` = explicit. The ratio measures whether skill *descriptions* work.
- **Token cost per invocation — attribution heuristic**: an invocation opens a window; each
  subsequent assistant message's usage in that transcript accrues to the most recent open
  invocation; a real (non-sidechain) user prompt closes the window. Windows survive collector
  runs. Usage outside any window is dropped (generic cost dashboards are out of scope —
  ccusage/OTel own that ground). Exact per-skill cost needs native OTel skill events
  (FR #35319); the collector/analyzer split means native events would replace `collect.ts`
  and everything above the store survives.
- **Dead skills**: installed (user `~/.claude/skills`, project `.claude/skills` for every
  project seen in transcripts, plugin cache) but silent ≥ N days (default 30).
- Trends: invocations per day.

## Privacy (hard rails)

- Transcripts are opened **read-only**; the store keeps **identifiers and numbers only** —
  skill/agent/command names, token counts, timestamps, cwd, session ids. Never prompt text,
  never tool inputs beyond the skill/agent name, never file contents.
- Everything is local. Nothing is uploaded, ever. The station only exists behind the hull's
  127.0.0.1-only bind.

## Transcript format note

The JSONL layout is undocumented; the parser is locked to shapes verified empirically against
real transcripts (2026-07-06) and tolerates everything else (unknown line types, malformed
lines, future fields) by producing no events rather than errors.
