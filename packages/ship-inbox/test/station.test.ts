import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, HOOK_EVENT_CONSUMER_CONTRACT, type HookEventConsumer, type HostContext } from 'suite-conventions';
import { createShipInboxStation, type ShipInboxStation } from '../src/station.js';

let home: string;
let projectDir: string;
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

async function buildApp(contracts?: Record<string, Record<string, unknown>>): Promise<void> {
  app = Fastify({ logger: false });
  await station.registerRoutes(app, hostContext(contracts));
}

async function createPending(cwd?: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/ship-inbox/permissions',
    headers: HDR,
    payload: {
      sessionId: 'sess-1',
      cwd: cwd ?? projectDir,
      toolName: 'Bash',
      toolInput: { command: 'git push origin main' },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-inbox-station-home-'));
  projectDir = mkdtempSync(join(tmpdir(), 'ship-inbox-station-proj-'));
  station = createShipInboxStation({ homeDir: home });
});

afterEach(async () => {
  await app?.close();
  await station.stop?.();
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe('station identity', () => {
  it('owns the Deck Inbox tab and offers the hookEventConsumer + pendingCounts contracts', () => {
    expect(station.name).toBe('ship-inbox');
    expect(station.tab).toEqual({ id: 'inbox', title: 'Inbox' });
    const consumer = station.contracts?.[HOOK_EVENT_CONSUMER_CONTRACT] as HookEventConsumer;
    expect(consumer.events).toEqual(['Notification', 'PermissionRequest']);
    expect(station.contracts?.pendingCounts).toBeTypeOf('function');
  });
});

describe('permission queue routes', () => {
  it('create requires the local-client header; GET lists pending', async () => {
    await buildApp();
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/permissions',
      payload: { sessionId: 's', cwd: '/p', toolName: 'Bash' },
    });
    expect(forbidden.statusCode).toBe(403);

    const id = await createPending();
    const list = await app.inject({ method: 'GET', url: '/api/ship-inbox/permissions?status=pending' });
    expect(list.json().map((r: { id: string }) => r.id)).toEqual([id]);
    expect(list.json()[0].toolInput).toEqual({ command: 'git push origin main' });
  });

  it('decision resolves a parked long-poll immediately', async () => {
    await buildApp();
    const id = await createPending();

    const poll = app.inject({
      method: 'GET',
      url: `/api/ship-inbox/permissions/${id}/decision?waitMs=25000`,
    });
    // Give the poll a beat to park before deciding.
    await new Promise((r) => setTimeout(r, 50));
    const decide = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'deny', message: 'not on main' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().status).toBe('denied');

    const polled = await poll;
    expect(polled.json()).toEqual({ status: 'denied', behavior: 'deny', message: 'not on main' });
  });

  it('waitMs=0 returns pending immediately; decided rows answer without parking', async () => {
    await buildApp();
    const id = await createPending();
    const immediate = await app.inject({ method: 'GET', url: `/api/ship-inbox/permissions/${id}/decision` });
    expect(immediate.json().status).toBe('pending');

    await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'allow' },
    });
    const after = await app.inject({
      method: 'GET',
      url: `/api/ship-inbox/permissions/${id}/decision?waitMs=25000`,
    });
    expect(after.json()).toEqual({ status: 'allowed', behavior: 'allow' });
  });

  it('double-decide answers 409; unknown id 404', async () => {
    await buildApp();
    const id = await createPending();
    await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'allow' },
    });
    const again = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'deny' },
    });
    expect(again.statusCode).toBe(409);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/ship-inbox/permissions/00000000-0000-0000-0000-000000000000/decision',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('expire flips pending -> expired and releases the poll; deciding it afterwards 409s', async () => {
    await buildApp();
    const id = await createPending();
    const poll = app.inject({ method: 'GET', url: `/api/ship-inbox/permissions/${id}/decision?waitMs=25000` });
    await new Promise((r) => setTimeout(r, 50));

    const expired = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/expire`,
      headers: HDR,
    });
    expect(expired.json().status).toBe('expired');
    expect((await poll).json().status).toBe('expired');

    const decide = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'allow' },
    });
    expect(decide.statusCode).toBe(409);
  });
});

describe('always-allow decision (the FO-named risk path, station level)', () => {
  it('writes the native rule additively into the request project settings, with backup recorded', async () => {
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    writeFileSync(
      join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Read'], deny: ['WebSearch'] } }, null, 2),
      'utf8',
    );
    await buildApp();
    const id = await createPending();

    const decide = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'allow', alwaysAllowRule: 'Bash(git push:*)' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().alwaysAllowRule).toBe('Bash(git push:*)');
    expect(decide.json().ruleBackupPath).toMatch(/settings\.local\.json\.bak-/);

    const settings = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8'));
    expect(settings.permissions.allow).toEqual(['Read', 'Bash(git push:*)']);
    expect(settings.permissions.deny).toEqual(['WebSearch']);
  });

  it('a failed rule write records NO decision (malformed settings -> 500, still pending)', async () => {
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    writeFileSync(join(projectDir, '.claude', 'settings.local.json'), '{ broken', 'utf8');
    await buildApp();
    const id = await createPending();

    const decide = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'allow', alwaysAllowRule: 'WebFetch' },
    });
    expect(decide.statusCode).toBe(500);
    expect(decide.json().code).toBe('malformed-settings');
    expect(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8')).toBe('{ broken');

    const row = await app.inject({ method: 'GET', url: `/api/ship-inbox/permissions/${id}/decision` });
    expect(row.json().status).toBe('pending');
  });

  it('rejects alwaysAllowRule on a deny (400) and an implausible rule (400)', async () => {
    await buildApp();
    const id = await createPending();
    const denyWithRule = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'deny', alwaysAllowRule: 'WebFetch' },
    });
    expect(denyWithRule.statusCode).toBe(400);

    const badRule = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'allow', alwaysAllowRule: '(nope)' },
    });
    expect(badRule.statusCode).toBe(400);
    expect(badRule.json().code).toBe('invalid-rule');
  });
});

describe('hookEventConsumer', () => {
  it('Notification envelopes become open agent questions (deduped); ack closes them', async () => {
    await buildApp();
    const consumer = station.contracts?.[HOOK_EVENT_CONSUMER_CONTRACT] as HookEventConsumer;
    const envelope = {
      v: 1 as const,
      hook_event_name: 'Notification',
      session_id: 'sess-n',
      cwd: projectDir,
      emitted_at: '2026-07-06T10:00:00.000Z',
      payload: { notification_type: 'agent_needs_input', message: 'Need the API key name' },
    };
    await consumer.consume(envelope);
    await consumer.consume(envelope); // re-delivery dedupes

    const list = await app.inject({ method: 'GET', url: '/api/ship-inbox/questions?status=open' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).toMatchObject({ kind: 'agent_needs_input', message: 'Need the API key name' });

    const ack = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/questions/${list.json()[0].id}/ack`,
      headers: HDR,
    });
    expect(ack.json().status).toBe('acknowledged');
  });

  it('PermissionRequest envelopes over the ingest transport become record-only pending items', async () => {
    await buildApp();
    const consumer = station.contracts?.[HOOK_EVENT_CONSUMER_CONTRACT] as HookEventConsumer;
    await consumer.consume({
      v: 1 as const,
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-p',
      cwd: projectDir,
      emitted_at: '2026-07-06T10:00:00.000Z',
      payload: { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } },
    });
    const list = await app.inject({ method: 'GET', url: '/api/ship-inbox/permissions?status=pending' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).toMatchObject({ toolName: 'WebFetch', source: 'hook' });
  });
});

