// v1.1 daemon substrate: dynamic raw-asset serving (routes/raw.ts -- the static-mount replacement
// that makes live registration possible) and live registration (routes/repo-register.ts) with an
// injected registrar.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';

let repoRoot: string;

function writeDoc(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function runtimeFor(id: string, initialState: RepoState): RepoRuntime {
  let state = initialState;
  return {
    id,
    name: id,
    absPath: repoRoot,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  };
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-raw-register-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('GET /api/repos/:repoId/raw/* (dynamic raw route)', () => {
  it('serves a file with a sensible content-type and 404s misses', async () => {
    writeDoc('a.md', '# A\n');
    mkdirSync(join(repoRoot, 'assets'), { recursive: true });
    writeFileSync(join(repoRoot, 'assets', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const app = buildServer([runtimeFor('r1', rebuild(repoRoot))]);

    const png = await app.inject({ method: 'GET', url: '/api/repos/r1/raw/assets/pic.png' });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.rawPayload.length).toBe(4);

    const md = await app.inject({ method: 'GET', url: '/api/repos/r1/raw/a.md' });
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain('# A');

    const miss = await app.inject({ method: 'GET', url: '/api/repos/r1/raw/nope.png' });
    expect(miss.statusCode).toBe(404);

    const wrongRepo = await app.inject({ method: 'GET', url: '/api/repos/zzz/raw/a.md' });
    expect(wrongRepo.statusCode).toBe(404);
  });

  it('serves a repo pushed into the runtimes array AFTER buildServer (live registration property)', async () => {
    writeDoc('a.md', '# A\n');
    const repos: RepoRuntime[] = [];
    const app = buildServer(repos);

    const before = await app.inject({ method: 'GET', url: '/api/repos/late/raw/a.md' });
    expect(before.statusCode).toBe(404);

    repos.push(runtimeFor('late', rebuild(repoRoot)));
    const after = await app.inject({ method: 'GET', url: '/api/repos/late/raw/a.md' });
    expect(after.statusCode).toBe(200);
  });

  it('rejects path traversal out of the repo root', async () => {
    writeDoc('a.md', '# A\n');
    const app = buildServer([runtimeFor('r1', rebuild(repoRoot))]);
    const res = await app.inject({ method: 'GET', url: '/api/repos/r1/raw/..%2F..%2Fsecrets.txt' });
    expect([403, 404]).toContain(res.statusCode); // 403 from our guard (or 404 if the resolver collapses it)
    expect(res.statusCode).not.toBe(200);
  });
});

describe('POST /api/repos/register (live registration route)', () => {
  it('501s without a registrar, 400s on a missing path, and passes a valid path through', async () => {
    const noRegistrar = buildServer([]);
    const r501 = await noRegistrar.inject({ method: 'POST', url: '/api/repos/register', payload: { path: repoRoot } });
    expect(r501.statusCode).toBe(501);

    const calls: string[] = [];
    const app = buildServer([], {
      registrar: async (absPath: string) => {
        calls.push(absPath);
        return { id: 'new-repo', name: 'new-repo', absPath, alreadyRegistered: false };
      },
    });

    const bad = await app.inject({ method: 'POST', url: '/api/repos/register', payload: {} });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url: '/api/repos/register', payload: { path: repoRoot } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: 'new-repo', alreadyRegistered: false });
    expect(calls).toEqual([repoRoot]);
  });

  it('400s with the registrar error message when the path has no git root', async () => {
    const app = buildServer([], {
      registrar: async () => {
        throw new Error('not a git repository (or any parent up to filesystem root)');
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/repos/register', payload: { path: repoRoot } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('not a git repository');
  });
});
