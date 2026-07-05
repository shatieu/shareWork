---
id: package-0-monorepo-scaffold-plan
---

# Package 0 — Monorepo Scaffold Plan

**Team Lead session.** Branch: `ship-wave1-scaffold` (verified checked out). Status: plan awaiting First Officer approval. No implementation, no installs, no package.json files created yet — this document only.

## Scope (recap, so approval is against the right bar)

Additive-only, in the `shareWork` repo, root level:
- Add `packages/` and `plugins/` directories (empty except a README stub each — see §3).
- Add pnpm workspace + Turborepo config scoped to those two directories only.
- Add a shared base `tsconfig` and a shared Prettier config for future TS packages.
- **Do not touch `team-tasks/` at all** — not its files, not its tooling, not its lockfile.
- Do **not** create `packages/chartroom` or any other suite package/plugin content — that's package 1's job (Chart Room phase 1) and beyond.
- No installs run tonight; `pnpm install` and lockfile generation happen in the build step, after this plan is approved.

## 1. Current repo state (findings)

- No root `package.json` exists today — nothing to conflict with.
- `team-tasks/` is an **npm** project (`package-lock.json`, `node_modules`, its own `eslint.config.mjs` flat config, `tsconfig.json` with `noEmit`/Next.js plugin). It is not, and must not become, a pnpm workspace member. Since pnpm workspace globs will be scoped to `packages/*` and `plugins/*` only, `team-tasks/` (a sibling directory) is naturally excluded — no explicit exclusion needed, but this is the reason the globs must stay narrow and never widen to `*` or `.`.
- Root `.gitignore` currently has no `node_modules`/`.turbo`/build-output entries (team-tasks covers its own via its own `.gitignore`). Root needs these added before any install happens, in the same commit as the workspace config.
- Root `.gitignore` was already modified by an earlier session (added `.vercel`, `.env*`) — confirmed via `git diff main -- .gitignore`; new entries will be appended, nothing duplicated or removed.
- Local toolchain (verified on this machine): Node v24.14.0, npm 11.11.0, corepack 0.34.6 present but **pnpm is not globally installed** (`pnpm --version` → command not found). `npx turbo@latest --version` resolves to 2.10.3, confirming Turborepo v2.x is current.
- `suite-design/overnight/` tracking files (PLAN.md, STATUS.md, DECISIONS-NEEDED.md) already exist from the First Officer's setup — consistent with this being package 0's Team Lead session.

## 2. Researcher findings (commissioned — genuine uncertainty on config schema versions)

I commissioned a Researcher (general-purpose agent, web search against turborepo.dev and pnpm.io) rather than trust training data, because Turborepo changed its config schema between v1 and v2 (a stale-memory risk). Verified facts used below:

1. **turbo.json (v2.x):** top-level key is `tasks` (not the v1 `pipeline`, which is removed from current docs). Minimal shape: `{ "$schema": "https://turborepo.dev/schema.json", "tasks": { "<name>": { "dependsOn": [...], "outputs": [...] } } }`.
2. **packageManager field:** root `package.json` should declare `"packageManager": "pnpm@<version>"` so corepack auto-pins it. Current stable pnpm major reported as 11.x by the researcher (pnpm 10 still supported through ~Apr 2027). **Judgment call:** I'm pinning to `pnpm@10.x` (a version line I can verify more confidently is real and widely deployed) rather than trust an exact 11.x patch number from a single research pass on a fast-moving tool — the build step should run `pnpm -v` after `corepack use` and confirm/adjust the pin before committing the lockfile. Flagging this as a low-risk, trivially-correctable pin.
3. **pnpm-workspace.yaml:** unchanged minimal syntax — `packages:` array of globs. Newer optional features (`catalog`/`catalogs`, `packageConfigs`) exist but are not needed for a bare scaffold.
4. **corepack activation:** `corepack enable pnpm` then `corepack use pnpm@<version>` (or the older `corepack prepare pnpm@<version> --activate`, still works). **Gotcha to log, not act on:** Node has been moving to *not* bundle corepack by default in newer majors (our installed v24.14.0 still ships it; a future contributor on a newer Node major may need `npm install -g corepack` first). Documented in Risks, not a blocker tonight.
5. **turbo invocation:** recommended pattern is `turbo` as a **root devDependency** (pins a team-wide version) invoked via root package.json scripts (`"build": "turbo run build"`), run through `pnpm run build` / `pnpm exec turbo run build`. A global turbo install is optional convenience only, not a substitute.

## 3. Exact files to create

