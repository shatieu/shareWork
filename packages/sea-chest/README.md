---
id: sea-chest
---

# sea-chest

The **Sea Chest** (Locker_Spec phases 1–3), delivered **code-complete to the seam**: your hosted
Claude identity — skills, agents, hooks, settings templates, CLAUDE.md snippets, MCP configs,
presets — stored per-user in the platform's Supabase, reachable as MCP tools, served as a private
token-authed plugin marketplace, with machine profiles and a locker web UI.

This package deliberately contains **zero live-platform wiring**: `team-tasks/` (the future
Harbor) is untouchable in this repo, and migrations are never applied by agents. Everything the
platform needs is exported as framework-agnostic functions plus migration FILES; the exact human
mount steps are below (mirrored in `suite-design/overnight/CAPTAIN-TODO.md`).

## What's inside

| Surface | Export | Spec |
|---|---|---|
| Store seam | `SeaChestStore`, `MemorySeaChestStore`, `SupabaseSeaChestStore` (structural PostgREST client — no supabase-js dependency) | §3 |
| MCP tools | `registerSeaChestTools(server, store, {getUserId, baseUrl?, getMarketplaceToken?})` → `locker_list/pull/push/diff/setup_machine` | §2.2 |
| Marketplace | `handleMarketplaceRequest(store, req, {baseUrl})` — manifest + npm-registry projection (packument + deterministic tgz) | §2.1 |
| Locker API | `handleSeaChestApiRequest(store, req, {baseUrl?})` — items/versions/publish/profiles/tokens/setup-manifest | §5 |
| Web UI | `sea-chest/ui` → `SeaChestPage` (+ panels), driven by `createFetchSeaChestClient` | §5 |
| Migrations | `supabase/migrations/*.sql` (4 files, RLS on everything) | §3 |
| Local checks | `supabase/local-check/run-local-check.mjs` — loads migrations + RLS behavior checks in throwaway dockerized Postgres | — |
| Dev harness | `sea-chest serve-local` — API + marketplace over a memory store on 127.0.0.1 | — |

Items are stored **plugin-shaped** (`content.files`: relative path → text), so marketplace serving
is a projection, not a conversion (spec §2.1). Secrets never live here — v1 configs carry
`${locker:name}` refs resolved locally (phase 4, out of scope for this package).

## Why the marketplace serves an npm registry

Verified against the official plugin docs (researcher report
`suite-design/overnight/reports/12-sea-chest-researcher.md`): Claude Code fetches a URL-hosted
`marketplace.json` by plain HTTP GET, but plugin FILES are only transferred by **git clone or npm
install** — relative paths do not resolve for URL-hosted marketplaces, and there is no generic
HTTP file serving. The documented `{"source": "npm", "package": ..., "registry": ...}` source type
is the one native rail a hosted platform can serve without shelling out to git — so each locker
item is also projected as a minimal npm package (packument + deterministic tarball) under
`/u/<user>/registry/t/<token>/...` (token in the path: npm clients don't reliably carry query
strings from packument to tarball fetch).

**Not live-proven** (needs the hosted platform + the real CLI): that `claude plugin install`
honors a per-plugin custom `registry` end-to-end, and that a `?token=` query on the marketplace
add-URL survives `/plugin marketplace update`. Both are flagged in DECISIONS-NEEDED; the fallback
(a git-remote projection or suite-CLI-assisted install) would slot in behind `itemToPluginBundle`
without touching the store or tools.

## Mount steps (the Captain's integration checklist)

All steps target the platform app (team-tasks → Harbor). `pnpm add sea-chest@workspace:*` there
first (or the npm equivalent once published).

### 1. Apply the migrations (live Supabase — human only)

Copy the four files from `packages/sea-chest/supabase/migrations/` into the platform's
`supabase/migrations/` and run `supabase db push` (or apply via the dashboard SQL editor, in
filename order). They were loaded + RLS-behavior-checked against a local throwaway Postgres
(`node supabase/local-check/run-local-check.mjs`, requires docker) — re-verify on live with the
same checks in `95-rls-checks.sql` §comments, then confirm with `get_advisors` (security).

### 2. Construct stores

```ts
import { SupabaseSeaChestStore } from 'sea-chest';
// Session-scoped routes (locker API): the user's own supabase server client works — RLS applies
// AND the store scopes by userId in code.
const store = new SupabaseSeaChestStore(supabaseServerClient);
// Marketplace route ONLY: needs a service-role client (no session exists on that path;
// resolveToken must read token hashes). Every query is still user-scoped in code.
const marketplaceStore = new SupabaseSeaChestStore(serviceRoleClient);
```

### 3. MCP tools on the existing `/api/mcp`

```ts
import { registerSeaChestTools } from 'sea-chest';
registerSeaChestTools(mcpServer, store, {
  getUserId: (extra) => resolveUserFromAuth(extra),   // however /api/mcp already auths
  baseUrl: 'https://<platform>',
  getMarketplaceToken: async (userId) => lookUpOrMintSetupToken(userId), // optional
});
```

### 4. Marketplace + registry route (Next.js catch-all, e.g. `app/u/[...path]/route.ts`)

```ts
import { handleMarketplaceRequest } from 'sea-chest';
export async function GET(req: Request) {
  const res = await handleMarketplaceRequest(
    marketplaceStore,
    { method: 'GET', url: new URL(req.url).pathname + new URL(req.url).search },
    { baseUrl: 'https://<platform>' },
  );
  return new Response(res.body, { status: res.status, headers: res.headers });
}
```

### 5. Locker API route (authenticated, e.g. `app/api/sea-chest/[...path]/route.ts`)

```ts
import { handleSeaChestApiRequest } from 'sea-chest';
// After the app's own session check:
const res = await handleSeaChestApiRequest(store, {
  method: req.method,
  path: subPathAfterMount, // e.g. '/items?kind=skill'
  userId: session.user.id,
  body: await req.json().catch(() => undefined),
}, { baseUrl: 'https://<platform>' });
```

### 6. Locker page

```tsx
import { SeaChestPage } from 'sea-chest/ui';
import { createFetchSeaChestClient } from 'sea-chest';
<SeaChestPage client={createFetchSeaChestClient('/api/sea-chest')} />
```

### 7. Live acceptance (spec §7, phases 1–3)

1. From machine A (any Claude session connected to the platform MCP): "store this skill in my
   locker" → `locker_push`. On machine B: `locker_pull` → identical files.
2. Mint a token on the locker page; `claude plugin marketplace add
   "https://<platform>/u/<userId>/marketplace.json?token=sc_..."`; `/plugin install <item>@sea-chest-<uid8>`.
   **This is the unproven native-rail step — record the outcome in DECISIONS-NEEDED either way.**
3. Fresh machine: add the MCP server → `locker_setup_machine(profile)` → execute the returned
   manifest (add command + file writes).

## Local development

```
pnpm --filter sea-chest build && pnpm --filter sea-chest test        # 88 tests
node packages/sea-chest/acceptance/seachest-roundtrip.mjs            # phases 1-3 vs mocks
node packages/sea-chest/supabase/local-check/run-local-check.mjs     # migrations + RLS (docker)
node packages/sea-chest/dist/cli.js serve-local                      # poke it with curl
```
