import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostContext, StationDescriptor } from 'suite-conventions';
import {
  createShipConsoleStation,
  effectiveStateOf,
  rollupCounts,
  toSessionView,
  type ConsoleFleetSession,
  type ConsoleOverview,
} from '../src/station.js';

const FLEET: ConsoleFleetSession[] = [
  {
    sessionId: '984deabe-afba-4411-a079-a16be751eac1',
    name: 'auth token refactor',
    cwd: 'C:\\repos\\auth-service',
    kind: 'interactive',
    startedAt: 1_751_800_000_000,
    status: 'busy',
  },
  { sessionId: 'd754cb3d-e33c-493f-bd18-495bced4f7c7', cwd: '/home/o/repos/team-tasks/', state: 'blocked' },
  { sessionId: '4226671f-ca22-4753-9ffe-e786ab86b7f5', name: 'changelog polish', state: 'done' },
  { sessionId: '11111111-2222-4333-8444-555555555555', cwd: 'C:\\repos\\sea-chest', status: 'idle' },
];

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A minimal hull stand-in: the console station plus fake siblings offering their contracts,
 * looked up the same way ship's hull does. */
async function buildApp(opts: {
  fleet?: ConsoleFleetSession[] | null | (() => Promise<ConsoleFleetSession[] | null>);
  voiceMounted?: boolean;
  pending?: { permissionsPending: number; questionsOpen: number };
  digest?: string;
  unwatched?: string[] | (() => string[]);
}): Promise<FastifyInstance> {
  const siblings: StationDescriptor[] = [];
  if (opts.voiceMounted !== false) {
    siblings.push({
      name: 'ship-voice',
      registerRoutes() {},
      contracts: {
        fleetSource: {
          list: async () => (typeof opts.fleet === 'function' ? opts.fleet() : (opts.fleet ?? null)),
        },
      },
    });
  }
  if (opts.pending) {
    siblings.push({
      name: 'ship-inbox',
      registerRoutes() {},
      contracts: { pendingCounts: () => opts.pending },
    });
  }
  if (opts.digest !== undefined || opts.unwatched !== undefined) {
    const contracts: Record<string, unknown> = {};
    if (opts.digest !== undefined) {
      contracts.getRollup = (date: string) =>
        date === new Date().toISOString().slice(0, 10) ? { digest_md: opts.digest } : undefined;
    }
    if (opts.unwatched !== undefined) {
      contracts.listUnwatchedSessionIds =
        typeof opts.unwatched === 'function' ? opts.unwatched : () => opts.unwatched as string[];
    }
    siblings.push({ name: 'ship-log', registerRoutes() {}, contracts });
  }

  const console_ = createShipConsoleStation();
  const stations = [...siblings, console_];
  const ctx: HostContext = {
    port: undefined,
    getContract<T>(stationName: string, contractName: string): T | undefined {
      const station = stations.find((s) => s.name === stationName);
      return station?.contracts?.[contractName] as T | undefined;
    },
    log: () => {},
  };
  app = Fastify({ logger: false });
  for (const station of stations) {
    await station.registerRoutes(app, ctx);
  }
  return app;
}

async function getOverview(instance: FastifyInstance): Promise<ConsoleOverview> {
  const res = await instance.inject({ method: 'GET', url: '/api/ship-console/overview' });
  expect(res.statusCode).toBe(200);
  return res.json() as ConsoleOverview;
}

describe('station identity', () => {
  it('is named ship-console and contributes the Console Deck tab', () => {
    const station = createShipConsoleStation();
    expect(station.name).toBe('ship-console');
    expect(station.tab).toEqual({ id: 'console', title: 'Console' });
  });
});

