---
id: chartroom-ui
---

# chartroom-ui

Chart Room phase 2's read-only viewer frontend (React + Vite). This package is **private and
build-only** -- it is never published to npm and never `npx`-installed on its own.

## How it's consumed

`packages/chartroom` (the CLI/daemon package) depends on this package as a `workspace:*`
devDependency purely for build ordering. `chartroom`'s own `build` script runs `tsc` and then
`scripts/copy-ui-dist.mjs`, which copies this package's built `dist/` into
`packages/chartroom/dist/public/`. That's how `npx chartroom serve` ends up serving a real UI from
a bare `npm install chartroom` with no sibling monorepo packages present -- the compiled static
assets physically live inside `chartroom`'s own published `dist/`.

## Local development

```bash
# from packages/chartroom-ui
npm run dev     # Vite dev server, proxies /api/* to a running `chartroom serve` daemon
npm run build   # tsc --noEmit type-check, then `vite build` -> dist/
npm test        # vitest run (jsdom + React Testing Library)
npm run lint    # eslint .
```

The dev server proxies `/api/*` requests to `http://127.0.0.1:4317` by default (the daemon's
default port -- see `packages/chartroom/src/commands/serve.ts`). Override with the
`CHARTROOM_DAEMON_PORT` env var if your daemon is running elsewhere.

## Notable design choices (see the phase-2 plan for full rationale)

- **No client-side router.** Navigation is hash-based (`#/repo/<repoId>/doc/<docId>`), via
  `useSyncExternalStore` on `hashchange`. This is enough for a single-page repo-switcher + doc-view
  app and sidesteps any SPA-fallback config on the daemon side.
- **`tsconfig.json` does not extend the repo's root `tsconfig.base.json`.** That base config is
  Node-oriented (`module`/`moduleResolution: NodeNext`), incompatible with Vite's expected
  `moduleResolution: bundler` + DOM lib + `jsx: react-jsx` app config.
- **No cross-package imports from `packages/chartroom`.** A few small pieces of logic (frontmatter
  stripping, heading extraction) are deliberately duplicated in miniature here rather than
  importing `chartroom`'s internals, to keep the UI->CLI dependency direction backwards-free and
  avoid `chartroom` needing a public export map it doesn't have.
- **Read-only, end to end.** This package never writes to any doc file -- it only renders what the
  daemon's `/api/*` endpoints serve.
