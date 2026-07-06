---
id: ship-ledger
---

# ship-ledger

The Ship's persistent cross-project ledger (Ship_Spec §3): a SQLite (WAL) item store in
`~/.ship/ledger.db`, exposed three ways over the ONE store:

- **MCP server** (`ship-ledger mcp`, stdio) — agents read/write via `ledger_create`,
  `ledger_get`, `ledger_list`, `ledger_update`. Deletion is deliberately absent.
- **HTTP API** — mounted into `ship serve` as the tab-less `ship-ledger` station
  (`/api/ship-ledger/items[...]`, `/api/ship-ledger/health`; mutations need the `x-ship-deck`
  header). Also runs standalone: `ship-ledger serve [--port 4319]`.
- **Native task mirroring** — `TaskCreated`/`TaskCompleted` hook events (Crew plugin →
  ship-log's ingest endpoint → in-process `hookEventConsumer` contract) appear as
  `source: 'native-mirror'` items. Mirrored **in only, never written back** to
  `~/.claude/tasks/` — this package has no code path that writes there.

## Schema alignment

`status` (`open|claimed|in_progress|in_review|changes_requested|done|blocked`) and `priority`
(`low|normal|high`) are copied verbatim from Team Tasks' `task_status`/`task_priority` enums —
Ship_Spec §3's promote-to-Team-Tasks flow (package 9, §9.5) becomes a column mapping, not a
translation layer. Progress fields per the 5 July spec addition: `stage_progress` (0–100,
a pure function of status — see `stageProgressFor`), `difficulty` (S/M/L/XL, the suite's
Voyage `Difficulty`), `remaining_guess_h` (honest guess, never a promise).

## Registering the MCP server (per-machine step)

From this repo, after `pnpm build`:

```sh
# user scope (all projects on this machine):
claude mcp add ship-ledger --scope user -- node <repo>/packages/ship-ledger/dist/cli.js mcp

# or one-off / headless:
claude -p "..." --mcp-config ledger-mcp.json --strict-mcp-config
```

where `ledger-mcp.json` is:

```json
{ "mcpServers": { "ship-ledger": { "command": "node", "args": ["<repo>/packages/ship-ledger/dist/cli.js", "mcp"] } } }
```

Concurrency: the stdio MCP process and a running hull share the db safely (WAL, the same
two-process pattern ship-log uses for its CLI).

## Acceptance

`node acceptance/ledger-mcp-mirror.mjs` — isolated HOME; boots the real `ship serve`; drives
the real MCP server over stdio with the real SDK client; pipes real TaskCreated/TaskCompleted
envelopes through the real Crew emitter; proves the spool path (hull down → drained later).
