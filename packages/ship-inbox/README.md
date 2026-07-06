---
id: ship-inbox
---

# ship-inbox

The Ship's **human-action inbox** (Ship_Spec §5, Bridge phase 3): one page aggregating
everything that needs a human across all projects.

- **Permission requests** — the Crew plugin's `PermissionRequest` hook
  (`plugins/crew/hooks/permission.mjs`) queues the request here and long-polls for a decision;
  Allow/Deny from the Deck's Inbox tab resolves the live prompt inside the session via the
  hook's stdout decision JSON.
- **Agent questions** — `Notification` hook events (`agent_needs_input`, `permission_prompt`,
  …) arriving over ship-log's ingest transport and fanned in through the `hookEventConsumer`
  contract. Every notification kind is stored; dismiss ("ack") from the page.
- **Docs needing you** — Chart Room's unanswered `:::ask-me` questions and open `:::actions`
  items, pulled in-process through chartroom's `listInbox` station contract (answering stays on
  the doc page; the inbox deep-links).
- **"Always allow"** — writes a **native permission rule** into that project's
  `.claude/settings.local.json` under `permissions.allow`. Claude Code itself is the rule
  engine; the Ship stores nothing.

## Runtime

Mounted into `ship serve` as a Deck station (owns the **Inbox** tab). Standalone degraded mode:
`ship-inbox serve` (default port 4320, 127.0.0.1 only, no Deck, no Chart Room section) and
`ship-inbox list`. Storage: `~/.ship/inbox.db` (better-sqlite3, WAL).

Mutating routes require the `x-ship-deck` local-client header (the hull's CSRF posture); the
whole API is loopback-only behind the hull's Host-allowlist guard.

## The always-allow writer (`src/settings-writer.ts`)

This is the package's one live-config surface, engineered defensively:

1. Rule + project dir validated before any file is touched.
2. A malformed existing `settings.local.json` is **refused** (typed error, zero writes, no
   backup, no tmp file) — never coerced, never guessed at.
3. **Additive-only**: the merged document is verified to be exactly the original plus the one
   appended allow rule; any other difference aborts the write.
4. JSON **round-trip validation** (serialize → re-parse → re-verify) before replacing.
5. A **timestamped backup** of the original bytes is written beside the file first
   (`settings.local.json.bak-<stamp>`; never overwritten, never deleted).
6. **Atomic replace**: same-directory tmp file + rename.
7. **Concurrent-modification retry**: bytes re-read just before the replace; a concurrent
   writer's changes are re-merged, never clobbered (bounded retries, then a typed error).

Known limits (by design, documented rather than hidden): the file is rewritten as
2-space-indented JSON (original formatting is not preserved); re-read+rename is not an OS-level
lock — bounded retries + additive semantics cover the realistic local single-human window.

## Resolver deadline

`permission.mjs` waits `SHIP_INBOX_WAIT_MS` (default **25 000 ms**) for a browser decision,
then reports its own expiry and exits silently (the native terminal dialog proceeds — fail
open). The default is deliberately short: whether the terminal dialog renders *while* a
PermissionRequest hook blocks is empirically unverified (below). If you work browser-first,
raise it, e.g. `SHIP_INBOX_WAIT_MS=300000` in your environment.

## Manual verification (interactive) — the seam this package cannot prove headlessly

`PermissionRequest` hooks fire **only in interactive sessions**, never in `claude -p`
(verified empirically, report `04-bridge-phase1-researcher.md` R1). Everything short of that
firing is machine-verified in `acceptance/inbox-queue.mjs` (the real resolver script against a
real hull, decided by the same HTTP calls the browser makes). To verify the last leg by hand:

1. Build + start the hull: `pnpm --filter ship build && node packages/ship/dist/cli.js serve`.
2. In a scratch repo (NOT this one), start an interactive session with the plugin and default
   permissions: `claude --plugin-dir <repo>/plugins/crew --permission-mode default`.
3. Ask it to run something not allowlisted, e.g. "run `git push --dry-run`".
4. When the permission prompt raises, open `http://127.0.0.1:4317/#/inbox` — the request should
   be listed within a second or two.
5. Click **allow** (or **deny**) in the browser within 25 s of the prompt. Expected: the
   session proceeds (or refuses) WITHOUT you touching the terminal.
6. Repeat with **always allow…** and rule `Bash(git push:*)`: the scratch repo gains the rule
   in `.claude/settings.local.json` (plus a `.bak-*` beside it) and the next `git push
   --dry-run` runs with no prompt at all.
7. Also observe the timeout leg: trigger a prompt, answer nothing for 25 s — the terminal
   dialog must remain fully usable and the inbox row must flip to `expired`.

If step 5 shows the terminal dialog *suppressed* while the hook blocks, consider raising the
default deadline (`DECISIONS-NEEDED`): the short default exists purely as a hedge against the
unfavorable answer.

## pnpm note

better-sqlite3 needs its build script allowlisted: `onlyBuiltDependencies: [better-sqlite3]`
in `pnpm-workspace.yaml` (pnpm 10; pnpm 11 renames it `allowBuilds` — see report 04 R4).