### `/package.json` (new, root)
```json
{
  "name": "sharework-workspace-root",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@10.x",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "format": "prettier --write \"packages/**/*.{ts,tsx,md,json}\" \"plugins/**/*.{ts,tsx,md,json}\""
  },
  "devDependencies": {
    "turbo": "^2.10.3",
    "typescript": "^5",
    "prettier": "^3"
  }
}
```
- `"private": true` — required by pnpm/npm for any workspace root (prevents accidental publish of the root itself).
- `packageManager` pins the pnpm version for corepack; exact patch to be confirmed at install time (see §2.2 judgment call).
- `format` script is scoped to `packages/**` and `plugins/**` only — deliberately excludes `team-tasks/**` and repo-root docs so a future `pnpm format` can never touch them.
- No `"workspaces"` field — pnpm uses `pnpm-workspace.yaml` instead; adding an npm-style `workspaces` array too would be redundant/misleading.

### `/pnpm-workspace.yaml` (new, root)
```yaml
packages:
  - 'packages/*'
  - 'plugins/*'
```
Deliberately narrow globs. Never widen to `*`, `.`, or add `team-tasks` — team-tasks is an npm project with its own lockfile; pnpm would conflict with or shadow it.

### `/turbo.json` (new, root)
```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["build"], "outputs": ["coverage/**"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```
Uses the v2 `tasks` key (confirmed by research, not `pipeline`). Task set covers what Chart Room phase 1 (a CLI/library, no `dev` server yet) and later phases (Fastify daemon `dev`, Vite UI `dev`) will both need without modification.

