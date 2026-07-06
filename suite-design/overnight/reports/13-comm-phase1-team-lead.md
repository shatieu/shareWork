---
id: package-13-comm-phase-1-ship-voice-summarize-for-speech-team-lead-report
---

# Package 13 — Comm phase 1 (ship-voice + summarize-for-speech) — Team Lead report

**Mode:** combined plan+implement (wrap-up order 2026-07-06 09:35). **Branch:** `ship-wave1-comm`
(isolated worktree `<scratchpad>/wt-comm`, base `78a1fbd` = ship-wave1 tip at cut).
**Plan:** `suite-design/overnight/plans/13-comm-phase1-plan.md`. **Spec:** VoiceBridge_Spec §9.1
(toolset §3, speech §4, safety §6). **Commits:** 4 (`67b2245`, `52e75cb`, `446ac74`, `39c72e2`).

## What was built

New workspace package `packages/ship-voice` (fastify + zod + suite-conventions only — all
already in the workspace; no new external deps), mounted into `ship serve` as a headless
station. Routes `/api/ship-voice/<§3-tool-name>`: `fleet_status`, `session_status`,
`send_to_session`, `dispatch`, `approve`, `deny`, `ledger_add`, `ledger_status`, `whats_new`,
`health`. Every response carries a `spoken` string from the summarize-for-speech layer
(`src/speech.ts`: names-not-ids, counts as words, rounded numbers, lists capped at 3 with
"and N more", sentence-boundary clipping, markdown stripping; §3 payload-minimization lock —
summaries + command metadata only, never file contents/paths/diffs, test-asserted).

- **Fleet read:** `claude agents --json` behind injected `FleetSource` (`src/fleet.ts`).
  Empirically verified this session: command exists, exits 0 headless, returns
  `[{sessionId,name,cwd,kind,state('blocked'|'done'),status('busy'|'idle'),…}]`.
- **Fleet write:** `claude agents` has NO headless dispatch/send flags (verified — agent view is
  TTY-only), so `send_to_session` = detached `claude -p <text> --resume <sessionId>` (spec §7's
  named built-in fallback) and `dispatch` = detached `claude -p <task>` cwd=repo, both behind
  injected `FleetControl`.
- **Speech summarizer:** `src/speech-summarizer.ts`, exact ship-log pattern (injected interface,
  `claude -p --model haiku --max-turns 1 --max-budget-usd 0.05`, null → deterministic fallback,
  fake seam gated on `NODE_ENV=test`, `SHIP_LOG_SUMMARIZER=1` loop-guard marker on spawns).
- **§6 rails:** approve is two-step (read-back first, execute only on `confirm`); destructive
  class (force-push/publish/rm-del-Remove-Item/migrations/drop/hard-reset, `src/classify.ts`)
  demands exact `confirm <verb>` phrase (bare confirm → 403); always-allow by voice rejected at
  a strict zod schema (smuggled key → 400, request stays pending — proven in tests+acceptance).
- **Cross-station:** contracts where siblings offer them (`pendingCounts`, `listItems`,
  `getRollup`); sibling HTTP routes via `app.inject` otherwise (spec §3: tools "mapped 1:1 onto
  Ship endpoints"; zero edits to sibling stations = parallel-wave collision safety). Inject sets
  `host: 127.0.0.1` + `x-ship-deck`; hull Host-guard compatibility is itself under test.
- **ship edits (3 lines + acceptance):** serve.ts mounts the station; package.json dep;
  deck-boot.mjs now expects 5 stations (ship-voice tab-less).

## Evidence (all fresh runs in the isolated worktree)

- `pnpm turbo build lint test --force` (no cache): **26/26 tasks green**.
- Floors hold exactly: chartroom **269**, chartroom-ui **180**, ship **15**, ship-log **81**,
  ship-ledger **35**, ship-inbox **51**, suite-conventions **35**. New: ship-voice **73** tests.
- `packages/ship-voice/acceptance/voice-text-mode.mjs`: **30/30 checks** against the REAL spawned
  `ship serve` bin (scratch home, deterministic seams, zero spend). Deterministic fleet_status
  paragraph produced: "Two sessions are running. Auth token refactor is working. Team tasks rls
  bug is blocked waiting on an approval. One session has finished. Nothing is waiting on you."
- `packages/ship/acceptance/deck-boot.mjs`: all assertions pass with the new station mounted.
- **LIVE acceptance line** (real `claude agents --json`, 3 real sessions, free):
  "Two sessions are running. Android app development lusk is blocked waiting on an approval.
  Sharework-fa is working. One session has finished."
- **LIVE Haiku speech summary** (1 call, ≤$0.05 budget-capped, ~15s): long 47-file session
  summary → "We refactored the auth service's token refresh system across about fifty files,
  updated a dozen tests… waiting on the platform team…" — §4 rounding emerged naturally.

## Test seams (all refused outside NODE_ENV=test, call-time checked)

`SHIP_VOICE_FAKE_FLEET` (JSON), `SHIP_VOICE_FAKE_CONTROL=1`, `SHIP_VOICE_FAKE_SUMMARIZER=1`.

## Parked / tracking

- **CAPTAIN-TODO:** ElevenLabs phase-2 hookup (account, agent, client tools named 1:1 with the
  routes, `ELEVENLABS_API_KEY`/`ELEVENLABS_AGENT_ID` env, React test page). No ElevenLabs code
  written or faked in phase 1 — the endpoints are the seam.
- **DECISIONS-NEEDED (FYI, default taken):** §6's "same classifier patterns as the settings
  manager" — package 7 is in flight in the parallel wave, so ship-voice carries its own tested
  pattern list; post-merge unification into suite-conventions proposed.

## NOT proven (stated plainly)

- Live end-to-end `send_to_session`/`dispatch` (real `claude -p --resume` reaching a live
  session): would spend tokens beyond the authorized budget and race real sessions. Proven at
  the injected-interface level (unit + acceptance via fake control); the spawn arguments match
  the verified CLI surface. First real use is a cheap manual check.
- Behavior of `claude agents --json` `state/status` fields across future CLI versions — the
  renderer degrades to "is running" for unknown values (tested).
- Merge-time collision risk: `packages/ship/package.json`, `serve.ts`, `deck-boot.mjs`,
  `pnpm-lock.yaml` are shared touchpoints with parallel packages 8/10/12 — trivial conflicts,
  but FO should re-run deck-boot after each merge into ship-wave1.

## Removals / team-tasks

No deletions (REMOVALS.md untouched). `team-tasks/` untouched (branch diff contains zero
team-tasks paths; pre-existing team-tasks modifications in the main worktree are the Captain's
own uncommitted work, not mine).
