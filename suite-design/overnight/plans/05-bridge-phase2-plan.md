---
id: plan-05-bridge-phase2
---

# Package 05 — Bridge phase 2: ship-ledger + MCP + native task mirroring — Plan (BRIEF, combined mode)

- **Mode:** COMBINED plan+implement (Captain's wrap-up order, STATUS 2026-07-06 09:35).
- **Branch:** `ship-wave1-bridge2` off `ship-wave1` @ 192d818.
- **Spec:** Ship_Spec §9.2 + §3 (Ledger), §2 (one hull, observe-don't-host), §8 (stack:
  better-sqlite3, `@modelcontextprotocol/sdk`).
- **Verified facts reused (not re-researched):** reports/04-bridge-phase1-researcher.md R1
  (TaskCreated/TaskCompleted REAL, fire in `-p`, payload `{task_id, task_subject,
  task_description}` + common fields; task_id is per-session "1","2"…), R2–R4;
  reports/02-chartroom-v11-researcher.md R4 (`claude -p` contract, OAuth reuse, budget flags).
- **Verified this session:** `@modelcontextprotocol/sdk` = **1.29.0**, peer zod `^3.25 || ^4.0`
  (workspace zod 4.4.3 OK), engines node>=18. Team Tasks `tasks` table
  (team-tasks/src/lib/database.types.ts): `id, title, spec_md, status, priority, assignee_id,
  branch, pr_url, acceptance, env_required, handover_md, project_id, team_id, created_by,
  created_at, updated_at`; `task_status = open|claimed|in_progress|in_review|changes_requested|
  done|blocked`; `task_priority = low|normal|high`.

## Scope

1. **NEW `packages/ship-ledger`** (mirrors ship-log's package anatomy: ESM, tsc build, eslint,
   vitest, bin):
   - **`src/db.ts`** — better-sqlite3 WAL store `~/.ship/ledger.db` (injected `homeDir`
     everywhere; no test touches real home). Table `items`: `id TEXT PK` (uuid), `title`,
     `spec_md` (default ''), `project`, `status` (Team-Tasks-aligned enum above, default
     `open`), `priority` (low|normal|high, default normal), `source`
     (human|agent|native-mirror), `session_refs_json`, `created_at`, `updated_at`, progress
     fields per spec §3: `stage_progress INTEGER` (0–100 deterministic from status),
     `difficulty TEXT NULL` (S/M/L/XL — reuses suite-conventions `Difficulty`),
     `remaining_guess_h REAL NULL`, plus mirror keys `native_session_id`, `native_task_id`,
     `UNIQUE(native_session_id, native_task_id)`. `schema_meta(version)=1`.
     `stageProgressFor(status)`: open 0, claimed 10, in_progress 40, changes_requested 55,
     in_review 80, blocked 25, done 100 (pure, documented; recomputed on every status change).
     CRUD: create/get/list(filter project/status/source)/update(patch incl. addSessionRef).
   - **`src/mirror.ts`** — TaskCreated → upsert mirror item (source `native-mirror`,
     title=task_subject, spec_md=task_description, project=basename(cwd), status open,
     session_refs=[session_id]); TaskCompleted → mark that (session,task) item done
     (stage_progress 100); missing-created degraded path inserts directly as done. **Never
     writes back** to `~/.claude/tasks/` (spec §3) — module has no code path that could.
   - **`src/mcp.ts`** — `createLedgerMcpServer(db)` via `McpServer` (SDK 1.29): tools
     `ledger_create`, `ledger_get`, `ledger_list`, `ledger_update` (zod input schemas; source
     defaults to `agent` on create; update patches status/title/spec_md/priority/difficulty/
     remaining_guess_h/addSessionRef). Responses = JSON text content. stdout is the JSON-RPC
     channel — no console.log in this path.
   - **`src/station.ts`** — `createShipLedgerStation({homeDir?, now?})`: tab-less
     StationDescriptor `ship-ledger`; routes `GET/POST /api/ship-ledger/items`,
     `GET/PATCH /api/ship-ledger/items/:id`, `GET /api/ship-ledger/health` (mutations behind
     `x-ship-deck` header, same posture as ship-log); `stop()` closes db. Contracts:
     `hookEventConsumer` (below) + `listItems` (console seam).
   - **`src/cli.ts`** bin `ship-ledger`: `mcp` (StdioServerTransport — the spec's MCP server),
     `serve [--port]` (standalone, default 4319, Host-guard), `list [--project --status]`.
2. **Event fan-out (the phase-1 "consumers, not new transport" seam, now real):**
   - `packages/suite-conventions` (additive): `HookEventConsumer` type
     `{ events: readonly string[]; consume(envelope: HookEventEnvelope): void|Promise<void> }`
     + `HOOK_EVENT_CONSUMER_CONTRACT = 'hookEventConsumer'` constant.
   - `packages/ship-log`: `ingestEnvelope(ctx, raw, homeDir, consumers?)` — events matching a
     consumer are delivered to it (`stored:'forwarded'`) instead of the unknown sidecar; no
     consumer mounted (standalone ship-log) = sidecar exactly as today. Station resolves
     consumers lazily per call via `ctx.getContract('ship-ledger', HOOK_EVENT_CONSUMER_CONTRACT)`
     (station list = option, default `['ship-ledger']`). Task events take the **sync-before-202**
     path (cheap SQLite writes, order-critical Created→Completed; error → 500 → emitter spools —
     mirror events are never lost). Spool drain + rollup drain pass the same consumers.
3. **`packages/ship`**: add `ship-ledger` workspace dep; mount station in `serve.ts`
   (`[chartroom, shipLog, shipLedger]`); update hull/deck-boot expectations.
4. **No `plugins/crew` changes needed** (hooks.json already registers TaskCreated/TaskCompleted;
   emit.mjs is generic). README gets an MCP-registration note only.

## Out of scope

Promote/pull via Team Tasks API (cross-computer sync = §9.5, package 9 — schema alignment is
this package's only obligation). Inbox (§9.3). Quartermaster/crew roles (§9.4). Deck Voyage-tab
UI over ledger items (console phase). Rollup-as-MCP-tool (noted seam; trivially addable to
`mcp.ts` later). No repo-committed `.mcp.json` (per-machine step — README documents exact
commands).

## Test plan (vitest, injected homeDir)

- **db**: schema create/reopen; create defaults (uuid, stage_progress from status, timestamps);
  list filters; update patch + stage_progress recompute + updated_at; addSessionRef dedupe;
  invalid status/difficulty rejected.
- **mirror**: Created→upsert shape; Completed→done; Completed-without-Created degraded;
  duplicate Created idempotent (no clobber of created_at); two sessions same task_id distinct.
- **mcp**: SDK `Client` + `InMemoryTransport.createLinkedPair()` — list tools; create/get/list/
  update round-trip through the real server; bad input → tool error.
- **station**: Fastify inject — CRUD routes; 403 without header; 400 bad body; health.
- **ship-log fan-out**: TaskCreated envelope with consumer → forwarded (no sidecar); without
  consumer → sidecar (regression); consumer error on sync path → 500.
- **ship**: hull mounts 3 stations; deck-boot.mjs updated.
- Floors: chartroom 268, chartroom-ui 172, ship 13(+), ship-log 76(+), suite-conventions 35(+).

## Acceptance script (spec §9.2: "an agent creates/updates ledger items via MCP; native team tasks appear as mirrored items")

1. **Deterministic** `packages/ship-ledger/acceptance/ledger-mcp-mirror.mjs`: isolated
   HOME/USERPROFILE; boot real `ship serve` on ephemeral port; (a) MCP: real SDK client over
   stdio to the real `ship-ledger mcp` bin — create item, update status→in_progress, list —
   then assert the same items via `GET /api/ship-ledger/items` (HTTP sees MCP's writes: WAL,
   one store); (b) mirror: pipe real TaskCreated/TaskCompleted envelopes (R1 payload shape)
   through the real `plugins/crew/hooks/emit.mjs` → hull → assert mirrored item appears
   source=native-mirror then flips to done/100; (c) hull down → task event spools → restart
   drains → mirrored item still lands. Exit non-zero on any failure.
2. **Live proof** (this machine, ≤ ~$0.15 haiku): real `claude -p` with `--mcp-config` (+
   `--strict-mcp-config`, `--allowedTools mcp__ship-ledger__*` — exact flag syntax verified
   empirically at run time) creates + updates a ledger item via MCP; a second real session
   using native TaskCreate/TaskUpdate tools (R1 recipe) with `--plugin-dir plugins/crew` while
   the hull runs → mirrored items in the real `~/.ship/ledger.db`. Evidence in the report.

## Risks / decisions

- **New dependency `@modelcontextprotocol/sdk`** — spec §8 names it explicitly; version pinned
  `^1.29.0`, zod-4 compatible (verified). Not a Captain decision.
- **TaskCreated payload undocumented by Anthropic** (R1: empirical-only, "treat as unstable") —
  mirror maps defensively (all fields optional except session_id/task_id fallback).
- **stage_progress mapping values** are my judgment (deterministic + documented); Captain can
  retune constants later — noted in DECISIONS-NEEDED as FYI, not blocking.
- **`--allowedTools` MCP wildcard syntax in `-p`** unverified → live-proof-time verification;
  deterministic acceptance does not depend on it (SDK client).
- Ledger writes from MCP (separate process) vs hull HTTP reads: WAL two-process pattern already
  proven by ship-log CLI-vs-hull.

## Commit order

1. `feat(suite-conventions): HookEventConsumer contract type` → 2. `feat(ship-ledger): db +
mirror + tests` → 3. `feat(ship-ledger): MCP server + tests` → 4. `feat(ship-ledger): station +
CLI + tests` → 5. `feat(ship-log): forward task events to mounted consumers` → 6. `feat(ship):
mount ship-ledger station` → 7. `test(ship-ledger): acceptance script` → 8. live proof +
changelog fragment + report.
