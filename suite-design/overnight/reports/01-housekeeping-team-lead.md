---
id: team-lead-report-package-01-housekeeping-dogfood-planning-phase
---

# Team Lead report — Package 01-housekeeping-dogfood (PLANNING phase)

**Verdict: PLAN READY** — `suite-design/overnight/plans/01-housekeeping-dogfood-plan.md`. No code written, no commits made, no files mutated other than this report + the plan file (both mission tracking artifacts). Planning-only dispatch honored.

## What was investigated (all claims verified against local source, none from memory)

- Role + mission context: `.claude/agents/wave-team-lead.md`, `suite-design/overnight/MISSION-CONTEXT.md`.
- Spec sections: `suite-design/ChartRoom_Spec.md` §2.1/§2.3/§2.5 (init, id, index, repair), §5 (agent surface), §8 phases 1 & 5 acceptance lines.
- Prior art read end-to-end: `suite-design/overnight/MORNING-REPORT.md` (esp. §4.2 — dogfooding was explicitly parked for the Captain; this package is that step, now queued in PLAN.md package 1).
- Chart Room source actually read (not assumed):
  - `packages/chartroom/src/commands/init.ts` — init walks the WHOLE git root; `--no-hook` option exists.
  - `packages/chartroom/src/repo.ts` — `discoverDocFiles()` honors only built-in skip dirs + root `.gitignore`; **no exclusion mechanism exists** (grep for exclude/config/scope over `src/` returned nothing relevant).
  - `packages/chartroom/src/check.ts` — `check` counts missing ids over the same repo-wide walk → scoping init alone can't produce a clean check.
  - `packages/chartroom/src/frontmatter.ts` — `injectId` prepends exactly `---\nid: <id>\n---\n\n` on no-frontmatter docs; surgical, idempotent.
  - `packages/chartroom/src/hook.ts` — pre-commit hook logic; index-blob technique (`hash-object` + `update-index --cacheinfo`) reused in the plan for partial staging.
  - `packages/chartroom/src/install-hook.ts`, `install-agent-hook.ts`, `install-skill.ts`, `commands/install-skill.ts`, `commands/register.ts`, `commands/serve.ts` (default port 4317), `hook-template/chartroom-post-tool-use.mjs` (PostToolUseFailure, fail-open), `packages/chartroom/README.md` (CLAUDE.md template line — manual copy, no installer command).
  - Daemon routes for the acceptance curl surface: `GET /api/repos`, `GET /api/repos/:repoId/docs`, `GET /api/repos/:repoId/docs/:docId` (`src/daemon/routes/docs.ts`, `repos.ts`).

## Key findings that shaped the plan

1. **Blocking gap:** running `chartroom init` as-is would inject frontmatter into `team-tasks/*.md` (hard-constraint violation), the 20 byte-exact editor round-trip fixtures (`packages/chartroom-ui/test/editor/fixtures/`, incl. `frontmatter-absent.md` — suite-breaking by design), the shipped `skill-template/` (id would propagate to consuming repos), `.claude/` agent/skill definitions, and `team-tasks-starter/`. Plan proposes a minimal enabling change: `.chartroomignore` (gitignore syntax) read by `discoverDocFiles()` — one function, zero new deps, fixes init/index/check/fix-links/hook/daemon uniformly. Needs FO approval.
2. **Working tree is live-dirty:** `suite-design/Ship_Spec.md`, `Suite-Architecture_and_Website_Spec.md`, `Trio_Specs.md` carry the Captain's uncommitted annotations (confirmed via `git status --porcelain '*.md'`). Plan stages ONLY the 4 frontmatter lines for these via the index-blob technique from `hook.ts`; annotations never staged, never stashed.
3. **`.git/hooks/pre-commit` is working-copy-global:** installing it mid-package would mutate FO commits on `ship-wave1` before the id commit merges (divergent ids). Plan: `init --no-hook` now; FO runs idempotent `init` once post-merge to install the hook.
4. **Lookout safety:** `suite-design/lookout/` fully excluded in `.chartroomignore`; `lookout/state/` already gitignored (discovery skips it inherently). Zero-touch by construction. Kickoff-prompt files (pasted verbatim) also excluded.
5. Docs currently carrying frontmatter: none in scope (verified by `head -5` sweep) → every diff is exactly a 4-line prepend; step-3 audit gates on that. In-scope tracked docs: 41; 3 untracked FO reports get working-tree ids but are not staged. `.docs/` already gitignored (root `.gitignore`). No root `CLAUDE.md` and no `.claude/settings.json` exist today → both created fresh, nothing clobbered.
6. Changelog directory (`suite-design/overnight/changelog/entries/` — 8 entries) stays in scope so it lands in the index → the viewer half of the acceptance line is demonstrable via daemon API (+ real browser as non-gating stretch, consistent with the mission-wide known no-Chrome gap).

## Open questions for the FO (blocking implementation start)

1. Approve the `.chartroomignore` enabling change in `packages/chartroom` (plan §2–3) and the exclusion list (plan §4)?
2. Approve deferring `.git/hooks/pre-commit` installation to a post-merge FO step (plan §5/R3)?
3. Confirm the other halves of PLAN.md package 1 ("reconcile git vs tracking, push policy") stay outside this dispatch.

No Captain-only decisions parked; nothing added to DECISIONS-NEEDED.md (dogfood go-ahead is taken as given by the dispatch itself — flag if that reading is wrong).

## Files touched by this planning session

- `suite-design/overnight/plans/01-housekeeping-dogfood-plan.md` (new — the plan)
- `suite-design/overnight/reports/01-housekeeping-team-lead.md` (this file)
