import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executePreCommitHook } from '../src/hook.js';

let repoRoot: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function writeDoc(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function readDoc(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

function stagedBlob(relPath: string): string {
  return git(['show', `:${relPath}`]);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-hook-test-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@test.com']);
  git(['config', 'user.name', 'Test']);
  // Deterministic byte comparisons: line-ending normalization would otherwise undermine the
  // exact byte-identical assertions this test suite depends on.
  git(['config', 'core.autocrlf', 'false']);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('executePreCommitHook', () => {
  it('fully-staged file: both the index blob and the working tree are updated', () => {
    // doc-a lives at sub/a.md from the start; doc-b's link to it was written before the move
    // ever happened (i.e. it's stale from doc-b's very first commit).
    writeDoc('sub/a.md', '---\nid: doc-a\n---\n\n# A\n');
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);

    // Stage an unrelated, fully-staged edit to b.md (no unstaged edits on top).
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n\nMore context.\n');
    git(['add', 'b.md']);

    const result = executePreCommitHook({ repoRoot });
    expect(result.ok).toBe(true);
    const fileResult = result.files.find((f) => f.path === 'b.md');
    expect(fileResult).toBeDefined();
    expect(fileResult!.partiallyStaged).toBe(false);
    expect(fileResult!.action).toBe('links-fixed');

    expect(stagedBlob('b.md')).toContain('(sub/a.md "id:doc-a")');
    expect(stagedBlob('b.md')).not.toContain('(old/a.md "id:doc-a")');
    expect(readDoc('b.md')).toBe(stagedBlob('b.md'));

    // No commit was ever created by the hook.
    expect(git(['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });

  it('partial staging: only the index blob changes, the unstaged working-tree hunk is untouched', () => {
    writeDoc('sub/a.md', '---\nid: doc-a\n---\n\n# A\n');
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);

    // Stage one change...
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n\nStaged paragraph.\n');
    git(['add', 'b.md']);
    // ...then leave a second, unstaged edit on top of it.
    const workingTreeBeforeHook =
      '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n\nStaged paragraph.\n\nUNSTAGED paragraph.\n';
    writeDoc('b.md', workingTreeBeforeHook);

    const result = executePreCommitHook({ repoRoot });
    expect(result.ok).toBe(true);
    const fileResult = result.files.find((f) => f.path === 'b.md');
    expect(fileResult).toBeDefined();
    expect(fileResult!.partiallyStaged).toBe(true);
    expect(fileResult!.action).toBe('links-fixed');

    // The staged blob got the link fix...
    expect(stagedBlob('b.md')).toContain('(sub/a.md "id:doc-a")');
    // ...but the working tree, including the unstaged hunk, is byte-identical to before the hook ran.
    expect(readDoc('b.md')).toBe(workingTreeBeforeHook);

    // A note explaining the situation was surfaced.
    expect(result.notes.some((n) => n.includes('b.md') && n.includes('unstaged edits'))).toBe(true);

    expect(git(['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });

  it('missing-id staged new file gets an id injected into the staged blob (and working tree, if fully staged)', () => {
    writeDoc('README.md', '# Repo\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);

    writeDoc('new-doc.md', '# Brand New Doc\n\nNo id yet.\n');
    git(['add', 'new-doc.md']);

    const result = executePreCommitHook({ repoRoot });
    expect(result.ok).toBe(true);
    const fileResult = result.files.find((f) => f.path === 'new-doc.md');
    expect(fileResult).toBeDefined();
    expect(fileResult!.action).toBe('id-injected');
    expect(fileResult!.partiallyStaged).toBe(false);

    const blob = stagedBlob('new-doc.md');
    expect(blob).toMatch(/^---\nid: [a-z0-9-]+\n---\n/);
    // Body content is otherwise untouched.
    expect(blob.endsWith('# Brand New Doc\n\nNo id yet.\n')).toBe(true);
    // Fully staged (no partial staging) -> working tree was synced to match.
    expect(readDoc('new-doc.md')).toBe(blob);
  });

  it('a .md file that is not staged this round is completely untouched', () => {
    writeDoc('sub/a.md', '---\nid: doc-a\n---\n\n# A\n');
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n');
    writeDoc('untouched.md', '# Untouched\n\nNo id, no stale links, never staged this round.\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);

    // Only b.md is staged this round -- untouched.md is left exactly as committed.
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n\nEdit.\n');
    git(['add', 'b.md']);

    const before = readDoc('untouched.md');
    const result = executePreCommitHook({ repoRoot });
    expect(result.ok).toBe(true);

    // untouched.md was never part of the staged-file set the hook processed...
    expect(result.files.some((f) => f.path === 'untouched.md')).toBe(false);
    // ...and its working-tree bytes are byte-identical to before the hook ran.
    expect(readDoc('untouched.md')).toBe(before);
    // Its staged/committed blob is likewise unaffected.
    expect(stagedBlob('untouched.md')).toBe(before);
  });

  it('never creates a commit, even across multiple staged files needing fixes', () => {
    writeDoc('sub/a.md', '---\nid: doc-a\n---\n\n# A\n');
    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n');
    writeDoc('c.md', '# No id here\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);

    writeDoc('b.md', '---\nid: doc-b\n---\n\nSee [A](old/a.md "id:doc-a").\n\nEdit.\n');
    writeDoc('c.md', '# No id here\n\nEdit.\n');
    git(['add', 'b.md', 'c.md']);

    const countBefore = git(['rev-list', '--count', 'HEAD']).trim();
    const result = executePreCommitHook({ repoRoot });
    expect(result.ok).toBe(true);
    const countAfter = git(['rev-list', '--count', 'HEAD']).trim();
    expect(countAfter).toBe(countBefore);
  });
});
