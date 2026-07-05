import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get, type IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHull, type Hull } from '../src/hull.js';

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
