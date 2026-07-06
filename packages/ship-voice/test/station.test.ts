import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, isAllowedHostHeader, type HostContext, type StationDescriptor } from 'suite-conventions';
import { createShipInboxStation, type ShipInboxStation } from 'ship-inbox/station';
import { createShipLedgerStation, type ShipLedgerStation } from 'ship-ledger/station';
import { createShipVoiceStation } from '../src/station.js';
import type { FleetControl, FleetSession, FleetSource } from '../src/fleet.js';

const HDR = { [DECK_CLIENT_HEADER]: '1' };
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
const TODAY = new Date().toISOString().slice(0, 10);

const FLEET: FleetSession[] = [
  { sessionId: '984deabe-afba-4411-a079-a16be751eac1', name: 'auth token refactor', cwd: 'C:\\repos\\auth-service', status: 'busy' },
  { sessionId: 'd754cb3d-e33c-493f-bd18-495bced4f7c7', name: 'team tasks rls bug', cwd: 'C:\\repos\\team-tasks', state: 'blocked' },
  { sessionId: '4226671f-ca22-4753-9ffe-e786ab86b7f5', name: 'changelog polish', cwd: 'C:\\repos\\shareWork', state: 'done' },
];

/** Fixture ship-log entries deliberately carry file PATHS -- the §3 minimization tests assert
 * those never surface in anything spoken. */
const LOG_ENTRIES = [
  {
    sessionId: '984deabe-afba-4411-a079-a16be751eac1',
    project: 'auth-service',
    summary: 'Refactored token refresh and fixed the retry loop; tests green.',
    files: ['src/secret/tokens.ts', 'src/auth/refresh.ts'],
    createdAt: `${TODAY}T10:00:00.000Z`,
  },
  {
    sessionId: 'd754cb3d-e33c-493f-bd18-495bced4f7c7',
    project: 'team-tasks',
    summary: 'Chased the RLS policy bug into the invite flow.',
    files: ['app/policies.sql'],
    createdAt: `${TODAY}T11:00:00.000Z`,
  },
];

let inboxHome: string;
let ledgerHome: string;
let app: FastifyInstance;
let inbox: ShipInboxStation;
let ledger: ShipLedgerStation;
let fleetSessions: FleetSession[] | null;
let sent: Array<{ sessionId: string; text: string }>;
let dispatched: Array<{ repo: string; task: string }>;
let rollupDigest: string | undefined;
let boundPort: number | undefined;

async function buildApp(): Promise<void> {
  app = Fastify({ logger: false });

  // The hull's Host-allowlist guard, verbatim posture (proves ship-voice's internal injects
  // survive it once a port is bound).
  app.addHook('onRequest', async (request, reply) => {
    if (!isAllowedHostHeader(request.headers.host, boundPort)) {
      return reply.code(403).send({ error: 'forbidden host' });
    }
  });

  inbox = createShipInboxStation({ homeDir: inboxHome });
  ledger = createShipLedgerStation({ homeDir: ledgerHome });

  // ship-log sibling faked at its HTTP/contract surface (ship-voice consumes the contract
  // shape, never ship-log internals).
  const shipLogFake: StationDescriptor = {
    name: 'ship-log',
    registerRoutes(a: FastifyInstance) {
      a.get<{ Querystring: { date?: string } }>('/api/ship-log/entries', async (request) =>
        request.query.date === TODAY ? LOG_ENTRIES : [],
      );
    },
    contracts: {
      getRollup: (date: string) =>
        rollupDigest !== undefined && date === TODAY ? { digest_md: rollupDigest } : undefined,
    },
  };

  const fleetSource: FleetSource = { list: async () => fleetSessions };
  const fleetControl: FleetControl = {
    send: async (sessionId, text) => {
      sent.push({ sessionId, text });
      return true;
    },
    dispatch: async (repo, task) => {
      if (repo.includes('missing')) return false;
      dispatched.push({ repo, task });
      return true;
    },
  };
  const voice = createShipVoiceStation({
    fleetSource,
    fleetControl,
    speechSummarizer: async () => null, // deterministic fallback path in every test
  });

  const stations: StationDescriptor[] = [shipLogFake, inbox, ledger, voice];
  const ctx: HostContext = {
    port: undefined,
    getContract<T>(stationName: string, contractName: string): T | undefined {
      const station = stations.find((s) => s.name === stationName);
      return station?.contracts?.[contractName] as T | undefined;
    },
    log: () => {},
  };
  for (const station of stations) {
    await station.registerRoutes(app, ctx);
  }
}

