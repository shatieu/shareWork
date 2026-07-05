---
id: ship-the-hull-behind-the-captain-s-deck
---

# ship — the hull behind the Captain's Deck

One local Fastify process, one port, one UI shell with tabs (Ship_Spec §2, one-hull revision,
5 July 2026). `ship serve` boots the **Captain's Deck**: the single place where every locally
hosted station's output is displayed. Chart Room is the first mounted station; ship-ledger,
ship-log, ship-inbox, ship-console and the settings manager mount later through the same seam.

> Naming note: the npm name `ship` is taken (researcher R6); this package is an internal
> workspace name only, never published as-is. The local bin is `ship` regardless — bin names are
> not registry-scoped. Publish naming is a Captain decision (plan 03 §9).

## Usage

```
ship serve [--port <n>] [--voyage <path/to/progress.json>]
```

- Binds **127.0.0.1 only**, first free port from 4317 (same walk as `chartroom serve` — the Deck
  takes over Chart Room's spot so existing bookmarks and deep links keep working).
- Serves: the Deck UI at `/`, every station's API, `GET /api/hull/stations`, and (when a voyage
  file is configured) `GET /api/voyage` + `GET /api/voyage/events` (SSE).
- `--voyage` defaults to `./suite-design/overnight/progress.json` when that file exists;
  otherwise the Voyage tab is disabled and the UI hides it.
- Discovery: the hull registers itself in `~/.suite/services.json`; the chartroom station writes
  `~/.chartroom/daemon.json` with the hull's port, so `chartroom open` / `chartroom associate`
  find the Deck automatically. Both files are cleared on SIGINT/SIGTERM.

Standalone `chartroom serve` continues to work exactly as before — both bins compose the same
station code (`chartroom/station`), so there is one startup codepath.

## Station contract

Stations implement `StationDescriptor` from `suite-conventions` (name, optional Deck tab,
`registerRoutes`, `start`/`stop` lifecycle, optional named in-process `contracts`). Discipline
rule (spec §2): station packages depend only on `suite-conventions` types, never on each other;
the hull is the only package that imports stations, and cross-station calls go through
`HostContext.getContract` — the old HTTP contracts become in-process interfaces.

### Route ownership

| Namespace | Owner |
|---|---|
| `/api/repos/...`, `/api/inbox`, `/api/mcp` | chartroom station (unchanged from v1.1 — deep links keep working) |
| `/api/hull/*` | the hull |
| `/api/voyage*` | the hull (Voyage feed) |
| `/api/<station>/*` | future stations |

Duplicate Deck tab ids across stations are a boot error.

## Local security posture (FO-approved, plan 03 §4.5)

1. **127.0.0.1 bind** — never reachable from the LAN (the hull can spawn terminals).
2. **Host-header allowlist** — every request must carry a loopback Host (`127.0.0.1`,
   `localhost`, `[::1]`, optionally `:port`); anything else is 403. Kills DNS-rebinding attacks.
3. **`x-ship-deck` CSRF header** — state-changing/spawning routes (claude-session, repo
   registration) require this custom header. A cross-origin page cannot attach one without a CORS
   preflight and the hull enables no CORS, so browser-borne CSRF is dead.

Residual risk, documented deliberately: any *local* process can talk to the port. A real token
scheme is future work; these three measures close the browser-borne attack surface tonight.

## Voyage feed

`GET /api/voyage` → `{ file, updatedAt, stale?, packages: VoyageItem[] }` — the parsed
`progress.json`, parse-tolerant (a half-written file serves the last-good snapshot flagged
`stale: true`). `GET /api/voyage/events` is the SSE twin (`event: voyage`, heartbeat comments
every 25 s), re-pushed on every file change (chokidar single-file watch; survives atomic
rename-over). `VoyageItem.source` is `'mission'` today; ship-ledger items will stamp `'ledger'`
into the same shape and reuse the Deck's visual grammar (designed for, not built — plan 03 §2).
