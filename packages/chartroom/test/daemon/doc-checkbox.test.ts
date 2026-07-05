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
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-doc-checkbox-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

const DOC_WITH_CHECKBOXES = [
  '---',
  'id: doc-a',
  '---',
  '',
  '# A',
  '',
  '- [ ] bare zero',
  '- [x] bare one',
  '',
  ':::actions{id="deploy"}',
  '- [ ] Approve deploy',
  ':::',
  '',
].join('\n');

describe('PATCH /api/repos/:repoId/docs/:docId/checkbox (plan §3.2)', () => {
  it('toggles a bare checkbox on success, writes exactly one changed character to disk', async () => {
    writeDoc('a.md', DOC_WITH_CHECKBOXES);
    const state = rebuild(repoRoot);
    const runtime = runtimeFor('repo-a', state);
    const app = buildServer([runtime], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/checkbox',
      payload: { scope: { directiveId: null, index: 0 }, checked: true, expectedCurrent: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, checked: true });

    const after = readFileSync(join(repoRoot, 'a.md'), 'utf8');
    expect(after).toContain('- [x] bare zero');
    expect(after.length).toBe(DOC_WITH_CHECKBOXES.length);

    // In-memory state swapped synchronously, same pattern as doc-save.ts.
    expect(runtime.getState()).not.toBe(state);
  });

  it('toggles a checkbox inside an :::actions directive', async () => {
    writeDoc('a.md', DOC_WITH_CHECKBOXES);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/checkbox',
      payload: { scope: { directiveId: 'deploy', index: 0 }, checked: true, expectedCurrent: false },
    });

    expect(response.statusCode).toBe(200);
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toContain('- [x] Approve deploy');
  });

  it('409 on a stale expectedCurrent, file left untouched', async () => {
    writeDoc('a.md', DOC_WITH_CHECKBOXES);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/checkbox',
      // bare index 0 is actually currently unchecked -- claim it was checked (stale belief).
      payload: { scope: { directiveId: null, index: 0 }, checked: true, expectedCurrent: true },
    });

    expect(response.statusCode).toBe(409);
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toBe(DOC_WITH_CHECKBOXES);
  });

  it('404 on an unknown scope/index', async () => {
    writeDoc('a.md', DOC_WITH_CHECKBOXES);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/checkbox',
      payload: { scope: { directiveId: null, index: 99 }, checked: true, expectedCurrent: false },
    });

    expect(response.statusCode).toBe(404);
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toBe(DOC_WITH_CHECKBOXES);
  });

  it('404 on an unknown repo', async () => {
    const app = buildServer([], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/does-not-exist/docs/doc-a/checkbox',
      payload: { scope: { directiveId: null, index: 0 }, checked: true, expectedCurrent: false },
    });
    expect(response.statusCode).toBe(404);
  });

  it('404 on an unknown doc', async () => {
    writeDoc('a.md', DOC_WITH_CHECKBOXES);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/does-not-exist/checkbox',
      payload: { scope: { directiveId: null, index: 0 }, checked: true, expectedCurrent: false },
    });
    expect(response.statusCode).toBe(404);
  });

  it('400 on a malformed body', async () => {
    writeDoc('a.md', DOC_WITH_CHECKBOXES);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/checkbox',
      payload: { checked: true },
    });
    expect(response.statusCode).toBe(400);
  });
});
