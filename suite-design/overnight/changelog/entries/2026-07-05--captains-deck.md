---
id: package-3-captains-deck
---

# Package 3 — Hull refactor → Captain's Deck (phase 1)

The one-hull revision (Ship_Spec §2) made real. New `packages/suite-conventions`
(`~/.suite/services.json` helpers, typed `StationDescriptor`/`HostContext` plugin contract,
Ship_Spec §2 hook-event zod schemas, `VoyageItem` + difficulty weights, loopback-Host +
`x-ship-deck` security helpers) and new `packages/ship` (hull factory with Host-allowlist guard,
Deck UI static serving, `GET /api/hull/stations`, Voyage backend — `/api/voyage` + SSE
`/api/voyage/events` over a chokidar single-file watch — and a `ship serve` bin with the 4317+
port walk and services.json registration).

Chart Room became the first mounted station: its route registration was extracted into
`registerChartroomRoutes` and its serve startup into `chartroom/station`
(`createChartroomStation`), so `ship serve` and the standalone `chartroom serve` share ONE
codepath — the station writes `~/.chartroom/daemon.json` with the hull's port, so v1.1
`chartroom open`/`associate` discover the Deck automatically. All 6 chartroom acceptance scripts
pass unchanged.

Salvaged and hardened from the WIP quarantine: `POST /api/repos/:repoId/claude-session`
(researcher-verified win32 spawn: direct `wt.exe -w new -d <repo> cmd /k claude`, `cmd /c start`
fallback, vendor-mirrored CLAUDE* env stripping, per-request darwin launcher) guarded by the new
`x-ship-deck` CSRF header — retrofitted onto `POST /api/repos/register` too. `GET /api/repos`
gained per-repo doc/broken-link/needs-you stats for the Deck's repo tree badges.

Deck UI shell in `chartroom-ui`: brass dark design system, top chrome with the "❯ claude" chip,
station tab bar (Docs | Voyage) built from `/api/hull/stations` with graceful single-tab mode
under standalone `chartroom serve`, RepoTree with per-repo claude buttons and alert badges, and
the Voyage tab rendering `progress.json` live (SSE + poll fallback) with reusable
ProgressBar/DifficultyBadge visual grammar for the future Bridge ledger view.

Phase 2 (editor mount fix, DocView resolver, InboxPage "Ask", inbox-correctness slice) stays cut
to a proposed Chart Room v1.2 package per the FO's §10 cut-line approval.
