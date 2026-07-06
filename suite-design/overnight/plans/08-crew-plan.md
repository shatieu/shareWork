---
id: package-8-plan-crew-bridge-phase-4
---

# Package 8 plan — Crew (Bridge phase 4)

Spec: `Ship_Spec.md` §7 (+ §9.4 acceptance). Mode: combined plan+implement (Captain's wrap-up
order 09:35). Branch: `ship-wave1-crew` in an ISOLATED worktree (main tree held by pkg 7).
Prior art productized: `.claude/agents/wave-*.md` + `first-officer.md` (8 packages of field
testing), `plugins/crew` (Bridge-1 skeleton), `packages/ship-ledger` MCP, `packages/ship-log`,
LESSONS-LEARNED.md (charter hot-load fallback, dispatch preambles, shared-worktree rules,
30-line report contract — all become product text, not anecdotes).

## Scope

1. **Roles** — `plugins/crew/agents/*.md` (six): `first-officer` (orchestrator; usable as the
   session's main agent via `--agent first-officer`), `navigator` (research; from
   wave-researcher), `shipwright` (implementation; from wave-developer), `inspector` (review +
   test/lint gates; from wave-reviewer, lean-by-default calibration kept), `devils-advocate`
   (new; attacks the plan before implementation, explicit "objections / no fatal objection"
   verdict), `quartermaster` (long-horizon memory over ledger+log MCP; not a bookkeeper).
   Mission-specific matter (Lookout, marathon tracking files) is stripped; the report contract
   (≤30 lines, verdict first, evidence to files), plan-fidelity, never-review-own-work,
   worktree/branch discipline are generalized and kept.
2. **Orchestration skill** — `plugins/crew/skills/crew/SKILL.md`: how the FO reads the active
   preset, assembles the pipeline, runs the rigorous plan-approval gate (present plan → human
   approval before code), dispatch format + the hot-load fallback preamble ("read
   <plugin agent file> and adopt it") when a role type isn't listed, paranoid marker protocol.
3. **Scrutiny presets + SessionStart wiring** — new stdlib-only `plugins/crew/hooks/scrutiny.mjs`
   on SessionStart (alongside emit.mjs): resolves `ship.scrutiny` from `.claude/settings.json`
   then `.claude/settings.local.json` (local wins; default `standard`; unknown value → standard +
   warning in context), supports custom presets `ship.crewPresets.<name> = { roles[], planGate,
   stopGate }` (spec's "plugin config" — parked as taken-default FYI). Emits
   `hookSpecificOutput.additionalContext` (preset, pipeline, gates, skill pointer) and records
   `~/.ship/crew/sessions/<session_id>.json` for the Stop gate. Always exits 0 (fail-open).
4. **Paranoid Stop-hook enforcement** — new `plugins/crew/hooks/stop-gate.mjs` on Stop: acts only
   when the recorded preset has `stopGate`; requires `.ship-crew/inspector-pass.json` in cwd with
   matching `session_id`, else stdout `{"decision":"block","reason":…}`. Loop-safety: allows when
   `stop_hook_active` is true; fail-open on any error/missing state. Inspector writes the marker
   only on a PASS verdict (charter + skill instruct it). README documents gitignoring
   `.ship-crew/`.
5. **Quartermaster MCP access** — ship-ledger MCP exists; add read-only MCP to **ship-log**:
   `src/mcp.ts` (`McpServer` name `ship-log`, tools `log_entries` (date/project/limit filters),
   `log_rollup` (get stored rollup by date), `log_sessions` (recent sessions)) + `ship-log mcp`
   stdio CLI command, mirroring ship-ledger's pattern. Dependency: `@modelcontextprotocol/sdk`
   ^1.29.0 added to ship-log (already in workspace via ship-ledger; spec §8 names it).
   Registration stays a documented per-machine step (`claude mcp add …`) per the package-5
   decision — plugin cannot portably point at a workspace dist. Quartermaster charter degrades
   honestly when tools are absent (says so, points at README commands).
6. **hooks.json + manifest** — add the two new hook registrations; bump plugin to 0.2.0 with an
   updated description; rewrite plugin README (roles, presets table, gates, MCP registration,
   acceptance recipes). Update `ship-log/test/plugin-manifest.test.ts`, which currently pins
   every SessionStart/Stop entry to emit.mjs — extended to the phase-4 hook set (visible
   deviation, recorded here).
7. **Tests** — plugin package gains vitest (devDep only; runtime stays stdlib-only):
   child-process tests for scrutiny.mjs (preset matrix, local-override, custom preset, malformed
   settings → fail-open) and stop-gate.mjs (block shape, marker pass, stop_hook_active valve,
   fail-open), structural tests for the six agent files + skill. ship-log gains
   `test/mcp.test.ts` over `InMemoryTransport` (ship-ledger's proven pattern).

## Out of scope

Console invocation of the Quartermaster (pkg 9); marketplace/Harbor distribution rails; MCP
auto-registration (parked decision, pkg 5); any change to emit.mjs/permission.mjs behavior;
settings-manager surfaces (pkg 7 owns settings UI; we only READ settings.json here).

## Acceptance (self-verified; wrap-up order = no independent reviewer unless FO names risk)

- Turbo build/lint/test green in the isolated worktree; floors hold (chartroom 269, chartroom-ui
  180, ship 15, ship-log 81, suite-conventions 35, ship-ledger 35, ship-inbox 51) — this package
  only raises ship-log and adds a plugin suite.
- **Live**: scratch repo + plugin install + one settings line (`"ship":{"scrutiny":"rigorous"}`)
  → real `claude -p` (haiku, ≤$0.15) whose answer proves the SessionStart-injected crew briefing
  (names preset + pipeline) and one plugin role visible. Spec §9.4 line demonstrated at the
  wiring level; full multi-agent "help with X" assembly is behavioral and priced out of -p —
  stated plainly in the report.
- **Quartermaster cross-week question**: seeded ledger+log DBs (sandboxed home) spanning two
  weeks; scripted MCP client (both servers) retrieves exactly the data answering "where are we
  with X since last week" — evidence in report; full agent-loop answer not purchased.

## Risks

- Stop-hook `{"decision":"block"}` schema not re-verified live in `-p` (interactive-only
  surfaces burned pkg 6 before); child-process tests pin our side, README carries a manual
  verification step. - additionalContext injection shape: verified live by the acceptance run
  itself. - plugin-manifest test relaxation could mask a future wrong-script registration; kept
  strict per-event expectations instead of a blanket allow.

## Captain decisions

None blocking. FYIs appended to DECISIONS-NEEDED.md: (a) custom presets live under
`ship.crewPresets` in settings.json; (b) `.ship-crew/` cwd marker dir + gitignore guidance;
(c) MCP registration remains per-machine (reaffirming pkg-5 default).
