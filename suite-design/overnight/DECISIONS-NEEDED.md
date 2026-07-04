# Decisions deferred to the Captain

Format per entry: what, why it's deferred, default taken (if any), how to override.

## Feature branch naming: dashes instead of slashes

- **What:** kickoff prompt specifies feature branches as `ship-wave1/cr-phase-1` (slash-nested under the integration branch name).
- **Why deferred:** git refuses to create a branch nested under an existing branch name (`ship-wave1/scaffold` collides with existing ref `ship-wave1` — refs/heads is a filesystem-like namespace, a name can't be both a file and a directory).
- **Default taken:** feature branches use dashes instead: `ship-wave1-scaffold`, `ship-wave1-cr-phase-1`, `ship-wave1-cr-phase-2`, etc. Same intent (one branch per package, merges into `ship-wave1`), trivially reversible (rename before pushing if the Captain prefers slashes with a differently-named integration branch, e.g. `wave1` instead of `ship-wave1`).
- **Review tomorrow:** confirm naming convention, rename if desired before further work stacks on top.

## Package 0 scaffold: no root README update

- **What:** package 0's plan flagged that the repo root has several loose docs but no root `README.md` describing the new `packages/`/`plugins/` layout; asked whether to add one.
- **Why deferred:** touching/creating root-level docs is outside this package's remit and risks scope creep on a scaffold-only package; not requested by any spec acceptance line.
- **Default taken:** skip it. `packages/README.md` and `plugins/README.md` stubs (already in the plan) are enough documentation for now.
- **Review tomorrow:** add a root `README.md` if/when the Captain wants one; trivial, reversible, no dependency on it from later packages.