describe('GET /api/ship-console/overview', () => {
  it('serves the normalized fleet with state rollup, pending badge, and today digest', async () => {
    const instance = await buildApp({
      fleet: FLEET,
      pending: { permissionsPending: 2, questionsOpen: 1 },
      digest: '- **auth-service**: token refresh refactor landed.',
    });
    const overview = await getOverview(instance);

    expect(overview.available).toBe(true);
    expect(overview.sessions).toHaveLength(4);
    expect(overview.sessions[0]).toEqual({
      sessionId: '984deabe-afba-4411-a079-a16be751eac1',
      name: 'auth token refactor',
      repo: 'auth-service',
      cwd: 'C:\\repos\\auth-service',
      kind: 'interactive',
      state: 'busy',
      startedAt: 1_751_800_000_000,
      watched: true,
    });
    expect(overview.hidden).toEqual([]);
    // Nameless session falls back to the cwd folder (trailing slash stripped, POSIX path).
    expect(overview.sessions[1]).toMatchObject({ name: 'team-tasks', repo: 'team-tasks', state: 'blocked' });
    expect(overview.counts).toEqual({ total: 4, busy: 1, idle: 1, blocked: 1, done: 1 });
    expect(overview.pending).toEqual({ permissionsPending: 2, questionsOpen: 1 });
    expect(overview.rollup).toEqual({
      date: new Date().toISOString().slice(0, 10),
      digest_md: '- **auth-service**: token refresh refactor landed.',
    });
    expect(new Date(overview.generatedAt).getTime()).not.toBeNaN();
  });

  it('fleet read returns null -> available:false with empty sessions, siblings still served', async () => {
    const instance = await buildApp({ fleet: null, pending: { permissionsPending: 0, questionsOpen: 3 } });
    const overview = await getOverview(instance);
    expect(overview.available).toBe(false);
    expect(overview.sessions).toEqual([]);
    expect(overview.counts).toEqual({ total: 0, busy: 0, idle: 0, blocked: 0, done: 0 });
    expect(overview.pending).toEqual({ permissionsPending: 0, questionsOpen: 3 });
    expect(overview.rollup).toBeNull();
  });

  it('no ship-voice station mounted -> available:false, never a 5xx', async () => {
    const instance = await buildApp({ voiceMounted: false });
    const overview = await getOverview(instance);
    expect(overview.available).toBe(false);
    expect(overview.pending).toBeNull();
  });

  it('a throwing fleet contract degrades to available:false (console outlives a misbehaving sibling)', async () => {
    const instance = await buildApp({
      fleet: async () => {
        throw new Error('spawn EPERM');
      },
    });
    const overview = await getOverview(instance);
    expect(overview.available).toBe(false);
    expect(overview.sessions).toEqual([]);
  });

  it('empty fleet is available (no sessions is a real answer, not an outage)', async () => {
    const instance = await buildApp({ fleet: [] });
    const overview = await getOverview(instance);
    expect(overview.available).toBe(true);
    expect(overview.counts.total).toBe(0);
  });

  it('unwatched sessions move to hidden and leave the counts (wave2-E unwatch filter)', async () => {
    const instance = await buildApp({
      fleet: FLEET,
      unwatched: ['d754cb3d-e33c-493f-bd18-495bced4f7c7', '4226671f-ca22-4753-9ffe-e786ab86b7f5'],
    });
    const overview = await getOverview(instance);

    expect(overview.sessions.map((s) => s.sessionId)).toEqual([
      '984deabe-afba-4411-a079-a16be751eac1',
      '11111111-2222-4333-8444-555555555555',
    ]);
    expect(overview.sessions.every((s) => s.watched)).toBe(true);
    // Hidden rows stay addressable (name + id) so a rewatch affordance can list them.
    expect(overview.hidden.map((s) => ({ sessionId: s.sessionId, watched: s.watched }))).toEqual([
      { sessionId: 'd754cb3d-e33c-493f-bd18-495bced4f7c7', watched: false },
      { sessionId: '4226671f-ca22-4753-9ffe-e786ab86b7f5', watched: false },
    ]);
    // Counts cover watched sessions only: the blocked + done rows are hidden.
    expect(overview.counts).toEqual({ total: 2, busy: 1, idle: 1, blocked: 0, done: 0 });
  });

  it('a missing or throwing hide-list contract hides nothing', async () => {
    const noContract = await getOverview(await buildApp({ fleet: FLEET }));
    expect(noContract.sessions).toHaveLength(4);
    expect(noContract.hidden).toEqual([]);

    const throwing = await getOverview(
      await buildApp({
        fleet: FLEET,
        unwatched: () => {
          throw new Error('log.db locked');
        },
      }),
    );
    expect(throwing.sessions).toHaveLength(4);
    expect(throwing.hidden).toEqual([]);
  });

  it('injected fleetSource option overrides the contract lookup (test seam)', async () => {
    const station = createShipConsoleStation({ fleetSource: { list: async () => FLEET.slice(0, 1) } });
    const ctx: HostContext = { port: undefined, getContract: () => undefined, log: () => {} };
    app = Fastify({ logger: false });
    await station.registerRoutes(app, ctx);
    const overview = await getOverview(app);
    expect(overview.available).toBe(true);
    expect(overview.sessions).toHaveLength(1);
  });
});

describe('GET /api/ship-console/health', () => {
  it('answers ok', async () => {
    const instance = await buildApp({ fleet: [] });
    const res = await instance.inject({ method: 'GET', url: '/api/ship-console/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, station: 'ship-console' });
  });
});

describe('normalization helpers', () => {
  it('effectiveStateOf: state wins over status; neither -> running', () => {
    expect(effectiveStateOf({ state: 'blocked', status: 'busy' })).toBe('blocked');
    expect(effectiveStateOf({ status: 'idle' })).toBe('idle');
    expect(effectiveStateOf({})).toBe('running');
  });

  it('toSessionView: nameless, cwd-less session gets a sessionId stub name', () => {
    const view = toSessionView({ sessionId: 'abcdef12-3456-7890-abcd-ef1234567890' });
    expect(view.name).toBe('session abcdef12');
    expect(view.repo).toBeNull();
    expect(view.state).toBe('running');
  });

  it('rollupCounts: unknown states count toward total only', () => {
    const counts = rollupCounts([
      toSessionView({ sessionId: 'a' }),
      toSessionView({ sessionId: 'b', status: 'busy' }),
    ]);
    expect(counts).toEqual({ total: 2, busy: 1, idle: 0, blocked: 0, done: 0 });
  });
});
