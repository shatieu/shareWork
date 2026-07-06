import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Child-process tests for the Crew plugin's phase-4 hooks (plan 08 §7): the REAL scrutiny.mjs
 * and stop-gate.mjs scripts spawned exactly as Claude Code invokes them -- stdin = raw hook
 * JSON, `SHIP_CREW_HOME` sandboxing the ~/.ship/crew state dir. No mocking: these two files
 * ship to a marketplace with zero workspace dependencies.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRUTINY = resolve(HERE, '..', 'hooks', 'scrutiny.mjs');
const STOP_GATE = resolve(HERE, '..', 'hooks', 'stop-gate.mjs');

let fakeHome;
let projectDir;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-crew-hooks-home-'));
  projectDir = mkdtempSync(join(tmpdir(), 'ship-crew-hooks-proj-'));
});

function run(script, stdinPayload) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, SHIP_CREW_HOME: fakeHome, HOME: fakeHome, USERPROFILE: fakeHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
    child.stdin.write(typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload));
    child.stdin.end();
  });
}

function writeSettings(relPath, obj) {
  const path = join(projectDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8');
}

function sessionStartPayload(sessionId = 'sess-1234') {
  return { hook_event_name: 'SessionStart', session_id: sessionId, cwd: projectDir, source: 'startup' };
}

function statePath(sessionId) {
  return join(fakeHome, '.ship', 'crew', 'sessions', `${sessionId}.json`);
}

function briefingOf(stdout) {
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return parsed.hookSpecificOutput.additionalContext;
}

describe('scrutiny.mjs (SessionStart wiring)', () => {
  it('defaults to standard when no ship.scrutiny is set, and records session state', async () => {
    const res = await run(SCRUTINY, sessionStartPayload());
    expect(res.exitCode).toBe(0);
    const briefing = briefingOf(res.stdout);
    expect(briefing).toContain('Scrutiny preset: standard');
    expect(briefing).toContain('navigator -> shipwright -> inspector');
    expect(briefing).toContain('plan-approval off');
    const state = JSON.parse(readFileSync(statePath('sess-1234'), 'utf8'));
    expect(state).toMatchObject({ session_id: 'sess-1234', preset: 'standard', stop_gate: false });
  });

  it('reads rigorous from .claude/settings.json: devils-advocate + plan gate ON, stop gate off', async () => {
    writeSettings('.claude/settings.json', { ship: { scrutiny: 'rigorous' } });
    const res = await run(SCRUTINY, sessionStartPayload());
    const briefing = briefingOf(res.stdout);
    expect(briefing).toContain('Scrutiny preset: rigorous');
    expect(briefing).toContain('devils-advocate');
    expect(briefing).toContain('plan-approval ON');
    expect(JSON.parse(readFileSync(statePath('sess-1234'), 'utf8')).stop_gate).toBe(false);
  });

  it('settings.local.json overrides settings.json; paranoid arms the stop gate', async () => {
    writeSettings('.claude/settings.json', { ship: { scrutiny: 'standard' } });
    writeSettings('.claude/settings.local.json', { ship: { scrutiny: 'paranoid' } });
    const res = await run(SCRUTINY, sessionStartPayload());
    const briefing = briefingOf(res.stdout);
    expect(briefing).toContain('Scrutiny preset: paranoid');
    expect(briefing).toContain('from .claude/settings.local.json');
    expect(briefing).toContain('stop-gate ON');
    expect(JSON.parse(readFileSync(statePath('sess-1234'), 'utf8')).stop_gate).toBe(true);
  });

  it('solo preset means no crew pipeline but the capture floor stays', async () => {
    writeSettings('.claude/settings.json', { ship: { scrutiny: 'solo' } });
    const briefing = briefingOf((await run(SCRUTINY, sessionStartPayload())).stdout);
    expect(briefing).toContain('solo preset, work directly');
    expect(briefing).toContain('non-optional floor');
  });

  it('unknown preset falls back to standard with a visible warning', async () => {
    writeSettings('.claude/settings.json', { ship: { scrutiny: 'yolo' } });
    const briefing = briefingOf((await run(SCRUTINY, sessionStartPayload())).stdout);
    expect(briefing).toContain('WARNING');
    expect(briefing).toContain('unknown scrutiny preset "yolo"');
    expect(briefing).toContain('Scrutiny preset: standard');
  });

  it('custom preset via ship.crewPresets: named role list + gate flags', async () => {
    writeSettings('.claude/settings.json', {
      ship: {
        scrutiny: 'review-only',
        crewPresets: { 'review-only': { roles: ['inspector'], planGate: false, stopGate: true } },
      },
    });
    const res = await run(SCRUTINY, sessionStartPayload());
    const briefing = briefingOf(res.stdout);
    expect(briefing).toContain('Scrutiny preset: review-only');
    expect(briefing).toContain('Crew pipeline: inspector');
    expect(briefing).toContain('stop-gate ON');
    expect(JSON.parse(readFileSync(statePath('sess-1234'), 'utf8')).stop_gate).toBe(true);
  });

  it('fails open: malformed settings.json still yields a standard briefing and exit 0', async () => {
    const path = join(projectDir, '.claude', 'settings.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not json', 'utf8');
    const res = await run(SCRUTINY, sessionStartPayload());
    expect(res.exitCode).toBe(0);
    expect(briefingOf(res.stdout)).toContain('Scrutiny preset: standard');
    expect(res.stderr).toContain('unparsable');
  });

  it('fails open on unparsable stdin: exit 0, no stdout', async () => {
    const res = await run(SCRUTINY, '{{nope');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
  });
});

describe('stop-gate.mjs (paranoid enforcement)', () => {
  const SESSION = 'sess-gate-1';

  async function armGate(preset = 'paranoid') {
    writeSettings('.claude/settings.json', { ship: { scrutiny: preset } });
    await run(SCRUTINY, sessionStartPayload(SESSION));
  }

  function stopPayload(overrides = {}) {
    return { hook_event_name: 'Stop', session_id: SESSION, cwd: projectDir, stop_hook_active: false, ...overrides };
  }

  function writeMarker(marker) {
    const dir = join(projectDir, '.ship-crew');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'inspector-pass.json'), JSON.stringify(marker), 'utf8');
  }

  it('allows silently when no session state was recorded', async () => {
    const res = await run(STOP_GATE, stopPayload());
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
  });

  it('allows when the recorded preset has no stop gate (standard/rigorous)', async () => {
    await armGate('rigorous');
    const res = await run(STOP_GATE, stopPayload());
    expect(res.stdout).toBe('');
  });

  it('blocks under paranoid with no inspector-pass marker, with actionable reason', async () => {
    await armGate();
    const res = await run(STOP_GATE, stopPayload());
    expect(res.exitCode).toBe(0); // blocking is stdout JSON, never a nonzero exit
    const decision = JSON.parse(res.stdout);
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('inspector');
    expect(decision.reason).toContain(SESSION);
    expect(decision.reason).toContain('inspector-pass.json');
  });

  it("blocks when the marker belongs to another session or isn't a PASS", async () => {
    await armGate();
    writeMarker({ session_id: 'someone-else', verdict: 'PASS' });
    let decision = JSON.parse((await run(STOP_GATE, stopPayload())).stdout);
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('another session');

    writeMarker({ session_id: SESSION, verdict: 'FAIL' });
    decision = JSON.parse((await run(STOP_GATE, stopPayload())).stdout);
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('not PASS');
  });

  it('allows when a matching PASS marker exists', async () => {
    await armGate();
    writeMarker({ session_id: SESSION, verdict: 'PASS', at: new Date().toISOString(), scope: 'test' });
    const res = await run(STOP_GATE, stopPayload());
    expect(res.stdout).toBe('');
  });

  it('loop valve: stop_hook_active=true is allowed through with an audit line on stderr', async () => {
    await armGate();
    const res = await run(STOP_GATE, stopPayload({ stop_hook_active: true }));
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('allowing stop after prior block');
  });

  it('fails open on unparsable stdin', async () => {
    const res = await run(STOP_GATE, 'not json');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
  });
});
