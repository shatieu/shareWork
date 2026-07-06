---
id: package-8-crew-bridge-phase-4-team-lead-evidence-report
---

# Package 8 (Crew, Bridge phase 4) — Team Lead evidence report

Mode: combined plan+implement (Captain's wrap-up order). Plan:
`suite-design/overnight/plans/08-crew-plan.md`. Branch: `ship-wave1-crew`, built in an
isolated worktree (`<scratchpad>/wt-crew`) per dispatch — main worktree never touched.
Branched from `78a1fbd` (ship-wave1 tip at cut time, 2026-07-06 ~12:14).

## Commits (7, on ship-wave1-crew)

- `518a4f7` feat(ship-log): read-only MCP server (log_entries/log_rollup/log_sessions) + `ship-log mcp` stdio command
- `f31cbe5` feat(crew): full role set, scrutiny SessionStart wiring, paranoid stop-gate, crew orchestration skill
- `920f693` feat(crew): plugin test suite, phase-4 README, role/skill docs; bump wrapper to 0.2.0
- `fec3b94` chore(crew): lockfile for plugin vitest devDep
- `7cc2876` fix(crew): move seam READMEs out of agents//skills/ (bogus "README" agent observed live)
- `4a5b028` test(ship-log): quartermaster cross-week MCP acceptance script
- `8708387` docs(crew): package-8 changelog fragment (`suite-design/overnight/changelog/entries/2026-07-06--crew-phase4.md`)

## What was built (vs plan — no silent deviations)

1. **Roles** — `plugins/crew/agents/{first-officer,navigator,shipwright,inspector,devils-advocate,quartermaster}.md`.
   Productized from `.claude/agents/wave-*.md` + `first-officer.md`: ≤30-line verdict-first
   report contracts, plan fidelity/visible-deviation rule, never-review-own-work, shared-worktree
   `git show`-only inspection, lean-review calibration (inspector), steelman-then-attack
   (devils-advocate). Mission-specific matter (Lookout, marathon tracking) stripped.
2. **Skill** — `plugins/crew/skills/crew/SKILL.md`: preset table, pipeline order, plan gate
   procedure, paranoid marker protocol, dispatch format, charter hot-load fallback preamble
   (LESSONS-LEARNED productized, asserted by tests).
3. **SessionStart wiring** — `plugins/crew/hooks/scrutiny.mjs` (stdlib-only, always exit 0):
   resolves `ship.scrutiny` from `.claude/settings.json` + `settings.local.json` (local wins,
   default standard, unknown → standard + visible warning), custom presets via
   `ship.crewPresets`, injects `[Ship crew]` briefing via `hookSpecificOutput.additionalContext`,
   records `~/.ship/crew/sessions/<session_id>.json` for the stop gate (SHIP_CREW_HOME test seam).
4. **Plan-gates** — rigorous plan-approval gate is behavioral (briefing text + skill + FO
   charter, per spec: hook enforcement is paranoid-only). Paranoid: `hooks/stop-gate.mjs` emits
   `{"decision":"block","reason":...}` unless `.ship-crew/inspector-pass.json` matches the
   session with verdict PASS. Loop valve on `stop_hook_active`; fail-open on any missing state.
5. **Quartermaster MCP** — new `packages/ship-log/src/mcp.ts` (read-only McpServer: `log_entries`
   with date/since/until/project/limit, `log_rollup` stored-only + available-dates on miss,
   `log_sessions`), `ship-log mcp` CLI command mirroring ship-ledger's stdout-discipline pattern;
   `@modelcontextprotocol/sdk` ^1.29.0 added to ship-log (named in plan; already in workspace).
   Registration stays per-machine per package-5 decision — commands in plugin README;
   quartermaster charter degrades honestly when tools absent.
6. **hooks.json** — SessionStart += scrutiny.mjs, Stop += stop-gate.mjs (emit.mjs capture kept on
   both). `plugin.json` 0.2.0. README rewritten for phase 4 (also fixed stale phase-1
   "PermissionRequest not registered" claim). `ship-log/test/plugin-manifest.test.ts` tightened
   to strict per-event script sets (planned deviation, recorded in plan §6).

## Verification (all fresh in the isolated worktree)

- **Turbo gates**: `pnpm turbo run build lint test --force` → 24/24 tasks green (final run after
  last commit). Per-suite counts: chartroom 269, chartroom-ui 180, ship 15, ship-log **88**
  (floor 81, +7 MCP tests), suite-conventions 35, ship-ledger 35, ship-inbox 51, ship-crew-plugin
  **23** (new suite: child-process tests of scrutiny/stop-gate + payload structure). All floors hold.
- **Live acceptance** (§9.4 wiring level, ~2 haiku -p runs, well under $0.15): scratch repo +
  `--plugin-dir` + one settings line `{"ship":{"scrutiny":"rigorous"}}` → `claude -p --model haiku`
  answered from the injected briefing alone: "Preset: Rigorous. Pipeline: navigator →
  devils-advocate → shipwright → inspector. Gates: plan-approval ON; stop-gate OFF" and listed
  exactly the six crew agent types. Zero further setup — the acceptance line's wiring half.
- **Quartermaster cross-week** (§9.4 second half, spend-free floor):
  `packages/ship-log/acceptance/quartermaster-mcp.mjs` (committed, `pnpm test:acceptance:quartermaster`)
  — REAL `ship-ledger mcp` + `ship-log mcp` stdio child processes, sandboxed home, two-week
  auth-rework history seeded (ledger writes through real MCP tools), then the quartermaster's
  literal queries: 10/10 assertions OK (status in_review, 3 entries spanning ISO weeks 26-27
  newest-first, "since last week" narrows to 2, stored rollup retrieved, miss lists available
  dates, sessions newest-first).
- **Merge safety**: `git merge-tree ship-wave1 HEAD` → clean (no conflicts vs advanced tip
  including merged pkgs 13+10). Diff vs merge-base: 28 files, 0 under `team-tasks/`.

## Live-acceptance discovery (product fix included)

Claude Code loads EVERY `agents/*.md` as a dispatchable agent — the Bridge-1 seam README
surfaced as a bogus "README" agent in the first acceptance run. Fixed via `git mv` (recorded
here per charter; nothing deleted): `plugins/crew/agents/README.md` → `plugins/crew/docs/agents.md`,
`plugins/crew/skills/README.md` → `plugins/crew/docs/skills.md`, plus a regression test pinning
`agents/` to exactly the six charters. Second acceptance run: six roles, no README.

## NOT proven (stated plainly)

- **Full multi-agent "help with X" assembly** (a session actually dispatching
  navigator→…→inspector end-to-end) — behavioral, priced out of `-p`; the wiring (briefing +
  roles visible) is what was live-proven. Manual recipe in plugin README.
- **Stop-hook `decision:block` against a live interactive session** — Stop blocking is
  documented-schema + child-process-tested on our side (block JSON shape, loop valve, fail-open),
  but not observed in a real interactive stop (same interactive-only wall as package 6's
  PermissionRequest; manual step in README's "Manual" section).
- **Full agent-loop quartermaster answer with live model** — needs per-machine `claude mcp add`
  (parked per package-5 decision) + spend; the tool-chain floor under it is proven 10/10.
- `additionalContext` in interactive (non--p) sessions assumed identical to the proven -p path.

## Captain decisions

None blocking. 3 FYIs appended to DECISIONS-NEEDED.md (crewPresets home, `.ship-crew/` marker
+ gitignore guidance, per-machine MCP registration reaffirmed).

## Pointers

Worktree: `C:\Users\ourba\AppData\Local\Temp\claude\C--thisismydesign-shareWork\4226671f-ca22-4753-9ffe-e786ab86b7f5\scratchpad\wt-crew`
(left on `ship-wave1-crew`, clean tree; not removed per dispatch). Key files:
`plugins/crew/{agents/*,skills/crew/SKILL.md,hooks/{scrutiny,stop-gate}.mjs,README.md,test/*}`,
`packages/ship-log/{src/mcp.ts,src/cli.ts,test/mcp.test.ts,acceptance/quartermaster-mcp.mjs}`.
