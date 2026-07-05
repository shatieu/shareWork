import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverDocFiles, findGitRoot, NotAGitRepoError, toRepoRelative } from '../src/repo.js';

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'chartroom-repo-test-'));
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe('findGitRoot', () => {
  it('finds the root when cwd IS the root', () => {
    mkdirSync(join(scratchDir, '.git'));
    expect(findGitRoot(scratchDir)).toBe(scratchDir);
  });

  it('finds the root from a nested subdirectory', () => {
    mkdirSync(join(scratchDir, '.git'));
    const nested = join(scratchDir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findGitRoot(nested)).toBe(scratchDir);
  });

  it('throws NotAGitRepoError when no .git is found up to the fs root', () => {
    // scratchDir itself has no .git, and (in CI/dev sandboxes) neither does anything above the
    // OS tmpdir, so this should throw rather than accidentally find this repo's own .git.
    expect(() => findGitRoot(scratchDir)).toThrow(NotAGitRepoError);
  });
});

describe('discoverDocFiles', () => {
  it('finds *.md files and skips built-in noise directories and .gitignore matches', () => {
    mkdirSync(join(scratchDir, '.git'));
    writeFileSync(join(scratchDir, '.gitignore'), 'ignored-dir/\nignored.md\n');
    writeFileSync(join(scratchDir, 'a.md'), '# A');
    mkdirSync(join(scratchDir, 'docs'));
    writeFileSync(join(scratchDir, 'docs', 'b.md'), '# B');
    mkdirSync(join(scratchDir, 'node_modules'));
    writeFileSync(join(scratchDir, 'node_modules', 'c.md'), '# C');
    mkdirSync(join(scratchDir, 'ignored-dir'));
    writeFileSync(join(scratchDir, 'ignored-dir', 'd.md'), '# D');
    writeFileSync(join(scratchDir, 'ignored.md'), '# E');
    writeFileSync(join(scratchDir, 'not-markdown.txt'), 'not md');

    const found = discoverDocFiles(scratchDir);
    expect(found).toEqual(['a.md', 'docs/b.md']);
  });
});

describe('toRepoRelative', () => {
  it('passes through a relative path unchanged (assumed already repo-root-relative)', () => {
    expect(toRepoRelative('/repo', 'docs/a.md')).toBe('docs/a.md');
  });

  it('converts an absolute path to repo-root-relative', () => {
    const rel = toRepoRelative(join('C:', 'repo'), join('C:', 'repo', 'docs', 'a.md'));
    expect(rel).toBe('docs/a.md');
  });
});
