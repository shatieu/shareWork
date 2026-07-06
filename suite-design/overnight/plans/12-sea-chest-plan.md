---
id: plan-12-sea-chest-locker-spec-1-7-phases-1-3-combined-mode-code-complete-only
---

# Plan 12 — Sea Chest (Locker_Spec §§1–7, phases 1–3) — COMBINED mode, CODE-COMPLETE ONLY

Team Lead plan, 2026-07-06. Branch `ship-wave1-seachest` off `ship-wave1` @ 78a1fbd, isolated
worktree. Brief by design (wrap-up order 09:35); implementation follows immediately.

## 1. Scope and the central constraint

Locker_Spec phases 1–3: (1) tables + MCP tools (`locker_list/pull/push/diff`) + RLS; (2) private
token-authed marketplace serving + plugin-bundle projection; (3) `locker_setup_machine` + machine
profiles + web UI. The spec places all of it inside the hosted app (team-tasks → Harbor). team-tasks
is UNTOUCHABLE and the live Supabase project is Captain-reserved, so the whole package is **built to
the seam**: a new workspace package `packages/sea-chest` containing migration FILES, framework-
agnostic handlers/tools that Harbor mounts later, tests against local mocks, and a README with the
exact human mount steps (mirrored in CAPTAIN-TODO.md).

Out of scope (spec-explicit): phase 4 secrets seam (`${locker:}` resolver), phase 5 publishing/
community marketplace, phase-2-vault. `published` bool exists in the schema (spec §3 data model)
but no community endpoint ships. No Deck tab (Sea Chest is a Harbor feature, not a hull station).

## 2. Architecture (seam-first)

Everything is transport-agnostic core + thin adapters, so Harbor mounts it with ~10 lines:

- **`SeaChestStore` interface** — all persistence ops, user-scoped. Two implementations:
  - `MemorySeaChestStore` — full-fidelity in-memory impl (tests, acceptance, local dev).
  - `SupabaseSeaChestStore` — thin mapping onto a *structural* PostgREST-style client interface
    (`from().select()...`), so `@supabase/supabase-js` is NOT a dependency; Harbor passes its own
    client. Tested against a faithful chainable mock. Live behavior explicitly NOT proven here.
- **MCP tools** (`locker_list`, `locker_pull`, `locker_push`, `locker_diff`,
  `locker_setup_machine`) — defined once as `{name, description, zodSchema, handler(store, ctx)}`;
  `registerSeaChestTools(mcpServer, store, getUserId)` adapter for `@modelcontextprotocol/sdk`
  (already in workspace via ship-ledger). Harbor calls the register fn on its existing `/api/mcp`.
- **Marketplace serving** — pure `handleMarketplaceRequest(store, req) → {status, headers, body}`;
  Harbor wraps it in a Next.js route handler (README). Token auth: sha256 token hash lookup
  (node:crypto), constant-time compare; store impl documents service-role client + explicit
  user-id scoping on every query. Bundle projection `itemToPluginBundle()` turns stored items into
  native plugin layout (`.claude-plugin/plugin.json`, `skills/…`, `agents/…`, `hooks/hooks.json`,
  `.mcp.json`) — serving is a projection, not a conversion (spec §2.1).
- **`locker_setup_machine`** — server-side tool returns a structured setup manifest (marketplace
  add command, settings-template contents + target paths, suite service registrations) that the
  calling session executes locally; profiles select item sets.
- **Web UI** — React components (`src/ui/`): item browser by kind, item detail w/ version history,
  metadata edit, publish toggle, install snippet, machine profiles editor. Components take an
  injected `SeaChestClient` (fetch-based impl shipped); tested with testing-library + jsdom +
  mock client (same toolchain as chartroom-ui). Harbor mounts them on a page later (README).
- **HTTP API handlers** for the UI (`handleApiRequest`) — same pure-handler pattern, so the UI has
  a real backend contract testable against the memory store.

## 3. Migration files (`packages/sea-chest/supabase/migrations/*.sql`)

Numbered timestamped files, NEVER applied here: `locker_items` (kind CHECK per spec §3, unique
(user_id, coalesced team scope, name), version int, published bool, timestamps), `locker_versions`
(append-only, unique(item_id, version), insert trigger on items content/version change, no
update/delete policies), `machine_profiles` (user_id, name unique per user, item_names jsonb),
`marketplace_tokens` (token_hash, label, revoked_at). RLS enabled on ALL tables: owner-only ALL via
`auth.uid()`; extra anon SELECT on `locker_items` WHERE `published = true`; `published_items` view
over that projection. Verification: load all migrations into a throwaway dockerized Postgres
(supabase CLI 2.75.0 / postgres image available locally) — syntax + object creation proven; RLS
runtime behavior against live Supabase NOT provable here (stated in report; RLS policy tests as
SQL comments + README checklist for the Captain).

