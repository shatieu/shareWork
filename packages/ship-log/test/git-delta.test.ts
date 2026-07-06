import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeDelta, currentBranch, currentHead, findRepoRoot } from '../src/git-delta.js';

let repo: string;

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function initRepo(dir: string) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ship-log-git-delta-test-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('findRepoRoot', () => {
  it('resolves the toplevel of a real git repo', () => {
    initRepo(repo);
    const root = findRepoRoot(repo);
    expect(root).toBeTruthy();
  });

  it('returns null for a non-git directory', () => {
    expect(findRepoRoot(repo)).toBeNull();
  });
});

describe('computeDelta', () => {
  it('returns null for a non-git directory', () => {
    expect(computeDelta(repo, null)).toBeNull();
  });

  it('returns empty commits/files for a fresh empty repo', () => {
    initRepo(repo);
    const delta = computeDelta(repo, null, new Date().toISOString());
    expect(delta).not.toBeNull();
    expect(delta!.commits).toEqual([]);
    expect(delta!.files).toEqual([]);
  });

  it('reports commits and dirty files since head_start', () => {
    initRepo(repo);
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'initial commit']);
    const headStart = currentHead(repo);

    writeFileSync(join(repo, 'b.txt'), 'two\n');
    git(repo, ['add', 'b.txt']);
    git(repo, ['commit', '-q', '-m', 'add b']);
    writeFileSync(join(repo, 'c.txt'), 'dirty\n'); // untracked, dirty

    const delta = computeDelta(repo, headStart)!;
    expect(delta.commits.map((c) => c.subject)).toEqual(['add b']);
    expect(delta.files).toContain('b.txt');
    expect(delta.files).toContain('c.txt');
  });

  it('falls back to --since when head_start is missing', () => {
    initRepo(repo);
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'only commit']);

    const delta = computeDelta(repo, undefined, startedAt)!;
    expect(delta.commits.map((c) => c.subject)).toEqual(['only commit']);
  });

  it('detached HEAD reports a null branch, not a crash', () => {
    initRepo(repo);
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'c1']);
    const head = currentHead(repo)!;
    git(repo, ['checkout', '-q', head]);

    expect(currentBranch(repo)).toBeNull();
    const delta = computeDelta(repo, head);
    expect(delta).not.toBeNull();
    expect(delta!.branch).toBeNull();
  });
});
