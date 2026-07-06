---
id: package-11-skill-analytics-trio-specs-a
---

# Package 11 — Skill Analytics (Trio_Specs §A)

"ccusage for skills", shipped as `packages/skill-analytics`: an incremental collector that
parses the local Claude Code JSONL transcripts (byte cursor per file, zero config, read-only)
into a WAL SQLite store at `~/.ship/skill-analytics.db`, holding identifiers and numbers only —
skill/agent/slash-command names, trigger mode, attributed token counts, timestamps, project —
never message content. The parser is locked to line shapes verified empirically against real
transcripts on this machine (Skill/Agent tool_use blocks, `<command-name>` user lines,
`message.usage`) and tolerates everything else silently.

Metrics v1: trigger counts per skill/agent/command (per project + global), the
proactive-vs-explicit ratio (Skill tool_use vs typed `/command` — measures whether skill
descriptions work), token cost per invocation via a documented attribution-window heuristic
(invocation → following assistant usage → closed by the next real user prompt; windows survive
collector runs), per-day trends, and dead-skill detection (installed in user/project/plugin-cache
scopes but silent ≥ N days).

Outputs: `skill-analytics` CLI (`collect` / `report [--json]` in a ccusage-style table /
`dead`), and a headless `skill-analytics` Deck station mounted in `ship serve` — GET
`/api/skill-analytics/summary|skills|dead|health`, CSRF-gated POST `/collect`, `getSummary`
in-process contract, with an initial collect run off the boot path. The console's dashboard
face ships ready-to-mount as `chartroom-ui`'s self-contained `SkillAnalyticsPanel` (own scoped
stylesheet, raw station fetches; deliberately unmounted — console tab routing belongs to the
console package). 35 new tests + a 6-step acceptance script proving collector → CLI → endpoint
agreement on the same fixtures.
