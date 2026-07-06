#!/usr/bin/env node
/**
 * The Crew plugin's http-hook emitter (Ship_Spec §2/§7; plan 04-bridge-phase1 §3.2). This file IS
 * the suite's "http hooks" -- every Claude Code hook event the plugin registers (`hooks.json`)
 * runs this exact script, stdin = the hook's raw JSON payload.
 *
 * Hard constraints, non-negotiable:
 *  - Stdlib only (node:fs, node:os, node:path, global fetch/AbortSignal). A plugin distributed by
 *    a marketplace cannot resolve workspace packages (no `suite-conventions`, no `ship-log`) --
 *    everything this file needs to know is duplicated here as a small literal.
 *  - ALWAYS exits 0. A logging hook must never block or degrade a session (fail-open). Every
 *    branch below is wrapped so an unexpected internal error still exits 0 (stderr only, visible
 *    in `claude --debug`, never blocking).
 *  - Fast. report 04-bridge-phase1-researcher.md R3 (empirical): a `-p` session's SessionEnd
 *    hooks get only ~1.3-1.5s of exit grace before Claude Code cancels them outright -- so the
 *    HTTP attempt uses a short abort timeout (700ms, comfortably under that budget) and the
 *    spool-append fallback is a synchronous, near-instant fs write.
 *
 * Loop guard (plan §8 risk 1): ship-log's own summarizer runs `claude -p` with the env marker
 * SHIP_LOG_SUMMARIZER=1 set on the child. If this script sees that marker in its own env, it
 * exits 0 immediately without emitting anything -- otherwise the summarizer's child session would
 * fire hooks that try to capture the summarizer's own session, recursing forever. This is
 * belt-and-braces with the summarizer's neutral-cwd guard (a project-scoped hook install doesn't
 * fire outside that project's directory in the first place).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Same value as `suite-conventions`'s `DECK_CLIENT_HEADER` (packages/suite-conventions/src/
 * security.ts) -- literal-duplicated here per the stdlib-only rule; the plan's compile-time check
 * lives in ship-log's test suite (asserts this literal matches the real export). */
const DECK_CLIENT_HEADER = 'x-ship-deck';

const FETCH_TIMEOUT_MS = 700;

function servicesJsonPath(homeDir) {
  return join(homeDir, '.suite', 'services.json');
}

function spoolPath(homeDir) {
  return join(homeDir, '.ship', 'spool', 'events.jsonl');
}

function readHullPort(homeDir) {
  const path = servicesJsonPath(homeDir);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const port = parsed?.hull?.port;
    return typeof port === 'number' ? port : undefined;
  } catch {
    return undefined;
  }
}

function appendToSpool(homeDir, envelope) {
  const path = spoolPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(path, JSON.stringify(envelope) + '\n', 'utf8');
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    // A stdin error (e.g. broken pipe) must never crash the hook -- resolve with whatever we have.
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  // Loop guard: exit immediately for any child process the ship-log summarizer itself spawns.
  if (process.env.SHIP_LOG_SUMMARIZER === '1') {
    process.exit(0);
    return;
  }

  const homeDir = homedir();
  const raw = await readStdin();

  let hookPayload;
  try {
    hookPayload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Unparsable stdin -- nothing meaningful to capture; fail open silently.
    process.exit(0);
    return;
  }

  const envelope = {
    v: 1,
    hook_event_name: hookPayload.hook_event_name ?? 'Unknown',
    session_id: hookPayload.session_id ?? '',
    transcript_path: hookPayload.transcript_path,
    cwd: hookPayload.cwd ?? process.cwd(),
    emitted_at: new Date().toISOString(),
    payload: hookPayload,
  };

  const port = readHullPort(homeDir);
  let delivered = false;

  if (port !== undefined) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ship-log/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [DECK_CLIENT_HEADER]: '1' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      delivered = res.ok;
    } catch {
      delivered = false; // hull down, refused, timed out -- fall through to the spool
    }
  }

  if (!delivered) {
    try {
      appendToSpool(homeDir, envelope);
    } catch (err) {
      // Even the spool write failing must not block the session -- last-resort stderr only.
      process.stderr.write(`ship-crew emit.mjs: spool append failed: ${err?.message ?? err}\n`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ship-crew emit.mjs: unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
