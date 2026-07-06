---
id: report-05-bridge-phase2-team-lead
---

# Package 05 — Bridge phase 2 (ship-ledger + MCP + native task mirroring) — Team Lead report

Date: 2026-07-06 ~09:45–10:45. Mode: COMBINED plan+implement (Captain's wrap-up order, STATUS
2026-07-06 09:35). Branch `ship-wave1-bridge2` off `ship-wave1` @ 192d818. Plan:
`suite-design/overnight/plans/05-bridge-phase2-plan.md` (committed first, then implemented —
zero deviations from the plan as written).

## What shipped (10 commits, oldest first)

    76d6224 docs(bridge2): package 5 plan
    7a11dac feat(suite-conventions): HookEventConsumer contract type for in-process hook fan-out
    005420c feat(ship-ledger): SQLite ledger store + native task mirroring (Team-Tasks-aligned schema)
    b989500 feat(ship-ledger): MCP server - ledger_create/get/list/update over stdio-ready McpServer
    9593fff feat(ship-ledger): hull station, standalone bin, hookEventConsumer contract
    118a05b feat(ship-log): forward claimed hook events to mounted hookEventConsumer stations
    51211c2 feat(ship): mount ship-ledger station; hull-level task-mirror integration test
    c6135c2 test(ship-ledger): mcp+mirror acceptance script
    c731622 docs(bridge2): mission changelog fragment + decisions FYI
    a6f079e chore(dogfood): spool-drained shareWork fragments captured by the live-proof hull

### New `packages/ship-ledger` (Ship_Spec §3)

- `src/db.ts` — better-sqlite3 WAL store `~/.ship/ledger.db`; `items` table with
  `status`/`priority` enums copied VERBATIM from Team Tasks' `task_status`/`task_priority`
  (verified against `team-tasks/src/lib/database.types.ts` lines 168–204, 347–356; read-only —
  team-tasks untouched); spec-§3 progress fields `stage_progress` (pure `stageProgressFor`:
  open 0, claimed 10, blocked 25, in_progress 40, changes_requested 55, in_review 80, done
  100), `difficulty` (suite-conventions Voyage `Difficulty` S/M/L/XL), `remaining_guess_h`;
  mirror identity `UNIQUE(native_session_id, native_task_id)`; injected `homeDir` everywhere.
- `src/mirror.ts` — TaskCreated → upsert `source:'native-mirror'` item (idempotent on spool
  re-delivery; never clobbers created_at or a human-advanced status); TaskCompleted → done/100;
  Completed-without-Created inserts directly as done (degraded, never dropped). **No code path
  writes `~/.claude/tasks/`** — spec §3's never-write-back is structural.
- `src/mcp.ts` — `@modelcontextprotocol/sdk` **1.29.0** McpServer (spec §8-named dependency;
  verified live on npm: peer zod `^3.25 || ^4.0`, compatible with workspace zod 4.4.3). Tools
  `ledger_create` (source defaults 'agent'), `ledger_get`, `ledger_list`, `ledger_update`
  (status change recomputes stage_progress; `add_session_ref` dedupes). No delete tool.
- `src/station.ts` — tab-less hull station: `GET/POST /api/ship-ledger/items`,
  `GET/PATCH /api/ship-ledger/items/:id`, `GET /api/ship-ledger/health`; mutations behind
  `x-ship-deck` (existing posture); contracts `hookEventConsumer` + `listItems` (console seam).
- `src/cli.ts` bin `ship-ledger`: `mcp` (stdio; stdout is JSON-RPC, no logging), `serve`
  (standalone, 4319, Host-guard), `list`.

### Fan-out (the phase-1 "consumers, not new transport" seam, made real)

- `suite-conventions` (additive): `HookEventConsumer` + `HOOK_EVENT_CONSUMER_CONTRACT`.
- `ship-log`: `ingestEnvelope(..., consumers?)` — claimed events (TaskCreated/TaskCompleted)
  are delivered to the consumer (`stored:'forwarded'`), sync-before-202; consumer errors → 500
  → emitter spools → drain re-delivers (mirror events delayed, never lost). No consumer mounted
  (standalone ship-log) → unknown sidecar exactly as phase 1 (regression-tested). Consumers
  resolved lazily per event via `ctx.getContract('ship-ledger', ...)` — names, not imports.
  Route body gained a `stored` field; the two existing exact-body assertions updated.