### `/tsconfig.base.json` (new, root)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true
  }
}
```
Deliberately **not** copied from `team-tasks/tsconfig.json` — that one is Next.js-shaped (`noEmit`, `jsx`, bundler resolution, Next TS plugin), appropriate for an app that never runs `tsc` to emit JS. Chart Room's Node/Fastify/CLI packages need real emitted output, hence `NodeNext`/`declaration: true` instead. When Chart Room's Vite/React UI sub-package arrives (phase 2+), it will extend this base and override `module`/`moduleResolution`/`jsx` locally rather than the base being compromised for both shapes.

### `/.prettierrc.json` (new, root)
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all"
}
```
### `/.prettierignore` (new, root)
```
node_modules
dist
.turbo
coverage
team-tasks/
team-tasks-starter/
suite-design/
*.md
```
(Markdown wholesale-ignored for now since Chart Room itself will own MD formatting semantics later — avoid Prettier fighting Chart Room's own round-trip rules. `team-tasks/` and `team-tasks-starter/` excluded per the "don't touch" constraint even though the root format script already scopes away from them — belt and suspenders.)

### `/.gitignore` (append only — do not touch existing lines)
Append:
```
# pnpm / turborepo workspace (packages/, plugins/)
node_modules/
.turbo/
dist/
coverage/
*.tsbuildinfo
```
Verified against `git diff main -- .gitignore`: existing modifications are only `.vercel` and `.env*`; nothing here duplicates them.

### `/packages/README.md` (new)
```markdown
# packages/

Independently npx-installable Ship suite packages (pnpm workspace members).
First tenant: `packages/chartroom` (Chart Room, phases 1–5 — see
`suite-design/ChartRoom_Spec.md`), added in package 1, not this scaffold.

Each package is self-contained: its own package.json, tsconfig.json
(extends `../../tsconfig.base.json`), src/, README.
```

### `/plugins/README.md` (new)
```markdown
# plugins/

Claude Code plugin-distributed pieces of the suite (Crew, chart-room-skill,
template-packs — see `suite-design/Ship_Spec.md` and `ChartRoom_Spec.md` §5).
Empty for now; populated starting Chart Room phase 5 (agent surface polish)
and Bridge/Wave 2 work.
```

**Decision: no placeholder/dummy package.** `packages/` and `plugins/` get README stubs only, not a fake buildable package. Rationale: a placeholder risks scope creep (First Officer/Reviewer now has to judge a throwaway artifact) and something package 1 would have to delete or restructure around. Turborepo/pnpm both tolerate zero matched workspace packages cleanly (to be confirmed empirically in the test plan below, not assumed) — real end-to-end pipeline proof is deferred honestly to package 1's acceptance criteria, where `packages/chartroom` becomes the first real buildable member.

## 4. Test plan (run in the build step, after approval — not tonight)

1. `corepack enable pnpm` (or `npm install -g corepack@latest` first if the environment lacks it) → `corepack use pnpm@<pinned>` → `pnpm -v` matches the pin (adjust `packageManager` field if the researcher's version guess was off — cheap fix).
2. `pnpm install` at repo root: succeeds, generates `pnpm-lock.yaml`, creates root `node_modules/` (must already be gitignored *before* this runs). `git status` afterward shows **no changes under `team-tasks/`** — this is the hard gate for "team-tasks untouched."
3. `pnpm exec turbo --version` resolves to the pinned turbo version (proves the root devDependency link works, not just a global/npx shim).
4. `pnpm run build` (→ `turbo run build`) with `packages/` and `plugins/` containing only README files: expect a clean **no-op success** (turbo reports 0 matched packages, exit code 0). If turbo errors instead of no-op-ing on an empty workspace, that's a scaffold defect — fix before declaring package 0 done.
5. `pnpm run lint` — same no-op expectation.
6. Re-run `pnpm install` a second time: no diff (idempotency check).
7. Full `git status` / `git diff --stat` review: changed/added paths must be limited to `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `packages/README.md`, `plugins/README.md`, `pnpm-lock.yaml`, plus gitignored `node_modules/`/`.turbo/` — nothing else.

## 5. Definition of done — mapped honestly

| DoD item | How satisfied for package 0 | Caveat |
|---|---|---|
| Builds clean | Test-plan step 4: turbo `build` no-op success | No real code exists yet; this proves wiring, not a real compile. Real proof arrives with package 1. |
| Lint passes | Test-plan step 5: turbo `lint` no-op success | Same caveat — **and** no shared ESLint config is created in this package (see Risks §6.5); this only proves task-graph wiring. |
| Tests pass | N/A — no tests exist yet | Honestly nothing to run; `test` task defined in `turbo.json` for future packages to hook into. |
| Acceptance script | Not applicable to a scaffold-only package (no spec acceptance line targets package 0 directly) | Architecture §3/§6 don't define a package-0-specific acceptance criterion beyond "workspace tooling exists and is additive" — test-plan steps 1–7 serve as its de facto acceptance check. |
| Usage note | This plan doc + the two README stubs serve as the usage note | A short root `README.md` update was considered but **not** included (see Risks §6.6) — flagging as an open call for First Officer. |

## 6. Risks / open judgment calls

1. **pnpm version pin precision** (§2.2): pinned `packageManager` to `pnpm@10.x` rather than trust the researcher's single-pass claim of an 11.x current major; build step must verify/adjust before committing the lockfile. Low risk, trivially correctable.
2. **team-tasks isolation depends on glob discipline**: `pnpm-workspace.yaml` globs must stay exactly `packages/*` / `plugins/*` forever — any future widening (e.g., someone "helpfully" adding `.` or `apps/*`) would pull in the npm-based `team-tasks/` and likely break its lockfile/node_modules. Documented here so future packages don't casually "fix" this.
3. **Node/corepack drift**: current dev machine has Node v24.14.0 with corepack still bundled; per research, newer Node majors (25+) may ship without corepack by default, requiring `npm install -g corepack` first. Not a problem tonight; noted for whoever next bootstraps this repo on a newer Node.
4. **Weak pipeline proof**: with no real package yet, the turbo build/lint "test" is a no-op success, not a true end-to-end proof. This is an accepted, honestly-flagged limitation — real proof is package 1's job (`packages/chartroom` becomes the first buildable/lintable member).
5. **No shared ESLint config in this package** — deliberate scope trim, not an oversight. ESLint flat-config rules are meaningfully different for a Node/Fastify backend vs. a Vite/React UI, both of which live inside Chart Room eventually; writing one shared ruleset now, before any real source exists, risks guessing wrong and having package 1 rework it anyway. Package 1 will add its own `eslint.config.mjs` (flat config, matching the ESLint 9 style already used in `team-tasks/eslint.config.mjs` for stylistic consistency, but package-scoped, not shared/root). `turbo.json`'s `lint` task is ready to receive it with zero changes needed here.
6. **Root README not updated**: repo root already has several loose docs (`Coworking-Platform_Research-and-Architecture.md`, `Ship-vs-Platform_Strategy-and-Verdict.md`, etc.) but no root `README.md` describing the new `packages/`/`plugins/` layout. Left out of this package's file list since it risks touching/reorganizing root-level docs beyond this package's remit; flagging for First Officer — can be added trivially in this package or deferred to package 1 if preferred.
7. **CRLF/LF churn**: `git diff` already warns about LF→CRLF conversion on Windows for existing files (`.gitignore`, `team-tasks/.gitignore`). New files here will be written with the repo's existing line-ending behavior (no `.gitattributes` added) — consistent with how the repo already operates, but flagging in case the Captain wants a `.gitattributes` pass at some point (out of scope for tonight).
8. **`typescript`/`prettier` as root devDependencies**: chosen to avoid version drift across future packages (they all resolve to the root-hoisted versions unless a package pins its own). If a later package needs a different TS version, it can add its own devDependency to override — pnpm allows this per-package.

## 7. Not done in this package (explicitly deferred)

- No `packages/chartroom` or any other suite package/plugin directory contents.
- No shared ESLint config (see Risks §6.5).
- No `pnpm install` run, no `pnpm-lock.yaml` committed — happens in the build step after approval.
- No CI workflow file (not requested by spec §3/§6 for this package; would be premature with no packages to build).
