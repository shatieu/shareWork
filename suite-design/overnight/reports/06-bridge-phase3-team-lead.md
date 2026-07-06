---
id: report-06-bridge-phase3-team-lead
---

# Package 06 — Bridge phase 3 (ship-inbox: permission queue + Deck Inbox tab) — Team Lead report

Date: 2026-07-06 ~10:55–11:45. Mode: COMBINED plan+implement (wrap-up order, STATUS 09:35).
Branch `ship-wave1-bridge3` off `ship-wave1` @ dd5b41f. Plan:
`suite-design/overnight/plans/06-bridge-phase3-plan.md` (committed first; 3 deviations, all
recorded in the plan's §4b — none silent).

## What shipped (11 commits, oldest first)

    be831f8 docs(bridge3): package 6 plan
    cf506b6 feat(chartroom): listInbox station contract - in-process seam for ship-inbox aggregation
    048f9ed feat(ship-inbox): permission queue, agent questions, always-allow settings writer - db, station, waiters, bin
    ae5582c chore(ship-inbox): lockfile for new workspace package
    6b6e700 feat(crew): PermissionRequest resolver hook - queue create, long-poll, stdout decision, fail-open
    cbe92c1 feat(ship): mount ship-inbox station; fan Notification/PermissionRequest to it by default
    899054c feat(chartroom-ui): Deck Inbox tab - permission queue with always-allow, agent questions, docs aggregation
    f102f11 test(ship-inbox): end-to-end acceptance script
    f6ca129 docs(ship-inbox): README - writer guarantees, resolver deadline, manual-verification seam
    a9dd204 chore(dogfood): shareWork fragment captured by the live-proof hull
    9655af6 docs(bridge3): changelog fragment, plan deviations, decisions FYI

### New `packages/ship-inbox` (Ship_Spec §5)

- `src/db.ts` — better-sqlite3 WAL `~/.ship/inbox.db`; `permission_requests`
  (pending/allowed/denied/expired; source resolver|hook; tool name/input; decision + rule +
  backup-path fields) and `agent_questions` (raw `notification_type` as kind; ALL kinds stored,
  identical-open dedupe); lazy TTL expiry (default 10 min) on every read/decide path.
- `src/settings-writer.ts` — the always-allow writer (named risk; own section below).
- `src/waiters.ts` — in-process long-poll registry (decision POST releases parked GETs).
- `src/station.ts` — Deck tab `{id:'inbox', title:'Inbox'}`; routes `/api/ship-inbox/*`
  (create/list/decide/expire permissions incl. 30 s-capped long-poll GET; questions list/ack;
  `items` one-page aggregation; `summary`; `health`); mutations behind `x-ship-deck`; contracts
  `hookEventConsumer` (Notification + PermissionRequest) and `pendingCounts` (console seam).
- `src/cli.ts` — standalone bin: `serve` (4320, Host-guard), `list`.
- Chart Room questions pulled via NEW `chartroom` contract `listInbox`
  (`packages/chartroom/src/station.ts`; `/api/inbox` aggregation extracted to pure
  `collectInboxItems`, route unchanged — spec §2 discipline: contract lookup, no imports).

### Crew plugin: the PermissionRequest leg

- NEW `plugins/crew/hooks/permission.mjs` (stdlib-only, always exits 0, summarizer loop-guard):
  reads hook stdin → POST create → long-poll decision until `SHIP_INBOX_WAIT_MS` (default
  25 000 ms) → prints R1's documented decision JSON
  (`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":…}}}`) —
  or prints NOTHING, self-reports expiry (pending→expired; no dead Allow buttons), and exits 0
  (native dialog proceeds; fail-open). No spooling — a live prompt can't be resolved later.
- `hooks/hooks.json`: PermissionRequest → permission.mjs (emit.mjs deliberately NOT also
  registered — parallel hooks would double-create). Manifest test updated (per-event script
  assertion).

### Deck UI (chartroom-ui)

- `src/shipinbox/ShipInboxPage.tsx` + `PermissionCard.tsx`: permission cards
  (allow/deny/always-allow with editable rule input pre-filled by `suggestRule` — first-word
  `Bash(git:*)`-style for Bash/PowerShell, bare tool name otherwise), agent questions
  (dismiss), docs section (existing deep-link behavior); action errors keep the queue rendered.
- `App.tsx`: `#/inbox` routes to the Inbox TAB when the hull mounts one; standalone
  `chartroom serve` keeps the old docs-content InboxPage (no tab). Badge = ship summary total
  (permissions+questions+docs), falling back to docs-only count standalone.
- `api/client.ts`: fetchShipInboxItems/Summary, decideShipPermission, ackShipQuestion.

### Wiring

- `ship-log` default `consumerStations` = `['ship-ledger','ship-inbox']` (names, not imports).
- `ship` serve mounts 4 stations; deck-boot asserts 4 + Inbox tab + items-shape; new hull
  integration test: Notification envelope → ship-log ingest → inbox question + one-page
  aggregation with chartroom items.

## Named-risk section: the `.claude/settings.local.json` writer — proof per requirement

All in `packages/ship-inbox/src/settings-writer.ts`; tests
`test/settings-writer.test.ts` (20) + station-level (3) + acceptance phase 5 + live proof.

1. **Atomic write + timestamped backup beside it** — same-dir `*.tmp-<pid>-<rand>` then
   `renameSync` over (MOVEFILE_REPLACE_EXISTING); backup `settings.local.json.bak-<stamp>[-n]`
   written from the ORIGINAL bytes before replace, never overwritten, never deleted. Tests:
   "writes a timestamped backup of the ORIGINAL bytes", "never overwrites an existing backup",
   "leaves no tmp file behind"; acceptance asserts backup exists + contains pre-decision bytes
   + zero `.tmp-*` leftovers.
2. **Additive-only** — merge appends exactly one rule to `permissions.allow` (dedupe =
   no-op, no write, no backup churn); post-check verifies every other top-level key,
   permissions key, and the allow prefix are JSON-identical to the original, in BOTH directions
   (nothing changed, nothing appeared). Tests: "appends… preserving every other rule and key
   verbatim" (deny/ask/additionalDirectories/env/unknownFutureKey survive), idempotence;
   acceptance phase 5 byte-checks a pre-seeded deny rule + unknown key.
3. **JSON round-trip before replace** — serialized text is re-parsed and the additive
   invariant re-verified against the ORIGINAL parse; violation = typed `additive-violation`
   abort. (Deliberate consequence: file is rewritten as 2-space JSON; documented in README.)
4. **Malformed cases** — invalid JSON / array root / non-object `permissions` / non-string
   `allow` → typed `malformed-settings` REFUSAL: file byte-identical, no backup, no tmp
   (dir-listing asserted). Station level: 500 + code, decision NOT recorded, request stays
   pending/actionable (test: "a failed rule write records NO decision").
5. **Concurrent cases** — re-read immediately before replace; changed bytes → re-merge from
   the NEW content (test proves both writers' rules + the concurrent deny survive); never-quiet
   file → typed `concurrent-conflict` after 3 attempts with the other writer's last state
   intact. Honest limit stated (README + code): re-read+rename is not an OS lock.
6. **Validation first** — rule regex + control-char + length checks and project-dir existence
   before ANY filesystem effect; server route re-validates (bad rule → 400 `invalid-rule`).
   `alwaysAllowRule` requires `behavior:"allow"` (400 otherwise).

## Gates (all run this session, `--force`, no cache)

- `pnpm turbo build lint test --force`: **23/23 tasks green**. Counts: chartroom **269**
  (floor 268; +1 listInbox contract), chartroom-ui **180** (172; +8 ShipInboxPage/suggestRule),
  ship **15** (14; +1 hull inbox fan-out integration), ship-log **81** (81; manifest test
  updated in place), suite-conventions **35**, ship-ledger **35**, ship-inbox **51** new
  (db 8, settings-writer 20, station 15, waiters 2, resolver-e2e 6).
- Acceptance scripts, all passing: NEW `packages/ship-inbox/acceptance/inbox-queue.mjs`
  (real `ship serve`, real emit.mjs Notification → question → ack, real permission.mjs
  allow/deny/always-allow resolved via the browser's exact HTTP calls, additive+backup
  byte-checks, no-hull fail-open) + existing deck-boot.mjs / ledger-mcp-mirror.mjs /
  two-repo-log.mjs (no regressions).

## Live proof (headless, ~$0.06 haiku total)

- Hull on real home (4317, 4 stations). Scratch project in session scratchpad.
- **Run A** `claude -p --permission-mode default`: command denied —
  `permission_denials: [{tool_name:"PowerShell", command:"node -e …"}]` (R1's Windows
  tool-name note confirmed live). Cost $0.0244.
- **Always-allow through the product**: POST create + decision
  `{behavior:"allow", alwaysAllowRule:"PowerShell(node:*)"}` → scratch
  `.claude/settings.local.json` gained exactly that rule.
- **Run B** same command: executed (`inbox-live-proof` printed), `permission_denials: []`.
  Cost $0.0153. **Spec §9.3's "always allow writes a native rule that suppresses the next
  prompt" is demonstrated live.**
- **Zero-synthetic Notification proof**: THIS working session's own interactive
  `permission_prompt` Notification arrived in the live inbox
  (question 90f1ee6b, sessionId = this session) via plugin→emit→hull→consumer; acked via API.
- **Run C** (`-p` + `--plugin-dir`, denial): NO PermissionRequest and NO
  Notification/permission_prompt reached the hull — R1 refined: in `-p`, a denial emits
  neither event; the "headless-visible signal" means visible to the hull FROM interactive
  sessions. Cost $0.0161.
- Teardown: hull killed; stale `~/.suite/services.json` hull entry + `~/.chartroom/daemon.json`
  hand-cleared (pkg-4/5 precedent); dogfood fragment committed (a9dd204).

## NOT proven / honest limits (the stated seam)

- **Interactive PermissionRequest firing + browser resolution of a live tty prompt**: NOT
  machine-verifiable (R1: event is interactive-only; no tty harness). The entire chain minus
  that firing is proven (resolver e2e + acceptance drive the real script against the real
  hull). Exact manual steps: `packages/ship-inbox/README.md` § "Manual verification
  (interactive)" — 7 steps incl. the timeout leg and what to watch for (dialog-while-blocked
  question feeds the 25 s default; DECISIONS-NEEDED FYI 1).
- Deny stdout carries `behavior` only (no message field — unverified schema; FYI 2).
- Whether an interactive session's dialog renders while the hook blocks: unknown until the
  manual pass (hedged by the short deadline).
- Non-Windows paths untested on this box (standing caveat).

## Constraints audit

- Nothing deleted in-repo (REMOVALS.md untouched); the two hand-cleared files are user-home
  runtime discovery leftovers of the hard-killed live-proof hull, per pkg-4/5 precedent.
- `team-tasks/` untouched: `git log --stat ship-wave1..HEAD -- team-tasks/` is EMPTY. Captain's
  dirty team-tasks files + `suite-design/Chart Room.html` left strictly alone.
- No new dependencies beyond the ship-ledger set (better-sqlite3/fastify/zod/commander); no
  merges, no pushes; HEAD left on `ship-wave1-bridge3` @ 9655af6.

## Files of record

- Plan (+§4b deviations): `suite-design/overnight/plans/06-bridge-phase3-plan.md`
- Changelog fragment: `suite-design/overnight/changelog/entries/2026-07-06--bridge-phase3.md`
- DECISIONS-NEEDED: package-6 FYI section (resolver deadline, deny-message field)
- Package: `packages/ship-inbox/` (+README with the manual seam)
