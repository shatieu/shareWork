import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DECK_CLIENT_HEADER,
  HOOK_EVENT_CONSUMER_CONTRACT,
  type HookEventConsumer,
  type HostContext,
} from 'suite-conventions';
import { createShipLedgerStation, type ShipLedgerStation } from '../src/station.js';
import { listItems } from '../src/db.js';

let fakeHome: string;
let app: FastifyInstance;
let station: ShipLedgerStation;

const fakeCtx: HostContext = {
  port: undefined,
  getContract: () => undefined,
  log: () => {},
};

async function boot() {
  station = createShipLedgerStation({
    homeDir: fakeHome,
    now: () => new Date('2026-07-06T12:00:00.000Z'),
  });
  app = Fastify({ logger: false });
  await station.registerRoutes(app, fakeCtx);
  await app.ready();
}

async function createViaHttp(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/ship-ledger/items',
    headers: { [DECK_CLIENT_HEADER]: '1' },
    payload: body,
  });
}

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-ledger-station-test-'));
  await boot();
});

afterEach(async () => {
  await app?.close();
  await station?.stop?.();
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('mutating routes', () => {
  it('403 without the x-ship-deck header (POST and PATCH)', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/ship-ledger/items',
      payload: { title: 'x' },
    });
    expect(post.statusCode).toBe(403);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/ship-ledger/items/some-id',
      payload: { title: 'x' },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('POST creates a human-sourced item by default (201)', async () => {
    const res = await createViaHttp({ title: 'from the deck', project: 'p1' });
    expect(res.statusCode).toBe(201);
    const item = res.json();
    expect(item.source).toBe('human');
    expect(item.status).toBe('open');
    expect(item.stageProgress).toBe(0);
  });

  it('POST 400s on a bad body; PATCH 400s on a bad patch', async () => {
    expect((await createViaHttp({ notTitle: true })).statusCode).toBe(400);
    const created = (await createViaHttp({ title: 'w' })).json();
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/ship-ledger/items/${created.id}`,
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { status: 'not-a-status' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('PATCH updates status + stage_progress; 404 on unknown id', async () => {
    const created = (await createViaHttp({ title: 'w' })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/ship-ledger/items/${created.id}`,
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { status: 'in_review', addSessionRef: 's-7' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('in_review');
    expect(res.json().stageProgress).toBe(80);
    expect(res.json().sessionRefs).toContain('s-7');

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/ship-ledger/items/nope',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { title: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('read routes', () => {
  it('GET /items lists and filters; invalid filter values 400', async () => {
    await createViaHttp({ title: 'a', project: 'p1' });
    await createViaHttp({ title: 'b', project: 'p2', status: 'done' });
    const all = await app.inject({ method: 'GET', url: '/api/ship-ledger/items' });
    expect(all.json()).toHaveLength(2);
    const done = await app.inject({
      method: 'GET',
      url: '/api/ship-ledger/items?status=done',
    });
    expect(done.json().map((i: { title: string }) => i.title)).toEqual(['b']);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/ship-ledger/items?status=bogus',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('GET /items/:id returns the item or 404', async () => {
    const created = (await createViaHttp({ title: 'a' })).json();
    const one = await app.inject({
      method: 'GET',
      url: `/api/ship-ledger/items/${created.id}`,
    });
    expect(one.json().title).toBe('a');
    const missing = await app.inject({
      method: 'GET',
      url: '/api/ship-ledger/items/nope',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('health reports the db path and item count', async () => {
    await createViaHttp({ title: 'a' });
    const res = await app.inject({ method: 'GET', url: '/api/ship-ledger/health' });
    expect(res.json()).toMatchObject({ ok: true, itemCount: 1 });
    expect(res.json().dbPath).toContain('ledger.db');
  });
});

describe('contracts', () => {
  it('offers hookEventConsumer for TaskCreated/TaskCompleted and mirrors through it', async () => {
    const consumer = station.contracts?.[HOOK_EVENT_CONSUMER_CONTRACT] as HookEventConsumer;
    expect(consumer.events).toEqual(['TaskCreated', 'TaskCompleted']);
    await consumer.consume({
      v: 1,
      hook_event_name: 'TaskCreated',
      session_id: 's-1',
      cwd: 'C:\\repos\\alpha',
      emitted_at: '2026-07-06T12:00:00.000Z',
      payload: { task_id: '1', task_subject: 'Mirrored' },
    });
    const rows = listItems(station.db, { source: 'native-mirror' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Mirrored');
  });

  it('offers listItems as the console read seam', () => {
    const list = station.contracts?.listItems as (f?: unknown) => unknown[];
    expect(list()).toEqual([]);
  });
});
