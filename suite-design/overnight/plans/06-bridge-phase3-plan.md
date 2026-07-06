---
id: plan-06-bridge-phase3-ship-inbox
---

# Package 06 — Bridge phase 3: ship-inbox (Ship_Spec §5, build order §9.3)

Mode: COMBINED plan+implement (wrap-up order 2026-07-06 09:35). Branch `ship-wave1-bridge3`
off `ship-wave1` @ dd5b41f. Difficulty L, ~8h guess.

**Acceptance line (§9.3):** "a vanilla session's permission prompt is answered from the
browser; 'always allow' writes a native rule that suppresses the next prompt."

**Governing verified fact (researcher R1):** `PermissionRequest` does NOT fire in `claude -p`
— interactive-only. Design splits the acceptance into (a) mechanics provable headlessly with
the real hook script + real transport, and (b) the interactive firing leg, shipped as a
documented seam with exact manual verification steps. The rule-suppresses-next-prompt half IS
provable headlessly (R1's permission_denials method) and will be proven live.

## 1. Scope

### 1.1 `packages/ship-inbox` (new package, pattern = ship-ledger)

- `src/db.ts` — better-sqlite3 WAL `~/.ship/inbox.db` (injected `homeDir` everywhere).
  - `permission_requests(id uuid PK, session_id, cwd, project, tool_name, tool_input_json,
    source 'resolver'|'hook', status 'pending'|'allowed'|'denied'|'expired', decision_message,
    always_allow_rule, rule_backup_path, created_at, decided_at)`.
  - `agent_questions(id uuid PK, session_id, cwd, project, kind, message,
    status 'open'|'acknowledged', created_at, acked_at)` — kind = raw `notification_type`;
    ALL Notification envelopes stored (UI labels known kinds; nothing dropped once ship-inbox
    claims the event away from ship-log's unknown sidecar). Dedupe: identical open
    (session_id, kind, message) rows are not re-inserted.
  - Lazy expiry: pending permission requests older than TTL (default 10 min) flip to
    'expired' on read — the resolver hook is long gone by then; stale actionables lie.
- `src/settings-writer.ts` — **the FO-named risk**: `applyAlwaysAllowRule({projectDir, rule})`
  writing `<projectDir>/.claude/settings.local.json`. Non-negotiables, each with dedicated
  tests + a distinct report section:
  1. **Validate before touching anything**: rule matches `^[A-Za-z][A-Za-z0-9_ -]*(\(.*\))?$`,
     ≤500 chars, no control chars; `projectDir` must exist.
  2. **Malformed = refuse**: existing file that fails `JSON.parse`, or non-object root /
     `permissions` / non-string-array `permissions.allow` → typed error, file untouched,
     no backup written, no tmp left behind.
  3. **Additive-only by construction + post-check**: only appends to `permissions.allow`
     (dedupes); every other key/rule deep-equal-verified preserved before replace.
  4. **JSON round-trip validation before replace**: serialize → parse → re-verify invariant
     against the originally parsed object.
  5. **Timestamped backup beside it**: `settings.local.json.bak-<compact-ISO>[-n]` written
     from the original bytes before replace (missing file → created, no backup).
  6. **Atomic replace**: write `*.tmp-<pid>-<rand>` in the same dir, `renameSync` over
     (MOVEFILE_REPLACE_EXISTING on win32).
  7. **Concurrent-modification retry**: before rename, re-read; bytes changed since first
     read → re-merge from the NEW content and retry (bounded, 3 attempts; injectable
     `onBeforeReplace` test hook proves the merged result contains both writers' rules).
  Documented limitation: rewrite is 2-space JSON (formatting not preserved); read-check-rename
  is not an OS-level lock — honest local-tool posture, stated in README + report.
- `src/waiters.ts` — in-process long-poll registry: `Map<id, Set<resolver>>`; decision POST
  resolves all waiters for that id; per-request timeout returns 'pending'.
- `src/station.ts` — `StationDescriptor`, **tab `{id:'inbox', title:'Inbox'}`**. Routes
  (mutations behind `x-ship-deck`, hull Host-guard applies):
  - `POST /api/ship-inbox/permissions` → create pending (called by permission.mjs), 201 {id}.
  - `GET  /api/ship-inbox/permissions?status=` → list (lazy expiry applied).
  - `GET  /api/ship-inbox/permissions/:id/decision?waitMs=` → long-poll (cap 30s), returns
    `{status}` or `{status, behavior, message?}`.
  - `POST /api/ship-inbox/permissions/:id/decision` body
    `{behavior:'allow'|'deny', message?, alwaysAllowRule?}` — alwaysAllowRule runs the
    settings-writer FIRST; writer failure → 500, decision NOT recorded (human retries
    without the rule); success → decide + resolve waiters, backup path recorded/returned.
    409 on already-decided.
  - `GET /api/ship-inbox/questions?status=` / `POST /api/ship-inbox/questions/:id/ack`.
  - `GET /api/ship-inbox/items` — **the one page** (spec §5): pending permissions + open
    questions + Chart Room ask-me/actions via `ctx.getContract('chartroom','listInbox')`
    (undefined-safe: standalone = ship sections only).
  - `GET /api/ship-inbox/summary` (badge counts), `GET /api/ship-inbox/health`.
  - contracts: `hookEventConsumer` claiming `['Notification','PermissionRequest']`
    (Notification → questions; PermissionRequest arriving over ingest/spool → pending item,
    source 'hook'), plus `pendingCounts` (console seam, package 9).
- `src/cli.ts` — bin `ship-inbox`: `serve` (standalone, port 4320, Host-guard), `list`.
- `test/` — db, settings-writer (the named-risk suite), station (incl. long-poll), resolver
  script e2e (spawn real `permission.mjs` against a listening station on an ephemeral port).

### 1.2 `packages/chartroom` (additive)
- Extract `/api/inbox` aggregation into pure `collectInboxItems(repos)` (route reuses it);
  station gains contract `listInbox` returning the same shape. No route/UI behavior change.

### 1.3 `plugins/crew` (the PermissionRequest leg)
- New `hooks/permission.mjs` — stdlib-only, ALWAYS exits 0, SHIP_LOG_SUMMARIZER loop-guard,
  same services.json port discovery as emit.mjs. Flow: read stdin → POST create → long-poll
  decision (25s poll slices) until deadline `SHIP_INBOX_WAIT_MS` (default 25 000 ms —
  deliberately short: interactive dialog behavior while the hook blocks is UNVERIFIED, so
  worst case the terminal waits ~25s before the native dialog; browser-first users raise the
  env) → decided: print R1's documented decision JSON
  (`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":…}}}`)
  → deadline/hull-down: print nothing (native dialog proceeds; fail-open). No spooling — a
  live prompt can't be resolved later.
- `hooks/hooks.json`: add `PermissionRequest` → permission.mjs (NOT emit.mjs — no double
  ingestion). Notification stays on emit.mjs (transport → consumer fan-out).

### 1.4 `packages/ship-log` — default `consumerStations` gains `'ship-inbox'` (+test).
### 1.5 `packages/ship` — mount ship-inbox in serve.ts; deck-boot/integration expect 4 stations + inbox tab.
### 1.6 `packages/chartroom-ui` (Deck Inbox tab)
- `src/shipinbox/ShipInboxPage.tsx` (+ small cards): Permission queue (Allow / Deny /
  Always allow with pre-filled rule suggestion — bare tool name; `Bash(<verb>:*)` for
  Bash/PowerShell), Agent questions (kind chip + dismiss), Docs section (Chart Room items,
  existing deep-link behavior). Data: `/api/ship-inbox/items`; graceful absence.
- `src/api/client.ts`: fetchShipInboxItems/summary, decidePermission, ackQuestion
  (mutations send `x-ship-deck`).
- `App.tsx`: `#/inbox` routes to the Inbox tab when the hull mounts one (falls back to the
  existing docs-content InboxPage standalone); badge count = chartroom items + pending/open.
- tests mirroring existing inbox/voyage patterns.

## 2. Acceptance script + live proof

`packages/ship-inbox/acceptance/inbox-queue.mjs` (isolated HOME + scratch project):
1. Real `ship serve` boot; assert 4 stations, inbox tab listed.
2. Pipe R1-shaped Notification (`notification_type:"permission_prompt"`) through REAL
   `emit.mjs` → appears as open question; ack it.
3. Spawn REAL `permission.mjs` with R1-shaped PermissionRequest stdin → pending item appears
   → decide `allow` via the same HTTP call the browser makes → assert the script printed the
   documented decision JSON and exited 0 (browser-answers-prompt mechanics, whole chain minus
   interactive firing).
4. Deny path: second spawn, deny with message → script prints deny decision.
5. Always-allow path: decision with `alwaysAllowRule` → scratch project's
   `settings.local.json` gains the rule additively (pre-seeded deny rule + unknown key
   survive byte-checked), timestamped backup exists.
6. Hull-down: permission.mjs with no hull → exits 0, prints nothing.

Live proof (headless, ~2 haiku runs): scratch project, `claude -p --permission-mode default`
with a non-allowlisted command → `permission_denials` non-empty (R1 method); always-allow via
the inbox decision endpoint writes the native rule; rerun → tool executes, no denials.
Also observe whether Notification/permission_prompt fires in `-p` on 2.1.x (cheap; recorded
either way — dispatch treats docs as the source, I verify empirically and report plainly).

**Interactive seam (stated, not faked):** README section "Manual verification (interactive)"
with exact steps: hull up, scratch repo + `claude --plugin-dir plugins/crew --permission-mode
default`, trigger non-allowlisted tool, answer from `http://127.0.0.1:4317/#/inbox`, observe
the session proceed. Report lists this as NOT machine-verified this package.

## 3. Out of scope
Voice bridge, Tailscale, settings-manager UI, console fleet view (pkg 9), `updatedInput`
permission rewriting (allow/deny verbatim only), resolving Chart Room items from the inbox
page beyond deep-linking (answering stays on the doc page).

## 4. Risks / decisions
- Settings write = FO-named risk → handled per §1.1; if any invariant can't hold in code,
  STOP and flag (not ship).
- Interactive dialog-vs-blocking-hook UX unverifiable headlessly → short default deadline +
  env override; FYI note to DECISIONS-NEEDED (not blocking; seam documented).
- Claiming Notification removes those envelopes from ship-log's unknown sidecar → by design
  (they're now consumed); stated in report.
- No new deps beyond what ship-ledger already uses (better-sqlite3, fastify, zod, commander).

## 5. Gates
Full `pnpm turbo build lint test --force` (floors: chartroom 268, chartroom-ui 172+, ship 14+,
ship-log 81+, suite-conventions 35, ship-ledger 35, ship-inbox new), all acceptance scripts
(existing three + new inbox-queue.mjs), live proof, changelog fragment, report.
