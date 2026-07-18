import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { createShipCommsStation, type SendOutcome, type ShipCommsStation } from '../src/station.js';

let home: string;
let station: ShipCommsStation;
let app: FastifyInstance;

const HDR = { [DECK_CLIENT_HEADER]: '1' };
const SESSION_B = '11111111-2222-4333-8444-555555555555';
const SESSION_C = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function hostContext(contracts: Record<string, Record<string, unknown>> = {}): HostContext {
  return {
    port: undefined,
    getContract<T>(stationName: string, contractName: string): T | undefined {
      return contracts[stationName]?.[contractName] as T | undefined;
    },
    log: () => {},
  };
}

async function buildApp(contracts?: Record<string, Record<string, unknown>>): Promise<void> {
  app = Fastify({ logger: false });
  await station.registerRoutes(app, hostContext(contracts));
}

function fleetContract(sessions: Array<{ sessionId: string; name?: string; cwd?: string }> | null) {
  return { 'ship-voice': { fleetSource: { list: async () => sessions } } };
}

async function sendById(text: string, to: string = SESSION_B, from = 'sess-a') {
  return app.inject({
    method: 'POST',
    url: '/api/ship-comms/send',
    headers: HDR,
    payload: { from, to, text },
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-comms-station-home-'));
  station = createShipCommsStation({ homeDir: home });
});

afterEach(async () => {
  await app?.close();
  await station.stop?.();
  rmSync(home, { recursive: true, force: true });
});

describe('station identity', () => {
  it('is a headless station (no tab) offering the sendMessage contract', () => {
    expect(station.name).toBe('ship-comms');
    expect(station.tab).toBeUndefined();
    expect(station.contracts?.sendMessage).toBeTypeOf('function');
  });
});

describe('deck-header gate (ALL routes -- messages are session-addressed data)', () => {
  it.each([
    ['POST', '/api/ship-comms/send'],
    ['GET', `/api/ship-comms/poll?session=${SESSION_B}`],
    ['GET', `/api/ship-comms/history?session=${SESSION_B}`],
    ['GET', '/api/ship-comms/health'],
  ] as const)('%s %s without x-ship-deck -> 403', async (method, url) => {
    await buildApp();
    const res = await app.inject({ method, url, ...(method === 'POST' ? { payload: {} } : {}) });
    expect(res.statusCode).toBe(403);
  });
});

describe('send by exact session id', () => {
  it('stores verbatim (store-and-forward, no fleet needed) and answers 201', async () => {
    await buildApp(); // deliberately NO fleetSource contract
    const res = await sendById('hello there');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      fromSession: 'sess-a',
      toSession: SESSION_B,
      text: 'hello there',
      deliveredAt: null,
      resolvedVia: 'exact-id',
    });
  });

  it('defaults a missing from to "unknown" and rejects bad bodies with 400', async () => {
    await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-comms/send',
      headers: HDR,
      payload: { to: SESSION_B, text: 'anonymous' },
    });
    expect(res.json().fromSession).toBe('unknown');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/ship-comms/send',
      headers: HDR,
      payload: { to: SESSION_B },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('send by name (fleetSource resolution, honest-ambiguity posture)', () => {
  it('a unique name match resolves to its sessionId', async () => {
    await buildApp(
      fleetContract([
        { sessionId: SESSION_B, name: 'auth rework', cwd: 'C:\\repos\\auth' },
        { sessionId: SESSION_C, name: 'docs pass', cwd: 'C:\\repos\\docs' },
      ]),
    );
    const res = await sendById('name-addressed', 'auth');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ toSession: SESSION_B, resolvedVia: 'name' });
  });

  it('a tie answers 409 with candidates, and nothing is stored', async () => {
    await buildApp(
      fleetContract([
        { sessionId: SESSION_B, name: 'auth rework', cwd: 'C:\\repos\\auth' },
        { sessionId: SESSION_C, name: 'auth hotfix', cwd: 'C:\\repos\\auth2' },
      ]),
    );
    const res = await sendById('who gets this?', 'auth');
    expect(res.statusCode).toBe(409);
    expect(res.json().candidates).toEqual(['auth rework', 'auth hotfix']);

    const history = await app.inject({
      method: 'GET',
      url: `/api/ship-comms/history?session=${SESSION_B}`,
      headers: HDR,
    });
    expect(history.json().messages).toEqual([]);
  });

  it('no match -> 404; unreadable fleet -> 503; no ship-voice aboard -> 503', async () => {
    await buildApp(fleetContract([{ sessionId: SESSION_B, name: 'auth rework' }]));
    expect((await sendById('x', 'nonexistent')).statusCode).toBe(404);

    await app.close();
    await buildApp(fleetContract(null));
    expect((await sendById('x', 'auth')).statusCode).toBe(503);

    await app.close();
    await buildApp(); // no contract at all
    const res = await sendById('x', 'auth');
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('ship-voice is not aboard');
  });
});

