---
id: ship-console
---

# ship-console

The Bridge console station (Ship_Spec §6, package 9) — **deliberately thin**. Mounts a
**Console** tab on the Captain's Deck and serves one read-only overview endpoint:

- `GET /api/ship-console/overview` — the fleet from `claude agents --json` (normalized rows),
  a state rollup (`busy/idle/blocked/done`), the inbox pending badge, and today's changelog
  digest. Every input is an optional in-process contract; a missing or failing sibling degrades
  the overview (`available: false`, `pending: null`, `rollup: null`), never breaks it.
- `GET /api/ship-console/health`

Contracts consumed (never package imports — suite-conventions station discipline):

| Contract | Station | Feeds |
|---|---|---|
| `fleetSource` | ship-voice | session list (the verified `claude agents --json` reader, reused) |
| `pendingCounts` | ship-inbox | inbox badge |
| `getRollup` | ship-log | daily digest |

No storage, no daemon, no dispatch box. Spec §6's dispatch box, ledger sidebar, mission
live-view, and config-matrix are later phases. This is the suite's most sherlockable module:
if Anthropic ships a GUI Agent View, delete this station and keep §3–5.

The UI half lives in `packages/chartroom-ui/src/console/ConsolePage.tsx` (the Deck bundle).
