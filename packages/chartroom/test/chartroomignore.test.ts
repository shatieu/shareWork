import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverDocFiles } from '../src/repo.js';
import { runInit } from '../src/commands/init.js';
import { runCheck } from '../src/check.js';
import { readIndex } from '../src/index-schema.js';

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'chartroom-crignore-test-'));
  mkdirSync(join(scratchDir, '.git'));
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe('.chartroomignore', () => {
  it('excludes matched paths from discovery, additively with .gitignore', () => {
    writeFileSync(join(scratchDir, '.gitignore'), 'git-ignored/\n');
    writeFileSync(join(scratchDir, '.chartroomignore'), 'vendored/\n*KICKOFF*.md\n');
    writeFileSync(join(scratchDir, 'a.md'), '# A');
    mkdirSync(join(scratchDir, 'vendored'));
    writeFileSync(join(scratchDir, 'vendored', 'v.md'), '# V');
    mkdirSync(join(scratchDir, 'git-ignored'));
    writeFileSync(join(scratchDir, 'git-ignored', 'g.md'), '# G');
    writeFileSync(join(scratchDir, 'THE-KICKOFF-PROMPT.md'), '# K');

    expect(discoverDocFiles(scratchDir)).toEqual(['a.md']);
  });

  it('runInit leaves an excluded doc byte-identical and out of the index', () => {
    writeFileSync(join(scratchDir, '.chartroomignore'), 'vendored/\n');
    writeFileSync(join(scratchDir, 'a.md'), '# A\n');
    mkdirSync(join(scratchDir, 'vendored'));
    const excludedBytes = '# Untouchable\n\nno frontmatter, on purpose\n';
    writeFileSync(join(scratchDir, 'vendored', 'v.md'), excludedBytes);

    const summary = runInit(scratchDir, false);
    expect(summary.assignedIds).toBe(1);

    expect(readFileSync(join(scratchDir, 'vendored', 'v.md'), 'utf8')).toBe(excludedBytes);
    expect(readFileSync(join(scratchDir, 'a.md'), 'utf8')).toMatch(/^---\nid: /);

    const index = readIndex(scratchDir);
    expect(index).toBeDefined();
    const allPaths = [
      ...Object.values(index!.docs).map((d) => d.path),
      ...index!.unidentified.map((d) => d.path),
    ];
    expect(allPaths).toEqual(['a.md']);
  });

  it('runCheck does not count excluded docs as missing ids', () => {
    writeFileSync(join(scratchDir, '.chartroomignore'), 'vendored/\n');
    writeFileSync(join(scratchDir, 'a.md'), '---\nid: doc-a\n---\n\n# A\n');
    mkdirSync(join(scratchDir, 'vendored'));
    writeFileSync(join(scratchDir, 'vendored', 'v.md'), '# V, no id\n');

    const result = runCheck(scratchDir);
    expect(result.missingIds).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it('behavior is unchanged when no .chartroomignore exists', () => {
    writeFileSync(join(scratchDir, '.gitignore'), 'ignored-dir/\n');
    writeFileSync(join(scratchDir, 'a.md'), '# A');
    mkdirSync(join(scratchDir, 'ignored-dir'));
    writeFileSync(join(scratchDir, 'ignored-dir', 'd.md'), '# D');
    mkdirSync(join(scratchDir, 'docs'));
    writeFileSync(join(scratchDir, 'docs', 'b.md'), '# B');

    expect(discoverDocFiles(scratchDir)).toEqual(['a.md', 'docs/b.md']);
  });
});