describe('poll + history', () => {
  it('poll returns queued messages oldest-first, marks delivered; second poll empty; history keeps both directions', async () => {
    await buildApp();
    await sendById('first');
    await sendById('second');
    await app.inject({
      method: 'POST',
      url: '/api/ship-comms/send',
      headers: HDR,
      payload: { from: SESSION_B, to: SESSION_C, text: 'outbound reply' },
    });

    const poll = await app.inject({
      method: 'GET',
      url: `/api/ship-comms/poll?session=${SESSION_B}`,
      headers: HDR,
    });
    expect(poll.statusCode).toBe(200);
    const { messages } = poll.json();
    expect(messages.map((m: { text: string }) => m.text)).toEqual(['first', 'second']);
    expect(messages.every((m: { deliveredAt: string | null }) => m.deliveredAt !== null)).toBe(true);

    const again = await app.inject({
      method: 'GET',
      url: `/api/ship-comms/poll?session=${SESSION_B}`,
      headers: HDR,
    });
    expect(again.json().messages).toEqual([]);

    const history = await app.inject({
      method: 'GET',
      url: `/api/ship-comms/history?session=${SESSION_B}`,
      headers: HDR,
    });
    expect(history.json().messages.map((m: { text: string }) => m.text)).toEqual([
      'first',
      'second',
      'outbound reply',
    ]);
  });

  it('poll without session -> 400', async () => {
    await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/ship-comms/poll', headers: HDR });
    expect(res.statusCode).toBe(400);
  });

  it('a parked long-poll wakes on send (waiter pattern)', async () => {
    await buildApp();
    const parked = app.inject({
      method: 'GET',
      url: `/api/ship-comms/poll?session=${SESSION_B}&waitMs=10000`,
      headers: HDR,
    });
    // Give the poll a beat to park before sending.
    await new Promise((r) => setTimeout(r, 50));
    await sendById('wake up');

    const res = await parked;
    expect(res.json().messages.map((m: { text: string }) => m.text)).toEqual(['wake up']);
  });
});

describe('sendMessage contract (in-process, no HTTP)', () => {
  it('same store + resolution path as the route', async () => {
    await buildApp(fleetContract([{ sessionId: SESSION_C, name: 'docs pass' }]));
    const sendMessage = station.contracts?.sendMessage as (input: {
      from?: string;
      to: string;
      text: string;
    }) => Promise<SendOutcome>;

    const byName = await sendMessage({ from: 'sibling-station', to: 'docs', text: 'via contract' });
    expect(byName).toMatchObject({ ok: true, resolvedVia: 'name' });

    const poll = await app.inject({
      method: 'GET',
      url: `/api/ship-comms/poll?session=${SESSION_C}`,
      headers: HDR,
    });
    expect(poll.json().messages.map((m: { text: string }) => m.text)).toEqual(['via contract']);

    const ambiguous = await sendMessage({ to: '', text: 'x' }).catch(() => undefined);
    expect(ambiguous).toMatchObject({ ok: false });
  });
});

describe('health', () => {
  it('reports db path, parked waiters, and undelivered count', async () => {
    await buildApp();
    await sendById('queued');
    const res = await app.inject({ method: 'GET', url: '/api/ship-comms/health', headers: HDR });
    expect(res.json()).toMatchObject({
      ok: true,
      dbPath: join(home, '.ship', 'ship-comms.db'),
      parkedWaiters: 0,
      undelivered: 1,
    });
  });
});
