---
id: plan-package-01-housekeeping-dogfood-chart-room-onto-sharework-itself
---

# Plan — Package 01-housekeeping-dogfood (Chart Room onto shareWork itself)

**Team Lead plan, PLANNING ONLY. No code written yet. Feature branch (on approval): `ship-wave1-dogfood`.**
**Spec:** `suite-design/ChartRoom_Spec.md` §2.1 (`init`, `id:`), §2.3 (index), §2.5 (repair), §5 + build-order 8.5 (hook/skill surfaces), §8 phase-1 acceptance ("`git mv` a doc → agent resolves it via CLI and via raw index Read").
**Prior art:** Chart Room v1, all 5 phases merged on `ship-wave1` (`suite-design/overnight/MORNING-REPORT.md`); this package executes exactly the deferred dogfood step MORNING-REPORT §4.2 parked for the Captain, now dispatched via the PLAN.md queue (package 1).

---

## 1. Scope

(a) `chartroom init` run against THIS repo → `.docs/index.json` (already gitignored, root `.gitignore` last stanza).
(b) `id:` frontmatter across `suite-design/*.md` and the repo's other managed docs (see §4 scope table).
(c) Agent surfaces installed into this repo's `.claude/`: `chart-room` skill + `PostToolUseFailure` hook (+ root `CLAUDE.md` Chart Room section, the spec §5 template line from `packages/chartroom/README.md`).
(d) `chartroom check` exits 0, clean.
Acceptance line: **"a `git mv` of a suite-design doc self-heals; the changelog directory renders in the viewer."**

**Out of scope:** the other halves of PLAN.md package 1 ("reconcile git vs tracking, push policy") — FO-level, not in this dispatch. Converting existing doc links to id-carrying format (`fix-links` sweep) — not required by the acceptance line; ids-only. Staleness rules (spec §6, phase 2). Any edit under `team-tasks/`. Any push.

## 2. The one blocking gap found while planning (needs a small enabling code change)

`chartroom init/index/check` and the pre-commit hook all discover docs via `discoverDocFiles()` (`packages/chartroom/src/repo.ts`), which walks the **whole git repo**, skipping only built-in dirs (`.git`, `node_modules`, `.turbo`, `dist`, `coverage`, `.docs`) and the root `.gitignore`. There is **no exclusion/config mechanism** (verified by grep: no `exclude`/config support anywhere in `packages/chartroom/src`). Run as-is, `init` would inject frontmatter into:

- `team-tasks/*.md` (2 files) — **violates the untouchable-dir hard constraint**;
- `packages/chartroom-ui/test/editor/fixtures/*.md` (20 files) — the byte-exact round-trip fixtures; injecting frontmatter breaks the editor test suite by design (`frontmatter-absent.md` exists specifically to assert absence);
- `packages/chartroom/skill-template/chart-room/SKILL.md` — the shipped template; an injected `id:` would propagate into every consuming repo;
- `.claude/agents/*.md`, `.claude/skills/ask-human/*` — live crew/agent definitions mid-mission;
- `team-tasks-starter/**` — starter-kit content meant to be copied verbatim elsewhere;
- the Captain's kickoff-prompt files (pasted verbatim into terminals).

And `chartroom check` counts missing ids over the same walk, so scoping `init` alone is not enough — **discovery itself must honor exclusions**, uniformly for init/index/check/fix-links/hook/daemon.

