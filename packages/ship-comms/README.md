---
id: ship-comms
---

# ship-comms

Hull-native agent-to-agent messaging — the agent-comms plan's **Option A** (hull comms station
with hook-based delivery). A durable point-to-point message store with pull delivery; no new
daemons, no experimental channel flags.

## What it is

- **Store**: SQLite at `~/.ship/ship-comms.db`, one `messages` table
  (`id, from_session, to_session, text, created_at, delivered_at`).
- **Routes** (all under `/api/ship-comms/*`, all requiring the `x-ship-deck` local-client
  header — messages are session-addressed data, so even reads are gated):
  - `POST /send {from?, to, text}` — `to` is an **exact session id** (UUID; stored verbatim,
    store-and-forward, no liveness check) or a **name** resolved against the live fleet via the
    `ship-voice.fleetSource` contract. Name resolution fails honestly: a tie answers
    `409 + candidates`, no match `404`, no readable fleet `503` — never a guessed delivery.
  - `GET /poll?session=<id>[&waitMs=<n>]` — returns undelivered messages for that session and
    marks them delivered (one transaction; at-most-once — a crash between the mark and the
    response can drop a message, an accepted millisecond-scale window since messages carry
    pointers, not payloads). `waitMs` long-polls up to 30 s using
    the ship-inbox waiter pattern: a send addressed to the session wakes the parked poll.
  - `GET /history?session=<id>` — both directions, delivered included, oldest-first.
  - `GET /health` — db path, parked waiters, undelivered count.
- **In-process contract**: `getContract('ship-comms', 'sendMessage')` gives sibling stations the
  same resolution + store + waiter-wake path without HTTP.

## Delivery — honest latency

Delivery is **pull-based**. The Crew plugin's `comms.mjs` hook (registered on the `Stop` event)
polls `/api/ship-comms/poll` for its own session and injects anything queued as
`additionalContext` prefixed `[ship-comms] message from <from_session>:`.

That means messages land at the **next hook event (a turn boundary), not instantly**:

- A session mid-turn sees the message when its current turn ends (its `Stop` hook fires).
- A session sitting idle sees it only when it next does something that fires a hook (e.g. the
  human sends a prompt). Nothing pushes into a live session's context mid-task — that is
  Option B (channel push), a separately-gated later lane.
- Hull down = the hook is a silent no-op (fail-open, ~2 s ceiling); messages stay queued in
  SQLite until a later poll succeeds.

Keep payloads small: per the crew convention, messages carry **pointers, not content** — put
bulk material in an exchange file and send its path.
