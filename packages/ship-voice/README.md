---
id: ship-voice-the-comm-s-laptop-half-phase-1-text-mode
---

# ship-voice — the Comm's laptop half (phase 1, text mode)

VoiceBridge_Spec §9.1: a headless Ship station exposing the §3 voice toolset over local HTTP,
with every response carrying a `spoken` string built by the summarize-for-speech layer (§4).
Mounted into `ship serve` beside the other stations; phase 1 has **no audio and no ElevenLabs
code** — the endpoints are the seam phase 2 wires ElevenLabs client tools onto, 1:1 by name.

## Endpoints (`/api/ship-voice/…`, names = §3 tool names)

| Route | Verb | Tool |
| --- | --- | --- |
| `/fleet_status` | GET | fleet digest: sessions + inbox pending + today's rollup line |
| `/session_status?name=` | GET | one session, fuzzy-addressed ("the auth one") |
| `/send_to_session` | POST | `{name, text}` → detached `claude -p <text> --resume <id>` |
| `/dispatch` | POST | `{repo, task}` → detached `claude -p <task>` in that repo |
| `/approve` | POST | `{requestId[, confirm, confirmPhrase]}` — §6 rails below |
| `/deny` | POST | `{requestId[, message]}` |
| `/ledger_add` | POST | `{title[, project]}` |
| `/ledger_status?query=` | GET | capped spoken list |
| `/whats_new` | GET | today's rollup digest, else today's entries |
| `/health` | GET | `{ok, station, textMode}` |

## Safety rails (§6)

- Approvals are two-step: a call without `confirm` only returns the read-back
  ("Session X wants to run `npm publish` — approve?"); nothing executes.
- Destructive-class commands (rm/del/Remove-Item, force-push, publish, migrations, drops,
  hard resets) additionally require the exact phrase `confirm <verb>` — a bare confirm is 403.
- **No "always allow" by voice**: the approve schema is strict; an `alwaysAllowRule` key is a
  400, and this station never writes settings.

## Payload minimization (§3, locked)

Spoken strings and response metadata carry summaries, names, counts, and command text only —
never file contents, file paths, or diffs. Tests assert fixture paths never surface.

## Fleet access (verified 2026-07-06)

- Read: `claude agents --json` (headless, exits 0; sessions carry `sessionId`, `name`, `cwd`,
  `kind`, `state`/`status`). Behind the injected `FleetSource`; `null` → spoken fallback.
- Write: `claude agents` has **no** headless dispatch/send flags (the agent view is a TTY), so
  `send_to_session` uses the spec §7 built-in fallback `claude -p --resume <sessionId>` and
  `dispatch` starts a fresh `claude -p` in the repo — both detached fire-and-forget behind the
  injected `FleetControl`. Native supervisor peek/reply is phase 2+.
- `SHIP_VOICE_CLAUDE_PATH` overrides binary resolution (Windows shim walk otherwise).

## Test seams (all refused outside `NODE_ENV=test`)

`SHIP_VOICE_FAKE_FLEET` (JSON array), `SHIP_VOICE_FAKE_CONTROL=1` (no spawns),
`SHIP_VOICE_FAKE_SUMMARIZER=1` (deterministic speech summaries). The acceptance script
(`acceptance/voice-text-mode.mjs`) drives the real `ship` bin with these seams: zero spend,
fully repeatable.

## Phase 2 hookup (human steps — parked, see CAPTAIN-TODO)

1. Create an ElevenLabs account + an Agents-platform agent (Council-mode system prompt).
2. Register client tools named exactly like the §3 routes above; each tool's handler calls the
   corresponding `/api/ship-voice/*` endpoint and returns the `spoken` field for TTS.
3. Store the ElevenLabs API key + agent id outside the repo (e.g. `ELEVENLABS_API_KEY`,
   `ELEVENLABS_AGENT_ID` in the environment that serves the phase-2 test page).
4. Build the desktop-browser test page (React SDK) against a live fleet — spec §9.2's own
   acceptance. No relay needed yet (browser and laptop share localhost).
