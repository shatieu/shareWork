# Decisions deferred to the Captain

Format per entry: what, why it's deferred, default taken (if any), how to override.

## Feature branch naming: dashes instead of slashes

- **What:** kickoff prompt specifies feature branches as `ship-wave1/cr-phase-1` (slash-nested under the integration branch name).
- **Why deferred:** git refuses to create a branch nested under an existing branch name (`ship-wave1/scaffold` collides with existing ref `ship-wave1` — refs/heads is a filesystem-like namespace, a name can't be both a file and a directory).
- **Default taken:** feature branches use dashes instead: `ship-wave1-scaffold`, `ship-wave1-cr-phase-1`, `ship-wave1-cr-phase-2`, etc. Same intent (one branch per package, merges into `ship-wave1`), trivially reversible (rename before pushing if the Captain prefers slashes with a differently-named integration branch, e.g. `wave1` instead of `ship-wave1`).
- **Review tomorrow:** confirm naming convention, rename if desired before further work stacks on top.

## Package 1 (Chart Room phase 1) plan review — decisions taken by First Officer

Plan: `suite-design/overnight/plans/01-cr-phase1-plan.md`. Team Lead flagged 4 items in its §12; reviewed and resolved as follows so implementation isn't blocked:

- **Package name `"chartroom"` (unscoped).** Not treated as a guess — it's spec-literal (`ChartRoom_Spec.md` §7/§9 explicitly say `npx chartroom serve`). Approved as-is. Nothing publishes tonight regardless.
- **New dependencies** (`gray-matter`, `unified`, `remark-parse`, `remark-gfm`, `remark-frontmatter`, `unist-util-visit`, `commander`, `ignore` as runtime; `vitest`, `@types/node`, `eslint`, `typescript-eslint` as dev). Ondřej's global rule is "never add dependencies without asking" — but this kickoff prompt is that ask: `ChartRoom_Spec.md` §7 names the remark/unified family explicitly as the stack, and the mission's own Definition of DONE requires working build/lint/test, which requires dev tooling. `gray-matter`, `commander`, and `ignore` aren't spec-named but are small, MIT/permissive, zero-network, zero-telemetry, and trivially removable/replaceable — approved as the conservative low-risk default. **Review tomorrow:** confirm this reasoning holds; swap any of the three non-spec-named packages if you'd rather they were hand-rolled.
- **Monorepo pre-commit hook composability with `team-tasks/`.** Confirmed by direct check: no `.git/hooks/pre-commit` exists yet and `team-tasks/` has no husky/pre-commit config, so there's nothing to collide with tonight. Approved the plan's "refuse to clobber + print manual chaining instructions" approach; no chaining framework built. **Review tomorrow** if `team-tasks/` ever wants its own hook.
- **`fix-links` default write behavior — overridden, not deferred.** Plan proposed `--write` as the implicit default (bare `chartroom fix-links` mutates files). Changed this before implementation: bare `chartroom fix-links` now defaults to the same behavior as `--dry-run` (report only); an explicit `--write` flag is required to mutate. Matches the industry convention (`eslint --fix`, `prettier --write` both require an explicit flag) and the mission's general safety-first posture around file mutation. This is a First Officer correction to the plan, not a Captain-level open question — mentioning here for visibility only.

## Chart Room phase 1 (Developer stage): `.docs/` not yet in any `.gitignore`

- **What:** the index schema (plan §4) and this repo's own `packages/chartroom/src/repo.ts` both
  treat `.docs/index.json` as "gitignored, per-repo" -- `repo.ts`'s doc-discovery walk already
  skips a built-in `.docs` directory name so `chartroom index` never indexes its own output, but
  no actual `.gitignore` entry for `.docs/` exists yet anywhere in this monorepo (checked the root
  `.gitignore` and found no `packages/chartroom/.gitignore` either).
- **Why deferred:** adding a `.gitignore` entry wasn't in the Developer stage's assigned file list
  (plan §3), and this Developer session never ran `chartroom init`/`chartroom index` against the
  real repo tree (only against disposable scratch dirs, per instructions) -- so nothing has
  actually landed in the real working tree as an untracked `.docs/index.json` yet. No urgency, but
  worth fixing before anyone runs `chartroom init` for real in this repo.
- **Default taken:** left as-is; not silently patched by the Developer since touching
  `.gitignore` (root or a new package-scoped one) is a small but real repo-wide change outside this
  package's assigned scope.
- **Review tomorrow:** add `.docs/` to the root `.gitignore` (or a `packages/chartroom/.gitignore`)
  before the first real `chartroom init` run in this repo, so `.docs/index.json` doesn't show up as
  an untracked file / risk getting committed by accident.
- **Resolved same night:** First Officer added `.docs/` to the root `.gitignore` (`4bb3688`) before
  merging phase 1 — no longer open, kept here for the record.

## Package 2 (Chart Room phase 2) plan review — decisions taken by First Officer

Plan: `suite-design/overnight/plans/02-cr-phase2-plan.md`. Team Lead flagged 8 items in its §11; reviewed and resolved as follows so implementation isn't blocked:

- **Two-package split (`packages/chartroom` gains the daemon, new `packages/chartroom-ui` is the React/Vite frontend, its build copied into `chartroom`'s own `dist/public`).** Approved as recommended — matches how CLI-with-embedded-webview tools are commonly structured, keeps `npx chartroom serve` self-contained after publish, needs zero workspace-glob changes. Sets the pattern phases 3-5 will likely extend; flagged for Captain review, not blocking.
- **New dependencies** (`fastify`, `@fastify/static`, `chokidar`, `remark-directive`, `remark-directive-rehype` for the daemon; `react`, `react-dom`, `react-markdown`, `remark-gfm`, `remark-directive`, `remark-directive-rehype`, `rehype-slug` for the UI; `vite`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` as dev). Same reasoning as phase 1: `ChartRoom_Spec.md` §7 names Fastify/chokidar/unified-remark/React+Vite explicitly as the stack; the rest is DoD-required test/build tooling. All verified live against npm today by the Team Lead (not recalled from training data). Approved as proposed, including the **`chokidar ^4.0.3` pin over the newer `^5.0.0`** specifically to avoid silently bumping the repo's `engines.node` floor from `>=20` to `>=20.19` — the safer, lower-risk pick. **Review tomorrow:** confirm this reasoning holds; swap to chokidar v5 + bump engines repo-wide if preferred.
- **Staleness scope — narrow reading approved.** Spec §6/§10 loosely tag "staleness (dashboard)" as phase-2-ish, but the Build Order's literal §8 item 2 acceptance line only asks for "missing-link tombstone display." Approved: phase 2 implements only tombstone display (direct reuse of phase 1's `check.ts`), no `ttl_days`/`sources:` freshness gates or orphan detection. This is a First Officer scope-reading call, not a Captain-level question — matches the precedent of phase 1's fix-links default override (resolving plan ambiguity rather than guessing bigger scope).
- **Mermaid diagram rendering — deferred**, not built this phase. Mentioned in spec §3's general description, absent from the Build Order's literal phase-2 line; cheap to add later as an isolated `components: { code: ... }` override with no architectural knock-on effects.
- **No real-browser smoke test / Playwright — resolved, not deferred.** Rather than adding Playwright as a new dependency for one phase, the First Officer will do a manual real-browser QA pass using the `claude-in-chrome` browser tooling already available in this environment, as part of the adversarial Reviewer step for this package. Approved: automated `.inject()` + jsdom/RTL tests prove the data+render logic; the manual pass proves the actual built bundle boots in a real browser. No new dependency needed.
  - **Actually attempted, could not complete:** the Chrome extension was not connected in this session (`tabs_context_mcp` returned "Browser extension is not connected"), so no real click-through was possible tonight. Substituted the next-best structural proxy: built both packages for real, registered two throwaway repos (sandboxed `HOME`, real `~/.chartroom/repos.json` never touched), created a real tombstone, booted `chartroom serve` in the background, and hit it with live `curl` — confirmed `GET /` returns the real built `index.html` referencing an asset file that actually exists on disk, and `GET /api/repos/:id/docs/:docId` returns the enriched `brokenLinks` (with `deletedAt`) for the tombstoned link. This proves the server/data half end-to-end; it does **not** prove the React app actually renders/hydrates correctly in a live browser (hash routing, TOC scroll-into-view, `:::llm` collapse toggle, dark mode). **Review tomorrow:** do the actual browser click-through once the Chrome extension is connected — specifically switch repos, open the tombstoned-link doc, expand/collapse an `:::llm` block and a section, click a TOC entry.
- **`chartroom register`/no `unregister`.** Approved as minimal — CLI-only registration, no `unregister` command this phase. Trivial to add later if wanted.
- Nothing needing `REMOVALS.md` or touching `team-tasks/` — confirmed by the Team Lead's own design, not by omission (re-verified by First Officer against the plan's actual file list, §3).

## Package 0 scaffold: no root README update

- **What:** package 0's plan flagged that the repo root has several loose docs but no root `README.md` describing the new `packages/`/`plugins/` layout; asked whether to add one.
- **Why deferred:** touching/creating root-level docs is outside this package's remit and risks scope creep on a scaffold-only package; not requested by any spec acceptance line.
- **Default taken:** skip it. `packages/README.md` and `plugins/README.md` stubs (already in the plan) are enough documentation for now.
- **Review tomorrow:** add a root `README.md` if/when the Captain wants one; trivial, reversible, no dependency on it from later packages.

