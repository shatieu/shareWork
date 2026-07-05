import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-doc-assets-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('POST /api/repos/:repoId/docs/:docId/assets (plan §6.1)', () => {
  it('writes assets/<doc-id>/<timestamp>.png and returns the correct relative href', async () => {
    writeDoc('docs/a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const fakePngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/docs/doc-a/assets',
      headers: { 'content-type': 'image/png' },
      payload: fakePngBytes,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { href: string };

    const assetDir = join(repoRoot, 'assets', 'doc-a');
    expect(existsSync(assetDir)).toBe(true);
    const files = readdirSync(assetDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d+\.png$/);

    // href is relative to the *doc's own directory* (docs/), pointing at the repo-root-relative
    // assets/doc-a/ folder -- one level up.
    expect(body.href).toBe(`../assets/doc-a/${files[0]}`);
  });

  it('a subsequent doc save registers the uploaded asset in index.assets via collectAssets', async () => {
    writeDoc('docs/a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const runtime = runtimeFor('repo-a', state);
    const app = buildServer([runtime], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const fakePngBytes = Buffer.from('fake-png-bytes-for-hash');
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/docs/doc-a/assets',
      headers: { 'content-type': 'image/png' },
      payload: fakePngBytes,
    });
    const { href } = uploadResponse.json() as { href: string };

    const newRaw = `---\nid: doc-a\n---\n\n# A\n\n![](${href})\n`;
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/repos/repo-a/docs/doc-a',
      payload: { raw: newRaw },
    });
    expect(saveResponse.statusCode).toBe(200);

    const assetHashes = Object.values(runtime.getState().index.assets).map((a) => a.path);
    expect(assetHashes.some((p) => p.startsWith('assets/doc-a/') && p.endsWith('.png'))).toBe(true);
  });

  it('unknown repo id -> 404', async () => {
    const app = buildServer([], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/does-not-exist/docs/doc-a/assets',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from('x'),
    });
    expect(response.statusCode).toBe(404);
  });

  it('unknown doc id -> 404', async () => {
    writeDoc('docs/a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/docs/does-not-exist/assets',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from('x'),
    });
    expect(response.statusCode).toBe(404);
  });

  it('empty payload -> 400', async () => {
    writeDoc('docs/a.md', '---\nid: doc-a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/docs/doc-a/assets',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.alloc(0),
    });
    expect(response.statusCode).toBe(400);
  });
});
