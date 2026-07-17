import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { openShipInboxDb } from '../src/db.js';
import {
  createShipInboxStation,
  type SessionDelivery,
  type ShipInboxStation,
  type ShipInboxStationOptions,
} from '../src/station.js';

/** wave2-E defects D1/D2/D4: questions become answerable, deny notes travel, any tracked
 * session is addressable -- all through the swappable deliver(sessionId, text) seam. */

let home: string;
let station: ShipInboxStation;
let app: FastifyInstance;

const HDR = { [DECK_CLIENT_HEADER]: '1' };

function hostContext(contracts: Record<string, Record<string, unknown>> = {}): HostContext {
  return {
    port: undefined,
    getContract<T>(stationName: string, contractName: string): T | undefined {
      return contracts[stationName]?.[contractName] as T | undefined;
    },
    log: () => {},
  };
}

async function buildApp(
  options: Omit<ShipInboxStationOptions, 'homeDir'> = {},
  contracts?: Record<string, Record<string, unknown>>,
): Promise<void> {
  station = createShipInboxStation({ homeDir: home, ...options });
  app = Fastify({ logger: false });
  await station.registerRoutes(app, hostContext(contracts));
}

function seedQuestion(message = 'Which deploy target?'): string {
  const consumer = station.contracts?.hookEventConsumer as {
    consume(envelope: Record<string, unknown>): void;
  };
  consumer.consume({
    hook_event_name: 'Notification',
    session_id: 'sess-q1',
    cwd: 'C:/repos/proj',
    payload: { notification_type: 'agent_needs_input', message },
  });
  const row = station.db
    .prepare(`SELECT id FROM agent_questions WHERE message = ?`)
    .get(message) as { id: string };
  return row.id;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-inbox-respond-'));
});

afterEach(async () => {
  await app?.close();
  await station?.stop?.();
  rmSync(home, { recursive: true, force: true });
});

describe('schema v2 migration', () => {
  it('rebuilds a v1 agent_questions table in place, preserving rows, and accepts "answered"', () => {
    // Hand-roll the exact v1 schema (old CHECK without 'answered', no response columns):
    // openShipInboxDb creates dirs; build the db through it first, then downgrade the table.
    const fresh = openShipInboxDb(home);
    fresh.exec(`
      DROP TABLE agent_questions;
      CREATE TABLE agent_questions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        cwd TEXT NOT NULL DEFAULT '',
        project TEXT,
        kind TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged')),
        created_at TEXT NOT NULL,
        acked_at TEXT
      );
      INSERT INTO agent_questions (id, session_id, kind, message, status, created_at)
        VALUES ('old-q', 'sess-old', 'agent_needs_input', 'old question', 'open', '2026-07-01T00:00:00.000Z');
    `);
    fresh.pragma('user_version = 1');
    fresh.close();

    const migrated = openShipInboxDb(home);
    const row = migrated
      .prepare('SELECT * FROM agent_questions WHERE id = ?')
      .get('old-q') as Record<string, unknown>;
    expect(row).toMatchObject({ message: 'old question', status: 'open', response_text: null });
    // The rebuilt CHECK accepts the new status.
    migrated
      .prepare(`UPDATE agent_questions SET status = 'answered', response_text = 'ok' WHERE id = 'old-q'`)
      .run();
    expect(migrated.pragma('user_version', { simple: true })).toBe(2);
    migrated.close();
  });
});

