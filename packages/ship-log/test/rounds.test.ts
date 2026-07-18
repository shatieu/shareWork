import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { insertEntry, openShipLogDb } from '../src/db.js';
import type Database from 'better-sqlite3';
import { buildRounds, fallbackRoundsLead, roundsFilePath, runPendingRounds, type RoundsDeps } from '../src/rounds.js';
import { createShipLogStation, type ShipLogStation } from '../src/station.js';
import type { RollupSummarizeInput, RollupSummarizer } from '../src/summarize.js';

let fakeHome: string;
let db: Database.Database | undefined;

const fakeCtx: HostContext = {
  port: undefined,
  getContract: () => undefined,
  log: () => {},
};

function seedEntry(
  database: Database.Database,
  overrides: Partial<{
    sessionId: string;
    date: string;
    project: string | null;
    repoRoot: string | null;
    branch: string | null;
    commits: unknown[];
    files: unknown[];
    summary: string;
  }> = {},
): void {
  insertEntry(database, {
    sessionId: overrides.sessionId ?? `sess-${Math.random().toString(16).slice(2)}`,
    date: overrides.date ?? '2026-07-15',
    project: overrides.project !== undefined ? overrides.project : 'alpha',
    repoRoot: overrides.repoRoot !== undefined ? overrides.repoRoot : 'C:/repos/alpha',
    branch: overrides.branch !== undefined ? overrides.branch : 'main',
    commits: overrides.commits ?? [{ hash: 'abc', subject: 'feat: x' }],
    files: overrides.files ?? ['src/a.ts'],
    summary: overrides.summary ?? 'Did the thing.',
    createdAt: `${overrides.date ?? '2026-07-15'}T10:00:00.000Z`,
  });
}

function recordingSummarizer(result: { text: string; model: string } | null = { text: 'LEAD DIGEST', model: 'fake' }) {
  const calls: RollupSummarizeInput[] = [];
  const summarizer: RollupSummarizer = async (input) => {
    calls.push(input);
    return result;
  };
  return { calls, summarizer };
}

function deps(summarizer: RollupSummarizer, now = new Date('2026-07-16T09:00:00.000Z')): RoundsDeps {
  return { db: db as Database.Database, summarizer, now: () => now, homeDir: fakeHome };
}

const chaplainDir = () => join(fakeHome, '.ship', 'chaplain');

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-log-rounds-test-'));
  db = openShipLogDb(fakeHome);
});

