import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Child-process tests for the Crew plugin's stdlib-only http-hook emitter (plan §5: "emit.mjs
 * (child-process tests)"). This spawns the REAL `plugins/crew/hooks/emit.mjs` script against a
 * real ephemeral local http server -- no mocking of the emitter itself, since it's the one file
 * that ships to a marketplace with zero workspace dependencies and must be exercised exactly as
 * Claude Code would invoke it (stdin = raw hook JSON, env HOME/USERPROFILE overridden per R5).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const EMIT_MJS_PATH = resolve(HERE, '..', '..', '..', 'plugins', 'crew', 'hooks', 'emit.mjs');

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-crew-emit-test-home-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

function servicesJsonPath(homeDir: string): string {
  return join(homeDir, '.suite', 'services.json');
}

function spoolJsonlPath(homeDir: string): string {
  return join(homeDir, '.ship', 'spool', 'events.jsonl');
}

function writeServicesJson(homeDir: string, port: number): void {
  const dir = dirname(servicesJsonPath(homeDir));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    servicesJsonPath(homeDir),
    JSON.stringify({
      version: 1,
      hull: { port, pid: 12345, startedAt: new Date().toISOString(), stations: ['ship-log'] },
    }),
  );
}

interface RunResult {
  exitCode: number | null;
  stderr: string;
}

function runEmit(stdinPayload: unknown, homeDir: string): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [EMIT_MJS_PATH], {
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ exitCode: code, stderr }));
    child.stdin.write(typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload));
    child.stdin.end();
  });
}

describe('plugins/crew/hooks/emit.mjs', () => {
  it('POSTs the envelope (with x-ship-deck header) to a live hull and exits 0', async () => {
    const received: Array<{ headers: Record<string, string | string[] | undefined>; body: unknown }> = [];
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(body) });
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ queued: true }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    writeServicesJson(fakeHome, port);

    const hookPayload = {
      hook_event_name: 'SessionStart',
      session_id: 'sess-emit-1',
      cwd: 'C:\\scratch\\repo',
      transcript_path: 'C:\\scratch\\repo\\transcript.jsonl',
      source: 'startup',
    };
    const result = await runEmit(hookPayload, fakeHome);
    server.close();

    expect(result.exitCode).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0].headers['x-ship-deck']).toBe('1');
    const envelope = received[0].body as Record<string, unknown>;
    expect(envelope.v).toBe(1);
    expect(envelope.hook_event_name).toBe('SessionStart');
    expect(envelope.session_id).toBe('sess-emit-1');
    expect(envelope.cwd).toBe('C:\\scratch\\repo');
    expect(typeof envelope.emitted_at).toBe('string');
    expect((envelope.payload as Record<string, unknown>).source).toBe('startup');
  });

  it('falls back to the spool when services.json points at a port nothing is listening on', async () => {
    writeServicesJson(fakeHome, 65530); // almost certainly nothing bound here
    const result = await runEmit(
      { hook_event_name: 'SessionEnd', session_id: 'sess-emit-2', cwd: '/scratch' },
      fakeHome,
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(spoolJsonlPath(fakeHome))).toBe(true);
    const line = readFileSync(spoolJsonlPath(fakeHome), 'utf8').trim();
    const envelope = JSON.parse(line);
    expect(envelope.hook_event_name).toBe('SessionEnd');
    expect(envelope.session_id).toBe('sess-emit-2');
  });

  it('falls back to the spool when there is no services.json at all', async () => {
    const result = await runEmit(
      { hook_event_name: 'Stop', session_id: 'sess-emit-3', cwd: '/scratch' },
      fakeHome,
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(spoolJsonlPath(fakeHome))).toBe(true);
  });

  it('exits 0 even on malformed stdin JSON (fail-open)', async () => {
    const result = await runEmit('{ not valid json', fakeHome);
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 immediately without spooling when SHIP_LOG_SUMMARIZER=1 is set (loop guard)', async () => {
    const result = await new Promise<RunResult>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [EMIT_MJS_PATH], {
        env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, SHIP_LOG_SUMMARIZER: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (c) => (stderr += c.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolvePromise({ exitCode: code, stderr }));
      child.stdin.write(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'loop-guard', cwd: '/x' }));
      child.stdin.end();
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(spoolJsonlPath(fakeHome))).toBe(false);
  });
});