**Enabling change (needs FO approval as part of this plan):** teach `discoverDocFiles()` to also read a repo-root **`.chartroomignore`** (gitignore syntax, same `ignore` package instance the `.gitignore` already feeds — ~6 lines in `repo.ts:loadGitignore`, zero new dependencies, zero API change). Every consumer inherits it automatically because they all funnel through `discoverDocFiles`. Alternatives rejected: adding `team-tasks/` to `.gitignore` (would make git silently ignore *new* files in the Captain's app — a landmine); an `--exclude` CLI flag (fixes `init` but leaves `check`/hook/daemon inconsistent).

## 3. File-level design

| File | Change |
|---|---|
| `packages/chartroom/src/repo.ts` | `loadGitignore()` → also `ig.add()` the contents of `<repoRoot>/.chartroomignore` if present. Rename local helper comment accordingly. |
| `packages/chartroom/test/chartroomignore.test.ts` (new) | Scratch-repo tests: pattern excludes from discovery; `runInit` leaves excluded file byte-identical & unindexed; `runCheck` doesn't count excluded docs as missing ids; no `.chartroomignore` present → behavior unchanged. |
| `packages/chartroom/README.md` | Short `.chartroomignore` subsection under the indexing docs. |
| `.chartroomignore` (new, repo root, committed) | See §4. |
| ~44 `*.md` docs repo-wide | 4 lines prepended each: `---` / `id: <generated>` / `---` / blank (`injectId` on no-frontmatter docs; verified: no in-scope doc currently has frontmatter). No other bytes change — `injectId` is surgical (`packages/chartroom/src/frontmatter.ts`). |
| `.claude/skills/chart-room/SKILL.md` (new) | Installed verbatim from `skill-template/` by `chartroom install-skill`. |
| `.claude/hooks/chartroom-post-tool-use.mjs` (new) + `.claude/settings.json` (new) | Installed/merged by `chartroom install-agent-hook` (`PostToolUseFailure`/`Read` entry). No `.claude/settings.json` exists today, so it's created fresh — nothing to clobber. |
| `CLAUDE.md` (new, repo root) | The "Chart Room (managed markdown docs)" section, copied from `packages/chartroom/README.md` ("CLAUDE.md template line"). |
| `packages/chartroom/acceptance/dogfood-sharework.mjs` (new) | Acceptance script, §6. |
| `suite-design/overnight/changelog/entries/2026-07-05--dogfood.md` (new) | Changelog fragment. |
| `.git/hooks/pre-commit` | **Deliberately NOT installed during this package** — see §7 risk R3. Post-merge FO step. |

### 4. `.chartroomignore` contents (proposed)

```
# Captain's app -- mission hard constraint: never touched
team-tasks/
# starter-kit + template content copied verbatim into other repos
team-tasks-starter/
packages/chartroom/skill-template/
# byte-exact editor round-trip fixtures -- frontmatter injection would invalidate the suite
packages/chartroom-ui/test/editor/fixtures/
# Claude Code config files (agents/skills/plans), not managed docs
.claude/
# the Lookout -- zero-touch guarantee for the live mission sensor
suite-design/lookout/
# session kickoff prompts -- pasted verbatim into terminals
suite-design/*KICKOFF*.md
suite-design/LOOKOUT-BUILD-PROMPT.md
```

Everything else gets an id: all 8 `suite-design/*.md` specs/synthesis docs, `suite-design/overnight/**` (tracking files, plans, reports, **changelog entries** — required in the index for the viewer half of the acceptance line), root-level docs (`Coworking-Platform…`, `Ship-vs-Platform…`, `Staleness-Linters…`, `TeamTasks_*`), `docs/superpowers/**`, `packages/*/README.md`, `plugins/README.md`. Tracked in-scope count: **41**; plus 3 currently-untracked FO reports under `overnight/reports/` get ids in the working tree but are **not staged by us** (not ours to commit). Exact counts recorded in the report at run time.

## 5. Execution steps (exact commands, in order — all from repo root)

0. Preconditions: `git status` matches expectations (see R2 dirty-file list); `pnpm turbo run build lint test` green on fresh `ship-wave1`. Then `git checkout -b ship-wave1-dogfood ship-wave1`.
1. Implement `.chartroomignore` support + tests; `pnpm --filter chartroom build && pnpm --filter chartroom test`. Commit: `feat(chartroom): honor .chartroomignore during doc discovery`.
2. Add root `.chartroomignore` (§4). Commit: `chore(dogfood): scope chart-room doc discovery for shareWork`.
3. `node packages/chartroom/dist/cli.js init --no-hook` (note: `--no-hook` is load-bearing, R3). Immediately audit: `git status --porcelain`, `git diff --stat` — every touched file must be in the §4 scope set and every diff must be exactly a 4-line frontmatter prepend. Any surprise → `git restore` the surprise files, stop, report to FO.
4. Stage & commit ids — **partial-staging protocol for the 3 pre-dirty files (R2):** `suite-design/Ship_Spec.md`, `suite-design/Suite-Architecture_and_Website_Spec.md`, `suite-design/Trio_Specs.md` carry the Captain's own uncommitted annotations. For each: build `injectId(HEAD-content)` = first-4-lines-of-working-file + `git show :<path>`, then `git hash-object -w --stdin` + `git update-index --cacheinfo 100644 <sha> <path>` (the exact index-blob technique `src/hook.ts` already uses). `git add` everything else in scope. Verify: `git diff <the 3 files>` still shows only the Captain's annotations, unstaged. Commit: `chore(dogfood): assign chart-room ids to repo docs (chartroom init)` — the spec §2.1 "one deliberate commit".
5. `node packages/chartroom/dist/cli.js install-skill` and `… install-agent-hook`. Commit: `feat(dogfood): install chart-room skill and PostToolUseFailure hook`.
6. Create root `CLAUDE.md` with the template section. Commit: `docs(dogfood): add Chart Room section to CLAUDE.md`.
7. `node packages/chartroom/dist/cli.js check` → must print clean, exit 0 (capture output for the report).
8. `node packages/chartroom/dist/cli.js register` (writes `~/.chartroom/repos.json`, machine-local — left registered on purpose: that IS the dogfood).
9. Write + run `packages/chartroom/acceptance/dogfood-sharework.mjs` (§6). Commit script + changelog fragment + report: `test(dogfood): acceptance script + changelog fragment`.
10. Full monorepo gate: `pnpm turbo run build lint test` green (proves fixtures untouched — the round-trip suite is the canary). Report to FO for independent review.

**Post-merge FO step (not in this package's commits):** on `ship-wave1` after merge, run `node packages/chartroom/dist/cli.js init` once — idempotent (0 new ids), installs the `.git/hooks/pre-commit` shim at the moment the branch's ids are the single truth (R3). From then on, every commit self-heals ids/links — the ongoing mission becomes the live test bed.

## 6. Acceptance script (`dogfood-sharework.mjs`) — how the acceptance line is demonstrated

Runs against THIS repo root; every mutation is restored in a `finally`; exits non-zero on any failed check:
1. `check` exits 0; `.docs/index.json` parses; all 8 `suite-design/overnight/changelog/entries/*.md` present in `docs` with ids (raw-Read proof, spec's north star).
2. **git mv self-heal:** record id of `suite-design/Product-Suite_Research-Synthesis.md` (clean file, no pre-existing dirt) → `git mv` it to `suite-design/Product-Suite_Research-Synthesis.tmp-moved.md` → `chartroom resolve <id>` returns the NEW path (matchType `id`) AND plain grep of `.docs/index.json` shows the new path → `git mv` back → resolve returns the original path again. Net-zero; both `git mv`s recorded in the report per crew rules.
3. **Changelog renders in the viewer:** boot the daemon server in-process (same pattern as `acceptance/two-repo-browse.mjs`) on an ephemeral port → `GET /api/repos` lists shareWork → `GET /api/repos/:id/docs` includes the changelog entries → `GET /api/repos/:id/docs/<changelog-entry-id>` returns 200 with the entry's content. Stretch (not gating, honest about the mission-wide known gap): if the Chrome extension is available, one real-browser look at the changelog entry via `chartroom serve` (default port 4317); otherwise daemon+API evidence stands, consistent with phases 2–5 precedent.

## 7. Risks (this is the live mission repo) & mitigations

- **R1 — Repo-wide `init` blast radius** (team-tasks, fixtures, templates, `.claude/`, Lookout): eliminated structurally by `.chartroomignore` *before* init ever runs, plus the step-3 diff audit as a second gate, plus the step-10 full-suite gate (fixtures are the canary). Lookout: `suite-design/lookout/` fully excluded; `lookout/state/` was already gitignored (discovery skips it inherently); `lookout.ps1` is not markdown. Zero-touch guaranteed.
- **R2 — Captain's uncommitted annotations** in 3 tracked suite-design files (+ modified `team-tasks/*` files, which we never touch, + `OVERNIGHT-KICKOFF-PROMPT.md`, excluded anyway): never staged wholesale; index-blob partial staging (§5.4) commits ONLY the 4 frontmatter lines; working-tree annotations remain exactly where the Captain left them. No stash (a conflicting `stash pop` on the live repo is an unacceptable failure mode).
- **R3 — `.git/hooks/pre-commit` is working-copy-global, not branch-scoped.** Installed mid-package it would fire on every FO commit on `ship-wave1` *before* the id commit merges, injecting divergent ids into tracking files outside any package. Mitigation: `init --no-hook`; hook install deferred to the post-merge FO step. (Lazy-normalization behavior itself is already covered by phase-1's merged tests + `git-mv-resolution.mjs`; not re-proven here.)
- **R4 — Merge-conflict window on tracking files:** FO appends to `STATUS.md`/`PLAN.md` on `ship-wave1` while this branch prepends frontmatter. Disjoint hunks (top vs bottom) auto-merge, but keep the package short-lived and merge promptly.
- **R5 — Agent hook goes live for the ongoing mission** the moment `.claude/settings.json` merges: fires on every failed `Read`, prints resolve guidance. It's fail-open (per the shipped script's own design) and this exposure is the point of dogfooding. Known residual honesty note (from the template header): the `PostToolUseFailure` payload's error-field shape is undocumented; script degrades gracefully. No researcher pass needed — all facts in this plan were verified against local source, none from memory.
- **R6 — Untracked files get ids** (3 FO charter reports): working-tree-only edits to untracked files; left uncommitted; reversible by removing the 4-line block (a content revert, not a file deletion).
- **R7 — id collisions/duplicates:** `generateId` dedupes against the full existing-id set (verified in `commands/init.ts`); `check` (step 7) gates on `duplicateIds` anyway.

## 8. Rollback notes

- **Before merge:** the branch is the rollback — FO declines to merge; nothing on `ship-wave1` changed. Working tree: tracked changes live only in branch commits; the 3 partial-staged files' unstaged annotations are untouched by construction; untracked charter reports → remove the injected 4-line frontmatter block to restore (record in report).
- **After merge:** `git revert` the id commit + surface commits (clean reverts; frontmatter hunks are isolated). `.docs/index.json` is gitignored — stale copies are inert and rebuilt on next run.
- **Machine-local state:** `~/.chartroom/repos.json` — remove the shareWork entry by hand (no `unregister` command exists). `.git/hooks/pre-commit` (only exists post-merge, FO-installed) — untracked machine-local file; disabling it is a Captain/FO call (overwrite with a no-op shim; the chartroom shim is marker-identified).
- **Mid-step failure in `init`:** step-3 audit catches it pre-commit; `git restore` the affected working files (restoring content ≠ deleting files).

## 9. Decisions & flags

- **Captain-only:** none new. The dogfood go-ahead itself (MORNING-REPORT §4.2) is taken as given by this package's presence in the PLAN.md queue and this dispatch. Nothing added to DECISIONS-NEEDED.md.
- **FO approval needed for:** the `.chartroomignore` enabling change (§2–3, new product behavior in `packages/chartroom`), the §4 exclusion list (scope of which docs get ids), and the R3 post-merge hook-install step becoming an FO action.
- Estimated size: ~6 commits, one small src change + tests, one repo-wide mechanical frontmatter commit.