afterEach(() => {
  db?.close();
  db = undefined;
  rmSync(fakeHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('buildRounds (digest composition)', () => {
  it('groups the date entries per project with ONE summarizer call and writes rounds/<date>.md', async () => {
    seedEntry(db!, { date: '2026-07-15', project: 'alpha', branch: 'main', summary: 'Shipped the modal.' });
    seedEntry(db!, {
      date: '2026-07-15',
      project: 'alpha',
      branch: 'fix/nav',
      summary: 'Fixed the nav.',
      commits: [],
      files: [],
    });
    seedEntry(db!, { date: '2026-07-15', project: 'beta', repoRoot: 'C:/repos/beta', summary: 'Beta groundwork.' });
    seedEntry(db!, { date: '2026-07-14', project: 'gamma', summary: 'Wrong day -- excluded.' });

    const { calls, summarizer } = recordingSummarizer();
    const result = await buildRounds(deps(summarizer), '2026-07-15');

    expect(result).toMatchObject({ date: '2026-07-15', entryCount: 3, projectCount: 2, model: 'fake' });
    expect(calls).toHaveLength(1); // one haiku call per rounds run
    expect(calls[0].date).toBe('2026-07-15');
    expect(calls[0].entries.map((e) => e.summary)).toEqual(['Shipped the modal.', 'Fixed the nav.', 'Beta groundwork.']);

    const content = readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8');
    expect(content).toContain('# Rounds -- 2026-07-15');
    expect(content).toContain('LEAD DIGEST');
    expect(content).toContain('## alpha (2 sessions)');
    expect(content).toContain('## beta (1 session)');
    expect(content).toContain('- [main] Shipped the modal. (1 commit, 1 file)');
    expect(content).toContain('- [fix/nav] Fixed the nav. (0 commits, 0 files)');
    expect(content).toContain('Digest model: fake');
    expect(content).not.toContain('Wrong day');
  });

  it('atomic write: no tmp file ever remains beside the rounds dir', async () => {
    seedEntry(db!, { date: '2026-07-15' });
    const { summarizer } = recordingSummarizer();
    await buildRounds(deps(summarizer), '2026-07-15');

    // The tmp lives in the parent chaplain dir during the write; after the rename only the
    // rounds dir (and its date file) may exist.
    expect(readdirSync(chaplainDir())).toEqual(['rounds']);
    expect(readdirSync(join(chaplainDir(), 'rounds'))).toEqual(['2026-07-15.md']);
  });

  it('falls back to the deterministic lead when the summarizer returns null or throws', async () => {
    seedEntry(db!, { date: '2026-07-15', project: 'alpha' });

    const nullResult = await buildRounds(deps(async () => null), '2026-07-15');
    expect(nullResult.model).toBeNull();
    let content = readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8');
    expect(content).toContain(fallbackRoundsLead('2026-07-15', 1, 1));
    expect(content).toContain('Digest model: deterministic-fallback');
    expect(content).toContain('## alpha (1 session)'); // per-project detail survives the fallback

    const throwing = await buildRounds(
      deps(async () => {
        throw new Error('spawn ENOENT');
      }),
      '2026-07-15',
    );
    expect(throwing.model).toBeNull();
    content = readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8');
    expect(content).toContain('deterministic-fallback');
  });

  it('an empty day still writes an honest file', async () => {
    const result = await buildRounds(deps(async () => null), '2026-07-15');
    expect(result).toMatchObject({ entryCount: 0, projectCount: 0, model: null });
    expect(readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8')).toContain(
      'No sessions recorded for 2026-07-15.',
    );
  });

  it('skips temp-dir repo_roots (scratchpad/live-proof debris) but keeps null-repo entries', async () => {
    seedEntry(db!, { date: '2026-07-15', project: 'real', repoRoot: 'C:/repos/real' });
    seedEntry(db!, {
      date: '2026-07-15',
      project: 'ship-log-live-proof',
      repoRoot: join(tmpdir(), 'live-proof-abc', 'repo'),
    });
    seedEntry(db!, { date: '2026-07-15', project: 'degraded', repoRoot: null, summary: 'No repo context.' });

    const { calls, summarizer } = recordingSummarizer();
    const result = await buildRounds(deps(summarizer), '2026-07-15');
    expect(result.entryCount).toBe(2);
    expect(calls[0].entries.map((e) => e.project)).toEqual(['real', 'degraded']);
    const content = readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8');
    expect(content).not.toContain('live-proof');
    expect(content).toContain('## degraded');
  });
});

describe('runPendingRounds (lazy at-most-once-per-day)', () => {
  it('builds completed prior days only -- never today -- and the existing file makes reruns no-ops', async () => {
    seedEntry(db!, { date: '2026-07-14', project: 'alpha' });
    seedEntry(db!, { date: '2026-07-15', project: 'alpha' });
    seedEntry(db!, { date: '2026-07-16', project: 'alpha' }); // "today" -- must not be built

    const { calls, summarizer } = recordingSummarizer();
    const first = await runPendingRounds(deps(summarizer, new Date('2026-07-16T09:00:00.000Z')));
    expect(first.map((r) => r.date)).toEqual(['2026-07-14', '2026-07-15']);
    expect(calls).toHaveLength(2);
    expect(existsSync(roundsFilePath('2026-07-16', fakeHome))).toBe(false);

    const before = readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8');
    const second = await runPendingRounds(deps(summarizer, new Date('2026-07-16T18:00:00.000Z')));
    expect(second).toEqual([]); // file existence is the once-per-day marker
    expect(calls).toHaveLength(2); // no second haiku spend
    expect(readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8')).toBe(before);
  });
});

describe('station rounds surface', () => {
  let app: FastifyInstance | undefined;
  let station: ShipLogStation | undefined;

  async function boot(overrides: Parameters<typeof createShipLogStation>[0] = {}) {
    station = createShipLogStation({ homeDir: fakeHome, ...overrides });
    app = Fastify({ logger: false });
    station.registerRoutes(app, fakeCtx);
    await app.ready();
  }

  afterEach(async () => {
    await app?.close();
    await station?.stop?.();
    app = undefined;
    station = undefined;
  });

  it('POST /api/ship-log/rounds/run 403s without the x-ship-deck header', async () => {
    await boot();
    const res = await app!.inject({ method: 'POST', url: '/api/ship-log/rounds/run', payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/ship-log/rounds/run builds the requested date (and 400s a malformed one)', async () => {
    await boot({ rollupSummarizer: async () => ({ text: 'route digest', model: 'fake' }) });
    seedEntry(station!.db, { date: '2026-07-15', project: 'alpha' });

    const bad = await app!.inject({
      method: 'POST',
      url: '/api/ship-log/rounds/run',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { date: '../../etc' },
    });
    expect(bad.statusCode).toBe(400);

    const res = await app!.inject({
      method: 'POST',
      url: '/api/ship-log/rounds/run',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { date: '2026-07-15' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ date: '2026-07-15', entryCount: 1, projectCount: 1, model: 'fake' });
    expect(readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8')).toContain('route digest');
  });

  it('exposes runRounds as an in-process contract (the chapel proxy leg)', async () => {
    await boot({ rollupSummarizer: async () => ({ text: 'contract digest', model: 'fake' }) });
    seedEntry(station!.db, { date: '2026-07-15', project: 'alpha' });

    const runRounds = station!.contracts?.runRounds as (date?: string) => Promise<{ date: string }>;
    const result = await runRounds('2026-07-15');
    expect(result.date).toBe('2026-07-15');
    expect(readFileSync(roundsFilePath('2026-07-15', fakeHome), 'utf8')).toContain('contract digest');
  });

  it('a SessionEnd capture lazily builds the completed prior day rounds', async () => {
    await boot({
      summarizer: async () => ({ text: 'entry summary', model: 'fake' }),
      rollupSummarizer: async () => ({ text: 'lazy digest', model: 'fake' }),
    });
    // A prior-day entry exists but its rounds file does not.
    seedEntry(station!.db, { date: '2020-01-01', project: 'alpha' });

    const res = await app!.inject({
      method: 'POST',
      url: '/api/ship-log/events',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: {
        v: 1,
        hook_event_name: 'SessionEnd',
        session_id: 'sess-rounds-lazy',
        cwd: process.cwd(),
        emitted_at: new Date().toISOString(),
        payload: { reason: 'other' },
      },
    });
    expect(res.statusCode).toBe(202);

    await vi.waitFor(() => {
      expect(existsSync(roundsFilePath('2020-01-01', fakeHome))).toBe(true);
    });
    expect(readFileSync(roundsFilePath('2020-01-01', fakeHome), 'utf8')).toContain('lazy digest');
  });
});
