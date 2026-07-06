---
id: package-5-bridge-phase2
---

# Package 5 — Bridge phase 2: ship-ledger + MCP + native task mirroring

The Ship's long-term memory got a task board (Ship_Spec §3; §9 build-order item 2).

New `packages/ship-ledger` — the persistent cross-project ledger: better-sqlite3 WAL store at
`~/.ship/ledger.db`, one `items` table whose `status`/`priority` enums are copied verbatim from
Team Tasks' `task_status`/`task_priority` (spec §3's schema alignment — the package-9 promote
flow becomes a column mapping), plus the 5-July progress fields: `stage_progress` (0–100, a
pure documented function of status), `difficulty` (the Voyage S/M/L/XL type), and
`remaining_guess_h`. Three surfaces over the ONE store: an **MCP server** (`ship-ledger mcp`,
stdio via `@modelcontextprotocol/sdk` — spec §8-named; tools `ledger_create/get/list/update`,
no delete), the **HTTP station** mounted into `ship serve` (`/api/ship-ledger/items[...]`,
`x-ship-deck` on mutations, tab-less), and a standalone bin (`mcp`/`serve`/`list`). WAL lets
the stdio MCP process and the running hull write concurrently (ship-log's proven pattern).

Native Agent Teams mirroring: `TaskCreated`/`TaskCompleted` hook events (already registered by
the Crew plugin, empirically verified payloads from report 04 R1) now flow emitter →
`/api/ship-log/events` → a new in-process **`hookEventConsumer` contract**
(`suite-conventions`, additive) → `source:'native-mirror'` items keyed by
`(native_session_id, native_task_id)`. Ship-log's ingest fan-out replaces the unknown-sidecar
for claimed events, runs sync-before-202 (ordering + non-2xx → emitter spools → drain
re-delivers: mirror events are delayed, never lost), and standalone ship-log (no consumer
mounted) behaves exactly as phase 1. Never written back to `~/.claude/tasks/` — the mirror
module has no write path there.

Acceptance held both ways (spec §9.2 line, literally): deterministic
`packages/ship-ledger/acceptance/ledger-mcp-mirror.mjs` (isolated HOME, real `ship serve`, real
SDK stdio client against the real `ship-ledger mcp` bin, real emitter piping R1-shaped task
payloads, hull-down spool proof — all green) and live on this machine: a real
`claude -p --model haiku --mcp-config` agent created + advanced an item via MCP
(`in_progress`, stage 40), and a real session's native TaskCreate/TaskUpdate produced a
mirrored item that flipped to done/100 in the real `~/.ship/ledger.db` (total spend ~$0.08).
35 ship-ledger tests; ship-log grew to 81, ship to 14; floors held (chartroom 268,
chartroom-ui 172, suite-conventions 35).
