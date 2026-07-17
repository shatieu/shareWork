import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { get, request as httpRequest, type IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StationDescriptor } from 'suite-conventions';
import { createHull, type Hull } from '../src/hull.js';
import { REPO_VOYAGE_RELPATH } from '../src/voyage.js';

let dir: string;
let voyageFile: string;

const PACKAGES_V1 = {
  packages: [
    { id: 0, title: 'Charter', status: 'PASS+merged', stage_progress: 100, difficulty: 'S', remaining_guess_h: 0, updated_at: 't0' },
    { id: 3, title: 'Deck', status: 'implementing', stage_progress: 60, difficulty: 'XL', remaining_guess_h: 10, updated_at: 't1' },
  ],
};

function writeVoyage(content: unknown): void {
  writeFileSync(voyageFile, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

/** Atomic rename-over, the way well-behaved progress.json writers update it (researcher R5). */
function renameOverVoyage(content: unknown): void {
  const tmp = join(dir, `progress.tmp.${Date.now()}`);
  writeFileSync(tmp, JSON.stringify(content, null, 2), 'utf8');
  renameSync(tmp, voyageFile);
}

async function waitFor<T>(probe: () => Promise<T | undefined> | T | undefined, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ship-voyage-test-'));
  voyageFile = join(dir, 'progress.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/voyage (plan 03 §4.3)', () => {
  it('serves parsed packages with source stamped mission', async () => {
    writeVoyage(PACKAGES_V1);
    const hull = await createHull([], { homeDir: dir, uiDistDir: join(dir, 'no-ui'), voyageFile });
    await hull.start(4321);

    const res = await hull.app.inject({
      method: 'GET',
      url: '/api/voyage',
      headers: { host: '127.0.0.1:4321' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.file).toBe(voyageFile);
    expect(body.stale).toBeUndefined();
    expect(body.packages).toHaveLength(2);
    expect(body.packages[0]).toMatchObject({ id: 0, title: 'Charter', source: 'mission' });
    expect(body.packages[1]).toMatchObject({ difficulty: 'XL', stage_progress: 60 });

    await hull.stop();
    await hull.app.close();
  });

  it('bad JSON at boot -> stale empty; bad JSON after a good read -> stale last-good', async () => {
    writeVoyage('{ definitely not json');
    const hull = await createHull([], { homeDir: dir, uiDistDir: join(dir, 'no-ui'), voyageFile });
    await hull.start(4321);
    const headers = { host: '127.0.0.1:4321' };

    const bad = (await hull.app.inject({ method: 'GET', url: '/api/voyage', headers })).json();
    expect(bad.stale).toBe(true);
    expect(bad.packages).toEqual([]);

    // Recover: valid file arrives (atomic rename-over) -> fresh data, stale flag gone.
    renameOverVoyage(PACKAGES_V1);
    await waitFor(async () => {
      const body = (await hull.app.inject({ method: 'GET', url: '/api/voyage', headers })).json();
      return body.packages.length === 2 && !body.stale ? body : undefined;
    });

    // Corrupt it again -> last-good packages still served, flagged stale.
    writeVoyage('%%% half-written');
    const staleAgain = await waitFor(async () => {
      const body = (await hull.app.inject({ method: 'GET', url: '/api/voyage', headers })).json();
      return body.stale === true ? body : undefined;
    });
    expect(staleAgain.packages).toHaveLength(2);

    await hull.stop();
    await hull.app.close();
  });
});

describe('GET /api/voyage/events (SSE, researcher R4/R5)', () => {
  // Disconnect-propagation does NOT work through light-my-request's injected streams (researcher
  // R4: destroying the injected stream never fires the server-side 'close'), so the SSE tests use
  // a real ephemeral listen. Do not "simplify" these back to inject().
  let hull: Hull;
  let port: number;

  afterEach(async () => {
    await hull.stop();
    await hull.app.close();
  });

  function openSse(path: string): Promise<{ res: IncomingMessage; chunks: string[] }> {
    return new Promise((resolvePromise, reject) => {
      const chunks: string[] = [];
      const req = get({ host: '127.0.0.1', port, path }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => chunks.push(chunk));
        resolvePromise({ res, chunks });
      });
      req.on('error', reject);
    });
  }

  it('sends the initial snapshot, re-pushes on atomic rename-over, and cleans up on disconnect', async () => {
    writeVoyage(PACKAGES_V1);
    hull = await createHull([], { homeDir: dir, uiDistDir: join(dir, 'no-ui'), voyageFile });
    await hull.app.listen({ port: 0, host: '127.0.0.1' });
    const address = hull.app.server.address();
    port = typeof address === 'object' && address ? address.port : 0;
    await hull.start(port);

    const { res, chunks } = await openSse('/api/voyage/events');

    // Initial event arrives immediately.
    await waitFor(() => (chunks.join('').includes('event: voyage') ? true : undefined));
    expect(chunks.join('')).toContain('"Charter"');

    // Atomic rename-over triggers a re-push with the new content (watch survives, R5).
    const v2 = {
      packages: [
        ...PACKAGES_V1.packages,
        { id: 4, title: 'Bridge', status: 'pending', stage_progress: 0, difficulty: null, remaining_guess_h: null },
      ],
    };
    renameOverVoyage(v2);
    await waitFor(() => (chunks.join('').includes('"Bridge"') ? true : undefined), 8000);

    // Client disconnect fires the server-side close handler (heartbeat cleared, client dropped)
    // -- proven indirectly: destroy, then another rename-over must not throw/crash the server,
    // and a fresh client still gets the current snapshot.
    res.destroy();
    await new Promise((r) => setTimeout(r, 100));
    renameOverVoyage(PACKAGES_V1);

    const second = await openSse('/api/voyage/events');
    await waitFor(() => (second.chunks.join('').includes('event: voyage') ? true : undefined));
    second.res.destroy();
  }, 20_000);
});

/* ── multi-project voyage + add-items (wave2-D) ─────────────────────── */

/** A chartroom station stand-in exposing only the listRepoDirs contract the manager consumes. */
function chartroomStub(repos: Array<{ id: string; name: string; absPath: string }>): StationDescriptor {
  return {
    name: 'chartroom',
    registerRoutes(): void {
      /* routes irrelevant here */
    },
    contracts: {
      listRepoDirs: () => repos,
    },
  };
}

function repoWithProgress(root: string, name: string, content: unknown): string {
  const repoDir = join(root, name);
  const file = join(repoDir, REPO_VOYAGE_RELPATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(content, null, 2), 'utf8');
  return repoDir;
}

const REPO_A_PACKAGES = {
  packages: [{ id: 2, title: 'Repo-A thing', status: 'implementing', stage_progress: 30, difficulty: 'M', remaining_guess_h: 4 }],
};

describe('multi-project voyage (wave2-D)', () => {
  const headers = { host: '127.0.0.1:4321' };

  it('GET /api/voyage/projects lists default + repos that HAVE a progress file, and drops vanished ones', async () => {
    writeVoyage(PACKAGES_V1);
    const repoA = repoWithProgress(dir, 'repo-a', REPO_A_PACKAGES);
    const repoB = join(dir, 'repo-b'); // registered but NO progress file = project absent
    mkdirSync(repoB, { recursive: true });
    const hull = await createHull(
      [chartroomStub([
        { id: 'repoa', name: 'repo-a', absPath: repoA },
        { id: 'repob', name: 'repo-b', absPath: repoB },
      ])],
      { homeDir: dir, uiDistDir: join(dir, 'no-ui'), voyageFile },
    );
    await hull.start(4321);

    const res = await hull.app.inject({ method: 'GET', url: '/api/voyage/projects', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'default', name: 'default', file: voyageFile, isDefault: true },
      { id: 'repoa', name: 'repo-a', file: join(repoA, REPO_VOYAGE_RELPATH), isDefault: false },
    ]);

    // File vanishes -> project absent on the next rescan, not an error.
    rmSync(join(repoA, REPO_VOYAGE_RELPATH));
    const after = (await hull.app.inject({ method: 'GET', url: '/api/voyage/projects', headers })).json();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('default');

    await hull.stop();
    await hull.app.close();
  });

  it('per-project GET serves that repo, bare routes stay aliased to default, unknown project 404s', async () => {
    writeVoyage(PACKAGES_V1);
    const repoA = repoWithProgress(dir, 'repo-a', REPO_A_PACKAGES);
    const hull = await createHull(
      [chartroomStub([{ id: 'repoa', name: 'repo-a', absPath: repoA }])],
      { homeDir: dir, uiDistDir: join(dir, 'no-ui'), voyageFile },
    );
    await hull.start(4321);

    const repoRes = (await hull.app.inject({ method: 'GET', url: '/api/voyage/repoa', headers })).json();
    expect(repoRes.packages).toHaveLength(1);
    expect(repoRes.packages[0]).toMatchObject({ id: 2, title: 'Repo-A thing', source: 'mission' });

    const bare = (await hull.app.inject({ method: 'GET', url: '/api/voyage', headers })).json();
    const aliased = (await hull.app.inject({ method: 'GET', url: '/api/voyage/default', headers })).json();
    expect(aliased).toEqual(bare);
    expect(bare.packages).toHaveLength(2);

    const missing = await hull.app.inject({ method: 'GET', url: '/api/voyage/nope', headers });
    expect(missing.statusCode).toBe(404);

    await hull.stop();
    await hull.app.close();
  });

  describe('POST /api/voyage/:project/items', () => {
    const FIXED_NOW = '2026-07-17T12:00:00.000Z';
    let hull: Hull;

    async function bootHull(): Promise<void> {
      hull = await createHull([], {
        homeDir: dir,
        uiDistDir: join(dir, 'no-ui'),
        voyageFile,
        clock: () => new Date(FIXED_NOW),
      });
      await hull.start(4321);
    }

    afterEach(async () => {
      await hull.stop();
      await hull.app.close();
    });

    it('appends with server-assigned fields, preserves unknown fields, and the watcher picks it up', async () => {
      // Unknown fields at BOTH levels must survive the read-modify-rename (looseObject).
      writeVoyage({
        mission: 'wave2',
        packages: [
          { id: 0, title: 'Charter', status: 'PASS+merged', stage_progress: 100, difficulty: 'S', remaining_guess_h: 0, custom_flag: true },
          { id: 7, title: 'Deck', status: 'implementing', stage_progress: 60, difficulty: 'XL', remaining_guess_h: 10 },
        ],
      });
      await bootHull();

      // Deck-header gate first: same mutation rail as every station.
      const forbidden = await hull.app.inject({
        method: 'POST',
        url: '/api/voyage/default/items',
        headers,
        payload: { title: 'New thing' },
      });
      expect(forbidden.statusCode).toBe(403);

      const res = await hull.app.inject({
        method: 'POST',
        url: '/api/voyage/default/items',
        headers: { ...headers, 'x-ship-deck': '1' },
        payload: { title: 'New thing', difficulty: 'M', note: 'from test' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().item).toEqual({
        id: 8,
        title: 'New thing',
        status: 'pending',
        stage_progress: 0,
        difficulty: 'M',
        remaining_guess_h: null,
        updated_at: FIXED_NOW,
        note: 'from test',
      });

      const onDisk = JSON.parse(readFileSync(voyageFile, 'utf8'));
      expect(onDisk.mission).toBe('wave2'); // unknown top-level field preserved
      expect(onDisk.packages).toHaveLength(3);
      expect(onDisk.packages[0].custom_flag).toBe(true); // unknown item field preserved
      expect(onDisk.packages[2]).toMatchObject({ id: 8, title: 'New thing', status: 'pending' });

      // The rename-over write is a normal external update to the watcher: snapshot refreshes.
      await waitFor(async () => {
        const body = (await hull.app.inject({ method: 'GET', url: '/api/voyage', headers })).json();
        return body.packages.length === 3 && !body.stale ? body : undefined;
      });
    });

    it('400s on an invalid body', async () => {
      writeVoyage(PACKAGES_V1);
      await bootHull();
      const res = await hull.app.inject({
        method: 'POST',
        url: '/api/voyage/default/items',
        headers: { ...headers, 'x-ship-deck': '1' },
        payload: { note: 'no title' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('title');
    });

    it('409s with a readable error when the current file fails to parse, and never writes', async () => {
      writeVoyage(PACKAGES_V1);
      await bootHull();
      // A human's half-finished hand edit is on disk now.
      const corrupt = '{ "packages": [ half-edited';
      writeVoyage(corrupt);

      const res = await hull.app.inject({
        method: 'POST',
        url: '/api/voyage/default/items',
        headers: { ...headers, 'x-ship-deck': '1' },
        payload: { title: 'Must not land' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain('fails to parse');
      // NEVER write from a stale snapshot: the hand edit is byte-identical.
      expect(readFileSync(voyageFile, 'utf8')).toBe(corrupt);
    });
  });

  it('add-item over a real listen: the watcher broadcasts the appended item to SSE clients for free', async () => {
    writeVoyage(PACKAGES_V1);
    const hull = await createHull([], {
      homeDir: dir,
      uiDistDir: join(dir, 'no-ui'),
      voyageFile,
      clock: () => new Date('2026-07-17T12:00:00.000Z'),
    });
    await hull.app.listen({ port: 0, host: '127.0.0.1' });
    const address = hull.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await hull.start(port);

    const chunks: string[] = [];
    const sse = await new Promise<IncomingMessage>((resolvePromise, reject) => {
      const req = get({ host: '127.0.0.1', port, path: '/api/voyage/default/events' }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => chunks.push(chunk));
        resolvePromise(res);
      });
      req.on('error', reject);
    });
    await waitFor(() => (chunks.join('').includes('event: voyage') ? true : undefined));

    const status = await new Promise<number>((resolvePromise, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/voyage/default/items',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ship-deck': '1' },
        },
        (res) => {
          res.resume();
          resolvePromise(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ title: 'Broadcast me' }));
    });
    expect(status).toBe(201);

    // No manual snapshot mutation anywhere: this arrives via the chokidar rename-over path.
    await waitFor(() => (chunks.join('').includes('"Broadcast me"') ? true : undefined), 8000);

    sse.destroy();
    await hull.stop();
    await hull.app.close();
  }, 20_000);
});
