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

---

# IMPLEMENTATION (2026-07-05, post FO approval)

**Verdict: IMPLEMENTED — 8 commits on `ship-wave1-dogfood`, all gates green, acceptance line proven.**

## Commits (ship-wave1..ship-wave1-dogfood)

- `0441b4c` feat(chartroom): honor .chartroomignore during doc discovery
- `8ed1d74` chore(dogfood): scope chart-room doc discovery for shareWork
- `f5d331f` chore(dogfood): assign chart-room ids to repo docs (chartroom init)
- `eafb12f` feat(dogfood): install chart-room skill; add Chart Room section to CLAUDE.md
- `1fad2cd` chore(dogfood): assign chart-room id to root CLAUDE.md
- `22408e6` test(dogfood): acceptance script + changelog fragment
- `ecd3277` docs(dogfood): record hook-install parking and plan deviations
- (`56c538d` docs(marathon): amend Lookout rule — **FO-authored**, landed on this branch because the
  FO committed in the shared working copy at 13:32:53, seconds after the branch was cut. Docs-only;
  merges up with the package. Flagged for FO awareness, nothing to fix crew-side.)

## What was done, step by step

1. **`.chartroomignore` support** (approved enabling change): `packages/chartroom/src/repo.ts` —
   `loadGitignore()` became `loadIgnoreRules()`, additionally feeding a repo-root `.chartroomignore`
   into the same `ignore` matcher. Zero new deps, zero API change; init/index/check/fix-links/hook/
   daemon all inherit it via `discoverDocFiles`. `runInit` exported from `commands/init.ts` for
   direct testing. New `test/chartroomignore.test.ts` (4 tests): discovery exclusion additive with
   .gitignore; `runInit` leaves excluded file byte-identical + unindexed; `runCheck` doesn't count
   excluded docs; no-file = unchanged behavior. README subsection added. chartroom suite: 181/181.
2. **Root `.chartroomignore`** committed exactly as the FO-approved §4 list (team-tasks/,
   team-tasks-starter/, skill-template/, editor fixtures, .claude/, lookout/, kickoff prompts).
3. **`init --no-hook`** (per FO direction 2 — no `.git/hooks` touch): assigned 49 ids, indexed 49.
   Step-3 audit: `git diff --numstat -- '*.md'` — all 48 tracked md diffs exactly `4 0` (pure
   4-line frontmatter prepends), zero surprises; 49th id went to untracked
   `suite-design/overnight/LESSONS-LEARNED.md` (left uncommitted per R6). team-tasks/*: no md
   touched (exclusion verified live). Editor fixtures untouched (round-trip suite green below).
4. **Id commit staging:** the plan's R2 index-blob partial-staging protocol was NOT needed — the 3
   previously-annotated suite-design files were clean on `ship-wave1` by execution time. Plain
   `git add -u -- '*.md'`; pre-existing dirt (watchdog.log, team-tasks/*) left unstaged/untouched.
5. **Agent surfaces:** `install-skill` OK → `.claude/skills/chart-room/SKILL.md` (verbatim from
   skill-template; committed). Root `CLAUDE.md` created with the README's template section + a
   .chartroomignore note; `check` then correctly flagged CLAUDE.md itself as id-less → `init
   --no-hook` re-run (idempotent, 1 id, `id: sharework`), committed.
   **DEVIATION — `install-agent-hook` blocked:** the session permission system denied writing
   `.claude/hooks/chartroom-post-tool-use.mjs` + `.claude/settings.json` (agent self-modification
   of live agent-loaded config; denied for both the CLI command and a manual file copy). Not worked
   around. Parked in CAPTAIN-TODO.md as a one-line human step
   (`node packages/chartroom/dist/cli.js install-agent-hook`, idempotent); deviation recorded in
   plan §10. The post-merge `.git/hooks/pre-commit` install is also logged in CAPTAIN-TODO.md per
   FO direction.
6. **`chartroom check`:** `chartroom check: clean -- no broken links, missing ids, or duplicate ids
   found.` Exit 0. **`chartroom register`:** `registered 'sharework' -> C:\thisismydesign\shareWork`
   (machine-local `~/.chartroom/repos.json`, left registered on purpose — that IS the dogfood).

## Acceptance evidence (`packages/chartroom/acceptance/dogfood-sharework.mjs`, exit 0)

```
step 1 OK: check clean; 8 changelog entries id-keyed in raw index.json
step 2 OK: git mv self-heals -- 'product-suite-research-synthesis-july-2026' resolved at both paths, index followed
step 3 OK: changelog directory renders via daemon routes (8 entries; sampled 'package-0-monorepo-scaffold')
chartroom acceptance: dogfood-sharework -- ALL ASSERTIONS PASSED
```

- Step 2 = the acceptance line's first half: `git mv suite-design/Product-Suite_Research-Synthesis.md`
  → `chartroom resolve <id>` returns the NEW path (matchType `id`) AND the raw `.docs/index.json`
  contains the new path; moved back, resolves to the original. Net-zero: `git status` on the file
  is clean. **Two `git mv`s executed and reverted, recorded here per crew rules.**
- Step 3 = second half: real daemon `buildServer` + `app.inject()` — `/api/repos` lists sharework,
  `/api/repos/sharework/docs` carries all 8 changelog entries id-keyed, and a sampled entry's
  detail route returns 200 with its raw content (same evidence pattern as phases 2–5 precedent;
  no real-browser pass — consistent with the mission-wide known gap).

## Gates

- `pnpm turbo run build lint test`: **6/6 tasks successful** — chartroom build+lint+test (25 files,
  181 tests) and chartroom-ui build+lint+test (15 files, 139 tests). The editor round-trip fixture
  suite passing post-init is the canary that fixtures were never touched.

## Remaining working-tree state (deliberate, not ours)

- `suite-design/overnight/watchdog.log`, `team-tasks/*` modifications, untracked FO/session files
  (`.claude/agents/first-officer.md`, `.claude/skills/lookout/`, `suite-design/Chart Room.html`,
  `suite-design/overnight/LESSONS-LEARNED.md` (id injected, uncommitted), `usage.json`) — all
  pre-existing, all left alone.

## Open items for FO

1. Merge gate: independent wave-reviewer pass, then FO merge (crew never merges).
2. Post-merge: `chartroom init` once on `ship-wave1` (installs pre-commit hook; CAPTAIN-TODO.md).
3. Human step: `install-agent-hook` (permission-blocked for agents; CAPTAIN-TODO.md).
4. Note `56c538d` (FO's own Lookout-rule commit) rides along on this branch.
