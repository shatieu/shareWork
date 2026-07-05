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
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-doc-ask-me-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

const DOC_WITH_ASK_ME = [
  '---',
  'id: doc-a',
  '---',
  '',
  '# A',
  '',
  ':::ask-me{id="q-03" type="single-select"}',
  'How should we authenticate?',
  '',
  '- [ ] PAT tokens',
  '- [ ] OAuth 2.1',
  '- [ ] Both',
  ':::',
  '',
].join('\n');

describe('PATCH /api/repos/:repoId/docs/:docId/ask-me (plan §3.2)', () => {
  it('answers successfully: correct blockquote + answered="true", file updated, state rebuilt', async () => {
    writeDoc('a.md', DOC_WITH_ASK_ME);
    const state = rebuild(repoRoot);
    const runtime = runtimeFor('repo-a', state);
    const app = buildServer([runtime], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/ask-me',
      payload: { directiveId: 'q-03', value: 'both', author: 'Ondřej' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.answered).toBe(true);
    expect(body.answerText).toContain('Both');

    const after = readFileSync(join(repoRoot, 'a.md'), 'utf8');
    expect(after).toContain('answered="true"');
    expect(after).toMatch(/> \*\*Answer\*\* \(\d{4}-\d{2}-\d{2}, Ondřej\): Both/);
    expect(runtime.getState()).not.toBe(state);
  });

  it('falls back to an OS-username author when none is supplied', async () => {
    writeDoc('a.md', DOC_WITH_ASK_ME);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/ask-me',
      payload: { directiveId: 'q-03', value: 'both' },
    });

    expect(response.statusCode).toBe(200);
    const after = readFileSync(join(repoRoot, 'a.md'), 'utf8');
    expect(after).toMatch(/> \*\*Answer\*\* \(\d{4}-\d{2}-\d{2}, [^)]+\): Both/);
  });

  it('409 on an already-answered block, file left untouched', async () => {
    writeDoc('a.md', DOC_WITH_ASK_ME);
    const state = rebuild(repoRoot);
    const runtime = runtimeFor('repo-a', state);
    const app = buildServer([runtime], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const first = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/ask-me',
      payload: { directiveId: 'q-03', value: 'both', author: 'X' },
    });
    expect(first.statusCode).toBe(200);
    const afterFirst = readFileSync(join(repoRoot, 'a.md'), 'utf8');

    const second = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/ask-me',
      payload: { directiveId: 'q-03', value: 'pat', author: 'Y' },
    });
    expect(second.statusCode).toBe(409);
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toBe(afterFirst);
  });

  it('400 when the value shape does not match the question type', async () => {
    writeDoc('a.md', DOC_WITH_ASK_ME);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/ask-me',
      // single-select expects a string, not an array.
      payload: { directiveId: 'q-03', value: ['both'] },
    });
    expect(response.statusCode).toBe(400);
    expect(readFileSync(join(repoRoot, 'a.md'), 'utf8')).toBe(DOC_WITH_ASK_ME);
  });

  it('404 on an unknown directiveId', async () => {
    writeDoc('a.md', DOC_WITH_ASK_ME);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/ask-me',
      payload: { directiveId: 'no-such-question', value: 'both' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('404 on an unknown repo/doc', async () => {
    const app = buildServer([], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/does-not-exist/docs/doc-a/ask-me',
      payload: { directiveId: 'q-03', value: 'both' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('400 on a malformed body', async () => {
    writeDoc('a.md', DOC_WITH_ASK_ME);
    const state = rebuild(repoRoot);
    const app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-a/ask-me',
      payload: { value: 'both' },
    });
    expect(response.statusCode).toBe(400);
  });
});
