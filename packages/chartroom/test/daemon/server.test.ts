import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';

let repoARoot: string;
let repoBRoot: string;

function writeDoc(repoRoot: string, relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function runtimeFor(id: string, repoRoot: string, initialState: RepoState): RepoRuntime {
  let state = initialState;
  return {
    id,
    name: id,
    absPath: repoRoot,
    getState: () => state,
    setState: (next: RepoState) => {
      state = next;
    },
  };
}

beforeEach(() => {
  repoARoot = mkdtempSync(join(tmpdir(), 'chartroom-server-test-a-'));
  repoBRoot = mkdtempSync(join(tmpdir(), 'chartroom-server-test-b-'));
});

afterEach(() => {
  rmSync(repoARoot, { recursive: true, force: true });
  rmSync(repoBRoot, { recursive: true, force: true });
});

describe('buildServer (Fastify app.inject(), no real TCP listener)', () => {
  it('GET /api/repos lists both registered repos', async () => {
    writeDoc(repoARoot, 'a.md', '---\nid: a\n---\n\n# A\n');
    writeDoc(repoBRoot, 'b.md', '---\nid: b\n---\n\n# B\n');

    const stateA = rebuild(repoARoot);
    const stateB = rebuild(repoBRoot);

    const app = buildServer(
      [runtimeFor('repo-a', repoARoot, stateA), runtimeFor('repo-b', repoBRoot, stateB)],
      { uiDistDir: join(repoARoot, 'no-such-ui-dist') },
    );

    const response = await app.inject({ method: 'GET', url: '/api/repos' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual([
      { id: 'repo-a', name: 'repo-a', absPath: repoARoot, docCount: 1, brokenLinkCount: 0, needsYouCount: 0 },
      { id: 'repo-b', name: 'repo-b', absPath: repoBRoot, docCount: 1, brokenLinkCount: 0, needsYouCount: 0 },
    ]);
  });

  it('GET /api/repos/:id/docs/:docId for a doc with a tombstoned outbound link returns brokenLinks with lastPath/deletedAt', async () => {
    writeDoc(repoARoot, 'gone.md', '---\nid: gone\n---\n\n# Gone\n');
    writeDoc(repoARoot, 'linker.md', '---\nid: linker\n---\n\n# Linker\n\nSee [Gone](gone.md "id:gone").\n');

    // First build: both docs present, no tombstone yet.
    rebuild(repoARoot);

    // Delete the target doc, then rebuild -- this is what produces the tombstone (plan §7).
    unlinkSync(join(repoARoot, 'gone.md'));
    const stateAfterDelete = rebuild(repoARoot);

    expect(stateAfterDelete.index.deleted['gone']?.lastPath).toBe('gone.md');

    const app = buildServer([runtimeFor('repo-a', repoARoot, stateAfterDelete)], {
      uiDistDir: join(repoARoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/repos/repo-a/docs/linker' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.brokenLinks).toEqual([
      {
        path: 'linker.md',
        targetId: 'gone',
        hrefAsWritten: 'gone.md',
        matchType: 'tombstone',
        lastPath: 'gone.md',
        deletedAt: stateAfterDelete.index.deleted['gone'].deletedAt,
      },
    ]);
  });

  it('a raw-asset path-traversal attempt is rejected, not served', async () => {
    writeDoc(repoARoot, 'a.md', '---\nid: a\n---\n\n# A\n');
    const stateA = rebuild(repoARoot);

    const app = buildServer([runtimeFor('repo-a', repoARoot, stateA)], {
      uiDistDir: join(repoARoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/repos/repo-a/raw/../../../../../../etc/passwd',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it('GET /api/repos/:id/docs/:docId for an unknown doc id returns 404', async () => {
    writeDoc(repoARoot, 'a.md', '---\nid: a\n---\n\n# A\n');
    const stateA = rebuild(repoARoot);
    const app = buildServer([runtimeFor('repo-a', repoARoot, stateA)], {
      uiDistDir: join(repoARoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/repos/repo-a/docs/does-not-exist' });
    expect(response.statusCode).toBe(404);
  });

  it('GET /api/repos/:id/docs lists both id-keyed and unidentified docs', async () => {
    writeDoc(repoARoot, 'a.md', '---\nid: a\n---\n\n# A\n');
    writeDoc(repoARoot, 'no-id.md', '# No id here\n');
    const stateA = rebuild(repoARoot);
    const app = buildServer([runtimeFor('repo-a', repoARoot, stateA)], {
      uiDistDir: join(repoARoot, 'no-such-ui-dist'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/repos/repo-a/docs' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual(
      expect.arrayContaining([
        { id: 'a', path: 'a.md', title: 'A' },
        { id: null, path: 'no-id.md', title: 'No id here' },
      ]),
    );
  });
});
