import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFreshIndex } from '../src/indexer.js';
import { writeIndex } from '../src/index-schema.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-indexer-test-'));
  mkdirSync(join(repoRoot, '.git'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeDoc(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('buildFreshIndex', () => {
  it('first-ever build invents no tombstones', () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const { index } = buildFreshIndex(repoRoot);
    expect(index.docs['doc-a'].path).toBe('a.md');
    expect(index.deleted).toEqual({});
  });

  it('move (same id, new path) updates docs[id].path with no tombstone', () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const first = buildFreshIndex(repoRoot);
    writeIndex(repoRoot, first.index);

    // simulate a move: remove old file conceptually by writing the new location and not the old.
    rmSync(join(repoRoot, 'a.md'));
    writeDoc('sub/a.md', '---\nid: doc-a\n---\n\n# A\n');

    const second = buildFreshIndex(repoRoot);
    expect(second.index.docs['doc-a'].path).toBe('sub/a.md');
    expect(second.index.deleted).toEqual({});
  });

  it('true deletion tombstones the id with its last known path', () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const first = buildFreshIndex(repoRoot);
    writeIndex(repoRoot, first.index);

    rmSync(join(repoRoot, 'a.md'));

    const second = buildFreshIndex(repoRoot);
    expect(second.index.docs['doc-a']).toBeUndefined();
    expect(second.index.deleted['doc-a']).toBeDefined();
    expect(second.index.deleted['doc-a'].lastPath).toBe('a.md');
  });

  it('resurrection removes the tombstone once the id reappears', () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const first = buildFreshIndex(repoRoot);
    writeIndex(repoRoot, first.index);
    rmSync(join(repoRoot, 'a.md'));
    const second = buildFreshIndex(repoRoot);
    writeIndex(repoRoot, second.index);
    expect(second.index.deleted['doc-a']).toBeDefined();

    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A restored\n');
    const third = buildFreshIndex(repoRoot);
    expect(third.index.deleted['doc-a']).toBeUndefined();
    expect(third.index.docs['doc-a'].path).toBe('a.md');
  });

  it('detects duplicate ids and excludes the loser from docs (but keeps it discoverable)', () => {
    writeDoc('a.md', '---\nid: dup\n---\n\n# A\n');
    writeDoc('b.md', '---\nid: dup\n---\n\n# B\n');
    const { index, duplicateIds } = buildFreshIndex(repoRoot);
    expect(duplicateIds).toEqual([{ id: 'dup', paths: ['a.md', 'b.md'] }]);
    expect(index.docs['dup'].path).toBe('a.md');
    expect(index.unidentified.some((d) => d.path === 'b.md')).toBe(true);
  });

  it('missing-id doc is excluded from docs but still present in unidentified for path lookup', () => {
    writeDoc('no-id.md', '# No Id Here\n');
    const { index, missingIdPaths } = buildFreshIndex(repoRoot);
    expect(missingIdPaths).toEqual(['no-id.md']);
    expect(Object.values(index.docs).some((d) => d.path === 'no-id.md')).toBe(false);
    expect(index.unidentified.some((d) => d.path === 'no-id.md')).toBe(true);
  });

  it('computes outbound stale flags relative to current resolved paths', () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [a](a.md "id:doc-a").\n');
    const first = buildFreshIndex(repoRoot);
    const link = first.index.docs['doc-b'].outbound.find((o) => o.targetId === 'doc-a');
    expect(link?.stale).toBe(false);

    // Move doc-a; b's link now points at the stale pre-move path.
    writeIndex(repoRoot, first.index);
    rmSync(join(repoRoot, 'a.md'));
    writeDoc('sub/a.md', '---\nid: doc-a\n---\n\n# A\n');
    const second = buildFreshIndex(repoRoot);
    const staleLink = second.index.docs['doc-b'].outbound.find((o) => o.targetId === 'doc-a');
    expect(staleLink?.stale).toBe(true);
  });
});
