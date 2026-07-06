import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER } from 'suite-conventions';
import { createShipInboxStation, type ShipInboxStation } from '../src/station.js';

/**
 * Child-process tests for the Crew plugin's PermissionRequest resolver (plan 06 §1.3/§2 step 3):
 * spawns the REAL `plugins/crew/hooks/permission.mjs` against a REAL listening ship-inbox
 * station -- the entire browser-answers-the-prompt chain (queue create -> long-poll -> browser
 * decision -> stdout decision JSON) minus only Claude Code's interactive event firing, which is
 * headlessly unverifiable (researcher R1) and documented as this package's manual seam.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PERMISSION_MJS = resolve(HERE, '..', '..', '..', 'plugins', 'crew', 'hooks', 'permission.mjs');

let fakeHome: string;
let projectDir: string;
let station: ShipInboxStation;
let app: FastifyInstance;
let port: number;

const HDR = { [DECK_CLIENT_HEADER]: '1' };

const R1_SHAPED_STDIN = () => ({
  session_id: 'live-sess-1',
  transcript_path: 'C:\\Users\\x\\.claude\\projects\\p\\t.jsonl',
  cwd: projectDir,
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'git push origin main' },
});

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runResolver(stdinPayload: unknown, env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [PERMISSION_MJS], {
      env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ exitCode: code, stdout, stderr }));
    child.stdin.write(JSON.stringify(stdinPayload));
    child.stdin.end();
  });
}

async function waitForPending(timeoutMs = 5_000): Promise<{ id: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`http://127.0.0.1:${port}/api/ship-inbox/permissions?status=pending`);
    const rows = (await res.json()) as Array<{ id: string }>;
    if (rows.length > 0) return rows[0];
    if (Date.now() > deadline) throw new Error('no pending permission request appeared');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-inbox-resolver-home-'));
  projectDir = mkdtempSync(join(tmpdir(), 'ship-inbox-resolver-proj-'));
  station = createShipInboxStation({ homeDir: fakeHome });
  app = Fastify({ logger: false });
  await station.registerRoutes(app, { port: undefined, getContract: () => undefined, log: () => {} });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
  mkdirSync(join(fakeHome, '.suite'), { recursive: true });
  writeFileSync(
    join(fakeHome, '.suite', 'services.json'),
    JSON.stringify({ version: 1, hull: { port, pid: 1, startedAt: 't', stations: ['ship-inbox'] } }),
    'utf8',
  );
});

afterEach(async () => {
  await app.close();
  await station.stop?.();
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe('plugins/crew/hooks/permission.mjs against a live station', () => {
  it('allow decided from the (browser) HTTP API reaches the hook stdout as the documented JSON', async () => {
    const run = runResolver(R1_SHAPED_STDIN(), { SHIP_INBOX_WAIT_MS: '15000' });
    const pending = await waitForPending();

    const decide = await fetch(`http://127.0.0.1:${port}/api/ship-inbox/permissions/${pending.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...HDR },
      body: JSON.stringify({ behavior: 'allow' }),
    });
    expect(decide.status).toBe(200);

    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
  });

  it('deny (with always-allow untouched) prints the deny decision', async () => {
    const run = runResolver(R1_SHAPED_STDIN(), { SHIP_INBOX_WAIT_MS: '15000' });
    const pending = await waitForPending();
    await fetch(`http://127.0.0.1:${port}/api/ship-inbox/permissions/${pending.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...HDR },
      body: JSON.stringify({ behavior: 'deny', message: 'not from the browser today' }),
    });

    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.decision).toEqual({ behavior: 'deny' });
  });

  it('always-allow decision writes the native rule into the request project before resolving', async () => {
    const run = runResolver(R1_SHAPED_STDIN(), { SHIP_INBOX_WAIT_MS: '15000' });
    const pending = await waitForPending();
    const decide = await fetch(`http://127.0.0.1:${port}/api/ship-inbox/permissions/${pending.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...HDR },
      body: JSON.stringify({ behavior: 'allow', alwaysAllowRule: 'Bash(git push:*)' }),
    });
    expect(decide.status).toBe(200);

    const result = await run;
    expect(JSON.parse(result.stdout).hookSpecificOutput.decision.behavior).toBe('allow');
    const settings = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8'));
    expect(settings.permissions.allow).toEqual(['Bash(git push:*)']);
  });

  it('deadline hit: prints NOTHING, exits 0, and reports its own expiry to the queue', async () => {
    const run = runResolver(R1_SHAPED_STDIN(), { SHIP_INBOX_WAIT_MS: '400' });
    const pending = await waitForPending();

    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(''); // fail-open: the native dialog must proceed untouched

    const row = await fetch(`http://127.0.0.1:${port}/api/ship-inbox/permissions/${pending.id}/decision`);
    expect(((await row.json()) as { status: string }).status).toBe('expired');
  });

  it('no hull registered: exits 0 immediately with empty stdout (fail-open)', async () => {
    rmSync(join(fakeHome, '.suite', 'services.json'), { force: true });
    const result = await runResolver(R1_SHAPED_STDIN());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('summarizer loop-guard: SHIP_LOG_SUMMARIZER=1 short-circuits before any queue write', async () => {
    const result = await runResolver(R1_SHAPED_STDIN(), { SHIP_LOG_SUMMARIZER: '1' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const res = await fetch(`http://127.0.0.1:${port}/api/ship-inbox/permissions`);
    expect(await res.json()).toEqual([]);
  });
});
