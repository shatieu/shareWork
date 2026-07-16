import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StationDescriptor } from 'suite-conventions';
import { createHull, type Hull } from '../src/hull.js';
import type { SpawnTerminalRequest } from '../src/chapel.js';

let home: string;
let chapelDir: string;
let hull: Hull | undefined;

/** Every legitimate Deck client attaches the CSRF-proof x-ship-deck header. */
const DECK = { 'x-ship-deck': '1' };

/** Inbox filenames are ISO stamps with dashes, `.md`, optionally a `-<n>` collision counter. */
const STAMP_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?\.md$/;

async function buildHull(extra: { repoRoot?: string; stations?: StationDescriptor[] } = {}): Promise<Hull> {
  hull = await createHull(extra.stations ?? [], {
    homeDir: home,
    uiDistDir: join(home, 'no-ui'),
    repoRoot: extra.repoRoot,
  });
  return hull;
}

function inboxFiles(): string[] {
  try {
    return readdirSync(join(chapelDir, 'inbox'));
  } catch {
    return [];
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-chapel-test-'));
  chapelDir = join(home, '.ship', 'chaplain');
});

afterEach(async () => {
  vi.useRealTimers();
  await hull?.app.close();
  hull = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('GET /api/chapel/brief (deck-chapel-tab plan)', () => {
  it('missing brief -> 200 with nulls (routes are always registered), then serves content', async () => {
    const { app } = await buildHull();

    const empty = await app.inject({ method: 'GET', url: '/api/chapel/brief', headers: DECK });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ brief: null, updatedAt: null });

    mkdirSync(chapelDir, { recursive: true });
    writeFileSync(join(chapelDir, 'BRIEF.md'), '# Brief\n\nAll quiet.\n', 'utf8');
    const full = await app.inject({ method: 'GET', url: '/api/chapel/brief', headers: DECK });
    expect(full.statusCode).toBe(200);
    const body = full.json() as { brief: string; updatedAt: string };
    expect(body.brief).toBe('# Brief\n\nAll quiet.\n');
    expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt);
  });
});

describe('GET /api/chapel/projects[/:id]', () => {
  it('no projects dir -> empty list; dossier files -> sorted ids + updatedAt', async () => {
    const { app } = await buildHull();

    const empty = await app.inject({ method: 'GET', url: '/api/chapel/projects', headers: DECK });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ projects: [] });

    mkdirSync(join(chapelDir, 'projects'), { recursive: true });
    writeFileSync(join(chapelDir, 'projects', 'sharework.md'), '# shareWork\n', 'utf8');
    writeFileSync(join(chapelDir, 'projects', '_chapel.md'), '# orphans\n', 'utf8');
    writeFileSync(join(chapelDir, 'projects', 'notes.txt'), 'not a dossier', 'utf8');

    const listed = (await app.inject({ method: 'GET', url: '/api/chapel/projects', headers: DECK })).json() as {
      projects: { id: string; updatedAt: string }[];
    };
    expect(listed.projects.map((p) => p.id)).toEqual(['_chapel', 'sharework']);
    for (const project of listed.projects) {
      expect(new Date(project.updatedAt).toISOString()).toBe(project.updatedAt);
    }
  });

  it('serves one dossier by id; unknown or traversal-shaped ids -> 404', async () => {
    const { app } = await buildHull();
    mkdirSync(join(chapelDir, 'projects'), { recursive: true });
    writeFileSync(join(chapelDir, 'projects', 'sharework.md'), '## Now\nsteady\n', 'utf8');
    // A file a traversal-shaped id would reach if :id were ever joined unchecked.
    writeFileSync(join(chapelDir, 'secret.md'), 'not yours', 'utf8');

    const ok = await app.inject({ method: 'GET', url: '/api/chapel/projects/sharework', headers: DECK });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: 'sharework', content: '## Now\nsteady\n' });

    const missing = await app.inject({ method: 'GET', url: '/api/chapel/projects/nope', headers: DECK });
    expect(missing.statusCode).toBe(404);

    const traversal = await app.inject({
      method: 'GET',
      url: '/api/chapel/projects/..%2Fsecret',
      headers: DECK,
    });
    expect(traversal.statusCode).toBe(404);
  });
});