describe('the one page + summary', () => {
  it('aggregates permissions + questions + Chart Room docs via the listInbox contract', async () => {
    const docsItem = { repoId: 'r', kind: 'ask-me', label: 'Which port?' };
    await buildApp({ chartroom: { listInbox: () => [docsItem] } });
    const id = await createPending();
    const consumer = station.contracts?.[HOOK_EVENT_CONSUMER_CONTRACT] as HookEventConsumer;
    await consumer.consume({
      v: 1 as const,
      hook_event_name: 'Notification',
      session_id: 's',
      cwd: projectDir,
      emitted_at: '2026-07-06T10:00:00.000Z',
      payload: { notification_type: 'permission_prompt', message: 'Waiting on Bash approval' },
    });

    const items = await app.inject({ method: 'GET', url: '/api/ship-inbox/items' });
    const body = items.json();
    expect(body.permissions.map((p: { id: string }) => p.id)).toEqual([id]);
    expect(body.questions).toHaveLength(1);
    expect(body.docs).toEqual([docsItem]);

    const summary = await app.inject({ method: 'GET', url: '/api/ship-inbox/summary' });
    expect(summary.json()).toEqual({ permissionsPending: 1, questionsOpen: 1, docsOpen: 1, total: 3 });
  });

  it('degrades to ship-only sections when chartroom is not mounted (standalone)', async () => {
    await buildApp();
    const items = await app.inject({ method: 'GET', url: '/api/ship-inbox/items' });
    expect(items.json()).toEqual({ permissions: [], questions: [], docs: [] });
    const summary = await app.inject({ method: 'GET', url: '/api/ship-inbox/summary' });
    expect(summary.json().total).toBe(0);
  });

  it('health reports the db path and counts', async () => {
    await buildApp();
    const health = await app.inject({ method: 'GET', url: '/api/ship-inbox/health' });
    expect(health.json()).toMatchObject({ ok: true, permissionsPending: 0, questionsOpen: 0, parkedWaiters: 0 });
    expect(health.json().dbPath).toContain('inbox.db');
  });
});

describe('lazy expiry on read', () => {
  it('a pending item older than the TTL shows as expired in lists and rejects decisions', async () => {
    let t = new Date('2026-07-06T10:00:00.000Z');
    await station.stop?.(); // replace the default station with a clock-injected one
    station = createShipInboxStation({ homeDir: home, now: () => t, pendingTtlMs: 60_000 });
    await buildApp();
    const id = await createPending();

    t = new Date('2026-07-06T10:02:00.000Z'); // 2 min later, TTL 1 min
    const list = await app.inject({ method: 'GET', url: '/api/ship-inbox/permissions?status=pending' });
    expect(list.json()).toEqual([]);

    const decide = await app.inject({
      method: 'POST',
      url: `/api/ship-inbox/permissions/${id}/decision`,
      headers: HDR,
      payload: { behavior: 'allow' },
    });
    expect(decide.statusCode).toBe(409);
  });
});
