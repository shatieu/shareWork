---
id: agent-to-agent-communication-status-and-plan
---

# Agent-to-Agent Communication — Status and Plan

Package F navigator deliverable. Research only — no implementation decided here; the Captain
chooses. Every fact carries a `file:line` pointer. Sibling project studied:
`C:\thisismydesign\claude-peers-mcp-main` (v0.1.0 snapshot, no git history — unpacked GitHub
`-main` archive of louislva/claude-peers-mcp; `package.json:3`).

Environment facts verified on this machine (2026-07-16): Claude Code **2.1.211** (channels need
>= 2.1.80 per claude-peers README:119), Bun **1.3.11**, Node **v24.14.0**.

---

## 1. Current status (this suite)

No direct, symmetric agent<->agent messaging channel exists today. What exists:

### 1.1 Crew exchange files — the only sanctioned agent->agent data handoff
- Protocol: `.ship-crew/exchange/<package>/` holds short-lived handoff files (navigator
  `findings.md` with file:line pointers, shared `contracts`), deleted when the package closes
  (`plugins/crew/skills/crew/SKILL.md:44-62`).
- Transport: shared filesystem. Addressing: package directory name. Delivery: none — readers
  are *pointed at* the file in their dispatch prompt; no notification.
- Scope: same-repo, same-mission subagents only. Live example:
  `.ship-crew/exchange/chapel-tab/findings.md` (only current occupant, verified 2026-07-16).

### 1.2 ship-voice FleetControl — one-way, fire-and-forget "send"
- Discovery: `claude agents --json` lists live sessions (sessionId, name, cwd, kind, state,
  status, pid) — `packages/ship-voice/src/fleet.ts:8-14,85-105`. **The suite already has peer
  discovery via the vendor CLI** — this is what claude-peers builds a broker for.
- Send: spawns a *new detached headless process* `claude -p <text> --resume <sessionId>`
  (`fleet.ts:107-132`). This resumes the target session's transcript in a fresh process; it does
  NOT inject into the running interactive session's context. Fire-and-forget: no reply path
  ("supervisor peek/reply is phase 2+ territory", `fleet.ts:36-41`).
- Dispatch: `claude -p <task>` with cwd=<repo> spawns a brand-new headless session
  (`fleet.ts:134-137`).
- Fuzzy addressing by spoken name/repo-folder tokens: `resolveSessionName`, `fleet.ts:200-221`.

### 1.3 Hull event bus (ship-log ingest + hook emit) — one-way telemetry, not messaging
- Every crew hook event is POSTed to the hull at `/api/ship-log/events`
  (`plugins/crew/hooks/emit.mjs:106-120`), with a JSONL spool fallback at
  `~/.ship/spool/events.jsonl` when the hull is down (`packages/ship-log/src/spool.ts:70-73`).
- Consumers register per event name (`packages/ship-log/src/ingest.ts:34-40`); ship-inbox claims
  `Notification`/`PermissionRequest` (`packages/ship-inbox/src/station.ts:102-135`).
- Direction: agent -> hull -> UI/human. No path back into any session.

### 1.4 ship-inbox — human-mediated long-poll (permissions/questions)
- SQLite at `~/.ship/inbox.db`; the permission resolver hook long-polls
  `GET /permissions/:id/decision?waitMs=` against an in-memory waiter registry
  (`packages/ship-inbox/src/waiters.ts:1-16`); the browser's decision POST releases the waiter
  (`packages/ship-inbox/src/station.ts:253`; resolver loop `plugins/crew/hooks/permission.mjs:165-180`).
- This is the suite's only *blocking, bidirectional* channel — but the responder is a human, not
  an agent. The waiter/long-poll machinery is directly reusable for agent replies.

### 1.5 Voyage — broadcast state, one writer / many readers
- `progress.json` watched via chokidar; `GET /api/voyage` snapshot + SSE push at
  `/api/voyage/events` with 25s heartbeat (`packages/ship/src/voyage.ts:83-115,120-135`).
  Broadcast only; no point-to-point.

### 1.6 Chapel — asynchronous confess/dossier loop
- Any session can POST `/api/chapel/confess`; text is atomically written to
  `~/.ship/chaplain/inbox/<timestamp>.md` (`packages/ship/src/chapel.ts:112-140`); the chaplain
  session reads the inbox at startup and answers via dossier files. Async, not conversational.

### 1.7 Session spawning (not messaging)
- Chartroom daemon `POST /api/repos/:repoId/claude-session` opens a NEW detached terminal running
  `claude` (`packages/chartroom/src/daemon/routes/claude-session.ts:182-211`), with Claude env
  hygiene (`claude-session.ts:57-66`) and a reusable `spawnTerminal` contract
  (`claude-session.ts:159-168`). Human-facing launch surface, not a channel.

