# Package 0 — Monorepo Scaffold

Added a pnpm workspace + Turborepo v2 scaffold at the repo root (`package.json`,
`pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.prettierrc.json`,
`.prettierignore`, `pnpm-lock.yaml`), scoped only to `packages/*` and
`plugins/*` (currently README stubs). Purely additive groundwork for Wave 1
suite packages (Chart Room and beyond); `team-tasks/` (npm project) was not
touched. `packageManager` pin corrected to the actual resolved `pnpm@10.34.4`
after install.
