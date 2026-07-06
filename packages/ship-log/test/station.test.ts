import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { createShipLogStation, type ShipLogStation } from '../src/station.js';
import { unknownSidecarPath } from '../src/spool.js';
import { getSession } from '../src/db.js';

let fakeHome: string;
let app: FastifyInstance;
let station: ShipLogStation;

const fakeCtx: HostContext = {
  port: undefined,
  getContract: () => undefined,
  log: () => {},
};

async function boot(overrides: Parameters<typeof createShipLogStation>[0] = {}) {
  station = createShipLogStation({ homeDir: fakeHome, ...overrides });
  app = Fastify({ logger: false });
  await station.registerRoutes(app, fakeCtx);
  await app.ready();
}

function envelopeBody(hookEventName: string, sessionId: string, cwd: string, extra: Record<string, unknown> = {}) {
  return {
    v: 1,
    hook_event_name: hookEventName,
    session_id: sessionId,
    cwd,
    emitted_at: new Date().toISOString(),
    payload: extra,
  };
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-log-station-test-'));
});

afterEach(async () => {
  await app?.close();
  await station?.stop?.();
  rmSync(fakeHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('POST /api/ship-log/events', () => {
  it('403s when the x-ship-deck header is missing', async () => {
    await boot();
    const res = await app.inject({ method: 'POST', url: '/api/ship-log/events', payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('400s on a malformed envelope', async () => {
    await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-log/events',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { not: 'an envelope' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('processes SessionStart synchronously -- session row exists by the time the 202 arrives', async () => {
    // Reviewer finding (2026-07-06): SessionStart used to be ingested AFTER the reply, so a
    // commit landing right after the hook could be missed by the git snapshot (head_start =
    // post-commit HEAD -> empty delta -> missing fragment). Route contract now: SessionStart/
    // Stop are ingested before the reply ({ queued: false }); only SessionEnd's slow capture
    // stays async ({ queued: true }).
    await boot({ summarizer: async () => ({ text: 'done', model: 'fake' }) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-log/events',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: envelopeBody('SessionStart', 'sess-http-1', process.cwd()),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: false, stored: 'captured' });

    // No polling: the snapshot must already be committed when the reply lands.
    expect(getSession(station.db, 'sess-http-1')).toBeTruthy();
  });

  it('202s immediately for SessionEnd and completes capture asynchronously', async () => {
    await boot({ summarizer: async () => ({ text: 'done', model: 'fake' }) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-log/events',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: envelopeBody('SessionEnd', 'sess-http-2', process.cwd(), { reason: 'other' }),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: true });

    // Async capture -- poll briefly for the (degraded, missing-SessionStart) row to land.
    await vi.waitFor(() => {
      expect(getSession(station.db, 'sess-http-2')).toBeTruthy();
    });
  });

  it('routes an unknown event name to the unknown sidecar', async () => {
    await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-log/events',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: envelopeBody('Notification', 'sess-unknown-1', process.cwd()),
    });
    expect(res.statusCode).toBe(202);
    await vi.waitFor(() => {
      expect(existsSync(unknownSidecarPath(fakeHome))).toBe(true);
    });
  });

  it('forwards a claimed event to a mounted hookEventConsumer synchronously (Bridge phase 2 fan-out)', async () => {
    const seen: string[] = [];
    const consumerCtx: HostContext = {
      port: undefined,
      log: () => {},
      getContract: <T,>(stationName: string, contractName: string): T | undefined => {
        if (stationName === 'ship-ledger' && contractName === 'hookEventConsumer') {
          return {
            events: ['TaskCreated', 'TaskCompleted'],
            consume: (envelope: { hook_event_name: string }) => {
              seen.push(envelope.hook_event_name);
            },
          } as T;
        }
        return undefined;
      },
    };
    station = createShipLogStation({ homeDir: fakeHome });
    app = Fastify({ logger: false });
    await station.registerRoutes(app, consumerCtx);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-log/events',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: envelopeBody('TaskCreated', 'sess-task-1', process.cwd(), {
        task_id: '1',
        task_subject: 'mirror me',
      }),
    });
    expect(res.statusCode).toBe(202);
    // Sync before the 202 -- delivered by reply time, and never sidecarred.
    expect(res.json()).toEqual({ queued: false, stored: 'forwarded' });
    expect(seen).toEqual(['TaskCreated']);
    expect(existsSync(unknownSidecarPath(fakeHome))).toBe(false);
  });

  it('answers 500 when a consumer throws (emitter spools; mirror events are never lost)', async () => {
    const consumerCtx: HostContext = {
      port: undefined,
      log: () => {},
      getContract: <T,>(): T | undefined =>
        ({
          events: ['TaskCreated'],
          consume: () => {
            throw new Error('ledger unavailable');
          },
        }) as T,
    };
    station = createShipLogStation({ homeDir: fakeHome });
    app = Fastify({ logger: false });
    await station.registerRoutes(app, consumerCtx);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-log/events',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: envelopeBody('TaskCreated', 'sess-task-2', process.cwd(), { task_id: '2' }),
    });
    expect(res.statusCode).toBe(500);
  });
});

describe('GET /api/ship-log/entries + rollup + health', () => {
  it('lists entries, 404s a missing rollup, and reports health', async () => {
    await boot();

    const entriesRes = await app.inject({ method: 'GET', url: '/api/ship-log/entries' });
    expect(entriesRes.statusCode).toBe(200);
    expect(entriesRes.json()).toEqual([]);

    const rollupRes = await app.inject({ method: 'GET', url: '/api/ship-log/rollup/2026-07-06' });
    expect(rollupRes.statusCode).toBe(404);

    const healthRes = await app.inject({ method: 'GET', url: '/api/ship-log/health' });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().ok).toBe(true);
  });

  it('POST rollup requires the x-ship-deck header', async () => {
    await boot();
    const res = await app.inject({ method: 'POST', url: '/api/ship-log/rollup/2026-07-06' });
    expect(res.statusCode).toBe(403);
  });

  it('POST rollup builds a digest that GET then serves', async () => {
    await boot({ rollupSummarizer: async () => ({ text: 'digest text', model: 'fake' }) });
    const post = await app.inject({
      method: 'POST',
      url: '/api/ship-log/rollup/2026-07-06',
      headers: { [DECK_CLIENT_HEADER]: '1' },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json().digest_md).toBe('digest text');

    const get = await app.inject({ method: 'GET', url: '/api/ship-log/rollup/2026-07-06' });
    expect(get.statusCode).toBe(200);
    expect(get.json().digest_md).toBe('digest text');
  });
});

describe('contracts', () => {
  it('exposes getRollup as an in-process contract', async () => {
    await boot({ rollupSummarizer: async () => ({ text: 'x', model: 'fake' }) });
    await app.inject({
      method: 'POST',
      url: '/api/ship-log/rollup/2026-07-06',
      headers: { [DECK_CLIENT_HEADER]: '1' },
    });
    const getRollup = station.contracts?.getRollup as (date: string) => unknown;
    expect((getRollup('2026-07-06') as { digest_md: string }).digest_md).toBe('x');
  });
});
