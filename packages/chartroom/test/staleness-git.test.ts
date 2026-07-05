import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lastChangeEpoch, matchSources } from '../src/staleness.js';
import { buildFreshIndex } from '../src/indexer.js';
import { runCheck } from '../src/check.js';
import { executePreCommitHook } from '../src/hook.js';

const DAY = 86_400;

let repoRoot: string;

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function writeFile(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

/** Commit `relPath` with a controlled commit time (unix epoch seconds). */
function commitAt(relPath: string, epoch: number, message: string): void {
  const date = `@${epoch} +0000`; // git raw date format
  git(['add', '--', relPath]);
  git(['commit', '-m', message, '--', relPath], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-staleness-git-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('lastChangeEpoch against a real git repo', () => {
  it('returns the git commit time for a committed file, not the fs mtime', () => {
    const epoch = Math.floor(Date.now() / 1000) - 100 * DAY;
    writeFile('docs/a.md', '# A\n');
    commitAt('docs/a.md', epoch, 'add a');
    // The working-tree file was just written, so its mtime is "now" — git must win.
    expect(lastChangeEpoch(repoRoot, 'docs/a.md')).toBe(epoch);
  });

  it('falls back to fs mtime for an untracked file', () => {
    writeFile('untracked.md', '# U\n');
    const before = Math.floor(Date.now() / 1000);
    const epoch = lastChangeEpoch(repoRoot, 'untracked.md');
    expect(epoch).toBeDefined();
    // mtime of a just-written file is "now" give or take clock granularity.
    expect(Math.abs((epoch as number) - before)).toBeLessThanOrEqual(5);
  });

  it('returns undefined when neither git nor the filesystem knows the path', () => {
    expect(lastChangeEpoch(repoRoot, 'never-existed.md')).toBeUndefined();
  });
});

describe('matchSources against a real git repo', () => {
  it('matches tracked files through ** globs; untracked files are invisible', () => {
    const now = Math.floor(Date.now() / 1000);
    writeFile('src/auth/login.ts', 'x');
    writeFile('src/other.ts', 'y');
    commitAt('src/auth/login.ts', now - DAY, 'login');
    commitAt('src/other.ts', now - DAY, 'other');
    writeFile('src/auth/untracked.ts', 'z'); // never committed
    expect(matchSources(repoRoot, ['src/auth/**'])).toEqual(['src/auth/login.ts']);
  });
});

describe('runCheck end-to-end on a real git repo (expired ttl + stale sources + orphan)', () => {
  it('surfaces all three and keeps `clean` meaning integrity only', () => {
    const now = Math.floor(Date.now() / 1000);

    // fresh.md <-> hub.md link each other so neither is an orphan; orphan.md gets no inbound link.
    writeFile(
      'docs/hub.md',
      '---\nid: doc-hub\n---\n\n# Hub\n\n[fresh](./fresh.md "id:doc-fresh")\n',
    );
    writeFile(
      'docs/fresh.md',
      '---\nid: doc-fresh\nsources:\n  - src/auth/**\n---\n\n# Fresh\n\n[hub](./hub.md "id:doc-hub")\n',
    );
    writeFile('docs/expired.md', '---\nid: doc-expired\nttl_days: 90\n---\n\n# Expired\n');
    writeFile('docs/orphan.md', '---\nid: doc-orphan\n---\n\n# Orphan\n');
    writeFile('src/auth/login.ts', 'export const x = 1;\n');

    commitAt('docs/hub.md', now - 10 * DAY, 'hub');
    commitAt('docs/fresh.md', now - 10 * DAY, 'fresh doc');
    commitAt('docs/expired.md', now - 120 * DAY, 'expired doc');
    commitAt('docs/orphan.md', now - DAY, 'orphan doc');
    commitAt('src/auth/login.ts', now - 2 * DAY, 'auth change AFTER fresh doc');

    const result = runCheck(repoRoot, { nowEpoch: now });

    expect(result.clean).toBe(true); // integrity untouched by staleness
    expect(result.stalenessClean).toBe(false);
    expect(result.staleness.ttlExpired).toEqual([
      { id: 'doc-expired', path: 'docs/expired.md', ttlDays: 90, ageDays: 120 },
    ]);
    expect(result.staleness.staleAgainstSources).toEqual([
      { id: 'doc-fresh', path: 'docs/fresh.md', newerSources: ['src/auth/login.ts'] },
    ]);
    expect(result.staleness.orphans).toEqual(
      expect.arrayContaining([
        { id: 'doc-expired', path: 'docs/expired.md' },
        { id: 'doc-orphan', path: 'docs/orphan.md' },
      ]),
    );
    // hub and fresh link each other — neither is an orphan.
    expect(result.staleness.orphans.map((o) => o.id)).not.toContain('doc-hub');
    expect(result.staleness.orphans.map((o) => o.id)).not.toContain('doc-fresh');
  });

  it('a repo with zero opt-ins is stalenessClean and clean stays untouched', () => {
    const now = Math.floor(Date.now() / 1000);
    writeFile('docs/a.md', '---\nid: doc-a\n---\n\n# A\n');
    commitAt('docs/a.md', now - 500 * DAY, 'ancient but no ttl');
    const result = runCheck(repoRoot, { nowEpoch: now });
    expect(result.clean).toBe(true);
    expect(result.stalenessClean).toBe(true);
    expect(result.staleness.ttlExpired).toEqual([]);
    expect(result.staleness.staleAgainstSources).toEqual([]);
  });
});

describe('pre-commit hook guard: staleness never affects the hook', () => {
  it('hook behavior is byte-identical around a ttl-expired doc (repairs nothing, blocks nothing)', () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredContent = '---\nid: doc-expired\nttl_days: 1\n---\n\n# Expired\n';
    writeFile('docs/expired.md', expiredContent);
    commitAt('docs/expired.md', now - 30 * DAY, 'expired doc');
    // refresh the on-disk index so the hook's rebuild has a previous state (normal repo shape)
    const { index } = buildFreshIndex(repoRoot);
    expect(index.docs['doc-expired'].staleness).toEqual({ ttlDays: 1 });

    // Stage an unrelated, fully well-formed doc and run the hook.
    const stagedContent = '---\nid: doc-new\n---\n\n# New doc\n';
    writeFile('docs/new.md', stagedContent);
    git(['add', '--', 'docs/new.md']);

    const result = executePreCommitHook({ repoRoot });

    expect(result.ok).toBe(true); // ttl expiry must never block a commit
    expect(result.files).toEqual([{ path: 'docs/new.md', action: 'unchanged', partiallyStaged: false }]);
    // Byte-identical: neither the staged doc nor the stale doc was rewritten.
    expect(readFileSync(join(repoRoot, 'docs/new.md'), 'utf8')).toBe(stagedContent);
    expect(readFileSync(join(repoRoot, 'docs/expired.md'), 'utf8')).toBe(expiredContent);
    expect(git(['show', ':docs/new.md'])).toBe(stagedContent);
  });
});
