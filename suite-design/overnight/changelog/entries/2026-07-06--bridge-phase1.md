---
id: package-4-bridge-phase1
---

# Package 4 — Bridge phase 1: Crew plugin skeleton + http hooks + ship-log changelog capture

The Ship's memory switched on (Ship_Spec §4, §2 http hooks, §7 skeleton; §9 build-order item 1).

New `plugins/crew` — the `ship-crew` Claude Code plugin, phase-1 payload: `hooks/hooks.json`
registers SessionStart/Stop/SessionEnd (+ Notification/TaskCreated/TaskCompleted as
forward-events) against `hooks/emit.mjs`, a stdlib-only, always-exit-0 http-hook emitter that
POSTs each event (wrapped in a `v:1` wire envelope) to the hull's `/api/ship-log/events` with a
700 ms abort budget — researcher R3 measured only ~1.4 s of SessionEnd exit grace, so the
originally planned 1.5 s timeout was cut — and appends to `~/.ship/spool/events.jsonl` on any
failure. `PermissionRequest` is deliberately NOT registered (needs package 6's blocking emitter).
Loop guard: the summarizer's own child sessions carry `SHIP_LOG_SUMMARIZER=1`, which emit.mjs
short-circuits on. A local marketplace manifest (`plugins/.claude-plugin/marketplace.json`)
enables `claude plugin install ship-crew@sharework` tonight; Harbor distribution is a later rail.

New `packages/ship-log` — the changelog service: better-sqlite3 WAL truth store at
`~/.ship/log.db` (sessions/entries/rollups), capture pipeline (SessionStart snapshots repo
context, Stop checkpoints, SessionEnd captures: git delta via argv-spawned `git`, defensive
transcript tail, Haiku summary via `claude -p --model haiku` behind an injected `Summarizer`
interface with a deterministic commit-subjects fallback, orphan sweep for crashed sessions),
create-only (`wx`) in-repo fragments `changelog/entries/<date>--<slug>--<session8>.md` with
Chart-Room-indexable `id:` frontmatter, one-Haiku-call daily rollups, spool drain on start
(rename-claim, drained files renamed never deleted), station mounted into `ship serve`
(`/api/ship-log/events|entries|rollup/:date|health`, same `x-ship-deck` CSRF posture), and a
standalone `ship-log` bin (`capture`/`rollup`/`build`/`serve`). Windows discovery: npm's
`claude` shim is not spawnable, so the summarizer resolves the nested native `claude.exe` off
PATH (`SHIP_LOG_CLAUDE_PATH` override documented).

`suite-conventions` gained the additive raw-wire `hookEventEnvelopeSchema`/`HookEventEnvelope`
(the CLI's real snake_case stdin shape, R1-verified) alongside the existing normalized
`ShipHookEvent` union. Root `pnpm-workspace.yaml` allowlists better-sqlite3's build script
(pnpm-10 `onlyBuiltDependencies`; pnpm-11 migration note inline).

Acceptance held both ways: deterministic `packages/ship-log/acceptance/two-repo-log.mjs`
(isolated HOME, real hull + real emitter, two scratch repos → one fragment + entry each, rollup
covering both, hull-down → spool → restart drains into a third entry) and live on this machine —
two real `claude -p --model haiku` sessions produced real-Haiku fragments + a real rollup digest
naming every project. Dogfood is ON: `ship-crew` is project-scope enabled for shareWork itself;
the first live fragment (`changelog/entries/2026-07-06--ship-wave1-bridge1--16bbcd68.md`) is
committed. 75 ship-log tests; suite floors held (chartroom 268, chartroom-ui 172, ship 13).
