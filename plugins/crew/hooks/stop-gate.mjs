#!/usr/bin/env node
/**
 * The Crew plugin's paranoid Stop-hook enforcement (Ship_Spec §7: "rigorous + Inspector pass
 * required before FO may report done -- enforced by a `Stop` hook (`decision: block`), not
 * politeness").
 *
 * Contract with scrutiny.mjs: at SessionStart the resolved preset was recorded to
 * `~/.ship/crew/sessions/<session_id>.json`. This script acts ONLY when that record says
 * `stop_gate: true` (paranoid or a custom stopGate preset). It then requires a fresh Inspector
 * PASS marker at `<cwd>/.ship-crew/inspector-pass.json` whose `session_id` matches THIS session
 * -- the marker is written by the inspector role (and only on a PASS verdict; its charter and
 * the crew skill both say so). Anything else blocks the stop with a reason telling the session
 * exactly how to satisfy the gate.
 *
 * Safety valves (deliberate, documented):
 *  - `stop_hook_active: true` (Claude Code sets it when a Stop hook already blocked once and the
 *    session is stopping again) => allow. One forced continuation is enforcement; an infinite
 *    block loop is a hostage situation.
 *  - Missing/unreadable session state, missing session_id, any internal error => allow
 *    (fail-open). A gate hook must never brick a session that the SessionStart hook never saw.
 *
 * Stdlib only; always exits 0 (blocking is expressed via stdout JSON, never via exit codes).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function crewHomeDir() {
  return process.env.SHIP_CREW_HOME || homedir();
}

function sessionStatePath(homeDir, sessionId) {
  return join(homeDir, '.ship', 'crew', 'sessions', `${sessionId}.json`);
}

function markerPath(cwd) {
  return join(cwd, '.ship-crew', 'inspector-pass.json');
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
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

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.exit(0); // unparsable stdin -- fail open
    return;
  }

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!sessionId) {
    process.exit(0);
    return;
  }

  const state = readJsonIfExists(sessionStatePath(crewHomeDir(), sessionId));
  if (!state || state.stop_gate !== true) {
    process.exit(0); // no record or gate not armed for this preset -- nothing to enforce
    return;
  }

  if (payload.stop_hook_active === true) {
    // Loop valve: we already blocked once this stop cycle. Let the session end; the block
    // reason (and this stderr line) leave an audit trail instead of a hostage session.
    process.stderr.write(
      `ship-crew stop-gate.mjs: allowing stop after prior block (session ${sessionId}, preset ${state.preset}) -- inspector-pass marker still absent or stale\n`,
    );
    process.exit(0);
    return;
  }

  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : state.cwd || process.cwd();
  const marker = readJsonIfExists(markerPath(cwd));

  if (marker && marker.session_id === sessionId && marker.verdict === 'PASS') {
    process.exit(0); // gate satisfied
    return;
  }

  const detail = !marker
    ? 'no .ship-crew/inspector-pass.json marker exists in this project'
    : marker.session_id !== sessionId
      ? `the marker belongs to another session (${String(marker.session_id).slice(0, 8)}...)`
      : `the marker's verdict is "${marker.verdict}", not PASS`;

  block(
    `Paranoid scrutiny gate (ship-crew): ${detail}. This session may not report done until the ` +
      `inspector role has reviewed the work and recorded a PASS. Dispatch the inspector agent now; on a ` +
      `PASS verdict it writes ${join('.ship-crew', 'inspector-pass.json')} containing ` +
      `{"session_id":"${sessionId}","verdict":"PASS","at":"<ISO timestamp>","scope":"<what was reviewed>"}. ` +
      `If this session genuinely changed nothing reviewable, have the inspector record the PASS with scope "no-change".`,
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ship-crew stop-gate.mjs: unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
