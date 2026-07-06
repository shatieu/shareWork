# Plan 09 — Bridge Console (Ship_Spec §6 / §9.5, console part only) — DELIBERATELY THIN

**Branch:** `ship-wave1-console` off `ship-wave1` @ fb11758 (main worktree). **Mode:** combined plan+implement.

## Scope
A thin fleet view as a Deck **Console** tab: fleet list over `claude agents --json`, status
rollup (counts by state + today's ship-log digest), inbox badge counts, manual refresh + poll.
No new storage, no new daemon, no dispatch box, no ledger sidebar, no mission live-view (spec §6
note of 5 July = later phase), no config-matrix (spec §11).

## Design (file-level)
1. **`packages/ship-console`** (new station package; service name per spec §6, template = ship-voice):
   - `src/station.ts` — `createShipConsoleStation(options?)` → `StationDescriptor` with
     `name: 'ship-console'`, `tab: { id: 'console', title: 'Console' }`. Options: injected
     `fleetSource?: FleetSource` (test seam), `now?`.
   - **Reuse, don't duplicate:** `FleetSource`/`FleetSession`/`defaultFleetSource` imported from
     `ship-voice`'s public root export (fleet reading merged today; stations may consume each
     other's *published* API — internals stay off-limits).
   - Routes: `GET /api/ship-console/overview` → `{ available, sessions[], counts{total,busy,idle,
     blocked,done}, pending{permissionsPending,questionsOpen} | null, rollup{date,digest_md} | null,
     generatedAt }`; `GET /api/ship-console/health`. `available:false` when the fleet read returns
     null (never throws). Session display name computed locally (name ?? cwd folder).
   - Contracts consumed (both optional, degrade gracefully): ship-inbox `pendingCounts`,
     ship-log `getRollup(date)` — exact seams ship-voice already uses.
   - Tests: station via Fastify inject with fake fleet source (fleet shapes, counts, contract
     absence/presence, health).
2. **`packages/ship`**: serve.ts mounts `createShipConsoleStation()` (one additive import + one
   array line — package 11 will add its own line in parallel); package.json gains
   `"ship-console": "workspace:*"` (workspace dep, not external). Integration test: console
   overview through the hull with sibling contracts live.
3. **`packages/chartroom-ui`**: `src/console/ConsolePage.tsx` (state chips + inbox badge + fleet
   table + digest + Refresh button + 10s poll; honest empty/unavailable states);
   `fetchConsoleOverview()` + types in `api/client.ts`; App.tsx route `#/console` (parse, tab
   select, breadcrumb, render) — pattern copied from Voyage/Settings; styles in `base.css`.
   Tests: ConsolePage render/refresh/unavailable + App tab-routing test.
4. **Acceptance:** `packages/ship/acceptance/deck-boot.mjs` updated: 7 stations, ship-console tab
   `console`/`Console`, `GET /api/ship-console/overview` answers through the hull (shape only —
   real `claude agents` output is machine-dependent, asserted honestly).
5. Changelog fragment `changelog/entries/2026-07-06--bridge-console.md`.

## Verification (self-review — this package gets no independent reviewer)
Turbo build/lint/test green across workspace; per-package test floors ≥ baseline run captured at
fb11758 before any change; deck-boot acceptance re-passes; evidence in the TL report.

## Risks
- `claude agents --json` shape drift — mitigated by reusing ship-voice's verified-live parser.
- serve.ts merge collision with package 11 — edit kept line-additive per FO note.
- No Captain-only decisions identified; nothing parked.
