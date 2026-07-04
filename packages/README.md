# packages/

Independently npx-installable Ship suite packages (pnpm workspace members).
First tenant: `packages/chartroom` (Chart Room, phases 1–5 — see
`suite-design/ChartRoom_Spec.md`), added in package 1, not this scaffold.

Each package is self-contained: its own package.json, tsconfig.json
(extends `../../tsconfig.base.json`), src/, README.