async function voiceGet(url: string) {
  const res = await app.inject({ method: 'GET', url, headers: { host: '127.0.0.1' } });
  return { status: res.statusCode, body: res.json() as any };
}

async function voicePost(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, headers: { host: '127.0.0.1' }, payload: payload as any });
  return { status: res.statusCode, body: res.json() as any };
}

async function seedPermission(command: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/ship-inbox/permissions',
    headers: { host: '127.0.0.1', ...HDR },
    payload: {
      sessionId: FLEET[1].sessionId,
      cwd: 'C:\\repos\\team-tasks',
      toolName: 'Bash',
      toolInput: { command },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeEach(async () => {
  inboxHome = mkdtempSync(join(tmpdir(), 'ship-voice-inbox-'));
  ledgerHome = mkdtempSync(join(tmpdir(), 'ship-voice-ledger-'));
  fleetSessions = [...FLEET];
  sent = [];
  dispatched = [];
  rollupDigest = undefined;
  boundPort = undefined;
  await buildApp();
});

afterEach(async () => {
  await app.close();
  await inbox.stop?.();
  await ledger.stop?.();
  rmSync(inboxHome, { recursive: true, force: true });
  rmSync(ledgerHome, { recursive: true, force: true });
});

describe('station identity', () => {
  it('is headless (no Deck tab) and named ship-voice', () => {
    const station = createShipVoiceStation();
    expect(station.name).toBe('ship-voice');
    expect(station.tab).toBeUndefined();
  });
});

describe('fleet_status (§9.1 acceptance tool)', () => {
  it('returns a natural paragraph with fleet, pending and today lines -- no ids, no paths', async () => {
    await seedPermission('git push origin main');
    rollupDigest = '- **auth-service**: token refresh refactor landed.';

    const { status, body } = await voiceGet('/api/ship-voice/fleet_status');
    expect(status).toBe(200);
    expect(body.spoken).toContain('Two sessions are running.');
    expect(body.spoken).toContain('Auth token refactor is working.');
    expect(body.spoken).toContain('Team tasks rls bug is blocked waiting on an approval.');
    expect(body.spoken).toContain('One session has finished.');
    expect(body.spoken).toContain('One permission request is waiting for you.');
    expect(body.spoken).toContain('Earlier today: auth-service: token refresh refactor landed.');
    expect(body.spoken).not.toMatch(UUID_RE);
    expect(body.spoken).not.toContain('src/secret');
    // metadata extras for the phase-2 voice agent
    expect(body.pending.permissionsPending).toBe(1);
    expect(body.pendingRequests).toHaveLength(1);
    expect(body.pendingRequests[0].command).toBe('`git push origin main`');
    expect(body.sessions.map((s: any) => s.name)).toContain('auth token refactor');
  });

  it('speaks the unreachable-fleet fallback when the source returns null', async () => {
    fleetSessions = null;
    const { status, body } = await voiceGet('/api/ship-voice/fleet_status');
    expect(status).toBe(200);
    expect(body.spoken).toContain('can’t see the fleet');
  });

  it('still answers when sibling contracts are absent (feature-unavailable, never an error)', async () => {
    // Fresh app with ONLY the voice station mounted.
    const bare = Fastify({ logger: false });
    const voice = createShipVoiceStation({
      fleetSource: { list: async () => [...FLEET] },
      fleetControl: { send: async () => true, dispatch: async () => true },
      speechSummarizer: async () => null,
    });
    await voice.registerRoutes(bare, {
      port: undefined,
      getContract: () => undefined,
      log: () => {},
    });
    const res = await bare.inject({ method: 'GET', url: '/api/ship-voice/fleet_status', headers: { host: '127.0.0.1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().spoken).toContain('Two sessions are running.');
    await bare.close();
  });
});

describe('session_status (§4 fuzzy addressing + §3 minimization)', () => {
  it('resolves a fuzzy name and speaks the latest log summary with a file COUNT, never paths', async () => {
    const { status, body } = await voiceGet('/api/ship-voice/session_status?name=the%20auth%20one');
    expect(status).toBe(200);
    expect(body.resolved).toBe(true);
    expect(body.spoken).toContain('Auth token refactor is working.');
    expect(body.spoken).toContain('Last log: Refactored token refresh');
    expect(body.spoken).toContain('Two files touched.');
    expect(body.spoken).not.toContain('src/secret');
    expect(body.spoken).not.toContain('tokens.ts');
    expect(body.spoken).not.toMatch(UUID_RE);
  });

  it('speaks a disambiguation list on ties', async () => {
    fleetSessions = [
      ...FLEET,
      { sessionId: 'eeee671f-0000-4753-9ffe-e786ab86b7f5', name: 'auth login fix', cwd: 'C:\\repos\\auth-service' },
    ];
    const { body } = await voiceGet('/api/ship-voice/session_status?name=auth');
    expect(body.resolved).toBe(false);
    expect(body.spoken).toContain('Which one?');
    expect(body.candidates).toContain('auth token refactor');
    expect(body.candidates).toContain('auth login fix');
  });

  it('handles no match and missing name', async () => {
    const miss = await voiceGet('/api/ship-voice/session_status?name=kubernetes');
    expect(miss.body.spoken).toContain('don’t see a session matching');
    const empty = await voiceGet('/api/ship-voice/session_status');
    expect(empty.status).toBe(400);
  });
});

describe('send_to_session / dispatch', () => {
  it('sends composed text to the resolved session', async () => {
    const { status, body } = await voicePost('/api/ship-voice/send_to_session', {
      name: 'team tasks',
      text: 'Finish the RLS fix first, then open a PR.',
    });
    expect(status).toBe(200);
    expect(body.spoken).toBe('Sent to team tasks rls bug.');
    expect(sent).toEqual([
      { sessionId: FLEET[1].sessionId, text: 'Finish the RLS fix first, then open a PR.' },
    ]);
  });

  it('refuses ambiguous or unknown targets without sending', async () => {
    fleetSessions = [
      ...FLEET,
      { sessionId: 'eeee671f-0000-4753-9ffe-e786ab86b7f5', name: 'auth login fix', cwd: 'C:\\repos\\auth-service' },
    ];
    const ambiguous = await voicePost('/api/ship-voice/send_to_session', { name: 'auth', text: 'x' });
    expect(ambiguous.status).toBe(409);
    const unknown = await voicePost('/api/ship-voice/send_to_session', { name: 'zzz', text: 'x' });
    expect(unknown.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('dispatches a new session on a repo and speaks a clipped task', async () => {
    const { status, body } = await voicePost('/api/ship-voice/dispatch', {
      repo: 'C:\\repos\\harbor',
      task: 'Fix the **flaky** websocket test.',
    });
    expect(status).toBe(200);
    expect(body.spoken).toContain('Dispatched a new session on harbor');
    expect(body.spoken).toContain('Fix the flaky websocket test.');
    expect(dispatched).toEqual([{ repo: 'C:\\repos\\harbor', task: 'Fix the **flaky** websocket test.' }]);
  });

  it('speaks a useful error when dispatch fails', async () => {
    const { status, body } = await voicePost('/api/ship-voice/dispatch', { repo: 'C:\\missing', task: 'x' });
    expect(status).toBe(502);
    expect(body.spoken).toContain('is that repo path right?');
  });
});

describe('approve (§6 rails: read-back, confirm phrase, no always-allow)', () => {
  it('step 1 reads back without executing; step 2 with confirm executes a plain command', async () => {
    const id = await seedPermission('git push origin main');

    const readBack = await voicePost('/api/ship-voice/approve', { requestId: id });
    expect(readBack.status).toBe(200);
    expect(readBack.body.needsConfirmation).toBe(true);
    expect(readBack.body.destructive).toBe(false);
    expect(readBack.body.spoken).toContain('wants to run `git push origin main` — approve?');

    // still pending -- read-back never executes
    const stillPending = await app.inject({ method: 'GET', url: '/api/ship-inbox/permissions?status=pending', headers: { host: '127.0.0.1' } });
    expect(stillPending.json()).toHaveLength(1);

    const approved = await voicePost('/api/ship-voice/approve', { requestId: id, confirm: true });
    expect(approved.status).toBe(200);
    expect(approved.body.decided).toBe('allowed');
    expect(approved.body.spoken).toContain('Approved.');

    const decided = await app.inject({ method: 'GET', url: `/api/ship-inbox/permissions/${id}/decision`, headers: { host: '127.0.0.1' } });
    expect(decided.json().behavior).toBe('allow');
  });

  it('destructive commands demand the exact confirm phrase -- a bare confirm is refused', async () => {
    const id = await seedPermission('npm publish');

    const readBack = await voicePost('/api/ship-voice/approve', { requestId: id });
    expect(readBack.body.destructive).toBe(true);
    expect(readBack.body.confirmPhrase).toBe('confirm publish');
    expect(readBack.body.spoken).toContain('Say “confirm publish” to approve.');

    const bare = await voicePost('/api/ship-voice/approve', { requestId: id, confirm: true });
    expect(bare.status).toBe(403);
    const wrong = await voicePost('/api/ship-voice/approve', { requestId: id, confirm: true, confirmPhrase: 'yes' });
    expect(wrong.status).toBe(403);

    const right = await voicePost('/api/ship-voice/approve', {
      requestId: id,
      confirm: true,
      confirmPhrase: 'Confirm Publish',
    });
    expect(right.status).toBe(200);
    expect(right.body.decided).toBe('allowed');
  });

  it('never accepts an always-allow rule by voice (strict schema)', async () => {
    const id = await seedPermission('git status');
    const smuggle = await voicePost('/api/ship-voice/approve', {
      requestId: id,
      confirm: true,
      alwaysAllowRule: 'Bash(git status:*)',
    });
    expect(smuggle.status).toBe(400);
    const stillPending = await app.inject({ method: 'GET', url: '/api/ship-inbox/permissions?status=pending', headers: { host: '127.0.0.1' } });
    expect(stillPending.json()).toHaveLength(1);
  });

  it('speaks sensible fallbacks for vanished or already-decided requests', async () => {
    const gone = await voicePost('/api/ship-voice/approve', { requestId: 'nope', confirm: true });
    expect(gone.status).toBe(404);
    expect(gone.body.spoken).toContain('don’t see that permission request');
  });
});

describe('deny', () => {
  it('denies a pending request and reports already-decided on repeat', async () => {
    const id = await seedPermission('rm -rf /');
    const denied = await voicePost('/api/ship-voice/deny', { requestId: id, message: 'not like this' });
    expect(denied.status).toBe(200);
    expect(denied.body.spoken).toContain('Denied.');

    const again = await voicePost('/api/ship-voice/deny', { requestId: id });
    expect(again.status).toBe(409);
    expect(again.body.spoken).toContain('already decided');
  });
});

describe('ledger_add / ledger_status', () => {
  it('adds through the real ledger station and reads back', async () => {
    const added = await voicePost('/api/ship-voice/ledger_add', {
      title: 'Park the changelog idea',
      project: 'shareWork',
    });
    expect(added.status).toBe(200);
    expect(added.body.spoken).toContain('Logged in the ledger: Park the changelog idea.');
    expect(added.body.id).toBeTruthy();

    const all = await voiceGet('/api/ship-voice/ledger_status');
    expect(all.body.spoken).toContain('One ledger item.');
    expect(all.body.spoken).toContain('Park the changelog idea on shareWork');

    const filtered = await voiceGet('/api/ship-voice/ledger_status?query=changelog');
    expect(filtered.body.items).toHaveLength(1);
    const nomatch = await voiceGet('/api/ship-voice/ledger_status?query=quantum');
    expect(nomatch.body.items).toHaveLength(0);
  });
});

describe('whats_new', () => {
  it('prefers the rollup digest', async () => {
    rollupDigest = 'Two projects moved: auth landed the refactor; team-tasks chased the RLS bug.';
    const { body } = await voiceGet('/api/ship-voice/whats_new');
    expect(body.spoken).toContain('Since this morning: Two projects moved');
  });

  it('falls back to today’s entries -- summaries spoken, file paths never', async () => {
    const { body } = await voiceGet('/api/ship-voice/whats_new');
    expect(body.spoken).toContain('Two sessions logged today.');
    expect(body.spoken).toContain('Auth-service: Refactored token refresh');
    expect(body.spoken).not.toContain('policies.sql');
    expect(body.spoken).not.toContain('src/secret');
    expect(body.entryCount).toBe(2);
  });
});

describe('hull Host-guard compatibility', () => {
  it('internal injects still work once a port is bound (host without port is loopback-allowed)', async () => {
    boundPort = 4317;
    const id = await seedPermission('git status');
    // External caller with the full host:port -- allowed.
    const readBack = await app.inject({
      method: 'POST',
      url: '/api/ship-voice/approve',
      headers: { host: '127.0.0.1:4317' },
      payload: { requestId: id, confirm: true },
    });
    // The voice station's own nested inject (host '127.0.0.1', no port) must have survived the
    // guard for this to succeed end-to-end.
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json().decided).toBe('allowed');

    // And a rebinding-style host is still rejected at the voice surface.
    const evil = await app.inject({
      method: 'GET',
      url: '/api/ship-voice/fleet_status',
      headers: { host: 'attacker.example' },
    });
    expect(evil.statusCode).toBe(403);
  });
});

describe('health', () => {
  it('reports text mode', async () => {
    const { status, body } = await voiceGet('/api/ship-voice/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, station: 'ship-voice', textMode: true });
  });
});
