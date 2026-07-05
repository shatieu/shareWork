# 00-charter — Researcher report (dry-run)

Date: 2026-07-05
Researcher: wave-researcher
Questions: Fastify latest npm version + Node 20 support; Fastify version installed in `packages/chartroom`.

## Q1: Latest published Fastify on npm; Node 20+ support

**Answer: `fastify@5.10.0` is the latest published version, and Fastify 5.x officially supports Node.js 20 and 22.**

Evidence:

1. npm registry, dist-tag `latest` — fetched 2026-07-05 from
   `https://registry.npmjs.org/fastify/latest`:
   - `"version": "5.10.0"`
   - No `engines` field is present in the published package metadata (so npm/pnpm will
     not hard-block installs on older Node; the support statement is documentation-level).
2. Fastify official LTS reference — fetched 2026-07-05 from
   `https://fastify.dev/docs/latest/Reference/LTS/`:
   - Support table row for Fastify 5.0.0 (released 2024-09-17): "Node.js: 20, 22",
     End of LTS: TBD.
3. Fastify GitHub README (`main` branch = v5 line) confirms `main` tracks v5 but defers
   Node version specifics to the LTS doc above.

Caveats:
- "Latest" reflects the registry `latest` dist-tag at fetch time (2026-07-05).
- The LTS table names 20 and 22 explicitly; newer Node lines (e.g. 24) were not listed
  on the fetched page — unverified, but Node >=20 is clearly supported.

## Q2: Fastify version installed in `packages/chartroom`

**Answer: declared `"fastify": "^5.9.0"`; actually installed `5.9.0`.**

Evidence (empirical, inspected 2026-07-05):

1. `C:\thisismydesign\shareWork\packages\chartroom\package.json` — `dependencies`
   include `"fastify": "^5.9.0"` (plus `"@fastify/static": "^9.1.3"`).
2. Installed copy read directly from
   `packages/chartroom/node_modules/fastify/package.json` via
   `node -e "console.log(require(...).version)"` → output: `5.9.0`.
3. The installed fastify `package.json` contains no `engines` field (grep for
   `"engines"` returned no matches), consistent with the registry metadata for 5.x.

Adjacent note (one line): the repo's own `engines` gate is `"node": ">=20"` in
`packages/chartroom/package.json`, matching Fastify 5.x's supported range.
