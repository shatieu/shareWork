---
id: bridge-console-thin-fleet-view-rollup-inbox-badge
date: 2026-07-06
package: 09-bridge-console
branch: ship-wave1-console
---

# Bridge console (Ship_Spec §6) — thin fleet view, rollup, inbox badge

The Deck gets a **Console** tab: the fleet from `claude agents --json`, at a glance.

- **`packages/ship-console`** (new, deliberately thin): one read-only station endpoint
  `GET /api/ship-console/overview` — normalized session rows (name/repo/kind/state/started),
  state rollup counts, inbox pending badge, today's changelog digest. No storage, no daemon.
  Every input is an optional in-process contract; a missing or failing sibling degrades the
  answer (`available:false`, `pending:null`, `rollup:null`), never 5xxs. Most sherlockable
  module by design: if Anthropic ships a GUI Agent View, delete this and keep §3–5.
- **Reuse, not duplication**: ship-voice now offers its verified `claude agents --json` reader
  as a `fleetSource` contract (the same seam style as ship-inbox's `pendingCounts`, which was
  built for this package); the console consumes it via `getContract` — stations still never
  import each other.
- **Deck UI**: Console tab (`#/console`) with fleet table, state chips, an inbox chip that
  jumps to the Inbox tab, the daily digest panel, manual refresh + 10 s poll, and honest
  empty/unavailable states.
- **Hull**: seventh station mounted in `ship serve`; deck-boot acceptance now asserts the
  Console tab and probes the overview through the hull (shape-only — fleet contents are
  machine state).

Out of scope, per spec §6/§11 and the wrap-up order: dispatch box, ledger sidebar, mission
live-view (the 5 July note — later phase), config-matrix.

Tests: +11 (ship-console) +8 (chartroom-ui) +1 (ship-voice contract) +1 (ship integration);
all prior floors hold. Live proof: the real fleet on the build machine rendered through the
console normalizer, `available:true`, 3 sessions (busy/blocked/done).
