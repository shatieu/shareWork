# The Comm — Design Spec (v1) *(formerly "Voice Bridge"; naming settled — see Suite-Architecture_and_Website_Spec.md)*

**Prepared for:** Ondřej · **Date:** 4 July 2026
**Status:** decision-complete for v1, ready to implement.
**Context:** product #3 of the suite (see `Product-Suite_Research-Synthesis.md` §2). Companion specs: `Ship_Spec.md` (the voice bridge drives the Ship's APIs — inbox queue, ledger, log, dispatch), `ChartRoom_Spec.md`. Nobody ships fleet-by-voice (Happy/Omnara are per-session; AgentWire proved the concept and stalled) — greenfield, with the laptop substrate already built as the Ship.

---

## 1. What it is

Talk to your whole Claude Code fleet from your phone, hands-free. A Flutter app + ElevenLabs voice agent + multiuser relay + the Ship's services on the laptop. Hear what all sessions are doing, deliberate about what to do next, approve/deny permission requests, and have the outcome of the conversation turned into dispatched work — while walking the dog.

## 2. The interaction model (the core decision)

**Council mode (default).** The conversation is a *meeting*, not dictation. You and the voice agent discuss — status, options, priorities — the way colleagues do on a call. Nothing you say is taken verbatim. At natural decision points the agent synthesizes: *"So: I'll have the auth session finish the token refactor first, spin up a new session on team-tasks for the RLS bug, and park the changelog idea in the ledger — right?"* On confirmation it executes the division of work: ledger items created, sessions dispatched or messaged with **structured instructions the agent composes** from the discussion (not your raw words).

**Direct mode (explicit).** "Direct entry to the auth session" → everything transcribed verbatim to that session until "end direct." For when you want to *be* the prompt. Spoken passthrough of the session's replies (summarized only if long).

This mirrors how the crew works on the laptop: the voice agent is effectively a First Officer for your pocket — deliberation partner in, work orders out.

## 3. Voice agent tools (ElevenLabs Agent, client tools → laptop via relay)

Mapped 1:1 onto Ship endpoints; all return **spoken-form** payloads (see §4):
- `fleet_status()` — digest from `claude agents --json` + ship-log rollup.
- `session_status(name)` — one session, in ears-first form.
- `send_to_session(name, text)` — used by Council (composed instructions) and Direct (verbatim).
- `dispatch(repo, task)` — new session via `claude agents`.
- `approve(request_id)` / `deny(request_id)` — ship-inbox queue.
- `ledger_add / ledger_status(query)` — capture and recall (Quartermaster-backed).
- `whats_new()` — since-last-call changelog.
- Payload minimization (locked decision): summaries and command metadata only — never file contents, never diffs. ElevenLabs hears the conversation; it never sees the code.

## 4. Summarize-for-speech layer (laptop-side, the real product)

Raw transcripts and JSON are unspeakable. A translation layer on the laptop converts fleet state into utterances built for ears: "Three sessions running. Auth finished tests and opened a PR. Team-tasks is waiting on a bash approval." Rules: names not ids (sessions get speakable names from repo+task; fuzzy addressing — "the auth one" — resolves laptop-side); numbers rounded; lists capped at 3 with "and two more"; long content summarized by Haiku before TTS.

## 5. Proactive speech (tiered, confirmed default)

While connected: **permission requests and blocked sessions interrupt immediately**; **completions** get a soft chime + queued mention at the next pause; **progress** stays silent unless asked. Tiers configurable per project. Disconnected: push notification (tap → opens the call).

## 6. Voice approval safety

- Every approval is **read back before executing**: "Session three wants to run `npm publish` — approve?"
- **Destructive-class commands** (rm/force-push/publish/migrations — same classifier patterns the settings manager will use) require an explicit confirm phrase ("confirm publish"), never a bare "yes."
- **No "always allow" by voice** in v1 — permanent rules deserve a screen (ship-inbox).
- Council-mode dispatches above a size threshold get the same read-back treatment.

## 7. Architecture & transport

```
[Flutter app (elevenlabs_agents SDK, WebRTC/LiveKit audio, client tools)]
        │ tools execute on phone → authenticated WSS
[Relay — multiuser, hosted on the suite's Vercel project (decision: multiuser now)]
        │ outbound-only WSS from laptop (no inbound ports)
[Laptop: ship-voice service → Ship APIs (inbox, ledger, log, dispatch) + speech layer]
```
- **Phone:** native Flutter (decision) — official `elevenlabs_agents` SDK (WebRTC via LiveKit, client-tool registration, barge-in, VAD). Native = background audio on lock screen + push, which "walking the dog" requires. iOS + Android from one codebase.
- **Relay (multiuser from day one):** accounts, QR device⇄laptop pairing (Happy's pattern), message envelopes encrypted device⇄laptop where feasible (relay routes ciphertext; caveat: the *conversation* necessarily transits ElevenLabs — the E2E boundary covers the tool/command channel). Hosted on the suite's Vercel project as one of its genuinely-hosted offerings; self-hostable like everything else. Tailscale remains a supported no-relay mode for the privacy-maximal.
- **Session replies:** native supervisor peek/reply is the primary channel; `claude -p --resume <session-id>` is the built-in fallback if supervisor reply breaks across Claude Code versions (cheap to include — do it from day one).

## 8. Stack

Flutter + `elevenlabs_agents` (phone). ElevenLabs Agents platform (voice brain; custom-LLM option open for later). Relay: TypeScript on the Vercel project (WSS via a small Node service or Vercel-compatible websocket infra — evaluate; if Vercel WSS is awkward, a $5 VM/ Fly.io app is acceptable for the relay only). Laptop: `ship-voice` service (Node/TS, Fastify) beside the other Ship services; Haiku via Agent SDK for speech summaries.

## 9. Build order (phases, each shippable)

1. **Laptop voice service + speech layer.** ship-voice exposing the §3 toolset over local HTTP; spoken-form rendering tested as text. Acceptance: `fleet_status` returns a paragraph that reads aloud naturally.
2. **ElevenLabs agent + desktop-browser client.** Wire tools via client tools from a test web page (React SDK) before touching Flutter. Acceptance: full Council conversation against a live fleet from the browser; approval with read-back works.
3. **Relay + pairing.** Multiuser relay on Vercel, QR pairing, laptop outbound WSS, auth. Acceptance: phone on LTE (no LAN/VPN) drives the fleet.
4. **Flutter app.** Background audio, push notifications, proactive-speech tiers, Direct mode UX (visible mode indicator + transcript). Acceptance: lock the phone mid-walk, permission request interrupts audibly, approve by voice with confirm phrase.
5. **Polish:** speakable-name registry, "since last call" memory, per-project proactive tiers, self-host docs for the relay.

## 10. Definition of done (v1)

- From a locked phone on mobile data: hear fleet status, deliberate in Council mode, have work divided and dispatched, approve a permission request with read-back, drop into Direct mode with one session — with zero laptop interaction.
- ElevenLabs never receives file contents or diffs; relay never stores plaintext tool payloads.
- Destructive approvals require confirm phrases; no permanent rules writable by voice.
- Relay is multiuser, on the suite's hosted project, and self-hostable.

## 11. Out of scope (v1)

Custom self-hosted voice pipeline (Pipecat/LiveKit — architecture stays provider-agnostic for a later OSS backend). "Always allow" by voice. Multi-human calls. Apple Watch / wearables. Naming (candidate "the Comm" parked — revisit in the suite-naming session).