- `ship`: `serve.ts` mounts `[chartroom, shipLog, shipLedger]`; deck-boot expects 3 stations.

## Gates (all run this session, `--force`, no cache)

- `pnpm turbo build lint test --force`: **20/20 tasks green**. Counts: chartroom **268** (floor
  268), chartroom-ui **172** (172), ship **14** (floor 13; +1 hull mirror integration test),
  ship-log **81** (floor 76; +5 fan-out tests), suite-conventions **35** (35), ship-ledger
  **35** (new: db 14, mirror 7, mcp 5 via real SDK client over InMemoryTransport, station 9).
- `node packages/ship-ledger/acceptance/ledger-mcp-mirror.mjs` → **all assertions passed**:
  isolated HOME; real `ship serve`; real SDK stdio client against the real `ship-ledger mcp`
  bin while the hull runs (HTTP reads the MCP process's writes — one WAL store, two
  processes); real `emit.mjs` piping R1-shaped TaskCreated/TaskCompleted (mirror open → done,
  same item, no duplicate); hull-down → task event spools (exit 0) → restart drains it in.
- `node packages/ship/acceptance/deck-boot.mjs` → all assertions passed (package-3/4 unharmed).

## Live proof (spec §9.2 acceptance line, literally — spend ~$0.08 haiku)

- Hull on real home, port 4317, stations chartroom+ship-log+ship-ledger.
- **MCP half:** `claude -p --model haiku --mcp-config <ledger-mcp.json> --strict-mcp-config
  --allowedTools "mcp__ship-ledger__ledger_create,mcp__ship-ledger__ledger_update"` — the agent
  created item `151d0b5f-b199-46cc-bdd6-6e91af2b9411` ('Live proof: chart the shoals',
  difficulty S) and advanced it to in_progress/stage 40; verified via
  `GET /api/ship-ledger/items/<id>` against the real `~/.ship/ledger.db`. Cost $0.0384.
  (Comma-separated exact MCP tool names in `--allowedTools` verified working empirically;
  `mcp__server__*` wildcard was not needed and was NOT tested.)
- **Mirror half:** real session (`--plugin-dir plugins/crew`, `--allowedTools
  TaskCreate,TaskUpdate`) created + completed a native task → mirrored item
  `08b9ad52-4e85-4254-a6f9-5dc2604a0c8d`: title 'Live proof: mirror me', source
  native-mirror, nativeTaskId "1", sessionRefs=[session], flipped to done/stageProgress 100.
  Cost $0.0416.
- Teardown: hull killed (hard), stale `~/.suite/services.json` hull entry hand-cleared (pkg-4
  precedent); real ledger.db keeps the two live-proof items (it IS the product's store).
- Side effect (by design): the live-proof hull drained the real spool — three shareWork dogfood
  fragments landed and are committed (a6f079e).

## NOT proven / honest limits

- **MCP registration UX**: only `--mcp-config` was exercised live; `claude mcp add` persistent
  registration is documented in the README but not run (machine-state hygiene). FYI parked in
  DECISIONS-NEEDED (package 5 section).
- **Interactive-session Task hooks**: task mirroring proven in `-p` mode (as R1 did); untested
  in an interactive tty session.
- **Non-Windows paths** untested on this box (same standing caveat as pkg 4).
- No independent reviewer per wrap-up order; no security/data-loss risk found to flag — all new
  surfaces are 127.0.0.1-only behind the existing Host-guard + x-ship-deck posture; MCP is
  stdio (no network); no deletes anywhere (REMOVALS.md untouched; nothing removed).
- `team-tasks/` untouched by every commit (verified: `git log --stat ship-wave1..HEAD --
  team-tasks/` is empty). Captain's own dirty team-tasks files + `suite-design/Chart Room.html`
  left strictly alone.

## Files of record

- Plan: `suite-design/overnight/plans/05-bridge-phase2-plan.md`
- Changelog fragment: `suite-design/overnight/changelog/entries/2026-07-06--bridge-phase2.md`
- DECISIONS-NEEDED: package-5 FYI section appended (stage_progress constants, MCP registration)
- Package: `packages/ship-ledger/` (+README with per-machine MCP registration commands)
