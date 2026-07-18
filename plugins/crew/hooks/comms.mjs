#!/usr/bin/env node
/**
 * The Crew plugin's ship-comms delivery hook (agent-comms plan §4 Option A): on every Stop event
 * (the cheap, per-turn boundary the plugin already hooks), poll the hull's
 * `GET /api/ship-comms/poll?session=<this session>` and hand any queued agent-to-agent messages
 * to the model as `additionalContext`, each line prefixed
 * `[ship-comms] message from <from_session>:`. Delivery latency is therefore "next hook event",
 * not instant -- documented in packages/ship-comms/README.md.
 *
 * Hard constraints (same charter as emit.mjs / permission.mjs):
 *  - Stdlib only -- a marketplace-distributed plugin resolves no workspace packages.
 *  - ALWAYS exits 0, and NEVER writes anything but the valid hookSpecificOutput JSON to stdout:
 *    hull down, no port, empty queue, bad payload -- all silent no-ops (fail-open).
 *  - No hull port discoverable in ~/.suite/services.json => no network attempt at all.
 *  - Tight timeout (2s): a delivery poll must never hold a turn boundary hostage.
 *
 * Loop guard: same SHIP_LOG_SUMMARIZER short-circuit as the sibling hooks.
 */
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Same literal as suite-conventions' DECK_CLIENT_HEADER (stdlib-only rule; ship-comms' routes
 * require it on every request, polls included). */
const DECK_CLIENT_HEADER = 'x-ship-deck';

const POLL_TIMEOUT_MS = 2_000;

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

/** Stdlib `node:http` instead of global fetch, ON PURPOSE -- same Windows teardown rationale as
 * permission.mjs (undici keep-alive vs process.exit races libuv handle close). */
function httpJson(method, url, { timeoutMs }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(
      url,
      { method, agent: false, headers: { [DECK_CLIENT_HEADER]: '1' } },
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
    req.end();
  });
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

  const sessionId = hookPayload.session_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    process.exit(0);
    return;
  }

  const port = readHullPort(homedir());
  if (port === undefined) {
    process.exit(0); // no hull discoverable -> no poll, no noise
    return;
  }

  let body;
  try {
    body = await httpJson(
      'GET',
      `http://127.0.0.1:${port}/api/ship-comms/poll?session=${encodeURIComponent(sessionId)}`,
      { timeoutMs: POLL_TIMEOUT_MS },
    );
  } catch {
    process.exit(0); // hull down/slow/refusing -> silent no-op; messages stay queued durably
    return;
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    process.exit(0);
    return;
  }

  const lines = messages
    .filter((m) => typeof m?.text === 'string')
    .map((m) => `[ship-comms] message from ${m.fromSession ?? 'unknown'}: ${m.text}`);
  if (lines.length === 0) {
    process.exit(0);
    return;
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: hookPayload.hook_event_name ?? 'Stop',
        additionalContext: lines.join('\n'),
      },
    }),
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ship-crew comms.mjs: unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
