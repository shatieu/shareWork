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

describe('GET /api/repos with per-repo stats (Deck RepoTree badges, plan 03 §3.1)', () => {
  it('reports docCount (identified + unidentified), brokenLinkCount, and needsYouCount', async () => {
    // Identified doc: one broken id-link, one unanswered ask-me, one unchecked + one checked action.
    writeDoc(
      'identified.md',
      [
        '---',
        'id: a',
        '---',
        '',
        '# A',
        '',
        '[Gone](x.md "id:never-existed").',
        '',
        ':::ask-me{#q1 type="text"}',
        'What should we call this?',
        ':::',
        '',
        ':::actions{#todo}',
        '- [ ] do the thing',
        '- [x] already done',
        ':::',
        '',
      ].join('\n'),
    );
    // Unidentified doc: counts toward docCount. (Its interactive blocks are NOT counted yet --
    // `interactiveBlocks` is id-keyed until the parked v1.2 inbox-correctness slice lands.)
    writeDoc('no-id.md', '# No id\n');

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

  it('a clean repo reports zero counts', async () => {
    writeDoc('clean.md', '---\nid: clean\n---\n\n# Clean\n');
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    });
    const response = await app.inject({ method: 'GET', url: '/api/repos' });
    const body = response.json() as RepoSummary[];
    expect(body[0].docCount).toBe(1);
    expect(body[0].brokenLinkCount).toBe(0);
    expect(body[0].needsYouCount).toBe(0);
  });
});