### Summary table

| Mechanism | Agent->Agent? | Pattern | Reply path |
|---|---|---|---|
| Crew exchange files | yes (same mission) | shared file, no delivery | none (dispatch prompt points at file) |
| ship-voice send | partial | new `claude -p --resume` process | none (phase 1) |
| Hull event bus | no | agent -> hull -> human | none |
| ship-inbox | no | agent <-> human long-poll | human decision |
| Voyage SSE | broadcast | 1 writer -> N readers | none |
| Chapel confess | partial | file drop -> async dossier | async, human-paced |

No `SendMessage`-style tool exists anywhere in the suite (recon grep, 2026-07-16).

---

## 2. How claude-peers does it

Small (~800 LOC total), Bun-based, two processes + SQLite:

- **Architecture** (`CLAUDE.md:11-17`, `README.md:71-87`): a singleton **broker daemon** on
  `127.0.0.1:7899` with SQLite at `~/.claude-peers.db` (`broker.ts:26-59`), plus one **stdio MCP
  server per Claude Code session** (`server.ts:1-14`) that auto-launches the broker if absent
  (`server.ts:67-92`).
- **Message store**: two tables — `peers` (id, pid, cwd, git_root, tty, summary, timestamps) and
  `messages` (from_id, to_id, text, sent_at, delivered flag) — `broker.ts:35-59`.
- **Discovery / registration**: MCP server POSTs `/register` at startup with pid/cwd/git_root
  (`server.ts:491-499`); broker issues a random 8-char peer id (`broker.ts:127-134`). Liveness =
  `process.kill(pid, 0)` probe on every list + a 30s stale sweep (`broker.ts:62-79,187-197`);
  15s heartbeats (`server.ts:523-531`); unregister on SIGINT/SIGTERM (`server.ts:534-549`).
- **Addressing**: peer id, discovered via `list_peers` with scope `machine | directory | repo`
  (git-root match covers worktrees) — `broker.ts:160-198`, tool schema `server.ts:169-186`.
- **Transport**: sender's MCP tool `send_message` -> broker HTTP `/send-message` -> row inserted
  undelivered (`broker.ts:200-209`). Receiver's MCP server polls `/poll-messages` every **1s**
  (`server.ts:39,520`) and pushes each message into the live session as a **`claude/channel`
  notification** (`notifications/claude/channel`, `server.ts:429-441`), declared as an
  experimental capability (`server.ts:147-149`). This is the key trick: the message lands in the
  session's context immediately, mid-task, without a human turn.
- **Behavioral contract**: MCP `instructions` tell the model to treat inbound channel messages
  like "a coworker tapping you on the shoulder" — reply immediately via `send_message`, then
  resume work (`server.ts:151-163`).
- **Fallback**: without channel mode, a manual `check_messages` tool polls (`server.ts:222-229`,
  `359-395`). A CLI can also inject messages from outside (`cli.ts:108-130`, `from_id: "cli"`).
- **Presence semantics**: `set_summary` tool + optional auto-summary via gpt-5.4-nano keyed on
  `OPENAI_API_KEY` (`shared/summarize.ts:10-69`) so `list_peers` shows what each peer is doing.
- **Operational requirements**: Claude Code >= 2.1.80, claude.ai login (channels don't work with
  API-key auth), and launching with `--dangerously-load-development-channels server:claude-peers`
  (`README.md:37-48,116-120`). Registered as a *user-scoped* MCP server so it exists in every
  session (`README.md:31`).
- **Windows caveats** (verified by reading, not running): tty detection shells out to `ps`
  (`server.ts:119-134`) — returns null on Windows, non-fatal; `kill-broker` uses `lsof`
  (`cli.ts:137`) — broken on Windows; `DB_PATH` uses `$HOME` (`broker.ts:27`) — undefined in
  plain PowerShell, fine under Git Bash/Bun which maps HOME. `process.kill(pid, 0)` liveness
  works on Windows. Bun 1.3.11 is installed here.

**Delivery status semantics**: at-most-once into a live session; messages are marked delivered
when *polled* (`broker.ts:211-220`), and undelivered messages to a dead peer are purged
(`broker.ts:71`). No persistence guarantee, no threads, no acks, no groups/broadcast.

---

## 3. Gap analysis

What claude-peers solved that this suite has not:

1. **Push delivery into a live session.** The suite has zero ways to get a message into a
   running session's context; claude-peers does it with channel notifications
   (`server.ts:429-441`). ship-voice's `claude -p --resume` (`fleet.ts:131-132`) creates a
   *sibling headless process* over the same transcript instead — the interactive session never
   sees the message.
2. **A reply path.** Suite channels are all one-way or human-mediated; claude-peers gives the
   receiver the sender's id + context and instructs it to reply (`server.ts:151-163`).
