# Overnight Master Plan — Wave 1

Source of truth: `suite-design/Suite-Architecture_and_Website_Spec.md`, `suite-design/ChartRoom_Spec.md`.
First Officer session started 2026-07-05 ~00:30. Attempt #1 (per watchdog.log), fresh start — no prior STATUS.md existed.

## Scope decision for tonight
Per kickoff prompt: stay in the `shareWork` repo (no migration to a fresh `ship/` repo, no `apps/harbor` move tonight — that's future work per the architecture spec §3 migration note). Add `packages/` and `plugins/` at repo root, additive only. `team-tasks/` untouched.

## Package sequence (strict, one at a time)

| # | Package | Spec ref | Status |
|---|---|---|---|
| 0 | Monorepo scaffold (pnpm workspaces + turborepo, shared tsconfig/lint) | Architecture §3 | pending |
| 1 | Chart Room phase 1 — Indexer + CLI + resolution + pre-commit hook | ChartRoom_Spec §8.1 | pending |
| 2 | Chart Room phase 2 — Viewer (read-only) | ChartRoom_Spec §8.2 | pending |
| 3 | Chart Room phase 3 — Editor (Milkdown round-trip) | ChartRoom_Spec §8.3 | pending |
| 4 | Chart Room phase 4 — Interactive blocks + inbox | ChartRoom_Spec §8.4 | pending |
| 5 | Chart Room phase 5 — Agent surface polish (MCP, skill, hook, llms-txt) | ChartRoom_Spec §8.5 | pending |
| 6 | (only if capacity) Bridge phase 1 — plugin skeleton + http hooks + changelog capture | Ship_Spec §9 | not started |
| 7 | (only if capacity) Bridge phase 2 — ledger + MCP | Ship_Spec §9 | not started |
| 8 | (only if capacity) Settings manager simulator (read-only core) | Trio_Specs §B | not started |

Never start package N+1 before N is Reviewer-PASS and merged to `ship-wave1`.

## Process per package (non-negotiable)
1. Team Lead (spawned alone) reads spec + current code, commissions Researcher if needed, writes plan to `suite-design/overnight/plans/<package-slug>-plan.md`. No developer yet.
2. Lead submits plan to First Officer (me). I challenge/approve or send back. Recorded in STATUS.md.
3. Only on approval: Lead dispatches Developers (parallel only if non-overlapping files), integrates.
4. Lead hands to Reviewer/Critic (adversarial): checks diff vs spec+plan, runs build/tests/acceptance script, explicit PASS/FAIL.
5. Lead reports verdict to me. Accept only on PASS. Merge feature branch → `ship-wave1`. Changelog fragment written.

## Git
- Integration branch: `ship-wave1` (created from main HEAD at start of session).
- Feature branch per package: `ship-wave1/<package-slug>`.
- Push `ship-wave1` after every accepted package (remote `origin` exists — confirmed via `git branch -a`).

## Current position
Setting up branch + package 0 (scaffold) Team Lead now.
