import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFreshIndex } from '../src/indexer.js';
import { emptyIndex, type ChartRoomIndex, type DocEntry } from '../src/index-schema.js';
import { matchGlobs, runStalenessCheck, type GitRunner } from '../src/staleness.js';

const DAY = 86_400;
const NOW = 1_800_000_000; // fixed injected clock (epoch seconds)

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-staleness-test-'));
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

function docEntry(path: string, extra: Partial<DocEntry> = {}): DocEntry {
  return { path, title: path, headings: [], outbound: [], ...extra };
}

/**
 * Fake git seam: `log -1 --format=%ct -- <path>` answers from `epochs` (empty string = git has
 * no commit for the path, triggering the mtime fallback); `ls-files -z` answers from `tracked`.
 * Counts every invocation so perf-bound tests can assert zero subprocesses.
 */
function fakeGit(epochs: Record<string, number>, tracked: string[] = []): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (_root, args) => {
    calls.push(args);
    if (args[0] === 'log') {
      const path = args[args.length - 1];
      const epoch = epochs[path];
      return epoch === undefined ? '' : `${epoch}\n`;
    }
    if (args[0] === 'ls-files') {
      return tracked.join('\0') + (tracked.length > 0 ? '\0' : '');
    }
    throw new Error(`fakeGit: unexpected git args ${args.join(' ')}`);
  };
  return { git, calls };
}

describe('indexer staleness lifting (ttl_days / sources frontmatter)', () => {
  it('lifts valid ttl_days and sources for identified docs', () => {
    writeDoc('a.md', '---\nid: doc-a\nttl_days: 90\nsources:\n  - src/auth/**\n  - package.json\n---\n\n# A\n');
    const { index } = buildFreshIndex(repoRoot);
    expect(index.docs['doc-a'].staleness).toEqual({ ttlDays: 90, sources: ['src/auth/**', 'package.json'] });
  });

  it('lifts staleness for unidentified docs too', () => {
    writeDoc('no-id.md', '---\nttl_days: 30\n---\n\n# No id\n');
    const { index } = buildFreshIndex(repoRoot);
    expect(index.unidentified).toHaveLength(1);
    expect(index.unidentified[0].staleness).toEqual({ ttlDays: 30 });
  });

  it('omits the staleness field entirely for docs that never opted in', () => {
    writeDoc('a.md', '---\nid: doc-a\n---\n\n# A\n');
    const { index } = buildFreshIndex(repoRoot);
    expect('staleness' in index.docs['doc-a']).toBe(false);
  });

  it('silently ignores malformed ttl_days (negative, zero, string, NaN-ish)', () => {
    writeDoc('neg.md', '---\nid: doc-neg\nttl_days: -5\n---\n\n# N\n');
    writeDoc('zero.md', '---\nid: doc-zero\nttl_days: 0\n---\n\n# Z\n');
    writeDoc('str.md', '---\nid: doc-str\nttl_days: "90"\n---\n\n# S\n');
    writeDoc('nan.md', '---\nid: doc-nan\nttl_days: soon\n---\n\n# X\n');
    const { index } = buildFreshIndex(repoRoot);
    for (const id of ['doc-neg', 'doc-zero', 'doc-str', 'doc-nan']) {
      expect(index.docs[id].staleness).toBeUndefined();
    }
  });

  it('silently ignores malformed sources (non-array, empty array, no valid entries) and drops invalid entries', () => {
    writeDoc('scalar.md', '---\nid: doc-scalar\nsources: src/**\n---\n\n# S\n'); // scalar, not array
    writeDoc('empty.md', '---\nid: doc-empty\nsources: []\n---\n\n# E\n');
    writeDoc('nums.md', '---\nid: doc-nums\nsources:\n  - 1\n  - 2\n---\n\n# N\n');
    writeDoc('mixed.md', '---\nid: doc-mixed\nsources:\n  - src/**\n  - 7\n  - ""\n---\n\n# M\n');
    const { index } = buildFreshIndex(repoRoot);
    expect(index.docs['doc-scalar'].staleness).toBeUndefined();
    expect(index.docs['doc-empty'].staleness).toBeUndefined();
    expect(index.docs['doc-nums'].staleness).toBeUndefined();
    expect(index.docs['doc-mixed'].staleness).toEqual({ sources: ['src/**'] });
  });
});

describe('runStalenessCheck — ttl math (injected now + injected lastChange)', () => {
  function indexWithTtl(ttlDays: number): ChartRoomIndex {
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('docs/a.md', { staleness: { ttlDays } });
    return index;
  }

  it('flags a doc whose last change is older than its ttl', () => {
    const { git } = fakeGit({ 'docs/a.md': NOW - 91 * DAY });
    const result = runStalenessCheck(repoRoot, indexWithTtl(90), NOW, { git });
    expect(result.ttlExpired).toEqual([{ id: 'doc-a', path: 'docs/a.md', ttlDays: 90, ageDays: 91 }]);
  });

  it('does not flag a doc younger than its ttl (boundary: exactly ttl days is not expired)', () => {
    const { git } = fakeGit({ 'docs/a.md': NOW - 90 * DAY });
    const result = runStalenessCheck(repoRoot, indexWithTtl(90), NOW, { git });
    expect(result.ttlExpired).toEqual([]);
  });

  it('an unidentified doc with ttl participates, reported with id null', () => {
    const index = emptyIndex();
    index.unidentified.push(docEntry('notes.md', { staleness: { ttlDays: 7 } }));
    const { git } = fakeGit({ 'notes.md': NOW - 8 * DAY });
    const result = runStalenessCheck(repoRoot, index, NOW, { git });
    expect(result.ttlExpired).toEqual([{ id: null, path: 'notes.md', ttlDays: 7, ageDays: 8 }]);
  });

  it('falls back to fs mtime when git has no commit for the path', () => {
    // fake git answers '' for the path (no commit); the real file's mtime is "now-ish",
    // so a 1-day ttl on a just-written file must NOT be expired.
    writeDoc('docs/a.md', '# A\n');
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('docs/a.md', { staleness: { ttlDays: 1 } });
    const { git } = fakeGit({});
    const result = runStalenessCheck(repoRoot, index, Math.floor(Date.now() / 1000), { git });
    expect(result.ttlExpired).toEqual([]);
  });
});

