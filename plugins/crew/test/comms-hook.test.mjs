import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Child-process tests for the Crew plugin's ship-comms delivery hook: the REAL comms.mjs spawned
 * exactly as Claude Code invokes it (stdin = raw Stop hook JSON, HOME/USERPROFILE sandboxed),
 * polling a stdlib fake hull. No mocking inside the script: it ships to a marketplace with zero
 * workspace dependencies.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMS = resolve(HERE, '..', 'hooks', 'comms.mjs');

let fakeHome;
let server;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-crew-comms-home-'));
});

afterEach(async () => {
  if (server) {
    await new Promise((r) => server.close(r));
    server = undefined;
  }
});

function writeServicesJson(port) {
  const dir = join(fakeHome, '.suite');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'services.json'), JSON.stringify({ hull: { port } }), 'utf8');
}

/** Stdlib fake hull: answers GET /api/ship-comms/poll with the given messages and records every
 * request (url + headers) for assertions. */
function startFakeHull(messages) {
  const requests = [];
  server = createServer((req, res) => {
    requests.push({ url: req.url, deckHeader: req.headers['x-ship-deck'] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ session: 'x', messages }));
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise({ port: server.address().port, requests }));
  });
}

function run(stdinPayload) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [COMMS], {
      env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
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

function stopPayload(sessionId = 'sess-comms-1') {
  return { hook_event_name: 'Stop', session_id: sessionId, cwd: fakeHome, stop_hook_active: false };
}

describe('comms.mjs (ship-comms delivery hook)', () => {
  it('emits queued messages as additionalContext with the [ship-comms] prefix, polling with the deck header', async () => {
    const { port, requests } = await startFakeHull([
      { fromSession: 'sess-a', text: 'exchange file updated: .ship-crew/exchange/p1/findings.md' },
      { fromSession: 'sess-b', text: 'second note' },
    ]);
    writeServicesJson(port);

    const res = await run(stopPayload('sess-comms-1'));
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(parsed.hookSpecificOutput.additionalContext).toBe(
      '[ship-comms] message from sess-a: exchange file updated: .ship-crew/exchange/p1/findings.md\n' +
        '[ship-comms] message from sess-b: second note',
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/ship-comms/poll?session=sess-comms-1');
    expect(requests[0].deckHeader).toBe('1');
  });

  it('prints NOTHING when the queue is empty', async () => {
    const { port } = await startFakeHull([]);
    writeServicesJson(port);
    const res = await run(stopPayload());
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
  });

  it('fails open silently when the hull is down (port registered but nothing listening)', async () => {
    const { port } = await startFakeHull([]);
    await new Promise((r) => server.close(r));
    server = undefined;
    writeServicesJson(port); // now a dead port
    const res = await run(stopPayload());
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
    expect(res.stderr).toBe('');
  });

  it('does not poll at all when no hull port is discoverable', async () => {
    const res = await run(stopPayload()); // no services.json in the fake home
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
  });

  it('does not poll without a session id, even with a live hull', async () => {
    const { port, requests } = await startFakeHull([{ fromSession: 'a', text: 'hi' }]);
    writeServicesJson(port);
    const res = await run({ hook_event_name: 'Stop', cwd: fakeHome });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
    expect(requests).toHaveLength(0);
  });

  it('fails open on unparsable stdin', async () => {
    const res = await run('{{nope');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('');
  });
});