describe('POST /api/chapel/confess', () => {
  it('writes a stamp-named inbox file with the text verbatim', async () => {
    const { app } = await buildHull();
    const text = 'Feeling adrift on package 16.\n\n:::note\nverbatim? *yes*\n:::\n';

    const res = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: { text } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });

    const files = inboxFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(STAMP_NAME);
    expect(readFileSync(join(chapelDir, 'inbox', files[0]), 'utf8')).toBe(text);
  });

  it('sanitizes project to [a-z0-9-] in the body line and NEVER puts it in the filename (risk r1)', async () => {
    const { app } = await buildHull();

    const res = await app.inject({
      method: 'POST',
      url: '/api/chapel/confess',
      headers: DECK,
      payload: { text: 'note for the dossier', project: '../..\\Evil PROJECT_42!' },
    });
    expect(res.statusCode).toBe(201);

    const files = inboxFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(STAMP_NAME); // stamp-derived only; nothing project-shaped
    const body = readFileSync(join(chapelDir, 'inbox', files[0]), 'utf8');
    expect(body).toBe('project: evilproject42\n\nnote for the dossier');
    // Nothing escaped the inbox: the chapel dir holds only the expected entries.
    expect(readdirSync(chapelDir).sort()).toEqual(['inbox']);
  });

  it('empty or whitespace-only text -> 400 and nothing written', async () => {
    const { app } = await buildHull();
    for (const text of ['', '   \n\t']) {
      const res = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: { text } });
      expect(res.statusCode).toBe(400);
    }
    const missing = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(inboxFiles()).toHaveLength(0);
  });

  it('two confessions in the same millisecond get distinct stamp-derived names', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-09T10:00:00.000Z'));
    const { app } = await buildHull();

    for (const text of ['first', 'second']) {
      const res = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: { text } });
      expect(res.statusCode).toBe(201);
    }

    expect(inboxFiles().sort()).toEqual(['2026-07-09T10-00-00-000Z-1.md', '2026-07-09T10-00-00-000Z.md']);
  });
});

describe('POST /api/chapel/session (spawn seam, risk r2)', () => {
  it('501 with a readable message when no chartroom spawnTerminal contract is mounted', async () => {
    const { app } = await buildHull();
    const res = await app.inject({ method: 'POST', url: '/api/chapel/session', headers: DECK });
    expect(res.statusCode).toBe(501);
    expect((res.json() as { error: string }).error).toContain('chartroom');
  });

  it('spawns via getContract with the FIXED chaplain argv in the hull repoRoot -- body cannot steer it', async () => {
    const calls: SpawnTerminalRequest[] = [];
    const station: StationDescriptor = {
      name: 'chartroom',
      registerRoutes() {},
      contracts: { spawnTerminal: (request: SpawnTerminalRequest) => calls.push(request) },
    };
    const repoRoot = join(home, 'repo');
    const { app } = await buildHull({ repoRoot, stations: [station] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/chapel/session',
      headers: DECK,
      payload: { argv: ['rm', '-rf', '/'], cwd: 'C:\\evil' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(['claude', '--agent', 'ship-crew:chaplain']);
    expect(calls[0].cwd).toBe(repoRoot);
  });

  it('a throwing spawn contract -> readable 500', async () => {
    const station: StationDescriptor = {
      name: 'chartroom',
      registerRoutes() {},
      contracts: {
        spawnTerminal: () => {
          throw new Error('spawn wt ENOENT');
        },
      },
    };
    const { app } = await buildHull({ stations: [station] });
    const res = await app.inject({ method: 'POST', url: '/api/chapel/session', headers: DECK });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: string }).error).toContain('spawn wt ENOENT');
  });
});

describe('x-ship-deck guard on every chapel route', () => {
  it('403 without the header, and no side effects', async () => {
    const { app } = await buildHull();
    const routes: { method: 'GET' | 'POST'; url: string }[] = [
      { method: 'GET', url: '/api/chapel/brief' },
      { method: 'GET', url: '/api/chapel/projects' },
      { method: 'GET', url: '/api/chapel/projects/sharework' },
      { method: 'POST', url: '/api/chapel/confess' },
      { method: 'POST', url: '/api/chapel/session' },
    ];
    for (const route of routes) {
      const res = await app.inject({
        ...route,
        ...(route.method === 'POST' ? { payload: { text: 'sneaky' } } : {}),
      });
      expect(res.statusCode, route.url).toBe(403);
      expect((res.json() as { error: string }).error).toContain('x-ship-deck');
    }
    expect(inboxFiles()).toHaveLength(0);
  });
});
