import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-doc-save-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('PUT /api/repos/:repoId/docs/:docId (plan §5.1)', () => {
  it('writes the file to disk and updates the in-memory state synchronously', async () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n\nOld body.\n');
    const state = rebuild(repoRoot);
    const runtime = runtimeFor('repo-a', state);
    const app = buildServer([runtime], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const newRaw = '---\nid: doc-a\n---\n\n# A\n\nNew body.\n';
    const response = await app.inject({
      method: 'PUT',
      url: '/api/repos/repo-a/docs/doc-a',
      payload: { raw: newRaw },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    // File written to disk with exactly the posted bytes.
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toBe(newRaw);

    // In-memory state swapped synchronously (plan §5.3) -- no need to wait for the watcher.
    expect(runtime.getState()).not.toBe(state);
    expect(runtime.getState().index.docs['doc-a']).toBeDefined();
  });

  it('a second consecutive save without further edits is a no-op against the new baseline', async () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const runtime = runtimeFor('repo-a', state);
    const app = buildServer([runtime], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const raw = '---\nid: doc-a\n---\n\n# A\n\nBody.\n';
    const first = await app.inject({ method: 'PUT', url: '/api/repos/repo-a/docs/doc-a', payload: { raw } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'PUT', url: '/api/repos/repo-a/docs/doc-a', payload: { raw } });
    expect(second.statusCode).toBe(200);
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toBe(raw);
  });

  it('unknown repo id -> 404', async () => {
    const app = buildServer([], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/repos/does-not-exist/docs/doc-a',
      payload: { raw: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('unknown doc id -> 404', async () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/repos/repo-a/docs/does-not-exist',
      payload: { raw: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('missing/invalid body -> 400', async () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/repos/repo-a/docs/doc-a',
      payload: { notRaw: 'x' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('oversized payload rejected (413), file left untouched', async () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const huge = 'x'.repeat(11 * 1024 * 1024);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/repos/repo-a/docs/doc-a',
      payload: { raw: huge },
    });
    expect(response.statusCode).toBe(413);
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toBe('---\nid: doc-a\n---\n\n# A\n');
  });
});
