import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';
import type { SearchResult } from '../../src/daemon/routes/search.js';

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
    setState: (next) => {
      state = next;
    },
  };
}

beforeEach(() => {
  repoARoot = mkdtempSync(join(tmpdir(), 'chartroom-search-test-a-'));
  repoBRoot = mkdtempSync(join(tmpdir(), 'chartroom-search-test-b-'));
});

afterEach(() => {
  rmSync(repoARoot, { recursive: true, force: true });
  rmSync(repoBRoot, { recursive: true, force: true });
});

function buildApp(): ReturnType<typeof buildServer> {
  writeDoc(repoARoot, 'rotation.md', '---\nid: key-rotation\n---\n\n# Key rotation policy\n\n## Rotation schedule\n\n## Emergency rotation steps\n\n## Rotation history\n');
  writeDoc(repoARoot, 'guide.md', '---\nid: onboarding\n---\n\n# Onboarding guide\n');
  writeDoc(repoARoot, 'notes/rotation-notes.md', '# Scratch pad\n'); // path match only, no id
  writeDoc(repoBRoot, 'deploy.md', '---\nid: deploying\n---\n\n# Deploying the rotation service\n');
  return buildServer(
    [
      runtimeFor('repo-a', repoARoot, rebuild(repoARoot)),
      runtimeFor('repo-b', repoBRoot, rebuild(repoBRoot)),
    ],
    { uiDistDir: join(repoARoot, 'no-such-ui-dist') },
  );
}

describe('GET /api/search (wave-2 feature 4)', () => {
  it('empty / whitespace query returns []', async () => {
    const app = buildApp();
    for (const q of ['', '   ', undefined]) {
      const url = q === undefined ? '/api/search' : `/api/search?q=${encodeURIComponent(q)}`;
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    }
  });

  it('exact id match ranks above title/heading/path matches, across repos', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/search?q=key-rotation' });
    const results = response.json() as SearchResult[];

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      repoId: 'repo-a',
      docKey: 'key-rotation',
      path: 'rotation.md',
      matchKind: 'id',
    });
    // Everything else scores strictly below the exact id hit.
    for (const r of results.slice(1)) {
      expect(r.score).toBeLessThan(results[0].score);
    }
  });

  it('title substring matches are case-insensitive and rank above path matches', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/search?q=ROTATION' });
    const results = response.json() as SearchResult[];

    const titleHits = results.filter((r) => r.matchKind === 'title');
    const pathHits = results.filter((r) => r.matchKind === 'path');
    expect(titleHits.map((r) => r.docKey)).toEqual(expect.arrayContaining(['key-rotation', 'deploying']));
    // notes/rotation-notes.md has no id -- addressed (and returned) by path key.
    expect(pathHits).toEqual([
      expect.objectContaining({ docKey: 'notes/rotation-notes.md', matchKind: 'path' }),
    ]);
    for (const t of titleHits) {
      for (const p of pathHits) {
        expect(t.score).toBeGreaterThan(p.score);
      }
    }
  });

  it('heading matches carry the heading text and cap at 2 extra rows per doc', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/search?q=rotation' });
    const results = response.json() as SearchResult[];

    const headingRows = results.filter((r) => r.matchKind === 'heading' && r.docKey === 'key-rotation');
    // rotation.md has 3 matching headings; only 2 extra rows allowed.
    expect(headingRows).toHaveLength(2);
    for (const row of headingRows) {
      expect(typeof row.heading).toBe('string');
      expect(row.heading!.toLowerCase()).toContain('rotation');
    }
    // Dedupe: exactly one non-heading row for that doc.
    const primaryRows = results.filter((r) => r.matchKind !== 'heading' && r.docKey === 'key-rotation');
    expect(primaryRows).toHaveLength(1);
  });

  it('fuzzy title fallback finds token-overlap matches without a substring hit', async () => {
    const app = buildApp();
    // 'guide onboarding' is not a substring of "Onboarding guide", but token overlap is total.
    const response = await app.inject({ method: 'GET', url: '/api/search?q=guide%20onboarding' });
    const results = response.json() as SearchResult[];
    const hit = results.find((r) => r.docKey === 'onboarding');
    expect(hit).toBeDefined();
    expect(hit?.matchKind).toBe('title');
  });

  it('honors the limit parameter', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/search?q=rotation&limit=2' });
    expect((response.json() as SearchResult[]).length).toBe(2);
  });
});