## 4. Package layout

`packages/sea-chest/` — scaffold cloned from ship-inbox/ship-ledger (tsc build, vitest, eslint,
same tsconfig pattern): `src/types.ts` (zod schemas: kinds, item, bundle shapes), `src/store.ts`
(interface + memory impl), `src/supabase-store.ts`, `src/bundle.ts` (plugin projection),
`src/marketplace.ts`, `src/tools.ts` (MCP defs + register adapter), `src/setup-machine.ts`,
`src/diff.ts` (reuse-style LCS line diff, dep-free), `src/api.ts` (UI HTTP handlers),
`src/client.ts` (fetch client), `src/ui/*.tsx`, `src/cli.ts` (dev bin: `sea-chest serve-local` —
memory store + marketplace/API/MCP-stdio for local acceptance), `test/*` per module,
`acceptance/seachest-roundtrip.mjs`, `README.md` (mount steps), `supabase/migrations/*.sql`.
Deps: zod, @modelcontextprotocol/sdk (workspace-precedented); dev: react, react-dom,
@testing-library/react, jsdom, vitest, fastify (dev harness only) — all already in the workspace
for other packages. No other new externals.

## 5. Research gate (in flight, background)

Marketplace manifest schema, `marketplace add <https-url>` semantics, relative-source resolution
over HTTP, token-in-URL survival, and native install transfer mechanics are being verified against
live docs (reports/12-sea-chest-researcher.md). Manifest emission + serving routes follow the
verified format; if native HTTP serving proves unsupported, the projection still ships, the serving
handler emits the closest supported shape, and the gap goes to DECISIONS-NEEDED (never guessed).

## 6. Tests + acceptance (all against local mocks)

Per-module vitest suites (store contract suite run against BOTH impls; token auth incl. revoked/
wrong-user; projection golden files per kind; RLS *intent* encoded in supabase-store scoping tests;
UI component tests). Acceptance script `seachest-roundtrip.mjs` (phases 1–3, mock-backed):
(1) machine A pushes a skill via MCP client → version 1; re-push → version 2, history intact;
machine B (second MCP session, same store) lists + pulls byte-identical content. (2) marketplace
endpoint with valid token serves manifest + bundle files matching the researched native format;
bad/revoked token → 401/404; unpublished items invisible without token. (3) `locker_setup_machine`
with a profile returns a manifest naming the marketplace URL + template files; executing its file
writes into a temp dir yields the expected tree. Gates: full turbo build/lint/test in the worktree;
floors chartroom 269, chartroom-ui 180, ship 15, ship-log 81, suite-conventions 35, ship-ledger 35,
ship-inbox 51; migrations load clean into throwaway Postgres; changelog fragment.

## 7. Risks / parked

- Native `/plugin install` from URL-marketplace (R2/R4) may be git-only → serving shape parked to
  DECISIONS-NEEDED with code still complete behind the projection seam.
- Live acceptance lines (spec §7 phases 1–3) inherently need the live platform → CAPTAIN-TODO
  entries: apply migrations, mount MCP register fn, mount marketplace + API routes, mount UI page,
  mint a marketplace token, run live round-trip.
- pnpm-lock will conflict with in-flight package 7 (settings-manager) at merge — FO heads-up.
- Trigger-based version append runs with invoker rights; needs an INSERT policy on locker_versions
  scoped via item ownership — encoded in migration, runtime-proven only at Captain apply time.

## 8. Deviations from plan (recorded during implementation, 2026-07-06)

1. **§3 "insert trigger" dropped** — version rows are inserted by the store code path in BOTH
   implementations (identical semantics memory vs supabase); append-only is enforced by RLS
   (no update/delete policies on `locker_versions`). Rationale + Captain visibility in
   DECISIONS-NEEDED "Package 12" item 2.
2. **§5 research outcome applied** — native HTTP file serving is confirmed unsupported
   (researcher R2/R4); phase-2 serving shipped as the documented npm-source rail: per-user
   token-in-path npm registry (packument + deterministic dep-free tgz). Live `/plugin install`
   proof parked (DECISIONS-NEEDED item 1, CAPTAIN-TODO).
3. **Additive, not planned explicitly:** `supabase/local-check/` harness (shim + RLS behavior
   checks in throwaway docker Postgres — upgraded "SQL syntax-checked" to "RLS behavior proven
   locally") and `sea-chest serve-local` fastify dev harness (powers the HTTP acceptance leg).
4. **UI tests use @testing-library fireEvent only** — no @testing-library/user-event dependency
   (kept the dep set strictly within workspace-precedented packages).
