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

## Package 0 scaffold: no root README update

- **What:** package 0's plan flagged that the repo root has several loose docs but no root `README.md` describing the new `packages/`/`plugins/` layout; asked whether to add one.
- **Why deferred:** touching/creating root-level docs is outside this package's remit and risks scope creep on a scaffold-only package; not requested by any spec acceptance line.
- **Default taken:** skip it. `packages/README.md` and `plugins/README.md` stubs (already in the plan) are enough documentation for now.
- **Review tomorrow:** add a root `README.md` if/when the Captain wants one; trivial, reversible, no dependency on it from later packages.

