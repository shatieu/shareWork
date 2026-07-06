---
id: bridge-phase-3-ship-inbox-ship-spec-5-9-3
date: 2026-07-06
package: 06-bridge-phase3
branch: ship-wave1-bridge3
---

# Bridge phase 3 — ship-inbox (Ship_Spec §5 / §9.3)

The Ship's human-action inbox: one Deck page aggregating everything that needs a human.

- **`packages/ship-inbox`** (new): permission-request queue + agent questions in
  `~/.ship/inbox.db` (WAL); long-poll decision channel; lazy expiry; standalone `ship-inbox`
  bin (port 4320); `hookEventConsumer` claiming Notification + PermissionRequest from
  ship-log's ingest fan-out; one-page aggregation pulling Chart Room's ask-me/actions through
  the new chartroom `listInbox` contract.
- **Always-allow** writes a NATIVE permission rule into the project's
  `.claude/settings.local.json`: validation-first, malformed-refusal, additive-only with
  post-check, JSON round-trip validation, timestamped backup beside the file, atomic
  tmp+rename replace, concurrent-merge retry — each with dedicated tests.
- **`plugins/crew/hooks/permission.mjs`** (new): PermissionRequest resolver — enqueue,
  long-poll (default 25 s, `SHIP_INBOX_WAIT_MS`), print the documented stdout decision JSON,
  fail-open with self-reported expiry. Stdlib `node:http` (undici + `process.exit()` crashes
  libuv on Windows).
- **Deck Inbox tab** (chartroom-ui): permission cards (allow/deny/always-allow with rule
  suggestion), agent questions (dismiss), docs section; `#/inbox` becomes the Inbox tab under
  the hull, falls back to the docs-content InboxPage standalone; badge counts everything.
- Live proof: real `claude -p` denial → always-allow rule written via the inbox API → rerun
  executes with zero denials. This session's own interactive `permission_prompt` Notification
  landed in the live inbox (nothing synthetic). Interactive PermissionRequest firing remains
  the documented manual seam (R1: the event never fires in `-p`).
