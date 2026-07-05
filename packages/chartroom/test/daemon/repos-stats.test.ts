import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';
import type { RepoSummary } from '../../src/daemon/routes/repos.js';

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
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-repos-stats-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('GET /api/repos with per-repo stats (wave-2 feature 3)', () => {
  it('reports docCount (identified + unidentified), brokenLinkCount, and needsYouCount', async () => {
    writeDoc('identified.md', '---\nid: a\n---\n\n# A\n\n[Gone](x.md "id:never-existed").\n');
    // Unidentified doc carrying one unanswered ask-me and one unchecked + one checked action.
    writeDoc(
      'no-id.md',
      [
        '# No id',
        '',
        ':::ask-me{id="q1" type="text"}',
        'What should we call this?',
        ':::',
        '',
        ':::actions{id="todo"}',
        '- [ ] do the thing',
        '- [x] already done',
        ':::',
        '',
      ].join('\n'),
    );

    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/repos' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as RepoSummary[];
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      id: 'repo-a',
      name: 'repo-a',
      absPath: repoRoot,
      docCount: 2, // 1 identified + 1 unidentified
      brokenLinkCount: 1, // the id:never-existed link
      needsYouCount: 2, // 1 unanswered ask-me + 1 unchecked action (checked one excluded)
    });
  });

  it('inbox items for an unidentified doc carry the path as their doc key', async () => {
    writeDoc('no-id.md', ':::ask-me{id="q1" type="text"}\nName?\n:::\n');
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/inbox' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        repoId: 'repo-a',
        docId: 'no-id.md', // the doc key (path, since the doc has no id)
        docPath: 'no-id.md',
        kind: 'ask-me',
        directiveId: 'q1',
      }),
    ]);
  });
});
