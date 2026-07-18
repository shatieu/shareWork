import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StationDescriptor } from 'suite-conventions';
import { createHull, type Hull } from '../src/hull.js';

/* ── Chapel rounds surface (wave2-J): list/detail over the machine-written
 * `~/.ship/chaplain/rounds/<date>.md` digests + the run proxy to ship-log's `runRounds`
 * contract. Same guard + traversal posture as the confessions pair. */

let home: string;
let roundsDir: string;
let hull: Hull | undefined;

const DECK = { 'x-ship-deck': '1' };

async function buildHull(stations: StationDescriptor[] = []): Promise<Hull> {
  hull = await createHull(stations, { homeDir: home, uiDistDir: join(home, 'no-ui') });
  return hull;
}

function seedRounds(date: string, content: string): void {
  mkdirSync(roundsDir, { recursive: true });
  writeFileSync(join(roundsDir, `${date}.md`), content, 'utf8');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-chapel-rounds-test-'));
  roundsDir = join(home, '.ship', 'chaplain', 'rounds');
});

afterEach(async () => {
  await hull?.app.close();
  hull = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('GET /api/chapel/rounds (listing)', () => {
  it('no rounds dir yet -> empty list (a normal pre-first-rounds state)', async () => {
    const { app } = await buildHull();
    const res = await app.inject({ method: 'GET', url: '/api/chapel/rounds', headers: DECK });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rounds: [] });
  });

  it('lists date files newest-first with updatedAt; non-date files are ignored', async () => {
    const { app } = await buildHull();
    seedRounds('2026-07-16', '# Rounds -- 2026-07-16\n');
    seedRounds('2026-07-17', '# Rounds -- 2026-07-17\n');
    writeFileSync(join(roundsDir, 'notes.txt'), 'not rounds', 'utf8');
    writeFileSync(join(roundsDir, 'evil.md'), 'date-shaped it is not', 'utf8');

    const res = await app.inject({ method: 'GET', url: '/api/chapel/rounds', headers: DECK });
    expect(res.statusCode).toBe(200);
    const { rounds } = res.json() as { rounds: { date: string; updatedAt: string }[] };
    expect(rounds.map((r) => r.date)).toEqual(['2026-07-17', '2026-07-16']);
    for (const round of rounds) {
      expect(new Date(round.updatedAt).toISOString()).toBe(round.updatedAt);
    }
  });
});

describe('GET /api/chapel/rounds/:date (detail)', () => {
  it('serves one digest in full; unknown or traversal-shaped dates -> 404', async () => {
    const { app } = await buildHull();
    seedRounds('2026-07-17', '# Rounds -- 2026-07-17\n\nLEAD\n\n## alpha (1 session)\n');
    // A file a traversal-shaped date would reach if :date were ever joined unchecked.
    writeFileSync(join(home, '.ship', 'chaplain', 'secret.md'), 'not yours', 'utf8');

    const ok = await app.inject({ method: 'GET', url: '/api/chapel/rounds/2026-07-17', headers: DECK });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      date: '2026-07-17',
      content: '# Rounds -- 2026-07-17\n\nLEAD\n\n## alpha (1 session)\n',
    });

    const missing = await app.inject({ method: 'GET', url: '/api/chapel/rounds/2026-01-01', headers: DECK });
    expect(missing.statusCode).toBe(404);

    for (const probe of ['..%2Fsecret', '..%5C..%5Csecret', '2026-07-17.md', 'secret']) {
      const res = await app.inject({ method: 'GET', url: `/api/chapel/rounds/${probe}`, headers: DECK });
      expect(res.statusCode, probe).toBe(404);
    }
  });
});

describe('POST /api/chapel/rounds/run (proxy to ship-log runRounds contract)', () => {
  it('501 with a readable message when no ship-log runRounds contract is mounted', async () => {
    const { app } = await buildHull();
    const res = await app.inject({ method: 'POST', url: '/api/chapel/rounds/run', headers: DECK });
    expect(res.statusCode).toBe(501);
    expect((res.json() as { error: string }).error).toContain('ship-log');
  });

  it('invokes the contract with NO date (ship-log owns the clock) and relays the outcome sans path', async () => {
    const calls: (string | undefined)[] = [];
    const station: StationDescriptor = {
      name: 'ship-log',
      registerRoutes() {},
      contracts: {
        runRounds: async (date?: string) => {
          calls.push(date);
          return { date: '2026-07-18', path: 'C:/somewhere/2026-07-18.md', entryCount: 3, projectCount: 2, model: 'haiku' };
        },
      },
    };
    const { app } = await buildHull([station]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chapel/rounds/run',
      headers: DECK,
      payload: { date: '1999-01-01' }, // body must not steer the contract call
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ date: '2026-07-18', entryCount: 3, projectCount: 2, model: 'haiku' });
    expect(calls).toEqual([undefined]);
  });

  it('a rejecting contract -> readable 500', async () => {
    const station: StationDescriptor = {
      name: 'ship-log',
      registerRoutes() {},
      contracts: {
        runRounds: async () => {
          throw new Error('db locked');
        },
      },
    };
    const { app } = await buildHull([station]);
    const res = await app.inject({ method: 'POST', url: '/api/chapel/rounds/run', headers: DECK });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: string }).error).toContain('db locked');
  });
});

describe('x-ship-deck guard on the rounds routes', () => {
  it('403 without the header on all three', async () => {
    const { app } = await buildHull();
    seedRounds('2026-07-17', '# Rounds\n');
    const routes: { method: 'GET' | 'POST'; url: string }[] = [
      { method: 'GET', url: '/api/chapel/rounds' },
      { method: 'GET', url: '/api/chapel/rounds/2026-07-17' },
      { method: 'POST', url: '/api/chapel/rounds/run' },
    ];
    for (const route of routes) {
      const res = await app.inject(route);
      expect(res.statusCode, route.url).toBe(403);
      expect((res.json() as { error: string }).error).toContain('x-ship-deck');
    }
  });
});