3. **Peer registry with liveness + presence.** The suite *has* discovery (`claude agents --json`,
   `fleet.ts:85-105` — arguably better than claude-peers' registry since it needs no
   registration step) but no summary/presence layer and no message routing keyed to it.

What this suite has that claude-peers lacks (do not lose these):

4. **Durable infrastructure**: a single hull daemon with stations, SQLite conventions, spool
   fallback (`spool.ts:70-73`), long-poll waiters (`waiters.ts:1-16`), SSE
   (`voyage.ts:89-115`), CSRF header discipline (`claude-session.ts:192-194`). claude-peers'
   broker is a redundant second daemon on this machine.
5. **Rich handoff semantics**: exchange files with file:line pointer contracts beat 1-line text
   messages for crew work (`SKILL.md:44-62`); token discipline is a design constraint here,
   absent there.
6. **Security posture**: claude-peers requires `--dangerously-skip-permissions`-adjacent flags
   and has no auth on the broker (any local process can send/register, `broker.ts:228-239`);
   the hull at least gates on the deck header.

Honest caveat: interruption-by-peer is a mixed blessing — a mid-task channel message consumes
the receiving session's context and attention; the crew protocol's file-based handoffs exist
precisely to protect token budgets (`SKILL.md:46-49`).

---

## 4. Improvement options (ranked)

### Option A — Hull-native comms station ("ship-comms") with hook-based delivery. Effort: M (2-4 days)
Add a station to the existing hull: `messages` table (from_session, to_session, text, delivered)
+ `POST /api/ship-comms/send` + `GET /api/ship-comms/poll?session=`, reusing the ship-inbox
waiter pattern (`waiters.ts:8-16`) for optional blocking sends. Addressing via
`claude agents --json` session ids the suite already resolves fuzzily (`fleet.ts:200-221`).
Delivery: a crew hook (same family as `emit.mjs`) polls for pending messages on hook fire and
returns them as `additionalContext`, so messages land at the next natural turn boundary — no
dangerous flags, no claude.ai-login dependency, Windows-native, fits station discipline.
Trade-off: delivery latency is "next hook event", not instant.

### Option B — Channel-push MCP layer on top of Option A. Effort: +S-M (1-2 days after A)
Port claude-peers' `server.ts` pattern (stdio MCP per session, `claude/channel` capability,
1s poll of the hull instead of a separate broker — `server.ts:144-165,404-449`). Gives instant
mid-task delivery and a `send_message`/`list_peers` tool surface. Costs: every session must run
with `--dangerously-load-development-channels`, claude.ai login required (`README.md:116-120`),
and the experimental channel protocol may change under us. Recommended as a later, opt-in
upgrade gated per-session, not the foundation.

### Option C — Adopt claude-peers as-is (spike). Effort: XS (hours)
`claude mcp add --scope user ... bun server.ts` + the channel flag (`README.md:31-39`). Fastest
way to *feel* the UX and validate channel push on 2.1.211/Windows. Costs: second daemon +
second SQLite outside `~/.ship/`, no deck-header auth, `lsof`/`$HOME` Windows rough edges
(`cli.ts:137`, `broker.ts:27`), duplicate discovery next to `claude agents --json`. Throwaway
learning, not the destination.

### Option D — Finish ship-voice phase 2 only (peek/reply). Effort: S (1-2 days)
Give `FleetControl.send` a reply path (await the spawned `claude -p --resume` stdout instead of
`stdio:'ignore'`, `fleet.ts:112-129`). Improves the voice flow but keeps the wrong primitive:
messages go to a transcript fork, never to the live session. Worth doing only as part of A
(re-point `send` at `/api/ship-comms/send`).

---

## 5. Recommendation

**A first, then B behind a flag; run C as a half-day spike before committing to B.**

Option A delivers the missing primitives (point-to-point send, durable store, reply path,
poll + long-poll) entirely inside existing hull/station/hook conventions with zero new daemons
and zero dangerous flags — and immediately upgrades ship-voice's send (Option D folds in).
Option B's channel push is the genuinely novel thing claude-peers proves, but it rides an
experimental protocol behind a `--dangerously-*` flag; validate it with the C spike and add it
as an opt-in delivery tier once A's store/routes exist. Keep exchange files as the bulk-payload
convention (messages carry pointers, not content — `SKILL.md:46-49`), so agent messaging stays
inside the crew's token discipline.

### Not verified / open questions
- Channel notifications on Windows + Claude Code 2.1.211: read in source (`server.ts:429-441`,
  `README.md:119`) but **not executed** — the C spike is the verification step.
- Exact semantics of `claude -p --resume <id>` against a *currently running* session (fork vs
  contention) — asserted from `fleet.ts:8-14` comments, not tested live.
- claude-peers upstream may have moved since this `-main` snapshot (no git metadata to date it).
