import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { findDoc } from '../../src/daemon/doc-lookup.js';

let repoRoot: string;

function writeDoc(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function stateWith(): RepoState {
  writeDoc('identified.md', '---\nid: my-doc\n---\n\n# Identified\n');
  writeDoc('docs/no-id.md', '# No id here\n');
  return rebuild(repoRoot);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-doc-lookup-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('findDoc (doc-lookup.ts, v1.1 key convention)', () => {
  it('resolves an exact frontmatter id', () => {
    const found = findDoc(stateWith(), 'my-doc');
    expect(found).toBeDefined();
    expect(found?.id).toBe('my-doc');
    expect(found?.key).toBe('my-doc');
    expect(found?.entry.path).toBe('identified.md');
  });

  it('resolves an identified doc by its repo-relative path, canonicalizing the key to the id', () => {
    const found = findDoc(stateWith(), 'identified.md');
    expect(found).toBeDefined();
    expect(found?.id).toBe('my-doc');
    expect(found?.key).toBe('my-doc');
  });

  it('resolves an unidentified doc by path with id null and key = path', () => {
    const found = findDoc(stateWith(), 'docs/no-id.md');
    expect(found).toBeDefined();
    expect(found?.id).toBeNull();
    expect(found?.key).toBe('docs/no-id.md');
    expect(found?.entry.title).toBe('No id here');
  });

  it('normalizes backslashes in path keys', () => {
    const found = findDoc(stateWith(), 'docs\\no-id.md');
    expect(found).toBeDefined();
    expect(found?.key).toBe('docs/no-id.md');
  });

  it('never fuzzy-resolves: a near-miss returns undefined, not the wrong doc', () => {
    const state = stateWith();
    expect(findDoc(state, 'my-docs')).toBeUndefined();
    expect(findDoc(state, 'no-id.md')).toBeUndefined(); // bare filename is not a repo-relative path
    expect(findDoc(state, 'does/not/exist.md')).toBeUndefined();
  });
});
