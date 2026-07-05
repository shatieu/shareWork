import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { createHttpRepoContext, createStdioRepoContext } from '../../src/mcp/repo-context.js';

let repoRoot: string;

function writeDoc(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-repo-context-test-'));
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('createStdioRepoContext', () => {
  it('builds a fresh index from disk and reads raw doc content', () => {
    writeDoc('a.md', '---\nid: a\n---\n\n# A\n\nHello.\n');
    const ctx = createStdioRepoContext(repoRoot);

    const index = ctx.getIndex();
    expect(index.docs.a.path).toBe('a.md');
    expect(ctx.readDocRaw('a.md')).toBe('---\nid: a\n---\n\n# A\n\nHello.\n');
  });

  it('memoizes the rebuild within one context instance (same object across calls)', () => {
    writeDoc('a.md', '---\nid: a\n---\n\n# A\n');
    const ctx = createStdioRepoContext(repoRoot);
    const first = ctx.getIndex();
    const second = ctx.getIndex();
    expect(first).toBe(second);
  });

  it('a new context instance reflects on-disk changes made since the previous instance', () => {
    writeDoc('a.md', '---\nid: a\n---\n\n# A\n');
    const first = createStdioRepoContext(repoRoot);
    expect(first.getIndex().docs.a).toBeDefined();

    writeDoc('b.md', '---\nid: b\n---\n\n# B\n');
    const second = createStdioRepoContext(repoRoot);
    expect(second.getIndex().docs.b).toBeDefined();
  });

  it('surfaces interactive blocks computed fresh from disk', () => {
    writeDoc('a.md', '---\nid: a\n---\n\n:::ask-me{id="q1" type="yesno"}\nShip it?\n:::\n');
    const ctx = createStdioRepoContext(repoRoot);
    expect(ctx.getInteractiveBlocks().a.askMe).toHaveLength(1);
    expect(ctx.getInteractiveBlocks().a.askMe[0].directiveId).toBe('q1');
  });
});

describe('createHttpRepoContext', () => {
  it('reads directly from an already-live RepoState, no rebuild', () => {
    writeDoc('a.md', '---\nid: a\n---\n\n# A\n\nHi.\n');
    let state: RepoState = rebuild(repoRoot);
    const ctx = createHttpRepoContext({ absPath: repoRoot, getState: () => state });

    expect(ctx.getIndex()).toBe(state.index);
    expect(ctx.readDocRaw('a.md')).toBe('---\nid: a\n---\n\n# A\n\nHi.\n');

    // Swap the live state (simulating a chokidar-triggered rebuild) -- the context must observe
    // the new state on its next call, not a snapshot frozen at construction time.
    writeDoc('b.md', '---\nid: b\n---\n\n# B\n');
    state = rebuild(repoRoot);
    expect(ctx.getIndex().docs.b).toBeDefined();
  });
});
