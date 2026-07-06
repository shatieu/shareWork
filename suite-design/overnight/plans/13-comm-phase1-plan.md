---
id: plan-13-comm-phase-1-ship-voice-station-summarize-for-speech-text-mode
---

# Plan 13 — Comm phase 1: ship-voice station + summarize-for-speech (text mode)

**Spec:** VoiceBridge_Spec.md §9.1 (toolset §3, speech rules §4, safety §6). **Branch:** `ship-wave1-comm`
(isolated worktree). **Difficulty:** M. **Acceptance line:** `fleet_status` returns a paragraph that
reads aloud naturally — demonstrated live (real `claude agents --json`) + deterministically (acceptance script).

## Scope

New workspace package `packages/ship-voice` (spec-named, Fastify station like ship-ledger/-inbox/-log),
mounted into `ship serve`. Exposes the §3 toolset over local HTTP under `/api/ship-voice/*`, every
response carrying a `spoken` string built by the summarize-for-speech layer. TEXT MODE ONLY — no audio,
no ElevenLabs code (phase 2+, parked in CAPTAIN-TODO).

**Verified live facts (this session, free):** `claude agents --json` exists, exits 0 headless, returns
`[{id, sessionId, name, cwd, kind, startedAt, state?/status?, pid?}]`. No headless dispatch/send flags on
`claude agents` (agent view is TTY) → send/dispatch use the spec §7 built-in fallback `claude -p --resume`.

## Design (files under packages/ship-voice/)

- `src/fleet.ts` — `FleetSource` injected interface: `list(): Promise<FleetSession[] | null>`.
  Default impl spawns `claude agents --json` (binary resolution duplicates ship-log's PATH-walk —
  stations never import each other; noted comment). `null` → spoken "I can't see the fleet right now".
  Fake seam `SHIP_VOICE_FAKE_FLEET` (JSON env) gated on `NODE_ENV=test`, mirroring ship-log's seam rule.
- `src/speech.ts` — pure spoken-form renderers (§4 rules as unit-testable functions): `speakableName`
  (repo basename + task words, never ids), `capList` (max 3 + "and N more"), `roundNumber`, `sentenceClip`
  deterministic fallback; renderers for fleet status, session status, whats-new, ledger, read-back.
  Payload minimization (§3 locked): renderers receive summaries/counts/command metadata only — never file
  paths, file contents, or diffs; a test asserts fixture file paths do not appear in any spoken output.
- `src/speech-summarizer.ts` — `SpeechSummarizer` injected interface + deterministic fallback
  (ship-log summarize.ts pattern verbatim): default = `claude -p --model haiku --max-budget-usd 0.05`,
  any failure → null → fallback clip. Used only when content exceeds ~350 chars. Live proof ≤$0.10.
- `src/station.ts` — `createShipVoiceStation({homeDir?, fleetSource?, speechSummarizer?, now?})`,
  headless (no Deck tab). Routes (all return `{spoken, ...data}`):
  - `GET  /fleet_status` — fleet digest + inbox pending counts + today's rollup-derived line.
  - `GET  /sessions/:name` — fuzzy name resolution laptop-side (token-overlap scoring); ambiguous →
    spoken disambiguation list.
  - `POST /send_to_session` `{name, text}` — resolve name → detached `claude -p --resume <sessionId>`
    via injected `FleetControl.send` (default spawns; tests fake). Spoken ack.
  - `POST /dispatch` `{repo, task}` — injected `FleetControl.dispatch`, default detached `claude -p <task>`
    in repo cwd. Spoken ack with speakable name.
  - `POST /approve` `{requestId, confirm?, confirmPhrase?}` — two-step §6: no confirm → read-back spoken
    prompt ("Session X wants to run `npm publish` — approve?"); destructive-class (local pattern list:
    rm/del/Remove-Item/force-push/publish/migrate/drop/rmdir/format) additionally requires
    `confirmPhrase === "confirm <verb>"`. Executes via in-hull `app.inject` POST to
    `/api/ship-inbox/permissions/:id/decision` (header attached). **Never** sends `alwaysAllowRule` (§6).
  - `POST /deny` `{requestId}` — straight deny, spoken ack.
  - `POST /ledger_add` `{title, project?}` / `GET /ledger_status?query=` — inject POST + `getContract('ship-ledger','listItems')`.
  - `GET  /whats_new` — today's stored rollup via `getContract('ship-log','getRollup')`, else today's
    entries (inject GET) rendered deterministically; long digest → speech summarizer.
  - `GET  /health`.
  Cross-station calls: contracts where they exist (`listItems`, `getRollup`, `pendingCounts`); `app.inject`
  against sibling routes otherwise — spec §3 maps tools "1:1 onto Ship endpoints", inject reuses their full
  validation/side-effects (waiters, settings rails) with zero edits to sibling stations (parallel-wave
  collision safety). Inject must set `host: '127.0.0.1'` (hull Host-guard rejects light-my-request's
  default `localhost:80` once a port is bound) + `x-ship-deck` on mutations. No DB of its own.
- `src/index.ts` — public exports. `test/` — vitest: speech rules, fleet source (fake spawn), fuzzy
  resolution, station routes on a mini-hull (real ship-inbox/-ledger/-log stations, temp home),
  approve/deny read-back + confirm-phrase + no-always-allow, payload-minimization, summarizer fallback.
- `acceptance/voice-text-mode.mjs` — boots hull in-process (temp home, fake fleet seam, fake summarizer
  seam), seeds a permission + ledger item + log entry over HTTP, exercises every tool endpoint, asserts
  spoken outputs are natural text (no ids/JSON/braces/file paths, lists capped), prints the fleet_status
  paragraph. Wired as `test:acceptance`.
- `packages/ship` edits (minimal): serve.ts imports + mounts `createShipVoiceStation()`; package.json adds
  `ship-voice: workspace:*`. Existing ship tests untouched.

## Out of scope
ElevenLabs agent/browser client (phase 2), relay/pairing (3), Flutter (4), since-last-call memory +
speakable-name registry (5 polish), proactive speech, unified destructive classifier with settings-manager
(pkg 7 in flight — local list now, unification note in DECISIONS-NEEDED as FYI), ship-voice standalone bin.

## Risks
- `serve.ts`/`ship/package.json` merge collisions with parallel packages — diff kept to 3 lines.
- `claude -p --resume` send/dispatch NOT live-proven (token spend / needs live target); proven via
  injected fakes; stated plainly in report.
- Deps: fastify, zod, suite-conventions, vitest tooling — all already in workspace (no new externals).

## Acceptance script / self-verification
`pnpm turbo build lint test` green in worktree; floors chartroom 269, chartroom-ui 180, ship 15,
ship-log 81, suite-conventions 35, ship-ledger 35, ship-inbox 51 hold; `node acceptance/voice-text-mode.mjs`
green; live: hull + real fleet source → GET fleet_status paragraph shown in report; one live haiku
speech-summary call (≤$0.10). Changelog fragment `2026-07-06--comm-phase1.md`. CAPTAIN-TODO: ElevenLabs
phase-2 hookup steps (account, agent creation, API key env, tool wiring).
