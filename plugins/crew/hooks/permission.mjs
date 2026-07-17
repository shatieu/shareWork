#!/usr/bin/env node
/**
 * The Crew plugin's PermissionRequest resolver hook (Ship_Spec §5; plan 06-bridge-phase3 §1.3).
 * Runs when Claude Code raises a permission dialog (INTERACTIVE sessions only -- researcher R1
 * verified the event does not fire in `-p` mode): it queues the request on the Ship's inbox and
 * long-polls for the human's browser decision. When one arrives in time it resolves the dialog
 * by printing the documented decision JSON on stdout; otherwise it prints NOTHING and exits 0,
 * so the native terminal dialog proceeds exactly as if this hook did not exist (fail-open).
 *
 * Hard constraints (same charter as emit.mjs):
 *  - Stdlib only -- a marketplace-distributed plugin resolves no workspace packages.
 *  - ALWAYS exits 0, and NEVER writes anything but a valid decision object to stdout: on the
 *    PermissionRequest event, exit 0 + stdout is parsed for JSON decisions -- garbage on stdout
 *    is the one way a "logging" branch could break a session.
 *  - Deliberately SHORT default deadline (SHIP_INBOX_WAIT_MS, default 25 000 ms): whether the
 *    terminal dialog renders while a PermissionRequest hook blocks is empirically UNVERIFIED
 *    (headless verification is impossible; see the package README's manual-verification
 *    section). Worst case under the unfavorable answer, the terminal waits this long before
 *    the native dialog appears -- browser-first users raise the env var.
 *  - No spooling: a live prompt cannot be resolved later. On timeout the resolver reports its
 *    own expiry (best-effort) so the inbox never shows a dead Allow button.
 *
 * Loop guard: same SHIP_LOG_SUMMARIZER short-circuit as emit.mjs -- the ship-log summarizer's
 * child session must never enqueue permission requests of its own.
 */
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Same literal as suite-conventions' DECK_CLIENT_HEADER (stdlib-only rule; the compile-time
 * cross-check lives in ship-inbox's resolver test, which drives this exact file). */
const DECK_CLIENT_HEADER = 'x-ship-deck';

const CREATE_TIMEOUT_MS = 1_500;
const POLL_SLICE_MS = 10_000;
const DEFAULT_DEADLINE_MS = 25_000;

function readHullPort(homeDir) {
  const path = join(homeDir, '.suite', 'services.json');
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const port = parsed?.hull?.port;
    return typeof port === 'number' ? port : undefined;
  } catch {
    return undefined;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

/**
 * Stdlib `node:http` instead of global fetch, ON PURPOSE: undici's keep-alive pool + abort
 * timers race libuv handle teardown when a short-lived script calls `process.exit()` on Windows
 * ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", reproduced empirically against
 * Node 24.14 in this package's resolver tests). `agent: false` gives every request its own
 * socket, closed when the response ends -- nothing is left for exit to trip over.
 */
function httpJson(method, url, { body, timeoutMs }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(
      url,
      {
        method,
        agent: false,
        headers: { 'content-type': 'application/json', [DECK_CLIENT_HEADER]: '1' },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
            rejectPromise(new Error(`status ${res.statusCode}`));
            return;
          }
          try {
            resolvePromise(data ? JSON.parse(data) : {});
          } catch (err) {
            rejectPromise(err);
          }
        });
      },
    );
    req.on('error', rejectPromise);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

/** The documented PermissionRequest resolution contract (researcher R1): exit 0 + this exact
 * stdout shape. Kept minimal on purpose -- behavior only, no invented fields.
 *
 * Verified against the hooks docs 2026-07-17
 * (code.claude.com/docs/en/hooks.md#PermissionRequest): the decision object supports ONLY
 * `behavior` plus an optional `updatedInput` when allowing -- there is NO message/reason field
 * (PreToolUse's `permissionDecisionReason` has no PermissionRequest counterpart). The inbox's
 * stored decision `message` therefore CANNOT ride this JSON; a deny note typed in the Deck is
 * instead delivered to the session's transcript by ship-inbox via ship-voice's send_to_session
 * (see ship-inbox station.ts, decision route), so this hook stays behavior-only by contract,
 * not by omission. */
function printDecision(behavior) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior },
      },
    }),
  );
}

async function main() {
  if (process.env.SHIP_LOG_SUMMARIZER === '1') {
    process.exit(0);
    return;
  }

  const raw = await readStdin();
  let hookPayload;
  try {
    hookPayload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
    return;
  }

  const port = readHullPort(homedir());
  if (port === undefined) {
    process.exit(0); // no hull -> native dialog handles it
    return;
  }
  const base = `http://127.0.0.1:${port}/api/ship-inbox/permissions`;

  let requestId;
  try {
    const created = await httpJson('POST', base, {
      body: {
        sessionId: hookPayload.session_id ?? '',
        cwd: hookPayload.cwd ?? process.cwd(),
        toolName: hookPayload.tool_name ?? 'Unknown',
        toolInput: hookPayload.tool_input,
      },
      timeoutMs: CREATE_TIMEOUT_MS,
    });
    requestId = created?.id;
  } catch {
    process.exit(0); // hull down/slow -> fail open
    return;
  }
  if (typeof requestId !== 'string') {
    process.exit(0);
    return;
  }

  const envDeadline = Number(process.env.SHIP_INBOX_WAIT_MS);
  const deadlineMs = Number.isFinite(envDeadline) && envDeadline > 0 ? envDeadline : DEFAULT_DEADLINE_MS;
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    const slice = Math.min(POLL_SLICE_MS, deadline - Date.now());
    try {
      const body = await httpJson('GET', `${base}/${requestId}/decision?waitMs=${slice}`, {
        timeoutMs: slice + 5_000,
      });
      if (body.status === 'allowed' || body.status === 'denied') {
        printDecision(body.status === 'allowed' ? 'allow' : 'deny');
        process.exit(0);
        return;
      }
      if (body.status === 'expired') break;
    } catch {
      break; // queue gone / network trouble -> fail open, don't burn the whole deadline
    }
  }

  // Timed out (or bailed): report expiry so the inbox never shows a dead Allow button.
  try {
    await httpJson('POST', `${base}/${requestId}/expire`, { body: {}, timeoutMs: CREATE_TIMEOUT_MS });
  } catch {
    /* lazy TTL is the fallback */
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ship-crew permission.mjs: unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