describe('POST /api/ship-inbox/questions/:id/respond (D1)', () => {
  it('stores the reply on the row and delivers via the seam, labeled transcript-resume', async () => {
    const sent: Array<{ sessionId: string; text: string }> = [];
    await buildApp({
      deliver: async (sessionId, text) => {
        sent.push({ sessionId, text });
        return { delivered: true };
      },
    });
    const id = seedQuestion();

    const res = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/questions/${id}/respond`,
      headers: HDR,
      payload: { text: 'Deploy to staging first, prod after the smoke test.' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'answered',
      responseText: 'Deploy to staging first, prod after the smoke test.',
      responseDelivered: true,
      delivery: { delivered: true, transport: 'transcript-resume' },
    });
    expect(body.respondedAt).toEqual(expect.any(String));

    // Delivery went to the row's exact session id, with the question quoted for context.
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionId).toBe('sess-q1');
    expect(sent[0].text).toContain('Which deploy target?');
    expect(sent[0].text).toContain('Deploy to staging first');

    // The row left the open queue.
    const open = await app.inject({ method: 'GET', url: '/api/ship-inbox/questions?status=open' });
    expect(open.json()).toEqual([]);
  });

  it('a failed delivery still stores the reply, honestly marked undelivered', async () => {
    await buildApp({
      deliver: async () => ({ delivered: false, detail: 'session is not in the live fleet' }),
    });
    const id = seedQuestion();

    const res = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/questions/${id}/respond`,
      headers: HDR,
      payload: { text: 'use staging' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'answered',
      responseText: 'use staging',
      responseDelivered: false,
      delivery: { delivered: false, detail: 'session is not in the live fleet' },
    });
  });

  it('guards: header required; 404 unknown; 409 on non-open; ack after respond conflicts', async () => {
    await buildApp({ deliver: async () => ({ delivered: true }) });
    const id = seedQuestion();

    const noHeader = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/questions/${id}/respond`,
      payload: { text: 'x' },
    });
    expect(noHeader.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/questions/nope/respond',
      headers: HDR,
      payload: { text: 'x' },
    });
    expect(missing.statusCode).toBe(404);

    await app.inject({ method: 'POST', url: `/api/ship-inbox/questions/${id}/ack`, headers: HDR });
    const conflicted = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/questions/${id}/respond`,
      headers: HDR,
      payload: { text: 'too late' },
    });
    expect(conflicted.statusCode).toBe(409);
  });

  it('default deliverer: exact sessionId resolved via fleetSource, sibling send route injected (spawn seam)', async () => {
    // Real transport path minus the spawn: a fake ship-voice sibling ROUTE + fleetSource
    // contract stand in for `claude -p --resume`.
    const voiceCalls: Array<Record<string, unknown>> = [];
    await buildApp(
      {},
      {
        'ship-voice': {
          fleetSource: {
            list: async () => [
              { sessionId: 'sess-q1', name: 'proj worker', cwd: 'C:/repos/proj' },
              { sessionId: 'other', name: 'other worker', cwd: 'C:/repos/other' },
            ],
          },
        },
      },
    );
    app.post('/api/ship-voice/send_to_session', async (request) => {
      voiceCalls.push(request.body as Record<string, unknown>);
      return { spoken: 'Sent.', sent: true };
    });
    const id = seedQuestion();

    const res = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/questions/${id}/respond`,
      headers: HDR,
      payload: { text: 'staging' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivery).toEqual({ delivered: true, transport: 'transcript-resume' });
    // Addressed by the exact session's own name (the sibling route is name-addressed).
    expect(voiceCalls).toHaveLength(1);
    expect(voiceCalls[0].name).toBe('proj worker');
    expect(String(voiceCalls[0].text)).toContain('staging');
  });

  it('default deliverer degrades honestly: no ship-voice contract -> stored undelivered', async () => {
    await buildApp();
    const id = seedQuestion();
    const res = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/questions/${id}/respond`,
      headers: HDR,
      payload: { text: 'staging' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivery).toMatchObject({ delivered: false, detail: expect.stringContaining('ship-voice') });
  });
});

describe('POST /api/ship-inbox/sessions/:sessionId/send (D4)', () => {
  it('delivers free text to the exact session id', async () => {
    const deliver = vi.fn(async (): Promise<SessionDelivery> => ({ delivered: true }));
    await buildApp({ deliver });

    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/sessions/sess-42/send',
      headers: HDR,
      payload: { text: 'wrap up and commit what you have' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionId: 'sess-42', delivered: true, transport: 'transcript-resume' });
    expect(deliver).toHaveBeenCalledWith('sess-42', 'wrap up and commit what you have');
  });

  it('502 with the honest detail when delivery fails; 403 without the header', async () => {
    await buildApp({ deliver: async () => ({ delivered: false, detail: 'the fleet is unreadable right now' }) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/sessions/sess-42/send',
      headers: HDR,
      payload: { text: 'hello' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ delivered: false, error: 'the fleet is unreadable right now' });

    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/sessions/sess-42/send',
      payload: { text: 'hello' },
    });
    expect(noHeader.statusCode).toBe(403);
  });
});

describe('deny note delivery (D2)', () => {
  it('deny with a message delivers the note over the seam (the decision JSON itself is behavior-only)', async () => {
    const sent: Array<{ sessionId: string; text: string }> = [];
    await buildApp({
      deliver: async (sessionId, text) => {
        sent.push({ sessionId, text });
        return { delivered: true };
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/permissions',
      headers: HDR,
      payload: { sessionId: 'sess-p1', cwd: 'C:/repos/proj', toolName: 'Bash', toolInput: { command: 'git push' } },
    });
    const id = created.json().id as string;

    const decided = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'deny', message: 'not on this branch, ask me first' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({
      status: 'denied',
      decisionMessage: 'not on this branch, ask me first',
      messageDelivery: { delivered: true, transport: 'transcript-resume' },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionId).toBe('sess-p1');
    expect(sent[0].text).toContain('not on this branch, ask me first');
    expect(sent[0].text).toContain('Bash');
  });

  it('allow (and deny without a note) never touches the transport', async () => {
    const deliver = vi.fn(async (): Promise<SessionDelivery> => ({ delivered: true }));
    await buildApp({ deliver });

    for (const payload of [{ behavior: 'allow' }, { behavior: 'deny' }]) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/ship-inbox/permissions',
        headers: HDR,
        payload: { sessionId: 's', cwd: 'C:/repos/proj', toolName: 'Bash' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/ship-inbox/permissions/${created.json().id}/decision`,
        headers: HDR,
        payload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().messageDelivery).toBeUndefined();
    }
    expect(deliver).not.toHaveBeenCalled();
  });
});
