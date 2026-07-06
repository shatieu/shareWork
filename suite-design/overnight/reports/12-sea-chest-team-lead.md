---
id: package-12-sea-chest-locker-spec-phases-1-3-team-lead-evidence-report
---

# Package 12 — Sea Chest (Locker_Spec phases 1–3) — Team Lead evidence report

**Verdict: IMPLEMENTED, self-verification green.** 4 commits on `ship-wave1-seachest`
(f8b76c5 → f2e823c), built in the isolated worktree
`<scratchpad>/wt-seachest` off `ship-wave1` @ 78a1fbd. Working tree clean; branch touches ONLY
`packages/sea-chest/**`, `pnpm-lock.yaml`, and the changelog fragment (45 files, +5242).
Combined mode per wrap-up order: plan `plans/12-sea-chest-plan.md` (with §8 deviations recorded),
implementation immediately after.

## What shipped (all code-complete to the seam; zero live-platform contact)

New workspace package `packages/sea-chest`:

- **Store seam** (`src/store.ts`, `src/supabase-store.ts`): `SeaChestStore` interface;
  `MemorySeaChestStore` (full-fidelity local mock) + `SupabaseSeaChestStore` over a *structural*
  PostgREST client interface — no supabase-js dependency; Harbor passes its own client. Version
  bump on content change, `unchanged` on identical re-push (canonical-JSON equality),
  kind-mismatch typed errors, optimistic concurrency (version-guarded update → typed `conflict`),
  23505 insert-race fallthrough, sha-256-hash-only revocable marketplace tokens
  (constant-time compare), machine profiles.
- **MCP tools** (`src/tools.ts`): `locker_list/pull/push/diff/setup_machine` +
  `registerSeaChestTools(server, store, {getUserId,...})` for Harbor's existing `/api/mcp`.
  Spec's client-perspective signatures adapted honestly for a server-side tool (push takes
  `files` the session read; pull returns files for the session to write) — documented in code +
  README.
- **Marketplace serving** (`src/marketplace.ts`, `src/bundle.ts`, `src/tar.ts`): token-authed
  manifest at `/u/<user>/marketplace.json?token=...` (+ Bearer), plugin-bundle projection to the
  docs-verified layout, and an **npm-registry projection** (packument + deterministic dep-free
  ustar+gzip tarball, sha1/sha512 integrity) at `/u/<user>/registry/t/<token>/...`. 401 on
  missing/bad/revoked token, 404 on cross-user token (no existence oracle), 405 non-GET.
- **Phase 3** (`src/setup-machine.ts`, `src/api.ts`, `src/client.ts`, `src/ui/*`):
  `locker_setup_machine` returns an executable manifest (marketplace add command, `/plugin
  install` list, write-if-absent file writes with per-item `targetPath`/`writeMode` meta,
  service registrations, missing-profile-items reported); locker HTTP API (items/versions/
  publish/profiles/tokens/setup-manifest, zod-validated, typed error→status mapping); React
  locker page (browse by kind, version history, metadata edit, publish toggle, install snippet,
  profiles, token mint/revoke) behind an injected `SeaChestClient`.
- **Migrations** (`supabase/migrations/*.sql`, 4 files — NEVER applied): `locker_items`
  (kind CHECK, unique(user_id,name), published bool), `locker_versions` (unique(item_id,version),
  append-only via RLS: no update/delete policies), `machine_profiles`, `marketplace_tokens`
  (hash-format CHECK, revoked_at). RLS on all tables; published-only public SELECT;
  `published_items` security-invoker view.
- **Dev harness**: `sea-chest serve-local` (fastify, 127.0.0.1, memory store) powering the HTTP
  acceptance leg; README with the Captain's exact mount steps 1–7.

## Evidence (all fresh runs in the isolated worktree)

- **Turbo gates**: `turbo run test --force` exit 0, 17/17 tasks; build 11/11; lint 14/14 (log:
  `<scratchpad>/turbo-test-full.log`). **Floors held exactly**: chartroom 269/269,
  chartroom-ui 180/180, ship 15/15, ship-log 81/81, suite-conventions 35/35, ship-ledger 35/35,
  ship-inbox 51/51. New: **sea-chest 88/88** (11 files: store contract run against BOTH impls,
  supabase mapping specifics incl. user-scoping-on-every-query assertion + race/conflict paths,
  tar round-trip/determinism, projection per kind, diff, marketplace auth+bytes, MCP over real
  SDK in-memory transport, HTTP API, setup manifest, UI via testing-library, serve-local e2e
  over real HTTP). eslint clean (0 errors, 0 warnings).
- **Acceptance** (`acceptance/seachest-roundtrip.mjs`): 10/10 checks — two-machine MCP push/pull
  byte-identity incl. old-version pull, version bump, drift diff; token mint via API → manifest
  (200) → packument → tarball whose bytes unpack to `package/.claude-plugin/plugin.json` +
  `package/skills/.../SKILL.md`; 401s; setup manifest for a profile executed into a temp home
  producing the expected tree.
- **SQL**: `supabase/local-check/run-local-check.mjs` — all 4 migrations loaded into throwaway
  dockerized Postgres 16 (exit 0) AND `95-rls-checks.sql` behavior checks passed: owner
  isolation, cross-user invisibility + 42501 on forged inserts, append-only versions (update/
  delete no-ops), no item deletes, anon sees only published metadata, tokens dark to anon,
  service_role resolves tokens. This exceeds the dispatch's "syntax-checked" bar.

## Research (reports/12-sea-chest-researcher.md; docs fetched live)

R1/R3 verified (marketplace + plugin.json schemas, source types, layout). R4 verified and
**design-critical**: URL-hosted marketplaces HTTP-fetch only marketplace.json; plugin files
transfer ONLY via git clone / npm install — hence the npm-source registry projection instead of
the naive HTTP file serving the spec sketch implied. R2b/c unresolved in docs (token persistence
on refresh; private-URL auth — upstream gap, issue #9756).

## NOT proven (stated plainly; parked, never faked)

1. Live Supabase behavior (RLS proven only on shimmed local Postgres; advisors not run) —
   CAPTAIN-TODO "apply migrations".
2. Native `claude plugin install` honoring a per-plugin custom npm `registry`, and `?token=`
   surviving marketplace refresh — needs hosted platform + real CLI. DECISIONS-NEEDED
   "Package 12" item 1 has the live test + fallbacks (all slot in behind `itemToPluginBundle`).
3. supabase-js compile-time assignability to the structural client (dep deliberately absent;
   runtime method subset is the stable public API).
4. Spec §7 acceptance lines 1–3 in their literal live form (two real machines, fresh laptop) —
   demonstrated against mocks per dispatch; live steps are README §7 + CAPTAIN-TODO.

## Notes for the FO

- Merge heads-up: `pnpm-lock.yaml` will conflict with in-flight package 7 (settings-manager) —
  regenerate lock on merge (both sides only ADD packages).
- FO-named-risk candidates for an independent reviewer, if desired: the migrations/RLS files and
  the marketplace token-auth path (security surface). Self-verification covered both locally.
- Tracking edits made in MAIN repo (uncommitted, per parallel-wave convention): CAPTAIN-TODO 3
  entries, DECISIONS-NEEDED "Package 12" section, plan §8 deviations, this report.
- No `team-tasks/` contact, nothing deleted (temp-dir cleanup in acceptance follows chartroom
  precedent), no deploys, no live Supabase/MCP tools touched, HEAD in main worktree untouched.