describe('runStalenessCheck — sources matching', () => {
  it('flags a doc when a **-globbed source changed after it, listing only the newer files', () => {
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('docs/auth.md', { staleness: { sources: ['src/auth/**', 'package.json'] } });
    const { git } = fakeGit(
      {
        'docs/auth.md': NOW - 10 * DAY,
        'src/auth/login.ts': NOW - 2 * DAY, // newer -> stale
        'src/auth/deep/tokens.ts': NOW - 1 * DAY, // newer, matched by ** through subdirs
        'src/other.ts': NOW, // newer but NOT matched by any glob
        'package.json': NOW - 20 * DAY, // matched but older -> not listed
      },
      ['docs/auth.md', 'src/auth/login.ts', 'src/auth/deep/tokens.ts', 'src/other.ts', 'package.json'],
    );
    const result = runStalenessCheck(repoRoot, index, NOW, { git });
    expect(result.staleAgainstSources).toEqual([
      {
        id: 'doc-a',
        path: 'docs/auth.md',
        newerSources: ['src/auth/login.ts', 'src/auth/deep/tokens.ts'],
      },
    ]);
  });

  it('does not flag a doc when all matched sources are older', () => {
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('docs/auth.md', { staleness: { sources: ['src/**'] } });
    const { git } = fakeGit(
      { 'docs/auth.md': NOW, 'src/a.ts': NOW - 5 * DAY },
      ['docs/auth.md', 'src/a.ts'],
    );
    const result = runStalenessCheck(repoRoot, index, NOW, { git });
    expect(result.staleAgainstSources).toEqual([]);
  });

  it('a doc matching its own sources glob is never "newer than itself"', () => {
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('docs/a.md', { staleness: { sources: ['docs/**'] } });
    const { git } = fakeGit({ 'docs/a.md': NOW - 1 * DAY }, ['docs/a.md']);
    const result = runStalenessCheck(repoRoot, index, NOW, { git });
    expect(result.staleAgainstSources).toEqual([]);
  });

  it('matchGlobs uses gitignore semantics (bare name matches at any depth, / anchors)', () => {
    const files = ['package.json', 'sub/package.json', 'src/x.ts'];
    expect(matchGlobs(files, ['package.json'])).toEqual(['package.json', 'sub/package.json']);
    expect(matchGlobs(files, ['/package.json'])).toEqual(['package.json']);
  });
});

describe('runStalenessCheck — orphan detection', () => {
  it('flags identified docs with zero inbound id-links; linked docs are not orphans', () => {
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('a.md', {
      outbound: [{ targetId: 'doc-b', hrefAsWritten: 'b.md', stale: false }],
    });
    index.docs['doc-b'] = docEntry('b.md');
    const { git } = fakeGit({});
    const result = runStalenessCheck(repoRoot, index, NOW, { git });
    // doc-b has an inbound link from doc-a; doc-a has none -> doc-a is the orphan.
    expect(result.orphans).toEqual([{ id: 'doc-a', path: 'a.md' }]);
  });

  it('excludes unidentified docs by construction (they cannot receive id-links)', () => {
    const index = emptyIndex();
    index.unidentified.push(docEntry('no-id.md'));
    const { git } = fakeGit({});
    const result = runStalenessCheck(repoRoot, index, NOW, { git });
    expect(result.orphans).toEqual([]);
  });
});

describe('runStalenessCheck — perf bound', () => {
  it('runs ZERO git subprocesses when no doc opts in (orphans are pure index math)', () => {
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('a.md');
    index.docs['doc-b'] = docEntry('b.md');
    index.unidentified.push(docEntry('no-id.md'));
    const { git, calls } = fakeGit({});
    runStalenessCheck(repoRoot, index, NOW, { git });
    expect(calls).toHaveLength(0);
  });

  it('memoizes per-path git log and runs ls-files at most once', () => {
    const index = emptyIndex();
    index.docs['doc-a'] = docEntry('a.md', { staleness: { sources: ['src/**'] } });
    index.docs['doc-b'] = docEntry('b.md', { staleness: { sources: ['src/**'] } });
    const { git, calls } = fakeGit(
      { 'a.md': NOW, 'b.md': NOW, 'src/x.ts': NOW - DAY },
      ['a.md', 'b.md', 'src/x.ts'],
    );
    runStalenessCheck(repoRoot, index, NOW, { git });
    const lsFilesCalls = calls.filter((args) => args[0] === 'ls-files');
    const logCalls = calls.filter((args) => args[0] === 'log');
    expect(lsFilesCalls).toHaveLength(1);
    // 3 unique paths (a.md, b.md, src/x.ts) -> 3 memoized log calls, not 4+.
    expect(logCalls).toHaveLength(3);
  });
});
