import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-doc-by-path-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('path-addressed docs (v1.1: key = id ?? path)', () => {
  it('GET detail of an id-less doc by (encoded) path: readable, id null, key = path, backlinks []', async () => {
    writeDoc('docs/no-id.md', '# No id here\n\nBody.\n');
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/repos/repo-a/docs/${encodeURIComponent('docs/no-id.md')}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBeNull();
    expect(body.key).toBe('docs/no-id.md');
    expect(body.doc.path).toBe('docs/no-id.md');
    expect(body.raw).toBe('# No id here\n\nBody.\n');
    expect(body.backlinks).toEqual([]);
  });

  it('PUT save of an id-less doc by path writes to disk and refreshes state', async () => {
    writeDoc('docs/no-id.md', '# No id here\n');
    const runtime = runtimeFor('repo-a', rebuild(repoRoot));
    const app = buildServer([runtime], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const newRaw = '# No id here\n\nEdited through the daemon.\n';
    const response = await app.inject({
      method: 'PUT',
      url: `/api/repos/repo-a/docs/${encodeURIComponent('docs/no-id.md')}`,
      payload: { raw: newRaw },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(readFileSync(join(repoRoot, 'docs', 'no-id.md'), 'utf8')).toBe(newRaw);
    // State swapped synchronously; the edited title shows up in the fresh index.
    const fresh = runtime.getState().index.unidentified.find((d) => d.path === 'docs/no-id.md');
    expect(fresh).toBeDefined();
  });

  it('GET detail of an identified doc by its path canonicalizes id/key to the frontmatter id', async () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/repos/repo-a/docs/a.md' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe('doc-a');
    expect(body.key).toBe('doc-a');
  });

  it('a path that matches nothing still 404s (no fuzzy resolution)', async () => {
    writeDoc('docs/no-id.md', '# No id here\n');
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/repos/repo-a/docs/${encodeURIComponent('docs/no-idd.md')}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST asset for an id-less doc uses a filesystem-safe flat folder name (no raw path segments)', async () => {
    writeDoc('docs/no-id.md', '# No id here\n');
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });

    const fakePngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await app.inject({
      method: 'POST',
      url: `/api/repos/repo-a/docs/${encodeURIComponent('docs/no-id.md')}/assets`,
      headers: { 'content-type': 'image/png' },
      payload: fakePngBytes,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { href: string };
    // The path key `docs/no-id.md` must degrade to a single flat directory segment under assets/
    // (a raw `/` in the folder name would nest or escape); the doc-relative href points one level
    // up from docs/ into that flat folder.
    expect(body.href).toMatch(/^\.\.\/assets\/docs--no-id\/\d+\.png$/);
    const files = readdirSync(join(repoRoot, 'assets', 'docs--no-id'));
    expect(files).toHaveLength(1);
  });

  it('PATCH checkbox on an id-less doc by path toggles on disk', async () => {
    writeDoc('todo.md', '# Todo\n\n- [ ] first thing\n');
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/todo.md/checkbox',
      payload: { scope: { directiveId: null, index: 0 }, checked: true, expectedCurrent: false },
    });
    expect(response.statusCode).toBe(200);
    expect(readFileSync(join(repoRoot, 'todo.md'), 'utf8')).toContain('- [x] first thing');
  });
});
