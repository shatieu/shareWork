---
id: report-04-bridge-phase1-team-lead-planning
---

# Package 04 — Bridge phase 1 — Team Lead report (PLANNING stage)

Date: 2026-07-05. Mode: planning only. No code written, no checkouts, no branch created.
Worktree was hot with package 3 the whole time — every baseline fact was read via
`git show ship-wave1:<path>` or from plan/report documents, never the working tree.

## What was produced

- **Plan:** `suite-design/overnight/plans/04-bridge-phase1-plan.md` — complete: scope,
  out-of-scope, file-level design (Deck-dependent parts explicitly marked [PROVISIONAL]),
  §0 rebase-refresh section (plan-03-§0 pattern, as dispatched), capture-semantics design,
  test plan, acceptance proposal, researcher questions R1–R6, risks, Captain decisions,
  implementation order.
- **DECISIONS-NEEDED.md:** appended a "Package 4 (Bridge phase 1) planning" section with 4
  entries (summarizer engine default, fragment noise policy, dogfood commit policy, potential
  Ship_Spec-§2-vs-real-CLI event gap).

## Evidence trail (what was actually read)

- `MISSION-CONTEXT.md`; `Ship_Spec.md` in full (§2 one-hull revision, §4 changelog, §7 crew,
  §8 stack, §9.1 acceptance line, §10–11); `Suite-Architecture_and_Website_Spec.md` §1–§3
  (naming: dir `plugins/crew`, plugin name `ship-crew`, package `packages/ship-log`).
- `plans/03-captains-deck-plan.md` in full — the plan binds ship-log's station to plan 03 §4.2's
  StationDescriptor/HostContext and §4.4's route-ownership convention, with §0 of my plan
  listing exactly which of those facts must be re-verified against the merged tree.
- `reports/02-chartroom-v11-researcher.md` — R4 (claude -p headless: hooks fire in -p, JSON
  output fields, OAuth reuse, budget flags) and R5 (homedir override) are load-bearing for the
  summarizer design and every test's isolation strategy; cited in the plan rather than re-asked.
- Baseline via `git show ship-wave1:` — root package.json (pnpm 10 → the better-sqlite3
  onlyBuiltDependencies gotcha, plan §4), pnpm-workspace.yaml (globs already cover plugins/*),
  plugins/README.md (only file in plugins/), chartroom/package.json (workspace versions to
  reuse: fastify, zod, commander, vitest), no tracked `.claude/settings.json` (dogfood target).
- `MARATHON-KICKOFF-PROMPT.md` queue item 4 + PLAN.md + DECISIONS-NEEDED.md history.

## Key design calls (FO should challenge these)

1. **Emitter is stdlib-only and fail-open** (`plugins/crew/hooks/emit.mjs`): POST to hull with
   1.5 s budget, spool to `~/.ship/spool/events.jsonl` on any failure, always exit 0. A
   marketplace plugin can't resolve workspace deps — this is why the emitter is thin and the
   brains live in `packages/ship-log`.
2. **Capture on SessionEnd, not Stop** (Stop = per-turn checkpoint only; orphan sweep as the
   net for crashed sessions). Spec's "on Stop/SessionEnd" read as trigger-family; R6 verifies.
3. **Summarizer = `claude -p --model haiku`** (injected interface; R4-verified) over the spec's
   literal "Agent SDK" — parked to Captain with rationale. Deterministic fallback (commit
   subjects) so capture never depends on network/credits.
4. **Hook-loop guard:** summarizer child runs from a neutral cwd + `SHIP_LOG_SUMMARIZER=1` env
   marker that emit.mjs short-circuits on — self-capture recursion is structurally dead.
5. **One new dependency requested: better-sqlite3** (spec §8-named). Includes the pnpm-10
   `onlyBuiltDependencies` root change — called out explicitly since it touches root config.
6. **Acceptance = two tiers:** deterministic `acceptance/two-repo-log.mjs` (synthetic events
   through the real emitter + real hull, fake summarizer, isolated HOME) + a live run on this
   machine (two real `claude -p` sessions, real Haiku fragments + rollup) matching spec §9.1
   literally. Plus spool-drain proof (hull down → capture delayed, not lost).

## Researcher pass needed before implementation (plan §7)

R1 real hook-event inventory + stdin payloads (SessionStart/Stop/SessionEnd fields; do
PermissionRequest/TaskCreated/TaskCompleted exist at all?); R2 plugin anatomy + local
enable mechanics on Windows (${CLAUDE_PLUGIN_ROOT} quoting); R3 hook timeout/shell contract;
R4 better-sqlite3 win32 prebuilds for Node 24 + pnpm-10 allowlist key; R5 haiku model alias +
stdin content passing; R6 Stop firing frequency. R1–R4 are blocking; all are cheap
(docs + the R4-style scratch-repo empirical recipe already proven in package 2).

## Risks worth the FO's eye

- Package-3 drift is the big one — mitigated by §0 refresh + keeping ship-log's core
  hull-independent (only station.ts + the ship-serve mount are contract-coupled).
- If R1 finds the spec's PermissionRequest/Task* events don't exist, packages 5–6 inherit a
  real design problem (flagged in DECISIONS-NEEDED #4); phase 1 acceptance is unaffected.
- better-sqlite3 native-build failure on this box would need a version pin decision at impl
  time (plan §8.3).

## State

- Branch `ship-wave1-bridge1`: NOT created (correct — Deck still implementing).
- Files written this stage: the plan, the DECISIONS-NEEDED append, this report. Nothing else
  touched. `team-tasks/` untouched. Nothing removed (REMOVALS.md unchanged).
